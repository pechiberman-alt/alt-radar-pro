import { NextRequest, NextResponse } from "next/server";
import { env } from "cloudflare:workers";
import { loadStructureTrend } from "@/lib/structure-archive";

export const dynamic = "force-dynamic";

/**
 * Dominance over time.
 *
 * Free sources publish only the current value, so USDT.D and BTC.D could be
 * read but never trended. The scheduled job has been recording snapshots for a
 * while; this exposes them so the interface and the assistant can answer
 * "is it rising?" rather than only "what is it now".
 */
export async function GET(request: NextRequest) {
  const hours = Math.max(
    1,
    Math.min(720, Number(request.nextUrl.searchParams.get("hours") ?? 24)),
  );

  try {
    if (!env.DB) {
      return NextResponse.json(
        { error: "SIN DATOS", reason: "sin base de datos" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    const trend = await loadStructureTrend(env.DB, hours);
    return NextResponse.json(
      { ...trend, hours },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "SIN DATOS" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
