import assert from "node:assert/strict";
import test from "node:test";
import { aggregate } from "../lib/asset-read.ts";
import { analysisForAi, analysisText, analyzeAsset } from "../lib/jarvis-analyst.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";
import { setupAt } from "./helpers/setups.ts";

const H = 3_600_000;
/** 1h candles from a price path. */
const path = (f: (i: number) => number, n: number, t0 = Date.UTC(2026, 6, 1)): SwingCandle[] =>
  Array.from({ length: n }, (_, i) => {
    const o = f(i);
    const c = f(i + 1);
    return { openTime: t0 + i * H, open: o, high: Math.max(o, c) * 1.003, low: Math.min(o, c) * 0.997, close: c, volume: 100 + (i % 9) * 10, quoteVolume: 100 * c };
  });

test("the analyst never reads a candle still forming, on any timeframe (no lookahead)", () => {
  const h1 = path((i) => 100 * 1.0015 ** i + 3 * Math.sin(i / 9), 1000);
  const lastOpen = h1[h1.length - 1].openTime;
  const now = lastOpen + H + 1000;
  const h4 = aggregate(h1, 4);
  const d1 = aggregate(h1, 24);
  const a = analyzeAsset("SOLUSDT", { h1, h4, d1 }, now)!;
  // A wild candle still forming on each timeframe changes nothing.
  const wild = (t: number): SwingCandle => ({ openTime: t, open: 1, high: 9_999, low: 0.01, close: 9_000, volume: 1e12, quoteVolume: 1e12 });
  const b = analyzeAsset("SOLUSDT", { h1: [...h1, wild(lastOpen + H)], h4: [...h4, wild(h4[h4.length - 1].openTime + 4 * H)], d1: [...d1, wild(d1[d1.length - 1].openTime + 24 * H)] }, now)!;
  assert.deepEqual(b, a);
  assert.equal(a.read.at, lastOpen);
});

test("a steady advance reads alcista on every timeframe, with the evidence listed and both scenarios", () => {
  const h1 = path((i) => 100 * 1.002 ** i + 2 * Math.sin(i / 6), 1000);
  const now = h1[h1.length - 1].openTime + H + 1;
  const a = analyzeAsset("ETHUSDT", { h1 }, now)!;
  assert.deepEqual(a.tfs.map((t) => [t.tf, t.trend]), [["1h", "ALCISTA"], ["4h", "ALCISTA"], ["1d", "ALCISTA"]]);
  assert.equal(a.score.label, "ALCISTA");
  assert.ok(a.score.parts.some((p) => p.label === "tendencia 1d alcista" && p.points === 25));
  assert.equal(a.score.value, Math.max(-100, Math.min(100, a.score.parts.reduce((s, p) => s + p.points, 0))), "the score is exactly the sum of what it lists");
  assert.ok(a.levels.supports.every((l) => l.price < a.read.price) && a.levels.resistances.every((l) => l.price > a.read.price));
  const t = analysisText(a);
  assert.match(t, /^ETH · /);
  assert.match(t, /Lectura técnica: alcista \(\+\d+ de ±100\)/);
  assert.match(t, /Es un resumen de la lectura, no una probabilidad\./);
  assert.match(t, /Tendencia: 1h alcista \(RSI \d+\) · 4h alcista/);
  assert.match(t, /no es asesoramiento financiero\.$/);
  const ai = analysisForAi(a);
  assert.equal(ai.moneda, "ETHUSDT");
  assert.equal(ai.puntajeTecnico.lectura, "ALCISTA");
});

test("a coil under a level is reported as about to break, and too little history gives no analysis", () => {
  const h1 = setupAt(1000, 999);
  const a = analyzeAsset("BTCUSDT", { h1 }, h1[999].openTime + H + 1)!;
  assert.equal(a.read.preBreak?.state, "A PUNTO");
  assert.ok(a.score.parts.some((p) => p.label.startsWith("a punto de romper en 1h hacia arriba")));
  assert.match(analysisText(a), /a punto de romper en 1h hacia arriba/);
  assert.equal(analyzeAsset("BTCUSDT", { h1: h1.slice(0, 40) }, h1[999].openTime + H + 1), null);
});
