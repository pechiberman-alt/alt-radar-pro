import { findPivots, type SwingCandle, type SwingPoint } from "./swing-entries.ts";

/**
 * Fibonacci retracement backtest.
 *
 * Answers one question with real numbers instead of a claim: when price
 * pulls back into 0.618 / 0.68 / 0.786 of a confirmed swing leg, does it
 * actually tend to hold and continue, or is that just a level someone
 * decided looks meaningful on a chart?
 *
 * No-repaint by construction: a swing leg only exists once both its pivots
 * are confirmed (see findPivots), and every level touch is graded using
 * only candles at or after the candle that touched it. Nothing here is
 * computed with information that would not have existed at the time.
 */

export const FIB_LEVELS = [0.618, 0.68, 0.786] as const;
export type FibLevel = (typeof FIB_LEVELS)[number];
export type FibSide = "LONG" | "SHORT";
export type FibTradeOutcome = "TARGET" | "STOP" | "TIMEOUT";

export type FibOutcome = {
  side: FibSide;
  level: FibLevel;
  legOriginPrice: number;
  legExtremePrice: number;
  touchIndex: number;
  touchTime: number;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  outcome: FibTradeOutcome;
  exitIndex: number;
  barsToResolve: number;
  /** Signed return relative to the risk taken: +2 means it paid 2x the risk. */
  rMultiple: number;
};

/** How many bars forward a trade is watched before it's marked TIMEOUT. */
const TIMEOUT_BARS = 200;

type Pivot = SwingPoint & { kind: "high" | "low" };

function resolveTrade(
  candles: SwingCandle[],
  touchIndex: number,
  side: FibSide,
  entryPrice: number,
  stopPrice: number,
  targetPrice: number,
): Pick<FibOutcome, "outcome" | "exitIndex" | "barsToResolve" | "rMultiple"> {
  const risk = Math.abs(entryPrice - stopPrice);
  const horizon = Math.min(candles.length - 1, touchIndex + TIMEOUT_BARS);

  for (let idx = touchIndex; idx <= horizon; idx += 1) {
    const candle = candles[idx];
    const hitStop = side === "LONG" ? candle.low <= stopPrice : candle.high >= stopPrice;
    const hitTarget = side === "LONG" ? candle.high >= targetPrice : candle.low <= targetPrice;

    // A candle that reaches both in the same bar is graded as the stop —
    // OHLC data alone can't say which came first, and assuming the better
    // outcome would flatter the level being tested.
    if (hitStop) {
      return { outcome: "STOP", exitIndex: idx, barsToResolve: idx - touchIndex, rMultiple: -1 };
    }
    if (hitTarget) {
      const reward = Math.abs(targetPrice - entryPrice);
      return {
        outcome: "TARGET",
        exitIndex: idx,
        barsToResolve: idx - touchIndex,
        rMultiple: risk > 0 ? reward / risk : 0,
      };
    }
  }

  const last = candles[horizon];
  const openReturn = side === "LONG" ? last.close - entryPrice : entryPrice - last.close;
  return {
    outcome: "TIMEOUT",
    exitIndex: horizon,
    barsToResolve: horizon - touchIndex,
    rMultiple: risk > 0 ? openReturn / risk : 0,
  };
}

/**
 * Walks the candle series once, chronologically, looking for confirmed
 * swing legs (an alternating pivot low -> high or high -> low) and grading
 * every Fibonacci level touch inside each leg's retracement window.
 */
export function runFibBacktest(candles: SwingCandle[]): FibOutcome[] {
  const { highs, lows } = findPivots(candles);
  const pivots: Pivot[] = [
    ...highs.map((p) => ({ ...p, kind: "high" as const })),
    ...lows.map((p) => ({ ...p, kind: "low" as const })),
  ].sort((a, b) => a.index - b.index);

  const outcomes: FibOutcome[] = [];

  for (let i = 0; i < pivots.length - 1; i += 1) {
    const a = pivots[i];
    const b = pivots[i + 1];
    if (a.kind === b.kind) continue; // a leg needs alternating high/low

    const side: FibSide = a.kind === "low" ? "LONG" : "SHORT";
    const origin = a.kind === "low" ? a : b; // swing low
    const extreme = a.kind === "high" ? a : b; // swing high
    const legSize = extreme.price - origin.price;
    if (legSize <= 0) continue;

    const confirmedAt = Math.max(a.index, b.index);
    const seenLevels = new Set<FibLevel>();

    for (let idx = confirmedAt + 1; idx < candles.length; idx += 1) {
      const candle = candles[idx];

      // The leg is spent once price breaks past either end: fully
      // invalidated (back through the origin) or fully extended (a fresh
      // extreme, which starts a new leg on the next pivot instead).
      if (side === "LONG" && (candle.low < origin.price || candle.high > extreme.price)) break;
      if (side === "SHORT" && (candle.high > origin.price || candle.low < extreme.price)) break;

      for (const level of FIB_LEVELS) {
        if (seenLevels.has(level)) continue;
        const entryPrice =
          side === "LONG" ? extreme.price - legSize * level : extreme.price + legSize * level;
        const touched = candle.low <= entryPrice && candle.high >= entryPrice;
        if (!touched) continue;
        seenLevels.add(level);

        const stopPrice = origin.price;
        const targetPrice = extreme.price;
        const resolved = resolveTrade(candles, idx, side, entryPrice, stopPrice, targetPrice);

        outcomes.push({
          side,
          level,
          legOriginPrice: origin.price,
          legExtremePrice: extreme.price,
          touchIndex: idx,
          touchTime: candle.openTime,
          entryPrice,
          stopPrice,
          targetPrice,
          ...resolved,
        });
      }
    }
  }

  return outcomes;
}

export type FibLevelStats = {
  level: FibLevel;
  side: FibSide | "ALL";
  trades: number;
  wins: number;
  winRate: number | null;
  avgR: number | null;
  profitFactor: number | null;
  sampleQuality: "DATA INSUFICIENTE" | "MUESTRA BAJA" | "MUESTRA AUDITABLE";
};

function sampleQuality(n: number): FibLevelStats["sampleQuality"] {
  return n === 0 ? "DATA INSUFICIENTE" : n < 10 ? "MUESTRA BAJA" : "MUESTRA AUDITABLE";
}

function summarize(rows: FibOutcome[], level: FibLevel, side: FibSide | "ALL"): FibLevelStats {
  const trades = rows.length;
  const wins = rows.filter((o) => o.rMultiple > 0).length;
  const grossWin = rows.filter((o) => o.rMultiple > 0).reduce((sum, o) => sum + o.rMultiple, 0);
  const grossLoss = Math.abs(
    rows.filter((o) => o.rMultiple < 0).reduce((sum, o) => sum + o.rMultiple, 0),
  );
  return {
    level,
    side,
    trades,
    wins,
    winRate: trades ? (wins / trades) * 100 : null,
    avgR: trades ? rows.reduce((sum, o) => sum + o.rMultiple, 0) / trades : null,
    profitFactor: trades === 0 ? null : grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? null : 0,
    sampleQuality: sampleQuality(trades),
  };
}

/** Compares every level side-by-side — this is the "0.68 vs 0.78" answer. */
export function aggregateFibOutcomes(outcomes: FibOutcome[]): FibLevelStats[] {
  const stats: FibLevelStats[] = [];
  for (const level of FIB_LEVELS) {
    const rows = outcomes.filter((o) => o.level === level);
    stats.push(summarize(rows, level, "ALL"));
    stats.push(summarize(rows.filter((o) => o.side === "LONG"), level, "LONG"));
    stats.push(summarize(rows.filter((o) => o.side === "SHORT"), level, "SHORT"));
  }
  return stats;
}
