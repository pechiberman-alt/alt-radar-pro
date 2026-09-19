import { FIB_LEVELS } from "./fib-backtest.ts";
import { findPivots, type SwingCandle } from "./swing-entries.ts";

/**
 * Whether price is sitting in the Fibonacci retracement band right now.
 *
 * The backtest module answers "did 0.618 work better than 0.786 historically".
 * This answers a different and more immediate question: is price inside that
 * band on this chart, at this moment. They share FIB_LEVELS deliberately —
 * measuring one band and displaying another would make the backtest's verdict
 * inapplicable to what the panel shows.
 *
 * THE LEG IS CHOSEN, NOT ASSUMED
 *
 * A retracement is only meaningful against a specific swing leg, and picking
 * the wrong leg makes every level wrong. The leg here is the most recent
 * confirmed pivot pair, taken in chronological order — the same rule the
 * backtest uses, including its three-candle confirmation, so a level is never
 * drawn from a pivot the market had not yet confirmed when price arrived.
 */

/** Confirmation span used by findPivots; a pivot needs this many candles
 *  after it before it is a pivot at all. */
const PIVOT_SPAN = 3;

export type FibZoneState = {
  side: "LONG" | "SHORT";
  /** Origin and extreme of the leg being retraced. */
  legLow: number;
  legHigh: number;
  /** Price levels for each ratio, keyed by the ratio itself. */
  levels: { ratio: number; price: number }[];
  /** Band between the shallowest and deepest configured ratio. */
  zoneLow: number;
  zoneHigh: number;
  currentPrice: number;
  /** How deep into the leg price has retraced, 0 = extreme, 1 = origin. */
  retracement: number;
  inZone: boolean;
  /** Nearest configured ratio to current price. */
  nearest: { ratio: number; price: number; distancePct: number } | null;
  note: string;
};

export function readFibZone(candles: SwingCandle[]): FibZoneState | null {
  // The in-flight candle is excluded so the reading does not shift as it forms.
  const closed = candles.slice(0, -1);
  if (closed.length < 40) return null;

  const { highs, lows } = findPivots(closed, PIVOT_SPAN);
  const lastHigh = highs.at(-1);
  const lastLow = lows.at(-1);
  if (!lastHigh || !lastLow) return null;

  // Chronological order decides direction: the later pivot is the extreme the
  // leg travelled to, the earlier one is where it started.
  const upLeg = lastLow.index < lastHigh.index;
  const legLow = Math.min(lastLow.price, lastHigh.price);
  const legHigh = Math.max(lastLow.price, lastHigh.price);
  const legSize = legHigh - legLow;
  if (!(legSize > 0)) return null;

  const currentPrice = closed[closed.length - 1].close;

  // A retracement of an up leg is measured down from the high; of a down leg,
  // up from the low.
  const levels = FIB_LEVELS.map((ratio) => ({
    ratio,
    price: upLeg ? legHigh - legSize * ratio : legLow + legSize * ratio,
  })).sort((a, b) => a.price - b.price);

  const zoneLow = levels[0].price;
  const zoneHigh = levels[levels.length - 1].price;
  const inZone = currentPrice >= zoneLow && currentPrice <= zoneHigh;

  const retracement = upLeg
    ? (legHigh - currentPrice) / legSize
    : (currentPrice - legLow) / legSize;

  const nearest = levels
    .map((level) => ({
      ...level,
      distancePct: Math.abs((currentPrice - level.price) / currentPrice) * 100,
    }))
    .sort((a, b) => a.distancePct - b.distancePct)[0] ?? null;

  const side: "LONG" | "SHORT" = upLeg ? "LONG" : "SHORT";

  let note: string;
  if (inZone) {
    note = upLeg
      ? `El precio está dentro de la banda de retroceso del tramo alcista: zona donde se buscan entradas de compra. Retroceso actual ${(retracement * 100).toFixed(1)}% del tramo.`
      : `El precio está dentro de la banda de retroceso del tramo bajista: zona donde se buscan entradas de venta. Retroceso actual ${(retracement * 100).toFixed(1)}% del tramo.`;
  } else if (retracement < FIB_LEVELS[0]) {
    note = `El precio todavía no llegó a la banda; lleva ${(retracement * 100).toFixed(1)}% de retroceso y la zona empieza en ${(FIB_LEVELS[0] * 100).toFixed(1)}%.`;
  } else {
    note = `El precio pasó de largo la banda: retrocedió ${(retracement * 100).toFixed(1)}% del tramo, más allá de ${(FIB_LEVELS[FIB_LEVELS.length - 1] * 100).toFixed(1)}%. Un retroceso tan profundo pone en duda que el tramo siga vigente.`;
  }

  return {
    side,
    legLow,
    legHigh,
    levels,
    zoneLow,
    zoneHigh,
    currentPrice,
    retracement,
    inZone,
    nearest,
    note,
  };
}
