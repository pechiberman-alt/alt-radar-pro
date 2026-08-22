import type { MarketAsset } from "./radar";

export type PumpCandle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  trades: number;
};

export type PumpStage =
  | "ACUMULACIÓN"
  | "IGNICIÓN"
  | "PUMP ACTIVO"
  | "CLÍMAX"
  | "DISTRIBUCIÓN"
  | "SIN PUMP";

export type PumpMetrics = {
  relativeVolume: number;
  volumeAcceleration: number;
  rangeExpansion: number;
  tradeIntensity: number;
  bodyDominance: number;
  upperWickRatio: number;
  consecutiveUp: number;
  velocity5m: number;
  runFromBase: number;
  drawdownFromHigh: number;
};

export type PumpReading = {
  symbol: string;
  stage: PumpStage;
  score: number;
  metrics: PumpMetrics;
  reasons: string[];
  warnings: string[];
  price: number;
  quoteVolume: number;
  sampleSize: number;
};

/**
 * The screener runs over the whole universe using the rolling windows the app
 * already loads, so it costs no extra requests. It only shortlists candidates
 * worth a real candle inspection; it never decides a pump on its own.
 */
export type PumpCandidate = {
  asset: MarketAsset;
  heat: number;
};

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const safeRatio = (numerator: number, denominator: number) =>
  denominator > 0 && Number.isFinite(numerator / denominator)
    ? numerator / denominator
    : 0;

/**
 * Short-term acceleration matters more than raw 24H change: a coin already up
 * 40% over a day is late, while one moving hard in the last two windows is
 * where a pump actually starts.
 */
export function screenPumpCandidates(
  market: MarketAsset[],
  options: { minimumQuoteVolume?: number; limit?: number } = {},
): PumpCandidate[] {
  const minimumQuoteVolume = options.minimumQuoteVolume ?? 3_000_000;
  const limit = options.limit ?? 8;

  return market
    .filter((asset) => asset.quoteVolume >= minimumQuoteVolume)
    .filter((asset) => asset.change5m !== null && asset.change5m !== undefined)
    .map((asset) => {
      const five = asset.change5m ?? 0;
      const fifteen = asset.change15m ?? 0;
      const hour = asset.change1h ?? 0;
      // A pump accelerates: the 5m leg should be outrunning its own 15m pace.
      const acceleration = five - fifteen / 3;
      const heat =
        Math.max(0, five) * 3.2 +
        Math.max(0, fifteen) * 1.4 +
        Math.max(0, acceleration) * 2.6 +
        Math.max(0, Math.min(hour, 12)) * 0.4;
      return { asset, heat };
    })
    .filter((candidate) => candidate.heat > 2.5)
    .sort((left, right) => right.heat - left.heat)
    .slice(0, limit);
}

/**
 * Confirmation stage. Everything here is derived from closed candles, so the
 * reading can be reproduced from the same public data at any later time.
 */
export function analyzePump(
  asset: MarketAsset,
  candles: PumpCandle[],
): PumpReading | null {
  // The last candle is still forming, so it is excluded from every statistic.
  const closed = candles.slice(0, -1);
  if (closed.length < 24) return null;

  const recent = closed[closed.length - 1];
  const baseline = closed.slice(-25, -1);
  const baselineVolume = median(baseline.map((candle) => candle.quoteVolume));
  const baselineRange = median(
    baseline.map((candle) => Math.max(0, candle.high - candle.low)),
  );
  const baselineTrades = median(baseline.map((candle) => candle.trades));

  const relativeVolume = safeRatio(recent.quoteVolume, baselineVolume);
  const lastThreeVolume =
    closed.slice(-3).reduce((sum, candle) => sum + candle.quoteVolume, 0) / 3;
  const volumeAcceleration = safeRatio(lastThreeVolume, baselineVolume);
  const recentRange = Math.max(0, recent.high - recent.low);
  const rangeExpansion = safeRatio(recentRange, baselineRange);
  const tradeIntensity = safeRatio(recent.trades, baselineTrades);

  const body = Math.abs(recent.close - recent.open);
  const bodyDominance = safeRatio(body, recentRange);
  const upperWick = recent.high - Math.max(recent.open, recent.close);
  const upperWickRatio = safeRatio(upperWick, recentRange);

  let consecutiveUp = 0;
  for (let index = closed.length - 1; index >= 0; index -= 1) {
    if (closed[index].close > closed[index].open) consecutiveUp += 1;
    else break;
  }

  const velocity5m = safeRatio(recent.close - recent.open, recent.open) * 100;
  const window = closed.slice(-24);
  const windowLow = Math.min(...window.map((candle) => candle.low));
  const windowHigh = Math.max(...window.map((candle) => candle.high));
  const runFromBase = safeRatio(recent.close - windowLow, windowLow) * 100;
  const drawdownFromHigh = safeRatio(windowHigh - recent.close, windowHigh) * 100;

  const metrics: PumpMetrics = {
    relativeVolume,
    volumeAcceleration,
    rangeExpansion,
    tradeIntensity,
    bodyDominance,
    upperWickRatio,
    consecutiveUp,
    velocity5m,
    runFromBase,
    drawdownFromHigh,
  };

  const reasons: string[] = [];
  const warnings: string[] = [];

  if (relativeVolume >= 3) {
    reasons.push(`Volumen ${relativeVolume.toFixed(1)}× su mediana de 2H`);
  }
  if (volumeAcceleration >= 2) {
    reasons.push(`Volumen sostenido ${volumeAcceleration.toFixed(1)}× en 3 velas`);
  }
  if (rangeExpansion >= 2) {
    reasons.push(`Rango ${rangeExpansion.toFixed(1)}× la volatilidad habitual`);
  }
  if (tradeIntensity >= 2.5) {
    reasons.push(`Ejecuciones ${tradeIntensity.toFixed(1)}× lo normal`);
  }
  if (consecutiveUp >= 3) {
    reasons.push(`${consecutiveUp} velas verdes consecutivas`);
  }
  if (velocity5m >= 1.5) {
    reasons.push(`Última vela cerrada ${velocity5m >= 0 ? "+" : ""}${velocity5m.toFixed(2)}%`);
  }

  if (upperWickRatio >= 0.5 && relativeVolume >= 3) {
    warnings.push("Mecha superior dominante: venta absorbiendo el impulso");
  }
  if (runFromBase >= 25) {
    warnings.push(`Ya acumula +${runFromBase.toFixed(1)}% desde la base de 2H`);
  }
  if (drawdownFromHigh >= 6) {
    warnings.push(`Retrocedió ${drawdownFromHigh.toFixed(1)}% desde el máximo`);
  }
  if (asset.quoteVolume < 10_000_000) {
    warnings.push("Liquidez baja: deslizamiento y manipulación más probables");
  }

  const volumeSignal = Math.min(40, relativeVolume * 9);
  const sustainSignal = Math.min(20, volumeAcceleration * 6);
  const rangeSignal = Math.min(15, rangeExpansion * 5);
  const intensitySignal = Math.min(15, tradeIntensity * 4);
  const velocitySignal = Math.min(10, Math.max(0, velocity5m) * 3);
  const score = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        volumeSignal + sustainSignal + rangeSignal + intensitySignal + velocitySignal,
      ),
    ),
  );

  const stage = classifyStage(metrics, score);

  return {
    symbol: asset.symbol,
    stage,
    score,
    metrics,
    reasons,
    warnings,
    price: asset.price,
    quoteVolume: asset.quoteVolume,
    sampleSize: closed.length,
  };
}

function classifyStage(metrics: PumpMetrics, score: number): PumpStage {
  const {
    relativeVolume,
    volumeAcceleration,
    upperWickRatio,
    velocity5m,
    runFromBase,
    drawdownFromHigh,
    consecutiveUp,
  } = metrics;

  // Rolling over after an extended run on heavy volume: the move is being sold.
  if (runFromBase >= 12 && drawdownFromHigh >= 5 && volumeAcceleration >= 1.8) {
    return "DISTRIBUCIÓN";
  }
  // Parabolic with sellers hitting into it, or an already exhausted vertical run.
  if (
    relativeVolume >= 6 &&
    (upperWickRatio >= 0.45 || runFromBase >= 25) &&
    velocity5m > 0
  ) {
    return "CLÍMAX";
  }
  if (relativeVolume >= 4 && velocity5m >= 1 && runFromBase >= 6) {
    return "PUMP ACTIVO";
  }
  // Volume and range are firing but price has not travelled far yet.
  if (relativeVolume >= 3 && velocity5m >= 0.6 && runFromBase < 6) {
    return "IGNICIÓN";
  }
  // Volume builds while price stays contained: pressure without a break yet.
  if (
    volumeAcceleration >= 1.8 &&
    Math.abs(velocity5m) < 0.6 &&
    consecutiveUp >= 2 &&
    runFromBase < 5
  ) {
    return "ACUMULACIÓN";
  }
  return score >= 45 ? "IGNICIÓN" : "SIN PUMP";
}

export function parsePumpKlines(rows: unknown): PumpCandle[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row): row is unknown[] => Array.isArray(row) && row.length >= 9)
    .map((row) => ({
      openTime: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
      quoteVolume: Number(row[7]),
      trades: Number(row[8]),
    }))
    .filter(
      (candle) =>
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close) &&
        candle.close > 0 &&
        Number.isFinite(candle.quoteVolume),
    );
}
