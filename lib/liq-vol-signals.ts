import { findPivots, type SwingCandle } from "./swing-entries.ts";

/**
 * LIQ+VOL: a liquidity sweep confirmed by volume and by a liquidation flush.
 *
 * THE SETUP (LONG; SHORT is the mirror image)
 *   1. Liquidity: the candle trades below a confirmed swing low — where stops
 *      rest — and CLOSES back above it. The stops were taken; the level held.
 *   2. Volume: that candle traded at least 1,5× the average of the 20 before.
 *   3. Liquidations: the wick flushed at least an average amount of estimated
 *      long liquidations (from the app's liquidation model) compared with the
 *      50 candles before. Skipped when the model isn't available.
 *   Entry at the close; stop beyond the wick (plus a tenth of an ATR); target
 *   at 2R. A trade still open after 24 candles is closed at that candle's close.
 *
 * NO LOOKAHEAD
 * A swing point is only usable once its confirming candles have printed, and
 * every filter uses candles up to the signal candle. Adding later candles
 * never changes an earlier signal (tested).
 *
 * MEASUREMENT, NOT A PROMISE
 * Every signal is resolved with the candles that followed it, worst case first
 * (a candle that touches stop and target counts as stop), net of fees on both
 * sides. Win rate, profit factor and expectancy come with their sample size.
 */

export type LvSide = "LONG" | "SHORT";
export type LvSignal = {
  index: number;
  time: number;
  side: LvSide;
  entry: number;
  stop: number;
  target: number;
  risk: number;
  /** The swing level that was swept. */
  level: number;
  /** Volume of the sweep candle over the average of the 20 before. */
  rvol: number;
  /** Liquidations flushed by the wick over the average of the 50 candles before; null without the model. */
  flushRatio: number | null;
};

export type LvOptions = { span?: number; maxWait?: number; minRvol?: number; minFlushRatio?: number; rr?: number };
export type FlushSeries = { long: number[]; short: number[] };

function atrAt(c: SwingCandle[], i: number, n = 14): number | null {
  if (i < n) return null;
  let sum = 0;
  for (let k = i - n + 1; k <= i; k += 1) {
    sum += Math.max(c[k].high - c[k].low, Math.abs(c[k].high - c[k - 1].close), Math.abs(c[k].low - c[k - 1].close));
  }
  return sum / n;
}

/** Value at i over the average of up to `window` values before it; needs at least `min` of history. */
function ratioToRecent(values: number[], i: number, window: number, min = window): number | null {
  const w = Math.min(window, i);
  if (w < min) return null;
  let sum = 0;
  for (let k = i - w; k < i; k += 1) sum += values[k] ?? 0;
  const mean = sum / w;
  return mean > 0 ? (values[i] ?? 0) / mean : null;
}

export function findLvSignals(candles: SwingCandle[], options: LvOptions & { flush?: FlushSeries | null } = {}): LvSignal[] {
  const span = options.span ?? 3;
  const maxWait = options.maxWait ?? 80;
  const minRvol = options.minRvol ?? 1.5;
  const minFlush = options.minFlushRatio ?? 1;
  const rr = options.rr ?? 2;
  const n = candles.length;
  if (n < 30) return [];
  const { highs, lows } = findPivots(candles, span);
  // The sweep candle for each pivot: first candle (after confirmation) that trades beyond it.
  const sweptAt = new Map<number, { side: LvSide; level: number }>();
  const scan = (pivots: { index: number; price: number }[], low: boolean) => {
    for (const p of pivots) {
      for (let j = p.index + span + 1; j < Math.min(n, p.index + maxWait + 1); j += 1) {
        const c = candles[j];
        if (!(low ? c.low < p.price : c.high > p.price)) continue;
        if (low ? c.close > p.price : c.close < p.price) {
          const side: LvSide = low ? "LONG" : "SHORT";
          const prev = sweptAt.get(j * 2 + (low ? 0 : 1));
          // Several pivots taken by one candle: keep the one nearest the wick.
          if (!prev || (low ? p.price < prev.level : p.price > prev.level)) sweptAt.set(j * 2 + (low ? 0 : 1), { side, level: p.price });
        }
        break; // first touch decides: sweep or breakout
      }
    }
  };
  scan(lows, true);
  scan(highs, false);

  const volumes = candles.map((c) => c.volume);
  const out: LvSignal[] = [];
  for (const [key, s] of [...sweptAt.entries()].sort((a, b) => a[0] - b[0])) {
    const j = Math.floor(key / 2);
    const c = candles[j];
    const rvol = ratioToRecent(volumes, j, 20);
    if (rvol === null || rvol < minRvol) continue;
    // Up to 50 candles of history for the liquidation baseline, at least 20.
    const flushRatio = options.flush ? ratioToRecent(s.side === "LONG" ? options.flush.long : options.flush.short, j, 50, 20) : null;
    if (options.flush && (flushRatio === null || flushRatio < minFlush)) continue;
    const atr = atrAt(candles, j);
    if (!atr) continue;
    const entry = c.close;
    const stop = s.side === "LONG" ? c.low - 0.1 * atr : c.high + 0.1 * atr;
    const risk = Math.abs(entry - stop);
    if (risk < 0.25 * atr || risk > 3 * atr) continue;
    out.push({
      index: j, time: c.openTime, side: s.side, entry, stop, risk, level: s.level, rvol, flushRatio,
      target: s.side === "LONG" ? entry + rr * risk : entry - rr * risk,
    });
  }
  return out;
}

export type LvResult = "OBJETIVO" | "STOP" | "TIEMPO" | "ABIERTA";
export type LvTrade = { signal: LvSignal; result: LvResult; exitIndex: number | null; exitPrice: number | null; r: number | null };

/** Resolves each signal with the candles after it; worst case first; fees as a fraction of R. */
export function resolveLv(candles: SwingCandle[], signals: LvSignal[], horizon = 24, feePct = 0.05): LvTrade[] {
  return signals.map((s) => {
    const fee = ((feePct / 100) * 2 * s.entry) / s.risk;
    const long = s.side === "LONG";
    for (let i = s.index + 1; i < candles.length && i <= s.index + horizon; i += 1) {
      const c = candles[i];
      if (long ? c.low <= s.stop : c.high >= s.stop) return { signal: s, result: "STOP", exitIndex: i, exitPrice: s.stop, r: -1 - fee };
      if (long ? c.high >= s.target : c.low <= s.target) {
        return { signal: s, result: "OBJETIVO", exitIndex: i, exitPrice: s.target, r: Math.abs(s.target - s.entry) / s.risk - fee };
      }
      if (i === s.index + horizon) {
        const r = ((long ? c.close - s.entry : s.entry - c.close) / s.risk) - fee;
        return { signal: s, result: "TIEMPO", exitIndex: i, exitPrice: c.close, r };
      }
    }
    return { signal: s, result: "ABIERTA", exitIndex: null, exitPrice: null, r: null };
  });
}

export type LvStats = {
  resolved: number;
  open: number;
  wins: number;
  losses: number;
  winRate: number | null;
  profitFactor: number | null;
  expectancyR: number | null;
  totalR: number;
  confidence: "SIN MUESTRA" | "MUESTRA MÍNIMA" | "MUESTRA RAZONABLE";
};

export function lvStats(trades: { r: number | null }[]): LvStats {
  const done = trades.filter((t) => t.r !== null);
  const gains = done.filter((t) => (t.r as number) > 0).reduce((s, t) => s + (t.r as number), 0);
  const losses = done.filter((t) => (t.r as number) < 0).reduce((s, t) => s - (t.r as number), 0);
  const total = done.reduce((s, t) => s + (t.r as number), 0);
  return {
    resolved: done.length,
    open: trades.length - done.length,
    wins: done.filter((t) => (t.r as number) > 0).length,
    losses: done.filter((t) => (t.r as number) < 0).length,
    winRate: done.length ? done.filter((t) => (t.r as number) > 0).length / done.length : null,
    profitFactor: losses > 0 ? gains / losses : gains > 0 ? Infinity : null,
    expectancyR: done.length ? total / done.length : null,
    totalR: total,
    confidence: done.length === 0 ? "SIN MUESTRA" : done.length < 15 ? "MUESTRA MÍNIMA" : "MUESTRA RAZONABLE",
  };
}

/** Estimated liquidations swept by each candle, by side, aligned to the candles' open times. */
export function flushSeries(times: number[], lives: { side: "long" | "short"; weight: number; sweptTime: number | null }[]): FlushSeries {
  const at = new Map(times.map((t, i) => [t, i] as const));
  const long = new Array<number>(times.length).fill(0);
  const short = new Array<number>(times.length).fill(0);
  for (const l of lives) {
    if (l.sweptTime === null) continue;
    const i = at.get(l.sweptTime);
    if (i === undefined) continue;
    if (l.side === "long") long[i] += l.weight;
    else short[i] += l.weight;
  }
  return { long, short };
}
