import {
  analyzeCandles,
  clamp,
  type Candle,
  type TimeframeAnalysis,
} from "./market-brain";
import type { MarketAsset, ScoreReason } from "./radar";

export type ScalpStatus = "WATCH" | "SETUP" | "TRIGGER" | "NO SIGNAL";

export type ScalpSignal = {
  symbol: string;
  generatedAt: string;
  source: string;
  side: "LONG" | "SHORT" | "NEUTRAL";
  status: ScalpStatus;
  score: number;
  technicalScore: number;
  confirmationCount: number;
  price: number;
  entryLow: number;
  entryHigh: number;
  stop: number;
  target1: number;
  target2: number;
  target3: number;
  riskReward: number;
  expiresAt: string;
  timeframe: "5M / 15M";
  spreadPct: number | null;
  quoteVolume: number;
  change5m: number | null;
  change15m: number | null;
  change1h: number | null;
  relativeVolume: number | null;
  rsi5m: number | null;
  rsi15m: number | null;
  atrPct: number | null;
  breakoutDistancePct: number | null;
  extended: boolean;
  dataQuality: "FULL" | "PARTIAL";
  reasons: ScoreReason[];
  penalties: ScoreReason[];
};

export type ScalpContext = {
  riskScore: number | null;
  killSwitch: boolean;
  altseasonScore: number | null;
  btcChange15m: number | null;
  ethChange15m: number | null;
  minimumQuoteVolume?: number;
};

const finite = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

function recentSwing(candles: Candle[], side: "LONG" | "SHORT") {
  const sample = candles.slice(-13, -1);
  if (!sample.length) return null;
  return side === "LONG"
    ? Math.min(...sample.map((candle) => candle.low))
    : Math.max(...sample.map((candle) => candle.high));
}

function directionFrom(
  five: TimeframeAnalysis,
  fifteen: TimeframeAnalysis,
): "LONG" | "SHORT" {
  const combined = (five.score - 50) * 0.58 + (fifteen.score - 50) * 0.42;
  return combined >= 0 ? "LONG" : "SHORT";
}

function level(price: number, risk: number, side: "LONG" | "SHORT", rr: number) {
  return Math.max(0, price + (side === "LONG" ? 1 : -1) * risk * rr);
}

export function buildScalpSignal(
  asset: MarketAsset,
  candles5m: Candle[],
  candles15m: Candle[],
  context: ScalpContext,
  generatedAt = new Date().toISOString(),
): ScalpSignal | null {
  const five = analyzeCandles(candles5m, "5m");
  const fifteen = analyzeCandles(candles15m, "15m");
  if (!five || !fifteen || !five.price || !five.atr14) return null;

  const side = directionFrom(five, fifteen);
  const sign = side === "LONG" ? 1 : -1;
  const price = five.price;
  const atr = five.atr14;
  const alignedBias =
    (side === "LONG" && five.bias === "BULLISH" && fifteen.bias === "BULLISH") ||
    (side === "SHORT" && five.bias === "BEARISH" && fifteen.bias === "BEARISH");
  const trendAligned = [five, fifteen].every((analysis) =>
    finite(analysis.ema20) && finite(analysis.ema50) &&
    (analysis.ema20! - analysis.ema50!) * sign > 0 &&
    (analysis.price - analysis.ema20!) * sign > 0,
  );
  const momentumConfirmed =
    five.changePct * sign > 0 && fifteen.changePct * sign > 0;
  const volumeConfirmed =
    (five.relativeVolume ?? 0) >= 1.2 || (fifteen.relativeVolume ?? 0) >= 1.15;
  const macdConfirmed =
    (five.macdHistogram ?? 0) * sign > 0 &&
    (fifteen.macdHistogram ?? 0) * sign > 0;
  const rsiHealthy = side === "LONG"
    ? (five.rsi14 ?? 0) >= 48 && (five.rsi14 ?? 100) <= 72 &&
      (fifteen.rsi14 ?? 0) >= 48 && (fifteen.rsi14 ?? 100) <= 74
    : (five.rsi14 ?? 100) <= 52 && (five.rsi14 ?? 0) >= 27 &&
      (fifteen.rsi14 ?? 100) <= 52 && (fifteen.rsi14 ?? 0) >= 25;
  const structure = side === "LONG" ? five.resistance : five.support;
  const breakoutDistancePct = finite(structure)
    ? ((structure / price) - 1) * 100 * sign
    : null;
  const structureConfirmed = finite(structure) &&
    (side === "LONG" ? price >= structure - atr * 0.35 : price <= structure + atr * 0.35);
  const referenceChange = context.btcChange15m ?? context.ethChange15m;
  const relativeConfirmed = finite(asset.change15m) && finite(referenceChange)
    ? (asset.change15m - referenceChange) * sign > 0
    : false;
  const spreadPct = finite(asset.spreadPct) ? asset.spreadPct : null;
  const liquidityConfirmed =
    asset.quoteVolume >= (context.minimumQuoteVolume ?? 10_000_000) &&
    spreadPct !== null && spreadPct <= 0.15;
  const emaDistance = finite(five.ema20) ? Math.abs(price - five.ema20) / atr : null;
  const lastCandleRange = Math.abs(five.changePct);
  const extended =
    (emaDistance !== null && emaDistance > 2.2) ||
    (side === "LONG" ? (five.rsi14 ?? 0) > 76 : (five.rsi14 ?? 100) < 24) ||
    lastCandleRange > Math.max((five.atrPct ?? 0) * 1.9, 2.8) ||
    (finite(asset.change5m) && Math.abs(asset.change5m) > 4.5);

  const reasons: ScoreReason[] = [
    { label: "Alineación real 5M + 15M", points: alignedBias ? 18 : 4 },
    { label: "Volumen relativo confirmado", points: volumeConfirmed ? 14 : 4 },
    { label: "Tendencia EMA 20/50", points: trendAligned ? 13 : 3 },
    { label: "Aceleración de momentum", points: momentumConfirmed ? 12 : 3 },
    { label: "MACD acompaña", points: macdConfirmed ? 10 : 2 },
    { label: "RSI operable", points: rsiHealthy ? 8 : 2 },
    { label: side === "LONG" ? "Ruptura / ataque a resistencia" : "Breakdown / ataque a soporte", points: structureConfirmed ? 12 : 3 },
    { label: "Fuerza relativa vs BTC", points: relativeConfirmed ? 7 : 2 },
    { label: "Liquidez y spread", points: liquidityConfirmed ? 10 : 0 },
    {
      label: "Contexto Altseason",
      points: context.altseasonScore !== null &&
        ((side === "LONG" && context.altseasonScore >= 41) ||
          (side === "SHORT" && context.altseasonScore < 41)) ? 5 : 1,
    },
  ];
  const technicalScore = Math.round(clamp(reasons.reduce((sum, item) => sum + item.points, 0)));
  const penalties: ScoreReason[] = [
    ...(extended ? [{ label: "Anti-FOMO: movimiento extendido", points: -25 }] : []),
    ...(context.killSwitch ? [{ label: "Contexto macro extremo", points: -12 }] : []),
    ...(context.riskScore === null ? [{ label: "Macro no disponible", points: -8 }] : []),
    ...(context.riskScore !== null && context.riskScore > 60
      ? [{ label: "Riesgo geopolítico elevado", points: context.riskScore > 80 ? -25 : -10 }]
      : []),
    ...(!liquidityConfirmed ? [{ label: "Liquidez o spread insuficiente", points: -18 }] : []),
    ...(!volumeConfirmed ? [{ label: "Volumen sin confirmar", points: -12 }] : []),
    ...(!alignedBias ? [{ label: "5M y 15M no alineados", points: -12 }] : []),
    ...(!structureConfirmed ? [{ label: "Estructura aún no confirmada", points: -8 }] : []),
    ...(asset.change1h !== null && asset.change1h * sign < 0
      ? [{ label: "1H contradice el scalp", points: -7 }]
      : []),
  ];
  const score = Math.round(clamp(
    technicalScore + penalties.reduce((sum, item) => sum + item.points, 0),
  ));
  const confirmations = [
    alignedBias,
    volumeConfirmed,
    trendAligned,
    momentumConfirmed,
    macdConfirmed,
    rsiHealthy,
    structureConfirmed,
    liquidityConfirmed,
    relativeConfirmed,
  ];
  const confirmationCount = confirmations.filter(Boolean).length;
  const triggerReady =
    alignedBias && volumeConfirmed && trendAligned && momentumConfirmed &&
    structureConfirmed && liquidityConfirmed && confirmationCount >= 6;

  const swing = recentSwing(candles5m, side);
  const structuralStop = finite(swing)
    ? side === "LONG" ? swing - atr * 0.08 : swing + atr * 0.08
    : side === "LONG" ? price - atr * 1.25 : price + atr * 1.25;
  const stop = structuralStop;
  const riskUnit = Math.abs(price - stop);
  const validRisk = riskUnit >= atr * 0.65 && riskUnit <= atr * 2.4;
  if (!validRisk) penalties.push({ label: "Stop estructural fuera de rango", points: -12 });
  const finalScore = validRisk ? score : Math.round(clamp(score - 12));
  // Macro context weighs on the score but does not veto the read; only the
  // asset being extended voids its own setup.
  const status: ScalpStatus = extended
    ? "NO SIGNAL"
    : finalScore >= 85 && triggerReady && validRisk
      ? "TRIGGER"
      : finalScore >= 75 && alignedBias && liquidityConfirmed && validRisk
        ? "SETUP"
        : finalScore >= 65 && validRisk
          ? "WATCH"
          : "NO SIGNAL";
  const entryLow = side === "LONG" ? price - atr * 0.12 : price - atr * 0.04;
  const entryHigh = side === "LONG" ? price + atr * 0.04 : price + atr * 0.12;
  const entryMid = (entryLow + entryHigh) / 2;
  const entryRisk = Math.abs(entryMid - stop);

  return {
    symbol: asset.symbol,
    generatedAt,
    source: "Binance / Binance.US Spot · velas cerradas 5M/15M · ticker 24H",
    side: status === "NO SIGNAL" ? "NEUTRAL" : side,
    status,
    score: finalScore,
    technicalScore,
    confirmationCount,
    price,
    entryLow,
    entryHigh,
    stop,
    target1: level(entryMid, entryRisk, side, 1.2),
    target2: level(entryMid, entryRisk, side, 1.8),
    target3: level(entryMid, entryRisk, side, 2.6),
    riskReward: 2.6,
    expiresAt: new Date(Date.parse(generatedAt) + 15 * 60_000).toISOString(),
    timeframe: "5M / 15M",
    spreadPct,
    quoteVolume: asset.quoteVolume,
    change5m: asset.change5m ?? five.changePct,
    change15m: asset.change15m ?? fifteen.changePct,
    change1h: asset.change1h,
    relativeVolume: five.relativeVolume,
    rsi5m: five.rsi14,
    rsi15m: fifteen.rsi14,
    atrPct: five.atrPct,
    breakoutDistancePct,
    extended,
    dataQuality: spreadPct !== null && context.riskScore !== null ? "FULL" : "PARTIAL",
    reasons,
    penalties,
  };
}
