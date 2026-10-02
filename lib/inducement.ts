import { findPivots, type SwingCandle } from "./swing-entries.ts";

/**
 * Inducement (IDM), as Smart Money Concepts uses it.
 *
 * After price breaks structure (BOS: a CLOSE beyond the last confirmed major
 * swing), the first real pullback leaves an easy minor low (in an uptrend) or
 * high (in a downtrend). Early buyers enter there and put their stops just
 * under it — that pool of stops is the inducement. The market tends to take
 * it before continuing, and an order block beyond a swept inducement is the
 * point of interest worth waiting for.
 *
 * WHAT IS DETECTED
 *   BOS      a close beyond the last major swing (confirmed by `majorSpan`
 *            candles on each side), each swing broken at most once.
 *   IDM      the first minor swing (one candle each side) after the BOS that
 *            is a real pullback: at least a quarter ATR back from the leg's
 *            extreme. If structure breaks the other way first, none.
 *   Swept    the first later candle that trades through the IDM.
 *
 * WHAT IS MEASURED
 * After the sweep, did the trend continue (price beyond the leg's extreme)
 * before it closed beyond the leg's origin (structure failed)? Within 80
 * candles, or it stays unresolved. A rate with its sample size, not a promise.
 *
 * Every step uses only candles available at the time: a swing is usable once
 * its confirming candles printed. Adding later candles never moves a BOS or an
 * IDM (tested); only their status can change.
 */

export type IdmSide = "ALCISTA" | "BAJISTA";
export type IdmOutcome = "CONTINUÓ" | "FALLÓ" | "SIN RESOLVER";
export type Inducement = {
  side: IdmSide;
  /** Candle that closed beyond the swing (break of structure). */
  bosIndex: number;
  /** The swing it broke. */
  brokenLevel: number;
  /** Where the leg started (lowest low before a bullish BOS; highest high before a bearish one). */
  legOrigin: number;
  idmIndex: number;
  level: number;
  sweptIndex: number | null;
  /** Only once swept. */
  outcome: IdmOutcome | null;
};

export type IdmOptions = { majorSpan?: number; minDepthAtr?: number; searchWindow?: number; horizon?: number };

function atrAt(c: SwingCandle[], i: number, n = 14): number {
  const from = Math.max(1, i - n + 1);
  let sum = 0;
  for (let k = from; k <= i; k += 1) sum += Math.max(c[k].high - c[k].low, Math.abs(c[k].high - c[k - 1].close), Math.abs(c[k].low - c[k - 1].close));
  return i >= 1 ? sum / (i - from + 1) : c[0].high - c[0].low;
}

export function findInducements(candles: SwingCandle[], options: IdmOptions = {}): Inducement[] {
  const majorSpan = options.majorSpan ?? 3;
  const minDepth = options.minDepthAtr ?? 0.25;
  const window = options.searchWindow ?? 60;
  const horizon = options.horizon ?? 80;
  const n = candles.length;
  if (n < majorSpan * 2 + 10) return [];
  const { highs, lows } = findPivots(candles, majorSpan);
  const out: Inducement[] = [];
  const brokenHighs = new Set<number>();
  const brokenLows = new Set<number>();
  let hi = 0;
  let lo = 0;
  let lastHigh: { index: number; price: number } | null = null;
  let lastLow: { index: number; price: number } | null = null;

  for (let i = 1; i < n; i += 1) {
    // Swings become usable once their confirming candles have closed.
    while (hi < highs.length && highs[hi].index + majorSpan < i) lastHigh = highs[hi++];
    while (lo < lows.length && lows[lo].index + majorSpan < i) lastLow = lows[lo++];
    const c = candles[i];
    for (const bullish of [true, false]) {
      const swing = bullish ? lastHigh : lastLow;
      if (!swing) continue;
      const broken = bullish ? brokenHighs : brokenLows;
      if (broken.has(swing.index)) continue;
      if (bullish ? c.close <= swing.price : c.close >= swing.price) continue;
      broken.add(swing.index);
      let origin = bullish ? Infinity : -Infinity;
      for (let k = swing.index; k <= i; k += 1) origin = bullish ? Math.min(origin, candles[k].low) : Math.max(origin, candles[k].high);

      // First real pullback after the break; a minor swing needs the candle after it.
      let extreme = bullish ? c.high : c.low;
      let idm: { index: number; level: number } | null = null;
      for (let m = i + 1; m < Math.min(n - 1, i + window); m += 1) {
        const prev = candles[m - 1];
        const cur = candles[m];
        const next = candles[m + 1];
        // Structure broken the other way before any pullback formed: no inducement.
        if (bullish ? cur.close < origin : cur.close > origin) break;
        const isPivot = bullish ? cur.low < prev.low && cur.low < next.low : cur.high > prev.high && cur.high > next.high;
        const depth = bullish ? extreme - cur.low : cur.high - extreme;
        if (isPivot && depth >= minDepth * atrAt(candles, m)) {
          idm = { index: m, level: bullish ? cur.low : cur.high };
          break;
        }
        extreme = bullish ? Math.max(extreme, cur.high) : Math.min(extreme, cur.low);
      }
      if (!idm) continue;

      let sweptIndex: number | null = null;
      for (let k = idm.index + 2; k < n; k += 1) {
        if (bullish ? candles[k].low < idm.level : candles[k].high > idm.level) {
          sweptIndex = k;
          break;
        }
      }
      let outcome: IdmOutcome | null = null;
      if (sweptIndex !== null) {
        let legExtreme = bullish ? -Infinity : Infinity;
        for (let k = i; k <= sweptIndex; k += 1) legExtreme = bullish ? Math.max(legExtreme, candles[k].high) : Math.min(legExtreme, candles[k].low);
        outcome = "SIN RESOLVER";
        for (let k = sweptIndex; k < Math.min(n, sweptIndex + horizon); k += 1) {
          const ck = candles[k];
          if (bullish ? ck.close < origin : ck.close > origin) {
            outcome = "FALLÓ";
            break;
          }
          if (k > sweptIndex && (bullish ? ck.high > legExtreme : ck.low < legExtreme)) {
            outcome = "CONTINUÓ";
            break;
          }
        }
      }
      out.push({ side: bullish ? "ALCISTA" : "BAJISTA", bosIndex: i, brokenLevel: swing.price, legOrigin: origin, idmIndex: idm.index, level: idm.level, sweptIndex, outcome });
    }
  }
  return out;
}

export type IdmStats = { resolved: number; continued: number; failed: number; rate: number | null; confidence: "SIN MUESTRA" | "MUESTRA MÍNIMA" | "MUESTRA RAZONABLE" };

export function idmStats(list: Inducement[]): IdmStats {
  const continued = list.filter((x) => x.outcome === "CONTINUÓ").length;
  const failed = list.filter((x) => x.outcome === "FALLÓ").length;
  const resolved = continued + failed;
  return {
    resolved, continued, failed,
    rate: resolved ? continued / resolved : null,
    confidence: resolved === 0 ? "SIN MUESTRA" : resolved < 15 ? "MUESTRA MÍNIMA" : "MUESTRA RAZONABLE",
  };
}
