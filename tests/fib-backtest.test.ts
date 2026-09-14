import assert from "node:assert/strict";
import test from "node:test";
import { aggregateFibOutcomes, FIB_LEVELS, runFibBacktest } from "../lib/fib-backtest.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const candle = (close: number, index: number, patch: Partial<SwingCandle> = {}): SwingCandle => ({
  openTime: index * 3_600_000,
  open: close,
  high: close,
  low: close,
  close,
  volume: 100,
  quoteVolume: 1_000_000,
  ...patch,
});

/** Interpolates candles between waypoints, like the swing-entries tests do. */
function fromWaypoints(waypoints: number[], perLeg = 9): SwingCandle[] {
  const closes: number[] = [];
  for (let leg = 1; leg < waypoints.length; leg += 1) {
    const from = waypoints[leg - 1];
    const to = waypoints[leg];
    for (let step = 1; step <= perLeg; step += 1) {
      closes.push(from + ((to - from) * step) / perLeg);
    }
  }
  return closes.map((close, index) => candle(close, index, { high: close * 1.001, low: close * 0.999 }));
}

test("finds no legs on a flat series", () => {
  const flat = Array.from({ length: 80 }, (_, i) => candle(100, i));
  assert.deepEqual(runFibBacktest(flat), []);
});

test("a clean pullback into 0.618 that continues to the extreme is a TARGET win", () => {
  // A down-leg into 100 first, so the swing low itself has candles on both
  // sides for findPivots to confirm — a rally starting at index 0 would
  // never get its origin recognized as a pivot. Then rally 100 -> 200, and
  // a pullback that touches the 0.618 zone (200 - 100*0.618 = 138.2) and
  // resumes upward, clearing back past 200.
  const leadIn = fromWaypoints([130, 100], 15);
  const rally = fromWaypoints([100, 200], 20);
  const pullback: SwingCandle[] = [];
  const zone = 138.2;
  const base = leadIn.length + rally.length;
  // Dip down to the zone, then climb back past the prior extreme. The wick
  // is wide enough to bracket the computed level even though the actual
  // pivot prices (candle high/low, not the round waypoint) shift it by a
  // fraction of a percent.
  for (const price of [190, 170, 150, zone, 150, 180, 210, 230]) {
    pullback.push(candle(price, base + pullback.length, { high: price + 1.5, low: price - 1.5 }));
  }
  const series = [...leadIn, ...rally, ...pullback];

  const outcomes = runFibBacktest(series);
  const hit618 = outcomes.find((o) => o.level === 0.618 && o.side === "LONG");
  assert.ok(hit618, "expected a 0.618 touch to be recorded");
  assert.equal(hit618?.outcome, "TARGET");
  assert.ok((hit618?.rMultiple ?? 0) > 0);
});

test("a pullback that breaks the leg origin before reclaiming it is a STOP loss", () => {
  const leadIn = fromWaypoints([130, 100], 15);
  const rally = fromWaypoints([100, 200], 20);
  const breakdown: SwingCandle[] = [];
  const base = leadIn.length + rally.length;
  for (const price of [190, 170, 138, 120, 99, 90]) {
    breakdown.push(candle(price, base + breakdown.length, { high: price + 0.5, low: price - 0.5 }));
  }
  const series = [...leadIn, ...rally, ...breakdown];

  const outcomes = runFibBacktest(series);
  const hit618 = outcomes.find((o) => o.level === 0.618 && o.side === "LONG");
  assert.ok(hit618, "expected a 0.618 touch to be recorded before the origin broke");
  assert.equal(hit618?.outcome, "STOP");
  assert.equal(hit618?.rMultiple, -1);
});

test("grading only ever looks at candles at or after the touch", () => {
  // Same setup as the losing case, but appended with a huge future rally
  // that must NOT be able to turn an already-graded STOP into a win.
  const leadIn = fromWaypoints([130, 100], 15);
  const rally = fromWaypoints([100, 200], 20);
  const breakdown: SwingCandle[] = [];
  const base = leadIn.length + rally.length;
  for (const price of [190, 170, 138, 120, 99, 90]) {
    breakdown.push(candle(price, base + breakdown.length, { high: price + 0.5, low: price - 0.5 }));
  }
  const series = [...leadIn, ...rally, ...breakdown];
  const before = runFibBacktest(series);
  const before618 = before.find((o) => o.level === 0.618 && o.side === "LONG");
  assert.ok(before618, "expected a 0.618 touch before extending the series");

  const withFuture = [
    ...series,
    ...Array.from({ length: 30 }, (_, i) => candle(90 + i * 20, series.length + i)),
  ];
  const after = runFibBacktest(withFuture);
  const after618 = after.find(
    (o) => o.level === 0.618 && o.side === "LONG" && o.touchIndex === before618?.touchIndex,
  );

  assert.ok(after618, "expected the same touch to still be recorded once the series is extended");
  assert.equal(after618?.outcome, before618?.outcome);
  assert.equal(after618?.rMultiple, before618?.rMultiple);
});

test("a level is only counted once per leg even if price chops through it repeatedly", () => {
  const leadIn = fromWaypoints([130, 100], 15);
  const rally = fromWaypoints([100, 200], 20);
  const chop: SwingCandle[] = [];
  const zone = 138.2;
  const base = leadIn.length + rally.length;
  for (const price of [zone - 1, zone + 1, zone - 1, zone + 1, 180, 220]) {
    chop.push(candle(price, base + chop.length, { high: price + 2, low: price - 2 }));
  }
  const series = [...leadIn, ...rally, ...chop];

  const outcomes = runFibBacktest(series);
  const touches618 = outcomes.filter((o) => o.level === 0.618 && o.side === "LONG");
  assert.equal(touches618.length, 1);
});

test("aggregateFibOutcomes compares every level side by side with sample-quality labels", () => {
  const leadIn = fromWaypoints([130, 100], 15);
  const rally = fromWaypoints([100, 200], 20);
  const pullback: SwingCandle[] = [];
  const zone = 138.2;
  const base = leadIn.length + rally.length;
  for (const price of [190, 170, 150, zone, 150, 180, 210, 230]) {
    pullback.push(candle(price, base + pullback.length, { high: price + 1.5, low: price - 1.5 }));
  }
  const series = [...leadIn, ...rally, ...pullback];

  const stats = aggregateFibOutcomes(runFibBacktest(series));
  assert.equal(stats.length, FIB_LEVELS.length * 3); // ALL + LONG + SHORT per level
  const all618 = stats.find((s) => s.level === 0.618 && s.side === "ALL");
  assert.ok(all618 && all618.trades > 0, "expected at least one graded 0.618 trade");
  for (const row of stats) {
    assert.ok(["DATA INSUFICIENTE", "MUESTRA BAJA", "MUESTRA AUDITABLE"].includes(row.sampleQuality));
    if (row.trades === 0) {
      assert.equal(row.winRate, null);
      assert.equal(row.sampleQuality, "DATA INSUFICIENTE");
    }
  }
});
