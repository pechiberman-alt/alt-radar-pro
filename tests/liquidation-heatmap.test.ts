import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLiquidationHeatmap,
  buildVolumeProfile,
  LEVERAGE_TIERS,
} from "../lib/liquidation-heatmap.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const candle = (
  openTime: number,
  low: number,
  high: number,
  volume: number,
): SwingCandle => ({
  openTime,
  open: low,
  high,
  low,
  close: high,
  volume,
  quoteVolume: volume * ((low + high) / 2),
});

test("leverage tier weights sum to 1, so the density total isn't silently scaled", () => {
  const sum = LEVERAGE_TIERS.reduce((total, tier) => total + tier.weight, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `pesan ${sum}, deberían sumar 1`);
});

test("volume profile spreads a candle's volume across every bin it touches, not just one", () => {
  const profile = buildVolumeProfile([candle(1, 100, 103, 300)], 1);
  // Range [100,103) touches bins 100, 101, 102 — three bins, not one.
  assert.equal(profile.size, 3);
  const total = [...profile.values()].reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 300) < 1e-6, "el volumen total se conserva");
});

test("a doji or zero-volume candle is skipped, not dumped on one bin", () => {
  const profile = buildVolumeProfile([candle(1, 100, 100, 500)], 1);
  assert.equal(profile.size, 0);
});

test("heavy volume well below price produces a long-liquidation cluster below price", () => {
  const candles = Array.from({ length: 20 }, (_, i) => candle(i, 82_000, 82_100, 40));
  const heatmap = buildLiquidationHeatmap("BTCUSDT", candles, 100_000);
  assert.ok(heatmap);
  assert.ok(heatmap.topZoneBelow, "debe encontrar una zona de longs por debajo");
  assert.ok(heatmap.topZoneBelow!.price < 100_000);
  assert.ok(heatmap.topZoneBelow!.longDensity > 0);
  // Nothing was opened above price, so there is no short cluster above.
  assert.equal(heatmap.topZoneAbove, null);
});

test("heavy volume above price produces a short-liquidation cluster above price", () => {
  const candles = Array.from({ length: 20 }, (_, i) => candle(i, 118_000, 118_100, 40));
  const heatmap = buildLiquidationHeatmap("BTCUSDT", candles, 100_000);
  assert.ok(heatmap);
  assert.ok(heatmap.topZoneAbove);
  assert.ok(heatmap.topZoneAbove!.price > 100_000);
  assert.ok(heatmap.topZoneAbove!.shortDensity > 0);
});

// These three share the same ±5% offset on both sides — proven neutral
// per unit of volume, so any bias that shows up comes only from the volume
// skew, not from one side's projections spilling past the price-range bound
// (near the range edge, low-leverage projections clip asymmetrically, which
// is real model behaviour but would make these tests fragile to distance
// rather than to the thing they're meant to check: volume imbalance).

test("more volume above price than below reads as upward bias", () => {
  const candles = [
    ...Array.from({ length: 30 }, (_, i) => candle(i, 104_900, 105_000, 200)),
    ...Array.from({ length: 5 }, (_, i) => candle(200 + i, 94_900, 95_000, 30)),
  ];
  const heatmap = buildLiquidationHeatmap("BTCUSDT", candles, 100_000);
  assert.equal(heatmap?.bias, "EMPUJE FUERTE AL ALZA");
});

test("more volume below price than above reads as downward bias", () => {
  const candles = [
    ...Array.from({ length: 30 }, (_, i) => candle(i, 94_900, 95_000, 200)),
    ...Array.from({ length: 5 }, (_, i) => candle(200 + i, 104_900, 105_000, 30)),
  ];
  const heatmap = buildLiquidationHeatmap("BTCUSDT", candles, 100_000);
  assert.equal(heatmap?.bias, "EMPUJE FUERTE A LA BAJA");
});

test("equal volume at equal distance on both sides yields no clear bias", () => {
  const candles = [
    ...Array.from({ length: 15 }, (_, i) => candle(i, 94_900, 95_000, 50)),
    ...Array.from({ length: 15 }, (_, i) => candle(100 + i, 104_900, 105_000, 50)),
  ];
  const heatmap = buildLiquidationHeatmap("BTCUSDT", candles, 100_000);
  assert.equal(heatmap?.bias, "SIN SESGO CLARO");
});

test("intensity is normalised so the busiest bucket always reads 100", () => {
  const candles = Array.from({ length: 25 }, (_, i) => candle(i, 95_000, 105_000, 60));
  const heatmap = buildLiquidationHeatmap("BTCUSDT", candles, 100_000);
  assert.ok(heatmap);
  const maxIntensity = Math.max(...heatmap.buckets.map((b) => b.intensity));
  assert.ok(Math.abs(maxIntensity - 100) < 1e-6);
  for (const bucket of heatmap.buckets) {
    assert.ok(bucket.intensity >= 0 && bucket.intensity <= 100);
  }
});

test("buckets never fall outside the requested price range", () => {
  const candles = Array.from({ length: 25 }, (_, i) => candle(i, 60_000, 140_000, 80));
  const heatmap = buildLiquidationHeatmap("BTCUSDT", candles, 100_000, 0.1);
  assert.ok(heatmap);
  for (const bucket of heatmap.buckets) {
    assert.ok(bucket.price >= 90_000 && bucket.price <= 110_000);
  }
});

test("no candles or non-positive price yields nothing rather than a fabricated map", () => {
  assert.equal(buildLiquidationHeatmap("BTCUSDT", [], 100_000), null);
  assert.equal(
    buildLiquidationHeatmap("BTCUSDT", [candle(1, 90_000, 100_000, 10)], 0),
    null,
  );
});

test("the method and its assumptions are declared on every result", () => {
  const candles = Array.from({ length: 10 }, (_, i) => candle(i, 95_000, 105_000, 40));
  const heatmap = buildLiquidationHeatmap("BTCUSDT", candles, 100_000);
  assert.match(heatmap?.method ?? "", /no liquidaciones confirmadas/);
  assert.match(heatmap?.assumptions ?? "", /5x/);
});
