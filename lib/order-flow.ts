/**
 * Pure order-flow analysis, extracted from the bookmap component so it can be
 * exercised without mounting a WebSocket-driven canvas. Everything here is a
 * function of the executions handed to it.
 */

export type OrderFlowTrade = {
  price: number;
  qty: number;
  notional: number;
  buyerMaker: boolean;
  time: number;
};

export type FootprintRow = {
  price: number;
  buy: number;
  sell: number;
  /** Ratio of the dominant side over the weaker one; Infinity when one side is empty. */
  imbalance: number;
  dominant: "buy" | "sell" | "flat";
  /** True while the row sits inside the 70% volume value area. */
  inValueArea: boolean;
};

export const FOOTPRINT_TARGET_ROWS = 16;

export function percentile(values: number[], quantile: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * quantile)),
  );
  return sorted[index];
}

/**
 * Snap a raw bucket width to a readable 1 / 2 / 5 × 10^n step so prices on the
 * ladder line up instead of landing on arbitrary fractions.
 */
export function niceStep(raw: number) {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const snapped = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return snapped * magnitude;
}

/**
 * Builds the footprint from real executions. The bucket width adapts to the
 * price range the trades actually covered, so a quiet window still resolves
 * into distinct levels instead of collapsing everything into one row, and the
 * rows kept are the ones nearest the market rather than the highest priced.
 */
export function footprintRows(
  trades: OrderFlowTrade[],
  mid: number,
  spread: number,
): FootprintRow[] {
  if (!trades.length || !mid) return [];

  const prices = trades.map((trade) => trade.price);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const observedRange = high - low;

  // Aim for roughly FOOTPRINT_TARGET_ROWS levels across the traded range, but
  // never finer than the spread (that would invent resolution the book lacks).
  const step =
    niceStep(
      Math.max(
        observedRange / FOOTPRINT_TARGET_ROWS,
        spread > 0 ? spread : 0,
        mid * 0.000002,
      ),
    ) || Math.max(mid * 0.00001, Number.EPSILON);

  const rows = new Map<number, { buy: number; sell: number }>();
  trades.forEach((trade) => {
    const bucket = Math.round(trade.price / step) * step;
    const current = rows.get(bucket) ?? { buy: 0, sell: 0 };
    if (trade.buyerMaker) current.sell += trade.notional;
    else current.buy += trade.notional;
    rows.set(bucket, current);
  });

  const nearest = [...rows.entries()]
    .map(([price, value]) => ({ price, ...value }))
    .sort((left, right) => Math.abs(left.price - mid) - Math.abs(right.price - mid))
    .slice(0, FOOTPRINT_TARGET_ROWS);

  // Value area: the levels that together hold 70% of the traded volume, walking
  // outward from the point of control.
  const byVolume = [...nearest].sort(
    (left, right) => right.buy + right.sell - (left.buy + left.sell),
  );
  const totalVolume = byVolume.reduce((sum, row) => sum + row.buy + row.sell, 0);
  const valueAreaPrices = new Set<number>();
  let accumulated = 0;
  for (const row of byVolume) {
    if (totalVolume > 0 && accumulated >= totalVolume * 0.7) break;
    valueAreaPrices.add(row.price);
    accumulated += row.buy + row.sell;
  }

  return nearest
    .map((row) => {
      const stronger = Math.max(row.buy, row.sell);
      const weaker = Math.min(row.buy, row.sell);
      const imbalance = stronger === 0 ? 0 : weaker === 0 ? Infinity : stronger / weaker;
      return {
        ...row,
        imbalance,
        dominant:
          row.buy === row.sell
            ? ("flat" as const)
            : row.buy > row.sell
              ? ("buy" as const)
              : ("sell" as const),
        inValueArea: valueAreaPrices.has(row.price),
      };
    })
    .sort((left, right) => right.price - left.price);
}

/**
 * Cumulative volume delta over a trade window: aggressive buys minus aggressive
 * sells, in quote currency.
 */
export function cumulativeDelta(trades: OrderFlowTrade[]) {
  return trades.reduce(
    (sum, trade) => sum + (trade.buyerMaker ? -trade.notional : trade.notional),
    0,
  );
}

/**
 * Splits executions into the ones large enough to matter for this session.
 * "Large" is relative to the window, not an absolute figure, so it adapts
 * across assets of very different notional sizes.
 */
export function classifyLargeTrades(
  trades: OrderFlowTrade[],
  quantile = 0.9,
  minimumSample = 10,
) {
  const notionals = trades.map((trade) => trade.notional);
  const threshold = percentile(notionals, quantile);
  const eligible = trades.length >= minimumSample;
  return {
    threshold,
    eligible,
    large: eligible ? trades.filter((trade) => trade.notional >= threshold) : [],
  };
}
