/**
 * Per-client Binance spot account linking.
 *
 * Each client's API key/secret are AES-GCM encrypted at rest with a server
 * secret (env.ENCRYPTION_KEY) that never leaves the Worker. Secrets are only
 * ever decrypted in memory, right before a signed request, and never sent
 * back to the browser.
 *
 * Every stored key is verified read-only server-side before being saved:
 * a client key with trading or withdrawal permissions is rejected outright.
 */

const BINANCE_BASE = "https://api.binance.com";

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

async function getEncryptionKey(env: Pick<Env, "ENCRYPTION_KEY">) {
  if (!env.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY_MISSING");
  const keyBytes = fromBase64(env.ENCRYPTION_KEY);
  return crypto.subtle.importKey("raw", keyBytes as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptSecret(plain: string, env: Pick<Env, "ENCRYPTION_KEY">) {
  const key = await getEncryptionKey(env);
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

export async function decryptSecret(encrypted: string, env: Pick<Env, "ENCRYPTION_KEY">) {
  const key = await getEncryptionKey(env);
  const combined = fromBase64(encrypted);
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, data as BufferSource);
  return new TextDecoder().decode(plain);
}

async function hmacSha256Hex(message: string, secret: string) {
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

class BinanceApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function signedRequest<T>(
  path: string,
  params: Record<string, string>,
  apiKey: string,
  apiSecret: string,
) {
  const query = new URLSearchParams({ ...params, timestamp: Date.now().toString(), recvWindow: "5000" });
  const signature = await hmacSha256Hex(query.toString(), apiSecret);
  query.set("signature", signature);
  const response = await fetch(`${BINANCE_BASE}${path}?${query.toString()}`, {
    headers: { "X-MBX-APIKEY": apiKey },
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await response.json()) as T & { msg?: string; code?: number };
  if (!response.ok) {
    throw new BinanceApiError(data?.msg || `BINANCE_ERROR_${response.status}`, response.status);
  }
  return data;
}

export type ApiRestrictions = {
  enableReading: boolean;
  enableSpotAndMarginTrading: boolean;
  enableWithdrawals: boolean;
};

/** Confirms a key is read-only before we ever store it. */
export async function assertReadOnlyKey(apiKey: string, apiSecret: string) {
  const restrictions = await signedRequest<ApiRestrictions>(
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
