import { NextRequest, NextResponse } from "next/server";
import { cached } from "@/lib/upstream-cache";

export const dynamic = "force-dynamic";

/**
 * Rolling-window proxy.
 *
 * The 1H / 4H columns and every multi-timeframe confirmation depend on
 * Binance's rolling ticker. The browser fetched it directly with no fallback,
 * so a rate-limited client silently lost all timeframe coverage — scores then
 * collapsed below the signal thresholds and the dashboard looked empty for a
 * data reason, not a market reason. This gives that request the same Worker
 * fallback the rest of the app has.
 */

const BASES = [
  "https://data-api.binance.vision",
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api.binance.com",
];

const ALLOWED_WINDOWS = new Set(["5m", "15m", "1h", "4h"]);
const MAX_SYMBOLS = 60;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const windowSize = params.get("windowSize") ?? "1h";
  const rawSymbols = params.get("symbols") ?? "";

  if (!ALLOWED_WINDOWS.has(windowSize)) {
    return NextResponse.json({ error: "VENTANA NO VÁLIDA" }, { status: 400 });
  }

  const symbols = rawSymbols
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => /^[A-Z0-9]{2,24}USDT$/.test(symbol))
    .slice(0, MAX_SYMBOLS);

  if (!symbols.length) {
    return NextResponse.json({ error: "SIN SÍMBOLOS VÁLIDOS" }, { status: 400 });
  }

  // Keyed on the exact symbol set so different chunks stay independent.
  const key = `rolling:${windowSize}:${symbols.join(",")}`;

  const { value, state, ageMs } = await cached<
    { symbol?: string; priceChangePercent?: string }[]
  >(key, 30_000, async () => {
    for (const base of BASES) {
      try {
        const url = new URL(`${base}/api/v3/ticker`);
        url.searchParams.set("symbols", JSON.stringify(symbols));
        url.searchParams.set("windowSize", windowSize);
        const response = await fetch(url, {
          headers: { Accept: "application/json", "User-Agent": "ALT-RADAR-PRO/2.1" },
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) continue;
        const rows = (await response.json()) as {
          symbol?: string;
          priceChangePercent?: string;
        }[];
        if (Array.isArray(rows) && rows.length) {
          return rows.map((row) => ({
            symbol: row.symbol,
            priceChangePercent: row.priceChangePercent,
          }));
        }
      } catch {
        // Try the next mirror.
      }
    }
    return null;
  });

  if (value) {
    return NextResponse.json(value, {
      headers: {
        "Cache-Control": "no-store",
        "X-Cache": state,
        "X-Cache-Age": String(Math.round(ageMs / 1000)),
      },
    });
  }

  return NextResponse.json(
    { error: "SIN DATOS" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
