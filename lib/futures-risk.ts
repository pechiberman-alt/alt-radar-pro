/**
 * Pure math over one raw Binance futures position: side, ROE, distance to
 * liquidation, and how much of that position's loss is actually capped.
 *
 * ISOLATED VS CROSS, AND WHY THIS MATTERS HERE
 *
 * In isolated margin, Binance guarantees a position can never lose more than
 * the margin allocated to it — `isolatedMargin` is a real ceiling. In cross
 * margin, a position's margin is shared with the rest of the account, so
 * there is no such per-position ceiling to report; asserting one would be
 * wrong, not just imprecise. `marginAtRiskUsd` is therefore only ever set
 * for isolated positions — null for cross, on purpose, not a missing value.
 *
 * `liquidationPrice: "0"` is not a real price (Binance uses it as "not
 * applicable" for a flat or very lightly-leveraged position) and is read as
 * null rather than as a level at $0.
 */

import type { RawFuturesAccount, RawFuturesPosition } from "./binance-futures.ts";

export type FuturesPositionView = {
  symbol: string;
  side: "LONG" | "SHORT";
  qty: number;
  entryPrice: number;
  markPrice: number;
  leverage: number;
  marginType: "isolated" | "cross";
  notionalUsd: number;
  unrealizedPnlUsd: number;
  /** Return on the margin actually backing the position; null when that
   *  margin basis can't be determined (e.g. leverage missing). */
  roePct: number | null;
  liquidationPrice: number | null;
  distanceToLiquidationPct: number | null;
  /** The most this position can lose, in dollars — only ever set for
   *  isolated margin, where Binance actually caps it there. */
  marginAtRiskUsd: number | null;
};

export function parseFuturesPosition(raw: RawFuturesPosition): FuturesPositionView {
  const qtySigned = Number(raw.positionAmt) || 0;
  const side: "LONG" | "SHORT" = qtySigned >= 0 ? "LONG" : "SHORT";
  const entryPrice = Number(raw.entryPrice) || 0;
  const markPrice = Number(raw.markPrice) || 0;
  const leverage = Number(raw.leverage) || 0;
  const notionalUsd = Math.abs(Number(raw.notional) || 0);
  const unrealizedPnlUsd = Number(raw.unRealizedProfit) || 0;
  const marginType: "isolated" | "cross" = raw.marginType === "cross" ? "cross" : "isolated";
  const isolatedMargin = Number(raw.isolatedMargin) || 0;

  const marginBasis =
    marginType === "isolated" && isolatedMargin > 0
      ? isolatedMargin
      : leverage > 0
        ? notionalUsd / leverage
        : 0;
  const roePct = marginBasis > 0 ? (unrealizedPnlUsd / marginBasis) * 100 : null;

  const rawLiq = Number(raw.liquidationPrice) || 0;
  const liquidationPrice = rawLiq > 0 ? rawLiq : null;
  const distanceToLiquidationPct =
    liquidationPrice !== null && markPrice > 0 ? (Math.abs(markPrice - liquidationPrice) / markPrice) * 100 : null;

  const marginAtRiskUsd = marginType === "isolated" && isolatedMargin > 0 ? isolatedMargin : null;

  return {
    symbol: raw.symbol,
    side,
    qty: Math.abs(qtySigned),
    entryPrice,
    markPrice,
    leverage,
    marginType,
    notionalUsd,
    unrealizedPnlUsd,
    roePct,
    liquidationPrice,
    distanceToLiquidationPct,
    marginAtRiskUsd,
  };
}

/** Open positions only — Binance's positionRisk lists every symbol,
 *  including flat ones with positionAmt "0". */
export function openFuturesPositions(raw: RawFuturesPosition[]): FuturesPositionView[] {
  return raw.map(parseFuturesPosition).filter((p) => p.qty > 0);
}

export function isNearLiquidation(distanceToLiquidationPct: number | null, thresholdPct = 10): boolean {
  return distanceToLiquidationPct !== null && distanceToLiquidationPct <= thresholdPct;
}

export type FuturesSummaryView = {
  totalWalletBalanceUsd: number;
  totalUnrealizedPnlUsd: number;
  totalMarginBalanceUsd: number;
  availableBalanceUsd: number;
  /** Share of the margin balance currently committed as initial margin —
   *  a coarse "how much room is left" read, not a liquidation distance. */
  marginUsagePct: number | null;
};

export function parseFuturesAccountSummary(raw: RawFuturesAccount): FuturesSummaryView {
  const totalMarginBalanceUsd = Number(raw.totalMarginBalance) || 0;
  const totalInitialMargin = Number(raw.totalInitialMargin) || 0;
  return {
    totalWalletBalanceUsd: Number(raw.totalWalletBalance) || 0,
    totalUnrealizedPnlUsd: Number(raw.totalUnrealizedProfit) || 0,
    totalMarginBalanceUsd,
    availableBalanceUsd: Number(raw.availableBalance) || 0,
    marginUsagePct: totalMarginBalanceUsd > 0 ? (totalInitialMargin / totalMarginBalanceUsd) * 100 : null,
  };
}
