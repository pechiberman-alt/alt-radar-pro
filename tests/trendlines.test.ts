import assert from "node:assert/strict";
import test from "node:test";
import { analyzeTrend, atrSeries, findPivots, latestBreak, lineAt } from "../lib/trendlines.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const F = 3_600_000;
type O = Partial<Pick<SwingCandle, "high" | "low" | "close" | "volume">>;

/** A descending resistance y = 200 − 0.5·i, touched exactly at 10, 30 and 50; price lives 8 below it. */
function descending(len = 90, over: Record<number, O> = {}): SwingCandle[] {
  const line = (i: number) => 200 - 0.5 * i;
  return Array.from({ length: len }, (_, i) => {
    const touch = i === 10 || i === 30 || i === 50;
    const high = touch ? line(i) : line(i) - 8;
    const o = over[i] ?? {};
    const h = o.high ?? high;
    const l = o.low ?? h - 4;
    const close = o.close ?? h - 2;
    return { openTime: i * F, open: close, high: h, low: l, close, volume: o.volume ?? 100, quoteVolume: 0 };
  });
}
/** Break at 70 and a follow-through that stays above. */
const breakOver: Record<number, O> = {
  70: { high: 175, low: 168, close: 172, volume: 250 },
  ...Object.fromEntries(Array.from({ length: 19 }, (_, k) => [71 + k, { high: 176 + k, low: 170 + k, close: 173 + k }])),
};
const mirror = (c: SwingCandle[], m = 400): SwingCandle[] =>
  c.map((x) => ({ ...x, open: m - x.open, high: m - x.low, low: m - x.high, close: m - x.close }));

test("pivots: the first of equal highs counts, edges are never pivots", () => {
  const c = descending(40);
  assert.deepEqual(findPivots(c, 3).filter((p) => p.kind === "high").map((p) => p.i), [10, 30]);
  assert.equal(findPivots(c, 3).find((p) => p.i === 10)!.confirmedAt, 13);
  assert.deepEqual(findPivots(c.slice(0, 5), 3), []);
});

test("a resistance line through three swing highs, and the close that breaks it", () => {
  const a = analyzeTrend(descending(90, breakOver));
  assert.equal(a.breaks.length, 1);
  const b = a.breaks[0];
  assert.equal(b.i, 70);
  assert.equal(b.direction, "ALCISTA");
  assert.equal(b.line.side, "RESISTENCIA");
  assert.deepEqual([b.line.a, b.line.b, b.line.touches], [10, 50, 3], "the longest pair, all three touches");
  assert.ok(Math.abs(b.linePrice - 165) < 1e-9);
  assert.ok(b.strength > 1.2 && b.strength < 1.4, `strength ${b.strength}: 7 above the line over an ATR of about 5,4`);
  assert.equal(b.volumeMultiple, 2.5);
  assert.equal(b.confirmed, true);
  assert.equal(b.outcome, "SOSTENIDA");
  assert.ok(Math.abs(lineAt(b.line, 70) - 165) < 1e-9);
});

test("before the break the same line is standing, and nothing is reported broken", () => {
  const a = analyzeTrend(descending(69, breakOver));
  assert.deepEqual(a.breaks, []);
  assert.equal(a.lines.length, 1);
  assert.deepEqual([a.lines[0].side, a.lines[0].a, a.lines[0].b, a.lines[0].touches], ["RESISTENCIA", 10, 50, 3]);
});

test("a support line breaks downward: the mirror image", () => {
  const a = analyzeTrend(mirror(descending(90, breakOver)));
  assert.equal(a.breaks.length, 1);
  assert.equal(a.breaks[0].direction, "BAJISTA");
  assert.equal(a.breaks[0].line.side, "SOPORTE");
  assert.deepEqual([a.breaks[0].line.a, a.breaks[0].line.b, a.breaks[0].line.touches, a.breaks[0].i], [10, 50, 3, 70]);
  assert.ok(a.breaks[0].line.slope > 0, "support ascends");
  assert.equal(analyzeTrend(mirror(descending(69, breakOver))).lines[0].side, "SOPORTE");
});

test("a wick through the line is not a break: only a close is", () => {
  const a = analyzeTrend(descending(90, { 60: { high: 170, low: 160, close: 161 } })); // wick 5 above the line (160)... close below
  assert.equal(a.breaks.filter((b) => b.i === 60).length, 0);
});

test("a close beyond the line between the anchors disqualifies that pair", () => {
  const a = analyzeTrend(descending(90, { 40: { high: 186, low: 180, close: 184 }, ...breakOver })); // the line is 180 at 40
  assert.ok(!a.breaks.some((b) => b.line.a === 10 && b.line.b === 50), "(10,50) crosses a close, so it is not a line");
});

test("a line broken before its second anchor could be known is not used", () => {
  // Candle 52 closes above the line (174) while high stays under the pivot at 50 (175): the pivot is only
  // confirmed at 53, so the pair (10,50) was already broken when it became drawable. (10,30) was known and breaks.
  const a = analyzeTrend(descending(70, { 52: { high: 174.9, low: 170, close: 174.6 } }));
  assert.equal(a.breaks.length, 1);
  assert.deepEqual([a.breaks[0].i, a.breaks[0].line.a, a.breaks[0].line.b, a.breaks[0].line.touches], [52, 10, 30, 2]);
});

test("follow-through: it holds, it fails, or it is too recent to say", () => {
  const failed = analyzeTrend(descending(90, { ...breakOver, 72: { high: 160, low: 150, close: 152 } }));
  assert.equal(failed.breaks[0].outcome, "FALLIDA");
  assert.equal(analyzeTrend(descending(72, breakOver)).breaks[0].outcome, "RECIÉN");
  assert.equal(analyzeTrend(descending(90, breakOver)).breaks[0].outcome, "SOSTENIDA");
});

test("volume confirmation is reported, and unknown volume is unknown", () => {
  assert.equal(analyzeTrend(descending(90, { ...breakOver, 70: { ...breakOver[70], volume: 100 } })).breaks[0].confirmed, false);
  assert.equal(analyzeTrend(descending(90, { ...breakOver, 70: { ...breakOver[70], volume: Number.NaN } })).breaks[0].volumeMultiple, null);
  const zero = descending(90, breakOver).map((c) => ({ ...c, volume: 0 }));
  assert.equal(analyzeTrend(zero).breaks[0].volumeMultiple, null);
});

test("range breakout: the first close beyond a tight consolidation, once", () => {
  const flat: SwingCandle[] = Array.from({ length: 40 }, (_, i) => ({ openTime: i * F, open: 100, high: i % 2 ? 100.6 : 100.4, low: i % 2 ? 99.6 : 99.4, close: 100, volume: 100, quoteVolume: 0 }));
  flat[30] = { ...flat[30], high: 103.5, low: 100, close: 103, volume: 300 };
  flat[31] = { ...flat[31], high: 104, low: 102.5, close: 103.5 };
  const a = analyzeTrend(flat);
  assert.equal(a.ranges.length, 1, "the second close above the range is not a new breakout");
  assert.deepEqual([a.ranges[0].i, a.ranges[0].direction, a.ranges[0].confirmed], [30, "ALCISTA", true]);
  assert.ok(Math.abs(a.ranges[0].level - 100.6) < 1e-9);
});

test("a steady trend is not a stream of breakouts", () => {
  const trend: SwingCandle[] = Array.from({ length: 80 }, (_, i) => ({ openTime: i * F, open: 100 + i, high: 101.2 + i, low: 99.8 + i, close: 101 + i, volume: 100, quoteVolume: 0 }));
  assert.deepEqual(analyzeTrend(trend).ranges, []);
});

test("short, flat or broken series give nothing and never throw", () => {
  assert.deepEqual(analyzeTrend([]).lines, []);
  assert.deepEqual(analyzeTrend(descending(20)).breaks, []);
  const flat = Array.from({ length: 80 }, (_, i): SwingCandle => ({ openTime: i, open: 5, high: 5, low: 5, close: 5, volume: 1, quoteVolume: 0 }));
  assert.deepEqual(analyzeTrend(flat), { lines: [], breaks: [], ranges: [], pivots: [] }, "no range, no pivots");
  const bad = descending(80);
  bad[40] = { ...bad[40], high: Number.NaN };
  assert.deepEqual(analyzeTrend(bad).breaks, []);
  assert.ok(atrSeries(flat).every((v) => v === 0));
});

test("at most two standing lines per side", () => {
  const a = analyzeTrend(descending(69, breakOver));
  assert.ok(a.lines.filter((l) => l.side === "RESISTENCIA").length <= 2);
});

function walk(seed: number, len: number): SwingCandle[] {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  let price = 100;
  return Array.from({ length: len }, (_, i) => {
    const open = price;
    const close = open * (1 + (rnd() - 0.5) * 0.03);
    price = close;
    return { openTime: i * F, open, high: Math.max(open, close) * (1 + rnd() * 0.008), low: Math.min(open, close) * (1 - rnd() * 0.008), close, volume: 50 + rnd() * 300, quoteVolume: 0 };
  });
}
const core = (b: { i: number; direction: string; volumeMultiple: number | null; confirmed: boolean; strength: number; line?: { a: number; b: number; touches: number } }) =>
  JSON.stringify([b.i, b.direction, b.line?.a, b.line?.b, b.line?.touches, b.strength, b.volumeMultiple, b.confirmed]);

test("NO LOOKAHEAD: the breaks up to candle k are the same whether or not the later candles exist", () => {
  let checked = 0;
  for (const seed of [1, 7, 42, 99, 2024]) {
    const full = walk(seed, 320);
    const all = analyzeTrend(full);
    for (const cut of [90, 140, 200, 260, 319]) {
      const part = analyzeTrend(full.slice(0, cut + 1));
      assert.deepEqual(part.breaks.map(core), all.breaks.filter((b) => b.i <= cut).map(core), `seed ${seed} cut ${cut}: line breaks`);
      assert.deepEqual(part.ranges.map(core), all.ranges.filter((r) => r.i <= cut).map(core), `seed ${seed} cut ${cut}: range breakouts`);
      checked += part.breaks.length + part.ranges.length;
    }
  }
  assert.ok(checked > 20, `the property was exercised on ${checked} events`);
});

test("a break always closes beyond its own line, in the stated direction, and the line is always on the right side", () => {
  for (const seed of [3, 11, 58]) {
    const c = walk(seed, 300);
    for (const b of analyzeTrend(c).breaks) {
      const sign = b.direction === "ALCISTA" ? 1 : -1;
      assert.ok(sign * (c[b.i].close - lineAt(b.line, b.i)) > 0);
      assert.ok(sign * (c[b.i - 1].close - lineAt(b.line, b.i - 1)) <= 0.1 * 1e9, "previous candle");
      assert.equal(b.line.side === "RESISTENCIA", b.direction === "ALCISTA");
      assert.ok(b.line.slope * sign < 0, "resistance descends, support ascends");
      assert.ok(b.line.b - b.line.a >= 5 && b.line.touches >= 2);
    }
  }
});

test("500 candles analyse quickly", () => {
  const c = walk(5, 500);
  const t0 = performance.now();
  analyzeTrend(c);
  const ms = performance.now() - t0;
  console.log(`      (500 candles: ${ms.toFixed(0)} ms)`);
  assert.ok(ms < 1500);
});

test("the one-line summary picks the most recent break of either kind", () => {
  const a = analyzeTrend(descending(90, breakOver));
  assert.equal(latestBreak(a)?.i, 70);
  assert.equal(latestBreak({ lines: [], breaks: [], ranges: [], pivots: [] }), null);
});
