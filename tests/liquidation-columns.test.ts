import assert from "node:assert/strict";
import test from "node:test";
import { buildLiquidationLives, gridColor, liquidationGrid, type LiquidationLife } from "../lib/liquidation-columns.ts";
import { buildLiquidationHeatmap, leverageTiersFor, maintenanceMarginRateFor } from "../lib/liquidation-heatmap.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const F = 300_000;
const candle = (i: number, o: number, h: number, l: number, c: number, v = 100): SwingCandle => ({
  openTime: i * F, open: o, high: h, low: l, close: c, volume: v, quoteVolume: 0,
});

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
function walk(seed: number, n = 400): SwingCandle[] {
  const rnd = mulberry32(seed);
  let price = 100;
  return Array.from({ length: n }, (_, i) => {
    const open = price;
    const close = open * (1 + (rnd() - 0.5) * 0.012);
    price = close;
    return candle(i, open, Math.max(open, close) * (1 + rnd() * 0.003), Math.min(open, close) * (1 - rnd() * 0.003), close, 50 + rnd() * 300);
  });
}

// ─── lives ────────────────────────────────────────────────────────────────

test("prices follow the liquidation formula at each sampled entry, for every tier and side", () => {
  const lives = buildLiquidationLives("BTCUSDT", [candle(0, 100, 101, 99, 100.5)], { samples: 1 });
  const mmr = maintenanceMarginRateFor("BTCUSDT");
  const tiers = leverageTiersFor("BTCUSDT");
  assert.equal(lives.length, tiers.length * 2);
  for (const tier of tiers) {
    const long = lives.find((l) => l.side === "long" && l.leverage === tier.leverage)!;
    const short = lives.find((l) => l.side === "short" && l.leverage === tier.leverage)!;
    assert.ok(Math.abs(long.price - 100 * (1 - 1 / tier.leverage + mmr)) < 1e-9);
    assert.ok(Math.abs(short.price - 100 * (1 + 1 / tier.leverage - mmr)) < 1e-9);
    assert.ok(Math.abs(long.weight - 100 * tier.weight) < 1e-9, "the candle's weight split by tier");
    assert.equal(long.sweptTime, null, "nothing came after it");
  }
});

test("the weights of all levels add up to the candles' activity", () => {
  const candles = walk(4, 60);
  const lives = buildLiquidationLives("BTCUSDT", candles, { priceRangePct: 1 });
  const total = lives.reduce((s, l) => s + l.weight, 0);
  const activity = candles.reduce((s, c) => s + c.volume, 0) * 2; // every entry liquidates both ways
  assert.ok(Math.abs(total - activity) / activity < 1e-9);
});

test("open-interest change replaces volume where known, and a contraction opens nothing", () => {
  const candles = [candle(0, 100, 101, 99, 100, 500), candle(1, 100, 101, 99, 100, 500), candle(2, 100, 101, 99, 100, 500)];
  const lives = buildLiquidationLives("BTCUSDT", candles, { oiDeltaByIndex: [20, -5, null], priceRangePct: 1 });
  const byTime = (t: number) => lives.filter((l) => l.formedTime === t).reduce((s, l) => s + l.weight, 0);
  assert.ok(Math.abs(byTime(0) - 40) < 1e-9);
  assert.equal(byTime(F), 0);
  assert.ok(Math.abs(byTime(2 * F) - 1000) < 1e-9);
});

test("a level is swept by the FIRST later candle whose range reaches it", () => {
  const candles = [candle(0, 100, 100.2, 99.8, 100), candle(1, 100, 100.3, 99.7, 100), candle(2, 100, 100.1, 98.8, 99), candle(3, 99, 99.5, 97, 98)];
  const lives = buildLiquidationLives("BTCUSDT", candles, { samples: 1 });
  const long100 = lives.find((l) => l.formedTime === 0 && l.side === "long" && l.leverage === 100)!;
  assert.ok(long100.price > 98.8 && long100.price < 99.7); // ~99.5
  assert.equal(long100.sweptTime, 2 * F);
  const long10 = lives.find((l) => l.formedTime === 0 && l.side === "long" && l.leverage === 10)!;
  assert.equal(long10.sweptTime, null, "~90.5, never reached");
});

test("NO LOOKAHEAD: adding later candles never changes an earlier sweep, it can only fill in one still pending", () => {
  const candles = walk(9);
  const full = buildLiquidationLives("BTCUSDT", candles, { priceRangePct: 1 });
  for (const cut of [100, 250, 399]) {
    const part = buildLiquidationLives("BTCUSDT", candles.slice(0, cut), { priceRangePct: 1 });
    const lastTime = candles[cut - 1].openTime;
    const fromFull = full.filter((l) => l.formedTime <= lastTime);
    assert.equal(part.length, fromFull.length);
    part.forEach((l, i) => {
      const f = fromFull[i];
      assert.equal(l.price, f.price);
      assert.equal(l.sweptTime, f.sweptTime !== null && f.sweptTime <= lastTime ? f.sweptTime : null);
    });
  }
});

test("the logarithmic sweep search agrees with a plain scan", () => {
  const candles = walk(21);
  for (const l of buildLiquidationLives("BTCUSDT", candles, { priceRangePct: 1 })) {
    const j = candles.findIndex((c) => c.openTime === l.formedTime);
    let expected: number | null = null;
    for (let k = j + 1; k < candles.length; k += 1) {
      if (l.side === "long" ? candles[k].low <= l.price : candles[k].high >= l.price) {
        expected = candles[k].openTime;
        break;
      }
    }
    assert.equal(l.sweptTime, expected);
  }
});

test("levels outside the projected range are left out, dojis and empty candles contribute nothing", () => {
  const lives = buildLiquidationLives("BTCUSDT", [candle(0, 100, 101, 99, 100), candle(1, 100, 100, 100, 100), candle(2, 100, 101, 99, 100, 0)], { priceRangePct: 0.05, samples: 1 });
  assert.ok(lives.every((l) => l.price >= 95 && l.price <= 105));
  assert.ok(lives.every((l) => l.formedTime === 0));
});

// ─── grid ─────────────────────────────────────────────────────────────────

const life = (p: Partial<LiquidationLife>): LiquidationLife => ({
  price: 50, weight: 10, side: "long", leverage: 100, formedTime: 2 * F, sweptTime: null, ...p,
});
const times = Array.from({ length: 10 }, (_, i) => i * F);
const grid = (lives: LiquidationLife[], extra: Partial<Parameters<typeof liquidationGrid>[1]> = {}) =>
  liquidationGrid(lives, { times, lo: 0, hi: 100, rows: 10, halfLife: null, frameMs: F, ...extra });
const column = (g: ReturnType<typeof grid>, row: number) => Array.from({ length: g.cols }, (_, c) => g.cells[c * g.rows + row]);

test("a level fills its row from the candle that formed it, through the candle that swept it, and not after", () => {
  const g = grid([life({ sweptTime: 6 * F })]);
  assert.deepEqual(column(g, 5), [0, 0, 10, 10, 10, 10, 10, 0, 0, 0]);
});

test("a level still standing runs to the last column", () => {
  assert.deepEqual(column(grid([life({})]), 5), [0, 0, 10, 10, 10, 10, 10, 10, 10, 10]);
});

test("a level formed before the first column starts already decayed", () => {
  const g = liquidationGrid([life({ formedTime: -2 * F })], { times, lo: 0, hi: 100, rows: 10, halfLife: 2, frameMs: F });
  assert.ok(Math.abs(g.cells[0 * 10 + 5] - 5) < 1e-6, "two candles old, half-life two: half the weight");
  assert.ok(Math.abs(g.cells[2 * 10 + 5] - 2.5) < 1e-6);
});

test("decay halves the weight every half-life, measured from each column", () => {
  const g = grid([life({ formedTime: 0 })], { halfLife: 3 });
  const col = column(g, 5);
  assert.ok(Math.abs(col[0] - 10) < 1e-6);
  assert.ok(Math.abs(col[3] - 5) < 1e-6);
  assert.ok(Math.abs(col[6] - 2.5) < 1e-6);
});

test("rows map price linearly, row 0 at the bottom; out-of-window prices are skipped", () => {
  const g = grid([life({ price: 5 }), life({ price: 95 }), life({ price: 120 }), life({ price: -1 })]);
  assert.ok(g.cells[9 * 10 + 0] > 0);
  assert.ok(g.cells[9 * 10 + 9] > 0);
  const filledRows = new Set<number>();
  g.cells.forEach((v, i) => v > 0 && filledRows.add(i % 10));
  assert.deepEqual([...filledRows].sort((a, b) => a - b), [0, 9]);
});

test("only the chosen leverage tiers are drawn", () => {
  const g = grid([life({ leverage: 100 }), life({ leverage: 10, price: 20 })], { tiers: [10] });
  assert.equal(g.cells[9 * 10 + 5], 0);
  assert.equal(g.cells[9 * 10 + 2], 10);
});

test("the scale is the 97th percentile, so one outlier can't flatten everything else", () => {
  // One extreme level among forty ordinary ones: it is ~2% of the cells.
  const lives = [life({ price: 99, weight: 1000 }), ...Array.from({ length: 40 }, (_, i) => life({ price: 1 + i * 2, weight: 10 }))];
  const g = grid(lives, { rows: 50 });
  assert.equal(g.scale, 10);
  assert.equal(grid([]).scale, 0);
});

test("colours step teal → green → yellow → red, with nothing below the floor", () => {
  assert.equal(gridColor(1, 100), null);
  const [teal, green, yellow, red] = [20, 45, 70, 95].map((v) => gridColor(v, 100)!);
  assert.deepEqual(teal.slice(0, 3), [30, 122, 138]);
  assert.equal(gridColor(14, 100), null, "below 15% of the scale stays empty");
  assert.deepEqual(green.slice(0, 3), [36, 196, 82]);
  assert.deepEqual(yellow.slice(0, 3), [238, 222, 28]);
  assert.deepEqual(red.slice(0, 3), [255, 48, 48]);
  assert.equal(gridColor(50, 0), null);
});

test("CONSISTENCY: the last column carries about the same fuel, on the same side, as the main map", () => {
  const candles = walk(33, 300);
  const price = candles.at(-1)!.close;
  const hm = buildLiquidationHeatmap("BTCUSDT", candles, price, { priceRangePct: 0.15, halfLifeCandles: 60 })!;
  const lives = buildLiquidationLives("BTCUSDT", candles, { priceRangePct: 0.15 });
  const t = candles.map((c) => c.openTime);
  const g = liquidationGrid(lives, { times: t, lo: price * 0.85, hi: price * 1.15, rows: 60, halfLife: 60, frameMs: F });
  let above = 0;
  let below = 0;
  for (let r = 0; r < g.rows; r += 1) {
    const v = g.cells[(g.cols - 1) * g.rows + r];
    if (price * 0.85 + ((r + 0.5) / g.rows) * price * 0.3 > price) above += v;
    else below += v;
  }
  const mapAbove = hm.buckets.filter((b) => b.price > price).reduce((s, b) => s + b.longDensity + b.shortDensity, 0);
  const mapBelow = hm.buckets.filter((b) => b.price < price).reduce((s, b) => s + b.longDensity + b.shortDensity, 0);
  const ratio = (above + below) / (mapAbove + mapBelow);
  // The main map tests sweeps from the earliest candle in each price bin,
  // which retires a little more; the columns follow each candle exactly.
  assert.ok(ratio > 0.85 && ratio < 1.6, `total ratio ${ratio.toFixed(2)}`);
  assert.equal(above > below, mapAbove > mapBelow, "same dominant side");
});
