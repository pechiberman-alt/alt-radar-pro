/**
 * A record of DCA purchases the person made themselves, and the arithmetic
 * that turns it into a position.
 *
 * Every purchase here is something the person typed in after buying it on
 * their own — this module never places an order or touches an exchange. It
 * exists to answer "what do I actually hold and at what average cost",
 * which is arithmetic anyone doing DCA by hand loses track of after enough
 * purchases.
 */

export type DcaPurchase = {
  id: string;
  symbol: string;
  usdAmount: number;
  /** Units bought, derived from usdAmount and the price at purchase time. */
  units: number;
  priceAtPurchase: number;
  purchasedAt: string;
};

export type DcaPosition = {
  symbol: string;
  purchases: number;
  totalInvestedUsd: number;
  totalUnits: number;
  averageCost: number;
  /** Null until a current price is supplied. */
  currentValueUsd: number | null;
  pnlUsd: number | null;
  pnlPct: number | null;
  firstPurchaseAt: string;
  lastPurchaseAt: string;
};

export function buildDcaPosition(
  symbol: string,
  purchases: DcaPurchase[],
  currentPrice: number | null,
): DcaPosition | null {
  const own = purchases.filter((p) => p.symbol === symbol);
  if (!own.length) return null;

  const totalInvestedUsd = own.reduce((sum, p) => sum + p.usdAmount, 0);
  const totalUnits = own.reduce((sum, p) => sum + p.units, 0);
  const averageCost = totalUnits > 0 ? totalInvestedUsd / totalUnits : 0;

  const currentValueUsd = currentPrice !== null ? totalUnits * currentPrice : null;
  const pnlUsd = currentValueUsd !== null ? currentValueUsd - totalInvestedUsd : null;
  const pnlPct =
    pnlUsd !== null && totalInvestedUsd > 0 ? (pnlUsd / totalInvestedUsd) * 100 : null;

  const dates = own.map((p) => p.purchasedAt).sort();

  return {
    symbol,
    purchases: own.length,
    totalInvestedUsd,
    totalUnits,
    averageCost,
    currentValueUsd,
    pnlUsd,
    pnlPct,
    firstPurchaseAt: dates[0],
    lastPurchaseAt: dates[dates.length - 1],
  };
}

/** One position per symbol the person has purchases in, current value applied
 *  wherever a live price was supplied for that symbol. */
export function buildDcaPositions(
  purchases: DcaPurchase[],
  currentPrices: Record<string, number>,
): DcaPosition[] {
  const symbols = [...new Set(purchases.map((p) => p.symbol))];
  return symbols
    .map((symbol) => buildDcaPosition(symbol, purchases, currentPrices[symbol] ?? null))
    .filter((position): position is DcaPosition => position !== null)
    .sort((a, b) => b.totalInvestedUsd - a.totalInvestedUsd);
}

export const DCA_SCHEDULE_FREQUENCIES = ["DIARIO", "SEMANAL", "QUINCENAL", "MENSUAL"] as const;
export type DcaFrequency = (typeof DCA_SCHEDULE_FREQUENCIES)[number];

export type DcaSchedule = {
  symbol: string;
  usdAmount: number;
  frequency: DcaFrequency;
  /** 0 (Sunday) to 6, used when frequency needs a specific weekday. */
  weekday: number;
  enabled: boolean;
};

export const DCA_SCHEMA = `
CREATE TABLE IF NOT EXISTS dca_purchases (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  usd_amount REAL NOT NULL,
  units REAL NOT NULL,
  price_at_purchase REAL NOT NULL,
  purchased_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS dca_purchases_user_idx ON dca_purchases(user_id);

CREATE TABLE IF NOT EXISTS dca_schedules (
  user_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  usd_amount REAL NOT NULL,
  frequency TEXT NOT NULL,
  weekday INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, symbol)
);
`;

/**
 * Whether a schedule fires today.
 *
 * Kept separate from the alert engine so it can be unit-tested against
 * fixed dates without touching real time — a scheduling bug is exactly the
 * kind of thing that should be caught by a test, not discovered by a
 * reminder that fires on the wrong day or never fires at all.
 *
 * QUINCENAL alternates by counting whole weeks since the Unix epoch — an
 * arbitrary but fixed anchor, so the same schedule always lands on the same
 * weeks rather than drifting depending on when it was created.
 *
 * MENSUAL fires on the 1st of the month. The schedule's `weekday` field has
 * no meaning for a monthly cadence — the UI never collects one for it —
 * so this ignores that field entirely rather than overload it.
 */
export function isDueToday(schedule: DcaSchedule, date: Date): boolean {
  if (!schedule.enabled) return false;

  switch (schedule.frequency) {
    case "DIARIO":
      return true;
    case "SEMANAL":
      return date.getDay() === schedule.weekday;
    case "QUINCENAL": {
      if (date.getDay() !== schedule.weekday) return false;
      const daysSinceEpoch = Math.floor(date.getTime() / 86_400_000);
      return Math.floor(daysSinceEpoch / 7) % 2 === 0;
    }
    case "MENSUAL":
      return date.getDate() === 1;
    default:
      return false;
  }
}
