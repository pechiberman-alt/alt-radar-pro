/**
 * Large executed trades: who is actually hitting the book with size.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE ORDER BOOK
 *
 * A resting order can be cancelled, and large resting orders frequently are —
 * that is what spoofing is. An executed trade cannot be taken back. So a feed
 * of large fills is a record of committed money, not intent, which is why it
 * is worth a panel of its own alongside the depth heatmap.
 *
 * AGGRESSOR SIDE IS THE POINT
 *
 * Every trade has a buyer and a seller, so "volume" alone says nothing about
 * direction. What matters is which side crossed the spread to get filled:
 * Binance reports this per trade, and a run of large aggressive buys is a
 * different market than a run of large aggressive sells at identical volume.
 *
 * WHAT IT IS NOT
 *
 * It does not identify anyone. A large fill may be one desk, a market maker
 * hedging, or an algo slicing a parent order — there is no public data that
 * says which. "Large" here describes size and urgency, never identity.
 */

export type RawAggTrade = {
  /** price */ p: string;
  /** quantity */ q: string;
  /** trade time */ T: number;
  /** true when the BUYER was the maker, i.e. the SELLER was aggressive */ m: boolean;
};

export type BigTrade = {
  time: number;
  price: number;
  qty: number;
  notional: number;
  /** Which side crossed the spread. */
  side: "COMPRA" | "VENTA";
};

export type BigTradeBoard = {
  symbol: string;
  /** Minimum notional counted as large, derived from this symbol's own tape. */
  thresholdUsd: number;
  trades: BigTrade[];
  buyUsd: number;
  sellUsd: number;
  /** Positive when aggressive buyers dominated the large prints. */
  netUsd: number;
  /** Share of large flow that was buying, 0–100. */
  buyShare: number;
  bias: "ACUMULACIÓN" | "DISTRIBUCIÓN" | "EQUILIBRADO";
  reading: string;
  /** Window actually covered by the tape, in minutes. */
  windowMinutes: number;
  source: string;
};

const finite = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function parseAggTrades(payload: unknown): BigTrade[] {
  if (!Array.isArray(payload)) return [];
  const trades: BigTrade[] = [];
  for (const entry of payload) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Partial<RawAggTrade>;
    const price = finite(row.p);
    const qty = finite(row.q);
    const time = finite(row.T);
    if (price === null || qty === null || time === null || price <= 0 || qty <= 0) continue;
    if (typeof row.m !== "boolean") continue;
    trades.push({
      time,
      price,
      qty,
      notional: price * qty,
      // m = buyer was maker, so the seller crossed the spread.
      side: row.m ? "VENTA" : "COMPRA",
    });
  }
  return trades.sort((a, b) => a.time - b.time);
}

/**
 * The "large" threshold is derived from the symbol's own tape rather than a
 * fixed dollar figure: $200k is a whale print on a mid-cap alt and background
 * noise on BTC. Using a high percentile of recent notionals keeps the panel
 * meaningful across every pair without a hand-tuned table that would go stale.
 */
export function largeThreshold(trades: BigTrade[], percentile = 0.99): number {
  if (!trades.length) return 0;
  const sorted = trades.map((trade) => trade.notional).sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * percentile));
  return sorted[index];
}

export function buildBigTradeBoard(
  symbol: string,
  payload: unknown,
  /** Floor so a dead tape cannot promote tiny prints to "large". */
  minNotionalUsd = 25_000,
): BigTradeBoard | null {
  const all = parseAggTrades(payload);
  if (all.length < 50) return null;

  const threshold = Math.max(largeThreshold(all), minNotionalUsd);
  const trades = all.filter((trade) => trade.notional >= threshold);
  if (!trades.length) return null;

  const buyUsd = trades
    .filter((trade) => trade.side === "COMPRA")
    .reduce((sum, trade) => sum + trade.notional, 0);
  const sellUsd = trades
    .filter((trade) => trade.side === "VENTA")
    .reduce((sum, trade) => sum + trade.notional, 0);
  const total = buyUsd + sellUsd;
  const netUsd = buyUsd - sellUsd;
  const buyShare = total > 0 ? (buyUsd / total) * 100 : 50;

  // Below this the two sides are trading against each other without either
  // pressing, which is the normal state and should not read as a signal.
  let bias: BigTradeBoard["bias"] = "EQUILIBRADO";
  let reading =
    "Las órdenes grandes están repartidas entre compra y venta. Hay tamaño operando, pero ningún lado está presionando.";
  if (buyShare >= 62) {
    bias = "ACUMULACIÓN";
    reading =
      "El dinero grande está cruzando el spread para comprar. Quien opera así acepta pagar peor precio con tal de entrar ya, y eso es urgencia, no paciencia.";
  } else if (buyShare <= 38) {
    bias = "DISTRIBUCIÓN";
    reading =
      "El dinero grande está cruzando el spread para vender. Están aceptando peor precio con tal de salir, que es lo contrario de acumular en silencio.";
  }

  const first = all[0].time;
  const last = all[all.length - 1].time;

  return {
    symbol,
    thresholdUsd: threshold,
    // Newest first: the panel reads top-down as most recent.
    trades: [...trades].sort((a, b) => b.time - a.time).slice(0, 40),
    buyUsd,
    sellUsd,
    netUsd,
    buyShare,
    bias,
    reading,
    windowMinutes: Math.max(1, Math.round((last - first) / 60_000)),
    source: "Binance Futures · operaciones ejecutadas",
  };
}
