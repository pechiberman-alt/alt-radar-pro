import assert from "node:assert/strict";
import test from "node:test";
import { findFairValueGaps } from "../lib/fair-value-gaps.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const c = (i: number, open: number, close: number, high: number, low: number): SwingCandle => ({
  openTime: 1_757_000_000_000 + i * 3_600_000,
  open,
  close,
  high,
  low,
  volume: 100,
  quoteVolume: 0,
});

/** Directionless baseline so scenarios isolate one gap. */
const flat = (count: number, price: number, from: number) =>
  Array.from({ length: count }, (_, i) => c(from + i, price, price, price + 2, price - 2));

/** Three candles where 1 and 3 do not overlap, leaving a band untraded. */
const bullishGap = (from: number) => [
  c(from, 1000, 1002, 1004, 998),
  c(from + 1, 1002, 1020, 1022, 1001),
  c(from + 2, 1020, 1024, 1026, 1014),
];

test("a bullish gap is found between the first and third candle", () => {
  const gaps = findFairValueGaps([...flat(20, 1000, 0), ...bullishGap(20), ...flat(10, 1024, 23)]);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].kind, "FVG");
  assert.equal(gaps[0].side, "ALCISTA");
  // Gap runs from the first candle's high to the third candle's low.
  assert.equal(gaps[0].low, 1004);
  assert.equal(gaps[0].high, 1014);
});

test("the mirror case produces a bearish gap", () => {
  const gaps = findFairValueGaps([
    ...flat(20, 1000, 0),
    c(20, 1000, 998, 1002, 996),
    c(21, 998, 980, 999, 978),
    c(22, 980, 976, 986, 974),
    ...flat(10, 976, 23),
  ]);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].side, "BAJISTA");
  assert.equal(gaps[0].kind, "FVG");
});

test("overlapping candles leave no gap at all", () => {
  const gaps = findFairValueGaps([
    ...flat(20, 1000, 0),
    c(20, 1000, 1002, 1010, 998),
    c(21, 1002, 1008, 1012, 1001),
    // Third candle overlaps the first: nothing was skipped.
    c(22, 1008, 1006, 1011, 1005),
    ...flat(10, 1006, 23),
  ]);
  assert.deepEqual(gaps, []);
});

test("a gap smaller than the noise threshold is ignored", () => {
  const gaps = findFairValueGaps(
    [
      ...flat(20, 1000, 0),
      c(20, 1000, 1000, 1000.2, 999.8),
      c(21, 1000, 1001, 1001.2, 999.9),
      c(22, 1001, 1001, 1001.5, 1000.4),
      ...flat(10, 1001, 23),
    ],
    { minSize: 0.35 },
  );
  assert.deepEqual(gaps, []);
});

test("a gap price closed through inverts and flips side", () => {
  const gaps = findFairValueGaps([
    ...flat(20, 1000, 0),
    ...bullishGap(20),
    // Price comes back and closes below the gap: the bullish attempt failed.
    c(23, 1024, 995, 1025, 993),
    ...flat(9, 995, 24),
  ]);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].kind, "IFVG");
  assert.equal(gaps[0].side, "BAJISTA", "un gap alcista roto pasa a ser resistencia");
});

test("an inversion outranks a plain gap of the same size", () => {
  const plain = findFairValueGaps([...flat(20, 1000, 0), ...bullishGap(20), ...flat(10, 1024, 23)]);
  const inverted = findFairValueGaps([
    ...flat(20, 1000, 0),
    ...bullishGap(20),
    c(23, 1024, 995, 1025, 993),
    ...flat(9, 995, 24),
  ]);
  assert.ok(
    inverted[0].quality > plain[0].quality,
    "la inversión aporta un fallo observado, no sólo una banda sin llenar",
  );
});

test("a gap mostly filled without being broken is dropped as spent", () => {
  // Price walks back into the gap in steps. A single large candle would fill
  // it but also carve a fresh gap of its own on the way down — the detector
  // would rightly report that new one, which is not what this is testing.
  const gaps = findFairValueGaps(
    [
      ...flat(20, 1000, 0),
      ...bullishGap(20),
      // Each candle overlaps the one two back, so the descent itself leaves
      // no new gap — otherwise the detector reports that one instead, which
      // it would be right to do.
      c(23, 1024, 1018, 1025, 1016),
      c(24, 1018, 1012, 1019, 1008),
      c(25, 1012, 1007, 1017, 1005),
      ...flat(8, 1007, 26),
    ],
    { maxFilledPct: 85 },
  );
  assert.deepEqual(gaps, [], "un hueco casi consumido ya no es un nivel");
});

test("too little history yields nothing", () => {
  assert.deepEqual(findFairValueGaps(flat(10, 1000, 0)), []);
  assert.deepEqual(findFairValueGaps([]), []);
});

test("results are capped and ordered by price", () => {
  const gaps = findFairValueGaps([...flat(20, 1000, 0), ...bullishGap(20), ...flat(10, 1024, 23)], {
    limit: 2,
  });
  assert.ok(gaps.length <= 2);
  for (let i = 1; i < gaps.length; i += 1) assert.ok(gaps[i - 1].mid >= gaps[i].mid);
});
