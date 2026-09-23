import assert from "node:assert/strict";
import test from "node:test";
import { isPoolTaken, liquidationTotals, mergeLiveCandle, parseForceOrder, parseKline } from "../lib/live-market.ts";

const force = (S: string, patch: Record<string, unknown> = {}) => ({
  e: "forceOrder",
  o: { s: "BTCUSDT", S, q: "0.5", p: "80000", ap: "79950", z: "0.5", T: 1_758_000_000_000, ...patch },
});

test("a forced SELL is a long liquidated; a forced BUY is a short", () => {
  assert.equal(parseForceOrder(force("SELL"))?.side, "LARGOS");
  assert.equal(parseForceOrder(force("BUY"))?.side, "CORTOS");
});

test("notional uses the average fill, not the order's limit price", () => {
  const l = parseForceOrder(force("SELL"));
  assert.equal(l?.price, 79950);
  assert.equal(l?.notionalUsd, 79950 * 0.5);
});

test("empty fill fields fall back to the order's price and size", () => {
  const l = parseForceOrder(force("SELL", { ap: "0", z: "0" }));
  assert.equal(l?.price, 80000);
});

test("malformed liquidation messages are dropped, not defaulted", () => {
  assert.equal(parseForceOrder({}), null);
  assert.equal(parseForceOrder(force("HOLD")), null);
  assert.equal(parseForceOrder(force("SELL", { p: "x", ap: "x" })), null);
});

const kl = (t: number, c: number, x = false) => ({ k: { t, o: "100", h: "110", l: "95", c: String(c), v: "12", x } });
const candle = (time: number, close = 100) => ({ time, open: 100, high: 105, low: 95, close, volume: 10 });

test("the live candle replaces the forming one when open times match", () => {
  const merged = mergeLiveCandle([candle(1), candle(2)], parseKline(kl(2, 108)));
  assert.equal(merged.length, 2);
  assert.equal(merged[1].close, 108);
  assert.equal(merged[1].high, 110);
});

test("a new candle is appended and the window keeps its length", () => {
  const merged = mergeLiveCandle([candle(1), candle(2)], parseKline(kl(3, 101)));
  assert.deepEqual(merged.map((c) => c.time), [2, 3]);
});

test("a late message for an older candle never rewrites history", () => {
  const base = [candle(5), candle(6)];
  assert.equal(mergeLiveCandle(base, parseKline(kl(4, 999))), base);
});

test("totals split by side and name the dominant one only with a real gap", () => {
  const a = parseForceOrder(force("SELL", { ap: "100", z: "10" }))!; // 1,000 longs
  const b = parseForceOrder(force("BUY", { ap: "100", z: "1" }))!; // 100 shorts
  const t = liquidationTotals([a, b]);
  assert.equal(t.longsUsd, 1000);
  assert.equal(t.shortsUsd, 100);
  assert.equal(t.dominant, "LARGOS");
  assert.equal(t.largest, a);
  assert.equal(liquidationTotals([a, { ...a, side: "CORTOS" }]).dominant, "PAREJO");
  assert.equal(liquidationTotals([]).dominant, "PAREJO");
});

test("a pool is taken by a wick through it, on the correct side", () => {
  assert.equal(isPoolTaken({ side: "COMPRA", price: 110 }, { high: 110.5, low: 100 }), true);
  assert.equal(isPoolTaken({ side: "COMPRA", price: 110 }, { high: 109, low: 100 }), false);
  assert.equal(isPoolTaken({ side: "VENTA", price: 95 }, { high: 105, low: 94.9 }), true);
  assert.equal(isPoolTaken({ side: "VENTA", price: 95 }, null), false);
});
