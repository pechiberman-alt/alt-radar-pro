import assert from "node:assert/strict";
import test from "node:test";
import { adjustStopForLiquidity } from "../lib/swing-liquidity-filter.ts";
import type { LiquidationHeatmap } from "../lib/liquidation-heatmap.ts";
import type { SwingSetup } from "../lib/swing-entries.ts";

const setup = (patch: Partial<SwingSetup> = {}): SwingSetup => ({
  symbol: "BTCUSDT",
  side: "LONG",
  score: 70,
  quality: "SETUP",
  entryLow: 99_900,
  entryHigh: 100_100,
  stop: 98_000,
  targets: [106_000],
  riskRewardFirst: 3,
  riskPct: 2,
  retracement: 0.5,
  trend: "ALCISTA",
  reasons: [],
  warnings: [],
  invalidation: "",
  ...patch,
});

const mapWith = (zones: { price: number; intensity: number }[]): LiquidationHeatmap =>
  ({
    symbol: "BTCUSDT",
    currentPrice: 100_000,
    binSize: 10,
    profileCandles: 500,
    halfLifeCandles: 48,
    totalOpenInterestUsd: 1e10,
    oiWeightedCandles: 500,
    buckets: zones.map((zone) => ({
      price: zone.price,
      longDensity: 1,
      shortDensity: 0,
      intensity: zone.intensity,
      notionalUsd: 1e7,
      formedAt: 0,
    })),
    topZoneAbove: null,
    topZoneBelow: null,
    bias: "SIN SESGO CLARO",
    biasNote: "",
    method: "",
    assumptions: "",
  }) as LiquidationHeatmap;

test("a stop sitting inside a dense zone is moved beyond it", () => {
  // Cluster at 98,500; the stop at 98,000 is right in its path.
  const result = adjustStopForLiquidity(setup(), mapWith([{ price: 98_500, intensity: 90 }]));
  assert.equal(result.moved, true);
  assert.equal(result.rejected, false);
  assert.ok(result.setup.stop < 98_500, "el stop queda del otro lado del cluster");
  assert.ok(result.setup.riskPct > 2, "alejar el stop cuesta riesgo, y ese costo se refleja");
  assert.ok(result.setup.riskRewardFirst < 3, "y el R:R baja en consecuencia");
  assert.match(result.setup.warnings.join(" "), /ajustá el tamaño/);
});

test("a stop already clear of the liquidity is left exactly where it was", () => {
  // Cluster at 99,000; the stop at 98,000 is already below it.
  const result = adjustStopForLiquidity(setup(), mapWith([{ price: 99_000, intensity: 90 }]));
  assert.equal(result.moved, false);
  assert.equal(result.setup.stop, 98_000);
  assert.equal(result.setup.riskRewardFirst, 3, "no se ensancha el stop por las dudas");
});

test("faint zones do not justify widening risk", () => {
  const result = adjustStopForLiquidity(setup(), mapWith([{ price: 98_500, intensity: 10 }]));
  assert.equal(result.moved, false);
  assert.equal(result.setup.stop, 98_000);
});

test("when clearing the zone ruins the risk-reward, the setup is rejected", () => {
  // Target close by, so any widening breaks the floor.
  const tight = setup({ targets: [101_000], riskRewardFirst: 0.5 });
  const result = adjustStopForLiquidity(tight, mapWith([{ price: 98_500, intensity: 90 }]));
  assert.equal(result.rejected, true);
  assert.equal(result.moved, false);
  assert.match(result.note, /se descarta en vez de tomarse con peores números/);
});

test("a short mirrors the logic upward", () => {
  const short = setup({
    side: "SHORT",
    stop: 102_000,
    targets: [94_000],
    trend: "BAJISTA",
  });
  const result = adjustStopForLiquidity(short, mapWith([{ price: 101_500, intensity: 90 }]));
  assert.equal(result.moved, true);
  assert.ok(result.setup.stop > 101_500, "para un corto el stop va por encima del cluster");
});

test("no map means the structural stop stands", () => {
  const result = adjustStopForLiquidity(setup(), null);
  assert.equal(result.moved, false);
  assert.equal(result.setup.stop, 98_000);
  assert.match(result.note, /queda donde lo puso la estructura/);
});

test("zones beyond the stop's reach are not treated as hazards", () => {
  // Far below the stop: price would have to blow through the trade entirely.
  const result = adjustStopForLiquidity(setup(), mapWith([{ price: 80_000, intensity: 95 }]));
  assert.equal(result.moved, false);
});

test("the original numbers are preserved for comparison", () => {
  const result = adjustStopForLiquidity(setup(), mapWith([{ price: 98_500, intensity: 90 }]));
  assert.equal(result.originalStop, 98_000);
  assert.equal(result.originalRiskReward, 3);
  assert.notEqual(result.setup.stop, result.originalStop);
});
