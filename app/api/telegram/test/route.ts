import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { sendMessage } from "@/lib/telegram";
import { ensureTelegramSchema } from "@/lib/telegram-server";

export const dynamic = "force-dynamic";

/** Sends one message to the signed-in user's linked chat, to prove the path works. */
export async function POST(request: NextRequest) {
  const session = getCookie(request, SESSION_COOKIE);
  if (!session || !env.DB) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });
  const user = await getSessionUser(env.DB, session);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });
  if (!env.TELEGRAM_BOT_TOKEN) return NextResponse.json({ error: "BOT NO CONFIGURADO" }, { status: 503 });
  await ensureTelegramSchema(env.DB);
  const link = await env.DB.prepare("SELECT chat_id FROM telegram_links WHERE user_id = ?1").bind(user.id).first<{ chat_id: string }>();
  if (!link) return NextResponse.json({ error: "NO VINCULADO" }, { status: 404 });
  const r = await sendMessage(env.TELEGRAM_BOT_TOKEN, link.chat_id, "🔔 <b>Prueba de ALT RADAR PRO.</b>\nSi ves esto, las alertas por Telegram funcionan.");
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.description ?? "NO SE PUDO ENVIAR" }, { status: 502 });
}
