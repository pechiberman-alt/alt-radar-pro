import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { getSecret } from "@/lib/app-settings";
import { getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { linkCode, parsePrefs } from "@/lib/telegram";
import { botUsername, ensureTelegramSchema, ensureWebhook } from "@/lib/telegram-server";

export const dynamic = "force-dynamic";

async function context(request: NextRequest) {
  const tokenCookie = getCookie(request, SESSION_COOKIE);
  if (!tokenCookie || !env.DB) return { error: NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 }) };
  const user = await getSessionUser(env.DB, tokenCookie);
  if (!user) return { error: NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 }) };
  const bot = (await getSecret(env.DB, env, "telegram_bot_token")).value;
  if (!bot) return { error: NextResponse.json({ error: "BOT NO CONFIGURADO" }, { status: 503 }) };
  await ensureTelegramSchema(env.DB);
  return { user, bot, db: env.DB };
}

/** Link status and preferences for the signed-in user. */
export async function GET(request: NextRequest) {
  const c = await context(request);
  if ("error" in c) return c.error;
  const row = await c.db.prepare("SELECT prefs FROM telegram_links WHERE user_id = ?1").bind(c.user.id).first<{ prefs: string }>();
  return NextResponse.json(
    { linked: Boolean(row), prefs: parsePrefs(row ? JSON.parse(row.prefs || "{}") : {}), bot: await botUsername(c.db, c.bot) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** One-time link: a code valid 10 minutes, opened as t.me/<bot>?start=<code>. */
export async function POST(request: NextRequest) {
  const c = await context(request);
  if ("error" in c) return c.error;
  const body = (await request.json().catch(() => ({}))) as { tzOffsetMin?: number };
  if (!(await ensureWebhook(c.bot, request.nextUrl.origin))) {
    return NextResponse.json({ error: "NO SE PUDO CONECTAR CON TELEGRAM" }, { status: 502 });
  }
  const bot = await botUsername(c.db, c.bot);
  if (!bot) return NextResponse.json({ error: "TOKEN DE BOT INVÁLIDO" }, { status: 502 });
  const code = linkCode();
  await c.db.prepare("INSERT INTO telegram_link_codes (code, user_id, expires_at) VALUES (?1, ?2, ?3)")
    .bind(code, c.user.id, Date.now() + 10 * 60_000)
    .run();
  // Remember the browser's timezone now, so DCA reminders land in the morning.
  if (Number.isFinite(Number(body.tzOffsetMin))) {
    await c.db.prepare("UPDATE telegram_links SET prefs = json_set(prefs, '$.tzOffsetMin', ?2) WHERE user_id = ?1")
      .bind(c.user.id, Number(body.tzOffsetMin))
      .run();
    await c.db.prepare("INSERT OR REPLACE INTO telegram_state (key, value) VALUES (?1, ?2)")
      .bind(`tz:${c.user.id}`, String(Number(body.tzOffsetMin)))
      .run();
  }
  return NextResponse.json({ url: `https://t.me/${bot}?start=${code}` });
}

/** Save preferences. */
export async function PUT(request: NextRequest) {
  const c = await context(request);
  if ("error" in c) return c.error;
  const prefs = parsePrefs(await request.json().catch(() => ({})));
  const res = await c.db.prepare("UPDATE telegram_links SET prefs = ?2 WHERE user_id = ?1").bind(c.user.id, JSON.stringify(prefs)).run();
  if (!res.meta.changes) return NextResponse.json({ error: "NO VINCULADO" }, { status: 404 });
  return NextResponse.json({ ok: true, prefs });
}

/** Unlink. */
export async function DELETE(request: NextRequest) {
  const c = await context(request);
  if ("error" in c) return c.error;
  await c.db.prepare("DELETE FROM telegram_links WHERE user_id = ?1").bind(c.user.id).run();
  return NextResponse.json({ ok: true });
}
