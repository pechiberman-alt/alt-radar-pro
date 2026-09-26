/**
 * Weighted-average cost basis and the risk numbers built on top of it, for a
 * spot portfolio pulled from Binance.
 *
 * The convention is "average cost", the same one lib/dca-tracker.ts already
 * documents (average cost = totalInvested / totalUnits): every buy adds
 * units at its own price; every sell removes units at the position's
 * CURRENT average, leaving that average unchanged. This is deliberately not
 * FIFO/LIFO lot tracking, which would give a different number — one
 * convention, used everywhere in the app that has this concept.
 *
 * The method is order-sensitive (a sell right after a cheap buy behaves
 * differently from a sell right after an expensive one), so fills are
 * sorted chronologically before processing regardless of the order given.
 */

export type Fill = { price: number; qty: number; isBuyer: boolean; time: number };
export type CostBasis = { units: number; avgCost: number; investedUsd: number };

export function computeCostBasis(fills: Fill[]): CostBasis {
  let units = 0;
  let invested = 0;
  for (const f of [...fills].sort((a, b) => a.time - b.time)) {
    if (!(f.qty > 0) || !(f.price > 0)) continue;
    if (f.isBuyer) {
      units += f.qty;
      invested += f.qty * f.price;
    } else if (units > 0) {
      const avg = invested / units;
      const sellQty = Math.min(f.qty, units);
      units -= sellQty;
      invested -= sellQty * avg;
    }
  }
  units = Math.max(0, units);
  invested = Math.max(0, invested);
  return { units, avgCost: units > 0 ? invested / units : 0, investedUsd: invested };
}

/**
 * Whether the trade history actually explains what's currently held. A live
 * balance can exceed (or fall short of) what the fetched fills add up to —
 * deposits from elsewhere, staking/earn rewards, or history older than the
 * page fetched — and presenting a P&L in that case would state false
 * confidence rather than a number grounded in what was actually seen.
 */
export function costBasisReliable(basisUnits: number, heldQty: number, tolerance = 0.05): boolean {
  if (!(heldQty > 0) || !(basisUnits > 0)) return false;
  return Math.abs(basisUnits - heldQty) / heldQty <= tolerance;
}

export function unrealizedPnl(heldQty: number, currentPrice: number, avgCost: number): { usd: number; pct: number } | null {
  if (!(avgCost > 0) || !(currentPrice > 0) || !(heldQty > 0)) return null;
  return { usd: heldQty * (currentPrice - avgCost), pct: ((currentPrice - avgCost) / avgCost) * 100 };
}

export function portfolioWeightPct(valueUsd: number, totalUsd: number): number {
  return totalUsd > 0 ? (valueUsd / totalUsd) * 100 : 0;
}

/**
 * What a fall to a given invalidation price would cost, in dollars and as a
 * share of the WHOLE portfolio — not of the position. That second number is
 * the one that actually answers "how much risk is this", since the same
 * price drop matters far less in a position that is 2% of the book than in
 * one that is 40% of it.
 */
export function riskToInvalidation(qty: number, currentPrice: number, invalidationPrice: number, totalPortfolioUsd: number): { usd: number; pct: number } | null {
  if (!(qty > 0) || !(currentPrice > 0) || !(totalPortfolioUsd > 0) || !(currentPrice > invalidationPrice)) return null;
  const usd = qty * (currentPrice - invalidationPrice);
  return { usd, pct: (usd / totalPortfolioUsd) * 100 };
}

/** A held Binance balance enriched with what the trade-history fetch could
 *  determine about it. Shared between the server route that produces it and
 *  the client panel that renders it, so nothing client-side ever imports
 *  from an app/api/** route module (those pull in Worker-only bindings). */
export type RiskPosition = {
  asset: string;
  qty: number;
  price: number | null;
  valueUsd: number | null;
  isStable: boolean;
  costBasis: CostBasis | null;
  costBasisReliable: boolean;
};
