import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzePump,
  parsePumpKlines,
  screenPumpCandidates,
  type PumpCandle,
} from "../lib/pump-radar.ts";
import type { MarketAsset } from "../lib/radar.ts";

const asset = (patch: Partial<MarketAsset> & { symbol: string }): MarketAsset => ({
  price: 1,
  change1h: 0,
  change4h: 0,
  change24h: 0,
  volume: 1_000,
  quoteVolume: 20_000_000,
  high: 1.1,
  low: 0.9,
  change5m: 0,
  change15m: 0,
  ...patch,
});

/** Builds a calm baseline the analyser can measure a disturbance against. */
function baseline(count = 40, close = 100, quoteVolume = 100_000): PumpCandle[] {
  return Array.from({ length: count }, (_, i) => ({
    openTime: i * 300_000,
    open: close,
    high: close * 1.001,
    low: close * 0.999,
    close,
    volume: quoteVolume / close,
    quoteVolume,
    trades: 100,
  }));
}

const candle = (patch: Partial<PumpCandle> & { close: number }): PumpCandle => ({
  openTime: 0,
  open: patch.close,
  high: patch.close,
  low: patch.close,
  volume: 1_000,
  quoteVolume: 100_000,
  trades: 100,
  ...patch,
});

test("screener ignores assets without a 5m window", () => {
  const candidates = screenPumpCandidates([
    asset({ symbol: "AUSDT", change5m: null }),
    asset({ symbol: "BUSDT", change5m: undefined }),
  ]);
  assert.deepEqual(candidates, []);
});

test("screener enforces the liquidity floor", () => {
  const candidates = screenPumpCandidates(
    [asset({ symbol: "TINYUSDT", change5m: 5, change15m: 3, quoteVolume: 100_000 })],
    { minimumQuoteVolume: 3_000_000 },
  );
  assert.deepEqual(candidates, [], "un activo ilíquido no debe preseleccionarse");
});

test("screener rewards acceleration over a slow grind", () => {
  const accelerating = asset({ symbol: "FASTUSDT", change5m: 4, change15m: 4.5 });
  const grinding = asset({ symbol: "SLOWUSDT", change5m: 0.4, change15m: 6 });
  const candidates = screenPumpCandidates([grinding, accelerating]);
  assert.equal(candidates[0]?.asset.symbol, "FASTUSDT", "el que acelera debe ir primero");
});

test("screener ignores assets falling", () => {
  const candidates = screenPumpCandidates([
    asset({ symbol: "DOWNUSDT", change5m: -6, change15m: -9 }),
  ]);
  assert.deepEqual(candidates, []);
});

test("screener respects the result limit", () => {
  const market = Array.from({ length: 30 }, (_, i) =>
    asset({ symbol: `A${i}USDT`, change5m: 3 + i * 0.1, change15m: 2 }),
  );
  assert.equal(screenPumpCandidates(market, { limit: 5 }).length, 5);
});

test("analyser needs a real sample before reporting", () => {
  assert.equal(analyzePump(asset({ symbol: "AUSDT" }), []), null);
  assert.equal(analyzePump(asset({ symbol: "AUSDT" }), baseline(10)), null);
});

/**
 * The in-flight candle is excluded from every statistic; otherwise the reading
 * would change as the candle forms and could not be reproduced later.
 */
test("the forming candle is excluded from the sample", () => {
  const candles = baseline(40);
  const withForming = [...candles, candle({ close: 999, quoteVolume: 99_000_000 })];
  const reading = analyzePump(asset({ symbol: "AUSDT" }), withForming);
  assert.ok(reading);
  // 41 candles in, the last one still forming, so 40 are measured.
  assert.equal(reading.sampleSize, candles.length);
  // The absurd forming candle must not distort relative volume.
  assert.ok(
    reading.metrics.relativeVolume < 2,
    `la vela en curso contaminó la métrica: ${reading.metrics.relativeVolume}`,
  );
});

test("a calm market produces no pump", () => {
  const candles = [...baseline(40), candle({ close: 100 })];
  const reading = analyzePump(asset({ symbol: "AUSDT" }), candles);
  assert.ok(reading);
  assert.equal(reading.stage, "SIN PUMP");
  assert.ok(reading.score < 45);
});

test("volume and range firing on a short run reads as ignition", () => {
  const candles = baseline(40);
  candles.push(
    candle({
      close: 102,
      open: 100,
      high: 102.2,
      low: 99.9,
      quoteVolume: 900_000,
      trades: 900,
    }),
  );
  candles.push(candle({ close: 102 })); // forming, ignored
  const reading = analyzePump(asset({ symbol: "AUSDT" }), candles);
  assert.ok(reading);
  assert.equal(reading.stage, "IGNICIÓN");
  assert.ok(reading.metrics.relativeVolume >= 3);
  assert.ok(reading.reasons.length > 0, "debe explicar por qué");
});

test("a vertical run with sellers into it reads as climax", () => {
  const candles = baseline(40);
  // Long ramp so the run from base is large.
  for (let i = 1; i <= 12; i += 1) {
    const close = 100 + i * 3;
    candles.push(
      candle({ close, open: close - 3, high: close + 0.5, low: close - 3, quoteVolume: 400_000 }),
    );
  }
  // Final candle: heavy volume, dominant upper wick.
  candles.push(
    candle({
      close: 137,
      open: 136,
      high: 145,
      low: 135.5,
      quoteVolume: 2_000_000,
      trades: 2_500,
    }),
  );
  candles.push(candle({ close: 137 }));
  const reading = analyzePump(asset({ symbol: "AUSDT" }), candles);
  assert.ok(reading);
  assert.ok(
    reading.stage === "CLÍMAX" || reading.stage === "DISTRIBUCIÓN",
    `esperaba fase tardía, obtuve ${reading.stage}`,
  );
  assert.ok(
    reading.warnings.length > 0,
    "una fase tardía siempre debe advertir",
  );
});

test("rolling over after a run reads as distribution", () => {
  const candles = baseline(40);
  for (let i = 1; i <= 10; i += 1) {
    const close = 100 + i * 2;
    candles.push(candle({ close, open: close - 2, high: close, low: close - 2, quoteVolume: 400_000 }));
  }
  // Price falls back from the high on sustained volume.
  candles.push(candle({ close: 112, open: 120, high: 120, low: 111, quoteVolume: 500_000 }));
  candles.push(candle({ close: 112 }));
  const reading = analyzePump(asset({ symbol: "AUSDT" }), candles);
  assert.ok(reading);
  assert.equal(reading.stage, "DISTRIBUCIÓN");
  assert.ok(reading.metrics.drawdownFromHigh >= 5);
});

test("low liquidity always carries a warning", () => {
  const candles = [...baseline(40), candle({ close: 100 })];
  const reading = analyzePump(
    asset({ symbol: "TINYUSDT", quoteVolume: 2_000_000 }),
    candles,
  );
  assert.ok(reading);
  assert.ok(reading.warnings.some((warning) => warning.includes("Liquidez baja")));
});

test("score stays inside 0..100 and metrics stay finite", () => {
  const candles = baseline(40, 100, 1);
  candles.push(
    candle({ close: 500, open: 100, high: 900, low: 90, quoteVolume: 9e12, trades: 9e6 }),
  );
  candles.push(candle({ close: 500 }));
  const reading = analyzePump(asset({ symbol: "AUSDT" }), candles);
  assert.ok(reading);
  assert.ok(reading.score >= 0 && reading.score <= 100, `score ${reading.score}`);
  for (const [key, value] of Object.entries(reading.metrics)) {
    assert.ok(Number.isFinite(value), `métrica ${key} no finita: ${value}`);
  }
});

test("zero-volume history does not produce infinities", () => {
  const candles = baseline(40, 100, 0);
  candles.push(candle({ close: 105, quoteVolume: 50_000 }));
  candles.push(candle({ close: 105 }));
  const reading = analyzePump(asset({ symbol: "AUSDT" }), candles);
  assert.ok(reading);
  for (const [key, value] of Object.entries(reading.metrics)) {
    assert.ok(Number.isFinite(value), `métrica ${key} no finita: ${value}`);
  }
});

test("kline parser drops malformed rows", () => {
  const parsed = parsePumpKlines([
    [1, "100", "101", "99", "100.5", "10", 2, "1000", 50],
    [2, "bad", "x", "y", "z", "1", 3, "5", 1],
    "not an array",
    [3, "100", "101", "99", "0", "10", 4, "1000", 50],
    null,
  ]);
  assert.equal(parsed.length, 1, "sólo la fila válida debe sobrevivir");
  assert.equal(parsed[0].close, 100.5);
  assert.equal(parsed[0].quoteVolume, 1000);
});

test("kline parser tolerates non-array input", () => {
  assert.deepEqual(parsePumpKlines(null), []);
  assert.deepEqual(parsePumpKlines({}), []);
  assert.deepEqual(parsePumpKlines(undefined), []);
});
