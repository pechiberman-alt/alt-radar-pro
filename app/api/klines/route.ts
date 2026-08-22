import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Server-side klines proxy.
 *
 * The comparison, correlation and pump panels read candles directly from the
 * browser, which is fast but exposed: Binance rate-limits per client IP and
 * answers a throttled browser with a response that carries no CORS headers, so
 * the panel simply goes dark. Routing the retry through the Worker gives those
 * panels the same fallback the rest of the app already has.
 */

const BASES = [
  "https://data-api.binance.vision",
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api.binance.com",
];

const ALLOWED_INTERVALS = new Set([
  "1m",
  "5m",
  "15m",
  "1h",
  "4h",
  "1d",
]);

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const symbol = (params.get("symbol") ?? "").toUpperCase();
  const interval = params.get("interval") ?? "1h";
  const limit = Number(params.get("limit") ?? 120);

  if (!/^[A-Z0-9]{2,24}USDT$/.test(symbol)) {
    return NextResponse.json({ error: "SÍMBOLO NO VÁLIDO" }, { status: 400 });
  }
  if (!ALLOWED_INTERVALS.has(interval)) {
    return NextResponse.json({ error: "INTERVALO NO VÁLIDO" }, { status: 400 });
  }
  const safeLimit = Math.max(10, Math.min(500, Number.isFinite(limit) ? limit : 120));

  let lastStatus = 0;
  for (const base of BASES) {
    try {
      const response = await fetch(
        `${base}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${safeLimit}`,
        {
          headers: { Accept: "application/json", "User-Agent": "ALT-RADAR-PRO/2.1" },
          signal: AbortSignal.timeout(7_000),
        },
      );
      if (!response.ok) {
        lastStatus = response.status;
        continue;
      }
      const rows = await response.json();
      if (!Array.isArray(rows) || !rows.length) continue;
      return NextResponse.json(rows, {
        headers: { "Cache-Control": "no-store" },
      });
    } catch {
      // Try the next mirror.
    }
  }

  return NextResponse.json(
    { error: "DATA UNAVAILABLE", upstreamStatus: lastStatus || null },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
