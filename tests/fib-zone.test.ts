import assert from "node:assert/strict";
import test from "node:test";
import { readFibZone } from "../lib/fib-zone.ts";
import { FIB_LEVELS } from "../lib/fib-backtest.ts";
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

/**
 * An up leg with an isolated low and an isolated high, then a pullback to
 * `to`.
 *
 * The turns have to be genuine local extremes with quieter candles on both
 * sides, because findPivots only confirms a pivot that neighbouring candles
 * do not exceed. A smoothly rising series has no pivot anywhere in it, which
 * is correct behaviour and made the first version of these fixtures useless.
 */
function upLegThenPullback(to: number): SwingCandle[] {
  const out: SwingCandle[] = [];
  let i = 0;
  for (let k = 0; k < 6; k += 1) out.push(c(i++, 102, 103, 101));
  out.push(c(i++, 100, 101, 98)); // isolated low
  for (let k = 0; k < 6; k += 1) out.push(c(i++, 102, 103, 101));
  for (let k = 1; k <= 12; k += 1) out.push(c(i++, 102 + (96 * k) / 12));
  out.push(c(i++, 200, 202, 198)); // isolated high
  for (let k = 0; k < 6; k += 1) out.push(c(i++, 196, 197, 195));
  for (let k = 1; k <= 10; k += 1) out.push(c(i++, 196 - ((196 - to) * k) / 10));
  for (let k = 0; k < 8; k += 1) out.push(c(i++, to, to + 1, to - 1));
  out.push(c(i++, to)); // in-flight candle, excluded by the reader
  return out;
}

test("levels come from the shared FIB_LEVELS, not a private copy", () => {
  const zone = readFibZone(upLegThenPullback(140));
  assert.ok(zone);
  assert.deepEqual(
    zone.levels.map((level) => level.ratio).sort(),
    [...FIB_LEVELS].sort(),
    "medir una banda y mostrar otra haría inaplicable el veredicto del backtest",
  );
});

test("a pullback inside the band is reported as in-zone", () => {
  // Leg 100→200; 0.618 sits at 138.2 and 0.786 at 121.4.
  const zone = readFibZone(upLegThenPullback(130));
  assert.ok(zone);
  assert.equal(zone.side, "LONG");
  assert.equal(zone.inZone, true);
  assert.match(zone.note, /entradas de compra/);
  assert.ok(zone.retracement > 0.6 && zone.retracement < 0.8);
});

test("a shallow pullback is reported as not there yet", () => {
  const zone = readFibZone(upLegThenPullback(180));
  assert.ok(zone);
  assert.equal(zone.inZone, false);
  assert.match(zone.note, /todavía no llegó a la banda/);
});

test("a pullback beyond the deepest level questions the leg", () => {
  const zone = readFibZone(upLegThenPullback(105));
  assert.ok(zone);
  assert.equal(zone.inZone, false);
  assert.match(zone.note, /pone en duda que el tramo siga vigente/);
});

test("the levels bracket the leg correctly for an up leg", () => {
  const zone = readFibZone(upLegThenPullback(130));
  assert.ok(zone);
  assert.ok(zone.zoneLow > zone.legLow, "la banda está dentro del tramo");
  assert.ok(zone.zoneHigh < zone.legHigh);
  // Deeper ratio means a lower price on an up leg.
  const deepest = zone.levels.find((l) => l.ratio === Math.max(...FIB_LEVELS));
  const shallowest = zone.levels.find((l) => l.ratio === Math.min(...FIB_LEVELS));
  assert.ok((deepest?.price ?? 0) < (shallowest?.price ?? 0));
});

test("the nearest level is reported with its distance", () => {
  const zone = readFibZone(upLegThenPullback(130));
  assert.ok(zone?.nearest);
  assert.ok(FIB_LEVELS.includes(zone.nearest.ratio as (typeof FIB_LEVELS)[number]));
  assert.ok(zone.nearest.distancePct >= 0);
});

test("too little history, or no confirmed pivots, yields nothing", () => {
  assert.equal(readFibZone([]), null);
  assert.equal(readFibZone(Array.from({ length: 20 }, (_, i) => c(i, 100))), null);
});
