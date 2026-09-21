import assert from "node:assert/strict";
import test from "node:test";
import { findLiquidityPools } from "../lib/liquidity-pools.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const c = (i: number, price: number, high = price + 1, low = price - 1): SwingCandle => ({
  openTime: 1_757_000_000_000 + i * 3_600_000,
  open: price,
  close: price,
  high,
  low,
  volume: 100,
  quoteVolume: 0,
});

/** A confirmed pivot needs quieter candles either side of the turn. */
const calm = (count: number, price: number, from: number) =>
  Array.from({ length: count }, (_, i) => c(from + i, price, price + 1, price - 1));

test("two highs at nearly the same price form a buy-side pool", () => {
  const candles = [
    ...calm(10, 1000, 0),
    c(10, 1050, 1055, 1049), // first equal high
    ...calm(6, 1030, 11),
    c(17, 1052, 1056, 1048), // second equal high, close by
    ...calm(10, 1030, 18),
  ];
  const pools = findLiquidityPools(candles);
  const pool = pools.find((p) => p.side === "COMPRA");
  assert.ok(pool, "dos maximos cercanos deben formar una pileta");
  assert.equal(pool.touches, 2);
  assert.equal(pool.swept, false);
});

test("a single high, with nothing equal, forms no pool", () => {
  const candles = [...calm(10, 1000, 0), c(10, 1050, 1055, 1049), ...calm(15, 1030, 11)];
  const pools = findLiquidityPools(candles);
  assert.deepEqual(pools.filter((p) => p.side === "COMPRA"), []);
});

test("a wick through the level sweeps it — a close back below does not save it", () => {
  const candles = [
    ...calm(10, 1000, 0),
    c(10, 1050, 1055, 1049),
    ...calm(6, 1030, 11),
    c(17, 1052, 1056, 1048),
    ...calm(4, 1030, 18),
    // Wicks above the pool but CLOSES back below — under the supply/demand
    // rule this would still hold; under the liquidity-pool rule it is spent
    // the instant the wick touches it, because the resting orders already
    // fired.
    c(22, 1030, 1058, 1029),
    ...calm(8, 1030, 23),
  ];
  const pools = findLiquidityPools(candles);
  assert.equal(
    pools.find((p) => p.side === "COMPRA"),
    undefined,
    "el pool ya fue barrido, no debe seguir en el mapa como activo",
  );
});

test("the mirror case: equal lows form sell-side liquidity below", () => {
  const candles = [
    ...calm(10, 1000, 0),
    c(10, 950, 951, 945),
    ...calm(6, 970, 11),
    c(17, 948, 949, 944),
    ...calm(10, 970, 18),
  ];
  const pools = findLiquidityPools(candles);
  const pool = pools.find((p) => p.side === "VENTA");
  assert.ok(pool);
  assert.equal(pool.touches, 2);
});

test("pivots too far apart in price do not cluster into one pool", () => {
  const candles = [
    ...calm(10, 1000, 0),
    c(10, 1050, 1055, 1049),
    ...calm(6, 1030, 11),
    // Over 1% away from the first high — well outside the default 0.15% tolerance.
    c(17, 1080, 1085, 1078),
    ...calm(10, 1030, 18),
  ];
  const pools = findLiquidityPools(candles);
  assert.deepEqual(pools.filter((p) => p.side === "COMPRA"), []);
});

test("more touches and a tighter cluster score higher strength", () => {
  const twoTouches = [
    ...calm(10, 1000, 0),
    c(10, 1050, 1055, 1049),
    ...calm(6, 1030, 11),
    c(17, 1050.3, 1055, 1048),
    ...calm(10, 1030, 18),
  ];
  const threeTouches = [
    ...calm(10, 1000, 0),
    c(10, 1050, 1055, 1049),
    ...calm(6, 1030, 11),
    c(17, 1050.3, 1055, 1048),
    ...calm(6, 1030, 18),
    c(24, 1050.1, 1055, 1048),
    ...calm(10, 1030, 25),
  ];
  const a = findLiquidityPools(twoTouches).find((p) => p.side === "COMPRA");
  const b = findLiquidityPools(threeTouches).find((p) => p.side === "COMPRA");
  assert.ok(a && b);
  assert.ok(b.strength > a.strength, "tres toques debe pesar mas que dos");
});

test("too little history yields nothing rather than a guess", () => {
  assert.deepEqual(findLiquidityPools([]), []);
  assert.deepEqual(findLiquidityPools(calm(10, 1000, 0)), []);
});

test("results are capped and ordered by price, high to low", () => {
  const candles = [
    ...calm(10, 1000, 0),
    c(10, 1100, 1105, 1099),
    ...calm(6, 1030, 11),
    c(17, 1101, 1105, 1098),
    ...calm(6, 1030, 18),
    c(24, 900, 901, 895),
    ...calm(6, 950, 25),
    c(31, 899, 901, 894),
    ...calm(10, 950, 32),
  ];
  const pools = findLiquidityPools(candles, { limit: 2 });
  assert.ok(pools.length <= 2);
  for (let i = 1; i < pools.length; i += 1) assert.ok(pools[i - 1].price >= pools[i].price);
});
