import { parseSwingKlines, type SwingCandle } from "./swing-entries.ts";

/**
 * Candles fetched from the Worker.
 *
 * GLOBAL means Binance's main market. THIN is Binance.US, whose volume is a
 * tiny fraction of it: prices follow the main market closely, but its volume
 * does not represent the market at all (an ETH candle there trades a few
 * hundred thousand dollars where the main market trades hundreds of millions).
 * Anything that reads volume must refuse THIN data, and everything else should
 * prefer GLOBAL and say when it fell back.
 *
 * Binance's firewall answers 403 to the data centres where Cloudflare runs the
 * Worker's scheduled jobs (seen in October 2026 on spot, futures and the
 * market-data host alike), while requests a person makes from the app still
 * reach it. Jobs that must work with the app closed can pass `outside: true`:
 * the same coin is then read from Kraken and, failing that, Coinbase, in US
 * dollars. Their prices track Binance's USDT pairs within a few hundredths of
 * a percent; their volume is that exchange's own, not the main market's, so a
 * caller that reads volume must say where it came from or refuse it. Gold and
 * silver (Binance perpetuals) never leave Binance.
 */
export const GLOBAL_BASES = [
  "https://data-api.binance.vision",
  "https://api-gcp.binance.com",
  "https://api.binance.com",
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api3.binance.com",
];
export const THIN_BASES = ["https://api.binance.us"];
export const FUTURES_BASES_SERVER = ["https://fapi.binance.com", "https://fapi1.binance.com", "https://fapi2.binance.com"];
export const KRAKEN_BASE = "https://api.kraken.com";
export const COINBASE_BASE = "https://api.exchange.coinbase.com";

/**
 * Binance's TradFi perpetuals (gold, silver) have no spot market: their data
 * lives only on the futures API. XAUUSDT tracks one troy ounce of gold.
 */
export const FUTURES_ONLY = new Set(["XAUUSDT", "XAGUSDT"]);
export const marketOf = (symbol: string): "spot" | "futures" => (FUTURES_ONLY.has(symbol) ? "futures" : "spot");

export type Venue = "BINANCE" | "BINANCE_FUTURES" | "BINANCE_US" | "KRAKEN" | "COINBASE";
export const VENUE_LABEL: Record<Venue, string> = {
  BINANCE: "Binance",
  BINANCE_FUTURES: "Binance futuros",
  BINANCE_US: "Binance.US",
  KRAKEN: "Kraken",
  COINBASE: "Coinbase",
};
/** Exchanges other than Binance, read only when Binance does not answer the server. */
export const isOutside = (v: Venue | null | undefined) => v === "KRAKEN" || v === "COINBASE";

/** What Binance's main market said: BLOQUEADO when its firewall refused the server (403/451), FALLA for any other error. */
export type BinanceStatus = "OK" | "BLOQUEADO" | "FALLA";
/** `binance` says why the candles came from somewhere else; "OK" when they are Binance's main market. */
export type ServerKlines = { candles: SwingCandle[]; base: string; thin: boolean; venue: Venue; binance: BinanceStatus };

/**
 * A host that answered 403/451 is skipped for 10 minutes in this isolate,
 * together with the hosts behind the same firewall (all of spot, all of
 * futures; api-gcp runs elsewhere and gets its own try): one request instead
 * of a row of failing ones, which matters with 50 per run on the free plan.
 */
type HostGroup = "spot" | "gcp" | "futures" | "us";
const groupOf = (base: string): HostGroup => (base.includes("fapi") ? "futures" : base.includes("api-gcp") ? "gcp" : base.includes("binance.us") ? "us" : "spot");
const GROUP_LABEL: Record<HostGroup, string> = { spot: "Binance", gcp: "Binance", futures: "Binance futuros", us: "Binance.US" };
const BLOCK_MS = 10 * 60_000;
const blocked = new Map<HostGroup, { until: number; status: number }>();
export function resetKlinesServerState() {
  blocked.clear();
}

const HEADERS = { Accept: "application/json", "User-Agent": "ALT-RADAR-PRO/1.0" };
const usdtBase = (symbol: string) => (/^[A-Z0-9]{2,15}USDT$/.test(symbol) ? symbol.slice(0, -4) : null);
const why = (error: unknown) => (error instanceof Error ? (error.name === "TimeoutError" ? "sin respuesta" : error.message) : "error");

const KRAKEN_INTERVAL: Record<string, number> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "1d": 1440, "1w": 10080 };
const KRAKEN_ASSET: Record<string, string> = { BTC: "XBT", DOGE: "XDG" };
/** Kraken's name for a Binance USDT pair, in US dollars (BTCUSDT → XBTUSD); null if it isn't one. */
export function krakenPair(symbol: string): string | null {
  const base = usdtBase(symbol);
  return base && !FUTURES_ONLY.has(symbol) ? `${KRAKEN_ASSET[base] ?? base}USD` : null;
}

const COINBASE_GRANULARITY: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "6h": 21600, "1d": 86400 };
/** Coinbase's product for a Binance USDT pair, in US dollars (BTCUSDT → BTC-USD); null if it isn't one. */
export function coinbaseProduct(symbol: string): string | null {
  const base = usdtBase(symbol);
  return base && !FUTURES_ONLY.has(symbol) ? `${base}-USD` : null;
}

/**
 * Kraken's OHLC: `{ error: [], result: { <pair>: [[time s, open, high, low,
 * close, vwap, volume, count], …], last } }`, oldest first, the forming candle
 * last. The pair key is Kraken's own name (XXBTZUSD for XBTUSD). Quote volume
 * is volume × vwap.
 */
export function parseKrakenOhlc(payload: unknown): SwingCandle[] {
  const p = payload as { error?: unknown; result?: Record<string, unknown> } | null;
  if (Array.isArray(p?.error) && p.error.length) throw new Error(`Kraken: ${String(p.error[0])}`);
  const result = p?.result;
  if (!result || typeof result !== "object") return [];
  const key = Object.keys(result).find((k) => k !== "last");
  const rows = key ? result[key] : null;
  if (!Array.isArray(rows)) return [];
  const out: SwingCandle[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 7) continue;
    const [t, open, high, low, close, vwap, volume] = row.slice(0, 7).map(Number);
    if (![t, open, high, low, close, vwap, volume].every(Number.isFinite) || close <= 0 || high < low) continue;
    out.push({ openTime: t * 1000, open, high, low, close, volume, quoteVolume: volume * (vwap > 0 ? vwap : close) });
  }
  return out;
}

/**
 * Coinbase's candles: `[[time s, low, high, open, close, volume], …]`, newest
 * first; buckets without trades are missing. Quote volume is estimated as
 * volume × typical price (Coinbase gives no quote volume).
 */
export function parseCoinbaseCandles(payload: unknown): SwingCandle[] {
  if (!Array.isArray(payload)) {
    const message = (payload as { message?: unknown } | null)?.message;
    if (typeof message === "string") throw new Error(`Coinbase: ${message}`);
    return [];
  }
  const out: SwingCandle[] = [];
  for (const row of payload) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [t, low, high, open, close, volume] = row.slice(0, 6).map(Number);
    if (![t, low, high, open, close, volume].every(Number.isFinite) || close <= 0 || high < low) continue;
    out.push({ openTime: t * 1000, open, high, low, close, volume, quoteVolume: volume * ((high + low + close) / 3) });
  }
  return out.sort((a, b) => a.openTime - b.openTime);
}

/** The window asked for, as Binance gives it: `limit` candles from `startTime`, or the last `limit`. */
function pick(candles: SwingCandle[], limit: number, startTime?: number): SwingCandle[] {
  return startTime ? candles.filter((c) => c.openTime >= startTime).slice(0, limit) : candles.slice(-limit);
}

type Opts = { limit?: number; startTime?: number; minCandles?: number; allowThin?: boolean; market?: "spot" | "futures"; outside?: boolean };
/** What every source answered on the way, for the error and for `binance`. */
type Trail = { errors: string[]; blocked: boolean; failed: boolean };
const statusOf = (t: Trail): BinanceStatus => (t.blocked ? "BLOQUEADO" : t.failed ? "FALLA" : "OK");

async function getJson(url: string): Promise<unknown> {
  const response = await globalThis.fetch(url, { signal: AbortSignal.timeout(6_000), headers: HEADERS });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fromBinance(bases: string[], path: string, query: string, minCandles: number, t: Trail): Promise<ServerKlines | null> {
  for (const base of bases) {
    const g = groupOf(base);
    const main = g !== "us";
    const block = blocked.get(g);
    if (block && block.until > Date.now()) {
      if (main) t.blocked = true;
      t.errors.push(`${GROUP_LABEL[g]} HTTP ${block.status}`);
      continue;
    }
    try {
      const response = await globalThis.fetch(`${base}${path}?${query}`, { signal: AbortSignal.timeout(6_000), headers: HEADERS });
      if (!response.ok) {
        if (response.status === 403 || response.status === 451) {
          blocked.set(g, { until: Date.now() + BLOCK_MS, status: response.status });
          if (main) t.blocked = true;
        }
        throw new Error(`HTTP ${response.status}`);
      }
      const candles = parseSwingKlines(await response.json());
      if (candles.length >= minCandles) {
        return { candles, base, thin: !main, venue: g === "futures" ? "BINANCE_FUTURES" : main ? "BINANCE" : "BINANCE_US", binance: main ? "OK" : statusOf(t) };
      }
      throw new Error(`${candles.length} velas`);
    } catch (error) {
      if (main) t.failed = true;
      t.errors.push(`${GROUP_LABEL[g]} ${why(error)}`);
    }
  }
  return null;
}

async function fromKraken(symbol: string, interval: string, limit: number, minCandles: number, startTime: number | undefined, t: Trail): Promise<ServerKlines | null> {
  const pair = krakenPair(symbol);
  const iv = KRAKEN_INTERVAL[interval];
  if (!pair || !iv) return null;
  try {
    // Kraken keeps the last 720 candles of each interval and takes no limit.
    const candles = pick(parseKrakenOhlc(await getJson(`${KRAKEN_BASE}/0/public/OHLC?pair=${pair}&interval=${iv}`)), limit, startTime);
    if (candles.length >= minCandles) return { candles, base: KRAKEN_BASE, thin: false, venue: "KRAKEN", binance: statusOf(t) };
    throw new Error(`${candles.length} velas`);
  } catch (error) {
    const w = why(error);
    t.errors.push(w.startsWith("Kraken") ? w : `Kraken ${w}`);
    return null;
  }
}

async function fromCoinbase(symbol: string, interval: string, limit: number, minCandles: number, startTime: number | undefined, t: Trail): Promise<ServerKlines | null> {
  const product = coinbaseProduct(symbol);
  const g = COINBASE_GRANULARITY[interval];
  if (!product || !g) return null;
  const frame = g * 1000;
  const url = (from?: number, to?: number) =>
    `${COINBASE_BASE}/products/${product}/candles?granularity=${g}${from !== undefined && to !== undefined ? `&start=${new Date(from).toISOString()}&end=${new Date(to).toISOString()}` : ""}`;
  try {
    let candles: SwingCandle[];
    if (startTime) {
      candles = parseCoinbaseCandles(await getJson(url(startTime, Math.min(Date.now(), startTime + 299 * frame))));
    } else {
      candles = parseCoinbaseCandles(await getJson(url()));
      // A page is about 300 candles: one older page when more were asked for.
      if (candles.length && candles.length < limit) {
        const end = candles[0].openTime - frame;
        const seen = new Set(candles.map((c) => c.openTime));
        candles = [...parseCoinbaseCandles(await getJson(url(end - 299 * frame, end))).filter((c) => !seen.has(c.openTime)), ...candles];
      }
    }
    candles = pick(candles, limit, startTime);
    if (candles.length >= minCandles) return { candles, base: COINBASE_BASE, thin: false, venue: "COINBASE", binance: statusOf(t) };
    throw new Error(`${candles.length} velas`);
  } catch (error) {
    const w = why(error);
    t.errors.push(w.startsWith("Coinbase") ? w : `Coinbase ${w}`);
    return null;
  }
}

/**
 * Order: Binance (the market asked for first, then the other one), then
 * Kraken and Coinbase when `outside` is set, then Binance.US when
 * `allowThin` is set. Throws with what each source answered when none did.
 */
export async function fetchKlinesServer(symbol: string, interval: string, opts: Opts = {}): Promise<ServerKlines> {
  const limit = opts.limit ?? 30;
  const minCandles = opts.minCandles ?? 1;
  const query = `symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}${opts.startTime ? `&startTime=${Math.floor(opts.startTime)}` : ""}`;
  const t: Trail = { errors: [], blocked: false, failed: false };
  const futuresOnly = marketOf(symbol) === "futures";
  const spot = () => fromBinance(GLOBAL_BASES, "/api/v3/klines", query, minCandles, t);
  const futures = () => fromBinance(FUTURES_BASES_SERVER, "/fapi/v1/klines", query, minCandles, t);
  const steps = futuresOnly ? [futures] : opts.market === "futures" ? [futures, spot] : [spot, futures];
  if (opts.outside && !futuresOnly) {
    steps.push(
      () => fromKraken(symbol, interval, limit, minCandles, opts.startTime, t),
      () => fromCoinbase(symbol, interval, limit, minCandles, opts.startTime, t),
    );
  }
  if (opts.allowThin && !futuresOnly) steps.push(() => fromBinance(THIN_BASES, "/api/v3/klines", query, minCandles, t));
  for (const step of steps) {
    const r = await step();
    if (r) return r;
  }
  const errors = [...new Set(t.errors)];
  throw new Error(errors.length ? errors.slice(0, 4).join(" · ") : "SIN DATOS");
}
