import assert from "node:assert/strict";
import test from "node:test";
import { aggregate } from "../lib/asset-read.ts";
import { backtestMetrics, backtestRecord, backtestSpeech, backtestSteps, finishBacktest, runBacktest, snapshotAt, startBacktest, stepBacktest, type BacktestInput } from "../lib/jarvis-backtest.ts";
import type { PaperTrade } from "../lib/jarvis-paper.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const H = 3_600_000;
const T0 = Date.UTC(2026, 0, 1);

const path = (f: (i: number) => number, n: number): SwingCandle[] =>
  Array.from({ length: n }, (_, i) => {
    const o = f(i);
    const c = f(i + 1);
    return { openTime: T0 + i * H, open: o, high: Math.max(o, c) * 1.004, low: Math.min(o, c) * 0.996, close: c, volume: 100 + (i % 9) * 10, quoteVolume: (100 + (i % 9) * 10) * c };
  });

const wave = (i: number) => 100 * 1.0003 ** i + 6 * Math.sin(i / 37) + 2 * Math.sin(i / 5.3);
const DAYS = 60;

function input(h1: SwingCandle[], over: Partial<BacktestInput> = {}): BacktestInput {
  return {
    symbol: "SOLUSDT",
    h1,
    h4: aggregate(h1, 4),
    d1: aggregate(h1, 24),
    btc: path((i) => 60_000 * 1.0002 ** i + 500 * Math.sin(i / 29), h1.length),
    eth: null,
    from: T0 + 1000 * H,
    to: T0 + (h1.length - 1) * H,
    fuente: "sintético",
    ...over,
  };
}

const base = path(wave, 1000 + DAYS * 24);
const full = runBacktest(input(base));

test("the backtest trades with the desk and the paper rules, one trade at a time", () => {
  assert.ok(full.trades.length >= 3, `${full.trades.length} trades`);
  for (let i = 1; i < full.trades.length; i += 1) {
    const prev = full.trades[i - 1];
    assert.ok(full.trades[i].abiertaA >= prev.cerradaA!, "a new trade only after the previous one closed");
  }
  for (const t of full.trades) {
    assert.ok(t.abiertaA >= input(base).from && t.abiertaA <= input(base).to + 2000, "inside the window");
    if (t.estado === "CERRADA") assert.ok(Math.abs(t.salidas.reduce((p, e) => p + e.fraction, 0) - 1) < 1e-9);
  }
  assert.equal(full.metricas.operaciones, full.trades.filter((t) => t.estado === "CERRADA").length);
  assert.equal(full.abiertasAlFinal, full.trades.filter((t) => t.estado === "ABIERTA" || t.estado === "PENDIENTE").length);
  assert.ok(full.lecturas.evaluadas >= full.lecturas.long + full.lecturas.short);
});

test("no lookahead: changing the future after a moment never changes the trades that closed before it", () => {
  const cut = T0 + (1000 + 35 * 24) * H;
  const altered = base.map((c) => (c.openTime >= cut ? { ...c, open: c.open * 3, high: c.high * 3.2, low: c.low * 0.2, close: c.close * 0.4 } : c));
  const other = runBacktest(input(altered));
  const before = (r: typeof full) => r.trades.filter((t) => t.cerradaA !== null && t.cerradaA <= cut);
  assert.ok(before(full).length >= 1, "something closed before the cut");
  assert.deepEqual(before(other), before(full));
});

test("the desk at a past hour only sees candles closed at that hour, and no history it cannot have", () => {
  const now = T0 + 1500 * H + 30 * 60_000;
  const s = snapshotAt(input(base), now);
  assert.ok(s.candles.h1.every((c) => c.openTime + H <= now));
  assert.equal(s.candles.h1.length, 1000);
  assert.ok(s.candles.h4!.every((c) => c.openTime + 4 * H <= now));
  assert.ok(s.candles.d1!.every((c) => c.openTime + 24 * H <= now));
  assert.equal(s.derivatives, null);
  assert.equal(s.news, null);
  assert.equal(s.fearGreed, null);
  assert.equal(s.macro.events, null);
});

test("stepping in small pieces gives exactly the same as running it at once", () => {
  const inp = input(base);
  let s = startBacktest(inp);
  let rounds = 0;
  while (!s.done) {
    s = stepBacktest(inp, s, 7);
    rounds += 1;
  }
  assert.ok(rounds > 3);
  assert.deepEqual(finishBacktest(inp, s), full);
  assert.equal(backtestSteps(inp), Math.floor((inp.to - Math.ceil(inp.from / (4 * H)) * 4 * H) / (4 * H)) + 1);
});

const closed = (r: number, i: number): PaperTrade => ({ estado: "CERRADA", resultadoR: r, cerradaA: T0 + i * H, llenadaA: T0 + (i - 1) * H, rrPlan: 2, decision: { riesgoUsd: null }, salidas: [] }) as unknown as PaperTrade;

test("metrics: profit factor, expectancy, the worst drawdown of the R curve, and money only with capital", () => {
  const trades = [closed(2, 1), closed(-1, 2), closed(-1, 3), closed(3, 4), closed(-1, 5)];
  const { metricas: m, equity } = backtestMetrics(trades, { capital: 1000, riesgoPct: 1, apalancamientoMax: 10 });
  assert.equal(m.operaciones, 5);
  assert.equal(m.ganadas, 2);
  assert.ok(Math.abs(m.profitFactor! - 5 / 3) < 1e-9);
  assert.ok(Math.abs(m.expectativaR! - 0.4) < 1e-9);
  assert.equal(m.totalR, 2);
  assert.equal(m.maxDrawdownR, 2, "from +2 down to 0");
  assert.equal(m.pnlUsd, 20, "2 R at 1% of 1000");
  assert.equal(m.maxDrawdownUsd, 20);
  assert.equal(m.maxDrawdownPct, 2);
  assert.equal(m.rrPromedio, 2);
  assert.equal(m.mejorR, 3);
  assert.equal(m.peorR, -1);
  assert.equal(m.muestra, "MUESTRA MÍNIMA");
  assert.deepEqual(equity.map((e) => e.r), [2, 1, 0, 3, 2]);
  assert.equal(backtestMetrics(trades).metricas.pnlUsd, null, "no capital: no money invented");
});

test("what it says: sample size, no guarantee, and nothing when there are no trades", () => {
  assert.match(backtestSpeech(full), /no garantizan rentabilidad futura/);
  assert.match(backtestSpeech(full), /misma mesa y las reglas del papel/);
  const empty = runBacktest(input(path(wave, 1000 + 2 * 24), { from: T0 + 1000 * H }));
  if (!empty.metricas.operaciones) assert.match(backtestSpeech(empty), /no hay resultados para medir/);
  const tooShort = runBacktest(input(path(wave, 150), { from: T0 + 10 * H }));
  assert.equal(tooShort.metricas.operaciones, 0, "without enough candles the desk does not trade");
  assert.ok(tooShort.lecturas.sinDatos > 0);
  const side = full.trades[0].lado;
  const rec = backtestRecord(full, side, full.trades[0].confianza);
  if (rec) assert.match(rec.etiqueta, /del backtest/);
});
