import assert from "node:assert/strict";
import test from "node:test";
import { fetchKlinesServer, resetKlinesServerState } from "../lib/klines-server.ts";

const row = (t: number) => [t, "1", "2", "0.5", "1.5", "10", t + 59_999, "15", 1, "5", "7", "0"];
function mock(handler: (url: string) => Response) {
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: string) => {
    calls.push(String(u));
    return handler(String(u));
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = real) };
}

test("spot 403 (blocked data centre): one spot try, then futures; next calls skip spot", async () => {
  resetKlinesServerState();
  const m = mock((u) => (u.includes("/fapi/") ? new Response(JSON.stringify([row(0), row(60_000)])) : new Response("blocked", { status: 403 })));
  try {
    const a = await fetchKlinesServer("BTCUSDT", "1m", { limit: 2 });
    assert.match(a.base, /fapi/);
    assert.equal(a.candles.length, 2);
    assert.equal(m.calls.filter((c) => c.includes("/api/v3/")).length, 1, "stops at the first 403 instead of trying 5 spot hosts");
    m.calls.length = 0;
    await fetchKlinesServer("ETHUSDT", "1m", { limit: 2 });
    assert.deepEqual(m.calls.map((c) => c.includes("/fapi/")), [true], "spot skipped while blocked");
  } finally {
    m.restore();
    resetKlinesServerState();
  }
});

test("spot working: unchanged; thin market only after spot and futures fail", async () => {
  resetKlinesServerState();
  let m = mock((u) => (u.includes("data-api") ? new Response(JSON.stringify([row(0)])) : new Response("x", { status: 500 })));
  try {
    assert.match((await fetchKlinesServer("BTCUSDT", "1m")).base, /data-api/);
  } finally {
    m.restore();
  }
  m = mock((u) => (u.includes("binance.us") ? new Response(JSON.stringify([row(0)])) : new Response("x", { status: 500 })));
  try {
    const r = await fetchKlinesServer("BTCUSDT", "1m", { allowThin: true });
    assert.equal(r.thin, true);
    assert.ok(m.calls.findIndex((c) => c.includes("/fapi/")) < m.calls.findIndex((c) => c.includes("binance.us")), "futures before the thin market");
    await assert.rejects(fetchKlinesServer("BTCUSDT", "1m"), /HTTP 500/, "without allowThin the thin market is never used");
  } finally {
    m.restore();
    resetKlinesServerState();
  }
});
