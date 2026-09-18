import assert from "node:assert/strict";
import test from "node:test";
import { buildOverhangBoard, parseOverhang } from "../lib/token-unlocks.ts";

const coin = (patch: Record<string, unknown> = {}) => ({
  symbol: "ej",
  name: "Ejemplo",
  current_price: 2,
  market_cap: 200_000_000,
  circulating_supply: 100_000_000,
  total_supply: 400_000_000,
  max_supply: null,
  ...patch,
});

test("overhang is the locked supply valued at today's price", () => {
  const row = parseOverhang(coin(), new Set());
  assert.ok(row);
  assert.equal(row.symbol, "EJ");
  assert.equal(row.lockedTokens, 300_000_000);
  assert.equal(row.lockedValueUsd, 600_000_000);
  assert.equal(row.unlockedPct, 25);
  // 600M of locked value against a 200M cap: the float could triple.
  assert.equal(row.overhangRatio, 3);
});

test("the ceiling is the larger of total and max supply", () => {
  // A token that can still mint beyond its current total: using total alone
  // would understate what is coming.
  const row = parseOverhang(
    coin({ total_supply: 400_000_000, max_supply: 1_000_000_000 }),
    new Set(),
  );
  assert.equal(row?.total, 1_000_000_000);
  assert.equal(row?.lockedTokens, 900_000_000);
});

test("a fully circulating token shows no overhang rather than a negative one", () => {
  const row = parseOverhang(
    coin({ circulating_supply: 400_000_000, total_supply: 400_000_000 }),
    new Set(),
  );
  assert.equal(row?.lockedTokens, 0);
  assert.equal(row?.overhangRatio, 0);
});

test("circulating reported above total is skipped as bad data", () => {
  // This happens upstream; it is not a negative overhang.
  assert.equal(
    parseOverhang(coin({ circulating_supply: 500_000_000, total_supply: 400_000_000 }), new Set()),
    null,
  );
});

test("records missing any figure the maths needs are skipped, not defaulted", () => {
  assert.equal(parseOverhang(coin({ current_price: null }), new Set()), null);
  assert.equal(parseOverhang(coin({ circulating_supply: 0 }), new Set()), null);
  assert.equal(parseOverhang(coin({ total_supply: null, max_supply: null }), new Set()), null);
  assert.equal(parseOverhang(coin({ market_cap: null }), new Set()), null);
  assert.equal(parseOverhang(null, new Set()), null);
});

test("the board ranks by overhang ratio, not by raw locked value", () => {
  // A huge locked value on a huge cap dilutes less than a modest one on a
  // small cap; ranking by dollars would put them in the wrong order.
  const board = buildOverhangBoard(
    [
      coin({ symbol: "big", market_cap: 100_000_000_000, circulating_supply: 90_000_000, total_supply: 100_000_000 }),
      coin({ symbol: "small", market_cap: 10_000_000, circulating_supply: 10_000_000, total_supply: 100_000_000 }),
    ],
    [],
  );
  assert.ok(board);
  assert.equal(board.ranked[0].symbol, "SMALL");
});

test("watchlist matching strips the pair suffix and the 1000x prefix", () => {
  const board = buildOverhangBoard(
    [coin({ symbol: "pepe" }), coin({ symbol: "sol" }), coin({ symbol: "zzz" })],
    ["1000PEPEUSDT", "SOLUSDT"],
  );
  assert.deepEqual(
    board?.watched.map((r) => r.symbol).sort(),
    ["PEPE", "SOL"],
  );
  assert.equal(board?.ranked.length, 3, "los demás siguen listados");
});

test("a payload that is not a list, or has nothing usable, yields nothing", () => {
  assert.equal(buildOverhangBoard({ error: "rate limited" }, []), null);
  assert.equal(buildOverhangBoard([], []), null);
  assert.equal(buildOverhangBoard([coin({ current_price: null })], []), null);
});

test("the board states that it measures size, not timing", () => {
  const board = buildOverhangBoard([coin()], []);
  assert.match(board?.caveat ?? "", /no cuándo llega/);
});
