/**
 * Signed Binance calls made FROM THE BROWSER, not the Worker.
 *
 * WHY THIS EXISTS — READ BEFORE TOUCHING
 *
 * Binance's WAF blocks the Worker's own signed requests (HTTP 403 —
 * Binance's own documented meaning for that status; confirmed in
 * production, and the same mechanism already known for /api/v3/klines from
 * the Worker, which is why candles are fetched client-side too). Mirror
 * hosts (api1-api4) were tried first and are blocked identically — the
 * block is IP-based, not endpoint- or host-specific.
 *
 * The only way left to reach these endpoints at all is from a browser's own
 * residential/consumer IP, which is what every function in this file does.
 * Binance's API sends permissive CORS headers (confirmed elsewhere in this
 * app for public endpoints), so a direct browser→Binance call works the
 * same way klines already do.
 *
 * THE TRADE-OFF THIS MODULE IS THE OTHER SIDE OF
 *
 * Every other secret in this app (Telegram token, Anthropic key, and the
 * Binance secret itself at rest) is encrypted and never leaves the Worker.
 * For this to work, the decrypted API secret DOES have to reach the
 * browser — fetched once per session from GET /api/binance/credentials,
 * held only in memory (a React ref/state, never localStorage/sessionStorage/
 * IndexedDB), and used only to sign requests made directly from here. This
 * was an explicit, informed choice — the safer alternatives (a paid IP
 * proxy the Worker routes through, or a small relay server) were laid out
 * first and declined in favor of this one, which costs nothing and needs no
 * new infrastructure, at the price of the secret transiting to the browser.
 *
 * This file therefore does NOT import anything from lib/binance-account.ts
 * on purpose — that module is Worker-side (D1, encryption) and must never
 * end up in a client bundle. A little duplication (the HMAC helper, the
 * read-only check) is the deliberate cost of keeping that boundary clean.
 */

async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class BinanceClientError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const BINANCE_BASE = "https://api.binance.com";
const FAPI_BASE = "https://fapi.binance.com";

async function signedFetch<T>(
  base: string,
  path: string,
  params: Record<string, string>,
  apiKey: string,
  apiSecret: string,
): Promise<T> {
  const query = new URLSearchParams({ ...params, timestamp: Date.now().toString(), recvWindow: "5000" });
  const signature = await hmacSha256Hex(query.toString(), apiSecret);
  query.set("signature", signature);
  const response = await fetch(`${base}${path}?${query.toString()}`, {
    headers: { "X-MBX-APIKEY": apiKey },
  });
  const raw = await response.text();
  let data: (T & { msg?: string; code?: number }) | null = null;
  try {
    data = JSON.parse(raw) as T & { msg?: string; code?: number };
  } catch {
    throw new BinanceClientError(`Binance no devolvió una respuesta legible (código ${response.status}).`, response.status);
  }
  if (!response.ok) {
    throw new BinanceClientError(data?.msg || `Binance devolvió un error (código ${response.status}).`, response.status);
  }
  return data;
}

export type ApiRestrictions = {
  enableReading: boolean;
  enableSpotAndMarginTrading: boolean;
  enableWithdrawals: boolean;
};

/** Same accept/reject rule the Worker used to apply itself before the WAF
 *  block made that live check impossible — now run here, where the call
 *  can actually reach Binance. */
export async function checkReadOnly(apiKey: string, apiSecret: string): Promise<ApiRestrictions> {
  const restrictions = await signedFetch<ApiRestrictions>(
    BINANCE_BASE,
    "/sapi/v1/account/apiRestrictions",
    {},
    apiKey,
    apiSecret,
  );
  if (!restrictions.enableReading) {
    throw new Error("La API key no tiene habilitada la lectura.");
  }
  if (restrictions.enableSpotAndMarginTrading || restrictions.enableWithdrawals) {
    throw new Error(
      "Por seguridad solo se aceptan API keys de solo lectura. Desactivá Trading y Retiros en Binance y volvé a intentar.",
    );
  }
  return restrictions;
}

export type BinanceBalance = { asset: string; free: string; locked: string };

export async function getAccountBalances(apiKey: string, apiSecret: string) {
  const account = await signedFetch<{ balances: BinanceBalance[]; updateTime: number }>(
    BINANCE_BASE,
    "/api/v3/account",
    {},
    apiKey,
    apiSecret,
  );
  const nonZero = account.balances.filter((b) => Number(b.free) > 0 || Number(b.locked) > 0);
  return { balances: nonZero, updateTime: account.updateTime };
}

export type BinanceFill = { symbol: string; price: string; qty: string; isBuyer: boolean; time: number };

export async function getMyTrades(apiKey: string, apiSecret: string, symbol: string, limit = 1000) {
  return signedFetch<BinanceFill[]>(BINANCE_BASE, "/api/v3/myTrades", { symbol, limit: String(limit) }, apiKey, apiSecret);
}

export type RawFuturesPosition = {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  markPrice: string;
  unRealizedProfit: string;
  liquidationPrice: string;
  leverage: string;
  marginType: string;
  isolatedMargin: string;
  notional: string;
};

export async function getFuturesPositions(apiKey: string, apiSecret: string) {
  return signedFetch<RawFuturesPosition[]>(FAPI_BASE, "/fapi/v2/positionRisk", {}, apiKey, apiSecret);
}

export type RawFuturesAccount = {
  totalWalletBalance: string;
  totalUnrealizedProfit: string;
  totalMarginBalance: string;
  availableBalance: string;
  totalInitialMargin: string;
  totalMaintMargin: string;
};

export async function getFuturesAccountSummary(apiKey: string, apiSecret: string) {
  return signedFetch<RawFuturesAccount>(FAPI_BASE, "/fapi/v2/account", {}, apiKey, apiSecret);
}

export type BinanceDeposit = { amount: string; coin: string; status: number; insertTime: number; txId: string | null };

export async function getDepositHistory(apiKey: string, apiSecret: string) {
  return signedFetch<BinanceDeposit[]>(BINANCE_BASE, "/sapi/v1/capital/deposit/hisrec", {}, apiKey, apiSecret);
}

export type BinanceWithdrawal = { amount: string; coin: string; status: number; applyTime: string; txId: string | null };

export async function getWithdrawHistory(apiKey: string, apiSecret: string) {
  return signedFetch<BinanceWithdrawal[]>(BINANCE_BASE, "/sapi/v1/capital/withdraw/history", {}, apiKey, apiSecret);
}
