import { NextResponse } from "next/server";
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
let cached: { payload: MarketStructure; at: number } | null = null;

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
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.payload, {
      headers: { "Cache-Control": "no-store", "X-Cache": "HIT" },
    });
  }

  // CoinGecko first: it is the only free source that breaks out stablecoin
  // dominance. CoinLore covers total and BTC/ETH dominance if that fails.
  const payload = (await loadCoinGecko()) ?? (await loadCoinLore());

  if (!payload) {
    // Serve a stale reading rather than nothing — labelled, so the interface
    // can show its age instead of implying it is live.
    if (cached) {
      return NextResponse.json(cached.payload, {
        headers: { "Cache-Control": "no-store", "X-Cache": "STALE" },
      });
    }
    return NextResponse.json(
      { error: "DATA UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  cached = { payload, at: now };
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store", "X-Cache": "MISS" },
  });
}
