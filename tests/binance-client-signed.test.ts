import assert from "node:assert/strict";
import test from "node:test";
import {
  BinanceClientError, checkReadOnly, getAccountBalances, getFuturesAccountSummary, getFuturesPositions, getMyTrades,
} from "../lib/binance-client-signed.ts";

test("checkReadOnly accepts a properly read-only key and returns its restrictions", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ enableReading: true, enableSpotAndMarginTrading: false, enableWithdrawals: false }), { status: 200 }),
  );
  const r = await checkReadOnly("key", "secret");
  assert.deepEqual(r, { enableReading: true, enableSpotAndMarginTrading: false, enableWithdrawals: false });
});

test("checkReadOnly rejects a key with spot/margin trading enabled", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ enableReading: true, enableSpotAndMarginTrading: true, enableWithdrawals: false }), { status: 200 }),
  );
  await assert.rejects(checkReadOnly("key", "secret"), /solo lectura/);
});

test("checkReadOnly rejects a key with withdrawals enabled", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ enableReading: true, enableSpotAndMarginTrading: false, enableWithdrawals: true }), { status: 200 }),
  );
  await assert.rejects(checkReadOnly("key", "secret"), /solo lectura/);
});

test("checkReadOnly rejects a key with reading disabled", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ enableReading: false, enableSpotAndMarginTrading: false, enableWithdrawals: false }), { status: 200 }),
  );
  await assert.rejects(checkReadOnly("key", "secret"), /habilitada la lectura/);
});

test("the request is actually signed: a signature param is present and the API key goes in the header, not the URL", async (t) => {
  let capturedUrl = "";
  let capturedHeaders: HeadersInit | undefined;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    capturedUrl = url;
    capturedHeaders = init.headers;
    return new Response(JSON.stringify({ enableReading: true, enableSpotAndMarginTrading: false, enableWithdrawals: false }), { status: 200 });
  });
  await checkReadOnly("my-api-key", "my-secret");
  const parsed = new URL(capturedUrl);
  assert.ok(parsed.searchParams.has("signature"));
  assert.equal(parsed.searchParams.get("signature")!.length, 64, "HMAC-SHA256 en hex son 64 caracteres");
  assert.ok(parsed.searchParams.has("timestamp"));
  assert.equal((capturedHeaders as Record<string, string>)["X-MBX-APIKEY"], "my-api-key");
  assert.doesNotMatch(capturedUrl, /my-api-key/, "la api key nunca va en la URL, solo en el header");
});

test("getAccountBalances drops zero-balance assets", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response(
      JSON.stringify({
        updateTime: 123,
        balances: [
          { asset: "BTC", free: "0.5", locked: "0" },
          { asset: "ETH", free: "0", locked: "0" },
          { asset: "USDT", free: "0", locked: "10" },
        ],
      }),
      { status: 200 },
    ),
  );
  const { balances, updateTime } = await getAccountBalances("key", "secret");
  assert.equal(updateTime, 123);
  assert.deepEqual(
    balances.map((b) => b.asset),
    ["BTC", "USDT"],
  );
});

test("getMyTrades and futures calls pass through Binance's array/object shape unchanged", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.includes("myTrades")) return new Response(JSON.stringify([{ symbol: "BTCUSDT", price: "100", qty: "1", isBuyer: true, time: 1 }]), { status: 200 });
    if (url.includes("positionRisk")) return new Response(JSON.stringify([{ symbol: "BTCUSDT", positionAmt: "0.01" }]), { status: 200 });
    return new Response(JSON.stringify({ totalWalletBalance: "100" }), { status: 200 });
  });
  const trades = await getMyTrades("key", "secret", "BTCUSDT");
  assert.equal(trades.length, 1);
  const positions = await getFuturesPositions("key", "secret");
  assert.equal(positions.length, 1);
  const summary = await getFuturesAccountSummary("key", "secret");
  assert.equal(summary.totalWalletBalance, "100");
});

test("a non-JSON response (the WAF block page this whole module exists to avoid) throws BinanceClientError with the status", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>403 Forbidden</html>", { status: 403 }));
  await assert.rejects(checkReadOnly("key", "secret"), (err: unknown) => {
    assert.ok(err instanceof BinanceClientError);
    assert.equal(err.status, 403);
    return true;
  });
});

test("a genuine Binance JSON error surfaces its own message", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ code: -2015, msg: "Invalid API-key, IP, or permissions for action." }), { status: 401 }),
  );
  await assert.rejects(checkReadOnly("key", "secret"), (err: unknown) => {
    assert.ok(err instanceof BinanceClientError);
    assert.equal(err.status, 401);
    assert.equal(err.message, "Invalid API-key, IP, or permissions for action.");
    return true;
  });
});
