import { env } from "cloudflare:workers";
import { ensureAuthSchema, getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { decryptSecretConEstado, encryptSecret } from "@/lib/binance-account";

export const dynamic = "force-dynamic";

/**
 * Decrypted Binance credentials for the signed-in user's linked account.
 *
 * This is the one place in the whole app where the API secret leaves the
 * Worker — see lib/binance-client-signed.ts's doc comment for why: Binance's
 * WAF blocks the Worker's own signed calls (confirmed, mirrors included),
 * so the browser has to make them directly, which means it needs the raw
 * key/secret to sign with. The client fetches this ONCE per session and
 * holds it in memory only (never localStorage/sessionStorage/IndexedDB) —
 * that discipline lives in the client code that calls this, not here; this
 * route's only job is deciding whether THIS request may have it at all.
 */
export async function GET(request: Request) {
  try {
    if (!env.DB) throw new Error("D1_UNAVAILABLE");
    await ensureAuthSchema(env.DB);

    const token = getCookie(request, SESSION_COOKIE);
    const user = token ? await getSessionUser(env.DB, token) : null;
    if (!user) return Response.json({ error: "NO AUTENTICADO" }, { status: 401 });

    const stored = await env.DB.prepare(
      "SELECT api_key_encrypted, api_secret_encrypted FROM binance_credentials WHERE user_id = ?1",
    )
      .bind(user.id)
      .first<{ api_key_encrypted: string; api_secret_encrypted: string }>();
    if (!stored) return Response.json({ error: "NO HAY CUENTA DE BINANCE VINCULADA" }, { status: 404 });

    const key = await decryptSecretConEstado(stored.api_key_encrypted, env.DB, env);
    const secret = await decryptSecretConEstado(stored.api_secret_encrypted, env.DB, env);
    const apiKey = key.plain;
    const apiSecret = secret.plain;
    // Cifradas con la clave vieja y ya hay ENCRYPTION_KEY: se vuelven a cifrar con la fuerte (una sola vez).
    if (key.conClaveVieja || secret.conClaveVieja) {
      await env.DB.prepare("UPDATE binance_credentials SET api_key_encrypted = ?1, api_secret_encrypted = ?2 WHERE user_id = ?3")
        .bind(await encryptSecret(apiKey, env.DB, env), await encryptSecret(apiSecret, env.DB, env), user.id)
        .run()
        .catch(() => undefined);
    }

    return Response.json({ apiKey, apiSecret }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[ALT_RADAR_BINANCE_CREDENTIALS]", error);
    return Response.json({ error: "No se pudieron leer las credenciales." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
