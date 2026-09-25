import assert from "node:assert/strict";
import test from "node:test";
import { divergenceStats, ema, findDivergences, macd, oscillatorState, rsi } from "../lib/oscillators.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const c = (i: number, close: number, spread = 1): SwingCandle => ({
  openTime: i * 3_600_000, open: close, close, high: close + spread, low: close - spread, volume: 100, quoteVolume: 0,
});

test("RSI is 100 on a series that only rises and ~50 on alternating moves", () => {
  const up = Array.from({ length: 40 }, (_, i) => 100 + i);
  assert.equal(rsi(up).at(-1), 100);
  const alt = Array.from({ length: 200 }, (_, i) => 100 + (i % 2 ? 1 : -1));
  assert.ok(Math.abs((rsi(alt).at(-1) ?? 0) - 50) < 5);
  assert.equal(rsi(up)[5], null, "sin datos suficientes no hay valor");
});

test("EMA seeds with the simple average, then smooths", () => {
  const e = ema([1, 2, 3, 4, 5, 6], 3);
  assert.equal(e[1], null);
  assert.equal(e[2], 2);
  assert.ok(Math.abs((e[3] ?? 0) - 3) < 1e-9);
});

test("MACD is positive in an uptrend and the histogram is line minus signal", () => {
  const up = Array.from({ length: 80 }, (_, i) => 100 + i * 0.5);
  const m = macd(up);
  assert.ok((m.macd.at(-1) ?? 0) > 0);
  const i = 79;
  assert.ok(Math.abs((m.hist[i] ?? 0) - ((m.macd[i] ?? 0) - (m.signal[i] ?? 0))) < 1e-12);
});

/** Two lows: the second lower in price; an oscillator series is supplied directly. */
function twoLows(secondLowPrice: number) {
  const out: SwingCandle[] = [];
  for (let i = 0; i < 20; i += 1) out.push(c(i, 110));
  const prices = [108, 105, 100, 105, 108, 110, 110, 110, 108, 105, secondLowPrice, 105, 108];
  prices.forEach((p, k) => out.push(c(20 + k, p)));
  for (let i = 0; i < 10; i += 1) out.push(c(33 + i, 110));
  return out;
}

test("lower low in price with a higher oscillator low is a regular bullish divergence", () => {
  const candles = twoLows(97);
  const osc = candles.map(() => 50 as number | null);
  osc[22] = 25;
  osc[30] = 35;
  const d = findDivergences(candles, osc, "RSI", { minOscDelta: 2 });
  assert.ok(d.some((x) => x.kind === "REGULAR" && x.side === "ALCISTA"), JSON.stringify(d));
});

test("higher low in price with a lower oscillator low is a hidden bullish divergence", () => {
  const candles = twoLows(103);
  const osc = candles.map(() => 50 as number | null);
  osc[22] = 35;
  osc[30] = 25;
  const d = findDivergences(candles, osc, "RSI", { minOscDelta: 2 });
  assert.ok(d.some((x) => x.kind === "OCULTA" && x.side === "ALCISTA"), JSON.stringify(d));
});

test("agreement between price and oscillator is not a divergence", () => {
  const candles = twoLows(97);
  const osc = candles.map(() => 50 as number | null);
  osc[22] = 35;
  osc[30] = 25;
  assert.deepEqual(findDivergences(candles, osc, "RSI", { minOscDelta: 2 }), []);
});

test("tiny oscillator differences are filtered out", () => {
  const candles = twoLows(97);
  const osc = candles.map(() => 50 as number | null);
  osc[22] = 30;
  osc[30] = 31;
  assert.deepEqual(findDivergences(candles, osc, "RSI", { minOscDelta: 2 }), []);
});

test("mirror: higher high with lower oscillator high is regular bearish", () => {
  const up = twoLows(97).map((x) => ({ ...x, open: 220 - x.open, close: 220 - x.close, high: 220 - x.low, low: 220 - x.high }));
  const osc = up.map(() => 50 as number | null);
  osc[22] = 75;
  osc[30] = 65;
  const d = findDivergences(up, osc, "RSI", { minOscDelta: 2 });
  assert.ok(d.some((x) => x.kind === "REGULAR" && x.side === "BAJISTA"), JSON.stringify(d));
});

test("divergence stats count only resolved cases and carry the sample", () => {
  const candles = twoLows(97);
  for (let i = 0; i < 20; i += 1) candles.push(c(43 + i, 110 + i * 3, 1));
  const osc = candles.map(() => 50 as number | null);
  osc[22] = 25;
  osc[30] = 35;
  const d = findDivergences(candles, osc, "RSI", { minOscDelta: 2 });
  const s = divergenceStats(candles, d);
  assert.ok(s.tested >= 1);
  assert.equal(s.confidence, "MUESTRA MÍNIMA");
  assert.ok(s.rate !== null);
});

test("oscillator state reads zone, cross and recent divergences without crashing on short data", () => {
  // Accelerating rise: MACD keeps climbing above its signal. (A perfectly
  // linear rise makes MACD converge to a constant from above, which legitimately
  // leaves it a hair under the signal — not what this test is about.)
  const up = Array.from({ length: 120 }, (_, i) => c(i, 100 * 1.01 ** i));
  const st = oscillatorState(up);
  assert.equal(st.rsiZone, "SOBRECOMPRA");
  assert.equal(st.macdCross, "ALCISTA");
  const short = oscillatorState(Array.from({ length: 10 }, (_, i) => c(i, 100)));
  assert.equal(short.rsi, null);
});
