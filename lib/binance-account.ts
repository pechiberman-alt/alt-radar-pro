/**
 * Per-client Binance spot account linking.
 *
 * Each client's API key/secret are AES-GCM encrypted at rest. The key used is
 * resolveEncryptionKey from app-settings.ts: the Cloudflare secret
 * ENCRYPTION_KEY when set, otherwise an auto-generated key kept in D1 (the
 * same fallback Telegram and the AI key already use) — so this feature works
 * the moment someone links an account, with no Cloudflare setup step. That
 * key never leaves the Worker; secrets are only ever decrypted in memory,
 * right before a signed request, and never sent back to the browser.
 *
 * Every stored key is verified read-only server-side before being saved: a
 * client key with trading or withdrawal permissions is rejected outright.
 */

import { resolveEncryptionKey } from "./app-settings.ts";

/**
 * NOT CURRENTLY CALLED FROM ANY LIVE ROUTE.
 *
 * Everything below that makes a signed call to Binance (signedRequest and
 * everything built on it — getAccountBalances, getMyTrades,
 * getDepositHistory, getWithdrawHistory) is blocked by Binance's WAF from
 * the Worker, mirrors included (confirmed in production; see this
 * constant's own comment). The app now signs these calls from the browser
 * instead — see lib/binance-client-signed.ts's doc comment for the full
 * reasoning and the alternatives that were weighed before choosing that.
 *
 * This is left in place, correct and tested, rather than deleted: if a
 * proxy with a non-datacenter IP is ever added in front of the Worker's
 * outbound calls (the safer alternative that was declined for cost, not
 * for being wrong), this is what it would sit in front of. Point new work
 * here instead of rebuilding it — but nothing should call it today.
 */
const BINANCE_BASE = "https://api.binance.com";
// Binance's own docs list these as the full API (not market-data-only,
// unlike data-api.binance.vision) — "should give better performance but
// have less stability." Tried in order after the primary host, since a
// Binance WAF block (HTTP 403 — Binance's own documented meaning for that
// status) is IP-based and doesn't necessarily apply to every mirror the
// same way.
const BINANCE_MIRRORS = [BINANCE_BASE, "https://api1.binance.com", "https://api2.binance.com", "https://api3.binance.com", "https://api4.binance.com"];

function toBase64(bytes: ArrayBuffer | Uint8Array) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of arr) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getEncryptionKey(db: D1Database, env: { ENCRYPTION_KEY?: string }) {
  const keyB64 = await resolveEncryptionKey(db, env);
  const keyBytes = fromBase64(keyB64);
  return crypto.subtle.importKey("raw", keyBytes as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptSecret(plain: string, db: D1Database, env: { ENCRYPTION_KEY?: string }) {
  const key = await getEncryptionKey(db, env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plain),
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return toBase64(combined);
}

export async function decryptSecret(encrypted: string, db: D1Database, env: { ENCRYPTION_KEY?: string }) {
  const key = await getEncryptionKey(db, env);
  const combined = fromBase64(encrypted);
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, data as BufferSource);
  return new TextDecoder().decode(plain);
}

export async function hmacSha256Hex(message: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

export class BinanceApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Turns a caught error into a message a client can act on. Binance's own
 * `msg` field is in English and often assumes the reader controls a fixed
 * server IP, which nobody linking through this app does — Cloudflare Workers
 * have no stable egress IP, so the #1 real failure is an IP-restricted key
 * that a fixed-IP whitelist would never satisfy here.
 *
 * A message already written for this app (assertReadOnlyKey's two checks) is
 * passed through unchanged rather than re-wrapped.
 */
export function friendlyBinanceError(
  error: unknown,
  fallback = "No se pudo completar la operación con Binance.",
  context?: "futures",
): string {
  if (error instanceof BinanceApiError) {
    const msg = error.message.toLowerCase();
    // Checked first, before any substring heuristic below: the marker's
    // payload is Binance's raw (non-JSON) response body, arbitrary text that
    // could easily contain "ip" or other trigger words by coincidence — that
    // must never get misread as one of Binance's own rejection reasons.
    if (error.message.startsWith("NON_JSON_RESPONSE_")) {
      return `Binance devolvió una respuesta que no se pudo leer (código ${error.status}). Probablemente un bloqueo de red entre el servidor y Binance, no tu API key — probá de nuevo en un rato.`;
    }
    // Futures gates ALL of /fapi (reading included) behind one permission
    // flag, and Binance answers a permission problem there with the same
    // -2015 text used for a bad IP or a bad key. A key already linked and
    // working for spot rules out both of those, so the honest read here is
    // "Futures isn't turned on, or there's no futures account yet" — never
    // the IP message, which would send someone chasing the wrong fix.
    if (context === "futures" && (error.status === 401 || msg.includes("ip") || msg.includes("permission"))) {
      return "Binance rechazó la lectura de Futuros. La API key vinculada necesita el permiso \"Habilitar Futuros\" activado, y tu cuenta de Binance necesita tener Futuros habilitado. A diferencia de spot, Binance no ofrece una versión de solo lectura de ese permiso: activarlo también permite operar futuros, aunque esta app nunca lo use para eso.";
    }
    if (msg.includes("ip")) {
      return "Binance rechazó la conexión por restricción de IP. La API key debe crearse con acceso \"Sin restricciones\" (Unrestricted): esta app no tiene una IP fija para agregar a una lista blanca.";
    }
    if (error.status === 401 || msg.includes("invalid api-key") || msg.includes("api-key format")) {
      return "Binance no reconoció la API key o el secret. Revisá que los copiaste completos, sin espacios.";
    }
    if (msg.includes("signature")) {
      return "La firma no coincidió: revisá que el API secret esté completo y sin espacios.";
    }
    if (msg.includes("timestamp")) {
      return "El reloj del servidor de Binance y el nuestro no coincidieron. Probá vincular de nuevo.";
    }
    return `Binance rechazó la solicitud: ${error.message}`;
  }
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") return "Binance no respondió a tiempo. Probá de nuevo.";
    // Messages this module already writes in Spanish for the person reading
    // them (read-only check, trading/withdrawal rights) pass through as-is.
    if (/[áéíóúñ]|API key/i.test(error.message)) return error.message;
  }
  return fallback;
}

async function signedRequestOnce<T>(
  path: string,
  params: Record<string, string>,
  apiKey: string,
  apiSecret: string,
  base: string,
) {
  // Timestamp and signature are computed fresh per attempt, not once for the
  // whole mirror loop: Binance's recvWindow is 5s, and a signature from an
  // earlier, already-failed mirror would be stale by the time a later one
  // is tried.
  const query = new URLSearchParams({ ...params, timestamp: Date.now().toString(), recvWindow: "5000" });
  const signature = await hmacSha256Hex(query.toString(), apiSecret);
  query.set("signature", signature);
  const response = await fetch(`${base}${path}?${query.toString()}`, {
    headers: { "X-MBX-APIKEY": apiKey },
    signal: AbortSignal.timeout(10_000),
  });
  // Read as text first, not response.json() directly: a network-level block
  // in front of Binance (a WAF/CDN page, not Binance's own API) answers with
  // HTML or plain text, not JSON. response.json() throwing on that swallows
  // the status code and body entirely, leaving a bare "Unexpected token"
  // with nothing to diagnose from. Parsing by hand keeps both.
  const raw = await response.text();
  let data: (T & { msg?: string; code?: number }) | null = null;
  try {
    data = JSON.parse(raw) as T & { msg?: string; code?: number };
  } catch {
    throw new BinanceApiError(`NON_JSON_RESPONSE_${response.status}:${raw.slice(0, 200)}`, response.status);
  }
  if (!response.ok) {
    throw new BinanceApiError(data?.msg || `BINANCE_ERROR_${response.status}`, response.status);
  }
  return data;
}

/** `bases` defaults to the spot mirrors; lib/binance-futures.ts passes its
 *  own (FAPI_MIRRORS) so the two account types share one signing
 *  implementation instead of a second, independently-maintained copy of it.
 *
 *  Tries each mirror in order, moving to the next ONLY when a mirror
 *  answered with something that isn't a real Binance response at all — a
 *  network-level block (NON_JSON_RESPONSE_*) or the fetch failing outright.
 *  A genuine Binance JSON error (bad key, bad signature, disabled
 *  permission) is the same on every mirror; surfacing it immediately from
 *  the first mirror that actually answered is faster and more honest than
 *  silently retrying a rejection that won't change. */
export async function signedRequest<T>(
  path: string,
  params: Record<string, string>,
  apiKey: string,
  apiSecret: string,
  bases: string[] = BINANCE_MIRRORS,
) {
  let lastError: unknown = null;
  for (const base of bases) {
    try {
      return await signedRequestOnce<T>(path, params, apiKey, apiSecret, base);
    } catch (err) {
      lastError = err;
      const isNetworkBlock = err instanceof BinanceApiError && err.message.startsWith("NON_JSON_RESPONSE_");
      const isFetchFailure = !(err instanceof BinanceApiError);
      if (!isNetworkBlock && !isFetchFailure) throw err;
    }
  }
  throw lastError;
}

export type ApiRestrictions = {
  enableReading: boolean;
  enableSpotAndMarginTrading: boolean;
  enableWithdrawals: boolean;
};

/**
 * The accept/reject rule for a Binance key, on its own — no network call.
 *
 * This used to live inside a function that ALSO fetched
 * /sapi/v1/account/apiRestrictions from the Worker. That fetch is exactly
 * the class of call Binance's WAF blocks from here (see BINANCE_MIRRORS'
 * doc comment) — a live server-side check of this is no longer possible at
 * all, from any mirror. The actual signed check now happens client-side
 * (lib/binance-client-signed.ts's checkReadOnly, which reaches Binance
 * directly from the browser); this function is what the /api/binance/link
 * route runs the CLIENT-REPORTED restrictions through, so the server still
 * enforces the same rule rather than trusting the browser's word for it
 * unchecked — weaker than an independent live check, but not nothing.
 */
export function validateApiRestrictions(restrictions: ApiRestrictions): void {
  if (!restrictions.enableReading) {
    throw new Error("La API key no tiene habilitada la lectura.");
  }
  if (restrictions.enableSpotAndMarginTrading || restrictions.enableWithdrawals) {
    throw new Error(
      "Por seguridad solo se aceptan API keys de solo lectura. Desactivá Trading y Retiros en Binance y volvé a intentar.",
    );
  }
}

export type BinanceBalance = { asset: string; free: string; locked: string };

export async function getAccountBalances(apiKey: string, apiSecret: string) {
  const account = await signedRequest<{ balances: BinanceBalance[]; updateTime: number }>(
    "/api/v3/account",
    {},
    apiKey,
    apiSecret,
  );
  const nonZero = account.balances.filter((b) => Number(b.free) > 0 || Number(b.locked) > 0);
  return { balances: nonZero, updateTime: account.updateTime };
}

export type BinanceDeposit = {
  amount: string;
  coin: string;
  status: number;
  insertTime: number;
  txId: string | null;
};

export type BinanceWithdrawal = {
  amount: string;
  coin: string;
  status: number;
  applyTime: string;
  txId: string | null;
};

export async function getDepositHistory(apiKey: string, apiSecret: string) {
  return signedRequest<BinanceDeposit[]>("/sapi/v1/capital/deposit/hisrec", {}, apiKey, apiSecret);
}

export async function getWithdrawHistory(apiKey: string, apiSecret: string) {
  return signedRequest<BinanceWithdrawal[]>("/sapi/v1/capital/withdraw/history", {}, apiKey, apiSecret);
}

export type BinanceFill = { symbol: string; price: string; qty: string; isBuyer: boolean; time: number };

/** Up to `limit` most recent fills for one symbol (max Binance allows is 1000).
 *  A long-lived account can have more history than that; computeCostBasis
 *  then works from what was actually fetched, and a caller that wants to
 *  know whether that was enough compares it against the live balance
 *  (costBasisReliable in lib/cost-basis.ts) rather than assuming it was. */
export async function getMyTrades(apiKey: string, apiSecret: string, symbol: string, limit = 1000) {
  return signedRequest<BinanceFill[]>("/api/v3/myTrades", { symbol, limit: String(limit) }, apiKey, apiSecret);
}
