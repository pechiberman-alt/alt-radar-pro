import { NextResponse } from "next/server";
import { cached } from "@/lib/upstream-cache";
import {
  parseCoinGeckoGlobal,
  parseCoinLoreGlobal,
  type MarketStructure,
} from "@/lib/market-structure";

export const dynamic = "force-dynamic";

/**
 * Served from the Worker rather than the browser: CoinGecko's free tier is
 * rate limited per IP, and global capitalisation moves slowly enough that one
 * shared reading per minute is more current than the data itself.
 */
const CACHE_TTL_MS = 60_000;
/** Global capitalisation stays informative for a while; 15 minutes stale beats blank. */
const STALE_WINDOW_MS = 15 * 60_000;

async function loadCoinGecko(): Promise<MarketStructure | null> {
  try {
    const response = await fetch("https://api.coingecko.com/api/v3/global", {
      headers: { Accept: "application/json", "User-Agent": "ALT-RADAR-PRO/2.1" },
      signal: AbortSignal.timeout(7_000),
    });
    if (!response.ok) return null;
    return parseCoinGeckoGlobal(await response.json());
  } catch {
    return null;
  }
}

async function loadCoinLore(): Promise<MarketStructure | null> {
  try {
    const response = await fetch("https://api.coinlore.net/api/global/", {
      headers: { Accept: "application/json", "User-Agent": "ALT-RADAR-PRO/2.1" },
      signal: AbortSignal.timeout(7_000),
    });
    if (!response.ok) return null;
    return parseCoinLoreGlobal(await response.json());
  } catch {
    return null;
  }
}

export async function GET() {
  const { value, state, ageMs } = await cached<MarketStructure>(
    "market-structure",
    CACHE_TTL_MS,
    // CoinGecko first: it is the only free source that breaks out stablecoin
    // dominance. CoinLore covers total and BTC/ETH dominance if that fails.
    async () => (await loadCoinGecko()) ?? (await loadCoinLore()),
    STALE_WINDOW_MS,
  );

  if (!value) {
    return NextResponse.json(
      { error: "DATA UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(value, {
    headers: {
      "Cache-Control": "no-store",
      "X-Cache": state,
      "X-Cache-Age": String(Math.round(ageMs / 1000)),
    },
  });
}
