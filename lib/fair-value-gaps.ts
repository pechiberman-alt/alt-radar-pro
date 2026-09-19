import type { SwingCandle } from "./swing-entries";

/**
 * Fair value gaps and their inversions.
 *
 * WHAT A FVG IS, MECHANICALLY
 *
 * Three consecutive candles where the first and third do not overlap: price
 * moved so fast that a band of prices never traded on both sides. The reading
 * is that the move was one-sided enough to leave unfilled interest behind,
 * and that price tends to revisit it. The gap itself is a fact of the data;
 * what it implies is a convention, and this module keeps that line visible.
 *
 * WHAT AN INVERTED FVG IS, AND WHY IT IS THE MORE USEFUL ONE
 *
 * A gap that price closed THROUGH rather than merely into flips role: a
 * bullish gap that failed and was broken downward becomes resistance above.
 * This matters because a plain unfilled gap is only a magnet, while an
 * inverted one is evidence that an attempt in that direction already failed
 * there. The failure is observable, not assumed, which is why inversions are
 * ranked above plain gaps here.
 *
 * "MAYOR EFECTIVIDAD" — WHAT THAT CAN AND CANNOT MEAN
 *
 * This module cannot tell you which gaps historically worked; no free data
 * source carries that, and claiming a hit rate without measuring it would be
 * the kind of number this project refuses to publish. What it does is rank by
 * the properties that make a gap worth watching at all — size against recent
 * range, whether displacement carried it, how much is still unfilled, and
 * whether it has already inverted — and say plainly that this is a ranking of
 * quality, not of proven outcomes.
 */

export type GapKind = "FVG" | "IFVG";

export type FairValueGap = {
  kind: GapKind;
  /** Direction the gap supports: a bullish FVG is demand below price. */
  side: "ALCISTA" | "BAJISTA";
  low: number;
  high: number;
  mid: number;
  index: number;
  time: number;
  /** Gap height in multiples of average range. */
  size: number;
  /** 0–100: how much of the gap price has already eaten into. */
  filledPct: number;
  /** 0–100 quality ranking — not a success rate. */
  quality: number;
  ageCandles: number;
};

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function averageRange(candles: SwingCandle[], end: number, period = 14): number {
  const from = Math.max(1, end - period);
  const ranges: number[] = [];
  for (let i = from; i < end; i += 1) {
    const previousClose = candles[i - 1].close;
    ranges.push(
      Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - previousClose),
        Math.abs(candles[i].low - previousClose),
      ),
    );
  }
  return average(ranges);
}

export type GapOptions = {
  /** Minimum gap height in average ranges. Below this it is noise. */
  minSize?: number;
  /** Gaps filled past this share are dropped as spent. */
  maxFilledPct?: number;
  limit?: number;
};

export function findFairValueGaps(
  candles: SwingCandle[],
  options: GapOptions = {},
): FairValueGap[] {
  const minSize = options.minSize ?? 0.35;
  const maxFilledPct = options.maxFilledPct ?? 85;
  const limit = options.limit ?? 8;

  if (candles.length < 30) return [];

  const found: FairValueGap[] = [];
  const last = candles.length - 1;

  // i is the middle candle; the gap is between i-1 and i+1.
  for (let i = 16; i < candles.length - 1; i += 1) {
    const before = candles[i - 1];
    const after = candles[i + 1];
    const range = averageRange(candles, i);
    if (!(range > 0)) continue;

    const bullish = after.low > before.high;
    const bearish = after.high < before.low;
    if (!bullish && !bearish) continue;

    const low = bullish ? before.high : after.high;
    const high = bullish ? after.low : before.low;
    const height = high - low;
    if (!(height > 0)) continue;

    const size = height / range;
    if (size < minSize) continue;

    // How far price has come back into the gap, and whether it has closed
    // clean through it — the two are different events with different meaning.
    const since = candles.slice(i + 2);
    let deepest = bullish ? high : low;
    let brokenThrough = false;
    for (const candle of since) {
      if (bullish) {
        deepest = Math.min(deepest, candle.low);
        if (candle.close < low) brokenThrough = true;
      } else {
        deepest = Math.max(deepest, candle.high);
        if (candle.close > high) brokenThrough = true;
      }
    }

    const penetration = bullish
      ? Math.min(Math.max(high - deepest, 0), height)
      : Math.min(Math.max(deepest - low, 0), height);
    const filledPct = (penetration / height) * 100;

    // A gap merely filled is spent. One closed THROUGH has inverted: the
    // attempt in that direction failed there, and the level flips side.
    if (!brokenThrough && filledPct > maxFilledPct) continue;

    const kind: GapKind = brokenThrough ? "IFVG" : "FVG";
    const side: FairValueGap["side"] = brokenThrough
      ? bullish
        ? "BAJISTA"
        : "ALCISTA"
      : bullish
        ? "ALCISTA"
        : "BAJISTA";

    const ageCandles = last - i;
    const freshness = Math.max(0, 1 - ageCandles / Math.max(1, candles.length));

    const quality = Math.round(
      Math.min(
        100,
        Math.min(size / 2, 1) * 40 +
          // An inversion carries observed failure, not just an unfilled band.
          (brokenThrough ? 25 : 0) +
          (1 - filledPct / 100) * 20 +
          freshness * 15,
      ),
    );

    found.push({
      kind,
      side,
      low,
      high,
      mid: (low + high) / 2,
      index: i,
      time: candles[i].openTime,
      size,
      filledPct,
      quality,
      ageCandles,
    });
  }

  // Overlapping gaps on the same side describe one band; keep the best.
  const distinct: FairValueGap[] = [];
  for (const gap of [...found].sort((a, b) => b.quality - a.quality)) {
    const overlaps = distinct.some(
      (kept) => kept.side === gap.side && gap.low <= kept.high && gap.high >= kept.low,
    );
    if (!overlaps) distinct.push(gap);
  }

  return distinct.slice(0, limit).sort((a, b) => b.mid - a.mid);
}
