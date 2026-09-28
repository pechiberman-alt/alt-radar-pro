import { ema, rsi } from "./oscillators.ts";
import type { SwingCandle } from "./swing-entries.ts";

/**
 * Scalping signals for the chart, on any timeframe.
 *
 * This is not the scanner in scalping-engine.ts. That one answers "what is
 * the setup on this symbol right now" from a fixed 5m/15m pair. The chart
 * needs the opposite: a signal *per candle*, on whatever frame is selected,
 * that can be replayed over history and measured — so every rule here uses
 * only data up to and including the signal candle (EMA, RSI and ATR are all
 * causal; the test suite proves no signal moves when later candles are added).
 *
 * THE SETUP
 *
 * A pullback to the 20 EMA in the direction of the trend, taken on the
 * candle that rejects it:
 *
 *   COMPRA: EMA20 above EMA50 and rising, price above EMA50; the candle (or
 *           the one before) dipped into the EMA20 zone and this one closed
 *           back above it, as a real bullish body; RSI not stretched; not
 *           already far from the average.
 *   VENTA:  the mirror image.
 *
 * Entry is the signal candle's close. The stop sits beyond the pullback
 * extreme; the target is `rr` times that risk away. A setup whose stop would
 * be too tight (noise) or too wide (not a scalp) is skipped.
 *
 * None of that is a claim that it works — `scalpStats` measures it on the
 * same series it is drawn on, and reports the win rate next to the rate a
 * coin flip would need to break even at that reward:risk.
 */

export type ScalpSignal = {
  /** Index in the series passed in. */
  index: number;
  time: number;
  side: "COMPRA" | "VENTA";
  entry: number;
  stop: number;
  target: number;
  rr: number;
  atr: number;
  reason: string;
};

export type ScalpOptions = {
  /** Reward-to-risk of the target. */
  rr?: number;
  /** Candles a signal is given to reach its target or its stop. */
  horizon?: number;
  /** Candles before another signal of the same side may fire. */
  cooldown?: number;
};

const DEFAULT_RR = 1.5;
const DEFAULT_HORIZON = 10;
const DEFAULT_COOLDOWN = 4;
const WARMUP = 55; // EMA50 plus a little settling
const ATR_PERIOD = 14;

function atrSeries(candles: SwingCandle[], period = ATR_PERIOD): (number | null)[] {
  const out: (number | null)[] = candles.map(() => null);
  if (candles.length <= period) return out;
  const tr = (i: number) =>
    i === 0
      ? candles[0].high - candles[0].low
      : Math.max(
          candles[i].high - candles[i].low,
          Math.abs(candles[i].high - candles[i - 1].close),
          Math.abs(candles[i].low - candles[i - 1].close),
        );
  let atr = 0;
  for (let i = 1; i <= period; i += 1) atr += tr(i);
  atr /= period;
  out[period] = atr;
  for (let i = period + 1; i < candles.length; i += 1) {
    atr = (atr * (period - 1) + tr(i)) / period;
    out[i] = atr;
  }
  return out;
}

export function findScalpSignals(candles: SwingCandle[], options: ScalpOptions = {}): ScalpSignal[] {
  const rr = options.rr ?? DEFAULT_RR;
  const cooldown = options.cooldown ?? DEFAULT_COOLDOWN;
  if (candles.length <= WARMUP + 1) return [];

  const closes = candles.map((c) => c.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const atr = atrSeries(candles);

  const found: ScalpSignal[] = [];
  const lastFired: Record<"COMPRA" | "VENTA", number> = { COMPRA: -Infinity, VENTA: -Infinity };

  for (let i = WARMUP; i < candles.length; i += 1) {
    const c = candles[i];
    const prev = candles[i - 1];
    const e20 = ema20[i];
    const e50 = ema50[i];
    const e20Back = ema20[i - 3];
    const r = rsi14[i];
    const a = atr[i];
    if (e20 === null || e50 === null || e20Back === null || r === null || a === null || !(a > 0)) continue;

    const range = c.high - c.low;
    const body = Math.abs(c.close - c.open);
    if (!(range > 0) || body < range * 0.35) continue; // a real body, not a doji
    if (Math.abs(e20 - e50) < a * 0.25) continue; // averages too close: no trend to trade

    let side: "COMPRA" | "VENTA" | null = null;
    let stop = 0;

    if (
      e20 > e50 && c.close > e50 && e20 > e20Back &&
      Math.min(c.low, prev.low) <= e20 + a * 0.1 && // dipped into the EMA20 zone
      c.close > e20 && c.close > c.open &&
      r >= 42 && r <= 68 &&
      c.close - e20 <= a * 1.2
    ) {
      side = "COMPRA";
      stop = Math.min(c.low, prev.low) - a * 0.2;
    } else if (
      e20 < e50 && c.close < e50 && e20 < e20Back &&
      Math.max(c.high, prev.high) >= e20 - a * 0.1 &&
      c.close < e20 && c.close < c.open &&
      r >= 32 && r <= 58 &&
      e20 - c.close <= a * 1.2
    ) {
      side = "VENTA";
      stop = Math.max(c.high, prev.high) + a * 0.2;
    }
    if (!side) continue;

    const risk = Math.abs(c.close - stop);
    if (risk < a * 0.5 || risk > a * 2.2) continue; // noise-tight or too wide for a scalp
    if (i - lastFired[side] <= cooldown) continue;
    lastFired[side] = i;

    found.push({
      index: i,
      time: c.openTime,
      side,
      entry: c.close,
      stop,
      target: side === "COMPRA" ? c.close + risk * rr : c.close - risk * rr,
      rr,
      atr: a,
      reason:
        side === "COMPRA"
          ? "Rebote en la EMA20 a favor de la tendencia alcista"
          : "Rechazo en la EMA20 a favor de la tendencia bajista",
    });
  }
  return found;
}

export type ScalpStats = {
  signals: number;
  /** Reached the target or the stop within the horizon. */
  resolved: number;
  wins: number;
  losses: number;
  /** Did neither within the horizon. Not counted in the rate. */
  timeouts: number;
  /** Too recent to have had the full horizon yet. Not counted. */
  pending: number;
  winRate: number | null;
  /** Average result per resolved trade, in units of the risk taken. */
  expectancyR: number | null;
  /** Gross profit over gross loss: every win pays `rr`, every loss costs 1.
   *  1 is break-even; above 1 is a profit before fees. Infinity when nothing
   *  has lost yet, null when nothing has resolved. */
  profitFactor: number | null;
  /** The win rate at which this reward:risk exactly breaks even (before
   *  fees). A win rate near this is no edge at all. */
  breakevenRate: number;
  rr: number;
  confidence: "SIN MUESTRA" | "MUESTRA MÍNIMA" | "MUESTRA RAZONABLE";
};

/**
 * How the signals actually did on this series.
 *
 * Replays each signal forward candle by candle. If a single candle spans both
 * the stop and the target the stop is assumed to have come first — the honest
 * direction to be wrong in when the candle doesn't say which happened first.
 * No fees or slippage; the entry is the signal candle's close.
 *
 * The confidence label is stricter than the one on zone stats (15 resolved
 * signals, not 8) because this reports an expectancy, and a rate measured on a
 * handful of trades moves by tens of points from luck alone.
 */
export function scalpStats(
  candles: SwingCandle[],
  signals: ScalpSignal[],
  options: ScalpOptions = {},
): ScalpStats {
  const horizon = options.horizon ?? DEFAULT_HORIZON;
  const rr = signals[0]?.rr ?? options.rr ?? DEFAULT_RR;
  const last = candles.length - 1;
  let wins = 0;
  let losses = 0;
  let timeouts = 0;
  let pending = 0;

  for (const s of signals) {
    let outcome: "win" | "loss" | null = null;
    const end = Math.min(s.index + horizon, last);
    for (let j = s.index + 1; j <= end; j += 1) {
      const c = candles[j];
      const hitStop = s.side === "COMPRA" ? c.low <= s.stop : c.high >= s.stop;
      const hitTarget = s.side === "COMPRA" ? c.high >= s.target : c.low <= s.target;
      if (hitStop) {
        outcome = "loss"; // includes the both-in-one-candle case
        break;
      }
      if (hitTarget) {
        outcome = "win";
        break;
      }
    }
    if (outcome === "win") wins += 1;
    else if (outcome === "loss") losses += 1;
    else if (s.index + horizon > last) pending += 1;
    else timeouts += 1;
  }

  const resolved = wins + losses;
  return {
    signals: signals.length,
    resolved,
    wins,
    losses,
    timeouts,
    pending,
    winRate: resolved > 0 ? wins / resolved : null,
    expectancyR: resolved > 0 ? (wins * rr - losses) / resolved : null,
    profitFactor: losses > 0 ? (wins * rr) / losses : wins > 0 ? Infinity : null,
    breakevenRate: 1 / (1 + rr),
    rr,
    confidence: resolved === 0 ? "SIN MUESTRA" : resolved < 15 ? "MUESTRA MÍNIMA" : "MUESTRA RAZONABLE",
  };
}
