import assert from "node:assert/strict";
import test from "node:test";
import { flowVerdict, stackTally, type FlowCandle, type Footprint } from "../lib/footprint.ts";

/** buyShare is the fraction of the candle's volume bought by aggressors. */
const c = (buyShare: number, open = 100, close = 100, volume = 1000): FlowCandle => ({
  open, close, volume, takerBuy: volume * buyShare,
});
const run = (n: number, buyShare: number, open = 100, close = 100) =>
  Array.from({ length: n }, () => c(buyShare, open, close));

test("fewer than 3 candles with taker data → no verdict, rather than one built on nothing", () => {
  assert.equal(flowVerdict(run(2, 0.6)), null);
  assert.equal(flowVerdict([]), null);
});

test("candles without taker data or without volume are ignored, not counted as balanced", () => {
  const list = [...run(5, 0.62), { open: 100, close: 100, volume: 1000 }, { open: 100, close: 100, volume: 0, takerBuy: 0 }];
  const v = flowVerdict(list)!;
  assert.equal(v.candles, 5);
  assert.equal(v.winner, "COMPRADORES");
});

test("aggressive buyers winning is reported as such, with the share and the delta", () => {
  const v = flowVerdict(run(10, 0.6))!;
  assert.equal(v.winner, "COMPRADORES");
  assert.ok(Math.abs(v.buyPct - 60) < 1e-9);
  assert.ok(Math.abs(v.delta - 10 * (600 - 400)) < 1e-6);
});

test("aggressive sellers winning is the mirror image, with a negative delta", () => {
  const v = flowVerdict(run(10, 0.4))!;
  assert.equal(v.winner, "VENDEDORES");
  assert.ok(v.delta < 0);
});

test("within two points of 50% is balanced — noise, not a winner", () => {
  for (const share of [0.49, 0.5, 0.51]) {
    const v = flowVerdict(run(10, share))!;
    assert.equal(v.winner, "EQUILIBRADO", String(share));
    assert.equal(v.strength, null);
  }
});

test("strength grows with the gap: leve, moderado, fuerte", () => {
  assert.equal(flowVerdict(run(10, 0.53))!.strength, "LEVE");
  assert.equal(flowVerdict(run(10, 0.57))!.strength, "MODERADO");
  assert.equal(flowVerdict(run(10, 0.63))!.strength, "FUERTE");
  assert.equal(flowVerdict(run(10, 0.37))!.strength, "FUERTE");
});

test("a takerBuy larger than the candle's volume can't push the share past 100%", () => {
  const list = run(5, 1.5); // takerBuy = 1.5 × volume, impossible in real data
  const v = flowVerdict(list)!;
  assert.ok(v.buyPct <= 100);
});

test("recent momentum is reported only when there are more candles than the recent window", () => {
  assert.equal(flowVerdict(run(5, 0.6), { recent: 5 })!.recent, null);
  const v = flowVerdict([...run(10, 0.6), ...run(5, 0.4)], { recent: 5 })!;
  assert.equal(v.recent!.winner, "VENDEDORES");
  assert.equal(v.recent!.candles, 5);
});

test("a recent flip against the window's winner is called out", () => {
  const v = flowVerdict([...run(15, 0.62), ...run(5, 0.4)], { recent: 5 })!;
  assert.equal(v.winner, "COMPRADORES");
  assert.ok(v.notes.some((n) => n.startsWith("Cambio reciente")));
});

test("buyers winning while price FALLS is reported as absorption, not as bullish", () => {
  const v = flowVerdict(run(10, 0.62, 100, 98))!; // every candle opens 100, closes 98
  assert.equal(v.winner, "COMPRADORES");
  assert.ok(v.priceChangePct! < -1);
  assert.ok(v.notes.some((n) => n.includes("absorbiendo")));
});

test("sellers winning while price RISES is the mirror absorption reading", () => {
  const v = flowVerdict(run(10, 0.38, 100, 102))!;
  assert.equal(v.winner, "VENDEDORES");
  assert.ok(v.notes.some((n) => n.includes("compradores parecen estar absorbiendo")));
});

test("no absorption note when price agrees with the winner, or when the win is only slight", () => {
  assert.equal(flowVerdict(run(10, 0.62, 100, 102))!.notes.length, 0);
  assert.equal(flowVerdict(run(10, 0.53, 100, 98))!.notes.length, 0);
});

test("price change is measured over the whole input window, first open to last close", () => {
  const v = flowVerdict([c(0.5, 200, 205), c(0.5, 205, 210), c(0.5, 210, 220)])!;
  assert.ok(Math.abs(v.priceChangePct! - 10) < 1e-9);
});

// ─── stackTally ───────────────────────────────────────────────────────────

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

test("stackTally counts stacked runs per side and skips candles with no footprint", () => {
  const buyStack = fp(1, [100, 101, 102].map((price) => ({ price, buy: 100, sell: 5 })));
  const tally = stackTally([
    { fp: buyStack, high: 103, low: 100 },
    { fp: null, high: 103, low: 100 },
    { fp: undefined, high: 103, low: 100 },
  ]);
  assert.equal(tally.candles, 1);
  assert.equal(tally.compra, 1);
  assert.equal(tally.venta, 0);
});
