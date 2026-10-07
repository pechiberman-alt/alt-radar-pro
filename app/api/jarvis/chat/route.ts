import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { clearThread, readThread, saveTurns } from "@/lib/jarvis-chat";

export const dynamic = "force-dynamic";

/**
 * The conversation with JARVIS in the app, so a reload keeps the thread
 * (lib/jarvis-chat.ts). Private to the signed-in user. Read when the panel
 * opens, written after each turn, cleared by "Nueva charla". Nothing polls it.
 */
async function who(request: NextRequest) {
  const session = getCookie(request, SESSION_COOKIE);
  return session && env.DB ? getSessionUser(env.DB, session) : null;
}

export async function GET(request: NextRequest) {
  const user = await who(request);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });
  return NextResponse.json({ turns: await readThread(env.DB, user.id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const user = await who(request);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { turns?: unknown } | null;
  return NextResponse.json({ saved: await saveTurns(env.DB, user.id, body?.turns) });
}

export async function DELETE(request: NextRequest) {
  const user = await who(request);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });
  await clearThread(env.DB, user.id);
  return NextResponse.json({ ok: true });
}
