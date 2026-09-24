import { tg, TELEGRAM_SCHEMA, webhookSecret } from "./telegram.ts";

/** Shared by the routes: schema, bot username and webhook registration. */
export async function ensureTelegramSchema(db: D1Database) {
  for (const sql of TELEGRAM_SCHEMA) await db.prepare(sql).run();
}

export async function botUsername(db: D1Database, token: string): Promise<string | null> {
  const cachedName = await db.prepare("SELECT value FROM telegram_state WHERE key = 'bot_username'").first<{ value: string }>();
  if (cachedName?.value) return cachedName.value;
  const me = await tg(token, "getMe", {});
  const name = (me.result as { username?: string } | undefined)?.username ?? null;
  if (name) await db.prepare("INSERT OR REPLACE INTO telegram_state (key, value) VALUES ('bot_username', ?1)").bind(name).run();
  return name;
}

/** Points the bot at this deployment. Idempotent: only calls setWebhook when
 *  Telegram has a different URL, so linking never needs a manual setup step. */
export async function ensureWebhook(token: string, origin: string) {
  const url = `${origin}/api/telegram/webhook`;
  const info = await tg(token, "getWebhookInfo", {});
  if ((info.result as { url?: string } | undefined)?.url === url) return true;
  const set = await tg(token, "setWebhook", {
    url,
    secret_token: await webhookSecret(token),
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
  return set.ok;
}
