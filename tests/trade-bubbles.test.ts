import assert from "node:assert/strict";
import test from "node:test";
import { bubbleRadius, dollarsShort, pickBubbles } from "../lib/trade-bubbles.ts";
import type { Trade } from "../lib/footprint.ts";

const tr = (id: number, time: number, price: number, qty: number, buyerIsMaker = false): Trade => ({ id, time, price, qty, buyerIsMaker });
/** 1000 small orders of $100 and a few big ones. */
function market(): Trade[] {
  const small = Array.from({ length: 1000 }, (_, i) => tr(i, 1000 + i, 100, 1, i % 2 === 0));
  return [...small, tr(5001, 1500, 100, 500), tr(5002, 1600, 100, 2000, true), tr(5003, 1700, 100, 50)];
}

test("automatic: the top 0,5% of on-screen orders, sides from the aggressor, biggest drawn last", () => {
  const { bubbles, threshold, seen } = pickBubbles(market(), { from: 0, to: 10_000 });
  assert.equal(seen, 1003);
  assert.equal(threshold, 100, "the percentile lands on the crowd's size…");
  assert.ok(bubbles.every((b) => b.notional > 100), "…and only orders above it qualify");
  assert.deepEqual(bubbles.map((b) => b.id), [5003, 5001, 5002]);
  assert.equal(bubbles.find((b) => b.id === 5002)!.side, "VENTA", "buyer was maker: aggressive sell");
  assert.equal(bubbles.find((b) => b.id === 5001)!.side, "COMPRA");
  assert.equal(bubbles.find((b) => b.id === 5002)!.notional, 200_000);
});

test("only orders inside the visible window count, for the threshold too", () => {
  const { bubbles, seen } = pickBubbles(market(), { from: 1550, to: 10_000 });
  assert.ok(seen < 1003);
  assert.ok(!bubbles.some((b) => b.id === 5001), "printed before the window");
});

test("a fixed minimum replaces the automatic one", () => {
  const { bubbles, threshold } = pickBubbles(market(), { from: 0, to: 10_000, minNotional: 10_000 });
  assert.equal(threshold, 10_000);
  assert.deepEqual(bubbles.map((b) => b.id), [5001, 5002]);
});

test("the count is capped keeping the largest", () => {
  const many = Array.from({ length: 400 }, (_, i) => tr(i, i, 100, 10 + i));
  const { bubbles } = pickBubbles(many, { from: 0, to: 1_000, minNotional: 1, max: 5 });
  assert.deepEqual(bubbles.map((b) => b.id), [395, 396, 397, 398, 399]);
});

test("a crowd of identical small orders never turns into bubbles", () => {
  const same = Array.from({ length: 1000 }, (_, i) => tr(i, i, 100, 1));
  assert.deepEqual(pickBubbles(same, { from: 0, to: 10_000 }).bubbles, []);
});

test("too few orders on screen: no automatic bubbles rather than inventing whales", () => {
  assert.deepEqual(pickBubbles([tr(1, 1, 100, 5), tr(2, 2, 100, 500)], { from: 0, to: 10 }).bubbles, []);
  assert.deepEqual(pickBubbles([], { from: 0, to: 10 }), { bubbles: [], threshold: null, seen: 0 });
  assert.equal(pickBubbles([tr(1, 1, 100, 5), tr(2, 2, 100, 500)], { from: 0, to: 10, minNotional: 1000 }).bubbles.length, 1, "with a fixed minimum it still works");
});

test("radius: area proportional to size, clamped, never zero", () => {
  assert.equal(bubbleRadius(100, 100), 18);
  assert.ok(Math.abs(bubbleRadius(25, 100) - 9) < 1e-9, "a quarter of the size, half the radius");
  assert.equal(bubbleRadius(0.0001, 100), 3);
  assert.equal(bubbleRadius(5, 0), 3);
});

test("short dollar labels", () => {
  assert.equal(dollarsShort(1_234_567), "$1,2M");
  assert.equal(dollarsShort(12_000_000), "$12M");
  assert.equal(dollarsShort(1_000_000), "$1M");
  assert.equal(dollarsShort(52_400), "$52K");
  assert.equal(dollarsShort(800), "$800");
});
