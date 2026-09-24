import assert from "node:assert/strict";
import test from "node:test";
import { futuresStreamCategory, futuresStreamUrl } from "../lib/binance-ws.ts";

test("candles, trades, tickers and liquidations route to /market", () => {
  for (const s of ["btcusdt@kline_1h", "btcusdt@aggTrade", "!forceOrder@arr", "btcusdt@forceOrder", "!miniTicker@arr", "btcusdt@markPrice@1s"]) {
    assert.equal(futuresStreamCategory(s), "market", s);
  }
});

test("order-book streams route to /public", () => {
  for (const s of ["btcusdt@depth20@100ms", "btcusdt@depth", "btcusdt@bookTicker", "!bookTicker"]) {
    assert.equal(futuresStreamCategory(s), "public", s);
  }
});

test("the URL uses the routed path, never the retired root", () => {
  const url = futuresStreamUrl(["btcusdt@kline_1h", "!forceOrder@arr"]);
  assert.equal(url, "wss://fstream.binance.com/market/stream?streams=btcusdt@kline_1h/!forceOrder@arr");
  assert.doesNotMatch(url, /fstream\.binance\.com\/stream/);
});

test("mixing categories on one connection is refused", () => {
  assert.throws(() => futuresStreamUrl(["btcusdt@depth", "btcusdt@kline_1m"]));
  assert.throws(() => futuresStreamUrl([]));
});
