import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBigTradeBoard,
  largeThreshold,
  parseAggTrades,
} from "../lib/big-trades.ts";

const T0 = Date.UTC(2026, 8, 18, 12, 0, 0);
const raw = (price: number, qty: number, buyerIsMaker: boolean, minute = 0) => ({
  p: String(price),
  q: String(qty),
  T: T0 + minute * 60_000,
  m: buyerIsMaker,
});

test("aggressor side comes from the maker flag, not from volume", () => {
  // m=true means the buyer was the maker, so the SELLER crossed the spread.
  const trades = parseAggTrades([raw(100, 1, true), raw(100, 1, false)]);
  assert.equal(trades[0].side, "VENTA");
  assert.equal(trades[1].side, "COMPRA");
});

test("malformed rows are dropped rather than defaulted", () => {
  const trades = parseAggTrades([
    raw(100, 1, false),
    { p: "abc", q: "1", T: T0, m: false },
    { p: "100", q: "0", T: T0, m: false },
    { p: "100", q: "1", T: T0 },
    null,
    "nope",
  ]);
  assert.equal(trades.length, 1, "sólo la fila válida sobrevive");
});

test("trades come back oldest first regardless of feed order", () => {
  const trades = parseAggTrades([raw(100, 1, false, 5), raw(100, 1, false, 1)]);
  assert.ok(trades[0].time < trades[1].time);
});

test("the large threshold scales with the symbol's own tape", () => {
  const small = Array.from({ length: 100 }, () => raw(100, 1, false));
  const big = Array.from({ length: 100 }, () => raw(100_000, 1, false));
  assert.ok(
    largeThreshold(parseAggTrades(big)) > largeThreshold(parseAggTrades(small)),
    "un umbral fijo en dólares no serviría para pares de escalas distintas",
  );
});

/** 120 ordinary prints plus a few large ones on the requested side. */
const tape = (bigBuys: number, bigSells: number) => [
  ...Array.from({ length: 120 }, (_, i) => raw(100, 1, i % 2 === 0, i)),
  ...Array.from({ length: bigBuys }, (_, i) => raw(100, 5_000, false, 130 + i)),
  ...Array.from({ length: bigSells }, (_, i) => raw(100, 5_000, true, 200 + i)),
];

test("aggressive buying at size reads as accumulation", () => {
  const board = buildBigTradeBoard("BTCUSDT", tape(8, 1));
  assert.ok(board);
  assert.equal(board.bias, "ACUMULACIÓN");
  assert.ok(board.netUsd > 0);
  assert.ok(board.buyShare > 62);
  assert.match(board.reading, /urgencia/);
});

test("aggressive selling at size reads as distribution", () => {
  const board = buildBigTradeBoard("BTCUSDT", tape(1, 8));
  assert.equal(board?.bias, "DISTRIBUCIÓN");
  assert.ok((board?.netUsd ?? 0) < 0);
});

test("large prints on both sides read as balanced, not as a signal", () => {
  const board = buildBigTradeBoard("BTCUSDT", tape(5, 5));
  assert.equal(board?.bias, "EQUILIBRADO");
  assert.match(board?.reading ?? "", /ningún lado está presionando/);
});

test("a quiet tape cannot promote tiny prints to large", () => {
  // Every print is $100; without a floor the percentile would call some of
  // them "large" and the panel would report noise as whale activity.
  const board = buildBigTradeBoard(
    "BTCUSDT",
    Array.from({ length: 200 }, (_, i) => raw(100, 1, i % 2 === 0, i)),
  );
  assert.equal(board, null);
});

test("too little tape yields nothing rather than a conclusion", () => {
  assert.equal(buildBigTradeBoard("BTCUSDT", tape(0, 0).slice(0, 10)), null);
  assert.equal(buildBigTradeBoard("BTCUSDT", []), null);
  assert.equal(buildBigTradeBoard("BTCUSDT", { error: "rate limited" }), null);
});

test("the board reports the window it actually covers", () => {
  const board = buildBigTradeBoard("BTCUSDT", tape(8, 1));
  assert.ok((board?.windowMinutes ?? 0) > 100, "no se insinúa un período que no se midió");
});

test("listed trades are newest first and capped", () => {
  const board = buildBigTradeBoard("BTCUSDT", tape(30, 30));
  assert.ok(board);
  assert.ok(board.trades.length <= 40);
  for (let i = 1; i < board.trades.length; i += 1) {
    assert.ok(board.trades[i - 1].time >= board.trades[i].time);
  }
});
