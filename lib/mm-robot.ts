import { findLvSignals, lvStats, type FlushSeries, type LvStats } from "./liq-vol-signals.ts";
import type { SwingCandle } from "./swing-entries.ts";

/**
 * ROBOT MM: trades the way liquidity gets hunted, and studies itself first.
 *
 * THE IDEA
 * Large players need liquidity to fill: the stops resting beyond swing highs
 * and lows, and the forced orders of leveraged traders at their liquidation
 * prices. The pattern this robot looks for: price runs a swing (taking that
 * liquidity) and closes back inside; the next destination is the biggest pool
 * of liquidity left on the OTHER side. Entry at the reclaim, stop beyond the
 * wick, target at that pool (between 1R and 4R; 2R when there is none).
 *
 * THE LIQUIDITY MAP AT EACH MOMENT
 * Every estimated liquidation level carries when it formed and when price took
 * it. At a candle, the levels alive are those formed by then and not yet taken
 * — known with data up to that candle. Summed above and below the entry, they
 * give the imbalance and the pool to aim at.
 *
 * STUDY BEFORE TRADING
 * Sixteen variants (volume on the sweep, liquidations flushed, more liquidity
 * on the target side, with the trend — each on or off) are run as a robot would
 * trade them: one position at a time, worst case first, fees included. The
 * variants are chosen on the first 60% of the history and VALIDATED on the last
 * 40%, which played no part in choosing. A variant is approved only if it makes
 * money in both. With sixteen tries, one can look good by luck in-sample; the
 * held-out part is what catches that.
 */

export type LiveLevel = { price: number; weight: number; side: "long" | "short"; formedTime: number; sweptTime: number | null };

export type MmEvent = {
  index: number;
  time: number;
  side: "LONG" | "SHORT";
  entry: number;
  stop: number;
  risk: number;
  rvol: number;
  flushRatio: number | null;
  /** Liquidity alive above / below the entry at that moment (model units). */
  above: number;
  below: number;
  /** Target-side liquidity over same-side liquidity. */
  imbalance: number | null;
  /** Heaviest pool on the target side, if there is one. */
  pool: number | null;
  withTrend: boolean;
};

const RANGE = 0.08;
const BUCKET = 0.0025;

/** Liquidity alive at time `t` around `price`: sums above and below, and the heaviest pool each side. */
export function liquidityAt(levels: LiveLevel[], t: number, price: number) {
  const buckets = new Map<number, number>();
  let above = 0;
  let below = 0;
  for (const l of levels) {
    if (l.formedTime > t || (l.sweptTime !== null && l.sweptTime <= t)) continue;
    if (Math.abs(l.price / price - 1) > RANGE) continue;
    if (l.price > price) above += l.weight;
    else below += l.weight;
    const b = Math.round(Math.log(l.price / price) / BUCKET);
    buckets.set(b, (buckets.get(b) ?? 0) + l.weight);
  }
  let poolAbove: number | null = null;
  let poolBelow: number | null = null;
  let maxA = 0;
  let maxB = 0;
  for (const [b, w] of buckets) {
    if (b > 0 && w > maxA) {
      maxA = w;
      poolAbove = price * Math.exp(b * BUCKET);
    }
    if (b < 0 && w > maxB) {
      maxB = w;
      poolBelow = price * Math.exp(b * BUCKET);
    }
  }
  return { above, below, poolAbove, poolBelow };
}

function ema(values: number[], n: number): number[] {
  const k = 2 / (n + 1);
  const out: number[] = [];
  values.forEach((v, i) => out.push(i === 0 ? v : v * k + out[i - 1] * (1 - k)));
  return out;
}

/** Every sweep-and-reclaim, with the liquidity picture at that moment. Filters come later. */
export function mmEvents(candles: SwingCandle[], levels: LiveLevel[], flush: FlushSeries | null): MmEvent[] {
  const base = findLvSignals(candles, { flush, minRvol: 0, minFlushRatio: 0 });
  const trend = ema(candles.map((c) => c.close), 100);
  return base.map((s) => {
    const liq = liquidityAt(levels, s.time, s.entry);
    const long = s.side === "LONG";
    const target = long ? liq.above : liq.below;
    const same = long ? liq.below : liq.above;
    const i = s.index;
    const slope = i >= 10 ? trend[i] - trend[i - 10] : 0;
    return {
      index: i, time: s.time, side: s.side, entry: s.entry, stop: s.stop, risk: s.risk, rvol: s.rvol, flushRatio: s.flushRatio,
      above: liq.above, below: liq.below,
      imbalance: same > 0 ? target / same : target > 0 ? Infinity : null,
      pool: long ? liq.poolAbove : liq.poolBelow,
      withTrend: long ? slope > 0 : slope < 0,
    };
  });
}

export type MmFilter = { vol: boolean; flush: boolean; imbalance: boolean; trend: boolean };
export type MmTrade = { event: MmEvent; target: number; result: "OBJETIVO" | "STOP" | "TIEMPO" | "ABIERTA"; exitIndex: number | null; r: number | null };

export function passes(e: MmEvent, f: MmFilter): boolean {
  return (!f.vol || e.rvol >= 1.5) && (!f.flush || (e.flushRatio ?? 0) >= 1) && (!f.imbalance || (e.imbalance ?? 0) >= 1.5) && (!f.trend || e.withTrend);
}

/** The pool if it sits between 1R and 4R away; otherwise 2R. */
export function targetFor(e: MmEvent): number {
  const long = e.side === "LONG";
  if (e.pool !== null) {
    const r = (long ? e.pool - e.entry : e.entry - e.pool) / e.risk;
    if (r >= 1 && r <= 4) return e.pool;
  }
  return long ? e.entry + 2 * e.risk : e.entry - 2 * e.risk;
}

/** Trades the events like a robot: one position at a time, worst case first, fees on both sides. */
export function runMm(candles: SwingCandle[], events: MmEvent[], f: MmFilter, opts: { horizon?: number; feePct?: number; from?: number; to?: number } = {}): MmTrade[] {
  const horizon = opts.horizon ?? 48;
  const feePct = opts.feePct ?? 0.05;
  const from = opts.from ?? 0;
  const to = opts.to ?? candles.length;
  const out: MmTrade[] = [];
  let busyUntil = -1;
  for (const e of events) {
    if (e.index < from || e.index >= to || e.index <= busyUntil || !passes(e, f)) continue;
    const target = targetFor(e);
    const long = e.side === "LONG";
    const fee = ((feePct / 100) * 2 * e.entry) / e.risk;
    let trade: MmTrade = { event: e, target, result: "ABIERTA", exitIndex: null, r: null };
    for (let i = e.index + 1; i < candles.length && i <= e.index + horizon; i += 1) {
      const c = candles[i];
      if (long ? c.low <= e.stop : c.high >= e.stop) {
        trade = { event: e, target, result: "STOP", exitIndex: i, r: -1 - fee };
        break;
      }
      if (long ? c.high >= target : c.low <= target) {
        trade = { event: e, target, result: "OBJETIVO", exitIndex: i, r: Math.abs(target - e.entry) / e.risk - fee };
        break;
      }
      if (i === e.index + horizon) {
        trade = { event: e, target, result: "TIEMPO", exitIndex: i, r: (long ? c.close - e.entry : e.entry - c.close) / e.risk - fee };
      }
    }
    out.push(trade);
    busyUntil = trade.exitIndex ?? Infinity;
  }
  return out;
}

export type MmVariant = { filter: MmFilter; name: string; inSample: LvStats; outSample: LvStats; approved: boolean };
export type MmStudy = { split: number; variants: MmVariant[]; best: MmVariant | null };

export const filterName = (f: MmFilter) =>
  [f.vol && "volumen", f.flush && "liquidaciones", f.imbalance && "más liquidez en el objetivo", f.trend && "a favor de tendencia"].filter(Boolean).join(" + ") || "solo barrida";

/** Chooses on the first 60%, validates on the last 40%. */
export function studyMm(candles: SwingCandle[], events: MmEvent[], opts: { minIn?: number; minOut?: number } = {}): MmStudy {
  const split = Math.floor(candles.length * 0.6);
  const minIn = opts.minIn ?? 12;
  const minOut = opts.minOut ?? 6;
  const variants: MmVariant[] = [];
  for (let m = 0; m < 16; m += 1) {
    const filter = { vol: Boolean(m & 1), flush: Boolean(m & 2), imbalance: Boolean(m & 4), trend: Boolean(m & 8) };
    const inSample = lvStats(runMm(candles, events, filter, { to: split }));
    const outSample = lvStats(runMm(candles, events, filter, { from: split }));
    const approved =
      inSample.resolved >= minIn && (inSample.profitFactor ?? 0) >= 1.2 && outSample.resolved >= minOut && (outSample.profitFactor ?? 0) >= 1.1;
    variants.push({ filter, name: filterName(filter), inSample, outSample, approved });
  }
  variants.sort((a, b) => Number(b.approved) - Number(a.approved) || (b.approved ? (b.outSample.expectancyR ?? -9) - (a.outSample.expectancyR ?? -9) : (b.inSample.expectancyR ?? -9) - (a.inSample.expectancyR ?? -9)));
  return { split, variants, best: variants[0]?.approved ? variants[0] : null };
}

export type CoinStudyInput = { symbol: string; candles: SwingCandle[]; events: MmEvent[] };
export type CoinResult = { symbol: string; inSample: LvStats; outSample: LvStats };
export type PooledVariant = MmVariant & {
  perCoin: CoinResult[];
  /** Coins with at least 2 validation trades, and how many of them made money there. */
  breadth: { tested: number; positive: number };
};
export type PooledStudy = { coins: number; events: number; variants: PooledVariant[]; best: PooledVariant | null };

/**
 * The same study over several coins at once. Each coin is split on its own
 * (oldest 60% to choose, newest 40% to validate) and the trades of all coins
 * are pooled. On top of making money in both parts, a variant must make money
 * in the validation part on at least half of the coins that traded it: a
 * result carried by one lucky coin is not a robot.
 */
export function studyMmPooled(coins: CoinStudyInput[], opts: { minIn?: number; minOut?: number } = {}): PooledStudy {
  const minIn = opts.minIn ?? 40;
  const minOut = opts.minOut ?? 20;
  const variants: PooledVariant[] = [];
  for (let m = 0; m < 16; m += 1) {
    const filter = { vol: Boolean(m & 1), flush: Boolean(m & 2), imbalance: Boolean(m & 4), trend: Boolean(m & 8) };
    const allIn: MmTrade[] = [];
    const allOut: MmTrade[] = [];
    const perCoin: CoinResult[] = [];
    for (const c of coins) {
      const split = Math.floor(c.candles.length * 0.6);
      const tin = runMm(c.candles, c.events, filter, { to: split });
      const tout = runMm(c.candles, c.events, filter, { from: split });
      allIn.push(...tin);
      allOut.push(...tout);
      perCoin.push({ symbol: c.symbol, inSample: lvStats(tin), outSample: lvStats(tout) });
    }
    const inSample = lvStats(allIn);
    const outSample = lvStats(allOut);
    const tested = perCoin.filter((p) => p.outSample.resolved >= 2);
    const breadth = { tested: tested.length, positive: tested.filter((p) => p.outSample.totalR > 0).length };
    const approved =
      inSample.resolved >= minIn && (inSample.profitFactor ?? 0) >= 1.2 &&
      outSample.resolved >= minOut && (outSample.profitFactor ?? 0) >= 1.1 && (outSample.expectancyR ?? 0) > 0 &&
      breadth.tested > 0 && breadth.positive * 2 >= breadth.tested;
    variants.push({ filter, name: filterName(filter), inSample, outSample, approved, perCoin, breadth });
  }
  variants.sort((a, b) => Number(b.approved) - Number(a.approved) || (b.approved ? (b.outSample.expectancyR ?? -9) - (a.outSample.expectancyR ?? -9) : (b.inSample.expectancyR ?? -9) - (a.inSample.expectancyR ?? -9)));
  return { coins: coins.length, events: coins.reduce((s, c) => s + c.events.length, 0), variants, best: variants[0]?.approved ? variants[0] : null };
}
