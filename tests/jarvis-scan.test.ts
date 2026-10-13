import assert from "node:assert/strict";
import test from "node:test";
import { aggregate } from "../lib/asset-read.ts";
import type { DeskSnapshot, MarketContext } from "../lib/jarvis-desk-data.ts";
import { DEFAULT_DESK_SETTINGS, runDesk, type DeskDecision } from "../lib/jarvis-desk.ts";
import { scanMarket } from "../lib/jarvis-scan-run.ts";
import {
  DEFAULT_SCAN_VOLUME,
  SCAN_DEEP_MAX,
  SCAN_LIMITS,
  SCAN_STALE_MS,
  eligibleSymbols,
  isApproved,
  quickRead,
  quickSnapshot,
  rankApproved,
  rowFrom,
  rowWithoutData,
  scanAgeSpeech,
  scanCandles,
  scanLine,
  scanProgressSpeech,
  scanSpeech,
  scanSummaryText,
  summarize,
  type Eligible,
  type ScanResult,
  type ScanRow,
  type ScanShared,
} from "../lib/jarvis-scan.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

/**
 * El escáner lee todas las monedas con la misma mesa, pero de a poco y sin
 * mirar el futuro. Estas pruebas fijan qué monedas entran, que cada lectura
 * rápida es la de la mesa sin derivados, que lo que no se pudo leer se dice, y
 * que el ritmo cuida a Binance (sin caer nunca al servidor de la app).
 */

const H = 3_600_000;
const T0 = Date.UTC(2026, 8, 1);
const NOW = T0 + 1000 * H + 10 * 60_000; // 10 minutos adentro de la vela 1000: esa todavía se está formando

const path = (f: (i: number) => number, n: number): SwingCandle[] =>
  Array.from({ length: n }, (_, i) => {
    const o = f(i);
    const c = f(i + 1);
    return { openTime: T0 + i * H, open: o, high: Math.max(o, c) * 1.003, low: Math.min(o, c) * 0.997, close: c, volume: 100 + (i % 9) * 10, quoteVolume: (100 + (i % 9) * 10) * c };
  });

// Cuatro mercados de prueba, con lo que la mesa decide en cada uno (ver tests/jarvis-council.test.ts y los de reglas v2).
const LONG = path((i) => 100 * 1.0002 ** i + 4 * Math.sin(i / 13), 1001);
const SHORT = path((i) => 100 * 0.9998 ** i + 2 * Math.sin(i / 9), 1001);
const WAIT = path((i) => 100 + 3 * Math.sin(i / 9), 1001);
const VETO = path((i) => 100 * 1.0004 ** i + 8 * Math.sin(i / 11) + 3 * Math.sin(i / 3), 1001);
const BTC = path((i) => 60_000 * 1.0004 ** i + 300 * Math.sin(i / 7), 1001);
const ETH = path((i) => 3_000 * 1.0005 ** i + 20 * Math.sin(i / 5), 1001);

const CONTEXT: MarketContext = { sentiment: null, calendar: null, structure: null };
const SHARED: ScanShared = { btc: BTC.slice(0, 1000).slice(-200), eth: ETH.slice(0, 1000).slice(-200), context: CONTEXT };

const toRows = (c: SwingCandle[]) => c.map((x) => [x.openTime, String(x.open), String(x.high), String(x.low), String(x.close), String(x.volume), x.openTime + H - 1, String(x.quoteVolume), 0, "0", "0", "0"]);
const eligible = (moneda: string, volumenUsd = 50_000_000): Eligible => ({ symbol: `${moneda}USDT`, moneda, volumenUsd });
const candlesOf = (h1: SwingCandle[], now = NOW) => scanCandles({ h1: toRows(h1.slice(-1000)), h4: toRows(aggregate(h1, 4).slice(-300)), d1: toRows(aggregate(h1, 24).slice(-220)) }, now);

/** Lo mismo que la mesa le lee a una moneda cuando no tiene derivados, armado a mano (sin pasar por el escáner). */
function handSnapshot(h1: SwingCandle[]): DeskSnapshot {
  // The API gives the last 1000 candles, the last of which is still forming: 999 closed ones. The desk closes the frames itself.
  return {
    symbol: "XUSDT",
    now: NOW,
    candles: { h1: h1.slice(-1000), h4: aggregate(h1, 4).slice(-300), d1: aggregate(h1, 24).slice(-220) },
    btc: SHARED.btc,
    eth: SHARED.eth,
    derivatives: null,
    macro: { btcDominance: null, usdtDominance: null, marketCapChange24h: null, events: null, calendarSource: null },
    news: null,
    fearGreed: null,
    sources: ["prueba"],
  };
}

// ── Qué monedas entran ──

test("the universe: real coins with enough volume, most traded first; stablecoins, indexes, metals and odd names stay out and are counted", () => {
  const rows = [
    { symbol: "BTCUSDT", quoteVolume: "9000000000" },
    { symbol: "ETHUSDT", quoteVolume: "4000000000" },
    { symbol: "JUPUSDT", quoteVolume: "30000000" }, // termina en UPUSDT: no es un token apalancado
    { symbol: "1000PEPEUSDT", quoteVolume: "80000000" },
    { symbol: "USDCUSDT", quoteVolume: "700000000" },
    { symbol: "BTCDOMUSDT", quoteVolume: "50000000" },
    { symbol: "XAUUSDT", quoteVolume: "90000000" },
    { symbol: "币安人生USDT", quoteVolume: "60000000" },
    { symbol: "BTCUSDT_261225", quoteVolume: "10000000" }, // futuro con vencimiento: ni siquiera es un contrato perpetuo USDT
    { symbol: "ETHBTC", quoteVolume: "10000000" },
    { symbol: "TINYUSDT", quoteVolume: "900000" },
    { symbol: "NOVOLUSDT", quoteVolume: "no" },
    { symbol: "BTCUSDT", quoteVolume: "9000000000" }, // repetida
    null,
    { symbol: 7 },
  ];
  const u = eligibleSymbols(rows, DEFAULT_SCAN_VOLUME);
  assert.deepEqual(u.elegibles.map((e) => e.moneda), ["BTC", "ETH", "1000PEPE", "JUP"]);
  assert.equal(u.contratos, 10, "los contratos USDT distintos que devolvió Binance");
  assert.equal(u.noMonedas, 4, "USDC, BTCDOM, XAU y el nombre con caracteres raros");
  assert.equal(u.sinVolumen, 2, "TINY por debajo del mínimo y NOVOL sin volumen informado");
  assert.equal(u.contratos, u.elegibles.length + u.noMonedas + u.sinVolumen + u.recortadas);
  assert.equal(u.recortadas, 0);
});

test("the universe: the volume minimum and the cap are applied, and what the cap leaves out is counted", () => {
  const rows = ["AAA", "BBB", "CCC", "DDD"].map((m, i) => ({ symbol: `${m}USDT`, quoteVolume: String((4 - i) * 10_000_000) }));
  assert.equal(eligibleSymbols(rows, 20_000_000).elegibles.length, 3);
  assert.equal(eligibleSymbols(rows, 1).elegibles.length, 4);
  const capped = eligibleSymbols(rows, 1, 2);
  assert.deepEqual(capped.elegibles.map((e) => e.moneda), ["AAA", "BBB"]);
  assert.equal(capped.recortadas, 2);
  assert.equal(capped.contratos, capped.elegibles.length + capped.noMonedas + capped.sinVolumen + capped.recortadas);
  // Same volume: alphabetical, so the order is always the same.
  const tie = eligibleSymbols([{ symbol: "ZZZUSDT", quoteVolume: "5" }, { symbol: "AAAUSDT", quoteVolume: "5" }], 1);
  assert.deepEqual(tie.elegibles.map((e) => e.moneda), ["AAA", "ZZZ"]);
  const nada = eligibleSymbols("no es una lista", 1);
  assert.deepEqual([nada.elegibles.length, nada.contratos], [0, 0]);
});

// ── La lectura rápida ──

test("the quick read of a coin is the desk's reading without derivatives, not something else", () => {
  for (const [name, h1] of [["LONG", LONG], ["SHORT", SHORT], ["WAIT", WAIT], ["VETO", VETO]] as const) {
    const row = quickRead(eligible("X"), candlesOf(h1), SHARED, NOW, DEFAULT_DESK_SETTINGS);
    const d = runDesk(handSnapshot(h1), DEFAULT_DESK_SETTINGS)!;
    assert.equal(row.direccion, d.direccion, name);
    assert.equal(row.puntaje, d.puntaje, name);
    assert.equal(row.consenso, d.consenso, name);
    assert.equal(row.cobertura, d.cobertura, name);
    assert.equal(row.lectura, "rápida");
    assert.equal(row.antes, null);
  }
});

test("the scanner approves and stops where the desk does: the four markets give the four outcomes", () => {
  const read = (h1: SwingCandle[]) => quickRead(eligible("X"), candlesOf(h1), SHARED, NOW, DEFAULT_DESK_SETTINGS);
  const long = read(LONG);
  const short = read(SHORT);
  const wait = read(WAIT);
  const veto = read(VETO);
  assert.equal(long.direccion, "LONG");
  assert.equal(short.direccion, "SHORT");
  assert.equal(wait.direccion, "ESPERAR");
  assert.equal(veto.direccion, "NO TRADE");
  // An approved row carries its plan and no stop; the others carry where they stopped and why, and no plan.
  for (const r of [long, short]) {
    assert.ok(r.plan);
    assert.equal(r.frenoEn, null);
    assert.equal(r.motivo, null);
    assert.equal(r.plan.lado, r.direccion);
    assert.ok(r.plan.rr >= 1.5, "the risk manager's minimum");
    assert.ok(r.plan.lado === "LONG" ? r.plan.stop < r.plan.entrada && r.plan.tp1 > r.plan.entrada : r.plan.stop > r.plan.entrada && r.plan.tp1 < r.plan.entrada);
  }
  assert.equal(wait.plan, null);
  assert.equal(wait.frenoEn, "consenso");
  assert.match(wait.motivo!, /no llega al mínimo de ±0,30/);
  assert.equal(veto.plan, null);
  assert.equal(veto.frenoEn, "riesgo");
  assert.match(veto.motivo!, /^Veto: /);
  assert.deepEqual([long, short, wait, veto].map(isApproved), [true, true, false, false]);
});

test("no lookahead: the candle still forming is left out, and what comes after the cut changes nothing", () => {
  // The last candle (index 1000) opens at T0 + 1000 h and is 10 minutes old at NOW: it is not a closed candle.
  const c = candlesOf(LONG);
  assert.equal(c.h1!.length, 999, "the API's last 1000 candles, minus the one still forming");
  assert.equal(c.h1!.at(-1)!.openTime, T0 + 999 * H);
  assert.ok(c.h4!.at(-1)!.openTime + 4 * H <= NOW);
  assert.ok(c.d1!.at(-1)!.openTime + 24 * H <= NOW);
  const base = quickRead(eligible("X"), c, SHARED, NOW, DEFAULT_DESK_SETTINGS);
  // Wrecking the forming candle (and anything beyond) must not move a single number of the reading.
  const wrecked = LONG.map((x, i) => (i >= 1000 ? { ...x, open: x.open * 9, high: x.high * 9, low: x.low * 0.1, close: x.close * 0.1 } : x));
  const again = quickRead(eligible("X"), candlesOf(wrecked), SHARED, NOW, DEFAULT_DESK_SETTINGS);
  assert.deepEqual(again, base);
  // And one hour later that candle does count (it is a closed candle then).
  const later = scanCandles({ h1: toRows(LONG), h4: toRows(aggregate(LONG, 4)), d1: toRows(aggregate(LONG, 24)) }, NOW + H);
  assert.equal(later.h1!.length, 1001);
});

test("a coin without enough closed candles is not read, and the row says so instead of making up a decision", () => {
  const short = candlesOf(LONG.slice(-150));
  const row = quickRead(eligible("NEW"), short, SHARED, NOW, DEFAULT_DESK_SETTINGS);
  assert.equal(row.direccion, "SIN DATOS");
  assert.equal(row.puntaje, null);
  assert.equal(row.consenso, null);
  assert.equal(row.plan, null);
  assert.match(row.motivo!, /menos de 200 velas de 1 h/);
  assert.match(row.motivo!, /Este dato no está disponible actualmente/);
  const none = quickRead(eligible("NEW"), { h1: null, h4: null, d1: null }, SHARED, NOW, DEFAULT_DESK_SETTINGS);
  assert.equal(none.direccion, "SIN DATOS");
  assert.equal(rowWithoutData(eligible("Q"), "x").lectura, "rápida");
});

test("the quick snapshot is assembled like the full one: same shape, no derivatives and no liquidations, said in the sources", () => {
  const s = quickSnapshot("SOLUSDT", candlesOf(LONG), SHARED, NOW);
  assert.equal(s.derivatives, null);
  assert.equal(s.liquidations, null);
  assert.deepEqual(s.btc, SHARED.btc);
  assert.match(s.sources[0], /Velas: Binance Futures \(1h, 4h y 1d, solo cerradas\)/);
  assert.ok(!s.sources.some((x) => /Derivados|Liquidaciones/.test(x)));
  // BTC reads itself as its own reference, the way the full read does.
  const btc = quickSnapshot("BTCUSDT", candlesOf(BTC), SHARED, NOW);
  assert.equal(btc.btc, btc.candles.h1);
});

// ── Ordenar y contar ──

const rowsOf = (): ScanRow[] => {
  const q = (m: string, h1: SwingCandle[], volumenUsd = 50_000_000) => quickRead(eligible(m, volumenUsd), candlesOf(h1), SHARED, NOW, DEFAULT_DESK_SETTINGS);
  return [q("AAA", LONG), q("BBB", SHORT), q("CCC", WAIT), q("DDD", VETO), q("EEE", LONG, 90_000_000), rowWithoutData(eligible("FFF"), "Sin velas.")];
};

test("the ranking puts the approved ones first by confluence, and the order is always the same", () => {
  const rows = rowsOf();
  const ranked = rankApproved(rows);
  assert.deepEqual(ranked.map((r) => r.moneda).sort(), ["AAA", "BBB", "EEE"]);
  for (let i = 1; i < ranked.length; i += 1) assert.ok(ranked[i - 1].puntaje! >= ranked[i].puntaje!);
  // AAA and EEE read the same market: same confluence, so the one with more volume goes first.
  const same = ranked.filter((r) => r.puntaje === ranked.find((x) => x.moneda === "AAA")!.puntaje && r.moneda !== "BBB");
  assert.deepEqual(same.map((r) => r.moneda), ["EEE", "AAA"]);
  assert.deepEqual(rankApproved([...rows].reverse()).map((r) => r.symbol), ranked.map((r) => r.symbol));
  assert.equal(rankApproved(rows.filter((r) => !isApproved(r))).length, 0);
});

test("the summary adds up: every coin read is either approved or stopped at exactly one gate", () => {
  const rows = rowsOf();
  const s = summarize(rows);
  assert.equal(s.total, 6);
  assert.equal(s.sinDatos, 1);
  assert.equal(s.leidas, 5);
  assert.deepEqual([s.aprobadas, s.largos, s.cortos], [3, 2, 1]);
  assert.deepEqual([s.sinLado, s.vetadas, s.esperan, s.sinPlan], [1, 1, 0, 0]);
  assert.equal(s.leidas, s.aprobadas + s.sinLado + s.sinPlan + s.vetadas + s.esperan);
  assert.deepEqual([s.completas, s.cayeron], [0, 0]);
  // One that passed on candles and stopped passing when read in full is counted as fallen, not hidden.
  const fell = { ...rows[0], lectura: "completa" as const, antes: "LONG" as const, direccion: "NO TRADE" as const, frenoEn: "riesgo" as const, plan: null, motivo: "Veto: x" };
  const s2 = summarize([fell, rows[1]]);
  assert.deepEqual([s2.completas, s2.cayeron, s2.aprobadas, s2.vetadas], [1, 1, 1, 1]);
});

test("the texts say what was read and count it, with no probability and no percentages", () => {
  const rows = rowsOf();
  const result: ScanResult = { at: NOW, minVolumen: 5_000_000, universo: { elegibles: 6, contratos: 9, noMonedas: 2, sinVolumen: 1, recortadas: 0 }, filas: rows, resumen: summarize(rows), parcial: false, motivoParcial: null, duracionMs: 1000 };
  const text = scanSummaryText(result);
  assert.match(text, /Leí 5 monedas de 6 \(1 sin velas suficientes\)/);
  assert.match(text, /más de 5 millones de dólares en 24 horas/);
  assert.match(text, /3 tienen un plan aprobado \(2 largos y 1 corto\)/);
  assert.match(text, /1 sin lado claro, 1 vetadas por el gestor de riesgo, 0 esperando el momento/);
  assert.ok(!/%|probabilidad/i.test(text), "counts, not percentages");
  const speech = scanSpeech(result, 2);
  assert.match(speech, /Las de más confluencia: /);
  assert.match(speech, /en lectura rápida/, "a quick read says it is quick");
  assert.match(speech, /no la probabilidad de acertar/);
  assert.match(speech, /No es asesoramiento financiero/);
  assert.equal((speech.match(/confluencia \d+/g) ?? []).length, 2, "the n asked for");
  const cut = scanSummaryText({ ...result, parcial: true, motivoParcial: "lo cortaste vos" });
  assert.match(cut, /Escaneo cortado: lo cortaste vos\./);
  const none = scanSummaryText({ ...result, filas: [rows[2]], resumen: summarize([rows[2]]) });
  assert.match(none, /Ninguna tiene un plan aprobado/);
  // The limits are part of what the scanner says.
  assert.ok(SCAN_LIMITS.some((x) => /10 monedas grandes/.test(x)));
  assert.ok(SCAN_LIMITS.some((x) => /no la probabilidad de acertar/.test(x)));
  assert.ok(SCAN_LIMITS.some((x) => /No es asesoramiento financiero/.test(x)));
});

test("the chat says how the scan is going and how old the last one is, and warns when it is too old to read plans from", () => {
  assert.match(scanProgressSpeech(null), /empezando/);
  assert.match(scanProgressSpeech({ fase: "monedas", hechas: 0, total: 0, restanteMs: null }), /lista de monedas/);
  assert.match(scanProgressSpeech({ fase: "datos", hechas: 0, total: 0, restanteMs: null }), /BTC, ETH, calendario, noticias y sentimiento/);
  // The wait is only said when there is a pace to estimate it from; an unknown time is not made up.
  assert.equal(scanProgressSpeech({ fase: "lectura", hechas: 40, total: 180, restanteMs: null }), "Voy por la moneda 40 de 180.");
  assert.equal(scanProgressSpeech({ fase: "lectura", hechas: 40, total: 180, restanteMs: 45_000 }), "Voy por la moneda 40 de 180. Tiempo restante estimado: 45 segundos.");
  assert.match(scanProgressSpeech({ fase: "lectura", hechas: 40, total: 180, restanteMs: 100_000 }), /Tiempo restante estimado: 2 minutos\.$/);
  assert.equal(scanProgressSpeech({ fase: "completa", hechas: 3, total: 10, restanteMs: null }), "Estoy releyendo completas las aprobadas: 3 de 10.");

  const rows = rowsOf();
  const result: ScanResult = { at: NOW, minVolumen: 5_000_000, universo: { elegibles: 6, contratos: 9, noMonedas: 2, sinVolumen: 1, recortadas: 0 }, filas: rows, resumen: summarize(rows), parcial: false, motivoParcial: null, duracionMs: 1000 };
  assert.equal(scanAgeSpeech(result, NOW + 20_000), "El último escaneo es de hace menos de un minuto. ");
  assert.equal(scanAgeSpeech(result, NOW + 1 * 60_000), "El último escaneo es de hace 1 minuto. ");
  assert.equal(scanAgeSpeech(result, NOW + 12 * 60_000), "El último escaneo es de hace 12 minutos. ");
  // Right at the limit it is still fresh; one minute past it, the plans are no longer to be read.
  assert.doesNotMatch(scanAgeSpeech(result, NOW + SCAN_STALE_MS), /viejo/);
  const old = scanAgeSpeech(result, NOW + SCAN_STALE_MS + 60_000);
  assert.match(old, /de hace 31 minutos y ya está viejo: el mercado cambió, volvé a escanear antes de mirar los planes\. $/);
  assert.match(scanAgeSpeech(result, NOW + 2 * 3_600_000), /de hace 2 horas y ya está viejo/);
  assert.match(scanAgeSpeech(result, NOW - 5 * 60_000), /de hace menos de un minuto/, "a clock that went back is not a negative age");
});

test("a copied line uses the Argentine comma and says which read it comes from", () => {
  const row = quickRead(eligible("SOL"), candlesOf(LONG), SHARED, NOW, DEFAULT_DESK_SETTINGS);
  const line = scanLine(row);
  assert.match(line, /^SOL LONG · confluencia \d+ · consenso \+0,\d+ · entrada \d+,\d+ · stop \d+,\d+ · TP1 \d+,\d+ · R:R 1:\d(,\d+)? · riesgo (BAJO|MEDIO|ALTO) · lectura rápida$/);
  assert.equal(scanLine(quickRead(eligible("W"), candlesOf(WAIT), SHARED, NOW, DEFAULT_DESK_SETTINGS)), "W: ESPERAR");
});

test("no field of a row is named like a probability", () => {
  const keys = (v: unknown, out: string[] = []): string[] => {
    if (Array.isArray(v)) v.forEach((x) => keys(x, out));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        out.push(k);
        keys(x, out);
      }
    }
    return out;
  };
  const all = keys(rowsOf());
  assert.ok(all.length > 40);
  assert.deepEqual(all.filter((k) => /prob|azar|chance|acierto/i.test(k)), []);
});

// ── El motor con una Binance de mentira ──

const res = (status: number, body: unknown, headers: Record<string, string> = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }, json: async () => body }) as unknown as Response;

type Behave = (symbol: string, call: number) => "ok" | 429 | 418 | "gone";

function fakeBinance(series: Record<string, SwingCandle[]>, tickers: unknown[], behave: Behave = () => "ok") {
  const calls: string[] = [];
  const perSymbol = new Map<string, number>();
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    const u = new URL(url);
    if (u.pathname === "/fapi/v1/ticker/24hr") return res(200, tickers);
    if (u.pathname === "/fapi/v1/klines") {
      const symbol = u.searchParams.get("symbol")!;
      const interval = u.searchParams.get("interval")!;
      const limit = Number(u.searchParams.get("limit"));
      const n = (perSymbol.get(symbol) ?? 0) + 1;
      perSymbol.set(symbol, n);
      const b = behave(symbol, n);
      if (b === 429) return res(429, { code: -1003 }, { "retry-after": "20" });
      if (b === 418) return res(418, { code: -1003 });
      const h1 = series[symbol];
      if (b === "gone" || !h1) return res(400, { code: -1121 });
      const c = interval === "1h" ? h1 : interval === "4h" ? aggregate(h1, 4) : aggregate(h1, 24);
      return res(200, toRows(c.slice(-limit)));
    }
    return res(404, {});
  }) as typeof fetch;
  return { fetchImpl, calls };
}

/** Un reloj de mentira: dormir lo adelanta, sin esperar de verdad. */
function fakeTime() {
  const t = { now: NOW };
  const sleeps: number[] = [];
  return { t, sleeps, now: () => t.now, sleep: async (ms: number) => { sleeps.push(ms); t.now += ms; } };
}

const ticker = (moneda: string, volume: number) => ({ symbol: `${moneda}USDT`, quoteVolume: String(volume) });
const MARKET: Record<string, SwingCandle[]> = { BTCUSDT: BTC, ETHUSDT: ETH, AAAUSDT: LONG, BBBUSDT: SHORT, CCCUSDT: WAIT, DDDUSDT: VETO };
const TICKERS = [ticker("BTC", 9e9), ticker("ETH", 4e9), ticker("AAA", 8e7), ticker("BBB", 7e7), ticker("CCC", 6e7), ticker("DDD", 5.5e7), ticker("USDC", 5e8), ticker("TINY", 1e5)];
const run = (over: Parameters<typeof scanMarket>[0] & object, series = MARKET, tickers: unknown[] = TICKERS, behave?: Behave) => {
  const fb = fakeBinance(series, tickers, behave);
  const tm = fakeTime();
  return { fb, tm, out: scanMarket({ fetchImpl: fb.fetchImpl, now: tm.now, sleep: tm.sleep, settings: DEFAULT_DESK_SETTINGS, loadContext: async () => CONTEXT, deep: async () => null, ...over }) };
};

test("each coin reaches onRow as it is read, so the page can show the scan while it runs", async () => {
  const seen: string[] = [];
  const { out } = run({ onRow: (r) => seen.push(r.moneda) });
  const o = await out;
  assert.ok(o.ok);
  assert.deepEqual([...seen].sort(), o.result.filas.map((r) => r.moneda).sort(), "todas las leídas, una vez cada una");
  assert.equal(new Set(seen).size, seen.length);
});

test("a full scan reads every coin that passes the filters, three requests each, only from Binance Futures, and never asks the app's server", async () => {
  const { fb, out } = run({});
  const o = await out;
  assert.ok(o.ok);
  const r = o.result;
  assert.equal(r.parcial, false);
  assert.equal(r.motivoParcial, null);
  assert.deepEqual(r.filas.map((x) => x.moneda), ["BTC", "ETH", "AAA", "BBB", "CCC", "DDD"], "most traded first");
  assert.deepEqual(r.universo, { elegibles: 6, contratos: 8, noMonedas: 1, sinVolumen: 1, recortadas: 0 });
  const klines = fb.calls.filter((u) => u.includes("/fapi/v1/klines"));
  assert.equal(klines.length, 3 * 6 + 2, "1h, 4h and 1d for each coin, plus BTC and ETH once for everyone");
  assert.equal(fb.calls.filter((u) => u.includes("/fapi/v1/ticker/24hr")).length, 1);
  assert.ok(fb.calls.every((u) => /^https:\/\/fapi[0-9]?\.binance\.com\/fapi\/v1\//.test(u)), "no spot, no copy of the server, no app routes");
  assert.ok(klines.filter((u) => u.includes("symbol=BTCUSDT")).length === 4, "BTC: its own three plus the shared hour");
  assert.deepEqual(r.resumen, summarize(r.filas));
  assert.deepEqual(r.filas.filter((x) => x.moneda === "AAA" || x.moneda === "BBB").map((x) => x.direccion), ["LONG", "SHORT"]);
});

test("a scan paces itself: one coin every 700 ms at most, and the sleeps are what the pacing asked for", async () => {
  const { tm, out } = run({});
  await out;
  assert.ok(tm.sleeps.length >= 4, "it waited between coins");
  assert.ok(tm.sleeps.every((ms) => ms > 0 && ms <= 1400));
  // 6 coins at 700 ms: the last one cannot start before 5 gaps have passed since the first.
  assert.ok(tm.t.now - NOW >= 5 * 700 - 1);
});

test("the volume minimum is respected and a lower one reads more coins", async () => {
  const wide = await run({ minVolume: 1e4 }).out;
  assert.ok(wide.ok);
  assert.equal(wide.result.filas.length, 7);
  const none = await run({ minVolume: 1e12 }).out;
  assert.equal(none.ok, false);
  assert.match((none as { error: string }).error, /Ninguna moneda supera ese volumen mínimo/);
});

test("a coin Binance does not know is reported as without data and the scan goes on", async () => {
  const o = await run({}, MARKET, TICKERS, (symbol) => (symbol === "CCCUSDT" ? "gone" : "ok")).out;
  assert.ok(o.ok);
  const ccc = o.result.filas.find((x) => x.moneda === "CCC")!;
  assert.equal(ccc.direccion, "SIN DATOS");
  assert.match(ccc.motivo!, /Binance no devolvió velas de 1 h de esta moneda/);
  assert.equal(o.result.resumen.sinDatos, 1);
  assert.equal(o.result.filas.length, 6, "the others were read");
  assert.equal(o.result.parcial, false);
});

test("when Binance says 429 the scan waits what it asked and tries the coin again", async () => {
  // First attempt at BBB is limited (its three requests), the second one goes through.
  const { tm, out } = run({}, MARKET, TICKERS, (symbol, call) => (symbol === "BBBUSDT" && call <= 3 ? 429 : "ok"));
  const o = await out;
  assert.ok(o.ok);
  assert.equal(o.result.parcial, false);
  const bbb = o.result.filas.find((x) => x.moneda === "BBB")!;
  assert.equal(bbb.direccion, "SHORT", "read after the wait");
  assert.ok(Math.max(...tm.sleeps) >= 19_000, `waited about the 20 s it asked for (${Math.max(...tm.sleeps)})`);
});

test("if Binance keeps limiting, the scan stops and says so, with what it did read", async () => {
  const o = await run({}, MARKET, TICKERS, (symbol) => (symbol === "BTCUSDT" || symbol === "ETHUSDT" ? "ok" : 429)).out;
  assert.ok(o.ok);
  assert.equal(o.result.parcial, true);
  assert.match(o.result.motivoParcial!, /429/);
  assert.ok(o.result.filas.length < o.result.universo.elegibles);
  assert.match(scanSummaryText(o.result), /Escaneo cortado: Binance limitó/);
});

test("an HTTP 418 (the connection is banned for a while) stops the scan at once", async () => {
  const fb = fakeBinance(MARKET, TICKERS, (symbol) => (symbol === "AAAUSDT" ? 418 : "ok"));
  const tm = fakeTime();
  const o = await scanMarket({ fetchImpl: fb.fetchImpl, now: tm.now, sleep: tm.sleep, settings: DEFAULT_DESK_SETTINGS, loadContext: async () => CONTEXT, deep: async () => null });
  assert.ok(o.ok);
  assert.equal(o.result.parcial, true);
  assert.match(o.result.motivoParcial!, /418/);
  assert.ok(!o.result.filas.some((x) => x.moneda === "AAA"));
});

test("cancelling stops the scan, keeps what was read and does no full reads", async () => {
  const ctl = new AbortController();
  let deepCalls = 0;
  const { out } = run({
    signal: ctl.signal,
    onProgress: (p) => {
      if (p.fase === "lectura" && p.hechas >= 2) ctl.abort();
    },
    deep: async () => {
      deepCalls += 1;
      return null;
    },
  });
  const o = await out;
  assert.ok(o.ok);
  assert.equal(o.result.parcial, true);
  assert.equal(o.result.motivoParcial, "lo cortaste vos");
  assert.ok(o.result.filas.length >= 2 && o.result.filas.length < 6, `${o.result.filas.length} read`);
  assert.equal(deepCalls, 0);
});

test("no answer from the list of coins: an error that says so, not an empty result", async () => {
  const fetchImpl = (async () => res(500, {})) as typeof fetch;
  const tm = fakeTime();
  const o = await scanMarket({ fetchImpl, now: tm.now, sleep: tm.sleep, settings: DEFAULT_DESK_SETTINGS, loadContext: async () => CONTEXT });
  assert.equal(o.ok, false);
  assert.match((o as { error: string }).error, /Binance no respondió/);
  const limited = (async () => res(429, {})) as typeof fetch;
  const o2 = await scanMarket({ fetchImpl: limited, now: tm.now, sleep: tm.sleep, settings: DEFAULT_DESK_SETTINGS, loadContext: async () => CONTEXT });
  assert.equal(o2.ok, false);
});

test("the approved ones are read again in full: the full reading replaces the quick one and the ones that fall are counted", async () => {
  const asked: string[] = [];
  const full = (symbol: string): DeskDecision | null => {
    asked.push(symbol);
    if (symbol === "AAAUSDT") return runDesk(handSnapshot(VETO), DEFAULT_DESK_SETTINGS); // the full read vetoes it
    if (symbol === "BBBUSDT") return runDesk(handSnapshot(SHORT), DEFAULT_DESK_SETTINGS)!; // and confirms this one
    return null;
  };
  const o = await run({ deep: async (s) => full(s) }).out;
  assert.ok(o.ok);
  assert.deepEqual(asked.sort(), ["AAAUSDT", "BBBUSDT"], "only the approved ones, never the rest");
  const by = (m: string) => o.result.filas.find((x) => x.moneda === m)!;
  assert.equal(by("AAA").lectura, "completa");
  assert.equal(by("AAA").antes, "LONG");
  assert.equal(by("AAA").direccion, "NO TRADE");
  assert.equal(by("BBB").lectura, "completa");
  assert.equal(by("BBB").direccion, "SHORT");
  assert.equal(by("CCC").lectura, "rápida");
  assert.deepEqual([o.result.resumen.completas, o.result.resumen.cayeron, o.result.resumen.aprobadas], [2, 1, 1]);
  assert.match(scanSummaryText(o.result), /1 de las aprobadas en la lectura rápida dejó de estarlo al leerla completa/);
});

test("a full read that fails keeps the quick one and says so; there is a cap on full reads", async () => {
  const many: Record<string, SwingCandle[]> = { BTCUSDT: BTC, ETHUSDT: ETH };
  const tickers: unknown[] = [ticker("BTC", 9e9), ticker("ETH", 4e9)];
  for (let i = 0; i < 13; i += 1) {
    const m = `C${String(i).padStart(2, "0")}`;
    many[`${m}USDT`] = LONG;
    tickers.push(ticker(m, 9e7 - i * 1e6));
  }
  let calls = 0;
  const o = await run({
    deep: async (s) => {
      calls += 1;
      if (s === "C00USDT") throw new Error("sin red");
      return runDesk(handSnapshot(LONG), DEFAULT_DESK_SETTINGS);
    },
  }, many, tickers).out;
  assert.ok(o.ok);
  assert.equal(calls, SCAN_DEEP_MAX, "ten full reads at most");
  const first = o.result.filas.find((x) => x.moneda === "C00")!;
  assert.equal(first.lectura, "rápida");
  assert.equal(first.direccion, "LONG");
  assert.match(first.nota!, /No se pudo releer completa: queda la lectura rápida/);
  assert.equal(o.result.filas.filter((x) => x.lectura === "completa").length, SCAN_DEEP_MAX - 1);
  assert.equal(o.result.filas.filter((x) => isApproved(x) && x.lectura === "rápida").length, 13 - SCAN_DEEP_MAX + 1, "the rest stay quick, and are labelled so");
});

test("the same market gives the same scan twice, in the same order", async () => {
  const a = await run({}).out;
  const b = await run({}).out;
  assert.ok(a.ok && b.ok);
  const strip = (r: ScanResult) => ({ ...r, at: 0, duracionMs: 0 });
  assert.deepEqual(strip(a.result), strip(b.result));
});

test("progress is reported from the list of coins to the last one, with an estimate only once there is a pace", async () => {
  const seen: { fase: string; hechas: number; total: number; restanteMs: number | null }[] = [];
  await run({ onProgress: (p) => seen.push({ fase: p.fase, hechas: p.hechas, total: p.total, restanteMs: p.restanteMs }) }).out;
  assert.equal(seen[0].fase, "monedas");
  assert.equal(seen[1].fase, "datos");
  const lectura = seen.filter((p) => p.fase === "lectura");
  assert.equal(lectura.length, 6);
  assert.deepEqual(lectura.map((p) => p.hechas), [1, 2, 3, 4, 5, 6]);
  assert.ok(lectura.every((p) => p.total === 6));
  assert.ok(lectura.filter((p) => p.hechas < 3).every((p) => p.restanteMs === null), "no estimate with one or two coins");
  assert.ok(lectura.filter((p) => p.hechas >= 3 && p.hechas < 6).every((p) => typeof p.restanteMs === "number" && p.restanteMs > 0));
  assert.equal(lectura.at(-1)!.restanteMs, 0);
});

test("the row of a decision carries what the desk decided, nothing else", () => {
  for (const h1 of [LONG, SHORT, WAIT, VETO]) {
    const d = runDesk(handSnapshot(h1), DEFAULT_DESK_SETTINGS)!;
    const row = rowFrom(eligible("X"), d, "completa", "ESPERAR");
    assert.equal(row.direccion, d.direccion);
    assert.equal(row.puntaje, d.puntaje);
    assert.equal(row.precio, d.precio);
    assert.equal(row.antes, "ESPERAR");
    assert.equal(row.lectura, "completa");
    // Por dentro: cada especialista con su dato (1 o 0) y las cuatro compuertas, para verlas en la araña.
    assert.deepEqual(
      row.agentes!.map((a) => a[0]),
      d.agentes.map((a) => a.id),
    );
    assert.deepEqual(
      row.compuertas!.map((g) => g.id),
      ["consenso", "plan", "riesgo", "momento"],
    );
    if (d.plan && isApproved(row)) {
      assert.equal(row.plan!.entrada, d.plan.entrada);
      assert.equal(row.plan!.stop, d.plan.stop);
      assert.equal(row.plan!.tp1, d.plan.tp[0].price);
      assert.equal(row.plan!.rr, d.riesgo!.rrPonderado);
    }
  }
});
