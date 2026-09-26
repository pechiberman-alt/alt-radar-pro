import { env } from "cloudflare:workers";
import { ensureAuthSchema, getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { decryptSecret, friendlyBinanceError, getAccountBalances, getDepositHistory, getWithdrawHistory } from "@/lib/binance-account";

export const dynamic = "force-dynamic";

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
    if (!stored) {
      return Response.json({ error: "NO HAY CUENTA DE BINANCE VINCULADA" }, { status: 404 });
    }

    const apiKey = await decryptSecret(stored.api_key_encrypted, env.DB, env);
    const apiSecret = await decryptSecret(stored.api_secret_encrypted, env.DB, env);

    const [balances, depositsResult, withdrawalsResult] = await Promise.all([
      getAccountBalances(apiKey, apiSecret),
      getDepositHistory(apiKey, apiSecret).then(
        (value) => ({ ok: true as const, value }),
        (error) => ({ ok: false as const, error }),
      ),
      getWithdrawHistory(apiKey, apiSecret).then(
        (value) => ({ ok: true as const, value }),
        (error) => ({ ok: false as const, error }),
      ),
    ]);

    if (!depositsResult.ok) console.error("[ALT_RADAR_BINANCE_DEPOSITS]", depositsResult.error);
    if (!withdrawalsResult.ok) console.error("[ALT_RADAR_BINANCE_WITHDRAWALS]", withdrawalsResult.error);

    return Response.json(
      {
        balances: balances.balances,
        updateTime: balances.updateTime,
        deposits: depositsResult.ok ? depositsResult.value : [],
        withdrawals: withdrawalsResult.ok ? withdrawalsResult.value : [],
        // A false flag means the fetch failed — the empty array above is a
        // fallback for display, not a claim that there's no history.
        historyAvailable: { deposits: depositsResult.ok, withdrawals: withdrawalsResult.ok },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[ALT_RADAR_BINANCE_PORTFOLIO]", error);
    return Response.json(
      { error: friendlyBinanceError(error, "No se pudo leer la cartera.") },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
