import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { coreSnapshot } from "@/lib/jarvis-core-db";
import { sharedJson } from "@/lib/shared-cache";

export const dynamic = "force-dynamic";

/**
 * JARVIS CORE status for the app: heartbeat, open signals, latest results and
 * the running record. The same for everyone, so it is served from a shared
 * 60-second cache: open tabs never multiply the database reads (~45 rows per
 * refresh).
 */
export async function GET() {
  if (!env.DB) return NextResponse.json({ error: "SIN BASE" }, { status: 503 });
  try {
    const snap = await sharedJson("jarvis-core-v1", 60, () => coreSnapshot(env.DB, Date.now()));
    return NextResponse.json(snap, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "NÚCLEO NO DISPONIBLE" }, { status: 503 });
  }
}
