import { NextResponse } from "next/server";
import { cached } from "@/lib/upstream-cache";

export const dynamic = "force-dynamic";

/**
 * Proxy for DefiLlama's emissions data.
 *
 * Two reasons this goes through the Worker instead of the browser, unlike the
 * heatmap's candles:
 *
 * 1. CORS. Binance sends permissive headers so a page can call it directly;
 *    DefiLlama does not do so consistently, and the browser blocks the read
 *    before any of our code sees it. The exchange-reserves panel already
 *    reaches this host server-side and works, which is the evidence that the
 *    Worker's own address is not the problem here.
 * 2. Endpoint uncertainty. Public documentation disagrees about which
 *    emissions path is free — one source lists token unlocks as a paid-tier
 *    dataset, another ships a tool that reads ~326 projects with no key. So
 *    rather than guess once, this tries the known candidates in order and
 *    reports which one answered, so the panel can say something true instead
 *    of failing silently.
 */
const CANDIDATES = [
  "https://api.llama.fi/emissions",
  "https://api.llama.fi/emissionsBreakdown",
];

const CACHE_TTL_MS = 30 * 60_000;
const STALE_WINDOW_MS = 12 * 60 * 60_000;

type Payload = { rows: unknown[]; endpoint: string };

async function loadEmissions(): Promise<Payload | null> {
  for (const endpoint of CANDIDATES) {
    try {
      const response = await fetch(endpoint, {
        headers: { Accept: "application/json", "User-Agent": "ALT-RADAR-PRO/2.1" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) continue;
      const body = await response.json();
      // Both shapes seen in the wild: a bare array, or an object wrapping one.
      const rows = Array.isArray(body)
        ? body
        : Array.isArray((body as { protocols?: unknown })?.protocols)
          ? (body as { protocols: unknown[] }).protocols
          : null;
      if (rows && rows.length) return { rows, endpoint };
    } catch {
      // Next candidate.
    }
  }
  return null;
}

export async function GET() {
  const { value, state, ageMs } = await cached<Payload>(
    "token-unlocks",
    CACHE_TTL_MS,
    loadEmissions,
    STALE_WINDOW_MS,
  );

  if (!value) {
    return NextResponse.json(
      { error: "CALENDARIO NO DISPONIBLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(value.rows, {
    headers: {
      "Cache-Control": "no-store",
      "X-Cache": state,
      "X-Cache-Age": String(Math.round(ageMs / 1000)),
      // Surfaced so a failure can be diagnosed from the response itself
      // rather than by guessing which upstream answered.
      "X-Upstream": value.endpoint,
    },
  });
}
