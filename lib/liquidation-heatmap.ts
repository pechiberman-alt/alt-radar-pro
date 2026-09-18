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
 * actually shows is a MODEL: take where positions were likely opened, assume
 * a spread of leverage choices, and compute where each hypothetical position
 * would liquidate. This module does exactly that, and says so everywhere it
 * surfaces — in the API response, and on the panel itself, not just here.
 *
 * METHOD, v2
 *
 * 1. Activity profile: each candle contributes a weight spread across the
 *    price bins its [low, high] range touches, proportional to overlap.
 *    Where available, the weight is that candle's POSITIVE change in open
 *    interest (new contracts opened — the caller supplies this, since it
 *    requires a second, futures-only data source the engine itself does not
 *    fetch). Where OI data is not available for a candle — because it is
 *    older than Binance's ~30-day OI history retention, or the fetch simply
 *    failed — this falls back to that candle's traded volume, the same proxy
 *    v1 used everywhere. ΔOI is the better proxy because it excludes closes:
 *    volume counts a position opening and closing as two events that cancel
 *    out to zero net exposure, but still contributes weight twice.
 * 2. Leverage assumption: LEVERAGE_TIERS is a retail-skewed distribution
 *    across Binance's common tiers, calibrated per symbol against the only
 *    public disclosures that exist (Binance's own 2019 stats: over 80% of
 *    Binance Futures traders used ≥20x, and 20% used ≥100x). It is an
 *    ASSUMPTION about typical trader behaviour, not data about any real
 *    position, and it is exported so nothing about it hides inside the
 *    function that uses it.
 * 3. Maintenance margin: the isolated-margin liquidation formula needs a
 *    maintenance margin rate, which Binance schedules in tiers by position
 *    notional. This engine has no way to know any hypothetical position's
 *    notional, so it uses the Tier-1 rate — the one that covers the vast
 *    majority of retail position sizes — sourced from Binance's own public
 *    FAQ for BTCUSDT and ETHUSDT specifically. Other symbols keep the
 *    previous flat estimate, clearly labelled as such below.
 * 4. For every (price bin, weight) sample, and for every leverage tier, this
 *    computes the liquidation price for a long and a short opened at that
 *    bin, then adds that tier's weighted share into the density bucket the
 *    liquidation price falls into.
 * 5. Consumed zones: once price has actually traded through a level after
 *    that level's earliest contributing candle, the position behind it would
 *    already have been liquidated and closed — it cannot still be sitting
 *    there waiting. Those contributions are dropped before the final map is
 *    built, so a swept zone disappears instead of persisting forever.
 * 6. Buckets are normalised to a 0–100 intensity so the UI can colour them,
 *    and the top surviving clusters on each side of price are surfaced as
 *    the "magnet zones" a cascade would accelerate toward.
 */

/**
 * Binance USDT-M tiers a retail trader actually picks from, with an assumed
 * usage weight. This is the one place in the engine that is pure assumption
 * rather than derived from fetched data — change it here, not in the math.
 *
 * MAJOR_LEVERAGE_TIERS applies to BTC/ETH and is calibrated against Binance's
 * own disclosure ("Leverage and Derivatives: Overview of Binance Futures in
 * 2019"): over 80% of traders used 20x or higher, and 20% used 100x or more.
 * DEFAULT_LEVERAGE_TIERS (the original v1 distribution) is kept for every
 * other symbol, because no equivalent public breakdown exists for altcoins
 * and altcoin max leverage on Binance is typically lower anyway — shifting
 * their weights on no evidence would trade one guess for another.
 */
export const MAJOR_LEVERAGE_TIERS: { leverage: number; weight: number }[] = [
  { leverage: 5, weight: 0.03 },
  { leverage: 10, weight: 0.09 },
  { leverage: 20, weight: 0.21 },
  { leverage: 25, weight: 0.19 },
  { leverage: 50, weight: 0.18 },
  { leverage: 75, weight: 0.1 },
  { leverage: 100, weight: 0.2 },
];

export const DEFAULT_LEVERAGE_TIERS: { leverage: number; weight: number }[] = [
  { leverage: 5, weight: 0.1 },
  { leverage: 10, weight: 0.22 },
  { leverage: 20, weight: 0.28 },
  { leverage: 25, weight: 0.16 },
  { leverage: 50, weight: 0.14 },
  { leverage: 75, weight: 0.06 },
  { leverage: 100, weight: 0.04 },
];

const MAJOR_SYMBOLS = new Set(["BTCUSDT", "ETHUSDT"]);

export function leverageTiersFor(symbol: string) {
  return MAJOR_SYMBOLS.has(symbol) ? MAJOR_LEVERAGE_TIERS : DEFAULT_LEVERAGE_TIERS;
}

/**
 * Tier-1 maintenance margin rate, sourced from Binance's public futures FAQ
 * ("How to Calculate Liquidation Price of USDⓈ-M Futures Contracts") and
 * cross-checked against its worked examples. Tier 1 is the bracket that
 * covers the large majority of retail position sizes (0–50,000 USDT
 * notional on BTCUSDT at time of writing), so it stands in for "the real
 * rate" without requiring this engine to know any hypothetical position's
 * actual size — something it fundamentally cannot know from aggregate
 * activity data. Binance re-tiers these brackets periodically; treat this as
 * a well-sourced snapshot, not a live value.
 */
export const TIER1_MAINTENANCE_MARGIN_RATE: Record<string, number> = {
  BTCUSDT: 0.004,
  ETHUSDT: 0.0065,
};

/** Kept for every symbol without a confirmed Tier-1 rate above — the original
 *  v1 flat estimate, unchanged rather than replaced with an unverified guess. */
const DEFAULT_MAINTENANCE_MARGIN_RATE = 0.005;

export function maintenanceMarginRateFor(symbol: string): number {
  return TIER1_MAINTENANCE_MARGIN_RATE[symbol] ?? DEFAULT_MAINTENANCE_MARGIN_RATE;
}

const longLiquidationPrice = (entry: number, leverage: number, mmr: number) =>
  entry * (1 - 1 / leverage + mmr);

const shortLiquidationPrice = (entry: number, leverage: number, mmr: number) =>
  entry * (1 + 1 / leverage - mmr);

export type HeatBucket = {
  price: number;
  /** Weighted activity attributed to longs liquidating at this price (below entries). */
  longDensity: number;
  /** Weighted activity attributed to shorts liquidating at this price (above entries). */
  shortDensity: number;
  /** 0–100, normalised against the busiest surviving bucket in the whole map. */
  intensity: number;
  /** This bucket's share of total open interest in quote currency, when the
   *  caller supplied that total. Null when it did not — the panel then shows
   *  intensity alone rather than inventing a dollar figure. */
  notionalUsd: number | null;
  /**
   * Index of the earliest candle whose activity feeds this zone. A
   * liquidation level does not exist before the positions behind it were
   * opened, so the chart draws each zone starting here rather than as a bar
   * pinned to the right edge.
   */
  formedAt: number;
};

export type LiquidationHeatmap = {
  symbol: string;
  currentPrice: number;
  binSize: number;
  /** How many candles fed the activity profile, so `formedAt` can be read as
   *  a fraction of the lookback regardless of how many candles the chart draws. */
  profileCandles: number;
  /** Half-life in candles actually applied to older activity, or null when
   *  decay was disabled. */
  halfLifeCandles: number | null;
  /** Total open interest in quote currency used to scale buckets, if given. */
  totalOpenInterestUsd: number | null;
  /** How many of those candles were weighted by real open-interest change
   *  rather than the volume fallback — surfaced so the method note can say
   *  honestly how much of the map is the better proxy. */
  oiWeightedCandles: number;
  buckets: HeatBucket[];
  /** Densest surviving bucket above price — where a rally would find the most short-liquidation fuel. */
  topZoneAbove: HeatBucket | null;
  /** Densest surviving bucket below price — where a decline would find the most long-liquidation fuel. */
  topZoneBelow: HeatBucket | null;
  /** Reads the imbalance between the two sides as directional pressure. */
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

/**
 * Weight per price bin, plus the index of the earliest candle that
 * contributed there — the chart needs to know when a level came into
 * existence, not only how heavy it is.
 *
 * `weightFor` lets the caller substitute a better per-candle weight (positive
 * ΔOI) than the default (traded volume); when it returns null for a candle —
 * meaning no OI data was available for it — that candle's own volume is used
 * instead, so coverage gaps degrade to the old behaviour rather than to zero.
 */
export type ProfileBin = { weight: number; firstIndex: number };

export function buildVolumeProfile(
  candles: SwingCandle[],
  binSize: number,
  weightFor?: (candle: SwingCandle, index: number) => number | null,
): Map<number, ProfileBin> {
  const profile = new Map<number, ProfileBin>();
  candles.forEach((candle, candleIndex) => {
    const { low, high } = candle;
    const override = weightFor?.(candle, candleIndex) ?? null;
    const weight = override !== null && override >= 0 ? override : candle.volume;
    if (!(high > low) || !(weight > 0)) {
      // A doji, a zero-volume gap, or a candle whose OI actually contracted
      // (no new positions opened there) has nothing to spread across; skip it
      // rather than dump weight on one arbitrary bin.
      return;
    }
    const firstBin = Math.floor(low / binSize);
    const lastBin = Math.floor(high / binSize);
    const span = high - low;
    for (let bin = firstBin; bin <= lastBin; bin += 1) {
      const binLow = Math.max(low, bin * binSize);
      const binHigh = Math.min(high, (bin + 1) * binSize);
      const overlap = Math.max(0, binHigh - binLow);
      if (overlap <= 0) continue;
      const share = weight * (overlap / span);
      const existing = profile.get(bin);
      if (existing) {
        existing.weight += share;
        existing.firstIndex = Math.min(existing.firstIndex, candleIndex);
      } else {
        profile.set(bin, { weight: share, firstIndex: candleIndex });
      }
    }
  });
  return profile;
}

export type LiquidationHeatmapOptions = {
  priceRangePct?: number;
  /**
   * Per-candle positive change in open interest, aligned by index to
   * `candles`. A `null` entry means no OI data was available for that candle
   * (outside Binance's retention window, or the fetch failed) — that candle
   * falls back to its own volume. Omit entirely to use volume for every
   * candle, which is v1's exact behaviour.
   */
  oiDeltaByIndex?: (number | null)[];
  /**
   * How many candles it takes for a position's assumed survival to halve.
   *
   * Without this, every candle in the lookback counts as though its positions
   * were still open today, which is plainly false: leveraged perpetual
   * positions turn over fast (a published study of BitMEX found ~3.5% of
   * longs were force-liquidated *daily*), and funding costs penalise holding.
   * Vendors approximate the same effect by offering discrete lookback windows;
   * this is the continuous version, which degrades old activity smoothly
   * instead of cutting it off at an arbitrary edge.
   *
   * Omit to disable decay entirely (every candle weighted equally).
   */
  halfLifeCandles?: number;
  /**
   * Total open interest in quote currency (contracts × price), from
   * /fapi/v1/openInterest. When supplied, each bucket also reports its share
   * of that figure as `notionalUsd`, which turns an abstract 0–100 intensity
   * into "about this many dollars of positions sit here". The split is
   * proportional, so it inherits every assumption above — it is a scaled
   * estimate, not a measured amount.
   */
  totalOpenInterestUsd?: number;
};

export function buildLiquidationHeatmap(
  symbol: string,
  candles: SwingCandle[],
  currentPrice: number,
  options: LiquidationHeatmapOptions | number = {},
): LiquidationHeatmap | null {
  // Earlier callers pass a bare number for priceRangePct; keep that working.
  const opts: LiquidationHeatmapOptions =
    typeof options === "number" ? { priceRangePct: options } : options;
  const priceRangePct = opts.priceRangePct ?? 0.22;

  if (!candles.length || !(currentPrice > 0)) return null;

  const binSize = chooseBinSize(currentPrice);
  const oiDelta = opts.oiDeltaByIndex;
  const halfLife = opts.halfLifeCandles && opts.halfLifeCandles > 0 ? opts.halfLifeCandles : null;
  const lastIndex = candles.length - 1;
  // Older activity is discounted toward zero rather than counted in full:
  // those positions have had more time to be closed, stopped out, or
  // liquidated already.
  const survival = (index: number) =>
    halfLife === null ? 1 : 0.5 ** ((lastIndex - index) / halfLife);

  let oiWeightedCandles = 0;
  const activityProfile = buildVolumeProfile(candles, binSize, (candle, index) => {
    const delta = oiDelta?.[index];
    if (delta === undefined || delta === null) {
      // No OI datapoint: fall back to this candle's volume, but still decay it.
      return halfLife === null ? null : candle.volume * survival(index);
    }
    oiWeightedCandles += 1;
    return Math.max(0, delta) * survival(index);
  });
  if (activityProfile.size === 0) return null;

  // Suffix extremes of the actual traded range, so "was this price level
  // reached at any point after candle i" is an O(1) lookup instead of a scan.
  // This treats the price path between candle lows/highs as continuous,
  // which is the standard approximation for this check — real gaps between
  // consecutive candles on a liquid perpetual are rare enough not to matter
  // for a map that is already an estimate, not a measurement.
  const suffixMinLow = new Array<number>(candles.length + 1).fill(Infinity);
  const suffixMaxHigh = new Array<number>(candles.length + 1).fill(-Infinity);
  for (let i = candles.length - 1; i >= 0; i -= 1) {
    suffixMinLow[i] = Math.min(candles[i].low, suffixMinLow[i + 1]);
    suffixMaxHigh[i] = Math.max(candles[i].high, suffixMaxHigh[i + 1]);
  }
  const wasSweptAfter = (price: number, formedAtIndex: number) => {
    const from = formedAtIndex + 1;
    if (from >= candles.length) return false;
    return price >= suffixMinLow[from] && price <= suffixMaxHigh[from];
  };

  const lowBound = currentPrice * (1 - priceRangePct);
  const highBound = currentPrice * (1 + priceRangePct);
  const density = new Map<number, { long: number; short: number; formedAt: number }>();

  const addDensity = (price: number, long: number, short: number, formedAt: number) => {
    if (price < lowBound || price > highBound) return;
    // The position this contribution represents would already have been
    // liquidated and closed if price reached its liquidation level after it
    // opened — it cannot still be fuel waiting to go off.
    if (wasSweptAfter(price, formedAt)) return;
    const bin = Math.round(price / binSize);
    const existing = density.get(bin);
    if (existing) {
      existing.long += long;
      existing.short += short;
      existing.formedAt = Math.min(existing.formedAt, formedAt);
    } else {
      density.set(bin, { long, short, formedAt });
    }
  };

  const mmr = maintenanceMarginRateFor(symbol);
  const tiers = leverageTiersFor(symbol);
  for (const [entryBin, bin] of activityProfile) {
    const entryPrice = (entryBin + 0.5) * binSize;
    for (const tier of tiers) {
      const weighted = bin.weight * tier.weight;
      addDensity(longLiquidationPrice(entryPrice, tier.leverage, mmr), weighted, 0, bin.firstIndex);
      addDensity(shortLiquidationPrice(entryPrice, tier.leverage, mmr), 0, weighted, bin.firstIndex);
    }
  }

  if (density.size === 0) return null;

  const peak = Math.max(
    ...[...density.values()].map((entry) => entry.long + entry.short),
  );

  const totalDensity = [...density.values()].reduce(
    (sum, entry) => sum + entry.long + entry.short,
    0,
  );
  const openInterestUsd =
    opts.totalOpenInterestUsd && opts.totalOpenInterestUsd > 0
      ? opts.totalOpenInterestUsd
      : null;

  const buckets: HeatBucket[] = [...density.entries()]
    .map(([bin, entry]) => {
      const weight = entry.long + entry.short;
      return {
        price: bin * binSize,
        longDensity: entry.long,
        shortDensity: entry.short,
        intensity: peak > 0 ? (weight / peak) * 100 : 0,
        notionalUsd:
          openInterestUsd !== null && totalDensity > 0
            ? (weight / totalDensity) * openInterestUsd
            : null,
        formedAt: entry.formedAt,
      };
    })
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

  const tierLabel = MAJOR_SYMBOLS.has(symbol)
    ? "recalibrados con la distribución que Binance publicó de sus propios usuarios (2019)"
    : "distribución conservadora genérica — sin dato público específico para este símbolo";
  const oiCoverage =
    oiWeightedCandles > 0
      ? `${oiWeightedCandles} de ${candles.length} velas usan cambio real de open interest en vez de volumen`
      : "sin cobertura de open interest en esta ventana — usando volumen para todas las velas";
  const decayNote =
    halfLife === null
      ? "Sin decaimiento: toda la ventana pesa igual."
      : `La actividad se descuenta con el tiempo: cada ${halfLife} velas hacia atrás vale la mitad, porque esas posiciones tuvieron más tiempo de cerrarse.`;
  const scaleNote =
    openInterestUsd !== null
      ? ` Los montos en dólares son el reparto proporcional del open interest total actual (${(openInterestUsd / 1e9).toFixed(2)}B USD), no posiciones medidas una por una.`
      : "";

  return {
    symbol,
    currentPrice,
    binSize,
    profileCandles: candles.length,
    halfLifeCandles: halfLife,
    totalOpenInterestUsd: openInterestUsd,
    oiWeightedCandles,
    buckets,
    topZoneAbove,
    topZoneBelow,
    bias,
    biasNote,
    method:
      `Actividad por nivel de precio (${oiCoverage}) proyectada a través de una distribución asumida de apalancamientos, no liquidaciones confirmadas. Los niveles ya atravesados por el precio se descartan: esa posición ya se habría liquidado y cerrado. ${decayNote}${scaleNote}`,
    assumptions: `Apalancamientos considerados: ${tiers.map((t) => `${t.leverage}x`).join(", ")} (${tierLabel}). Margen de mantenimiento: ${(mmr * 100).toFixed(2)}% ${TIER1_MAINTENANCE_MARGIN_RATE[symbol] ? "(tasa real de Binance, tramo 1)" : "(estimado, sin tabla oficial confirmada para este símbolo)"}.`,
  };
}
