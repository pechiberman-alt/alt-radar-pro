import { NextRequest, NextResponse } from "next/server";
import { env } from "cloudflare:workers";
import { loadStructureTrend } from "@/lib/structure-archive";
import { sharedJson } from "@/lib/shared-cache";

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

    // La misma lectura para todos durante 2 minutos, en pocas ventanas: cada pedido leía hasta 500 filas de D1.
    const ventana = [6, 24, 72, 168, 720].find((h) => h >= hours) ?? 720;
    const db = env.DB;
    const trend = await sharedJson(`structure-trend-v1:${ventana}`, 120, () => loadStructureTrend(db, ventana));
    return NextResponse.json(
      { ...trend, hours: ventana },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "SIN DATOS" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
