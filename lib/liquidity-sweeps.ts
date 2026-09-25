import { findPivots, type SwingCandle } from "./swing-entries.ts";

/**
 * Liquidity sweeps ("tomas de liquidez"): a candle that trades beyond a prior
 * confirmed swing high or low — where stops rest — and closes back inside.
 * The stops were taken, the level did not break.
 *
 * A close beyond the level is a breakout, not a sweep, and ends the search on
 * that pivot. Only the first attempt on each pivot is considered.
 */

export type Sweep = {
  /** Buy-side = stops above a high (bearish reaction expected); sell-side = below a low. */
  side: "COMPRA" | "VENTA";
  pivotIndex: number;
  index: number;
  level: number;
  extreme: number;
  /** How far past the level the wick went, % of price. */
  depthPct: number;
};

export function findSweeps(candles: SwingCandle[], span = 3, lookback = 250, maxWait = 80): Sweep[] {
  if (candles.length < span * 2 + 5) return [];
  const { highs, lows } = findPivots(candles, span);
  const last = candles.length - 1;
  const out: Sweep[] = [];
  const scan = (pivots: { index: number; price: number }[], above: boolean) => {
    for (const p of pivots) {
      if (last - p.index > lookback) continue;
      for (let j = p.index + span + 1; j <= Math.min(last, p.index + maxWait); j += 1) {
        const c = candles[j];
        const pierced = above ? c.high > p.price : c.low < p.price;
        if (!pierced) continue;
        const backInside = above ? c.close < p.price : c.close > p.price;
        if (backInside) {
          const extreme = above ? c.high : c.low;
          out.push({
            side: above ? "COMPRA" : "VENTA",
            pivotIndex: p.index,
            index: j,
            level: p.price,
            extreme,
            depthPct: (Math.abs(extreme - p.price) / p.price) * 100,
          });
        }
        break; // first touch decides: sweep or breakout
      }
    }
  };
  scan(highs, true);
  scan(lows, false);
  return out.sort((a, b) => b.index - a.index);
}

export type SweepStats = { tested: number; worked: number; rate: number | null; confidence: "SIN MUESTRA" | "MUESTRA MÍNIMA" | "MUESTRA RAZONABLE" };

/** A sweep "worked" if price then moved 1 ATR away from the swept side
 *  before 1 ATR further through it, within `horizon` candles. */
export function sweepStats(candles: SwingCandle[], sweeps: Sweep[], horizon = 12): SweepStats {
  let tested = 0;
  let worked = 0;
  for (const s of sweeps) {
    if (s.index + horizon > candles.length - 1) continue;
    let sum = 0;
    for (let k = Math.max(1, s.index - 13); k <= s.index; k += 1) {
      sum += Math.max(candles[k].high - candles[k].low, Math.abs(candles[k].high - candles[k - 1].close), Math.abs(candles[k].low - candles[k - 1].close));
    }
    const atr = sum / Math.min(14, s.index);
    if (!(atr > 0)) continue;
    const entry = candles[s.index].close;
    const reversalDown = s.side === "COMPRA";
    let result = false;
    for (let i = s.index + 1; i <= s.index + horizon; i += 1) {
      const favor = reversalDown ? entry - candles[i].low : candles[i].high - entry;
      const against = reversalDown ? candles[i].high - entry : entry - candles[i].low;
      if (against >= atr) break;
      if (favor >= atr) {
        result = true;
        break;
      }
    }
    tested += 1;
    if (result) worked += 1;
  }
  return {
    tested,
    worked,
    rate: tested ? worked / tested : null,
    confidence: tested === 0 ? "SIN MUESTRA" : tested < 8 ? "MUESTRA MÍNIMA" : "MUESTRA RAZONABLE",
  };
}
