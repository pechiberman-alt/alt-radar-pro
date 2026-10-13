/**
 * Velas históricas para los backtests (15 m, 1 h, 4 h y 1 d): una sola llamada a las velas de
 * Binance, con tope de 1.000 velas y 5 minutos de caché; prueba los espejos en orden y, si
 * ninguno responde, devuelve null. La usa /api/backtest/fibonacci.
 */
import { cached } from "./upstream-cache.ts";
import { parseSwingKlines, type SwingCandle } from "./swing-entries.ts";

const BASES = [
  "https://data-api.binance.vision",
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api.binance.com",
];

export const BACKTEST_INTERVALS = new Set(["15m", "1h", "4h", "1d"]);

/**
 * A single call to Binance's klines endpoint, capped at its own max of 1000.
 * That's ~10 days on 15m, ~41 days on 1h, ~166 days on 4h — enough candles
 * for the pivot detector to find a real sample of swing legs without
 * needing pagination across multiple calls.
 */
export async function fetchHistoricalCandles(
  symbol: string,
  interval: string,
  limit: number,
): Promise<SwingCandle[] | null> {
  const safeLimit = Math.max(200, Math.min(1000, limit));
  const key = `backtest-klines:${symbol}:${interval}:${safeLimit}`;

  const { value } = await cached<unknown[]>(key, 5 * 60_000, async () => {
    for (const base of BASES) {
      try {
        const response = await fetch(
          `${base}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${safeLimit}`,
          {
            headers: { Accept: "application/json", "User-Agent": "ALT-RADAR-PRO/2.1" },
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (!response.ok) continue;
        const rows = await response.json();
        if (Array.isArray(rows) && rows.length) return rows;
      } catch {
        // Try the next mirror.
      }
    }
    return null;
  });

  if (!value) return null;
  return parseSwingKlines(value);
}
