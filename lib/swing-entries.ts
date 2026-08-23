/**
 * Swing entry detection.
 *
 * A swing setup is not a momentum reading: it needs a trend to lean on, a
 * pullback that has not broken that trend, and a structural place to be wrong.
 * Everything here is computed from closed candles, and the in-flight candle is
 * excluded, so a setup can be reproduced from the same public data later.
 */

export type SwingCandle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
};

export type SwingPoint = { index: number; price: number; time: number };

export type SwingSetup = {
  symbol: string;
  side: "LONG" | "SHORT";
  /** How complete the case is, 0..100. */
  score: number;
  quality: "OBSERVACIÓN" | "SETUP" | "ALTA CONVICCIÓN";
  entryLow: number;
  entryHigh: number;
  stop: number;
  targets: number[];
  riskRewardFirst: number;
  riskPct: number;
  /** Where price sits inside the swing leg, 0 = base, 1 = extreme. */
  retracement: number;
  trend: "ALCISTA" | "BAJISTA" | "SIN TENDENCIA";
  reasons: string[];
  warnings: string[];
  invalidation: string;
};

const finite = (value: number) => Number.isFinite(value);

const clamp = (value: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, value));

export function parseSwingKlines(rows: unknown): SwingCandle[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row): row is unknown[] => Array.isArray(row) && row.length >= 8)
    .map((row) => ({
      openTime: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
      quoteVolume: Number(row[7]),
    }))
    .filter(
      (candle) =>
        finite(candle.open) &&
        finite(candle.high) &&
        finite(candle.low) &&
        finite(candle.close) &&
        candle.close > 0 &&
        candle.high >= candle.low,
    );
}

/**
 * Pivot highs and lows: a candle whose extreme is not exceeded by `span`
 * candles on either side. Requiring both sides is what makes it a confirmed
 * pivot rather than the latest extreme, which has not been tested yet.
 */
export function findPivots(candles: SwingCandle[], span = 3) {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];
  for (let index = span; index < candles.length - span; index += 1) {
    const candle = candles[index];
    let isHigh = true;
    let isLow = true;
    for (let offset = 1; offset <= span; offset += 1) {
      if (candles[index - offset].high >= candle.high || candles[index + offset].high >= candle.high) {
        isHigh = false;
      }
      if (candles[index - offset].low <= candle.low || candles[index + offset].low <= candle.low) {
        isLow = false;
      }
      if (!isHigh && !isLow) break;
    }
    if (isHigh) highs.push({ index, price: candle.high, time: candle.openTime });
    if (isLow) lows.push({ index, price: candle.low, time: candle.openTime });
  }
  return { highs, lows };
}

function ema(values: number[], period: number) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let index = period; index < values.length; index += 1) {
    current = values[index] * k + current * (1 - k);
  }
  return current;
}

/**
 * Trend from structure rather than from a single indicator: an uptrend needs
 * both a higher high and a higher low, confirmed by the moving averages.
 */
function readTrend(
  candles: SwingCandle[],
  highs: SwingPoint[],
  lows: SwingPoint[],
): "ALCISTA" | "BAJISTA" | "SIN TENDENCIA" {
  const closes = candles.map((candle) => candle.close);
  const fast = ema(closes, 20);
  const slow = ema(closes, 50);
  if (fast === null || slow === null) return "SIN TENDENCIA";

  const lastHighs = highs.slice(-2);
  const lastLows = lows.slice(-2);
  const higherHigh = lastHighs.length === 2 && lastHighs[1].price > lastHighs[0].price;
  const higherLow = lastLows.length === 2 && lastLows[1].price > lastLows[0].price;
  const lowerHigh = lastHighs.length === 2 && lastHighs[1].price < lastHighs[0].price;
  const lowerLow = lastLows.length === 2 && lastLows[1].price < lastLows[0].price;

  if (higherHigh && higherLow && fast > slow) return "ALCISTA";
  if (lowerHigh && lowerLow && fast < slow) return "BAJISTA";
  return "SIN TENDENCIA";
}

/** Average true range, for sizing the buffer beyond structure. */
function atr(candles: SwingCandle[], period = 14) {
  if (candles.length < period + 1) return null;
  const ranges: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previousClose = candles[index - 1].close;
    ranges.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previousClose),
        Math.abs(current.low - previousClose),
      ),
    );
  }
  const window = ranges.slice(-period);
  return window.reduce((sum, value) => sum + value, 0) / window.length;
}

export type SwingOptions = {
  /** Minimum reward-to-risk for the first target to accept the setup. */
  minRiskReward?: number;
  /** Structural levels from the order-flow brain, used as confluence. */
  confluence?: number[];
};

/**
 * Builds a swing setup, or returns null when the case is not there.
 *
 * It refuses rather than downgrades: no trend, no confirmed pullback, or a
 * stop that would sit beyond the structure it is supposed to protect all mean
 * there is no setup, not a weak one.
 */
export function detectSwingEntry(
  symbol: string,
  candles: SwingCandle[],
  options: SwingOptions = {},
): SwingSetup | null {
  const minRiskReward = options.minRiskReward ?? 1.8;
  // The in-flight candle is excluded so the reading does not shift as it forms.
  const closed = candles.slice(0, -1);
  if (closed.length < 60) return null;

  const { highs, lows } = findPivots(closed);
  if (highs.length < 2 || lows.length < 2) return null;

  const trend = readTrend(closed, highs, lows);
  if (trend === "SIN TENDENCIA") return null;

  const price = closed[closed.length - 1].close;
  const range = atr(closed);
  if (!range || range <= 0) return null;

  const side: "LONG" | "SHORT" = trend === "ALCISTA" ? "LONG" : "SHORT";
  const reasons: string[] = [];
  const warnings: string[] = [];

  // The leg being retraced: last confirmed swing low to swing high for a long.
  const lastHigh = highs[highs.length - 1];
  const lastLow = lows[lows.length - 1];
  const legHigh = Math.max(lastHigh.price, price);
  const legLow = Math.min(lastLow.price, price);
  const legSize = legHigh - legLow;
  if (legSize <= range * 1.2) return null;

  const retracement =
    side === "LONG" ? (price - legLow) / legSize : (legHigh - price) / legSize;

  // A pullback worth entering has actually pulled back, but not so far that the
  // leg is invalidated. Outside this band there is no swing entry to take.
  if (retracement > 0.86) {
    return null;
  }
  if (retracement < 0.14) {
    return null;
  }

  reasons.push(
    `Tendencia ${trend.toLowerCase()} confirmada por estructura y medias 20/50`,
  );
  reasons.push(
    `Retroceso del ${((1 - retracement) * 100).toFixed(0)}% de la pierna, dentro de la zona operable`,
  );

  // Structural stop: beyond the pivot that defines the trend, plus an ATR
  // buffer so ordinary noise does not take it out.
  const structural = side === "LONG" ? lastLow.price : lastHigh.price;
  const stop = side === "LONG" ? structural - range * 0.35 : structural + range * 0.35;
  const riskUnit = Math.abs(price - stop);
  if (riskUnit <= 0) return null;

  const entryLow = side === "LONG" ? price - range * 0.28 : price;
  const entryHigh = side === "LONG" ? price : price + range * 0.28;

  // The first target is the structure the move has to clear; the rest are
  // extensions measured from it, not from entry. Measuring them from entry let
  // a structural first target overshoot the ones that were supposed to follow.
  const priorExtreme = side === "LONG" ? lastHigh.price : lastLow.price;
  const firstTarget = side === "LONG"
    ? Math.max(priorExtreme, price + riskUnit * 1.6)
    : Math.min(priorExtreme, price - riskUnit * 1.6);
  const targets = side === "LONG"
    ? [firstTarget, firstTarget + riskUnit * 1.2, firstTarget + riskUnit * 2.4]
    : [
        firstTarget,
        Math.max(0, firstTarget - riskUnit * 1.2),
        Math.max(0, firstTarget - riskUnit * 2.4),
      ];

  const riskRewardFirst = Math.abs(targets[0] - price) / riskUnit;
  if (riskRewardFirst < minRiskReward) {
    return null;
  }
  reasons.push(
    `Objetivo inicial en estructura previa con R:R 1:${riskRewardFirst.toFixed(1)}`,
  );

  const riskPct = (riskUnit / price) * 100;
  let score = 42;
  score += Math.min(16, riskRewardFirst * 4);
  // The good price is near the base of the leg, not halfway up it. With the
  // stop at the structural low, a mid-leg entry cannot pay for its own risk:
  // the distance to the prior high shrinks as the distance to the stop grows.
  // Waiting for the pullback to come closer is what makes the geometry work.
  score += retracement <= 0.45 ? 14 : retracement <= 0.6 ? 7 : 2;

  // Confluence with the order-flow brain's structural levels.
  const nearbyLevel = (options.confluence ?? []).find(
    (level) => Math.abs(level - price) <= range * 0.9,
  );
  if (nearbyLevel !== undefined) {
    score += 12;
    reasons.push(
      `Coincide con un nivel estructural del order flow en ${nearbyLevel.toPrecision(8)}`,
    );
  }

  // Volume behaving as a pullback should: quieter than the impulse that made it.
  const recentVolume =
    closed.slice(-5).reduce((sum, candle) => sum + candle.quoteVolume, 0) / 5;
  const priorVolume =
    closed.slice(-25, -5).reduce((sum, candle) => sum + candle.quoteVolume, 0) / 20;
  if (priorVolume > 0 && recentVolume < priorVolume) {
    score += 10;
    reasons.push("Volumen del retroceso por debajo del impulso previo");
  } else if (priorVolume > 0 && recentVolume > priorVolume * 1.6) {
    score -= 8;
    warnings.push(
      "El retroceso llega con más volumen que el impulso: puede ser distribución, no una pausa",
    );
  }

  if (riskPct > 12) {
    warnings.push(
      `La invalidación queda a ${riskPct.toFixed(1)}% del precio: la posición tendrá que ser chica para que el riesgo sea razonable`,
    );
  }
  if (retracement > 0.75) {
    warnings.push("El retroceso es profundo: la pierna está cerca de invalidarse");
  }

  const finalScore = Math.round(clamp(score));
  const quality =
    finalScore >= 78 ? "ALTA CONVICCIÓN" : finalScore >= 62 ? "SETUP" : "OBSERVACIÓN";

  return {
    symbol,
    side,
    score: finalScore,
    quality,
    entryLow,
    entryHigh,
    stop,
    targets,
    riskRewardFirst,
    riskPct,
    retracement,
    trend,
    reasons,
    warnings,
    invalidation:
      side === "LONG"
        ? `Cierre por debajo de ${stop.toPrecision(8)} rompe el mínimo que sostiene la tendencia`
        : `Cierre por encima de ${stop.toPrecision(8)} rompe el máximo que sostiene la tendencia`,
  };
}
