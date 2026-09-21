import assert from "node:assert/strict";
import test from "node:test";
import { buildScenarios } from "../lib/scenario-analysis.ts";
import type { LiquidityPool } from "../lib/liquidity-pools.ts";
import type { OrderBlock } from "../lib/order-blocks.ts";
import type { FairValueGap } from "../lib/fair-value-gaps.ts";

const pool = (side: "COMPRA" | "VENTA", price: number): LiquidityPool => ({
  side,
  price,
  touches: 2,
  formedAt: 0,
  swept: false,
  sweptAt: null,
  strength: 70,
});

const block = (side: "ALCISTA" | "BAJISTA", mid: number): OrderBlock => ({
  side,
  low: mid - 5,
  high: mid + 5,
  mid,
  index: 0,
  time: 0,
  displacement: 3,
  volumeRatio: 2,
  volumeUsd: 1_000_000,
  strength: 70,
  ageCandles: 5,
});

const empty = { pools: [], orderBlocks: [], gaps: [] as FairValueGap[], heatmap: null };

test("with a level above and below, both directional scenarios are built", () => {
  const board = buildScenarios({
    currentPrice: 100,
    ...empty,
    pools: [pool("COMPRA", 105), pool("VENTA", 95)],
  });
  assert.ok(board);
  const ids = board.scenarios.map((s) => s.id);
  assert.ok(ids.includes("ALCISTA"));
  assert.ok(ids.includes("BAJISTA"));
});

test("neither directional scenario is favoured over the other", () => {
  const board = buildScenarios({
    currentPrice: 100,
    ...empty,
    pools: [pool("COMPRA", 105), pool("VENTA", 95)],
  });
  assert.ok(board);
  // Nothing in the shape carries a rank, a probability, or a preferred flag.
  for (const scenario of board.scenarios) {
    assert.ok(!("probability" in scenario));
    assert.ok(!("rank" in scenario));
  }
  assert.match(board.note, /no se favorece uno sobre otro/);
});

test("the target is the next level far enough away to be distinct from the trigger", () => {
  const board = buildScenarios({
    currentPrice: 100,
    ...empty,
    pools: [pool("COMPRA", 105)],
    orderBlocks: [block("ALCISTA", 105.1), block("ALCISTA", 130)],
  });
  const bullish = board?.scenarios.find((s) => s.id === "ALCISTA");
  assert.ok(bullish);
  // 105 and 105.1 are the same level in practice; the real target is 130.
  assert.ok(bullish.target && Math.abs(bullish.target.price - 130) < 1);
});

test("confluence at the target is named, not just its own kind", () => {
  const board = buildScenarios({
    currentPrice: 100,
    ...empty,
    pools: [pool("COMPRA", 105)],
    orderBlocks: [block("ALCISTA", 130)],
    gaps: [
      {
        kind: "FVG",
        side: "ALCISTA",
        low: 128,
        high: 132,
        mid: 130,
        index: 0,
        time: 0,
        size: 2,
        filledPct: 0,
        quality: 80,
        volumeUsd: 500_000,
        ageCandles: 5,
      },
    ],
  });
  const bullish = board?.scenarios.find((s) => s.id === "ALCISTA");
  assert.ok(bullish?.target);
  assert.ok(bullish.target.confluences.some((c) => c.includes("FVG")));
});

test("the sweep-and-reverse reading only appears when two pools genuinely squeeze price", () => {
  const tight = buildScenarios({
    currentPrice: 100,
    ...empty,
    pools: [pool("COMPRA", 101), pool("VENTA", 99)], // 2% apart
  });
  assert.ok(tight?.scenarios.some((s) => s.id === "BARRIDO"));

  const wide = buildScenarios({
    currentPrice: 100,
    ...empty,
    pools: [pool("COMPRA", 140), pool("VENTA", 60)], // far apart
  });
  assert.ok(!wide?.scenarios.some((s) => s.id === "BARRIDO"));
});

test("liquidity sweeps are framed as conditional on rejection vs holding, not asserted either way", () => {
  const board = buildScenarios({
    currentPrice: 100,
    ...empty,
    pools: [pool("COMPRA", 105), pool("VENTA", 95)],
  });
  const bullish = board?.scenarios.find((s) => s.id === "ALCISTA");
  assert.match(bullish?.reasoning ?? "", /se mantiene ahí/, "la continuación depende de que el precio lo sostenga, no de tocarlo");
});

test("a level with nothing beyond it says so instead of inventing a target", () => {
  const board = buildScenarios({ currentPrice: 100, ...empty, pools: [pool("COMPRA", 105)] });
  const bullish = board?.scenarios.find((s) => s.id === "ALCISTA");
  assert.equal(bullish?.target, null);
  assert.match(bullish?.reasoning ?? "", /sin un objetivo estructural claro/);
});

test("no inputs at all yields nothing rather than an empty shell", () => {
  assert.equal(buildScenarios({ currentPrice: 100, ...empty }), null);
  assert.equal(buildScenarios({ currentPrice: 0, ...empty, pools: [pool("COMPRA", 105)] }), null);
});
