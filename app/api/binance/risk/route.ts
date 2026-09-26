import { env } from "cloudflare:workers";
import { ensureAuthSchema, getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import {
  decryptSecret,
  friendlyBinanceError,
  getAccountBalances,
  getMyTrades,
  type BinanceFill,
} from "@/lib/binance-account";
import { computeCostBasis, costBasisReliable, type RiskPosition } from "@/lib/cost-basis";

export const dynamic = "force-dynamic";

const STABLES = new Set(["USDT", "USDC", "BUSD", "FDUSD", "DAI", "TUSD", "USDP"]);
// Trade history is one signed call per asset. Most portfolios have a long
// tail of dust; only the largest holdings are worth that cost.
const MAX_ASSETS_WITH_HISTORY = 8;
const DUST_USD = 5;

/**
 * Balances and cost basis only — no candles, no zones, no spot plan. That
 * part needs the same public Binance mirrors every other chart in the app
 * already fetches from the browser, and doing it here too would mean two
 * places computing a spot plan that could quietly drift apart. This route
 * exists only for what genuinely requires the signed account (balances,
 * trade history), so lib/spot-plan-client.ts on the client can build the
 * rest with the exact same engines app/spot-desk.tsx already uses.
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

    const [{ balances }, priceRows] = await Promise.all([
      getAccountBalances(apiKey, apiSecret),
      fetch("https://api.binance.com/api/v3/ticker/price", { signal: AbortSignal.timeout(8000) })
        .then((r) => (r.ok ? (r.json() as Promise<{ symbol: string; price: string }[]>) : []))
        .catch(() => [] as { symbol: string; price: string }[]),
    ]);
    const priceOf = new Map(priceRows.map((r) => [r.symbol, Number(r.price)]));

    const held = balances
      .map((b) => {
        const qty = Number(b.free) + Number(b.locked);
        const isStable = STABLES.has(b.asset);
        const price = isStable ? 1 : (priceOf.get(`${b.asset}USDT`) ?? null);
        const valueUsd = price !== null ? qty * price : null;
        return { asset: b.asset, qty, isStable, price, valueUsd };
      })
      .filter((h) => h.qty > 0)
      .sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));

    const totalUsd = held.reduce((s, h) => s + (h.valueUsd ?? 0), 0);

    const withHistory = held
      .filter((h) => !h.isStable && (h.valueUsd ?? 0) >= DUST_USD)
      .slice(0, MAX_ASSETS_WITH_HISTORY);
    const tradeResults = await Promise.allSettled(
      withHistory.map((h) => getMyTrades(apiKey, apiSecret, `${h.asset}USDT`)),
    );
    const fillsByAsset = new Map<string, BinanceFill[]>();
    withHistory.forEach((h, i) => {
      const r = tradeResults[i];
      if (r.status === "fulfilled") fillsByAsset.set(h.asset, r.value);
    });

    const positions: RiskPosition[] = held.map((h) => {
      const fills = fillsByAsset.get(h.asset);
      const basis = fills?.length
        ? computeCostBasis(fills.map((f) => ({ price: Number(f.price), qty: Number(f.qty), isBuyer: f.isBuyer, time: f.time })))
        : null;
      return {
        asset: h.asset,
        qty: h.qty,
        price: h.price,
        valueUsd: h.valueUsd,
        isStable: h.isStable,
        costBasis: basis,
        costBasisReliable: basis !== null && costBasisReliable(basis.units, h.qty),
      };
    });

    return Response.json(
      { positions, totalUsd, updateTime: Date.now() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[ALT_RADAR_BINANCE_RISK]", error);
    return Response.json(
      { error: friendlyBinanceError(error, "No se pudo leer la cartera.") },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
