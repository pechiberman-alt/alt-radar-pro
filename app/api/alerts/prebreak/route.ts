import { env } from "cloudflare:workers";
import { getSecret } from "@/lib/app-settings";
import { ensureAuthSchema, getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { preBreakText, validatePreBreakAlert } from "@/lib/pre-breakout";
import { parsePrefs, sendMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/**
 * Relays an A PUNTO DE ROMPER alert found by the browser to the user's
 * Telegram, at most once per coin, timeframe, direction and level per day.
 * The key goes into telegram_sent first, so two open tabs can't both send it;
 * if Telegram fails the key is removed, so the next scan retries.
 */
export async function POST(request: Request) {
  if (!env.DB) return Response.json({ error: "Base no disponible." }, { status: 503 });
  try {
    await ensureAuthSchema(env.DB);
    const token = getCookie(request, SESSION_COOKIE);
    const user = token ? await getSessionUser(env.DB, token) : null;
    if (!user) return Response.json({ error: "Iniciá sesión." }, { status: 401 });
    const alert = validatePreBreakAlert(await request.json().catch(() => null));
    if (!alert) return Response.json({ error: "Alerta inválida." }, { status: 400 });

    const link = await env.DB.prepare("SELECT chat_id, prefs FROM telegram_links WHERE user_id = ?1").bind(user.id).first<{ chat_id: string; prefs: string }>();
    if (!link) return Response.json({ sent: false, reason: "Telegram no vinculado" });
    let prefsRaw: unknown = {};
    try {
      prefsRaw = JSON.parse(link.prefs || "{}");
    } catch {
      prefsRaw = {};
    }
    if (!parsePrefs(prefsRaw).categories.ROMPE) return Response.json({ sent: false, reason: "Alertas de ruptura apagadas en Telegram" });

    const day = new Date().toISOString().slice(0, 10);
    const key = `pre:${alert.symbol}:${alert.timeframe}:${alert.side}:${alert.level === null ? "x" : alert.level.toPrecision(5)}:${day}`;
    const claimed = await env.DB.prepare("INSERT OR IGNORE INTO telegram_sent (key, sent_at) VALUES (?1, ?2)").bind(key, Date.now()).run();
    if (!claimed.meta.changes) return Response.json({ sent: false, reason: "ya enviada" });

    const bot = (await getSecret(env.DB, env, "telegram_bot_token")).value;
    const result = bot ? await sendMessage(bot, link.chat_id, preBreakText(alert)) : { ok: false, description: "bot sin token" };
    if (!result.ok) {
      await env.DB.prepare("DELETE FROM telegram_sent WHERE key = ?1").bind(key).run();
      return Response.json({ sent: false, reason: result.description ?? "Telegram no respondió" });
    }
    return Response.json({ sent: true });
  } catch (error) {
    console.error("[ALT_RADAR_PREBREAK]", error);
    return Response.json({ error: "No se pudo enviar." }, { status: 500 });
  }
}
