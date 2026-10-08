import { env, waitUntil } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { getSecret } from "@/lib/app-settings";
import { getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { createPriceAlert } from "@/lib/price-alerts-server";
import { sendMessage } from "@/lib/telegram";
import { ensureTelegramSchema } from "@/lib/telegram-server";

export const dynamic = "force-dynamic";

/**
 * «Avisame por Telegram si rompe / pierde X», pedido desde JARVIS TRADING o
 * el chat de JARVIS. Es una alerta de precio de Telegram como las de /alerta:
 * la revisa el servidor cada 5 minutos, con la app cerrada. Solo para la
 * cuenta con sesión y con Telegram vinculado.
 */
async function who(request: NextRequest) {
  const session = getCookie(request, SESSION_COOKIE);
  return session && env.DB ? getSessionUser(env.DB, session) : null;
}

export async function POST(request: NextRequest) {
  const user = await who(request);
  if (!user) return NextResponse.json({ error: "Iniciá sesión para crear alertas de Telegram." }, { status: 401 });
  try {
    const body = (await request.json().catch(() => null)) as { symbol?: unknown; target?: unknown; reference?: unknown } | null;
    if (typeof body?.symbol !== "string" || typeof body.target !== "number") return NextResponse.json({ error: "Falta la moneda o el nivel." }, { status: 400 });
    await ensureTelegramSchema(env.DB);
    const link = await env.DB.prepare("SELECT chat_id FROM telegram_links WHERE user_id = ?1").bind(user.id).first<{ chat_id: string }>();
    if (!link) return NextResponse.json({ error: "Primero vinculá Telegram: ALERTAS → VINCULAR TELEGRAM.", needsLink: true }, { status: 409 });
    const r = await createPriceAlert(env.DB, user.id, body.symbol, body.target, typeof body.reference === "number" ? body.reference : null);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    // The same confirmation /alerta gives, in the chat where it will fire.
    const token = (await getSecret(env.DB, env, "telegram_bot_token")).value;
    if (token) waitUntil(sendMessage(token, link.chat_id, r.message).catch(() => undefined));
    return NextResponse.json({ alert: r.alert, price: r.price, text: r.message });
  } catch {
    return NextResponse.json({ error: "No se pudo crear la alerta." }, { status: 500 });
  }
}
