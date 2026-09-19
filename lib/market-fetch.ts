/**
 * Browser-side market fetchers, shared by the panels that need them.
 *
 * These live outside the components because more than one panel needs the
 * same data: the liquidation map draws it, and the active-signal desk derives
 * targets from it. Duplicating the mirror lists and the fallback order would
 * guarantee they drift apart — and that order is not incidental, it encodes
 * which hosts block a datacenter address and which do not.
 */

export const FALLBACK_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
/** How many pairs to offer. Enough to cover what actually trades, few enough
 *  that a selector row stays scannable rather than a wall of tickers. */
const SYMBOL_COUNT = 30;

const BROWSER_BASES = ["https://data-api.binance.vision", "https://api.binance.com"];

/** Futures hosts, for open interest. Same mirror list market-brain already uses. */
export const FUTURES_BASES = [
  "https://fapi.binance.com",
  "https://fapi1.binance.com",
  "https://fapi2.binance.com",
];

/** Candles per timeframe for the activity profile that feeds the map. */
export const LOOKBACK: Record<string, number> = { "15m": 500, "1h": 500, "4h": 500, "1d": 365 };

/**
 * Binance's open-interest history endpoint takes its own period names and,
 * critically, only retains about 30 days of history — and caps a single call
 * at 500 rows. Daily candles therefore get no OI coverage at all, and the
 * shorter frames get partial coverage. That is fine: the engine falls back to
 * volume per-candle wherever OI is missing, and reports how much of the map
 * came from which source.
 */
/**
 * Half-life in candles, chosen so each timeframe discounts activity on a
 * comparable real-time scale (~2 days). Leveraged perpetual positions turn
 * over fast — a published study of BitMEX found roughly 3.5% of longs were
 * force-liquidated every single day — so treating month-old activity as
 * still-open would overstate the map badly.
 */
export const HALF_LIFE_CANDLES: Record<string, number> = {
  "15m": 192,
  "1h": 48,
  "4h": 12,
  "1d": 3,
};

export const OI_PERIOD: Record<string, string | null> = {
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1d": null,
};

export async function loadRows(symbol: string, interval: string, limit: number, signal: AbortSignal) {
  const query = `symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;

  // Futures first, for two reasons. This map is entirely about futures
  // positions, so futures candles are the right series to project from. And
  // several liquid perpetuals — the 1000PEPE / 1000SHIB style contracts —
  // have no spot pair at all, so a spot-only fetch would simply fail for them
  // now that the selector offers the whole top-30.
  for (const base of FUTURES_BASES) {
    try {
      const response = await fetch(`${base}/fapi/v1/klines?${query}`, { signal });
      if (!response.ok) continue;
      const rows = await response.json();
      if (Array.isArray(rows) && rows.length) return rows;
    } catch {
      // Next mirror.
    }
  }

  for (const base of BROWSER_BASES) {
    try {
      const response = await fetch(`${base}/api/v3/klines?${query}`, { signal });
      if (!response.ok) continue;
      const rows = await response.json();
      if (Array.isArray(rows) && rows.length) {
        // Hand the series to the Worker so a rate-limited visitor still gets a
        // map — the same contribution mechanism /api/klines already runs on.
        void fetch(`/api/klines?symbol=${symbol}&interval=${interval}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rows.slice(-500)),
        }).catch(() => undefined);
        return rows;
      }
    } catch {
      // Try the next mirror, then the Worker.
    }
  }

  // This visitor is throttled or offline: fall back to whatever the Worker has,
  // which may be a series another visitor contributed.
  const proxied = await fetch(
    `/api/klines?symbol=${symbol}&interval=${interval}&limit=500`,
    { signal, cache: "no-store" },
  );
  if (!proxied.ok) return null;
  const rows = await proxied.json();
  return Array.isArray(rows) && rows.length ? rows : null;
}

/**
 * Per-candle change in open interest, aligned by candle open time.
 *
 * Volume counts a position opening and closing as two events; open interest
 * counts only what is still held. A rise in OI on a candle means contracts
 * were opened at that price — the thing this map is actually trying to find.
 * Returns null on any failure so the engine simply keeps using volume.
 */
/**
 * Current total open interest, in contracts. Multiplied by price it gives the
 * notional the whole map is scaled against, which turns an abstract intensity
 * into an amount a reader can weigh. Null on any failure — the panel then
 * shows intensity alone rather than a made-up figure.
 */
export async function loadOpenInterest(symbol: string, signal: AbortSignal): Promise<number | null> {
  const path = `/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`;
  for (const base of FUTURES_BASES) {
    try {
      const response = await fetch(`${base}${path}`, { signal });
      if (!response.ok) continue;
      const body = (await response.json()) as { openInterest?: unknown };
      const contracts = Number(body.openInterest);
      if (Number.isFinite(contracts) && contracts > 0) return contracts;
    } catch {
      // Next mirror; if all fail the map simply has no dollar scale.
    }
  }
  return null;
}

export async function loadOiDelta(
  symbol: string,
  timeframe: string,
  candleOpenTimes: number[],
  signal: AbortSignal,
): Promise<(number | null)[] | null> {
  const period = OI_PERIOD[timeframe];
  if (!period) return null;

  const path = `/futures/data/openInterestHist?symbol=${encodeURIComponent(symbol)}&period=${period}&limit=500`;
  for (const base of FUTURES_BASES) {
    try {
      const response = await fetch(`${base}${path}`, { signal });
      if (!response.ok) continue;
      const rows = (await response.json()) as unknown;
      if (!Array.isArray(rows) || rows.length < 2) continue;

      const byTime = new Map<number, number>();
      for (const row of rows) {
        const entry = row as { timestamp?: unknown; sumOpenInterest?: unknown };
        const time = Number(entry.timestamp);
        const oi = Number(entry.sumOpenInterest);
        if (Number.isFinite(time) && Number.isFinite(oi)) byTime.set(time, oi);
      }
      if (byTime.size < 2) continue;

      // Align to the candles we actually drew, by open time. A candle with no
      // OI row, or whose predecessor has none, gets null and falls back.
      const sorted = [...byTime.keys()].sort((a, b) => a - b);
      const previousOf = new Map<number, number>();
      for (let i = 1; i < sorted.length; i += 1) previousOf.set(sorted[i], sorted[i - 1]);

      return candleOpenTimes.map((time) => {
        const current = byTime.get(time);
        const previousTime = previousOf.get(time);
        if (current === undefined || previousTime === undefined) return null;
        const previous = byTime.get(previousTime);
        if (previous === undefined) return null;
        return current - previous;
      });
    } catch {
      // Next mirror; if all fail, the engine uses volume.
    }
  }
  return null;
}

/** Shown until the live ranking arrives, and as the fallback if it fails. */

/**
 * The most-traded USDT perpetuals, by real 24h quote volume.
 *
 * A hardcoded list goes stale — the pairs that matter in an altseason are not
 * the ones that mattered when the list was written. This ranks them from
 * Binance itself, so the selector always offers what is actually liquid, and
 * only perpetuals, since the whole map depends on futures data.
 */
export async function loadTopSymbols(signal: AbortSignal): Promise<string[] | null> {
  for (const base of FUTURES_BASES) {
    try {
      const response = await fetch(`${base}/fapi/v1/ticker/24hr`, { signal });
      if (!response.ok) continue;
      const rows = (await response.json()) as unknown;
      if (!Array.isArray(rows)) continue;
      const ranked = rows
        .map((row) => row as { symbol?: unknown; quoteVolume?: unknown })
        .filter(
          (row): row is { symbol: string; quoteVolume: string } =>
            typeof row.symbol === "string" &&
            row.symbol.endsWith("USDT") &&
            // Leveraged tokens and index products are not pairs a trader maps.
            !/(UP|DOWN|BEAR|BULL)USDT$/.test(row.symbol) &&
            Number.isFinite(Number(row.quoteVolume)),
        )
        .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
        .slice(0, SYMBOL_COUNT)
        .map((row) => row.symbol);
      if (ranked.length >= 5) return ranked;
    } catch {
      // Next mirror; the fallback list keeps the panel usable either way.
    }
  }
  return null;
}
