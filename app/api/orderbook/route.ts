import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const krakenPairs: Record<string, string> = {
  BTCUSDT: "XBTUSD",
  ETHUSDT: "ETHUSD",
  SOLUSDT: "SOLUSD",
  XRPUSDT: "XRPUSD",
  ADAUSDT: "ADAUSD",
  DOGEUSDT: "DOGEUSD",
  AVAXUSDT: "AVAXUSD",
  LINKUSDT: "LINKUSD",
  DOTUSDT: "DOTUSD",
  LTCUSDT: "LTCUSD",
  UNIUSDT: "UNIUSD",
  ATOMUSDT: "ATOMUSD",
};

type DepthPayload = {
  bids?: (string | number)[][];
  asks?: (string | number)[][];
  b?: (string | number)[][];
  a?: (string | number)[][];
};

function responseFor(
  symbol: string,
  venue: "spot" | "futures",
  source: string,
  payload: DepthPayload,
  limit: number,
) {
  const bids = (payload.bids ?? payload.b ?? []).slice(0, limit).map((level) => [String(level[0]), String(level[1])]);
  const asks = (payload.asks ?? payload.a ?? []).slice(0, limit).map((level) => [String(level[0]), String(level[1])]);
  if (bids.length < 5 || asks.length < 5) return null;
  return NextResponse.json(
    { symbol, venue, source, timestamp: new Date().toISOString(), bids, asks },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: NextRequest) {
  const symbol = (request.nextUrl.searchParams.get("symbol") ?? "BTCUSDT").toUpperCase();
  const venue = request.nextUrl.searchParams.get("venue") === "futures" ? "futures" : "spot";
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? 100);
  const limit = requestedLimit >= 100 ? 100 : requestedLimit >= 50 ? 50 : 20;
  if (!/^[A-Z0-9]{2,24}USDT$/.test(symbol)) {
    return NextResponse.json({ error: "Activo no permitido" }, { status: 400 });
  }

  const binanceEndpoints = venue === "futures"
    ? [
        { url: "https://fapi.binance.com/fapi/v1/depth", source: "Binance Futures REST", upstreamVenue: "futures" as const },
        { url: "https://data-api.binance.vision/api/v3/depth", source: "Binance Spot REST · respaldo de profundidad", upstreamVenue: "spot" as const },
      ]
    : [
        { url: "https://data-api.binance.vision/api/v3/depth", source: "Binance Data API", upstreamVenue: "spot" as const },
        { url: "https://api.binance.com/api/v3/depth", source: "Binance Spot", upstreamVenue: "spot" as const },
      ];
  for (const endpoint of binanceEndpoints) {
    try {
      const response = await fetch(`${endpoint.url}?symbol=${symbol}&limit=${limit}`, {
        headers: { Accept: "application/json", "User-Agent": "ALT-RADAR-PRO/1.0" },
        signal: AbortSignal.timeout(3_500),
        next: { revalidate: 2 },
      });
      if (response.ok) {
        const source = endpoint.upstreamVenue === venue
          ? endpoint.source
          : `${endpoint.source} · no es libro Futures`;
        const result = responseFor(symbol, venue, source, await response.json() as DepthPayload, limit);
        if (result) return result;
      }
    } catch {
      // Try the next public provider. The UI displays unavailable if all fail.
    }
  }

  const pair = krakenPairs[symbol];
  if (pair) {
    try {
      const response = await fetch(`https://api.kraken.com/0/public/Depth?pair=${pair}&count=${limit}`, {
        headers: { Accept: "application/json", "User-Agent": "ALT-RADAR-PRO/1.0" },
        signal: AbortSignal.timeout(4_500),
        next: { revalidate: 2 },
      });
      if (response.ok) {
        const payload = await response.json() as { result?: Record<string, DepthPayload> };
        const book = Object.values(payload.result ?? {})[0];
        if (book) {
          const source = venue === "spot"
            ? "Kraken Order Book"
            : "Kraken Spot Order Book · respaldo · no es libro Futures";
          const result = responseFor(symbol, venue, source, book, limit);
          if (result) return result;
        }
      }
    } catch {
      // Explicit unavailable response below.
    }
  }

  return NextResponse.json(
    {
      symbol,
      venue,
      source: null,
      timestamp: new Date().toISOString(),
      bids: [],
      asks: [],
      error: "Libro de órdenes no disponible para este activo",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
