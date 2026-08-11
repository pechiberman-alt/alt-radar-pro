export const BRAIN_TIMEFRAMES = ["5m", "15m", "1h", "4h", "1d"] as const;

export type BrainTimeframe = (typeof BRAIN_TIMEFRAMES)[number];
export type MarketBias = "BULLISH" | "BEARISH" | "NEUTRAL";
export type MarketVenue = "spot" | "futures";

export const TIMEFRAME_MINUTES: Record<BrainTimeframe, number> = {
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1d": 1_440,
};

export type Candle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
  trades: number;
};

export type TimeframeAnalysis = {
  timeframe: BrainTimeframe;
  price: number;
  changePct: number;
  score: number;
  bias: MarketBias;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  atr14: number | null;
  atrPct: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  relativeVolume: number | null;
  support: number | null;
  resistance: number | null;
  volume: number;
  quoteVolume: number;
  candleCount: number;
  lastCandleAt: string;
  reasons: string[];
  risks: string[];
};

export type DerivativesSnapshot = {
  available: boolean;
  markPrice: number | null;
  openInterest: number | null;
  openInterestUsd: number | null;
  openInterestChangePct: number | null;
  fundingRatePct: number | null;
  nextFundingAt: string | null;
  takerBuySellRatio: number | null;
  longShortAccountRatio: number | null;
  source: string;
  note?: string;
};

export type LiquidationZone = {
  leverage: 5 | 10 | 20 | 50 | 100;
  longPrice: number;
  shortPrice: number;
  longDistancePct: number;
  shortDistancePct: number;
};

export type BrainConsensus = {
  score: number;
  bias: MarketBias;
  alignmentPct: number;
  alignedFrames: number;
  validFrames: number;
  rawConfidence: number;
  calibratedConfidence: number;
  verdict: "ALTA CONFLUENCIA" | "VIGILANCIA ALCISTA" | "VIGILANCIA BAJISTA" | "NEUTRAL";
  reasons: string[];
  risks: string[];
};

export type BrainLearning = {
  status: "CALIBRADO" | "CALIBRANDO" | "MEMORIA NO DISPONIBLE";
  samples: number;
  wins: number;
  accuracyPct: number | null;
  averageDirectionalReturnPct: number | null;
  minimumSamples: number;
  methodology: string;
};

export type MarketBrainPayload = {
  ok: boolean;
  symbol: string;
  venue: MarketVenue;
  selectedTimeframe: BrainTimeframe;
  generatedAt: string;
  engine: {
    name: string;
    mode: string;
    tokenCost: 0;
    learning: string;
  };
  sources: string[];
  analyses: Record<BrainTimeframe, TimeframeAnalysis | null>;
  selected: TimeframeAnalysis | null;
  derivatives: DerivativesSnapshot;
  liquidationZones: LiquidationZone[];
  consensus: BrainConsensus;
  learning: BrainLearning;
  warnings: string[];
};

export const clamp = (value: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, value));

const last = <T,>(values: T[]) => values[values.length - 1];

function emaSeries(values: number[], period: number) {
  if (!values.length) return [];
  const multiplier = 2 / (period + 1);
  const result = [values[0]];
  for (let index = 1; index < values.length; index += 1) {
    result.push(values[index] * multiplier + result[index - 1] * (1 - multiplier));
  }
  return result;
}

function safeEma(values: number[], period: number) {
  if (values.length < period) return null;
  return last(emaSeries(values, period));
}

function rsi(values: number[], period = 14) {
  if (values.length <= period) return null;
  const changes = values.slice(-period - 1).map((value, index, slice) =>
    index === 0 ? 0 : value - slice[index - 1],
  ).slice(1);
  const gains = changes.reduce((sum, value) => sum + Math.max(value, 0), 0) / period;
  const losses = changes.reduce((sum, value) => sum + Math.max(-value, 0), 0) / period;
  if (losses === 0) return gains === 0 ? 50 : 100;
  return 100 - 100 / (1 + gains / losses);
}

function atr(candles: Candle[], period = 14) {
  if (candles.length <= period) return null;
  const sample = candles.slice(-period - 1);
  const ranges = sample.slice(1).map((candle, index) => {
    const previousClose = sample[index].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });
  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}

function macd(values: number[]) {
  if (values.length < 35) return { value: null, signal: null, histogram: null };
  const fast = emaSeries(values, 12);
  const slow = emaSeries(values, 26);
  const line = values.map((_, index) => fast[index] - slow[index]);
  const signal = emaSeries(line, 9);
  return {
    value: last(line),
    signal: last(signal),
    histogram: last(line) - last(signal),
  };
}

function relativeVolume(candles: Candle[], period = 20) {
  if (candles.length <= period) return null;
  const current = last(candles).volume;
  const baseline = candles
    .slice(-period - 1, -1)
    .reduce((sum, candle) => sum + candle.volume, 0) / period;
  return baseline > 0 ? current / baseline : null;
}

export function parseBinanceKlines(rows: unknown): Candle[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row): row is unknown[] => Array.isArray(row) && row.length >= 11)
    .map((row) => ({
      openTime: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
      closeTime: Number(row[6]),
      quoteVolume: Number(row[7]),
      trades: Number(row[8]),
    }))
    .filter((candle) =>
      Number.isFinite(candle.openTime) &&
      Number.isFinite(candle.open) &&
      Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) &&
      Number.isFinite(candle.close) &&
      candle.close > 0,
    );
}

export function analyzeCandles(
  candles: Candle[],
  timeframe: BrainTimeframe,
): TimeframeAnalysis | null {
  if (candles.length < 20) return null;
  const current = last(candles);
  const closes = candles.map((candle) => candle.close);
  const ema20 = safeEma(closes, 20);
  const ema50 = safeEma(closes, 50);
  const ema200 = safeEma(closes, 200);
  const rsi14 = rsi(closes);
  const atr14 = atr(candles);
  const macdValue = macd(closes);
  const relVolume = relativeVolume(candles);
  const structure = candles.slice(-50, -1);
  const support = structure.length
    ? Math.min(...structure.map((candle) => candle.low))
    : null;
  const resistance = structure.length
    ? Math.max(...structure.map((candle) => candle.high))
    : null;
  const changePct = current.open
    ? ((current.close / current.open) - 1) * 100
    : 0;
  const reasons: string[] = [];
  const risks: string[] = [];
  let score = 50;

  if (ema20 !== null) {
    if (current.close > ema20) {
      score += 10;
      reasons.push("Precio sobre EMA 20");
    } else {
      score -= 10;
      risks.push("Precio bajo EMA 20");
    }
  }
  if (ema20 !== null && ema50 !== null) {
    if (ema20 > ema50) {
      score += 10;
      reasons.push("EMA 20 sobre EMA 50");
    } else {
      score -= 10;
      risks.push("EMA 20 bajo EMA 50");
    }
  }
  if (ema50 !== null && ema200 !== null) {
    if (ema50 > ema200) {
      score += 10;
      reasons.push("Tendencia principal positiva");
    } else {
      score -= 10;
      risks.push("Tendencia principal negativa");
    }
  }
  if (rsi14 !== null) {
    if (rsi14 > 55 && rsi14 < 72) {
      score += 8;
      reasons.push("RSI confirma momentum sano");
    } else if (rsi14 < 45 && rsi14 > 28) {
      score -= 8;
      risks.push("RSI confirma debilidad");
    } else if (rsi14 >= 72) {
      score -= 4;
      risks.push("RSI extendido; riesgo anti-FOMO");
    } else if (rsi14 <= 28) {
      score += 2;
      risks.push("RSI extremo; volatilidad elevada");
    }
  }
  if (macdValue.histogram !== null) {
    if (macdValue.histogram > 0) {
      score += 7;
      reasons.push("Histograma MACD positivo");
    } else {
      score -= 7;
      risks.push("Histograma MACD negativo");
    }
  }
  if (changePct > 0) score += 5;
  else if (changePct < 0) score -= 5;
  if (relVolume !== null && relVolume >= 1.5) {
    if (changePct >= 0) {
      score += 5;
      reasons.push("Volumen relativo expandiéndose");
    } else {
      score -= 5;
      risks.push("Volumen vendedor expandiéndose");
    }
  }

  score = Math.round(clamp(score));
  const bias: MarketBias = score >= 62 ? "BULLISH" : score <= 38 ? "BEARISH" : "NEUTRAL";

  return {
    timeframe,
    price: current.close,
    changePct,
    score,
    bias,
    ema20,
    ema50,
    ema200,
    rsi14,
    atr14,
    atrPct: atr14 === null ? null : (atr14 / current.close) * 100,
    macd: macdValue.value,
    macdSignal: macdValue.signal,
    macdHistogram: macdValue.histogram,
    relativeVolume: relVolume,
    support,
    resistance,
    volume: current.volume,
    quoteVolume: current.quoteVolume,
    candleCount: candles.length,
    lastCandleAt: new Date(current.closeTime).toISOString(),
    reasons,
    risks,
  };
}

export function theoreticalLiquidationZones(referencePrice: number): LiquidationZone[] {
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) return [];
  const maintenanceBuffer = 0.005;
  return ([5, 10, 20, 50, 100] as const).map((leverage) => {
    const longPrice = referencePrice * (1 - 1 / leverage + maintenanceBuffer);
    const shortPrice = referencePrice * (1 + 1 / leverage - maintenanceBuffer);
    return {
      leverage,
      longPrice,
      shortPrice,
      longDistancePct: ((longPrice / referencePrice) - 1) * 100,
      shortDistancePct: ((shortPrice / referencePrice) - 1) * 100,
    };
  });
}

export function buildConsensus(
  analyses: Record<BrainTimeframe, TimeframeAnalysis | null>,
  derivatives: DerivativesSnapshot,
): Omit<BrainConsensus, "calibratedConfidence"> {
  const weights: Record<BrainTimeframe, number> = {
    "5m": 0.1,
    "15m": 0.2,
    "1h": 0.25,
    "4h": 0.3,
    "1d": 0.15,
  };
  const valid = BRAIN_TIMEFRAMES
    .map((timeframe) => analyses[timeframe])
    .filter((analysis): analysis is TimeframeAnalysis => analysis !== null);
  if (!valid.length) {
    return {
      score: 50,
      bias: "NEUTRAL",
      alignmentPct: 0,
      alignedFrames: 0,
      validFrames: 0,
      rawConfidence: 0,
      verdict: "NEUTRAL",
      reasons: [],
      risks: ["Datos multi-temporalidad no disponibles"],
    };
  }
  const weightTotal = valid.reduce((sum, item) => sum + weights[item.timeframe], 0);
  let score = valid.reduce(
    (sum, item) => sum + item.score * weights[item.timeframe],
    0,
  ) / weightTotal;
  const bullish = valid.filter((item) => item.bias === "BULLISH").length;
  const bearish = valid.filter((item) => item.bias === "BEARISH").length;
  const bias: MarketBias = score >= 58 ? "BULLISH" : score <= 42 ? "BEARISH" : "NEUTRAL";
  const alignedFrames = bias === "BULLISH" ? bullish : bias === "BEARISH" ? bearish : 0;
  const alignmentPct = (alignedFrames / valid.length) * 100;
  const reasons: string[] = [];
  const risks: string[] = [];

  if (derivatives.available) {
    if (derivatives.openInterestChangePct !== null) {
      if (derivatives.openInterestChangePct > 2) reasons.push("Open Interest en expansión");
      if (derivatives.openInterestChangePct < -2) risks.push("Open Interest contrayéndose");
    }
    if (derivatives.fundingRatePct !== null && Math.abs(derivatives.fundingRatePct) > 0.05) {
      score += derivatives.fundingRatePct > 0 ? -3 : 3;
      risks.push(`Funding exigente (${derivatives.fundingRatePct.toFixed(4)}%)`);
    }
    if (derivatives.takerBuySellRatio !== null) {
      if (derivatives.takerBuySellRatio >= 1.05) reasons.push("Taker flow comprador");
      if (derivatives.takerBuySellRatio <= 0.95) risks.push("Taker flow vendedor");
    }
  }

  score = clamp(score);
  const rawConfidence = Math.round(clamp(
    Math.abs(score - 50) * 1.05 + alignmentPct * 0.55,
    0,
    96,
  ));
  const strong = alignmentPct >= 60 && Math.abs(score - 50) >= 14;
  const verdict = strong
    ? "ALTA CONFLUENCIA"
    : bias === "BULLISH"
      ? "VIGILANCIA ALCISTA"
      : bias === "BEARISH"
        ? "VIGILANCIA BAJISTA"
        : "NEUTRAL";

  if (alignmentPct >= 60) reasons.unshift(`${alignedFrames}/${valid.length} temporalidades alineadas`);
  if (alignmentPct < 50) risks.unshift("Alineación multi-timeframe insuficiente");

  return {
    score: Math.round(score),
    bias,
    alignmentPct,
    alignedFrames,
    validFrames: valid.length,
    rawConfidence,
    verdict,
    reasons,
    risks,
  };
}
