import type { SwingCandle } from "./swing-entries";

/**
 * Order blocks: the last opposing candle before an impulsive move that broke
 * structure.
 *
 * WHAT THE IDEA CLAIMS
 *
 * The reasoning is that a large participant absorbing supply cannot fill a
 * whole position at one price, so price is driven away before the rest is
 * filled — leaving unfilled interest at the origin of the move. A return to
 * that origin is then read as an opportunity for that interest to be filled.
 *
 * HOW MUCH WEIGHT TO GIVE IT
 *
 * This is a market-structure convention, widely used and not empirically
 * established the way, say, a maintenance-margin formula is. It describes
 * where a move began, which is a fact, and infers intent from it, which is
 * not. The panel presents the levels and lets them be judged; it does not
 * claim a hit rate.
 *
 * WHY STRICT DETECTION MATTERS MORE HERE THAN ANYWHERE
 *
 * Loose criteria find an order block on nearly every candle, and a chart
 * marked with twenty blocks has marked none of them. Three conditions are
 * required together, and each one removes a different kind of false
 * positive:
 *
 *   1. DISPLACEMENT — the move out must be large against recent range, not
 *      merely green. This removes ordinary candles that happen to follow a
 *      red one.
 *   2. STRUCTURE BREAK — the move must take out a prior swing point. This
 *      removes impulses inside a range that changed nothing.
 *   3. UNMITIGATED — price must not have traded back through the zone since.
 *      A block price already returned to has, by the idea's own logic, done
 *      its job; leaving it on the chart is clutter pretending to be a level.
 */

export type OrderBlock = {
  side: "ALCISTA" | "BAJISTA";
  /** Zone bounds — the body-to-wick span of the originating candle. */
  low: number;
  high: number;
  /** Midpoint, useful as the single price to quote. */
  mid: number;
  /** Candle index where the block sits. */
  index: number;
  time: number;
  /** Size of the move that left it, in multiples of average range. */
  displacement: number;
  /** Volume of the origin candle over the local average. */
  volumeRatio: number;
  /** 0–100, combining displacement, volume and freshness. */
  strength: number;
  /** How many candles ago it formed. */
  ageCandles: number;
};

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

/** True range average, the yardstick displacement is measured against. */
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

export type OrderBlockOptions = {
  /** Minimum move out of the block, in average ranges. */
  minDisplacement?: number;
  /** How many candles the impulse may take to develop. */
  impulseWindow?: number;
  /** Cap on how many blocks to return, strongest first. */
  limit?: number;
};

export function findOrderBlocks(
  candles: SwingCandle[],
  options: OrderBlockOptions = {},
): OrderBlock[] {
  const minDisplacement = options.minDisplacement ?? 1.8;
  const impulseWindow = options.impulseWindow ?? 4;
  const limit = options.limit ?? 6;

  // Needs enough history for a range yardstick and a structure reference.
  if (candles.length < 40) return [];

  const blocks: OrderBlock[] = [];
  const last = candles.length - 1;

  // Leave room for the impulse to develop after the candidate.
  for (let i = 20; i < candles.length - impulseWindow - 1; i += 1) {
    const candle = candles[i];
    const bullishBlock = candle.close < candle.open;
    const bearishBlock = candle.close > candle.open;
    if (!bullishBlock && !bearishBlock) continue;

    const range = averageRange(candles, i);
    if (!(range > 0)) continue;

    // The origin of a move is a modest opposing candle. What disqualifies a
    // candidate is a large BODY — that is an impulsive candle, part of the
    // move rather than its origin, and marking it would place the zone on
    // the move instead of where the move began. Total range is the wrong
    // measure here: a wick-heavy candle can be a perfectly good origin.
    if (Math.abs(candle.close - candle.open) > range * 3) continue;

    const impulse = candles.slice(i + 1, i + 1 + impulseWindow);
    if (!impulse.length) continue;

    // 1. Displacement: how far the move carried out of the candle.
    const move = bullishBlock
      ? Math.max(...impulse.map((c) => c.high)) - candle.low
      : candle.high - Math.min(...impulse.map((c) => c.low));
    const displacement = move / range;
    if (displacement < minDisplacement) continue;

    // 2. Structure break: the impulse must clear the prior 20 candles'
    //    extreme, not merely move within the existing range.
    const priorWindow = candles.slice(Math.max(0, i - 20), i);
    const priorHigh = Math.max(...priorWindow.map((c) => c.high));
    const priorLow = Math.min(...priorWindow.map((c) => c.low));
    const broke = bullishBlock
      ? Math.max(...impulse.map((c) => c.high)) > priorHigh
      : Math.min(...impulse.map((c) => c.low)) < priorLow;
    if (!broke) continue;

    // 3. Unmitigated: price must not have traded back into the zone once it
    //    left. Checking only after a fixed window missed the case where price
    //    returns while the impulse is still developing — which mitigates the
    //    block just as completely.
    const low = Math.min(candle.open, candle.close, candle.low);
    const high = Math.max(candle.open, candle.close, candle.high);
    const touches = (c: SwingCandle) => c.low <= high && c.high >= low;

    let left = false;
    let mitigated = false;
    for (let j = i + 1; j <= last; j += 1) {
      if (!left) {
        if (!touches(candles[j])) left = true;
        continue;
      }
      if (touches(candles[j])) {
        mitigated = true;
        break;
      }
    }
    if (mitigated) continue;

    const localVolume = average(
      candles.slice(Math.max(0, i - 20), i).map((c) => c.volume),
    );
    const volumeRatio = localVolume > 0 ? candle.volume / localVolume : 1;

    const ageCandles = last - i;
    // Freshness decays across the visible history: an untouched block from
    // 200 candles ago is less a live level than one from twenty.
    const freshness = Math.max(0, 1 - ageCandles / Math.max(1, candles.length));

    const strength = Math.round(
      Math.min(
        100,
        Math.min(displacement / 4, 1) * 55 +
          Math.min(volumeRatio / 3, 1) * 25 +
          freshness * 20,
      ),
    );

    blocks.push({
      side: bullishBlock ? "ALCISTA" : "BAJISTA",
      low,
      high,
      mid: (low + high) / 2,
      index: i,
      time: candle.openTime,
      displacement,
      volumeRatio,
      strength,
      ageCandles,
    });
  }

  // Overlapping blocks describe the same zone; keep the stronger one so the
  // chart shows distinct levels rather than a stack of near-duplicates.
  const distinct: OrderBlock[] = [];
  for (const block of [...blocks].sort((a, b) => b.strength - a.strength)) {
    const overlaps = distinct.some(
      (kept) => kept.side === block.side && block.low <= kept.high && block.high >= kept.low,
    );
    if (!overlaps) distinct.push(block);
  }

  return distinct.slice(0, limit).sort((a, b) => b.mid - a.mid);
}
