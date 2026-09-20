import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { PUSH_SCHEMA } from "@/lib/web-push";

export const dynamic = "force-dynamic";

/**
 * Stores a browser's push subscription.
 *
 * The endpoint is the primary key, so a browser re-subscribing replaces its
 * own row rather than accumulating duplicates that would each deliver the
 * same notification.
 */
export async function POST(request: NextRequest) {
  if (!env.DB) {
    return NextResponse.json({ error: "ALMACENAMIENTO NO DISPONIBLE" }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  } | null;

  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : null;
  const p256dh = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh : null;
  const auth = typeof body?.keys?.auth === "string" ? body.keys.auth : null;

  // A subscription missing any part cannot receive anything, so storing it
  // would only produce failed sends later.
  if (!endpoint || !p256dh || !auth || !endpoint.startsWith("https://")) {
    return NextResponse.json({ error: "SUSCRIPCIÓN NO VÁLIDA" }, { status: 400 });
  }

  try {
    await env.DB.prepare(PUSH_SCHEMA).run();
    await env.DB.prepare(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh = ?2, auth = ?3`,
    )
      .bind(endpoint, p256dh, auth, new Date().toISOString())
      .run();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[ALT_RADAR_PUSH_SUBSCRIBE]", error);
    return NextResponse.json({ error: "NO SE PUDO GUARDAR" }, { status: 500 });
  }
}

/** Unsubscribing must actually remove the row, or the device keeps getting
 *  notifications it asked to stop receiving. */
export async function DELETE(request: NextRequest) {
  if (!env.DB) return NextResponse.json({ ok: true });
  const endpoint = request.nextUrl.searchParams.get("endpoint");
  if (!endpoint) return NextResponse.json({ error: "FALTA ENDPOINT" }, { status: 400 });
  try {
    await env.DB.prepare(PUSH_SCHEMA).run();
    await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?1").bind(endpoint).run();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "NO SE PUDO BORRAR" }, { status: 500 });
  }
}
