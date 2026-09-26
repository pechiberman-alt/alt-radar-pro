"use client";

/**
 * Shared candle loader for the browser-side panels.
 *
 * Public Binance mirrors are tried first because they are the fastest path and
 * cost the Worker nothing. When they fail — most often because Binance is rate
 * limiting this client IP and replies without CORS headers — the request falls
 * back to the app's own proxy, so a throttled browser degrades instead of
 * showing an empty panel.
 */

const DIRECT_BASES = [
  "https://data-api.binance.vision",
  "https://api1.binance.com",
  "https://api.binance.com",
];

export type KlineInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

/**
 * Binance answers a client that exceeds its request budget with HTTP 418 and
 * keeps the ban alive while requests keep arriving. Once the proxy reports the
 * upstream is refusing us, every panel stops trying for a while instead of
 * extending the ban with a retry storm.
 */
const DIRECT_COOLDOWN_MS = 90_000;
let directBlockedUntil = 0;

export function directFetchBlocked() {
  return Date.now() < directBlockedUntil;
}

/**
 * Share a successful fetch with the Worker so throttled visitors can read it.
 * Fire-and-forget: this is a courtesy to other clients, never something the
 * caller should wait on or fail over.
 */
const contributed = new Set<string>();

function contribute(symbol: string, interval: KlineInterval, rows: unknown[]) {
  const key = `${symbol}:${interval}`;
  if (contributed.has(key)) return;
  contributed.add(key);
  // Only once per key per session, so a long-lived tab does not keep posting.
  window.setTimeout(() => contributed.delete(key), 60_000);
  void fetch(
    `/api/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rows),
      keepalive: true,
    },
  ).catch(() => undefined);
}

export async function fetchKlineRows(
  symbol: string,
  interval: KlineInterval,
  limit: number,
  timeout = 7_000,
): Promise<unknown[]> {
  for (const base of directFetchBlocked() ? [] : DIRECT_BASES) {
    try {
      const response = await fetch(
        `${base}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`,
        { signal: AbortSignal.timeout(timeout), headers: { Accept: "application/json" } },
      );
      if (!response.ok) continue;
      const rows = await response.json();
      if (Array.isArray(rows) && rows.length) {
        // Binance refuses Cloudflare's addresses on this endpoint, so the
        // Worker cannot build this cache itself. A client that succeeded can,
        // which is what makes the fallback work for clients that are blocked.
        contribute(symbol, interval, rows);
        return rows;
      }
    } catch {
      // Fall through to the next mirror, then to the proxy.
    }
  }

  // Reaching here means the direct mirrors already failed for this call.
  directBlockedUntil = Date.now() + DIRECT_COOLDOWN_MS;

  const proxied = await fetch(
    `/api/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`,
    { signal: AbortSignal.timeout(timeout + 3_000), cache: "no-store" },
  );
  if (!proxied.ok) throw new Error("SIN DATOS");
  const rows = await proxied.json();
  if (!Array.isArray(rows) || !rows.length) throw new Error("SIN DATOS");
  return rows;
}
