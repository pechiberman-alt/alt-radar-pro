import assert from "node:assert/strict";
import test from "node:test";
import { bucketSize, buildFootprints, candleDelta, cumulativeDelta, imbalance, parseAggTrade } from "../lib/footprint.ts";
import { findSweeps, sweepStats } from "../lib/liquidity-sweeps.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

test("candle delta splits volume by aggressor from the taker-buy field", () => {
  assert.deepEqual(candleDelta(10, 7), { buy: 7, sell: 3, delta: 4 });
  assert.equal(candleDelta(10, undefined), null);
  assert.deepEqual(candleDelta(10, 12), { buy: 10, sell: 0, delta: 10 }, "nunca más compra que volumen");
});

test("CVD accumulates and carries across gaps", () => {
  assert.deepEqual(cumulativeDelta([null, 2, -1, null, 3]), [null, 2, 1, 1, 4]);
});

test("bucket size is round and gives about ten rows", () => {
  assert.equal(bucketSize([100, 120, 90]), 10);
  assert.equal(bucketSize([0.03, 0.05]), 0.005);
});

const t = (id: number, price: number, qty: number, time: number, buyerIsMaker: boolean) => ({ id, price, qty, time, buyerIsMaker });

test("trades land in their candle and price row; maker-buyer trades are sells", () => {
  const fps = buildFootprints(
    [t(1, 100.4, 2, 0, false), t(2, 100.6, 1, 10, true), t(3, 101.2, 5, 60_000, false)],
    [0, 60_000],
    60_000,
    1,
    0,
  );
  const first = fps.get(0)!;
  assert.equal(first.buy, 2);
  assert.equal(first.sell, 1);
  assert.deepEqual(first.cells.get(100), { buy: 2, sell: 1 });
  assert.equal(fps.get(60_000)!.poc, 101);
});

test("a candle that opened before the first trade seen is partial, not complete", () => {
  const fps = buildFootprints([t(1, 100, 1, 90_000, false)], [0, 60_000], 60_000, 1, 90_000);
  assert.equal(fps.get(60_000)!.complete, false);
});

test("diagonal imbalance compares buys with sells one row below", () => {
  const fps = buildFootprints(
    [t(1, 101, 9, 0, false), t(2, 100, 2, 0, true), t(3, 100, 1, 0, false)],
    [0],
    60_000,
    1,
    0,
  );
  assert.equal(imbalance(fps.get(0)!, 101), "COMPRA");
});

test("aggTrade messages parse; malformed ones are dropped", () => {
  assert.deepEqual(parseAggTrade({ a: 5, p: "100.5", q: "0.2", T: 1, m: true }), t(5, 100.5, 0.2, 1, true));
  assert.equal(parseAggTrade({ p: "x" }), null);
});

const c = (i: number, o: number, h: number, l: number, cl: number): SwingCandle => ({ openTime: i, open: o, high: h, low: l, close: cl, volume: 1, quoteVolume: 0 });
function withHigh(breakClose: number) {
  const out: SwingCandle[] = [];
  for (let i = 0; i < 10; i += 1) out.push(c(i, 100, 101, 99, 100));
  out.push(c(10, 100, 110, 99, 105)); // pivot high 110
  for (let i = 11; i < 20; i += 1) out.push(c(i, 100, 102, 98, 100));
  out.push(c(20, 104, 112, 103, breakClose)); // pierces 110
  for (let i = 21; i < 40; i += 1) out.push(c(i, 100, 101, 99, 100));
  return out;
}

test("a wick above a swing high that closes back below is a buy-side sweep", () => {
  const s = findSweeps(withHigh(106));
  const sweep = s.find((x) => x.side === "COMPRA");
  assert.ok(sweep);
  assert.equal(sweep.level, 110);
  assert.equal(sweep.index, 20);
});

test("closing beyond the level is a breakout, not a sweep", () => {
  assert.equal(findSweeps(withHigh(111)).filter((x) => x.side === "COMPRA").length, 0);
});

test("sweep stats resolve only when the horizon has passed", () => {
  const s = findSweeps(withHigh(106));
  const st = sweepStats(withHigh(106), s);
  assert.ok(st.tested >= 1);
  assert.equal(sweepStats(withHigh(106).slice(0, 25), findSweeps(withHigh(106).slice(0, 25))).tested, 0);
});
