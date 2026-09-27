import assert from "node:assert/strict";
import test from "node:test";
import { breakerBlockStats, findBreakerBlocks, findOrderBlocks } from "../lib/order-blocks.ts";
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

const flat = (count: number, price = 1000, from = 0) =>
  Array.from({ length: count }, (_, i) =>
    candle(from + i, price, price, { high: price + 1, low: price - 1 }),
  );

// A bullish order block (zone [994, 1001]) that, in every scenario below,
// holds above for a while before whatever happens next.
const setup = () => [
  ...flat(25),
  candle(25, 1000, 995, { high: 1001, low: 994, volume: 400 }), // i=25: origin
  candle(26, 995, 1020, { high: 1022, low: 994 }), // impulse
  candle(27, 1020, 1035, { high: 1037, low: 1019 }), // impulse
  ...flat(8, 1040, 28), // 28..35: holds well above, untouched
];

test("an order block that never breaks produces no breaker block and no stat", () => {
  const candles = [...setup(), ...flat(15, 1040, 36)];
  assert.equal(findBreakerBlocks(candles).length, 0);
  const stats = breakerBlockStats(candles);
  assert.equal(stats.tested, 0, "nunca rompio: no hay veredicto que contar");
});

test("a break with no retest is an active, unproven breaker block", () => {
  const candles = [
    ...setup(),
    candle(36, 1040, 980, { high: 1041, low: 975 }), // BREAK: closes under 994
    ...flat(10, 950, 37), // stays well below, never retests [994,1001]
  ];
  const breakers = findBreakerBlocks(candles);
  assert.equal(breakers.length, 1);
  assert.equal(breakers[0].side, "BAJISTA", "el rol se invierte: ahora es resistencia");
  assert.equal(breakers[0].brokenAtIndex, 36);

  const stats = breakerBlockStats(candles);
  assert.equal(stats.tested, 0, "activo pero nunca retesteado: sin veredicto todavia");
});

test("a break that gets retested and holds counts as held, and stays active", () => {
  const candles = [
    ...setup(),
    candle(36, 1040, 980, { high: 1041, low: 975 }), // BREAK
    candle(37, 980, 990, { high: 999, low: 978 }), // wicks into the zone, closes back under it
    ...flat(9, 950, 38), // stays below after
  ];
  const breakers = findBreakerBlocks(candles);
  assert.equal(breakers.length, 1, "sigue siendo un nivel vivo: no volvio a fallar");

  const stats = breakerBlockStats(candles);
  assert.equal(stats.tested, 1);
  assert.equal(stats.held, 1);
  assert.equal(stats.holdRate, 1);
});

test("a break that gets retested and fails is no longer shown, and counts as not held", () => {
  const candles = [
    ...setup(),
    candle(36, 1040, 980, { high: 1041, low: 975 }), // BREAK
    candle(37, 980, 1010, { high: 1015, low: 978 }), // closes back ABOVE the zone: fails again
    ...flat(9, 1040, 38),
  ];
  const breakers = findBreakerBlocks(candles);
  assert.equal(breakers.length, 0, "ya fallo como breaker tambien: no es un nivel vivo");

  const stats = breakerBlockStats(candles);
  assert.equal(stats.tested, 1);
  assert.equal(stats.held, 0);
  assert.equal(stats.holdRate, 0);
});

test("sample-size confidence label matches the same 8-case threshold as order blocks and gaps", () => {
  // Seven independent break-and-retest cycles at widely separated price
  // levels (10,000 apart), so no later cycle's impulse ever re-enters an
  // earlier one's zone — breakerBlockStats scans forward to the end of the
  // WHOLE series for a rebreak, correctly, so overlapping price ranges
  // across "independent" cycles would genuinely contaminate each other.
  const cycle = (base: number) => [
    ...flat(25, base),
    candle(0, base, base - 5, { high: base + 1, low: base - 6, volume: 400 }),
    candle(0, base - 5, base + 20, { high: base + 22, low: base - 6 }),
    candle(0, base + 20, base + 35, { high: base + 37, low: base + 19 }),
    ...flat(8, base + 40),
    candle(0, base + 40, base - 20, { high: base + 41, low: base - 25 }), // break
    candle(0, base - 20, base - 10, { high: base - 1, low: base - 22 }), // retest
    ...flat(9, base - 50),
  ];
  const candles: SwingCandle[] = Array.from({ length: 7 }, (_, k) => cycle(1000 + k * 10_000)).flat();
  const stats = breakerBlockStats(candles);
  assert.equal(stats.tested, 7);
  assert.equal(stats.confidence, "MUESTRA MÍNIMA");
});

test("findOrderBlocks still ignores a mitigated candidate the way it always has", () => {
  // Sanity check: breaker-block logic is additive, not a change to the
  // existing order-block detector's own behavior.
  const candles = [
    ...setup(),
    candle(36, 1040, 980, { high: 1041, low: 975 }),
    ...flat(10, 950, 37),
  ];
  assert.equal(findOrderBlocks(candles).length, 0, "el bloque ya fue mitigado: sigue sin listarse como order block");
});
