import { NextResponse } from "next/server";
import { cached } from "@/lib/upstream-cache";
import {
  buildAssetFlow,
  buildComparison,
  parseFarsideTable,
  type AssetFlow,
  type FlowComparison,
} from "@/lib/etf-flows-multi";

export const dynamic = "force-dynamic";

/** One page per asset. Server-side because this is HTML from a host that
 *  sends no CORS headers — a browser could not read it at all. */
const PAGES: { asset: AssetFlow["asset"]; url: string }[] = [
  { asset: "BTC", url: "https://farside.co.uk/btc/" },
  { asset: "ETH", url: "https://farside.co.uk/eth/" },
  { asset: "SOL", url: "https://farside.co.uk/sol/" },
  { asset: "XRP", url: "https://farside.co.uk/xrp/" },
];

/** Issuers report once per session, so this changes at most daily. */
const CACHE_TTL_MS = 30 * 60_000;
const STALE_WINDOW_MS = 24 * 60 * 60_000;

async function loadAsset(page: (typeof PAGES)[number]): Promise<AssetFlow | null> {
  try {
    const response = await fetch(page.url, {
      headers: {
        // Farside serves a different page to clients it does not recognise.
        "User-Agent":
          "Mozilla/5.0 (compatible; ALT-RADAR-PRO/2.1; +https://alt-radar-pro.pechiberman.workers.dev)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    return buildAssetFlow(page.asset, parseFarsideTable(await response.text()));
  } catch {
    // One asset failing must not take the others down: the comparison is
    // still worth showing with three of four, and the panel says which it has.
    return null;
  }
}

async function loadComparison(): Promise<FlowComparison | null> {
  const flows = await Promise.all(PAGES.map(loadAsset));
  return buildComparison(flows);
}

export async function GET() {
  const { value, state, ageMs } = await cached<FlowComparison>(
    "etf-flows-multi",
    CACHE_TTL_MS,
    loadComparison,
    STALE_WINDOW_MS,
  );

  if (!value) {
    return NextResponse.json(
      { error: "FLUJOS POR ACTIVO NO DISPONIBLES" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(value, {
    headers: {
      "Cache-Control": "no-store",
      "X-Cache": state,
      "X-Cache-Age": String(Math.round(ageMs / 1000)),
      "X-Assets": value.assets.map((a) => a.asset).join(","),
    },
  });
}
