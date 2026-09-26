import { env } from "cloudflare:workers";
import { decryptSecret, friendlyBinanceError } from "@/lib/binance-account";
import { getFuturesAccountSummary, getFuturesPositions } from "@/lib/binance-futures";
import { ensureAuthSchema, getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { openFuturesPositions, parseFuturesAccountSummary } from "@/lib/futures-risk";

export const dynamic = "force-dynamic";

/**
 * Open futures positions + account summary for the linked account. Reuses
 * the exact same stored credentials as spot (one Binance key per user) —
 * see friendlyBinanceError's "futures" context for what happens when that
 * key hasn't got "Enable Futures" turned on, which spot linking never asked
 * for and never required.
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

    const apiKey = await decryptSecret(stored.api_key_encrypted, env.DB, env);
    const apiSecret = await decryptSecret(stored.api_secret_encrypted, env.DB, env);

    const [rawPositions, rawSummary] = await Promise.all([
      getFuturesPositions(apiKey, apiSecret),
      getFuturesAccountSummary(apiKey, apiSecret),
    ]);

    return Response.json(
      { positions: openFuturesPositions(rawPositions), summary: parseFuturesAccountSummary(rawSummary), updateTime: Date.now() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[ALT_RADAR_BINANCE_FUTURES]", error);
    return Response.json(
      { error: friendlyBinanceError(error, "No se pudo leer la cuenta de Futuros.", "futures") },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
