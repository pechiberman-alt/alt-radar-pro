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
function fromWaypoints(waypoints: number[], perLeg = 20): SwingCandle[] {
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

/**
 * A run of flat candles at a safe price, used purely to clear findPivots'
 * confirmation window (it needs 3 candles on both sides of a pivot) without
 * touching any Fibonacci zone itself.
 */
function buffer(price: number, count: number, startIndex: number): SwingCandle[] {
  return Array.from({ length: count }, (_, i) =>
    candle(price, startIndex + i, { high: price + 0.2, low: price - 0.2 }),
  );
}

function withPrices(prices: number[], startIndex: number, wick = 1.5): SwingCandle[] {
  return prices.map((price, i) =>
    candle(price, startIndex + i, { high: price + wick, low: price - wick }),
  );
}

/** A down-leg into `low`, then a rally up to `high` — gives both pivots
 * enough left/right context to be confirmed by findPivots. */
function rallyLeg(low: number, high: number, perLeg = 20) {
  return fromWaypoints([high + (high - low) * 0.3, low, high], perLeg);
}

/** A rally up to `high`, then a decline into `low` — the SHORT counterpart. */
function declineLeg(high: number, low: number, perLeg = 20) {
  return fromWaypoints([low - (high - low) * 0.3, high, low], perLeg);
}

test("finds no legs on a flat series", () => {
  const flat = Array.from({ length: 80 }, (_, i) => candle(100, i));
  assert.deepEqual(runFibBacktest(flat), []);
});

test("LONG: a clean pullback into 0.618 that continues to the extreme is a TARGET win", () => {
  const rally = rallyLeg(100, 200);
  // 0.618 zone = 200 - 100*0.618 = 138.2. A few safe buffer candles first
  // to clear the pivot confirmation window, then dip into the zone and
  // resume upward past the prior extreme.
  const tail = [
    ...buffer(195, 5, rally.length),
    ...withPrices([190, 170, 150, 138.2, 150, 180, 210, 230], rally.length + 5),
  ];
  const series = [...rally, ...tail];

  const outcomes = runFibBacktest(series);
  const hit618 = outcomes.find((o) => o.level === 0.618 && o.side === "LONG");
  assert.ok(hit618, "expected a 0.618 touch to be recorded");
  assert.equal(hit618?.outcome, "TARGET");
  assert.ok((hit618?.rMultiple ?? 0) > 0);
});

test("LONG: a pullback that breaks the leg origin before reclaiming it is a STOP loss", () => {
  const rally = rallyLeg(100, 200);
  const tail = [
    ...buffer(195, 5, rally.length),
    ...withPrices([190, 170, 138, 120, 99, 90], rally.length + 5),
  ];
  const series = [...rally, ...tail];

  const outcomes = runFibBacktest(series);
  const hit618 = outcomes.find((o) => o.level === 0.618 && o.side === "LONG");
  assert.ok(hit618, "expected a 0.618 touch to be recorded before the origin broke");
  assert.equal(hit618?.outcome, "STOP");
  assert.equal(hit618?.rMultiple, -1);
});

test("SHORT: a bounce into 0.618 that continues down to a new low is a TARGET win", () => {
  // Decline from 200 down to 100. For a SHORT, extreme is the low (100,
  // the 0% reference) and origin is the high (200, the 100% retracement
  // target) — 0.618 zone = 100 + 100*0.618 = 161.8.
  const decline = declineLeg(200, 100);
  const tail = [
    ...buffer(105, 5, decline.length),
    ...withPrices([110, 130, 150, 161.8, 150, 120, 90, 70], decline.length + 5),
  ];
  const series = [...decline, ...tail];

  const outcomes = runFibBacktest(series);
  const hit618 = outcomes.find((o) => o.level === 0.618 && o.side === "SHORT");
  assert.ok(hit618, "expected a SHORT 0.618 touch to be recorded — this is exactly what was broken");
  assert.equal(hit618?.outcome, "TARGET");
  assert.ok((hit618?.rMultiple ?? 0) > 0);
});

test("SHORT: a bounce that breaks back above the leg origin is a STOP loss", () => {
  const decline = declineLeg(200, 100);
  const tail = [
    ...buffer(105, 5, decline.length),
    ...withPrices([110, 140, 162, 180, 201, 210], decline.length + 5),
  ];
  const series = [...decline, ...tail];

  const outcomes = runFibBacktest(series);
  const hit618 = outcomes.find((o) => o.level === 0.618 && o.side === "SHORT");
  assert.ok(hit618, "expected a SHORT 0.618 touch to be recorded before the origin broke");
  assert.equal(hit618?.outcome, "STOP");
  assert.equal(hit618?.rMultiple, -1);
});

test("a touch inside the pivot confirmation window is never traded", () => {
  // Same rally as the LONG win case, but this time the pullback into the
  // 0.618 zone happens on the very candle right after the extreme —
  // inside findPivots' 3-candle confirmation window, before a live system
  // could have known that candle was the extreme — and never returns to
  // that zone afterward. It must not produce a touch.
  const rally = rallyLeg(100, 200);
  const tooEarly = withPrices([138.2, 190, 210, 230, 250, 270], rally.length);
  const series = [...rally, ...tooEarly];

  const outcomes = runFibBacktest(series);
  const hit618 = outcomes.find((o) => o.level === 0.618 && o.side === "LONG");
  assert.equal(hit618, undefined, "a touch inside the confirmation window must not be graded");
});

test("grading only ever looks at candles strictly after the touch", () => {
  const rally = rallyLeg(100, 200);
  const tail = [
    ...buffer(195, 5, rally.length),
    ...withPrices([190, 170, 138, 120, 99, 90], rally.length + 5),
  ];
  const series = [...rally, ...tail];
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

test("resolution always starts strictly after the touch candle, never on it", () => {
  // The break condition that ends a leg's retracement window uses the same
  // origin/extreme prices as the stop/target — so a touch candle that also
  // reaches stop or target in the same bar can't reach resolveTrade at all
  // (the outer scan breaks on it first). What must hold unconditionally is
  // the contract itself: every graded outcome's exit sits strictly after
  // its touch, so nothing is ever decided by the touch candle's own range.
  const rally = rallyLeg(100, 200);
  const tail = [
    ...buffer(195, 5, rally.length),
    ...withPrices([190, 170, 150, 138.2, 150, 180, 210, 230], rally.length + 5),
  ];
  const series = [...rally, ...tail];

  const outcomes = runFibBacktest(series);
  assert.ok(outcomes.length > 0, "expected at least one graded outcome");
  for (const outcome of outcomes) {
    assert.ok(
      outcome.exitIndex > outcome.touchIndex,
      `exitIndex (${outcome.exitIndex}) must be after touchIndex (${outcome.touchIndex})`,
    );
  }
});

test("a level is only counted once per leg even if price chops through it repeatedly", () => {
  const rally = rallyLeg(100, 200);
  const zone = 138.2;
  const tail = [
    ...buffer(195, 5, rally.length),
    ...withPrices([zone - 1, zone + 1, zone - 1, zone + 1, 180, 220], rally.length + 5, 2),
  ];
  const series = [...rally, ...tail];

  const outcomes = runFibBacktest(series);
  const touches618 = outcomes.filter((o) => o.level === 0.618 && o.side === "LONG");
  assert.equal(touches618.length, 1);
});

test("aggregateFibOutcomes compares every level side by side with sample-quality labels", () => {
  const rally = rallyLeg(100, 200);
  const tail = [
    ...buffer(195, 5, rally.length),
    ...withPrices([190, 170, 150, 138.2, 150, 180, 210, 230], rally.length + 5),
  ];
  const series = [...rally, ...tail];

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
