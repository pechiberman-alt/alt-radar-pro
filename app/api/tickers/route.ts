import { NextResponse } from "next/server";
import { cached } from "@/lib/upstream-cache";

export const dynamic = "force-dynamic";

/**
 * Full USDT universe, proxied and cached.
 *
 * The browser loads the 24h ticker straight from Binance. When that is refused
 * the only server-side source was /api/radar, which serves a small fixed watch
 * list — so a throttled client dropped from ~640 pairs to a couple of dozen.
 * That is not degradation, it is a different application. This endpoint keeps
 * the whole universe available through the Worker.
 */

const BASES = [
  "https://data-api.binance.vision",
  "https://api-gcp.binance.com",
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api.binance.com",
];

const STABLE_BASES = new Set([
  "USDC", "FDUSD", "TUSD", "USDP", "DAI", "BUSD",
  "USD1", "EUR", "AEUR", "EURI", "TRY", "BRL",
]);

type BinanceTicker = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  volume: string;
  quoteVolume: string;
  highPrice: string;
  lowPrice: string;
  bidPrice?: string;
  askPrice?: string;
};

type TickerRow = {
  symbol: string;
  price: number;
  change24h: number;
  volume: number;
  quoteVolume: number;
  high: number;
  low: number;
  bidPrice: number | null;
  askPrice: number | null;
};

export function normalizeTickers(rows: BinanceTicker[]): TickerRow[] {
  return rows
    .filter((row) => row.symbol?.endsWith("USDT"))
    .filter((row) => {
      const base = row.symbol.slice(0, -4);
      return (
        !STABLE_BASES.has(base) &&
        !/(UP|DOWN|BULL|BEAR)$/.test(base) &&
        Number(row.lastPrice) > 0
      );
    })
    .map((row) => {
      const bid = Number(row.bidPrice);
      const ask = Number(row.askPrice);
      return {
        symbol: row.symbol,
        price: Number(row.lastPrice),
        change24h: Number(row.priceChangePercent),
        volume: Number(row.volume),
        quoteVolume: Number(row.quoteVolume),
        high: Number(row.highPrice),
        low: Number(row.lowPrice),
        bidPrice: Number.isFinite(bid) && bid > 0 ? bid : null,
        askPrice: Number.isFinite(ask) && ask > 0 ? ask : null,
      };
    })
    .sort((left, right) => right.quoteVolume - left.quoteVolume);
}

export async function GET() {
  const { value, state, ageMs } = await cached<TickerRow[]>(
    "tickers:usdt",
    20_000,
    async () => {
      for (const base of BASES) {
        try {
          const response = await fetch(`${base}/api/v3/ticker/24hr`, {
            headers: { Accept: "application/json", "User-Agent": "ALT-RADAR-PRO/2.1" },
            signal: AbortSignal.timeout(9_000),
          });
          if (!response.ok) continue;
          const rows = (await response.json()) as BinanceTicker[];
          if (!Array.isArray(rows) || !rows.length) continue;
          const normalized = normalizeTickers(rows);
          if (normalized.length) return normalized;
        } catch {
          // Try the next mirror.
        }
      }
      return null;
    },
    // A few minutes old still beats collapsing to a two-dozen-pair watch list.
    5 * 60_000,
  );

  if (!value) {
    return NextResponse.json(
      { error: "DATA UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { market: value, source: "Binance Spot · proxy Worker", count: value.length },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Cache": state,
        "X-Cache-Age": String(Math.round(ageMs / 1000)),
      },
    },
  );
}
