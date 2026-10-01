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
 */
export const GLOBAL_BASES = ["https://data-api.binance.vision", "https://api.binance.com", "https://api1.binance.com", "https://api2.binance.com", "https://api3.binance.com"];
export const THIN_BASES = ["https://api.binance.us"];
export const FUTURES_BASES_SERVER = ["https://fapi.binance.com", "https://fapi1.binance.com", "https://fapi2.binance.com"];

/**
 * Binance's TradFi perpetuals (gold, silver) have no spot market: their data
 * lives only on the futures API. XAUUSDT tracks one troy ounce of gold.
 */
export const FUTURES_ONLY = new Set(["XAUUSDT", "XAGUSDT"]);
export const marketOf = (symbol: string): "spot" | "futures" => (FUTURES_ONLY.has(symbol) ? "futures" : "spot");

export type ServerKlines = { candles: SwingCandle[]; base: string; thin: boolean };

export async function fetchKlinesServer(
  symbol: string,
  interval: string,
  opts: { limit?: number; startTime?: number; minCandles?: number; allowThin?: boolean; market?: "spot" | "futures" } = {},
): Promise<ServerKlines> {
  const futures = (opts.market ?? marketOf(symbol)) === "futures";
  const bases = futures ? FUTURES_BASES_SERVER : opts.allowThin ? [...GLOBAL_BASES, ...THIN_BASES] : GLOBAL_BASES;
  const path = futures ? "/fapi/v1/klines" : "/api/v3/klines";
  const query = `symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${opts.limit ?? 30}${opts.startTime ? `&startTime=${Math.floor(opts.startTime)}` : ""}`;
  let lastError: unknown;
  for (const base of bases) {
    try {
      const response = await globalThis.fetch(`${base}${path}?${query}`, { signal: AbortSignal.timeout(6_000), headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const candles = parseSwingKlines(await response.json());
      if (candles.length >= (opts.minCandles ?? 1)) return { candles, base, thin: THIN_BASES.includes(base) };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("SIN DATOS");
}
