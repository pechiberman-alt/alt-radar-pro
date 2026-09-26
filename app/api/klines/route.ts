import { NextRequest, NextResponse } from "next/server";
import { cached, offerCached } from "@/lib/upstream-cache";

/** How long a client-supplied series is treated as fresh enough to keep. */
const CONTRIBUTION_TTL_MS = 45_000;

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

/**
 * Accepts candles a browser fetched successfully and stores them for clients
 * that cannot.
 *
 * Binance blocks datacenter addresses on this endpoint, so the Worker's own
 * fetch returns 403 and the fallback it was built to provide never works —
 * precisely when a throttled user needs it. Visitors on ordinary connections
 * are not blocked, so one of them can supply the reading for the rest.
 *
 * The payload is validated to the same shape the upstream returns and is only
 * accepted when nothing fresher is already cached, so a client cannot overwrite
 * good data or inject a fabricated series.
 */
export async function POST(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const symbol = (params.get("symbol") ?? "").toUpperCase();
  const interval = params.get("interval") ?? "1h";

  if (!/^[A-Z0-9]{2,24}USDT$/.test(symbol) || !ALLOWED_INTERVALS.has(interval)) {
    return NextResponse.json({ error: "PARÁMETROS NO VÁLIDOS" }, { status: 400 });
  }

  let rows: unknown;
  try {
    rows = await request.json();
  } catch {
    return NextResponse.json({ error: "CUERPO NO VÁLIDO" }, { status: 400 });
  }

  if (!isKlineSeries(rows)) {
    return NextResponse.json({ error: "SERIE NO VÁLIDA" }, { status: 400 });
  }

  const limit = rows.length;
  const key = `klines:${symbol}:${interval}:${limit}`;
  const accepted = offerCached(key, rows, CONTRIBUTION_TTL_MS);

  return NextResponse.json(
    { stored: accepted, velas: limit },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Shape check against what Binance actually returns: an array of arrays whose
 * first element is a timestamp and whose next four are numeric strings.
 */
function isKlineSeries(rows: unknown): rows is unknown[] {
  if (!Array.isArray(rows) || rows.length < 5 || rows.length > 500) return false;
  return rows.every((row) => {
    if (!Array.isArray(row) || row.length < 6) return false;
    const openTime = Number(row[0]);
    if (!Number.isFinite(openTime) || openTime <= 0) return false;
    return [1, 2, 3, 4].every((index) => {
      const value = Number(row[index]);
      return Number.isFinite(value) && value > 0;
    });
  });
}

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

  // Candles only change when one closes, so a short shared TTL keeps every
  // open tab on one upstream call instead of each spending the rate limit.
  const ttl = interval === "1m" ? 15_000 : interval === "5m" ? 30_000 : 60_000;

  const { value, state, ageMs } = await cached<unknown[]>(
    `klines:${symbol}:${interval}:${safeLimit}`,
    ttl,
    async () => {
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
          if (Array.isArray(rows) && rows.length) return rows;
        } catch {
          // Try the next mirror.
        }
      }
      return null;
    },
  );

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
    { error: "SIN DATOS", upstreamStatus: lastStatus || null },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
