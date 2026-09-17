import { NextResponse } from "next/server";
import { cached } from "@/lib/upstream-cache";
import { loadExchangeFlows, type ExchangeFlows } from "@/lib/exchange-reserves";

export const dynamic = "force-dynamic";

/** DefiLlama recomputes exchange assets hourly; polling faster returns the same
 *  numbers and spends someone else's free tier for nothing. */
const CACHE_TTL_MS = 15 * 60_000;
const STALE_WINDOW_MS = 4 * 60 * 60_000;

export async function GET() {
  const { value, state, ageMs } = await cached<ExchangeFlows>(
    "exchange-flows",
    CACHE_TTL_MS,
    () => loadExchangeFlows(),
    STALE_WINDOW_MS,
  );

  if (!value) {
    return NextResponse.json(
      { error: "RESERVAS DE EXCHANGE NO DISPONIBLES" },
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
