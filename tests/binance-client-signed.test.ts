import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  BinanceClientError, checkReadOnly, friendlyClientError, getAccountBalances, getDepositHistory,
  getFuturesAccountSummary, getFuturesPositions, getMyTrades, hmacSha256Hex, setSocketFactoryForTests, signParams,
} from "../lib/binance-client-signed.ts";

const KEY = "test-api-key";
const SECRET = "test-api-secret";
const SPOT = "wss://ws-api.binance.com:443/ws-api/v3";
const FUTURES = "wss://ws-fapi.binance.com/ws-fapi/v1";

type Req = { id: string; method: string; params: Record<string, string | number | boolean> };
type Reply = { status: number; result?: unknown; error?: { code: number; msg: string } } | "silence";

class FakeSocket {
  static instances: FakeSocket[] = [];
  static handler: (req: Req, socket: FakeSocket) => Reply = () => ({ status: 200, result: {} });
  static failToOpen = false;
  sent: Req[] = [];
  closed = false;
  private listeners: Record<string, ((event: { data?: unknown }) => void)[]> = {};
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
    queueMicrotask(() => this.emit(FakeSocket.failToOpen ? "error" : "open", {}));
  }
  addEventListener(type: string, cb: (event: { data?: unknown }) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  emit(type: string, event: { data?: unknown }) {
    for (const cb of this.listeners[type] ?? []) cb(event);
  }
  send(data: string) {
    const req = JSON.parse(data) as Req;
    this.sent.push(req);
    const reply = FakeSocket.handler(req, this);
    if (reply !== "silence") queueMicrotask(() => this.emit("message", { data: JSON.stringify({ id: req.id, ...reply }) }));
  }
  close() {
    this.closed = true;
    this.emit("close", {});
  }
}

function setup(t: { after: (fn: () => void) => void }, handler: (req: Req, socket: FakeSocket) => Reply) {
  FakeSocket.instances = [];
  FakeSocket.handler = handler;
  FakeSocket.failToOpen = false;
  setSocketFactoryForTests((url) => new FakeSocket(url));
  t.after(() => setSocketFactoryForTests(null));
}

/** Recompute the signature the way Binance documents it, with node:crypto —
 *  an implementation independent of the one under test. */
const expectedSignature = (params: Record<string, unknown>) =>
  createHmac("sha256", SECRET)
    .update(Object.keys(params).filter((k) => k !== "signature").sort().map((k) => `${k}=${params[k]}`).join("&"))
    .digest("hex");

const ok = (result: unknown): Reply => ({ status: 200, result });
const fail = (code: number, msg: string): Reply => ({ status: 400, error: { code, msg } });

// ─── signing ──────────────────────────────────────────────────────────────

test("HMAC matches the test vector Binance publishes in its own API docs", async () => {
  const secret = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j";
  const payload = "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559";
  assert.equal(
    await hmacSha256Hex(payload, secret),
    "c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71",
  );
});

test("signParams sorts by name, joins without encoding, ignores any signature already present", async () => {
  const params = { timestamp: 1, apiKey: "K", symbol: "BTCUSDT", signature: "ignored" };
  assert.equal(await signParams(params, SECRET), expectedSignature(params));
  const payload = createHmac("sha256", SECRET).update("apiKey=K&symbol=BTCUSDT&timestamp=1").digest("hex");
  assert.equal(await signParams(params, SECRET), payload);
});

// ─── requests ─────────────────────────────────────────────────────────────

test("a spot read goes to the spot endpoint, correctly signed, and the secret never leaves in the message", async (t) => {
  setup(t, () => ok({ balances: [], updateTime: 1 }));
  await getAccountBalances(KEY, SECRET);
  const socket = FakeSocket.instances[0];
  assert.equal(socket.url, SPOT);
  const req = socket.sent[0];
  assert.equal(req.method, "account.status");
  assert.equal(req.params.apiKey, KEY);
  assert.ok(typeof req.params.timestamp === "number");
  assert.equal(req.params.signature, expectedSignature(req.params));
  assert.doesNotMatch(JSON.stringify(req), new RegExp(SECRET));
});

test("account.status balances: zero balances are dropped", async (t) => {
  setup(t, () => ok({ updateTime: 7, balances: [
    { asset: "BTC", free: "0.5", locked: "0" }, { asset: "ETH", free: "0", locked: "0" }, { asset: "USDT", free: "0", locked: "10" },
  ] }));
  const { balances, updateTime } = await getAccountBalances(KEY, SECRET);
  assert.equal(updateTime, 7);
  assert.deepEqual(balances.map((b) => b.asset), ["BTC", "USDT"]);
});

test("myTrades sends the symbol and limit", async (t) => {
  setup(t, () => ok([{ symbol: "BTCUSDT", price: "1", qty: "1", isBuyer: true, time: 1 }]));
  const trades = await getMyTrades(KEY, SECRET, "SOLUSDT", 500);
  assert.equal(trades.length, 1);
  const req = FakeSocket.instances[0].sent[0];
  assert.equal(req.method, "myTrades");
  assert.equal(req.params.symbol, "SOLUSDT");
  assert.equal(req.params.limit, 500);
  assert.equal(req.params.signature, expectedSignature(req.params));
});

test("futures reads go to the futures endpoint with the v2 methods", async (t) => {
  setup(t, (req) => (req.method === "v2/account.position" ? ok([{ symbol: "BTCUSDT" }]) : ok({ totalWalletBalance: "100" })));
  assert.equal((await getFuturesPositions(KEY, SECRET)).length, 1);
  assert.equal((await getFuturesAccountSummary(KEY, SECRET)).totalWalletBalance, "100");
  const socket = FakeSocket.instances[0];
  assert.equal(socket.url, FUTURES);
  assert.deepEqual(socket.sent.map((r) => r.method), ["v2/account.position", "v2/account.status"]);
});

test("deposit/withdrawal history is honestly unavailable, not silently empty", async () => {
  await assert.rejects(getDepositHistory(), /no se puede leer desde el navegador/);
});

// ─── connection handling ──────────────────────────────────────────────────

test("one connection is reused across calls", async (t) => {
  setup(t, () => ok({ balances: [], updateTime: 1 }));
  await getAccountBalances(KEY, SECRET);
  await getAccountBalances(KEY, SECRET);
  assert.equal(FakeSocket.instances.length, 1);
  assert.equal(FakeSocket.instances[0].sent.length, 2);
});

test("concurrent requests on one connection each get their own answer", async (t) => {
  setup(t, (req) => ok(req.method === "myTrades" ? [{ symbol: req.params.symbol }] : { balances: [], updateTime: 1 }));
  const [a, b] = await Promise.all([getMyTrades(KEY, SECRET, "AAAUSDT"), getMyTrades(KEY, SECRET, "BBBUSDT")]);
  assert.equal(a[0].symbol, "AAAUSDT");
  assert.equal(b[0].symbol, "BBBUSDT");
  assert.equal(FakeSocket.instances.length, 1);
});

test("after a connection closes, the next call opens a fresh one", async (t) => {
  setup(t, () => ok({ balances: [], updateTime: 1 }));
  await getAccountBalances(KEY, SECRET);
  FakeSocket.instances[0].close();
  await getAccountBalances(KEY, SECRET);
  assert.equal(FakeSocket.instances.length, 2);
});

test("a connection that can't be opened says so, in words a person can act on", async (t) => {
  setup(t, () => ok({}));
  FakeSocket.failToOpen = true;
  await assert.rejects(getAccountBalances(KEY, SECRET), /No se pudo abrir la conexión con Binance/);
});

test("no answer inside the timeout rejects instead of hanging forever", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  setup(t, () => "silence");
  const pending = getAccountBalances(KEY, SECRET);
  const assertion = assert.rejects(pending, /no respondió a tiempo/);
  // Signing is genuinely asynchronous (Web Crypto), so wait until the request
  // has actually gone out — and its timeout timer exists — before moving time.
  for (let i = 0; i < 200 && !FakeSocket.instances[0]?.sent.length; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(FakeSocket.instances[0].sent.length, 1, "the request should have been sent");
  t.mock.timers.tick(10_000);
  await assertion;
});

// ─── link check ───────────────────────────────────────────────────────────

function withPrice(t: { mock: { method: (obj: object, name: string, impl: (...a: never[]) => unknown) => void } }, price: string | null) {
  t.mock.method(globalThis, "fetch", (async () =>
    price === null ? new Response("nope", { status: 500 }) : new Response(JSON.stringify({ price }), { status: 200 })) as never);
}

test("read-only key: Binance refuses the test order with -2015, so trading is confirmed off", async (t) => {
  withPrice(t, "84000.5");
  setup(t, (req) => (req.method === "order.test" ? fail(-2015, "Invalid API-key, IP, or permissions for action.") : ok({ balances: [] })));
  const check = await checkReadOnly(KEY, SECRET);
  assert.equal(check.tradingProbe, "confirmado");
  assert.equal(check.enableSpotAndMarginTrading, false);
  const test = FakeSocket.instances[0].sent.find((r) => r.method === "order.test")!;
  // A well-formed order that clears every filter, so a refusal can only be about permission.
  assert.equal(test.params.price, "42000.25");
  assert.equal(test.params.quantity, "0.00029");
  assert.ok(Number(test.params.price) * Number(test.params.quantity) > 5, "above the minimum notional");
  assert.equal(test.params.signature, expectedSignature(test.params));
});

test("a key that CAN trade is rejected", async (t) => {
  withPrice(t, "84000.5");
  setup(t, (req) => (req.method === "order.test" ? ok({}) : ok({ balances: [] })));
  await assert.rejects(checkReadOnly(KEY, SECRET), /solo lectura/);
});

test("any other refusal is inconclusive — not a verdict, and not a reason to block a good key", async (t) => {
  withPrice(t, "84000.5");
  setup(t, (req) => (req.method === "order.test" ? fail(-1013, "Filter failure: PERCENT_PRICE_BY_SIDE") : ok({ balances: [] })));
  const check = await checkReadOnly(KEY, SECRET);
  assert.equal(check.tradingProbe, "inconcluso");
});

test("if the price can't be fetched the probe is skipped, and the key is still checked for reading", async (t) => {
  withPrice(t, null);
  setup(t, () => ok({ balances: [] }));
  const check = await checkReadOnly(KEY, SECRET);
  assert.equal(check.tradingProbe, "inconcluso");
  assert.deepEqual(FakeSocket.instances[0].sent.map((r) => r.method), ["account.status"]);
});

test("a bad key fails at the reading step, with a message that says what to check", async (t) => {
  withPrice(t, "84000.5");
  setup(t, () => fail(-2015, "Invalid API-key, IP, or permissions for action."));
  await assert.rejects(checkReadOnly(KEY, SECRET), (err: unknown) => {
    assert.ok(err instanceof BinanceClientError);
    assert.equal(err.code, -2015);
    assert.match(friendlyClientError(err), /no aceptó la API key/);
    return true;
  });
});

test("friendlyClientError translates the codes people actually hit", () => {
  assert.match(friendlyClientError(new BinanceClientError("x", 400, -1021)), /hora de tu computadora/);
  assert.match(friendlyClientError(new BinanceClientError("x", 400, -1022)), /firma no coincidió/);
  assert.match(friendlyClientError(new BinanceClientError("x", 400, -2014)), /formato de la API key/);
  assert.equal(friendlyClientError(new BinanceClientError("texto de Binance", 400, -9999)), "texto de Binance");
  assert.equal(friendlyClientError("no es un Error"), "No se pudo hablar con Binance.");
});

// ─── private futures stream ───────────────────────────────────────────────
import { FUTURES_USER_STREAM_URLS, pingFuturesUserStream, startFuturesUserStream } from "../lib/binance-client-signed.ts";

test("the private stream is started and kept alive with the API key alone — no signature, no secret", async (t) => {
  setup(t, (req) => (req.method === "userDataStream.start" ? ok({ listenKey: "LK123" }) : ok({ listenKey: "LK123" })));
  assert.equal(await startFuturesUserStream(KEY), "LK123");
  await pingFuturesUserStream(KEY);
  const socket = FakeSocket.instances[0];
  assert.equal(socket.url, FUTURES);
  assert.deepEqual(socket.sent.map((r) => r.method), ["userDataStream.start", "userDataStream.ping"]);
  for (const req of socket.sent) assert.deepEqual(req.params, { apiKey: KEY });
});

test("a start without a listen key is an error, not an empty stream", async (t) => {
  setup(t, () => ok({}));
  await assert.rejects(startFuturesUserStream(KEY), /clave del canal privado/);
});

test("the stream is read at the /private path first, the old path second", () => {
  assert.deepEqual(FUTURES_USER_STREAM_URLS("K"), ["wss://fstream.binance.com/private/ws/K", "wss://fstream.binance.com/ws/K"]);
});
