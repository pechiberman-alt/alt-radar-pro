import assert from "node:assert/strict";
import test from "node:test";
import { liquidityAt, mmEvents, passes, runMm, studyMm, targetFor, type LiveLevel, type MmEvent } from "../lib/mm-robot.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const L = (price: number, weight: number, formedTime: number, sweptTime: number | null = null): LiveLevel => ({ price, weight, side: price < 100 ? "long" : "short", formedTime, sweptTime });

test("liquidity at a moment: only levels formed by then and not yet taken, within range", () => {
  const levels = [L(103, 5, 10), L(103.1, 4, 10), L(106, 2, 10), L(97, 3, 10), L(104, 50, 30), L(98, 40, 10, 15), L(130, 99, 0)];
  const at = liquidityAt(levels, 20, 100);
  assert.equal(at.above, 11, "103 + 103,1 + 106; 104 forms later; 130 is out of range");
  assert.equal(at.below, 3, "98 was taken at 15");
  assert.ok(at.poolAbove !== null && Math.abs(at.poolAbove - 103) < 0.3, `pool ${at.poolAbove}`);
  assert.ok(at.poolBelow !== null && Math.abs(at.poolBelow - 97) < 0.3);
  assert.equal(liquidityAt(levels, 15, 100).below, 3, "taken at 15 means gone at 15");
});

const ev = (o: Partial<MmEvent>): MmEvent => ({
  index: 0, time: 0, side: "LONG", entry: 100, stop: 99, risk: 1, rvol: 2, flushRatio: 1.5, above: 10, below: 5, imbalance: 2, pool: 103, withTrend: true, ...o,
});

test("target: the pool when it is 1R–4R away, otherwise 2R", () => {
  assert.equal(targetFor(ev({ pool: 103 })), 103);
  assert.equal(targetFor(ev({ pool: 100.5 })), 102, "too close");
  assert.equal(targetFor(ev({ pool: 106 })), 102, "too far");
  assert.equal(targetFor(ev({ pool: null })), 102);
  assert.equal(targetFor(ev({ side: "SHORT", stop: 101, pool: 97 })), 97);
  assert.equal(targetFor(ev({ side: "SHORT", stop: 101, pool: null })), 98);
});

test("filters: volume, flushed liquidations, liquidity on the target side, trend", () => {
  const all = { vol: true, flush: true, imbalance: true, trend: true };
  assert.equal(passes(ev({}), all), true);
  assert.equal(passes(ev({ rvol: 1.2 }), all), false);
  assert.equal(passes(ev({ flushRatio: null }), all), false);
  assert.equal(passes(ev({ imbalance: 1.2 }), all), false);
  assert.equal(passes(ev({ withTrend: false }), all), false);
  assert.equal(passes(ev({ rvol: 0.1, flushRatio: null, imbalance: null, withTrend: false }), { vol: false, flush: false, imbalance: false, trend: false }), true);
});

const flat = (n: number): SwingCandle[] => Array.from({ length: n }, (_, i) => ({ openTime: i, open: 100, high: 100.3, low: 99.7, close: 100, volume: 1, quoteVolume: 0 }));
const none = { vol: false, flush: false, imbalance: false, trend: false };

test("execution: one position at a time, worst case first, time exit, still open", () => {
  const c = flat(80);
  c[2] = { ...c[2], high: 103.5 }; // first trade hits its pool target at 2
  c[12] = { ...c[12], low: 98.5, high: 104 }; // touches stop and target: stop
  const trades = runMm(c, [ev({ index: 1 }), ev({ index: 2 }), ev({ index: 10 }), ev({ index: 20, pool: null }), ev({ index: 75 })], none);
  assert.deepEqual(trades.map((t) => [t.event.index, t.result]), [[1, "OBJETIVO"], [10, "STOP"], [20, "TIEMPO"], [75, "ABIERTA"]]);
  assert.ok((trades[0].r as number) > 2.8 && (trades[0].r as number) < 3, "3R minus fees");
  assert.ok((trades[1].r as number) < -1);
});

test("study: picks on the first 60%, approves only what also wins on the held-out 40%", () => {
  const n = 400;
  const c = flat(n);
  const events: MmEvent[] = [];
  for (let i = 5, k = 0; i < n - 5; i += 10, k += 1) {
    const winner = k % 2 === 0;
    // No liquidation data on these, so the "liquidaciones" variant never trades.
    events.push(ev({ index: i, rvol: winner ? 2 : 1, pool: null, flushRatio: null }));
    c[i + 1] = winner ? { ...c[i + 1], high: 102.5 } : { ...c[i + 1], low: 98.5 };
  }
  const study = studyMm(c, events);
  assert.equal(study.split, 240);
  assert.ok(study.best, "something approved");
  assert.equal(study.best!.name, "volumen", "only the volume variant wins every trade, in and out of sample");
  assert.equal(study.best!.outSample.losses, 0);
  const flushOnly = study.variants.find((v) => v.name === "liquidaciones")!;
  assert.equal(flushOnly.approved, false);
});

test("study: a variant that only worked in the first part is not approved", () => {
  const n = 400;
  const c = flat(n);
  const events: MmEvent[] = [];
  for (let i = 5; i < n - 5; i += 10) {
    events.push(ev({ index: i, pool: null }));
    c[i + 1] = i < 240 ? { ...c[i + 1], high: 102.5 } : { ...c[i + 1], low: 98.5 };
  }
  const study = studyMm(c, events);
  assert.equal(study.best, null);
  assert.ok(study.variants.every((v) => !v.approved));
});

test("events carry the liquidity picture of their own moment", () => {
  // The LIQ+VOL sweep scenario: swing low at 35, swept and reclaimed at 45.
  const c: SwingCandle[] = Array.from({ length: 80 }, (_, i) => ({ openTime: i, open: 100, high: 100.5, low: 99.5, close: 100.2, volume: i === 45 ? 400 : 100, quoteVolume: 0 }));
  c[35] = { ...c[35], low: 98 };
  c[45] = { ...c[45], open: 99.3, high: 99.6, low: 97.5, close: 99 };
  const levels = [L(103, 10, 20), L(101, 3, 20), L(96, 2, 20), L(104, 99, 60)];
  const [e] = mmEvents(c, levels, null);
  assert.equal(e.index, 45);
  assert.equal(e.side, "LONG");
  assert.equal(e.above, 13, "the 104 pool forms after the signal and is not seen");
  assert.equal(e.below, 2);
  assert.equal(e.imbalance, 6.5);
  assert.ok(e.pool !== null && Math.abs(e.pool - 103) < 0.3);
});

import { studyMmPooled } from "../lib/mm-robot.ts";

/** A coin whose trades all win (or all lose), one every 10 candles, split 60/40 like the study. */
function coin(symbol: string, outcome: "win" | "lose" | "winThenLose", n = 400) {
  const c = flat(n);
  const events: MmEvent[] = [];
  for (let i = 5; i < n - 5; i += 10) {
    events.push(ev({ index: i, pool: null }));
    const win = outcome === "win" || (outcome === "winThenLose" && i < n * 0.6);
    c[i + 1] = win ? { ...c[i + 1], high: 102.5 } : { ...c[i + 1], low: 98.5 };
  }
  return { symbol, candles: c, events };
}

test("pooled study: trades of every coin add up, each coin split on its own", () => {
  const s = studyMmPooled([coin("A", "win"), coin("B", "win"), coin("C", "lose")], { minIn: 10, minOut: 5 });
  const v = s.variants.find((x) => x.name === "solo barrida")!;
  assert.equal(v.inSample.resolved, 24 * 3);
  assert.equal(v.outSample.resolved, 15 * 3);
  assert.deepEqual(v.perCoin.map((p) => [p.symbol, p.outSample.wins, p.outSample.losses]), [["A", 15, 0], ["B", 15, 0], ["C", 0, 15]]);
  assert.deepEqual(v.breadth, { tested: 3, positive: 2 });
  assert.equal(v.approved, true, "two of three coins win in validation and the pool makes money");
  assert.equal(s.events, 39 * 3);
});

test("pooled study: one lucky coin carrying the pool is not enough", () => {
  // One coin wins big, three lose: the pool can still look fine, breadth says no.
  const big = coin("A", "win");
  big.events = big.events.map((e) => ({ ...e, pool: 104 }));
  big.candles = big.candles.map((c, i) => (big.events.some((e) => e.index + 1 === i) ? { ...c, high: 104.5 } : c));
  const s = studyMmPooled([big, coin("B", "lose"), coin("C", "lose"), coin("D", "lose")], { minIn: 10, minOut: 5 });
  const v = s.variants.find((x) => x.name === "solo barrida")!;
  assert.ok((v.outSample.profitFactor ?? 0) < 1.1 || v.breadth.positive * 2 < v.breadth.tested);
  assert.equal(v.approved, false);
});

test("pooled study: what only worked in the older part is rejected; too few trades is rejected", () => {
  assert.equal(studyMmPooled([coin("A", "winThenLose"), coin("B", "winThenLose")], { minIn: 10, minOut: 5 }).best, null);
  assert.equal(studyMmPooled([coin("A", "win")]).best, null, "defaults need 40 + 20 trades");
});
