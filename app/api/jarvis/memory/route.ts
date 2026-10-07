import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { addMemory, forgetMemory, listMemory } from "@/lib/jarvis-memory";

export const dynamic = "force-dynamic";

/**
 * JARVIS's memory of each person: what they asked it to remember. Private to
 * the signed-in user; every AI answer receives it (app/api/analyst/ai).
 */
async function who(request: NextRequest) {
  const session = getCookie(request, SESSION_COOKIE);
  return session && env.DB ? getSessionUser(env.DB, session) : null;
}

export async function GET(request: NextRequest) {
  const user = await who(request);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });
  return NextResponse.json({ notes: await listMemory(env.DB, user.id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const user = await who(request);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text : "";
  return NextResponse.json(await addMemory(env.DB, user.id, text));
}

export async function DELETE(request: NextRequest) {
  const user = await who(request);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { query?: unknown } | null;
  const gone = await forgetMemory(env.DB, user.id, typeof body?.query === "string" ? body.query : "");
  return NextResponse.json({ removed: gone.map((n) => n.text) });
}
