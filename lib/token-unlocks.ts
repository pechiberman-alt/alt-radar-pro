/**
 * Supply overhang: how much of each token still has to reach the market.
 *
 * WHY THIS AND NOT THE UNLOCK CALENDAR
 *
 * The dated calendar — "12% of APT unlocks on the 14th" — is the thing every
 * trader wants, and every provider that has it charges for it: CryptoRank and
 * Messari gate it behind paid and Enterprise plans, DefiLlama's is on its Pro
 * tier, and CoinGecko, CoinMarketCap and Coinpaprika do not carry it at all.
 * The tools that read it free do so by rendering the page in a browser, which
 * a Worker cannot do.
 *
 * So rather than leave a panel promising data it cannot get, this measures the
 * part that IS free and verifiable: the gap between circulating supply and
 * total supply. That gap is every token still owed to investors, team and
 * treasury — the same supply the calendar schedules, counted rather than
 * dated.
 *
 * WHAT IT ANSWERS AND WHAT IT DOES NOT
 *
 * It answers "how much dilution is still coming, and what is it worth at
 * today's price". It does NOT answer "when". A token with 80% still locked
 * carries that weight whether the next tranche lands next week or in 2028,
 * and this cannot tell you which — the panel says so plainly instead of
 * implying a timeline it does not have.
 */

const MARKETS_URL =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false";

export type SupplyOverhang = {
  symbol: string;
  name: string;
  priceUsd: number;
  marketCapUsd: number;
  circulating: number;
  total: number;
  /** Share of total supply already in circulation. */
  unlockedPct: number;
  /** Tokens still to come. */
  lockedTokens: number;
  /** What that locked supply is worth at today's price — the dilution ahead. */
  lockedValueUsd: number;
  /** Locked value as a multiple of current market cap: 1.0 means the float
   *  could double. This is the number that actually ranks risk. */
  overhangRatio: number;
  onWatchlist: boolean;
};

export type OverhangBoard = {
  generatedAt: number;
  /** Heaviest overhang first. */
  ranked: SupplyOverhang[];
  watched: SupplyOverhang[];
  scanned: number;
  source: string;
  caveat: string;
};

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

export function parseOverhang(entry: unknown, watchlist: Set<string>): SupplyOverhang | null {
  if (typeof entry !== "object" || entry === null) return null;
  const row = entry as Record<string, unknown>;

  const symbol = typeof row.symbol === "string" ? row.symbol.toUpperCase() : null;
  const name = typeof row.name === "string" ? row.name : null;
  const priceUsd = num(row.current_price);
  const marketCapUsd = num(row.market_cap);
  const circulating = num(row.circulating_supply);
  // max_supply is the hard cap where one exists; total_supply is what has been
  // minted. The relevant ceiling is the larger of the two that is known —
  // using only one understates tokens that mint beyond current total.
  const total = Math.max(num(row.total_supply) ?? 0, num(row.max_supply) ?? 0) || null;

  if (!symbol || !name || !priceUsd || !marketCapUsd || !circulating || !total) return null;
  // Reported circulating above total happens on bad data; it is not a
  // negative overhang, it is a record to skip.
  if (circulating > total) return null;

  const lockedTokens = total - circulating;
  const lockedValueUsd = lockedTokens * priceUsd;

  return {
    symbol,
    name,
    priceUsd,
    marketCapUsd,
    circulating,
    total,
    unlockedPct: (circulating / total) * 100,
    lockedTokens,
    lockedValueUsd,
    overhangRatio: lockedValueUsd / marketCapUsd,
    onWatchlist: watchlist.has(symbol),
  };
}

export function buildOverhangBoard(
  payload: unknown,
  watchlistSymbols: string[],
  now = Date.now(),
): OverhangBoard | null {
  if (!Array.isArray(payload)) return null;

  const watchlist = new Set(
    watchlistSymbols
      .map((pair) => pair.replace(/USDT$/, "").replace(/^1000+/, "").toUpperCase())
      .filter(Boolean),
  );

  const parsed = payload
    .map((entry) => parseOverhang(entry, watchlist))
    .filter((row): row is SupplyOverhang => row !== null);

  if (!parsed.length) return null;

  const ranked = [...parsed].sort((a, b) => b.overhangRatio - a.overhangRatio);

  return {
    generatedAt: now,
    ranked,
    watched: ranked.filter((row) => row.onWatchlist),
    scanned: parsed.length,
    source: "CoinGecko · oferta circulante y total",
    caveat:
      "Esto mide cuánta dilución falta, no cuándo llega. El calendario con fechas exactas sólo lo publican proveedores de pago; esta es la parte que sí es verificable gratis.",
  };
}

export async function loadOverhangBoard(
  watchlistSymbols: string[],
  now = Date.now(),
): Promise<OverhangBoard | null> {
  const response = await fetch(MARKETS_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return null;
  return buildOverhangBoard(await response.json(), watchlistSymbols, now);
}
