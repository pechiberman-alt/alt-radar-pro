import assert from "node:assert/strict";
import test from "node:test";
import { aggregate, compactRead, readAsset, swingLevels, trendOf } from "../lib/asset-read.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const H = 3_600_000;
/** 1h candles from a price path. */
const path = (f: (i: number) => number, n: number, t0 = Date.UTC(2026, 8, 1)): SwingCandle[] =>
  Array.from({ length: n }, (_, i) => {
    const o = f(i);
    const c = f(i + 1);
    return { openTime: t0 + i * H, open: o, high: Math.max(o, c) * 1.002, low: Math.min(o, c) * 0.998, close: c, volume: 100 + (i % 7), quoteVolume: 100 * c };
  });

test("4h and daily candles are built from complete groups of 1h candles, aligned to UTC", () => {
  const c = path((i) => 100 + i, 50, Date.UTC(2026, 8, 1, 2));
  const c4 = aggregate(c, 4);
  assert.equal(c4[0].openTime, Date.UTC(2026, 8, 1, 4), "the 02:00–03:00 hours make an incomplete group and are left out");
  assert.equal(c4[0].open, c[2].open);
  assert.equal(c4[0].close, c[5].close);
  assert.equal(c4[0].volume, c.slice(2, 6).reduce((a, x) => a + x.volume, 0));
  assert.ok(c4.every((x) => (x.openTime / H) % 4 === 0));
  assert.equal(aggregate(c, 24).length, 1, "only one complete day in 50 hours from 02:00");
});

test("trend by timeframe: a steady climb is alcista, a slide bajista, a wave de costado", () => {
  assert.equal(trendOf(path((i) => 100 * 1.003 ** i, 100), "1h")?.trend, "ALCISTA");
  assert.equal(trendOf(path((i) => 100 * 0.997 ** i, 100), "1h")?.trend, "BAJISTA");
  // A long slide and a short bounce: price over its fast average, the fast one still under the slow one — not a trend.
  assert.equal(trendOf(path((i) => (i < 94 ? 100 * 0.997 ** i : 100 * 0.997 ** 94 * 1.01 ** (i - 94)), 100), "1h")?.trend, "LATERAL");
  assert.equal(trendOf(path((i) => 100 + i, 20), "1h"), null, "too few candles: no trend rather than a guess");
});

test("supports and resistances are swing points on 4h, nearest first, merged when close", () => {
  // Waves between 90 and 110: swing highs near 110, lows near 90.
  const c4 = aggregate(path((i) => 100 + 10 * Math.sin(i / 12), 600), 4);
  const { supports, resistances } = swingLevels(c4, 100);
  assert.ok(resistances[0].price > 100 && resistances[0].price < 112, `${resistances[0].price}`);
  assert.ok(supports[0].price < 100 && supports[0].price > 88, `${supports[0].price}`);
  assert.ok(resistances[0].touches >= 2, "the repeated highs form one level");
});

test("the read never uses the candle still forming (no lookahead)", () => {
  const c = path((i) => 100 * 1.002 ** i, 900);
  const lastOpen = c[c.length - 1].openTime;
  const now = lastOpen + H + 1;
  const wild: SwingCandle = { openTime: lastOpen + H, open: 1, high: 999, low: 0.5, close: 999, volume: 1e9, quoteVolume: 1e9 };
  const a = readAsset("ETHUSDT", c, now)!;
  assert.deepEqual(readAsset("ETHUSDT", [...c, wild], now), a);
  assert.equal(a.at, lastOpen);
  assert.deepEqual(a.tfs.map((t) => [t.tf, t.trend]), [["1h", "ALCISTA"], ["4h", "ALCISTA"], ["1d", "ALCISTA"]]);
  assert.equal(a.alignment, "ALCISTA");
  assert.ok(a.change30d !== null && a.change30d > 0);
  assert.equal(readAsset("ETHUSDT", c.slice(0, 50), now), null);
  const k = compactRead(a);
  assert.deepEqual(k.tendencias, { "1h": "ALCISTA", "4h": "ALCISTA", "1d": "ALCISTA" });
  assert.equal(k.alineacion, "ALCISTA");
});
