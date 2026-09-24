import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import {
  adminUserId,
  claimAdmin,
  deleteSecret,
  encryptionStrength,
  getSecret,
  hasClaimCode,
  setSecret,
  type SecretName,
} from "@/lib/app-settings";
import { getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { tg } from "@/lib/telegram";
import { ensureTelegramSchema, ensureWebhook } from "@/lib/telegram-server";

export const dynamic = "force-dynamic";

async function who(request: NextRequest) {
  const session = getCookie(request, SESSION_COOKIE);
  if (!session || !env.DB) return null;
  return getSessionUser(env.DB, session);
}

/** Status only — stored values are never returned, not even masked. */
export async function GET(request: NextRequest) {
  const user = await who(request);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });
  const admin = await adminUserId(env.DB);
  const [telegram, ai] = await Promise.all([
    getSecret(env.DB, env, "telegram_bot_token"),
    getSecret(env.DB, env, "anthropic_api_key"),
  ]);
  return NextResponse.json(
    {
      isAdmin: admin === user.id,
      adminExists: admin !== null,
      canClaim: admin === null && (await hasClaimCode(env.DB)),
      telegram: { configured: Boolean(telegram.value), source: telegram.source },
      ai: { configured: Boolean(ai.value), source: ai.source },
      encryption: encryptionStrength(env),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Claim admin with the one-time code. */
export async function POST(request: NextRequest) {
  const user = await who(request);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });
  const { code } = ((await request.json().catch(() => ({}))) ?? {}) as { code?: string };
  const result = await claimAdmin(env.DB, user.id, String(code ?? ""));
  if (result === "ok") return NextResponse.json({ ok: true });
  return NextResponse.json({ error: result === "taken" ? "YA HAY ADMINISTRADOR" : "CÓDIGO INCORRECTO" }, { status: 403 });
}

/** Save secrets, each validated against its service before it is stored. */
export async function PUT(request: NextRequest) {
  const user = await who(request);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });
  if ((await adminUserId(env.DB)) !== user.id) return NextResponse.json({ error: "SÓLO ADMINISTRADOR" }, { status: 403 });
  const body = ((await request.json().catch(() => ({}))) ?? {}) as { telegramToken?: string; anthropicKey?: string };
  const results: Record<string, string> = {};

  const telegramToken = body.telegramToken?.trim();
  if (telegramToken) {
    const me = await tg(telegramToken, "getMe", {}).catch(() => ({ ok: false }) as { ok: boolean; result?: unknown });
    const username = (me.result as { username?: string } | undefined)?.username;
    if (!me.ok || !username) {
      results.telegram = "TOKEN INVÁLIDO: Telegram no lo reconoce";
    } else {
      await setSecret(env.DB, env, "telegram_bot_token", telegramToken);
      await ensureTelegramSchema(env.DB);
      await env.DB.prepare("INSERT OR REPLACE INTO telegram_state (key, value) VALUES ('bot_username', ?1)").bind(username).run();
      const hooked = await ensureWebhook(telegramToken, request.nextUrl.origin).catch(() => false);
      results.telegram = hooked ? `OK · @${username}` : `GUARDADO · @${username}, pero no se pudo registrar el webhook`;
    }
  }

  const anthropicKey = body.anthropicKey?.trim();
  if (anthropicKey) {
    const r = await fetch("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!r) results.ai = "NO SE PUDO VERIFICAR: sin respuesta de Anthropic";
    else if (r.status === 401 || r.status === 403) results.ai = "CLAVE INVÁLIDA: Anthropic la rechazó";
    else if (!r.ok) results.ai = `NO SE PUDO VERIFICAR (HTTP ${r.status})`;
    else {
      await setSecret(env.DB, env, "anthropic_api_key", anthropicKey);
      results.ai = "OK · clave verificada";
    }
  }
  return NextResponse.json({ results });
}

/** Remove a value saved from the app (Cloudflare secrets are not touched). */
export async function DELETE(request: NextRequest) {
  const user = await who(request);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });
  if ((await adminUserId(env.DB)) !== user.id) return NextResponse.json({ error: "SÓLO ADMINISTRADOR" }, { status: 403 });
  const which = request.nextUrl.searchParams.get("which");
  const name: SecretName | null = which === "telegram" ? "telegram_bot_token" : which === "ai" ? "anthropic_api_key" : null;
  if (!name) return NextResponse.json({ error: "¿CUÁL?" }, { status: 400 });
  await deleteSecret(env.DB, name);
  return NextResponse.json({ ok: true });
}
