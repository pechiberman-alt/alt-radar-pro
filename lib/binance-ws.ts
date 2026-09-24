/**
 * Binance USDⓈ-M futures WebSocket routing — one place for it.
 *
 * In 2026 Binance split the futures WebSocket by traffic type. Order-book
 * streams live under /public; candles, trades, tickers and liquidations under
 * /market. The legacy root URLs were retired, and a connection on the wrong
 * path OPENS FINE AND THEN RECEIVES NOTHING — which is exactly how the live
 * map ended up showing "en vivo" over a frozen price. Every futures socket in
 * the app builds its URL here, so the next change is a one-line fix.
 */

export const FUTURES_WS = {
  public: "wss://fstream.binance.com/public",
  market: "wss://fstream.binance.com/market",
} as const;

export type FuturesWsCategory = keyof typeof FUTURES_WS;

/** Order-book streams are public; everything else a market panel uses is market. */
export function futuresStreamCategory(stream: string): FuturesWsCategory {
  return /@depth|@bookTicker|^!bookTicker/.test(stream) ? "public" : "market";
}

/**
 * Combined-stream URL for streams that share one category. Mixing categories
 * on one connection is exactly the mistake this module exists to prevent, so
 * it throws rather than silently building a URL that half-works.
 */
export function futuresStreamUrl(streams: string[]): string {
  if (!streams.length) throw new Error("sin streams");
  const categories = new Set(streams.map(futuresStreamCategory));
  if (categories.size > 1) throw new Error(`streams de categorías distintas: ${streams.join(", ")}`);
  const [category] = [...categories];
  return `${FUTURES_WS[category]}/stream?streams=${streams.join("/")}`;
}
