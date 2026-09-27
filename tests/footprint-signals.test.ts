import assert from "node:assert/strict";
import test from "node:test";
import { findStackedImbalances, type Footprint } from "../lib/footprint.ts";

/** A cell where buy dominates enough to read as a COMPRA imbalance against
 *  the level below it, or the mirror for VENTA — built directly, not
 *  reverse-engineered from raw trades, so each test controls exactly which
 *  levels imbalance and which don't. */
function fp(bucket: number, rows: { price: number; buy: number; sell: number }[]): Footprint {
  const cells = new Map<number, { buy: number; sell: number }>();
  let buy = 0;
  let sell = 0;
  for (const r of rows) {
    cells.set(r.price, { buy: r.buy, sell: r.sell });
    buy += r.buy;
    sell += r.sell;
  }
  return { time: 0, bucket, cells, buy, sell, poc: null, complete: true };
}

// Five consecutive levels, each with a clean 10:1 buy:sell(below) ratio, so
// imbalance() reads COMPRA at every one of them.
function buyStack(bucket: number, fromPrice: number, count: number) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const price = fromPrice + i * bucket;
    // buy at this level vs sell at the level below (price - bucket): 100 vs 5.
    rows.push({ price, buy: 100, sell: 5 });
  }
  return rows;
}

test("no imbalanced cells at all → no stacks", () => {
  const f = fp(1, [{ price: 100, buy: 10, sell: 10 }]);
  assert.deepEqual(findStackedImbalances(f, 101, 99), []);
});

test("two consecutive imbalanced levels is below the default minimum of 3", () => {
  const f = fp(1, buyStack(1, 100, 2));
  assert.deepEqual(findStackedImbalances(f, 103, 100), []);
});

test("exactly 3 consecutive same-direction imbalances qualifies", () => {
  const f = fp(1, buyStack(1, 100, 3));
  const runs = findStackedImbalances(f, 103, 100);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].side, "COMPRA");
  assert.equal(runs[0].levels, 3);
});

test("a longer run reports its true length", () => {
  const f = fp(1, buyStack(1, 100, 6));
  const runs = findStackedImbalances(f, 106, 100);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].levels, 6);
});

test("a non-imbalanced cell in the middle splits one run into two, neither reaching the minimum", () => {
  const rows = [...buyStack(1, 100, 2), { price: 102, buy: 10, sell: 10 }, ...buyStack(1, 103, 2)];
  const f = fp(1, rows);
  assert.deepEqual(findStackedImbalances(f, 104, 100), []);
});

test("two separate stacks (one of each direction) produce two separate runs, not one mixed one", () => {
  // A one-tick gap of thin, non-imbalanced volume between them: the
  // diagonal check compares each level against its immediate neighbor, so a
  // stack placed directly against another stack's boundary cell can distort
  // that one edge cell's own reading (an accurate reflection of the real
  // formula, not something this test needs to exercise) — the gap keeps the
  // two runs cleanly independent, which is the actual behavior being tested.
  const sellStack = [
    { price: 198, sell: 100, buy: 5 },
    { price: 199, sell: 100, buy: 5 },
    { price: 200, sell: 100, buy: 5 },
  ];
  const gap = [{ price: 201, buy: 8, sell: 8 }];
  const rows = [...sellStack, ...gap, ...buyStack(1, 202, 3)];
  const f = fp(1, rows);
  const runs = findStackedImbalances(f, 204, 198);
  assert.equal(runs.length, 2);
  const sides = runs.map((r) => r.side).sort();
  assert.deepEqual(sides, ["COMPRA", "VENTA"]);
});

test("position near the candle's high reads as TECHO", () => {
  const f = fp(1, buyStack(1, 197, 3)); // spans 197..200
  const runs = findStackedImbalances(f, 200, 100); // candle range 100..200
  assert.equal(runs[0].position, "TECHO");
});

test("position near the candle's low reads as BASE", () => {
  const f = fp(1, buyStack(1, 100, 3)); // spans 100..103
  const runs = findStackedImbalances(f, 200, 100);
  assert.equal(runs[0].position, "BASE");
});

test("position away from either edge reads as MEDIO", () => {
  const f = fp(1, buyStack(1, 148, 3)); // spans 148..151, candle 100..200
  const runs = findStackedImbalances(f, 200, 100);
  assert.equal(runs[0].position, "MEDIO");
});

test("minStack is configurable: a lower threshold accepts a 2-level run", () => {
  const f = fp(1, buyStack(1, 100, 2));
  const runs = findStackedImbalances(f, 102, 100, 3, 2);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].levels, 2);
});
