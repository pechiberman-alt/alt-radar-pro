import { NextResponse } from "next/server";
import { cached } from "@/lib/upstream-cache";
import {
  loadInstitutionalFlows,
  type InstitutionalFlows,
} from "@/lib/institutional-flows";

export const dynamic = "force-dynamic";

/**
 * Issuers report once per session, so the underlying figure changes at most
 * daily. A short cache here is about sparing the upstream and the Worker, not
 * about freshness: refetching every minute would return the same numbers.
 */
const CACHE_TTL_MS = 30 * 60_000;
/** Yesterday's regime is still yesterday's regime; blank would be worse. */
const STALE_WINDOW_MS = 12 * 60 * 60_000;

export async function GET() {
  const { value, state, ageMs } = await cached<InstitutionalFlows>(
    "institutional-flows",
    CACHE_TTL_MS,
    () => loadInstitutionalFlows(),
    STALE_WINDOW_MS,
  );

  if (!value) {
    return NextResponse.json(
      { error: "FLUJO INSTITUCIONAL NO DISPONIBLE" },
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
