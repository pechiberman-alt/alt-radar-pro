/**
 * Upcoming token unlocks: supply that is contractually scheduled to become
 * sellable, and who receives it.
 *
 * WHY THIS BELONGS IN A TRADING TERMINAL
 *
 * When a venture fund backs a project it buys in a private round, often at a
 * fraction of the listed price, and those tokens vest over months or years.
 * Each unlock puts supply into hands whose cost basis is far below the market
 * — the clearest scheduled sell pressure that exists in this market, and one
 * of the few things about the future that is known in advance rather than
 * guessed at.
 *
 * WHAT IT IS AND IS NOT
 *
 * A schedule is not a forecast. An unlock is supply becoming *able* to move,
 * not supply that *will* move: recipients may hold, may have hedged already,
 * and the market may have priced it in well before the date. Treat a large
 * unlock as a reason to check a position, not as a signal by itself. The
 * panel says so where the reader sees it.
 *
 * Source: DefiLlama's public emissions data — free, no key.
 */

const EMISSIONS_URL = "https://api.llama.fi/emissions";

/** Who the supply goes to, which is what decides how much it matters. */
export type UnlockAudience = "INVERSORES" | "EQUIPO" | "ECOSISTEMA" | "OTROS";

export type TokenUnlock = {
  /** Project name as published. */
  name: string;
  /** Ticker, uppercased, when the source provides one. */
  symbol: string | null;
  /** Unix ms of the scheduled event. */
  date: number;
  /** Days from now, rounded down. */
  daysAway: number;
  /** Tokens released at this event, when known. */
  tokens: number | null;
  /** Value at the current price, when both are known. */
  valueUsd: number | null;
  /** Share of market cap this unlock represents — the dilution that matters
   *  more than the raw dollar figure, since a big number on a big cap is not
   *  the same event as the same number on a small one. */
  pctOfMcap: number | null;
  audience: UnlockAudience;
  /** True when this lands on a symbol the reader actually trades. */
  onWatchlist: boolean;
};

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/**
 * Classify the recipient.
 *
 * Insider and investor supply is the sell pressure worth watching: those
 * holders are usually far in profit and have a mandate to realise it.
 * Ecosystem and community allocations behave differently, so they are kept
 * separate rather than lumped into one scary number.
 */
export function classifyAudience(raw: unknown): UnlockAudience {
  const label = (text(raw) ?? "").toLowerCase();
  if (/invest|investor|vc|private|seed|strategic|backer/.test(label)) return "INVERSORES";
  if (/team|insider|founder|advis|core|contributor/.test(label)) return "EQUIPO";
  if (/ecosystem|community|treasury|airdrop|reward|incentive|public|liquidity/.test(label))
    return "ECOSISTEMA";
  return "OTROS";
}

type RawEntry = Record<string, unknown>;

/** Pulls the next scheduled event out of one project's record.
 *
 *  The upstream shape is not contractual and has changed before, so every
 *  field is probed across the spellings it has used rather than assumed. A
 *  record that yields no usable date is skipped, not defaulted — an invented
 *  date on a sell-pressure calendar would be worse than a missing row. */
export function parseUnlock(entry: unknown, now: number, watchlist: Set<string>): TokenUnlock | null {
  if (typeof entry !== "object" || entry === null) return null;
  const row = entry as RawEntry;

  const name = text(row.name) ?? text(row.protocol) ?? text(row.gecko_id);
  if (!name) return null;

  const symbol = (text(row.token) ?? text(row.symbol) ?? text(row.tSymbol))?.toUpperCase() ?? null;

  const event = (row.nextEvent ?? row.upcomingEvent ?? null) as RawEntry | null;
  const rawDate =
    num(row.nextEventDate) ??
    num(event?.date) ??
    num(event?.timestamp) ??
    num(row.nextUnlockDate);
  if (rawDate === null) return null;

  // Upstream mixes seconds and milliseconds depending on the field.
  const date = rawDate > 1e12 ? rawDate : rawDate * 1000;
  if (!Number.isFinite(date) || date < now) return null;

  const tokens = num(event?.toUnlock) ?? num(row.toUnlock) ?? num(event?.amount);
  const price = num(row.tPrice) ?? num(row.price);
  const mcap = num(row.mcap) ?? num(row.marketCap);
  const valueUsd = tokens !== null && price !== null ? tokens * price : null;
  const pctOfMcap =
    valueUsd !== null && mcap !== null && mcap > 0 ? (valueUsd / mcap) * 100 : null;

  return {
    name,
    symbol,
    date,
    daysAway: Math.max(0, Math.floor((date - now) / 86_400_000)),
    tokens,
    valueUsd,
    pctOfMcap,
    audience: classifyAudience(event?.category ?? event?.description ?? row.category),
    onWatchlist: symbol !== null && watchlist.has(symbol),
  };
}

export type UnlockBoard = {
  generatedAt: number;
  /** Everything ahead, soonest first. */
  upcoming: TokenUnlock[];
  /** Unlocks landing on symbols the reader trades — the actionable subset. */
  watched: TokenUnlock[];
  /** How many projects the source covered, so thin data is visible as thin. */
  projectsScanned: number;
  source: string;
  caveat: string;
};

export function buildUnlockBoard(
  payload: unknown,
  watchlistSymbols: string[],
  now = Date.now(),
  horizonDays = 60,
): UnlockBoard | null {
  if (!Array.isArray(payload)) return null;

  // Watchlist symbols arrive as trading pairs (BTCUSDT); unlocks are keyed by
  // the bare asset, and Binance's 1000X contracts refer to the same token.
  const watchlist = new Set(
    watchlistSymbols
      .map((pair) => pair.replace(/USDT$/, "").replace(/^1000+/, "").toUpperCase())
      .filter(Boolean),
  );

  const horizon = now + horizonDays * 86_400_000;
  const upcoming = payload
    .map((entry) => parseUnlock(entry, now, watchlist))
    .filter((unlock): unlock is TokenUnlock => unlock !== null && unlock.date <= horizon)
    .sort((a, b) => a.date - b.date);

  if (!upcoming.length) return null;

  return {
    generatedAt: now,
    upcoming,
    watched: upcoming.filter((unlock) => unlock.onWatchlist),
    projectsScanned: payload.length,
    source: "DefiLlama · datos públicos de emisiones",
    caveat:
      "Un desbloqueo es oferta que queda habilitada para venderse, no oferta que se vaya a vender. El calendario es un hecho; la reacción del precio no.",
  };
}

export async function loadUnlockBoard(
  watchlistSymbols: string[],
  now = Date.now(),
): Promise<UnlockBoard | null> {
  const response = await fetch(EMISSIONS_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return null;
  return buildUnlockBoard(await response.json(), watchlistSymbols, now);
}
