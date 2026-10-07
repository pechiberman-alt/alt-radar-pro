import assert from "node:assert/strict";
import test from "node:test";
import type { AiLike } from "../lib/ai-brains.ts";
import { closeCoreSignals, coreSnapshot, ensureCoreSchema, openCoreSignals, readCoreStats } from "../lib/jarvis-core-db.ts";
import { coreContext, coreStatusSpeech } from "../lib/jarvis-core.ts";
import { checkThesis, mindDossier, parseMindAnswer, readingSpeech, readingText, thesisRecord, type MindReading } from "../lib/jarvis-mind.ts";
import { mindStatus, runMindHour } from "../lib/jarvis-mind-db.ts";
import { readingEvent } from "../lib/telegram-jarvis.ts";
import { makeDb, sqlite } from "./helpers/fake-d1.ts";

const H = 3_600_000;

test("the answer's JSON is found even inside fences or with words around it", () => {
  assert.deepEqual(parseMindAnswer('```json\n{"sesgo":"ALCISTA","tesis":[]}\n```'), { sesgo: "ALCISTA", tesis: [] });
  assert.deepEqual(parseMindAnswer('Acá va: {"sesgo":"NEUTRAL"} listo'), { sesgo: "NEUTRAL" });
  assert.equal(parseMindAnswer("sin json"), null);
  assert.equal(parseMindAnswer("{roto"), null);
  const t = readingText({ sesgo: "CUALQUIERA", resumen: "  BTC  manda.  ", activos: [{ moneda: "solusdt", lectura: "Arriba de 180." }, { moneda: "", lectura: "x" }], riesgos: ["a", 3], vigilar: "no es lista" });
  assert.deepEqual(t, { sesgo: "NEUTRAL", resumen: "BTC manda.", activos: [{ moneda: "SOL", lectura: "Arriba de 180." }], riesgos: ["a"], vigilar: [] });
});

test("a thesis is kept only as a real plan from the current price", () => {
  const ok = checkThesis({ sesgo: "ALCISTA", objetivo: 110, invalidacion: 97, confianza: "MEDIA", porque: "tendencias alineadas" }, 100);
  assert.deepEqual(ok, { ok: true, lado: "LONG", objetivo: 110, invalidacion: 97, confianza: "MEDIA", porque: "tendencias alineadas" });
  assert.deepEqual(checkThesis({ sesgo: "BAJISTA", objetivo: 90, invalidacion: 104, confianza: "ALTA" }, 100), { ok: true, lado: "SHORT", objetivo: 90, invalidacion: 104, confianza: "ALTA", porque: "" });
  assert.equal(checkThesis({ sesgo: "ALCISTA", objetivo: 95, invalidacion: 90 }, 100).ok, false, "target below the price for a long");
  assert.match((checkThesis({ sesgo: "ALCISTA", objetivo: 100.5, invalidacion: 99.9 }, 100) as { motivo: string }).motivo, /riesgo de 0,1%|riesgo de 0.1%/);
  assert.match((checkThesis({ sesgo: "ALCISTA", objetivo: 101, invalidacion: 97 }, 100) as { motivo: string }).motivo, /objetivo\/riesgo 0.3/);
  assert.equal(checkThesis({ sesgo: "NEUTRAL", objetivo: 110, invalidacion: 95 }, 100).ok, false);
  assert.equal((checkThesis({ sesgo: "ALCISTA", objetivo: 110, invalidacion: 96, confianza: "ENORME" }, 100) as { confianza: string }).confianza, "BAJA", "unknown confidence counts as low");
  // Levels come back as text copied from DATOS; a slip into English notation is still read right.
  const txt = checkThesis({ sesgo: "ALCISTA", objetivo: "11,5", invalidacion: "10.78" }, 11.07);
  assert.deepEqual([txt.ok, (txt as { objetivo: number }).objetivo, (txt as { invalidacion: number }).invalidacion], [true, 11.5, 10.78]);
  assert.equal((checkThesis({ sesgo: "BAJISTA", objetivo: "nivel", invalidacion: "nivel" }, 11.07) as { motivo: string }).motivo, "niveles inválidos");
});

const read = (precio: number, at: number) => ({
  at,
  precio,
  cambio24h: 0.012,
  cambio7d: -0.03,
  cambio30d: 0.1,
  tendencias: { "1h": "ALCISTA", "4h": "ALCISTA", "1d": "LATERAL" },
  alineacion: "MIXTA",
  atr1hPct: 0.8,
  soportes: [{ precio: precio * 0.97, toques: 3, distanciaPct: -3 }],
  resistencias: [{ precio: precio * 1.05, toques: 2, distanciaPct: 5 }],
  rango48: [precio * 0.96, precio * 1.03],
  volumen24VsSemana: 1.4,
  aPunto: null,
});

async function seed(db: D1Database, now: number) {
  await ensureCoreSchema(db);
  const at = Math.floor(now / H) * H - H;
  const mind = { readings: {}, btc: { regime: "SUBE", change24: 0.012, at: now }, magnets: {}, feed: { venue: "KRAKEN", binance: "BLOQUEADO", at: now }, reads: { SOLUSDT: read(180, at), BTCUSDT: read(90_000, at), ETHUSDT: read(3_000, at - 10 * H) } };
  await db.prepare("INSERT OR REPLACE INTO jarvis_core_state (key, value) VALUES ('mind', ?1)").bind(JSON.stringify(mind)).run();
  return at;
}

const answer = JSON.stringify({
  sesgo: "ALCISTA",
  resumen: "BTC sostiene 90.000 y las alts acompañan.",
  activos: [{ moneda: "SOL", lectura: "Tendencia alcista en 1h y 4h, resistencia en 189." }],
  riesgos: ["Dato de inflación de EE.UU."],
  vigilar: ["Cierre de 4h de BTC arriba de 94.500"],
  tesis: [
    { moneda: "SOL", sesgo: "ALCISTA", objetivo: "189", invalidacion: "174,6", confianza: "MEDIA", porque: "1h y 4h alcistas sobre soporte de 3 toques" },
    { moneda: "BTC", sesgo: "ALCISTA", objetivo: 85_000, invalidacion: 80_000, confianza: "ALTA", porque: "x" },
    { moneda: "PEPE", sesgo: "ALCISTA", objetivo: 1, invalidacion: 0.5, confianza: "BAJA", porque: "y" },
  ],
});

test("the hourly mind: once an hour from hh:17, with fresh reads only, theses checked and recorded as IA signals", { skip: !sqlite }, async () => {
  const db = makeDb();
  const now = Date.UTC(2026, 9, 7, 15, 17, 30);
  const at = await seed(db, now);
  let seen = "";
  const ai: AiLike = {
    run: async (_m, input) => {
      seen = JSON.stringify(input);
      return { response: answer, usage: { prompt_tokens: 2600, completion_tokens: 700 } };
    },
  };
  const fetchCandle = async (symbol: string) => ({ openTime: at, close: symbol === "SOLUSDT" ? 180 : 90_000, venue: "KRAKEN" as const });
  assert.equal(await runMindHour(db, { AI: ai }, Date.UTC(2026, 9, 7, 15, 16), { fetchCandle }), null, "not before hh:17");
  const r = (await runMindHour(db, { AI: ai }, now, { fetchCandle }))!;
  assert.equal(r.brain, "cloudflare");
  assert.equal(r.sesgo, "ALCISTA");
  assert.equal(r.sesgoAnterior, null);
  assert.deepEqual(r.tesis.map((t) => [t.moneda, t.lado, t.entrada, t.objetivo, t.invalidacion, t.confianza]), [["SOL", "LONG", 180, 189, 174.6, "MEDIA"]]);
  assert.deepEqual(r.descartadas.map((d) => d.moneda), ["BTC", "PEPE"]);
  assert.match(r.descartadas[1].motivo, /fuera de las 20 monedas/);
  assert.match(seen, /\\"m\\":\\"SOL\\"/, "the prompt carries the coins' reads");
  assert.doesNotMatch(seen, /\\"m\\":\\"ETH\\"/, "a read older than 3 hours is left out");
  assert.match(seen, /\\"precio\\":\\"90\.000\\"/, "prices go written the Argentine way");
  assert.match(seen, /\\"sop\\":\[\\"174,6\\"\]/);
  const open = await openCoreSignals(db);
  assert.deepEqual(open.map((s) => [s.id, s.source, s.taken, s.note]), [[`IA:SOLUSDT:1h:${at}:LONG`, "IA", true, "tesis de la IA · confianza media · precios de Kraken (USD)"]]);
  assert.equal((await readCoreStats(db)).bySource.IA.open, 1);
  assert.equal(await runMindHour(db, { AI: ai }, now + 5 * 60_000, { fetchCandle }), null, "once per hour");
  assert.equal((await mindStatus(db))?.ok, true);
  const pool = await db.prepare("SELECT neurons FROM ai_free_usage WHERE user_id = 0 LIMIT 1").first<{ neurons: number }>();
  assert.ok((pool?.neurons ?? 0) > 20, "its neurons count against the free pool");

  // Next hour: SOL already has a thesis open; the bias changed, so Telegram hears about it.
  const bear = JSON.stringify({ ...JSON.parse(answer), sesgo: "BAJISTA" });
  const r2 = (await runMindHour(db, { AI: { run: async () => ({ response: bear }) } }, now + H, { fetchCandle }))!;
  assert.equal(r2.sesgoAnterior, "ALCISTA");
  assert.equal(r2.descartadas[0].motivo, "ya tiene una tesis abierta");
  const ev = readingEvent(r2)!;
  assert.match(ev.text, /JARVIS cambió su lectura del mercado: alcista → bajista/);
  assert.match(ev.text, /No es asesoramiento financiero/);
  assert.equal(readingEvent(r), null, "no change, no message");

  // The thesis closes like any signal and the record counts it apart.
  const s = open[0];
  await closeCoreSignals(db, [{ ...s, result: "OBJETIVO", r: 0.61, closedAt: at + 5 * H }]);
  const st = await readCoreStats(db);
  assert.equal(st.bySource.IA.resolved, 1);
  assert.equal(st.bySource.ROMPE.resolved, 0);
  const snap = await coreSnapshot(db, now + H + 60_000);
  assert.equal(snap.reading?.sesgo, "BAJISTA");
  const ctx = coreContext(snap, now + H + 60_000).nucleo;
  assert.equal(ctx.mente?.sesgo, "BAJISTA");
  assert.equal(ctx.historialDeTesis?.cerradas, 1);
  assert.match(readingSpeech(snap.reading!, now + H + 60_000), /^Mi lectura de hace 1 minuto: mercado bajista\./);
  assert.match(coreStatusSpeech({ ...snap, heartbeat: { at: now + H, task: "SCAN", ok: true, note: "" } }, now + H + 60_000), /Mis tesis de inteligencia artificial: 0 abiertas y 1 cerradas, más 0,6 R, muestra mínima\./);
});

test("no free brain left, or no fresh reads: nothing is written and the status says why", { skip: !sqlite }, async () => {
  const db = makeDb();
  const now = Date.UTC(2026, 9, 7, 15, 20);
  await ensureCoreSchema(db);
  assert.equal(await runMindHour(db, {}, now), null);
  assert.equal((await mindStatus(db))?.error, "SIN CUPO DE IA GRATIS");
  const db2 = makeDb();
  await ensureCoreSchema(db2);
  assert.equal(await runMindHour(db2, { AI: { run: async () => assert.fail("no data, no call") } }, now), null);
  assert.equal((await mindStatus(db2))?.error, "SIN LECTURAS FRESCAS DEL NÚCLEO");
});

test("the dossier and the record the AI sees", () => {
  const now = Date.UTC(2026, 9, 7, 15, 17);
  const rec = thesisRecord({ resolved: 3, open: 1, wins: 1, losses: 2, winRate: 1 / 3, profitFactor: 0.8, expectancyR: -0.2, totalR: -0.6, confidence: "MUESTRA MÍNIMA" }, []);
  assert.deepEqual(rec, { cerradas: 3, abiertas: 1, winRate: 33, profitFactor: 0.8, totalR: -0.6, muestra: "MUESTRA MÍNIMA", ultimas: [] });
  const d = mindDossier({
    mind: { readings: {}, btc: null, magnets: {}, reads: { SOLUSDT: read(180, now - H) as never } },
    world: { at: now, fearGreed: { value: 25, zone: "MIEDO", yesterday: 30, weekAgo: 40 }, news: [] },
    structure: { btc_dominance: 58.7, usdt_dominance: 6.4, total_market_cap: 2.85e12 },
    record: rec,
    open: [],
    learning: null,
    previous: { at: now - H, sesgo: "NEUTRAL", resumen: "Sin dirección." },
    now,
  });
  assert.equal(d.monedas[0].m, "SOL");
  assert.deepEqual(d.sentimiento, { miedoYAvaricia: 25, zona: "MIEDO", ayer: 30, semanaPasada: 40 });
  assert.deepEqual(d.estructura, { dominanciaBtc: 58.7, dominanciaUsdt: 6.4, capTotalBillones: 2.85 });
  assert.equal(d.lecturaAnterior?.haceMin, 60);
});

test("what JARVIS says about its reading", () => {
  const r: MindReading = { at: 0, brain: "groq", model: "m", sesgo: "NEUTRAL", sesgoAnterior: null, resumen: "Rango.", activos: [], riesgos: [], vigilar: ["BTC en 94.500"], tesis: [{ id: "x", moneda: "SOL", lado: "LONG", entrada: 180, objetivo: 189, invalidacion: 174, confianza: "BAJA", porque: "" }], descartadas: [] };
  assert.equal(readingSpeech(r, 5 * 60_000), "Mi lectura de hace 5 minutos: mercado sin dirección clara. Rango. Tesis nuevas: SOL alcista, objetivo 189, invalidación 174. A vigilar: BTC en 94.500. No es asesoramiento financiero.");
});
