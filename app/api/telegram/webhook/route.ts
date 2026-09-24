import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { getSecret } from "@/lib/app-settings";
import { parseCommand, sendMessage, webhookSecret } from "@/lib/telegram";
import { ensureTelegramSchema } from "@/lib/telegram-server";

export const dynamic = "force-dynamic";

const HELP =
  "<b>ALT RADAR PRO · bot de alertas</b>\n" +
  "/estado — resumen del momento\n" +
  "/stop — dejar de recibir alertas\n\n" +
  "Qué recibir se elige en la app: ALERTAS → Telegram.";

/**
 * Messages sent to the bot. Telegram echoes the secret set at setWebhook in a
 * header; without it the request is rejected, so nobody can drive the bot by
 * posting to this URL. Always answers 200 to Telegram so it does not retry.
 */
export async function POST(request: NextRequest) {
  if (!env.DB) return NextResponse.json({ ok: true });
  const token = (await getSecret(env.DB, env, "telegram_bot_token")).value;
  if (!token) return NextResponse.json({ ok: true });
  if (request.headers.get("x-telegram-bot-api-secret-token") !== (await webhookSecret(token))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = (await request.json().catch(() => null)) as { message?: { chat?: { id?: number }; text?: string } } | null;
  const chatId = update?.message?.chat?.id;
  if (!chatId) return NextResponse.json({ ok: true });
  const chat = String(chatId);
  const { cmd, arg } = parseCommand(update?.message?.text);
  await ensureTelegramSchema(env.DB);

  if (cmd === "start" && arg) {
    const code = await env.DB.prepare("SELECT user_id, expires_at FROM telegram_link_codes WHERE code = ?1")
      .bind(arg)
      .first<{ user_id: number; expires_at: number }>();
    if (!code || code.expires_at < Date.now()) {
      await sendMessage(token, chat, "Ese link de vinculación venció o ya se usó. Generá uno nuevo en la app: ALERTAS → Telegram.");
    } else {
      await env.DB.prepare(
        // New links start with the timezone the app reported when the code was
        // made; re-links keep the user's existing preferences.
        `INSERT INTO telegram_links (user_id, chat_id, prefs, linked_at)
         VALUES (?1, ?2, json_object('tzOffsetMin', COALESCE((SELECT CAST(value AS INTEGER) FROM telegram_state WHERE key = 'tz:' || ?1), 180)), ?3)
         ON CONFLICT(user_id) DO UPDATE SET chat_id = ?2, linked_at = ?3`,
      )
        .bind(code.user_id, chat, new Date().toISOString())
        .run();
      await env.DB.prepare("DELETE FROM telegram_link_codes WHERE code = ?1").bind(arg).run();
      await sendMessage(
        token,
        chat,
        "✅ <b>Vinculado a ALT RADAR PRO.</b>\nVas a recibir señales fuertes, recordatorios de DCA, noticias de alto impacto y extremos de Miedo y Avaricia. Lo ajustás en la app: ALERTAS → Telegram.\n\n" + HELP,
      );
    }
  } else if (cmd === "stop") {
    await env.DB.prepare("DELETE FROM telegram_links WHERE chat_id = ?1").bind(chat).run();
    await sendMessage(token, chat, "Listo, no vas a recibir más alertas. Para volver, vinculá de nuevo desde la app.");
  } else if (cmd === "estado") {
    const linked = await env.DB.prepare("SELECT user_id FROM telegram_links WHERE chat_id = ?1").bind(chat).first();
    const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM signal_records WHERE status = 'MONITORING'")
      .first<{ n: number }>()
      .catch(() => null);
    let fg = "";
    try {
      const r = await fetch("https://api.alternative.me/fng/?limit=1&format=json", { signal: AbortSignal.timeout(5000) });
      const d = (await r.json()) as { data?: { value?: string; value_classification?: string }[] };
      if (d.data?.[0]) fg = `Miedo y Avaricia: <b>${d.data[0].value}</b> (${d.data[0].value_classification})\n`;
    } catch {
      // Leave it out.
    }
    await sendMessage(
      token,
      chat,
      `<b>Estado</b>\n${fg}Señales abiertas: <b>${open?.n ?? "—"}</b>\nAlertas: ${linked ? "activas ✅" : "no vinculado — hacelo desde la app"}`,
    );
  } else {
    await sendMessage(token, chat, HELP);
  }
  return NextResponse.json({ ok: true });
}
