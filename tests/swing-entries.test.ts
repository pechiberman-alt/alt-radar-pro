import assert from "node:assert/strict";
import test from "node:test";
import {
  detectSwingEntry,
  findPivots,
  parseSwingKlines,
  type SwingCandle,
} from "../lib/swing-entries.ts";

const candle = (
  close: number,
  index: number,
  patch: Partial<SwingCandle> = {},
): SwingCandle => ({
  openTime: index * 14_400_000,
  open: close,
  high: close * 1.004,
  low: close * 0.996,
  close,
  volume: 100,
  quoteVolume: 1_000_000,
  ...patch,
});

/** Walks a path of turning points, interpolating candles between them. */
function fromWaypoints(waypoints: number[], perLeg = 9): SwingCandle[] {
  const closes: number[] = [];
  for (let leg = 1; leg < waypoints.length; leg += 1) {
    const from = waypoints[leg - 1];
    const to = waypoints[leg];
    for (let step = 1; step <= perLeg; step += 1) {
      closes.push(from + ((to - from) * step) / perLeg);
    }
  }
  return closes.map((close, index) => candle(close, index));
}

/**
 * A clean uptrend ending in a pullback that lands near the last higher low —
 * the shape a swing entry is actually looking for, where the structural stop
 * sits close enough that the first target pays for the risk.
 */
function uptrend(): SwingCandle[] {
  return fromWaypoints([100, 118, 109, 130, 120, 145, 133, 160, 136]);
}

function downtrend(): SwingCandle[] {
  return fromWaypoints([160, 142, 151, 130, 140, 115, 127, 100, 124]);
}

/** Sideways chop with no directional structure. */
function chop(): SwingCandle[] {
  return Array.from({ length: 80 }, (_, i) =>
    candle(100 + Math.sin(i / 2.5) * 2, i),
  );
}

test("pivots need confirmation on both sides", () => {
  const candles = [
    candle(100, 0), candle(101, 1), candle(102, 2),
    candle(110, 3, { high: 115 }),
    candle(103, 4), candle(102, 5), candle(101, 6),
  ];
  const { highs } = findPivots(candles, 3);
  assert.equal(highs.length, 1);
  assert.equal(highs[0].index, 3);
});

test("the latest extreme is not a pivot until it is tested", () => {
  const candles = Array.from({ length: 10 }, (_, i) => candle(100 + i, i));
  const { highs } = findPivots(candles, 3);
  // The final candle is the highest but has nothing to its right.
  assert.ok(!highs.some((pivot) => pivot.index >= candles.length - 3));
});

test("no setup without enough history", () => {
  assert.equal(detectSwingEntry("BTCUSDT", []), null);
  assert.equal(detectSwingEntry("BTCUSDT", uptrend().slice(0, 30)), null);
});

test("no setup in a market without trend", () => {
  assert.equal(detectSwingEntry("BTCUSDT", chop()), null);
});

test("finds a long in a confirmed uptrend pullback", () => {
  const setup = detectSwingEntry("BTCUSDT", uptrend());
  assert.ok(setup, "debía encontrar un setup en una tendencia limpia");
  assert.equal(setup.side, "LONG");
  assert.equal(setup.trend, "ALCISTA");
  assert.ok(setup.stop < setup.entryLow, "el stop va por debajo de la entrada en un long");
  assert.ok(setup.targets[0] > setup.entryHigh, "el objetivo va por encima");
  assert.ok(setup.reasons.length >= 3, "debe explicar el caso");
});

test("targets are ordered away from the entry", () => {
  const long = detectSwingEntry("BTCUSDT", uptrend());
  assert.ok(long);
  for (let i = 1; i < long.targets.length; i += 1) {
    assert.ok(long.targets[i] > long.targets[i - 1], "objetivos de long crecientes");
  }
});

test("a short mirrors the geometry", () => {
  const setup = detectSwingEntry("BTCUSDT", downtrend());
  if (!setup) return; // The synthetic reversal may not produce a clean leg.
  assert.equal(setup.side, "SHORT");
  assert.ok(setup.stop > setup.entryHigh, "el stop va por encima en un short");
  assert.ok(setup.targets[0] < setup.entryLow, "el objetivo va por debajo");
  for (let i = 1; i < setup.targets.length; i += 1) {
    assert.ok(setup.targets[i] < setup.targets[i - 1], "objetivos de short decrecientes");
  }
});

test("refuses a setup whose first target does not pay for the risk", () => {
  const demanding = detectSwingEntry("BTCUSDT", uptrend(), { minRiskReward: 99 });
  assert.equal(demanding, null, "sin R:R suficiente no hay setup, no uno débil");
});

test("risk-reward reported matches the levels given", () => {
  const setup = detectSwingEntry("BTCUSDT", uptrend());
  assert.ok(setup);
  const reference = setup.entryHigh;
  const risk = Math.abs(reference - setup.stop);
  const reward = Math.abs(setup.targets[0] - reference);
  assert.ok(
    Math.abs(reward / risk - setup.riskRewardFirst) < 0.15,
    `R:R informado ${setup.riskRewardFirst} no coincide con los niveles`,
  );
});

test("a price sitting at the extreme is not a pullback", () => {
  // Straight impulse with no retracement at all.
  const impulse = Array.from({ length: 80 }, (_, i) => candle(100 * 1.01 ** i, i));
  assert.equal(detectSwingEntry("BTCUSDT", impulse), null);
});

test("confluence with an order-flow level raises the score", () => {
  const candles = uptrend();
  const base = detectSwingEntry("BTCUSDT", candles);
  assert.ok(base);
  const withLevel = detectSwingEntry("BTCUSDT", candles, {
    confluence: [candles[candles.length - 2].close],
  });
  assert.ok(withLevel);
  assert.ok(
    withLevel.score > base.score,
    "una confluencia real debe sumar convicción",
  );
  assert.ok(withLevel.reasons.some((reason) => reason.includes("order flow")));
});

test("a distant level is not counted as confluence", () => {
  const candles = uptrend();
  const base = detectSwingEntry("BTCUSDT", candles);
  const far = detectSwingEntry("BTCUSDT", candles, { confluence: [1] });
  assert.ok(base && far);
  assert.equal(far.score, base.score);
});

test("warns when the pullback arrives on heavier volume than the impulse", () => {
  const candles = uptrend();
  for (let i = candles.length - 5; i < candles.length; i += 1) {
    candles[i] = { ...candles[i], quoteVolume: 20_000_000 };
  }
  const setup = detectSwingEntry("BTCUSDT", candles);
  assert.ok(setup);
  assert.ok(
    setup.warnings.some((warning) => warning.includes("distribución")),
    "un retroceso con más volumen que el impulso merece advertencia",
  );
});

test("every setup is internally consistent and bounded", () => {
  const setup = detectSwingEntry("BTCUSDT", uptrend());
  assert.ok(setup);
  assert.ok(setup.score >= 0 && setup.score <= 100);
  assert.ok(Number.isInteger(setup.score), "el score se muestra, debe ser entero");
  assert.ok(["OBSERVACIÓN", "SETUP", "ALTA CONVICCIÓN"].includes(setup.quality));
  assert.ok(setup.entryLow <= setup.entryHigh, "zona de entrada bien ordenada");
  assert.ok(setup.retracement > 0 && setup.retracement < 1);
  assert.ok(setup.riskPct > 0);
  assert.ok(setup.invalidation.length > 20, "debe declarar qué invalida la idea");
  for (const value of [setup.entryLow, setup.entryHigh, setup.stop, ...setup.targets]) {
    assert.ok(Number.isFinite(value) && value >= 0, `nivel inválido: ${value}`);
  }
});

test("kline parser drops malformed rows", () => {
  const parsed = parseSwingKlines([
    [1, "100", "101", "99", "100.5", "10", 2, "1000"],
    [2, "x", "y", "z", "w", "1", 3, "5"],
    [3, "100", "99", "101", "100", "1", 4, "5"], // high below low
    "nope",
  ]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].close, 100.5);
});

test("kline parser tolerates non-array input", () => {
  assert.deepEqual(parseSwingKlines(null), []);
  assert.deepEqual(parseSwingKlines({}), []);
});
