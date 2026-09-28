import assert from "node:assert/strict";
import test from "node:test";
import { buildLiquidationHeatmap, filterHeatmapTiers, leverageTiersFor, type LiquidationHeatmap } from "../lib/liquidation-heatmap.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A gently trending market, so there are liquidation levels on both sides of price. */
function candles(seed = 3, n = 300): SwingCandle[] {
  const rnd = mulberry32(seed);
  let price = 100;
  return Array.from({ length: n }, (_, i) => {
    const open = price;
    const close = open * (1 + (rnd() - 0.5) * 0.012 + Math.sin(i / 25) * 0.0012);
    price = close;
    return {
      openTime: i * 60_000, open, close,
      high: Math.max(open, close) * (1 + rnd() * 0.004),
      low: Math.min(open, close) * (1 - rnd() * 0.004),
      volume: 100 + rnd() * 400, quoteVolume: 0,
    };
  });
}
const build = (sym = "BTCUSDT", oi: number | null = 5e9): LiquidationHeatmap => {
  const c = candles();
  const hm = buildLiquidationHeatmap(sym, c, c[c.length - 1].close, { priceRangePct: 0.2, totalOpenInterestUsd: oi ?? undefined });
  assert.ok(hm, "the fixture should produce a map");
  return hm;
};
const ALL = leverageTiersFor("BTCUSDT").map((t) => t.leverage);
const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b)), `${a} ≉ ${b}`);

test("each bucket carries its per-leverage split, and the split sums back to the bucket", () => {
  const hm = build();
  for (const b of hm.buckets) {
    assert.ok(b.byLeverage);
    let long = 0;
    let short = 0;
    for (const share of Object.values(b.byLeverage!)) {
      long += share.long;
      short += share.short;
    }
    close(long, b.longDensity);
    close(short, b.shortDensity);
  }
});

test("with every tier on, the filter reproduces the original map exactly", () => {
  const hm = build();
  const same = filterHeatmapTiers(hm, ALL)!;
  assert.equal(same.buckets.length, hm.buckets.length);
  hm.buckets.forEach((b, i) => {
    const f = same.buckets[i];
    assert.equal(f.price, b.price);
    close(f.longDensity, b.longDensity);
    close(f.shortDensity, b.shortDensity);
    close(f.intensity, b.intensity);
    close(f.notionalUsd ?? 0, b.notionalUsd ?? 0);
    assert.equal(f.formedAt, b.formedAt);
  });
  assert.equal(same.topZoneAbove?.price, hm.topZoneAbove?.price);
  assert.equal(same.topZoneBelow?.price, hm.topZoneBelow?.price);
  assert.equal(same.bias, hm.bias);
});

test("a subset of tiers holds strictly less than the whole, in density and in dollars", () => {
  const hm = build();
  const sub = filterHeatmapTiers(hm, [50, 100])!;
  const dens = (m: LiquidationHeatmap) => m.buckets.reduce((s, b) => s + b.longDensity + b.shortDensity, 0);
  const usd = (m: LiquidationHeatmap) => m.buckets.reduce((s, b) => s + (b.notionalUsd ?? 0), 0);
  assert.ok(dens(sub) < dens(hm));
  assert.ok(usd(sub) < usd(hm), "dollars of a subset are smaller than the whole, not rescaled to fill the same open interest");
  assert.ok(usd(sub) > 0);
  // The dollar share equals the density share of the tiers chosen.
  close(usd(sub) / usd(hm), dens(sub) / dens(hm), 1e-9);
});

test("the dollars of the tiers, taken separately, add up to the whole", () => {
  const hm = build();
  const usd = (m: LiquidationHeatmap | null) => (m ? m.buckets.reduce((s, b) => s + (b.notionalUsd ?? 0), 0) : 0);
  const parts = ALL.reduce((sum, lev) => sum + usd(filterHeatmapTiers(hm, [lev])), 0);
  close(parts, usd(hm), 1e-9);
});

test("intensity is re-normalised to the busiest level of what is shown", () => {
  const sub = filterHeatmapTiers(build(), [100])!;
  assert.equal(Math.max(...sub.buckets.map((b) => b.intensity)), 100);
});

test("the strongest zones are recomputed for the tiers shown", () => {
  const hm = build();
  const sub = filterHeatmapTiers(hm, [5])!;
  // 5x liquidates ~20% away, 100x ~1% away: the nearest high-leverage level
  // must lie closer to price than the low-leverage one.
  const hi = filterHeatmapTiers(hm, [100])!;
  const dist = (m: LiquidationHeatmap) => Math.min(...[m.topZoneAbove, m.topZoneBelow].filter(Boolean).map((z) => Math.abs(z!.price - m.currentPrice)));
  assert.ok(dist(hi) < dist(sub), `100x ${dist(hi).toFixed(2)} should sit closer than 5x ${dist(sub).toFixed(2)}`);
});

test("a level's formation time follows only the tiers shown", () => {
  const hm = build();
  for (const lev of [10, 100]) {
    const sub = filterHeatmapTiers(hm, [lev])!;
    for (const b of sub.buckets) {
      const original = hm.buckets.find((o) => o.price === b.price)!;
      assert.ok(b.formedAt >= original.formedAt, "never earlier than the full map's earliest contribution");
    }
  }
});

test("choosing nothing that exists leaves an empty answer, not a wrong one", () => {
  assert.equal(filterHeatmapTiers(build(), []), null);
  assert.equal(filterHeatmapTiers(build(), [3]), null);
});

test("a map without the split comes back untouched", () => {
  const hm = build();
  const stripped: LiquidationHeatmap = {
    ...hm,
    buckets: hm.buckets.map((b) => {
      const copy = { ...b };
      delete copy.byLeverage;
      return copy;
    }),
  };
  assert.equal(filterHeatmapTiers(stripped, [100]), stripped);
});

test("without open interest the dollar figures stay absent under any filter", () => {
  const hm = build("BTCUSDT", null);
  assert.ok(hm.buckets.every((b) => b.notionalUsd === null));
  assert.ok(filterHeatmapTiers(hm, [25])!.buckets.every((b) => b.notionalUsd === null));
});
