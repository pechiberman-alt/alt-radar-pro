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

const BROWSER_BASES = ["https://data-api.binance.vision", "https://api.binance.com"];

/** Futures hosts, for open interest. Same mirror list market-brain already uses. */
export const FUTURES_BASES = [
  "https://fapi.binance.com",
  "https://fapi1.binance.com",
  "https://fapi2.binance.com",
];

/**
 * Per-timeframe configuration, in one table.
 *
 * These four settings were three separate maps that had to be kept in step by
 * hand, which is how a timeframe ends up half-configured. They belong
 * together because they are not independent: the lookback decides how much
 * history exists, the half-life decides how much of it still counts, the
 * price range decides how far a projection is meaningful, and the OI period
 * decides whether the better data source is even available.
 *
 * HALF-LIFE SCALES WITH THE HORIZON, NOT WITH WALL-CLOCK TIME
 *
 * The first version used ~2 days of real time on every frame, reasoning from
 * how fast leveraged positions turn over. That is right for intraday and
 * wrong for the rest: two days is a fraction of one weekly candle, so it
 * would discount almost the entire chart to nothing. Someone reading a weekly
 * map is looking at positions held for weeks. The horizon therefore grows
 * with the frame — from hours on the minute chart to months on the weekly.
 *
 * PRICE RANGE SCALES TOO
 *
 * Projecting ±22% on a 1-minute chart covers ground price will not see all
 * day, and the map is mostly empty. On a weekly chart ±22% is too narrow to
 * hold the levels that matter. Each frame gets a range that matches how far
 * price actually travels in it.
 *
 * WHERE OPEN INTEREST IS SIMPLY NOT AVAILABLE
 *
 * Binance's openInterestHist accepts 5m, 15m, 30m, 1h, 2h, 4h, 6h, 12h and 1d
 * only, and retains about 30 days. So 1m, 3d and 1w have no OI period at all,
 * and the long frames would get negligible coverage even if they did. Those
 * fall back to volume per candle, and the panel reports the coverage rather
 * than implying the better source was used.
 */
export type TimeframeConfig = {
  /** Candles to request for the activity profile. */
  lookback: number;
  /** Candles until older activity counts half as much. */
  halfLife: number;
  /** How far above and below price to project liquidations. */
  priceRange: number;
  /** Binance openInterestHist period, or null where it does not exist. */
  oiPeriod: string | null;
  /** Shown on the selector. */
  label: string;
};

export const TIMEFRAMES: Record<string, TimeframeConfig> = {
  // ~8 hours of history; positions here are measured in hours.
  "1m": { lookback: 500, halfLife: 240, priceRange: 0.03, oiPeriod: null, label: "1M" },
  "5m": { lookback: 500, halfLife: 288, priceRange: 0.05, oiPeriod: "5m", label: "5M" },
  "15m": { lookback: 500, halfLife: 192, priceRange: 0.08, oiPeriod: "15m", label: "15M" },
  "30m": { lookback: 500, halfLife: 144, priceRange: 0.1, oiPeriod: "30m", label: "30M" },
  "1h": { lookback: 500, halfLife: 96, priceRange: 0.14, oiPeriod: "1h", label: "1H" },
  "4h": { lookback: 500, halfLife: 42, priceRange: 0.22, oiPeriod: "4h", label: "4H" },
  "12h": { lookback: 400, halfLife: 28, priceRange: 0.3, oiPeriod: "12h", label: "12H" },
  // A year of daily candles; the horizon is a couple of weeks.
  "1d": { lookback: 365, halfLife: 21, priceRange: 0.4, oiPeriod: "1d", label: "1D" },
  // Binance has no 3-day OI period, so this runs on volume.
  "3d": { lookback: 300, halfLife: 10, priceRange: 0.5, oiPeriod: null, label: "3D" },
  // Several years of weekly candles; positions held for months.
  "1w": { lookback: 260, halfLife: 8, priceRange: 0.6, oiPeriod: null, label: "1S" },
};

/** Order shown in the selector, coarse to fine reading left to right. */
export const TIMEFRAME_ORDER = ["1m", "5m", "15m", "30m", "1h", "4h", "12h", "1d", "3d", "1w"];

export function timeframeConfig(timeframe: string): TimeframeConfig {
  return TIMEFRAMES[timeframe] ?? TIMEFRAMES["1h"];
}

/** Kept as views over the table so existing callers keep working and cannot
 *  drift from it. */
export const LOOKBACK: Record<string, number> = Object.fromEntries(
  Object.entries(TIMEFRAMES).map(([key, value]) => [key, value.lookback]),
);
export const HALF_LIFE_CANDLES: Record<string, number> = Object.fromEntries(
  Object.entries(TIMEFRAMES).map(([key, value]) => [key, value.halfLife]),
);
export const OI_PERIOD: Record<string, string | null> = Object.fromEntries(
  Object.entries(TIMEFRAMES).map(([key, value]) => [key, value.oiPeriod]),
);

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
/** Every USDT perpetual, most traded first. The selector shows the top few and
 *  searches the rest, so there is no reason to cut the list here. */
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
        .map((row) => row.symbol);
      if (ranked.length >= 5) return ranked;
    } catch {
      // Next mirror; the fallback list keeps the panel usable either way.
    }
  }
  return null;
}

/**
 * Higher frames to read liquidity from, for a given chart frame.
 *
 * Equal highs on the daily hold more resting orders than equal highs on the
 * 15-minute, because more participants saw them and placed stops there. So a
 * chart shows its own pools plus those of the next one or two larger frames,
 * never smaller ones — a 1m pool on a 4h chart is noise at that scale.
 */
const HIGHER: Record<string, string[]> = {
  "1m": ["15m", "1h"],
  "5m": ["1h", "4h"],
  "15m": ["1h", "4h"],
  "30m": ["4h", "1d"],
  "1h": ["4h", "1d"],
  "4h": ["1d", "1w"],
  "12h": ["1d", "1w"],
  "1d": ["1w"],
  "3d": ["1w"],
  "1w": [],
};
export function higherTimeframes(timeframe: string): string[] {
  return HIGHER[timeframe] ?? [];
}
