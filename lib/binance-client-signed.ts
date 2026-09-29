/**
 * Signed Binance calls made FROM THE BROWSER, over Binance's WebSocket API.
 *
 * WHY THIS EXISTS — READ BEFORE TOUCHING
 *
 * Two walls, in this order:
 *
 *  1. Binance's WAF blocks the Worker's own signed requests (HTTP 403 —
 *     Binance's own documented meaning for that status; confirmed in
 *     production, mirrors included). So the Worker can't make these calls.
 *
 *  2. The obvious fix — sign in the browser and call the REST API directly —
 *     does not work either. A signed REST request carries the custom header
 *     X-MBX-APIKEY, which makes the browser send a CORS preflight, and
 *     Binance's preflight response does not allow that header (documented in
 *     several public issue trackers and on Binance's own developer forum).
 *     Public endpoints (klines, tickers) are fine because they send no custom
 *     header. That was a mistake here: the first version of this file used
 *     REST and could never have worked. It was never run against a real key.
 *
 * What does work: Binance's WebSocket API accepts signed requests with the
 * apiKey and signature INSIDE the message ({"method": ..., "params":
 * {apiKey, timestamp, signature, ...}}) — no header, so no preflight, and a
 * WebSocket isn't subject to CORS at all. HMAC keys are supported per
 * request (only the "session.logon" shortcut is Ed25519-only).
 *
 * THE TRADE-OFF THIS MODULE IS THE OTHER SIDE OF
 *
 * Every other secret in this app is encrypted and never leaves the Worker.
 * For this to work the decrypted API secret DOES have to reach the browser —
 * fetched once per session from GET /api/binance/credentials, held only in
 * memory, used only to sign requests made from here. That was an explicit,
 * informed choice (the alternatives were a paid IP proxy or a relay server).
 *
 * WHAT THE WEBSOCKET API CAN'T DO
 *
 *  - Deposit / withdrawal history are SAPI endpoints with no WebSocket
 *    equivalent, so they are simply unavailable from here.
 *  - The apiRestrictions endpoint (which says exactly what a key may do) is
 *    SAPI too. Trading permission is probed instead with order.test (see
 *    checkReadOnly); the withdrawal permission cannot be probed at all, which
 *    is why the link form makes the person confirm it.
 *
 * This file does NOT import anything from lib/binance-account.ts on purpose —
 * that module is Worker-side (D1, encryption) and must never end up in a
 * client bundle.
 */

export async function hmacSha256Hex(message: string, secret: string): Promise<string> {
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

/** Binance's WebSocket API signs the params sorted by name, joined as
 *  name=value with &, with NO percent-encoding, excluding the signature. */
export async function signParams(params: Record<string, string | number | boolean>, secret: string) {
  const payload = Object.keys(params)
    .filter((k) => k !== "signature")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return hmacSha256Hex(payload, secret);
}

export class BinanceClientError extends Error {
  status: number;
  code: number | null;
  constructor(message: string, status: number, code: number | null = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** What a person can act on, for the codes Binance actually returns when
 *  linking goes wrong. Anything else keeps Binance's own text. */
export function friendlyClientError(error: unknown): string {
  if (error instanceof BinanceClientError) {
    if (error.code === -2015) {
      return "Binance no aceptó la API key. Revisá que esté completa y que el acceso por IP sea \"Sin restricciones\" (o incluya tu IP actual).";
    }
    if (error.code === -2014) return "El formato de la API key no es válido: revisá que la copiaste completa, sin espacios.";
    if (error.code === -1022) return "La firma no coincidió: revisá que el API secret esté completo, sin espacios.";
    if (error.code === -1021) return "La hora de tu computadora está desfasada respecto de Binance. Sincronizala y probá de nuevo.";
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "No se pudo hablar con Binance.";
}

// ─── transport ────────────────────────────────────────────────────────────

const SPOT_WS = "wss://ws-api.binance.com:443/ws-api/v3";
const FUTURES_WS = "wss://ws-fapi.binance.com/ws-fapi/v1";
const REQUEST_TIMEOUT_MS = 10_000;
const IDLE_CLOSE_MS = 20_000;
// Generous on purpose: a person's computer clock is often a few seconds off,
// and Binance rejects a stale timestamp outright (-1021).
const RECV_WINDOW = 20_000;

type SocketLike = {
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "message" | "close" | "error", listener: (event: { data?: unknown }) => void): void;
};
const defaultFactory = (url: string): SocketLike => new WebSocket(url) as unknown as SocketLike;
let socketFactory: (url: string) => SocketLike = defaultFactory;

/** Tests inject a fake socket; pass null to restore the real one. */
export function setSocketFactoryForTests(factory: ((url: string) => SocketLike) | null) {
  socketFactory = factory ?? defaultFactory;
  for (const connection of pool.values()) connection.dispose();
  pool.clear();
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

class Connection {
  private ws: SocketLike;
  private opened: Promise<void>;
  private pending = new Map<string, Pending>();
  private idle: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private onClosed: () => void;

  // Explicit field, not a parameter property: Node's type-stripping test
  // runner can't parse those.
  constructor(url: string, onClosed: () => void) {
    this.onClosed = onClosed;
    this.ws = socketFactory(url);
    this.opened = new Promise<void>((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve());
      const fail = () => reject(new BinanceClientError("No se pudo abrir la conexión con Binance. Puede estar bloqueada por tu red, un antivirus o una extensión.", 0));
      this.ws.addEventListener("error", fail);
      this.ws.addEventListener("close", fail);
    });
    this.opened.catch(() => undefined); // surfaced to whoever awaits it; never left unhandled
    this.ws.addEventListener("message", (event) => this.handle(event.data));
    this.ws.addEventListener("close", () => {
      this.closed = true;
      this.failAll(new BinanceClientError("Se cortó la conexión con Binance.", 0));
      this.onClosed();
    });
  }

  private handle(raw: unknown) {
    let message: { id?: string; status?: number; result?: unknown; error?: { code?: number; msg?: string } };
    try {
      message = JSON.parse(String(raw));
    } catch {
      return; // not a message we asked for
    }
    const entry = message.id ? this.pending.get(message.id) : undefined;
    if (!entry || !message.id) return;
    clearTimeout(entry.timer);
    this.pending.delete(message.id);
    if (message.status === 200) entry.resolve(message.result);
    else {
      const code = message.error?.code ?? null;
      entry.reject(new BinanceClientError(message.error?.msg ?? `Binance devolvió un error (código ${message.status}).`, message.status ?? 0, code));
    }
  }

  private failAll(error: Error) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  async send(method: string, params: Record<string, unknown>): Promise<unknown> {
    await this.opened;
    if (this.closed) throw new BinanceClientError("Se cortó la conexión con Binance.", 0);
    if (this.idle) clearTimeout(this.idle);
    const id = crypto.randomUUID();
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BinanceClientError("Binance no respondió a tiempo.", 0));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.ws.send(JSON.stringify({ id, method, params }));
    try {
      return await result;
    } finally {
      if (this.pending.size === 0 && !this.closed) this.idle = setTimeout(() => this.dispose(), IDLE_CLOSE_MS);
    }
  }

  dispose() {
    if (this.idle) clearTimeout(this.idle);
    this.closed = true;
    try {
      this.ws.close();
    } catch {
      // already closed
    }
  }
}

// One connection per endpoint, reused: the futures panel polls every few
// seconds and opening a socket each time would be wasteful and rate-limited.
const pool = new Map<string, Connection>();

function connectionFor(url: string): Connection {
  let connection = pool.get(url);
  if (!connection) {
    connection = new Connection(url, () => {
      if (pool.get(url) === connection) pool.delete(url);
    });
    pool.set(url, connection);
  }
  return connection;
}

async function signedCall<T>(
  url: string,
  method: string,
  extra: Record<string, string | number | boolean>,
  apiKey: string,
  apiSecret: string,
): Promise<T> {
  const params: Record<string, string | number | boolean> = {
    ...extra,
    apiKey,
    recvWindow: RECV_WINDOW,
    timestamp: Date.now(),
  };
  const signature = await signParams(params, apiSecret);
  return (await connectionFor(url).send(method, { ...params, signature })) as T;
}

const spot = <T>(method: string, extra: Record<string, string | number | boolean>, key: string, secret: string) =>
  signedCall<T>(SPOT_WS, method, extra, key, secret);
const futures = <T>(method: string, extra: Record<string, string | number | boolean>, key: string, secret: string) =>
  signedCall<T>(FUTURES_WS, method, extra, key, secret);

// ─── what the app reads ───────────────────────────────────────────────────

export type ApiRestrictions = {
  enableReading: boolean;
  enableSpotAndMarginTrading: boolean;
  enableWithdrawals: boolean;
};

export type LinkCheck = ApiRestrictions & {
  /** "confirmado": Binance itself refused a test order, so the key can't
   *  trade. "inconcluso": the probe couldn't settle it — the person's own
   *  confirmation is all there is. */
  tradingProbe: "confirmado" | "inconcluso";
};

async function lastPrice(symbol: string): Promise<number | null> {
  try {
    // A public endpoint: no custom header, so no preflight — CORS is fine here.
    const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { price?: string };
    const price = Number(body.price);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

/**
 * Confirms the key works, can read, and — as far as a browser can tell —
 * cannot trade.
 *
 * Reading: account.status succeeds only for a valid key that may read.
 *
 * Trading: order.test validates a new order without sending it, and requires
 * TRADE permission. So a well-formed test order is accepted (200) if the key
 * can trade and refused with -2015 if it can't. The order is built to pass
 * every symbol filter (half the last price, notional just above the minimum)
 * so a refusal can only be about permission — a malformed order could fail a
 * filter check first and be mistaken for "has permission". Anything other
 * than 200 or -2015 is inconclusive, not a verdict either way.
 *
 * Withdrawals: no signed WebSocket method needs that permission, so it cannot
 * be probed here. The link form asks the person to confirm it instead.
 */
export async function checkReadOnly(apiKey: string, apiSecret: string): Promise<LinkCheck> {
  await spot("account.status", {}, apiKey, apiSecret);

  let trading: boolean | null = null;
  const price = await lastPrice("BTCUSDT");
  if (price !== null) {
    const limit = Math.floor(price * 0.5 * 100) / 100;
    const quantity = Math.ceil((12 / limit) * 1e5) / 1e5;
    try {
      await spot(
        "order.test",
        { symbol: "BTCUSDT", side: "BUY", type: "LIMIT", timeInForce: "GTC", quantity: quantity.toFixed(5), price: limit.toFixed(2) },
        apiKey,
        apiSecret,
      );
      trading = true;
    } catch (error) {
      trading = error instanceof BinanceClientError && error.code === -2015 ? false : null;
    }
  }

  if (trading === true) {
    throw new Error("Por seguridad solo se aceptan API keys de solo lectura. Desactivá Trading y Retiros en Binance y volvé a intentar.");
  }
  return {
    enableReading: true,
    enableSpotAndMarginTrading: false,
    enableWithdrawals: false,
    tradingProbe: trading === false ? "confirmado" : "inconcluso",
  };
}

export type BinanceBalance = { asset: string; free: string; locked: string };

export async function getAccountBalances(apiKey: string, apiSecret: string) {
  const account = await spot<{ balances: BinanceBalance[]; updateTime: number }>("account.status", {}, apiKey, apiSecret);
  const nonZero = account.balances.filter((b) => Number(b.free) > 0 || Number(b.locked) > 0);
  return { balances: nonZero, updateTime: account.updateTime };
}

export type BinanceFill = {
  symbol: string;
  id: number;
  orderId?: number;
  price: string;
  qty: string;
  quoteQty?: string;
  commission?: string;
  commissionAsset?: string;
  isBuyer: boolean;
  isMaker?: boolean;
  time: number;
};

export async function getMyTrades(apiKey: string, apiSecret: string, symbol: string, limit = 1000, fromId?: number) {
  const extra: Record<string, string | number | boolean> = { symbol, limit };
  // fromId walks forward from that trade id, which is how a whole history is
  // read in pages (a time range is capped at 24 hours per call).
  if (fromId !== undefined) extra.fromId = fromId;
  return spot<BinanceFill[]>("myTrades", extra, apiKey, apiSecret);
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

// Method names follow Binance's own REST↔WebSocket pairing (v2/account.balance
// ↔ /fapi/v2/balance is documented; position and status use the same scheme).
export async function getFuturesPositions(apiKey: string, apiSecret: string) {
  return futures<RawFuturesPosition[]>("v2/account.position", {}, apiKey, apiSecret);
}

/**
 * The account's private futures stream. Starting it needs only the API key
 * (Binance's USER_STREAM security type: no timestamp, no signature), so the
 * recorder never has to hold the secret. The key returned is valid for 60
 * minutes and each ping extends it.
 */
export async function startFuturesUserStream(apiKey: string): Promise<string> {
  const result = (await connectionFor(FUTURES_WS).send("userDataStream.start", { apiKey })) as { listenKey?: string };
  if (!result?.listenKey) throw new BinanceClientError("Binance no devolvió la clave del canal privado.", 0);
  return result.listenKey;
}

export async function pingFuturesUserStream(apiKey: string): Promise<void> {
  await connectionFor(FUTURES_WS).send("userDataStream.ping", { apiKey });
}

/** Where the private stream is read. Binance moved it under /private; the old
 *  path is kept as a fallback in case the new one is refused. */
export const FUTURES_USER_STREAM_URLS = (listenKey: string) => [
  `wss://fstream.binance.com/private/ws/${listenKey}`,
  `wss://fstream.binance.com/ws/${listenKey}`,
];

export type RawFuturesAccount = {
  totalWalletBalance: string;
  totalUnrealizedProfit: string;
  totalMarginBalance: string;
  availableBalance: string;
  totalInitialMargin: string;
  totalMaintMargin: string;
};

export async function getFuturesAccountSummary(apiKey: string, apiSecret: string) {
  return futures<RawFuturesAccount>("v2/account.status", {}, apiKey, apiSecret);
}

export type BinanceDeposit = { amount: string; coin: string; status: number; insertTime: number; txId: string | null };
export type BinanceWithdrawal = { amount: string; coin: string; status: number; applyTime: string; txId: string | null };

const NO_HISTORY = "El historial de depósitos y retiros no se puede leer desde el navegador (Binance no lo ofrece por WebSocket).";
// Callers still pass (apiKey, apiSecret); they are accepted and ignored so the
// panels didn't need to change when this stopped being possible.
export async function getDepositHistory(...args: unknown[]): Promise<BinanceDeposit[]> {
  void args;
  throw new BinanceClientError(NO_HISTORY, 0);
}
export async function getWithdrawHistory(...args: unknown[]): Promise<BinanceWithdrawal[]> {
  void args;
  throw new BinanceClientError(NO_HISTORY, 0);
}
