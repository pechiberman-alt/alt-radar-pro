import type { SwingCandle } from "./swing-entries";

/**
 * An estimated liquidation heatmap: where leveraged positions would be forced
 * closed if price reached each level.
 *
 * WHAT THIS IS, IN ONE SENTENCE
 *
 * No exchange publishes every trader's entry price and leverage, so nobody —
 * not this engine, not a paid terminal charging $50/month for the same kind
 * of chart — can show you real liquidation clusters. What every such chart
 * actually shows is a MODEL: take where volume traded (a proxy for where
 * positions were opened), assume a spread of leverage choices, and compute
 * where each hypothetical position would liquidate. This module does exactly
 * that, and says so everywhere it surfaces — in the API response, and on the
 * panel itself, not just in this comment.
 *
 * METHOD
 *
 * 1. Volume profile: each candle's volume is spread evenly across the price
 *    bins its [low, high] range touches, weighted by the fraction of that
 *    range each bin covers. More volume at a price is read as more positions
 *    likely opened there — a standard, defensible proxy, not a measurement.
 * 2. Leverage assumption: LEVERAGE_TIERS below is a retail-skewed distribution
 *    across Binance's common tiers. It is an ASSUMPTION about typical trader
 *    behaviour, not data about any real position, and it is exported so nothing
 *    about it hides inside the function that uses it.
 * 3. For every (price bin, volume) sample, and for every leverage tier, this
 *    computes the isolated-margin liquidation price for a long and a short
 *    opened at that bin, then adds that tier's weighted volume into the
 *    density bucket the liquidation price falls into.
 * 4. Buckets are normalised to a 0–100 intensity so the UI can colour them,
 *    and the top clusters on each side of price are surfaced as the
 *    "magnet zones" a cascade would accelerate toward.
 */

/** Binance USDT-M tiers a retail trader actually picks from, with an assumed
 *  usage weight. This is the one place in the engine that is pure assumption
 *  rather than derived from fetched data — change it here, not in the math. */
export const LEVERAGE_TIERS: { leverage: number; weight: number }[] = [
  { leverage: 5, weight: 0.1 },
  { leverage: 10, weight: 0.22 },
  { leverage: 20, weight: 0.28 },
  { leverage: 25, weight: 0.16 },
  { leverage: 50, weight: 0.14 },
  { leverage: 75, weight: 0.06 },
  { leverage: 100, weight: 0.04 },
];

/** Approximate maintenance margin rate at typical retail notional for a major
 *  pair (Binance's real schedule is tiered by position size; this is a single
 *  representative value, not the live schedule). */
const MAINTENANCE_MARGIN_RATE = 0.005;

const longLiquidationPrice = (entry: number, leverage: number) =>
  entry * (1 - 1 / leverage + MAINTENANCE_MARGIN_RATE);

const shortLiquidationPrice = (entry: number, leverage: number) =>
  entry * (1 + 1 / leverage - MAINTENANCE_MARGIN_RATE);

export type HeatBucket = {
  price: number;
  /** Weighted volume attributed to longs liquidating at this price (below entries). */
  longDensity: number;
  /** Weighted volume attributed to shorts liquidating at this price (above entries). */
  shortDensity: number;
  /** 0–100, normalised against the busiest bucket in the whole map. */
  intensity: number;
};

export type LiquidationHeatmap = {
  symbol: string;
  currentPrice: number;
  binSize: number;
  buckets: HeatBucket[];
  /** Densest bucket above price — where a rally would find the most short-liquidation fuel. */
  topZoneAbove: HeatBucket | null;
  /** Densest bucket below price — where a decline would find the most long-liquidation fuel. */
  topZoneBelow: HeatBucket | null;
  /** Reads the imbalance between the two nearest zones as directional pressure. */
  bias: "EMPUJE FUERTE AL ALZA" | "EMPUJE FUERTE A LA BAJA" | "SIN SESGO CLARO";
  biasNote: string;
  method: string;
  assumptions: string;
};

/** Bin width as a fraction of price — finer near typical BTC/ETH tick spacing
 *  than it needs to be for alts, but stable and simple across symbols. */
function chooseBinSize(price: number): number {
  const raw = price * 0.001;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  return Math.max(magnitude, 1e-8);
}

export function buildVolumeProfile(
  candles: SwingCandle[],
  binSize: number,
): Map<number, number> {
  const profile = new Map<number, number>();
  for (const candle of candles) {
    const { low, high, volume } = candle;
    if (!(high > low) || !(volume > 0)) {
      // A doji or a zero-volume gap has nowhere meaningful to spread across;
      // skip it rather than dump its volume on one arbitrary bin.
      continue;
    }
    const firstBin = Math.floor(low / binSize);
    const lastBin = Math.floor(high / binSize);
    const span = high - low;
    for (let bin = firstBin; bin <= lastBin; bin += 1) {
      const binLow = Math.max(low, bin * binSize);
      const binHigh = Math.min(high, (bin + 1) * binSize);
      const overlap = Math.max(0, binHigh - binLow);
      if (overlap <= 0) continue;
      const share = volume * (overlap / span);
      profile.set(bin, (profile.get(bin) ?? 0) + share);
    }
  }
  return profile;
}

export function buildLiquidationHeatmap(
  symbol: string,
  candles: SwingCandle[],
  currentPrice: number,
  priceRangePct = 0.22,
): LiquidationHeatmap | null {
  if (!candles.length || !(currentPrice > 0)) return null;

  const binSize = chooseBinSize(currentPrice);
  const volumeProfile = buildVolumeProfile(candles, binSize);
  if (volumeProfile.size === 0) return null;

  const lowBound = currentPrice * (1 - priceRangePct);
  const highBound = currentPrice * (1 + priceRangePct);
  const density = new Map<number, { long: number; short: number }>();

  const addDensity = (price: number, long: number, short: number) => {
    if (price < lowBound || price > highBound) return;
    const bin = Math.round(price / binSize);
    const existing = density.get(bin) ?? { long: 0, short: 0 };
    existing.long += long;
    existing.short += short;
    density.set(bin, existing);
  };

  for (const [entryBin, volume] of volumeProfile) {
    const entryPrice = (entryBin + 0.5) * binSize;
    for (const tier of LEVERAGE_TIERS) {
      const weighted = volume * tier.weight;
      addDensity(longLiquidationPrice(entryPrice, tier.leverage), weighted, 0);
      addDensity(shortLiquidationPrice(entryPrice, tier.leverage), 0, weighted);
    }
  }

  if (density.size === 0) return null;

  const peak = Math.max(
    ...[...density.values()].map((entry) => entry.long + entry.short),
  );

  const buckets: HeatBucket[] = [...density.entries()]
    .map(([bin, entry]) => ({
      price: bin * binSize,
      longDensity: entry.long,
      shortDensity: entry.short,
      intensity: peak > 0 ? ((entry.long + entry.short) / peak) * 100 : 0,
    }))
    .sort((a, b) => a.price - b.price);

  const above = buckets.filter((bucket) => bucket.price > currentPrice);
  const below = buckets.filter((bucket) => bucket.price < currentPrice);
  const topZoneAbove = above.reduce<HeatBucket | null>(
    (best, bucket) => (!best || bucket.shortDensity > best.shortDensity ? bucket : best),
    null,
  );
  const topZoneBelow = below.reduce<HeatBucket | null>(
    (best, bucket) => (!best || bucket.longDensity > best.longDensity ? bucket : best),
    null,
  );

  // A short liquidation is a forced buy; a long liquidation is a forced sell.
  // Whichever side carries more total liquidation fuel is the direction a
  // cascade would tend to accelerate toward if triggered — not a prediction
  // that it will be triggered. This sums every bucket on each side rather
  // than comparing just the single densest one: at low leverage, a position
  // opened on one side of price can still liquidate on the other side, so a
  // single peak bucket understates how much fuel a side actually holds.
  const aboveFuel = above.reduce((sum, bucket) => sum + bucket.shortDensity, 0);
  const belowFuel = below.reduce((sum, bucket) => sum + bucket.longDensity, 0);
  const total = aboveFuel + belowFuel;
  let bias: LiquidationHeatmap["bias"] = "SIN SESGO CLARO";
  let biasNote =
    "El combustible de liquidación está repartido parejo entre ambos lados. Ninguna dirección tiene una ventaja clara de aceleración.";
  if (total > 0) {
    const imbalance = (aboveFuel - belowFuel) / total;
    if (imbalance > 0.2) {
      bias = "EMPUJE FUERTE AL ALZA";
      biasNote =
        "Hay más liquidez de shorts acumulada arriba que de longs abajo: si el precio sube y los toca, esas liquidaciones son compras forzadas que pueden acelerar el movimiento.";
    } else if (imbalance < -0.2) {
      bias = "EMPUJE FUERTE A LA BAJA";
      biasNote =
        "Hay más liquidez de longs acumulada abajo que de shorts arriba: si el precio baja y los toca, esas liquidaciones son ventas forzadas que pueden acelerar el movimiento.";
    }
  }

  return {
    symbol,
    currentPrice,
    binSize,
    buckets,
    topZoneAbove,
    topZoneBelow,
    bias,
    biasNote,
    method:
      "Perfil de volumen (dónde se operó, como proxy de dónde se abrieron posiciones) proyectado a través de una distribución asumida de apalancamientos, no liquidaciones confirmadas.",
    assumptions: `Apalancamientos considerados: ${LEVERAGE_TIERS.map((t) => `${t.leverage}x`).join(", ")}, con más peso en los tramos que más usa el trader minorista. Margen de mantenimiento aproximado: ${(MAINTENANCE_MARGIN_RATE * 100).toFixed(1)}%.`,
  };
}
