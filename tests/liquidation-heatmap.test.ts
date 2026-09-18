import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLiquidationHeatmap,
  buildVolumeProfile,
  DEFAULT_LEVERAGE_TIERS,
  leverageTiersFor,
  MAJOR_LEVERAGE_TIERS,
  maintenanceMarginRateFor,
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

test("every leverage distribution sums to 1, so density totals aren't silently scaled", () => {
  for (const [name, tiers] of [
    ["MAJOR", MAJOR_LEVERAGE_TIERS],
    ["DEFAULT", DEFAULT_LEVERAGE_TIERS],
  ] as const) {
    const sum = tiers.reduce((total, tier) => total + tier.weight, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${name} pesa ${sum}, debería sumar 1`);
  }
});

test("volume profile spreads a candle's volume across every bin it touches, not just one", () => {
  const profile = buildVolumeProfile([candle(1, 100, 103, 300)], 1);
  // Range [100,103) touches bins 100, 101, 102 — three bins, not one.
  assert.equal(profile.size, 3);
  const total = [...profile.values()].reduce((sum, bin) => sum + bin.weight, 0);
  assert.ok(Math.abs(total - 300) < 1e-6, "el volumen total se conserva");
});

test("a bin remembers the earliest candle that put volume there", () => {
  // Same price range touched on candle 0 and again on candle 5; the zone came
  // into existence at 0, so that is when the chart should start drawing it.
  const profile = buildVolumeProfile(
    [candle(0, 100, 101, 50), candle(5, 100, 101, 50)],
    1,
  );
  assert.equal(profile.get(100)?.firstIndex, 0);
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
  // Candles confined to a narrow band: levels projected outside that band were
  // never traded through, so they survive the swept-zone filter and there is
  // something left to range-check. (Candles spanning the whole range would
  // sweep every level and correctly leave an empty map.)
  const candles = Array.from({ length: 25 }, (_, i) => candle(i, 99_500, 100_500, 80));
  const heatmap = buildLiquidationHeatmap("BTCUSDT", candles, 100_000, 0.1);
  assert.ok(heatmap);
  assert.ok(heatmap.buckets.length > 0);
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

test("a zone carries the candle index it formed at, so the chart can draw it in time", () => {
  // Volume only on the last few candles: every projected zone should start
  // late in the lookback, not at the beginning of the chart.
  const candles = [
    ...Array.from({ length: 40 }, (_, i) => candle(i, 100_000, 100_010, 0)),
    ...Array.from({ length: 10 }, (_, i) => candle(40 + i, 104_900, 105_000, 200)),
  ];
  const heatmap = buildLiquidationHeatmap("BTCUSDT", candles, 100_000);
  assert.ok(heatmap);
  assert.equal(heatmap.profileCandles, 50);
  for (const bucket of heatmap.buckets) {
    assert.ok(
      bucket.formedAt >= 40,
      `una zona sin volumen previo no puede existir antes de la vela 40 (formedAt=${bucket.formedAt})`,
    );
  }
});

/* ── v2: zonas barridas, open interest, y calibración por símbolo ── */

test("a level price traded through after it formed is dropped, not left as fuel", () => {
  // Positions open in a tight band, then price sweeps far below and returns.
  // The sweep candle carries no volume of its own, so it only moves price
  // without opening new positions — otherwise it would seed fresh levels down
  // there and muddy what this test is measuring.
  const opened = Array.from({ length: 10 }, (_, i) => candle(i, 99_900, 100_100, 100));
  const swept = [candle(10, 80_000, 100_100, 0)];
  const back = Array.from({ length: 5 }, (_, i) => candle(11 + i, 99_900, 100_100, 100));

  const withoutSweep = buildLiquidationHeatmap("BTCUSDT", [...opened, ...back], 100_000);
  const withSweep = buildLiquidationHeatmap("BTCUSDT", [...opened, ...swept, ...back], 100_000);
  assert.ok(withoutSweep && withSweep);

  const fuelBelow = (map: NonNullable<typeof withSweep>) =>
    map.buckets
      .filter((bucket) => bucket.price < 99_900 && bucket.price > 80_000)
      .reduce((sum, bucket) => sum + bucket.longDensity, 0);

  assert.ok(fuelBelow(withoutSweep) > 0, "sin barrido debe haber combustible debajo");
  assert.equal(
    fuelBelow(withSweep),
    0,
    "tras el barrido esas posiciones ya se liquidaron: no pueden seguir contando",
  );
});

test("a level that formed only AFTER the sweep survives it", () => {
  // Order matters: the sweep happens first, then positions open. Those new
  // positions have not been touched, so their levels must remain.
  const swept = [candle(0, 80_000, 100_100, 100)];
  const opened = Array.from({ length: 10 }, (_, i) => candle(1 + i, 99_900, 100_100, 100));
  const heatmap = buildLiquidationHeatmap("BTCUSDT", [...swept, ...opened], 100_000);
  assert.ok(heatmap);
  const fuelBelow = heatmap.buckets
    .filter((bucket) => bucket.price < 99_000 && bucket.price > 80_000)
    .reduce((sum, bucket) => sum + bucket.longDensity, 0);
  assert.ok(fuelBelow > 0, "posiciones abiertas despues del barrido siguen vivas");
});

test("positive open-interest change replaces volume as the weight when supplied", () => {
  // Two bands with identical volume, but OI only grew at the upper one — so
  // only the upper band represents positions that actually opened.
  const candles = [
    ...Array.from({ length: 6 }, (_, i) => candle(i, 95_000, 95_200, 500)),
    ...Array.from({ length: 6 }, (_, i) => candle(6 + i, 105_000, 105_200, 500)),
  ];
  const oiDeltaByIndex = [0, 0, 0, 0, 0, 0, 900, 900, 900, 900, 900, 900];

  const byVolume = buildLiquidationHeatmap("BTCUSDT", candles, 100_000);
  const byOi = buildLiquidationHeatmap("BTCUSDT", candles, 100_000, { oiDeltaByIndex });
  assert.ok(byVolume && byOi);

  assert.equal(byOi.oiWeightedCandles, 12);
  assert.equal(byVolume.oiWeightedCandles, 0);
  assert.match(byOi.method, /open interest/);
  // With the lower band contributing nothing, the map must lean the other way.
  assert.notEqual(byOi.bias, byVolume.bias);
});

test("a candle with no OI datapoint falls back to its own volume, not to zero", () => {
  const candles = Array.from({ length: 8 }, (_, i) => candle(i, 104_900, 105_100, 300));
  // Only half the window has OI coverage, as happens past Binance's retention.
  const oiDeltaByIndex = [null, null, null, null, 400, 400, 400, 400];
  const heatmap = buildLiquidationHeatmap("BTCUSDT", candles, 100_000, { oiDeltaByIndex });
  assert.ok(heatmap);
  assert.equal(heatmap.oiWeightedCandles, 4);
  assert.ok(heatmap.buckets.length > 0, "las velas sin OI siguen aportando por volumen");
  assert.match(heatmap.method, /4 de 8 velas/);
});

test("BTC and ETH use Binance's real tier-1 maintenance margin, alts use the labelled estimate", () => {
  assert.equal(maintenanceMarginRateFor("BTCUSDT"), 0.004);
  assert.equal(maintenanceMarginRateFor("ETHUSDT"), 0.0065);
  assert.equal(maintenanceMarginRateFor("SOLUSDT"), 0.005);

  const candles = Array.from({ length: 10 }, (_, i) => candle(i, 104_900, 105_100, 200));
  const btc = buildLiquidationHeatmap("BTCUSDT", candles, 100_000);
  const sol = buildLiquidationHeatmap("SOLUSDT", candles, 100_000);
  assert.match(btc?.assumptions ?? "", /tasa real de Binance/);
  assert.match(sol?.assumptions ?? "", /estimado/);
});

test("majors get the recalibrated leverage mix, other symbols keep the conservative one", () => {
  assert.equal(leverageTiersFor("BTCUSDT"), MAJOR_LEVERAGE_TIERS);
  assert.equal(leverageTiersFor("SOLUSDT"), DEFAULT_LEVERAGE_TIERS);

  const majorHigh = MAJOR_LEVERAGE_TIERS.filter((t) => t.leverage >= 20).reduce(
    (sum, t) => sum + t.weight,
    0,
  );
  // Binance disclosed that over 80% of its futures traders used 20x or more.
  assert.ok(majorHigh > 0.8, `los tramos altos pesan ${majorHigh}, deberían superar 0.8`);
  const hundredX = MAJOR_LEVERAGE_TIERS.find((t) => t.leverage === 100)?.weight ?? 0;
  assert.ok(hundredX >= 0.15, "Binance reporto ~20% de usuarios en 100x o mas");
});

test("the legacy numeric third argument still means priceRangePct", () => {
  const candles = Array.from({ length: 12 }, (_, i) => candle(i, 99_500, 100_500, 90));
  const legacy = buildLiquidationHeatmap("BTCUSDT", candles, 100_000, 0.1);
  const explicit = buildLiquidationHeatmap("BTCUSDT", candles, 100_000, { priceRangePct: 0.1 });
  assert.ok(legacy && explicit);
  assert.equal(legacy.buckets.length, explicit.buckets.length);
});
