import { env } from "cloudflare:workers";
import { ensureAuthSchema, getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { encryptSecret, friendlyBinanceError, validateApiRestrictions, type ApiRestrictions } from "@/lib/binance-account";
import { logBinanceFailure } from "@/lib/binance-debug-log";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let userId: number | null = null;
  try {
    if (!env.DB) throw new Error("D1_UNAVAILABLE");
    await ensureAuthSchema(env.DB);

    const token = getCookie(request, SESSION_COOKIE);
    const user = token ? await getSessionUser(env.DB, token) : null;
    if (!user) return Response.json({ error: "NO AUTENTICADO" }, { status: 401 });
    userId = user.id;

    const body = (await request.json().catch(() => null)) as
      | { apiKey?: string; apiSecret?: string; restrictions?: ApiRestrictions; confirmedReadOnly?: boolean }
      | null;
    const apiKey = body?.apiKey?.trim();
    const apiSecret = body?.apiSecret?.trim();
    if (!apiKey || !apiSecret) {
      return Response.json({ error: "Falta la API key o el secret." }, { status: 400 });
    }
    // The live check that used to run here (a signed call to
    // /sapi/v1/account/apiRestrictions) is exactly the class of request
    // Binance's WAF blocks from the Worker — see BINANCE_MIRRORS's doc
    // comment. The browser already ran that same check directly against
    // Binance (lib/binance-client-signed.ts's checkReadOnly) before this
    // request was ever sent; this re-validates what it reported, so the
    // server still enforces the rule rather than trusting the client
    // unchecked.
    if (!body?.restrictions) {
      return Response.json({ error: "Falta el resultado de la verificación de permisos." }, { status: 400 });
    }
    validateApiRestrictions(body.restrictions);
    // The browser can't see the withdrawal permission, so the person's own
    // confirmation is a hard requirement here, not just a checkbox in the UI.
    if (body.confirmedReadOnly !== true) {
      return Response.json({ error: "Confirmá que la API key es de solo lectura (sin trading ni retiros)." }, { status: 400 });
    }

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
    if (userId !== null && env.DB) await logBinanceFailure(env.DB, "link", userId, error);
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
