import assert from "node:assert/strict";
import test from "node:test";
import { findOrderBlocks } from "../lib/order-blocks.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const candle = (
  i: number,
  open: number,
  close: number,
  opts: { high?: number; low?: number; volume?: number } = {},
): SwingCandle => ({
  openTime: 1_757_000_000_000 + i * 3_600_000,
  open,
  close,
  high: opts.high ?? Math.max(open, close) + 1,
  low: opts.low ?? Math.min(open, close) - 1,
  volume: opts.volume ?? 100,
  quoteVolume: 0,
});

/**
 * Flat range of dojis: the baseline every scenario is built on.
 *
 * Deliberately open === close. An alternating up/down filler would itself
 * produce valid order-block candidates — the detector was right to find them
 * and the first version of these tests was wrong to call that a failure — so
 * the baseline has to be directionless for a scenario to isolate one case.
 */
const flat = (count: number, price = 1000, from = 0) =>
  Array.from({ length: count }, (_, i) =>
    candle(from + i, price, price, { high: price + 1, low: price - 1 }),
  );

/** A down candle followed by an impulse that clears the range high. */
const bullishScenario = () => [
  ...flat(25),
  candle(25, 1000, 995, { high: 1001, low: 994, volume: 400 }),
  candle(26, 995, 1020, { high: 1022, low: 994 }),
  candle(27, 1020, 1035, { high: 1037, low: 1019 }),
  ...flat(12, 1040, 28),
];

test("a down candle before a structure-breaking impulse is a bullish block", () => {
  const blocks = findOrderBlocks(bullishScenario());
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].side, "ALCISTA");
  assert.equal(blocks[0].index, 25);
  assert.ok(blocks[0].displacement >= 1.8);
  assert.ok(blocks[0].volumeRatio > 3, "el volumen de la vela origen se reporta");
});

test("the mirror case produces a bearish block", () => {
  const blocks = findOrderBlocks([
    ...flat(25),
    candle(25, 1000, 1005, { high: 1006, low: 999, volume: 400 }),
    candle(26, 1005, 980, { high: 1006, low: 978 }),
    candle(27, 980, 965, { high: 981, low: 963 }),
    ...flat(12, 960, 28),
  ]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].side, "BAJISTA");
});

test("an impulse too small against recent range is not a block", () => {
  // A wider baseline, so average range is ~10 and a 16-point move is only
  // 1.6x — under the threshold. The move still breaks the prior high, so
  // this isolates displacement rather than passing for a second reason.
  const wide = (count: number, price: number, from: number) =>
    Array.from({ length: count }, (_, i) =>
      candle(from + i, price, price, { high: price + 5, low: price - 5 }),
    );
  const blocks = findOrderBlocks([
    ...wide(25, 1000, 0),
    candle(25, 1000, 995, { high: 1001, low: 994 }),
    candle(26, 995, 1008, { high: 1010, low: 994 }),
    ...wide(12, 1008, 27),
  ]);
  assert.deepEqual(blocks, [], "un movimiento ordinario no es desplazamiento");
});

test("an impulse that does not break the prior range is rejected", () => {
  // Big move, but it stays under the high the range already made.
  const blocks = findOrderBlocks([
    ...Array.from({ length: 25 }, (_, i) =>
      candle(i, 1000, 1000, { high: 1100, low: 990 }),
    ),
    candle(25, 1000, 995, { high: 1001, low: 994, volume: 400 }),
    candle(26, 995, 1030, { high: 1035, low: 994 }),
    ...flat(12, 1030, 27),
  ]);
  assert.deepEqual(blocks, [], "moverse dentro del rango no rompe estructura");
});

test("a block price has already traded back into is dropped as mitigated", () => {
  const blocks = findOrderBlocks([
    ...flat(25),
    candle(25, 1000, 995, { high: 1001, low: 994, volume: 400 }),
    candle(26, 995, 1020, { high: 1022, low: 994 }),
    candle(27, 1020, 1035, { high: 1037, low: 1019 }),
    // Price comes all the way back through the zone.
    candle(28, 1035, 990, { high: 1036, low: 988 }),
    ...flat(11, 990, 29),
  ]);
  assert.deepEqual(blocks, [], "un bloque ya visitado no es un nivel vivo");
});

test("overlapping blocks collapse to the strongest, not a stack of near-duplicates", () => {
  const blocks = findOrderBlocks([
    ...flat(25),
    candle(25, 1000, 995, { high: 1001, low: 994, volume: 400 }),
    candle(26, 995, 996, { high: 1001, low: 994, volume: 500 }),
    candle(27, 996, 1030, { high: 1032, low: 995 }),
    candle(28, 1030, 1045, { high: 1047, low: 1029 }),
    ...flat(12, 1050, 29),
  ]);
  assert.ok(blocks.length <= 1, `se esperaba una zona, no ${blocks.length}`);
});

test("too little history yields nothing rather than a guess", () => {
  assert.deepEqual(findOrderBlocks(flat(10)), []);
  assert.deepEqual(findOrderBlocks([]), []);
});

test("results are capped and ordered by price, high to low", () => {
  const blocks = findOrderBlocks(bullishScenario(), { limit: 3 });
  assert.ok(blocks.length <= 3);
  for (let i = 1; i < blocks.length; i += 1) {
    assert.ok(blocks[i - 1].mid >= blocks[i].mid);
  }
});

test("a stricter displacement threshold filters more aggressively", () => {
  const loose = findOrderBlocks(bullishScenario(), { minDisplacement: 1.5 });
  const strict = findOrderBlocks(bullishScenario(), { minDisplacement: 50 });
  assert.ok(loose.length > 0);
  assert.deepEqual(strict, [], "el umbral se respeta, no se ignora");
});

/* ── volumen y confianza observada ── */

test("an order block carries the origin candle's real notional volume", () => {
  const blocks = findOrderBlocks(bullishScenario());
  assert.equal(blocks.length, 1);
  // Origin candle: open 1000 close 995 high 1001 low 994, volume 400.
  const expected = 400 * ((1001 + 994) / 2);
  assert.ok(Math.abs(blocks[0].volumeUsd - expected) < 1, `esperado ~${expected}, dio ${blocks[0].volumeUsd}`);
});

// This file's own `flat` alternates up/down candles, which are themselves
// valid order-block origins — fine for the earlier tests, which only assert
// on ONE specific candidate, but wrong for a scenario meant to isolate a
// single outcome. `dojis` is directionless (open === close) for that reason.
const dojis = (count: number, price: number, from: number) =>
  Array.from({ length: count }, (_, i) => candle(from + i, price, price, { high: price + 1, low: price - 1 }));

// impulseWindow defaults to 4, so this fills all four continuation candles —
// an earlier version left two of them for the caller to supply as "the later
// touch", which the detector then absorbed as part of the impulse itself
// instead of treating them as a post-formation test.
function demandOb(base: number, from: number) {
  return [
    candle(from, base, base - 5, { high: base + 1, low: base - 7, volume: 400 }),
    candle(from + 1, base - 5, base + 20, { high: base + 22, low: base - 6 }),
    candle(from + 2, base + 20, base + 30, { high: base + 32, low: base + 19 }),
    candle(from + 3, base + 30, base + 35, { high: base + 37, low: base + 29 }),
    candle(from + 4, base + 35, base + 40, { high: base + 42, low: base + 34 }),
  ];
}

test("orderBlockStats scans the whole series, not just the untouched survivors", async () => {
  const { orderBlockStats } = await import("../lib/order-blocks.ts");
  // A block that formed, got touched, and held (price left without closing
  // beyond it) — findOrderBlocks would have dropped this from the live map
  // entirely, but the stat still needs to see it to measure anything.
  const data = [
    ...dojis(25, 1000, 0),
    ...demandOb(1000, 25), // occupies indices 25–29
    candle(30, 1040, 998, { high: 1041, low: 996 }), // re-enters the zone
    candle(31, 998, 1050, { high: 1052, low: 997 }), // leaves without closing below 993
    ...dojis(10, 1050, 32),
  ];
  assert.equal(findOrderBlocks(data).length, 0, "el mapa en vivo lo descarta al primer toque");
  const stats = orderBlockStats(data);
  assert.equal(stats.tested, 1, "la estadística sí lo ve, con otra definición de aguante");
  assert.equal(stats.held, 1);
});

test("a block that closed beyond its zone counts as tested and not held", async () => {
  const { orderBlockStats } = await import("../lib/order-blocks.ts");
  const data = [
    ...dojis(25, 1000, 0),
    ...demandOb(1000, 25), // occupies indices 25–29
    candle(30, 1040, 985, { high: 1041, low: 983 }), // closes below the zone
    ...dojis(11, 985, 31),
  ];
  const stats = orderBlockStats(data);
  assert.equal(stats.tested, 1);
  assert.equal(stats.held, 0);
  assert.equal(stats.holdRate, 0);
});

test("a block never revisited is not counted — its outcome is still open", async () => {
  const { orderBlockStats } = await import("../lib/order-blocks.ts");
  const stats = orderBlockStats([...dojis(25, 1000, 0), ...demandOb(1000, 25), ...dojis(15, 1050, 30)]);
  assert.equal(stats.tested, 0);
  assert.equal(stats.holdRate, null);
  assert.equal(stats.confidence, "SIN MUESTRA");
});
