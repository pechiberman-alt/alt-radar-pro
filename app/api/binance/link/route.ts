import { env } from "cloudflare:workers";
import { ensureAuthSchema, getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { assertReadOnlyKey, encryptSecret, friendlyBinanceError } from "@/lib/binance-account";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!env.DB) throw new Error("D1_UNAVAILABLE");
    await ensureAuthSchema(env.DB);

    const token = getCookie(request, SESSION_COOKIE);
    const user = token ? await getSessionUser(env.DB, token) : null;
    if (!user) return Response.json({ error: "NO AUTENTICADO" }, { status: 401 });

    const body = (await request.json().catch(() => null)) as
      | { apiKey?: string; apiSecret?: string }
      | null;
    const apiKey = body?.apiKey?.trim();
    const apiSecret = body?.apiSecret?.trim();
    if (!apiKey || !apiSecret) {
      return Response.json({ error: "Falta la API key o el secret." }, { status: 400 });
    }

    // Rejects the key server-side if it has trading or withdrawal rights.
    await assertReadOnlyKey(apiKey, apiSecret);

    const encryptedKey = await encryptSecret(apiKey, env.DB, env);
    const encryptedSecret = await encryptSecret(apiSecret, env.DB, env);

    await env.DB.prepare(
      `INSERT INTO binance_credentials (user_id, api_key_encrypted, api_secret_encrypted)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(user_id) DO UPDATE SET
         api_key_encrypted = excluded.api_key_encrypted,
         api_secret_encrypted = excluded.api_secret_encrypted`,
    )
      .bind(user.id, encryptedKey, encryptedSecret)
      .run();

    return Response.json({ ok: true });
  } catch (error) {
    console.error("[ALT_RADAR_BINANCE_LINK]", error);
    return Response.json({ error: friendlyBinanceError(error, "No se pudo vincular la cuenta.") }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (!env.DB) throw new Error("D1_UNAVAILABLE");
    const token = getCookie(request, SESSION_COOKIE);
    const user = token ? await getSessionUser(env.DB, token) : null;
    if (!user) return Response.json({ error: "NO AUTENTICADO" }, { status: 401 });

    await env.DB.prepare("DELETE FROM binance_credentials WHERE user_id = ?1").bind(user.id).run();
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[ALT_RADAR_BINANCE_UNLINK]", error);
    return Response.json({ error: "NO SE PUDO DESVINCULAR" }, { status: 500 });
  }
}
