import assert from "node:assert/strict";
import test from "node:test";
import { aggregate } from "../lib/asset-read.ts";
import { runDesk } from "../lib/jarvis-desk.ts";
import type { DeskSnapshot } from "../lib/jarvis-desk-data.ts";
import { FEE_PCT } from "../lib/jarvis-ledger.ts";
import { auditOf, canPaper, closeManually, LIMIT_EXPIRY_H, openR, PAPER_HORIZON_H, paperCsv, paperForAi, paperFromDesk, paperSpeech, paperStats, recordFor, resolvePaper, statsBy, validatePaper, withRecord, type PaperTrade } from "../lib/jarvis-paper.ts";
import { mergeProgress, MAX_OPEN_PER_USER, openPaper, paperCounts, listPaper, ensurePaperSchema, updatePaper } from "../lib/jarvis-paper-db.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";
import { makeDb, sqlite } from "./helpers/fake-d1.ts";

const H = 3_600_000;
const T0 = Date.UTC(2026, 8, 1);

function trade(over: Partial<PaperTrade> = {}): PaperTrade {
  return {
    id: "SOLUSDT:1:LONG:M",
    symbol: "SOLUSDT",
    lado: "LONG",
    estado: "ABIERTA",
    abiertaA: T0 + H + 600_000,
    vela: T0,
    tipoEntrada: "MERCADO",
    entrada: 100,
    stop: 95,
    tp: [105, 110, 115],
    rrPlan: 2,
    confianza: 70,
    analisis: { direccionMesa: "LONG", consenso: 0.4, cobertura: 0.9, regimen: "NORMAL", sesgos: { tecnico: 0.5, estructura: 0.4, derivados: -0.2 }, motivo: "prueba", razonamiento: ["a"], fuentes: ["prueba"] },
    decision: { riesgoNivel: "BAJO", apalancamiento: 3, riesgoUsd: 10, posicionUsd: 200, stopPct: 5 },
    salidas: [],
    llenadaA: T0 + H,
    cerradaA: null,
    resultadoR: null,
    mfeR: null,
    maeR: null,
    revisadaHasta: null,
    fuenteVelas: null,
    motivoCierre: null,
    ...over,
  };
}

/** A 1 h candle `i` hours after T0. */
const c = (i: number, high: number, low: number, close = (high + low) / 2): SwingCandle => ({ openTime: T0 + i * H, open: (high + low) / 2, high, low, close, volume: 1, quoteVolume: 1 });
const fee = (entry: number, exits: [number, number][], risk: number) => ((FEE_PCT / 100) * entry + exits.reduce((p, [price, f]) => p + f * (FEE_PCT / 100) * price, 0)) / risk;
const far = T0 + 1000 * H;

test("three targets: a third at each, fees on both sides", () => {
  const t = resolvePaper(trade(), [c(1, 106, 99), c(2, 111, 104), c(3, 116, 109)], far, "Binance Futures");
  assert.equal(t.estado, "CERRADA");
  assert.deepEqual(t.salidas.map((e) => e.kind), ["TP1", "TP2", "TP3"]);
  const expected = (1 + 2 + 3) / 3 - fee(100, [[105, 1 / 3], [110, 1 / 3], [115, 1 / 3]], 5);
  assert.ok(Math.abs(t.resultadoR! - expected) < 1e-9, `${t.resultadoR} vs ${expected}`);
  assert.equal(t.fuenteVelas, "Binance Futures");
  assert.equal(t.cerradaA, T0 + 4 * H);
});

test("a candle that touches the stop and a target counts as the stop", () => {
  const t = resolvePaper(trade(), [c(1, 106, 94)], far);
  assert.equal(t.estado, "CERRADA");
  assert.deepEqual(t.salidas.map((e) => e.kind), ["STOP"]);
  assert.ok(Math.abs(t.resultadoR! - (-1 - fee(100, [[95, 1]], 5))) < 1e-9);
});

test("TP1 then the stop: a third won, two thirds lost; the stop does not move", () => {
  const t = resolvePaper(trade(), [c(1, 106, 99), c(2, 104, 94)], far);
  assert.deepEqual(t.salidas.map((e) => [e.kind, Number(e.fraction.toFixed(4))]), [["TP1", 0.3333], ["STOP", 0.6667]]);
  assert.ok(t.resultadoR! < 0);
  assert.match(t.motivoCierre!, /después de cobrar parte/);
});

test("after seven days whatever is left closes at the candle's close", () => {
  const candles = Array.from({ length: 200 }, (_, i) => c(i + 1, 104, 98, 102));
  const t = resolvePaper(trade(), candles, far);
  assert.equal(t.estado, "CERRADA");
  assert.equal(t.salidas[0].kind, "TIEMPO");
  assert.equal(t.cerradaA! - t.llenadaA!, PAPER_HORIZON_H * H);
  assert.ok(Math.abs(t.resultadoR! - (2 / 5 - fee(100, [[102, 1]], 5))) < 1e-9);
});

test("no lookahead: the candle the desk read and a candle still forming never count", () => {
  const read = c(0, 130, 50); // the entry candle itself: wild, but it is the past
  const forming = c(3, 200, 1); // not closed at `now`
  const now = T0 + 3 * H + 30 * 60_000;
  const t = resolvePaper(trade(), [read, c(1, 103, 98), c(2, 104, 99), forming], now);
  assert.equal(t.estado, "ABIERTA");
  assert.equal(t.salidas.length, 0);
  assert.equal(t.revisadaHasta, T0 + 2 * H);
  assert.ok(t.mfeR! < 1 && t.maeR! < 1);
});

test("resolving little by little gives the same as resolving at once", () => {
  const candles = [c(1, 103, 98), c(2, 106, 100), c(3, 108, 101), c(4, 111, 104), c(5, 109, 94)];
  const once = resolvePaper(trade(), candles, far);
  let step = trade();
  for (let k = 1; k <= candles.length; k += 1) step = resolvePaper(step, candles.slice(0, k), T0 + (k + 1) * H);
  assert.deepEqual(step, once);
});

test("a limit order waits to fill; on the fill candle only the stop counts", () => {
  const pending = trade({ estado: "PENDIENTE", tipoEntrada: "LÍMITE", llenadaA: null, id: "SOLUSDT:1:LONG:L" });
  const waiting = resolvePaper(pending, [c(1, 104, 101)], far);
  assert.equal(waiting.estado, "PENDIENTE");
  const filledAndTp = resolvePaper(pending, [c(1, 106, 99)], far);
  assert.equal(filledAndTp.estado, "ABIERTA", "the target on the fill candle does not count");
  assert.equal(filledAndTp.salidas.length, 0);
  assert.equal(filledAndTp.llenadaA, T0 + H);
  const stopped = resolvePaper(pending, [c(1, 103, 94)], far);
  assert.equal(stopped.estado, "CERRADA");
  assert.equal(stopped.salidas[0].kind, "STOP");
});

test("a limit order that sees TP1 first, or waits too long, is cancelled and never counted", () => {
  const pending = trade({ estado: "PENDIENTE", tipoEntrada: "LÍMITE", llenadaA: null });
  const ran = resolvePaper(pending, [c(1, 105.5, 101)], far);
  assert.equal(ran.estado, "CANCELADA");
  assert.match(ran.motivoCierre!, /TP1 sin llenar/);
  const slow = resolvePaper(pending, Array.from({ length: 60 }, (_, i) => c(i + 1, 104, 101)), far);
  assert.equal(slow.estado, "CANCELADA");
  assert.ok(slow.cerradaA! - pending.abiertaA >= LIMIT_EXPIRY_H * H);
  assert.equal(paperStats([ran, slow]).cerradas, 0);
  assert.equal(auditOf(ran).veredicto, "CANCELADA");
});

test("shorts mirror longs", () => {
  const short = trade({ lado: "SHORT", entrada: 100, stop: 105, tp: [95, 90, 85] });
  const won = resolvePaper(short, [c(1, 101, 94), c(2, 96, 89), c(3, 91, 84)], far);
  assert.deepEqual(won.salidas.map((e) => e.kind), ["TP1", "TP2", "TP3"]);
  assert.ok(won.resultadoR! > 1.9);
  const lost = resolvePaper(short, [c(1, 106, 94)], far);
  assert.equal(lost.salidas[0].kind, "STOP", "worst case first for shorts too");
});

test("manual close at the given price; a pending one is cancelled", () => {
  const half = resolvePaper(trade(), [c(1, 106, 99)], far);
  const closed = closeManually(half, 103, far);
  assert.equal(closed.estado, "CERRADA");
  assert.equal(closed.salidas.at(-1)!.kind, "MANUAL");
  assert.ok(Math.abs(closed.salidas.reduce((p, e) => p + e.fraction, 0) - 1) < 1e-9);
  assert.ok(Math.abs(openR(half, 103)! - closed.resultadoR!) < 1e-9);
  assert.equal(closeManually(trade({ estado: "PENDIENTE", llenadaA: null }), 0, far).estado, "CANCELADA");
});

test("the server never takes a result from the browser: exits at the plan's prices, result recomputed", () => {
  const done = resolvePaper(trade(), [c(1, 106, 99), c(2, 111, 104), c(3, 116, 109)], far);
  const ok = validatePaper({ ...done, resultadoR: 99 }, far)!;
  assert.ok(Math.abs(ok.resultadoR! - done.resultadoR!) < 1e-9, "inflated result ignored");
  assert.equal(validatePaper({ ...done, salidas: done.salidas.map((e, i) => (i === 0 ? { ...e, price: 106 } : e)) }, far), null, "a target exit at another price");
  assert.equal(validatePaper({ ...done, salidas: [...done.salidas, { kind: "TP3", price: 115, at: far, fraction: 0.5 }] }, far), null, "more than the whole position");
  assert.equal(validatePaper({ ...trade(), stop: 101 }, far), null, "a long's stop above the entry");
  assert.equal(validatePaper({ ...trade(), symbol: "SOL/USDT'; DROP" }, far), null);
  assert.equal(validatePaper({ ...trade(), estado: "PENDIENTE", salidas: done.salidas }, far), null, "a pending order cannot have exits");
});

test("progress only moves forward and never changes the plan", () => {
  const stored = trade();
  const progressed = resolvePaper(stored, [c(1, 106, 99)], far);
  const ok = mergeProgress(stored, progressed, far)!;
  assert.equal(ok.salidas.length, 1);
  assert.equal(mergeProgress(stored, { ...progressed, stop: 97 }, far), null, "stop moved");
  assert.equal(mergeProgress(stored, { ...progressed, tp: [104, 110, 115] }, far), null, "target moved");
  assert.equal(mergeProgress(stored, { ...progressed, confianza: 99 }, far), null, "confidence rewritten");
  const closed = resolvePaper(progressed, [c(2, 104, 94)], far);
  const after = mergeProgress(progressed, closed, far)!;
  assert.equal(after.estado, "CERRADA");
  assert.equal(mergeProgress(after, progressed, far), null, "a closed trade does not reopen");
  assert.equal(mergeProgress(progressed, { ...closed, salidas: closed.salidas.slice(1) }, far), null, "an earlier exit cannot disappear");
  assert.equal(mergeProgress(stored, { ...stored, estado: "CANCELADA" }, far), null, "an open trade cannot be cancelled to hide it");
  assert.equal(mergeProgress(stored, { ...progressed, revisadaHasta: far + 10 * H }, far), null, "no dates from the future");
});

const closedTrade = (r: "win" | "loss", confianza: number, lado: "LONG" | "SHORT" = "LONG", i = 0): PaperTrade => {
  const base = lado === "LONG" ? trade({ confianza, id: `X:${i}:${lado}:M` }) : trade({ confianza, lado, entrada: 100, stop: 105, tp: [95, 90, 85], id: `X:${i}:${lado}:M` });
  const path = lado === "LONG" ? (r === "win" ? [c(1, 106, 99), c(2, 111, 104), c(3, 116, 109)] : [c(1, 102, 94)]) : r === "win" ? [c(1, 101, 94), c(2, 96, 89), c(3, 91, 84)] : [c(1, 106, 98)];
  return resolvePaper(base, path, far);
};

test("stats with their sample; the record shown next to the score is for the same side and confluence band", () => {
  const trades = [closedTrade("win", 70, "LONG", 1), closedTrade("loss", 72, "LONG", 2), closedTrade("win", 75, "LONG", 3), closedTrade("loss", 40, "LONG", 4), closedTrade("win", 70, "SHORT", 5)];
  const st = paperStats(trades);
  assert.equal(st.cerradas, 5);
  assert.equal(st.ganadas, 3);
  assert.equal(st.muestra, "MUESTRA MÍNIMA");
  assert.ok(st.profitFactor! > 1);
  assert.ok(Math.abs(st.pnlUsd! - trades.reduce((p, t) => p + t.resultadoR! * 10, 0)) < 1e-9);
  const rec = recordFor(trades, "LONG", 68)!;
  assert.equal(rec.n, 3, "only LONG trades with confluence 65–79");
  assert.equal(rec.ganadas, 2);
  assert.match(rec.etiqueta, /muestra mínima/);
  assert.equal(recordFor(trades, "SHORT", 90), null, "no closed SHORT at 80–100: nothing to show");
  const groups = statsBy(trades);
  assert.ok(groups.some((g) => g.grupo === "Confluencia 65–79" && g.stats.cerradas === 4), "both sides in a confluence band");
  assert.ok(groups.some((g) => g.grupo === "Con técnico a favor"));
  assert.match(paperSpeech(trades), /muestra mínima/);
  assert.match(paperSpeech(trades), /Simulado, sin plata real/);
  assert.match(paperSpeech([]), /Todavía no hay operaciones de papel/);
  assert.match(paperSpeech([closedTrade("win", 70, "LONG", 9)]), /1 cerrada, 1 ganada y 0 perdidas/);
  assert.match(recordFor([closedTrade("win", 70, "LONG", 9)], "LONG", 70)!.etiqueta, /1 operación de papel parecida \(LONG, confluencia 65–79\): 1 ganada \(100%\)/);
  assert.equal(paperForAi(trades)!.simulado, true);
  assert.match(paperCsv(trades).split("\r\n")[0], /resultado_R/);
});

test("the audit chain: analysis, decision, result, right or wrong, and a measured lesson that changes no rule", () => {
  const lost = resolvePaper(trade(), [c(1, 104.9, 99), c(2, 106.2, 101), c(3, 104, 94)], far);
  const a = auditOf(lost);
  assert.equal(a.veredicto, "ERROR");
  assert.match(a.analisis, /A favor: técnico, estructura\. En contra: derivados/);
  assert.match(a.decision, /LONG a mercado en 100/);
  assert.match(a.resultado, /Resultado −?-?/);
  assert.match(a.detalle, /Acertaron: derivados\. Erraron: técnico, estructura/);
  assert.match(a.aprendizaje, /las reglas de la mesa no cambian solas/);
  const won = auditOf(closedTrade("win", 70));
  assert.equal(won.veredicto, "ACIERTO");
  assert.match(won.detalle, /Acertaron: técnico, estructura/);
  assert.equal(auditOf(trade()).veredicto, "ABIERTA");
});

// ── With the real desk ──

const path = (f: (i: number) => number, n: number): SwingCandle[] =>
  Array.from({ length: n }, (_, i) => {
    const o = f(i);
    const cl = f(i + 1);
    return { openTime: T0 + i * H, open: o, high: Math.max(o, cl) * 1.003, low: Math.min(o, cl) * 0.997, close: cl, volume: 100 + (i % 9) * 10, quoteVolume: (100 + (i % 9) * 10) * cl };
  });

function snapshot(h1: SwingCandle[]): DeskSnapshot {
  return {
    symbol: "SOLUSDT",
    now: h1[h1.length - 1].openTime + H + 1000,
    candles: { h1, h4: aggregate(h1, 4), d1: aggregate(h1, 24) },
    btc: path((i) => 60_000 * 1.0004 ** i + 300 * Math.sin(i / 7), h1.length),
    eth: path((i) => 3_000 * 1.0005 ** i + 20 * Math.sin(i / 5), h1.length),
    derivatives: null,
    macro: { btcDominance: null, usdtDominance: null, marketCapChange24h: null, events: null, calendarSource: null },
    news: null,
    fearGreed: null,
    sources: ["prueba"],
  };
}

test("following the desk: only an approved plan, frozen with its analysis; the record never changes the plan", () => {
  const d = runDesk(snapshot(path((i) => 100 * 1.0015 ** i + 2 * Math.sin(i / 6), 1000)))!;
  const now = d.generadoA;
  if (canPaper(d)) {
    const t = paperFromDesk(d, now)!;
    assert.equal(t.entrada, d.plan!.entrada);
    assert.equal(t.stop, d.plan!.stop);
    assert.deepEqual(t.tp, d.plan!.tp.map((x) => x.price));
    assert.equal(t.vela, d.vela);
    assert.equal(t.confianza, d.puntaje);
    assert.equal(t.estado, d.plan!.tipoEntrada === "LÍMITE" ? "PENDIENTE" : "ABIERTA");
    assert.ok(validatePaper(t, now), "what the browser builds, the server accepts");
  }
  const vetoed = { ...d, direccion: "NO TRADE" as const, riesgo: d.riesgo ? { ...d.riesgo, vetos: ["prueba"] } : null };
  assert.equal(canPaper(vetoed), false);
  assert.equal(paperFromDesk(vetoed, now), null);
  const side = d.plan?.lado ?? "LONG";
  const history = [closedTrade("win", d.puntaje, side, 1), closedTrade("loss", d.puntaje, side, 2)];
  const withHist = withRecord(d, history);
  assert.deepEqual(withHist.plan, d.plan, "the measured record is shown, the plan stays");
  assert.equal(withHist.direccion, d.direccion);
  if (d.plan) assert.equal(withHist.historial!.n, 2);
});

// ── Stored per account (D1) ──

test("per account: open once, at most 20 open, progress forward, counters without COUNT(*)", { skip: !sqlite }, async () => {
  const db = makeDb();
  await ensurePaperSchema(db);
  const now = T0 + 2 * H;
  const t = trade({ abiertaA: now });
  const opened = await openPaper(db, 7, t, now);
  assert.ok(opened.ok);
  assert.equal((await openPaper(db, 7, t, now)).ok, false, "the same plan twice");
  assert.deepEqual(await paperCounts(db, 7), { total: 1, abiertas: 1 });
  assert.equal((await openPaper(db, 7, trade({ id: "B:1", vela: T0 - 10 * H }), now)).ok, false, "a stale plan");
  for (let i = 0; i < MAX_OPEN_PER_USER - 1; i += 1) assert.ok((await openPaper(db, 7, trade({ id: `S:${i}` }), now)).ok);
  const full = await openPaper(db, 7, trade({ id: "S:extra" }), now);
  assert.equal(full.ok, false);
  if (!full.ok) assert.match(full.error, /20 operaciones de papel abiertas/);
  const later = T0 + 10 * H;
  const closed = resolvePaper(trade({ abiertaA: now }), [c(1, 106, 99), c(2, 111, 104), c(3, 116, 109)], later);
  const r = await updatePaper(db, 7, [{ ...closed, resultadoR: 50 }, { ...closed, id: "S:0", stop: 1 }], later);
  assert.equal(r.saved.length, 1);
  assert.deepEqual(r.rejected, ["S:0"]);
  assert.ok(r.saved[0].resultadoR! < 2.1, "recomputed, not the 50 sent");
  assert.deepEqual(await paperCounts(db, 7), { total: 20, abiertas: 19 });
  assert.equal((await updatePaper(db, 7, [closed], later)).saved.length, 0, "a closed trade is final");
  assert.equal((await updatePaper(db, 8, [closed], later)).saved.length, 0, "another account cannot touch it");
  const list = await listPaper(db, 7);
  assert.equal(list.length, 20);
  assert.equal(list.find((x) => x.id === t.id)!.estado, "CERRADA");
  assert.equal((await listPaper(db, 8)).length, 0);
});
