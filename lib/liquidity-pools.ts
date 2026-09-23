import { findPivots, type SwingCandle } from "./swing-entries.ts";

/**
 * Liquidity pools: where resting orders cluster at prior highs and lows.
 *
 * WHAT THIS IS, AND WHY IT IS A DIFFERENT THING FROM THE OTHER TWO
 * "LIQUIDITY" MODULES IN THIS PROJECT
 *
 * Two things already carry the word "liquidity" in this codebase, and this
 * is neither of them:
 *
 *   - lib/liquidity-history.ts / liquidity-archive.ts: resting bid/ask depth
 *     in the ORDER BOOK, snapshotted over time.
 *   - lib/liquidation-heatmap.ts: an ESTIMATE of where leveraged positions
 *     would be force-closed, built from assumed leverage on top of a volume
 *     or open-interest profile.
 *
 * This is a third, older, and much simpler idea: when price makes two or
 * more highs at nearly the same level and fails to close meaningfully
 * beyond them, every trader who shorted that resistance placed a stop
 * just above it, and every breakout trader placed a buy order there too.
 * Both sit on the same side — buy orders — waiting to be triggered. The
 * more times a level held, the more of that has stacked up. The mirror is
 * true for equal lows: sell-side liquidity below.
 *
 * A pool needs only price data to identify: no leverage assumption, no
 * open-interest fetch. That is also its limit — it says orders are LIKELY
 * resting there because the structure says so, not that they are, and it
 * has no idea how large they are. It is read as a magnet, not a certainty.
 *
 * SWEPT MEANS TOUCHED, NOT CLOSED THROUGH — ON PURPOSE, AND DIFFERENT FROM
 * THE SUPPLY/DEMAND ZONES IN THIS SAME APP
 *
 * A resting stop order executes the instant price trades at it, not when a
 * candle closes past it. A wick through the level is enough to trigger
 * every order sitting there — the pool is consumed by the touch itself,
 * even if price immediately reverses. That is the opposite rule from
 * lib/supply-demand.ts, where a zone survives a touch and only breaks on a
 * close beyond it — and it is opposite on purpose: a supply/demand zone
 * asks whether the LEVEL still holds as support or resistance, while a
 * liquidity pool asks whether the ORDERS resting there have already fired.
 * Different mechanisms, different rules.
 */

export type PoolSide = "COMPRA" | "VENTA";

export type LiquidityPool = {
  side: PoolSide;
  /** Representative price of the cluster. */
  price: number;
  /** How many pivots contributed — more touches, more resting orders. */
  touches: number;
  /** Candle index of the most recent contributing pivot. */
  formedAt: number;
  /** True once price has traded through the level. */
  swept: boolean;
  /** Candle index where the sweep happened, if it has. */
  sweptAt: number | null;
  /** 0–100, from touch count and how tight the cluster is. */
  strength: number;
};

export type PoolOptions = {
  /** How close two pivots must be, as a share of price, to count as "equal". */
  tolerancePct?: number;
  /** Confirmation span passed to findPivots. */
  pivotSpan?: number;
  limit?: number;
};

function cluster(points: { index: number; price: number }[], tolerancePct: number) {
  const sorted = [...points].sort((a, b) => a.price - b.price);
  const groups: { index: number; price: number }[][] = [];
  for (const point of sorted) {
    const last = groups[groups.length - 1];
    const anchor = last?.[0];
    if (anchor && Math.abs(point.price - anchor.price) / anchor.price <= tolerancePct) {
      last.push(point);
    } else {
      groups.push([point]);
    }
  }
  return groups.filter((group) => group.length >= 2);
}

export function findLiquidityPools(
  candles: SwingCandle[],
  options: PoolOptions = {},
): LiquidityPool[] {
  const tolerancePct = options.tolerancePct ?? 0.0015;
  const pivotSpan = options.pivotSpan ?? 3;
  const limit = options.limit ?? 8;

  if (candles.length < pivotSpan * 2 + 10) return [];

  const { highs, lows } = findPivots(candles, pivotSpan);
  const last = candles.length - 1;

  const build = (
    groups: { index: number; price: number }[][],
    side: PoolSide,
  ): LiquidityPool[] =>
    groups.map((group) => {
      const price = group.reduce((sum, p) => sum + p.price, 0) / group.length;
      const formedAt = Math.max(...group.map((p) => p.index));
      const touches = group.length;

      // A resting order fires the instant price trades through it — a wick
      // is enough, a close is not required. Scanned from just after the
      // level's last confirming touch.
      let sweptAt: number | null = null;
      for (let i = formedAt + 1; i <= last; i += 1) {
        const touchedOrPassed =
          side === "COMPRA" ? candles[i].high >= price : candles[i].low <= price;
        if (touchedOrPassed) {
          sweptAt = i;
          break;
        }
      }

      const tightness = 1 - Math.min(...group.map((p) => Math.abs(p.price - price) / price)) / tolerancePct;
      const freshness = Math.max(0, 1 - (last - formedAt) / Math.max(1, candles.length));
      const strength = Math.round(
        Math.min(100, Math.min(touches / 4, 1) * 55 + Math.max(0, tightness) * 25 + freshness * 20),
      );

      return {
        side,
        price,
        touches,
        formedAt,
        swept: sweptAt !== null,
        sweptAt,
        strength,
      };
    });

  // Equal highs are where breakout buyers and trapped short-sellers both
  // rest buy orders — buy-side liquidity, above price. Equal lows are the
  // mirror: sell-side liquidity, below price.
  const pools = [
    ...build(cluster(highs, tolerancePct), "COMPRA"),
    ...build(cluster(lows, tolerancePct), "VENTA"),
  ];

  return pools
    .filter((pool) => !pool.swept)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, limit)
    .sort((a, b) => b.price - a.price);
}

export type MtfPool = LiquidityPool & {
  /** Stable key across timeframes, for rendering and label slots. */
  id: string;
  /** Frames where this level appears, largest first. */
  frames: string[];
};

const FRAME_RANK = ["1m", "5m", "15m", "30m", "1h", "4h", "12h", "1d", "3d", "1w"];

/**
 * Merges pools found on several frames into one list.
 *
 * The same resting-order level usually shows up on more than one chart. Drawn
 * once per frame it becomes two or three stacked lines saying the same thing;
 * merged, it becomes one line that states how many frames agree — and that
 * agreement is the useful information, since a level visible on the daily and
 * the 4h has had more traders placing orders at it than one seen only on the
 * 15-minute. Pools within `tolerancePct` on the same side are one level.
 */
export function mergeMtfPools(
  entries: { timeframe: string; pools: LiquidityPool[] }[],
  tolerancePct = 0.002,
): MtfPool[] {
  const merged: MtfPool[] = [];
  const rank = (tf: string) => FRAME_RANK.indexOf(tf);
  // Largest frames first, so a merged level keeps the higher frame's price.
  const ordered = [...entries].sort((a, b) => rank(b.timeframe) - rank(a.timeframe));

  for (const { timeframe, pools } of ordered) {
    for (const pool of pools) {
      const match = merged.find(
        (m) => m.side === pool.side && Math.abs(m.price - pool.price) / m.price <= tolerancePct,
      );
      if (match) {
        if (!match.frames.includes(timeframe)) match.frames.push(timeframe);
        match.touches += pool.touches;
        match.strength = Math.max(match.strength, pool.strength);
      } else {
        merged.push({
          ...pool,
          id: `${pool.side}-${timeframe}-${pool.price.toFixed(8)}`,
          frames: [timeframe],
        });
      }
    }
  }
  for (const m of merged) m.frames.sort((a, b) => rank(b) - rank(a));
  // More frames first, then strength: that is the order labels claim space in.
  return merged.sort((a, b) => b.frames.length - a.frames.length || b.strength - a.strength);
}
