import assert from "node:assert/strict";
import test from "node:test";
import { coinbaseProduct, fetchKlinesServer, krakenPair, parseCoinbaseCandles, parseKrakenOhlc, resetKlinesServerState } from "../lib/klines-server.ts";

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
const isBinance = (u: string) => u.includes("binance");
/** Kraken's answer: hourly rows [time s, o, h, l, c, vwap, volume, count], oldest first. */
const kraken = (n: number, t0 = 1_791_000_000, key = "XXBTZUSD") =>
  JSON.stringify({ error: [], result: { [key]: Array.from({ length: n }, (_, i) => [t0 + i * 3600, "100", "101", "99", String(100 + i), "100.5", "2", 7]), last: t0 + (n - 1) * 3600 } });
/** Coinbase's answer: [time s, low, high, open, close, volume], newest first. */
const coinbase = (n: number, newest: number) => JSON.stringify(Array.from({ length: n }, (_, i) => [newest - i * 3600, 99, 101, 100, 100 + i, 3]));

test("spot 403 (blocked data centre): one try per firewall, then futures; next calls skip spot", async () => {
  resetKlinesServerState();
  const m = mock((u) => (u.includes("/fapi/") ? new Response(JSON.stringify([row(0), row(60_000)])) : new Response("blocked", { status: 403 })));
  try {
    const a = await fetchKlinesServer("BTCUSDT", "1m", { limit: 2 });
    assert.match(a.base, /fapi/);
    assert.equal(a.venue, "BINANCE_FUTURES");
    assert.equal(a.binance, "OK");
    assert.equal(a.candles.length, 2);
    assert.deepEqual(
      m.calls.filter((c) => c.includes("/api/v3/")).map((c) => new URL(c).host),
      ["data-api.binance.vision", "api-gcp.binance.com"],
      "one host behind Binance's CDN and api-gcp, which runs elsewhere — not the other four",
    );
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
    const r = await fetchKlinesServer("BTCUSDT", "1m");
    assert.match(r.base, /data-api/);
    assert.equal(r.venue, "BINANCE");
  } finally {
    m.restore();
  }
  m = mock((u) => (u.includes("binance.us") ? new Response(JSON.stringify([row(0)])) : new Response("x", { status: 500 })));
  try {
    const r = await fetchKlinesServer("BTCUSDT", "1m", { allowThin: true });
    assert.equal(r.thin, true);
    assert.equal(r.venue, "BINANCE_US");
    assert.equal(r.binance, "FALLA");
    assert.ok(m.calls.findIndex((c) => c.includes("/fapi/")) < m.calls.findIndex((c) => c.includes("binance.us")), "futures before the thin market");
    await assert.rejects(fetchKlinesServer("BTCUSDT", "1m"), /HTTP 500/, "without allowThin the thin market is never used");
    assert.ok(!m.calls.some((c) => c.includes("kraken") || c.includes("coinbase")), "other exchanges only when asked for");
  } finally {
    m.restore();
    resetKlinesServerState();
  }
});

test("Binance refuses the server: Kraken in dollars, with the reason; Binance is not asked again for a while", async () => {
  resetKlinesServerState();
  const m = mock((u) => (isBinance(u) ? new Response("blocked", { status: 403 }) : u.includes("kraken") ? new Response(kraken(720)) : new Response("x", { status: 500 })));
  try {
    const r = await fetchKlinesServer("BTCUSDT", "1h", { limit: 500, minCandles: 220, market: "futures", outside: true });
    assert.equal(r.venue, "KRAKEN");
    assert.equal(r.binance, "BLOQUEADO");
    assert.equal(r.thin, false);
    assert.equal(r.candles.length, 500, "the last 500 of Kraken's 720");
    const last = r.candles[499];
    assert.equal(last.openTime, (1_791_000_000 + 719 * 3600) * 1000, "seconds become milliseconds");
    assert.equal(last.close, 819);
    assert.equal(last.quoteVolume, 2 * 100.5, "quote volume = volume × vwap");
    const k = m.calls.find((c) => c.includes("kraken"))!;
    assert.match(k, /^https:\/\/api\.kraken\.com\/0\/public\/OHLC\?pair=XBTUSD&interval=60$/);
    assert.equal(m.calls.filter(isBinance).length, 3, "futures, spot and api-gcp: one 403 each");
    m.calls.length = 0;
    await fetchKlinesServer("ETHUSDT", "1h", { limit: 300, minCandles: 200, outside: true });
    assert.deepEqual(m.calls.map((c) => new URL(c).host), ["api.kraken.com"], "while blocked, straight to Kraken");
    await assert.rejects(fetchKlinesServer("ETHUSDT", "1h", { limit: 300 }), /Binance HTTP 403/, "without `outside` (volume readers) it fails and says why");
  } finally {
    m.restore();
    resetKlinesServerState();
  }
});

test("Kraken failing too: Coinbase, oldest first, two pages when more than one is asked for", async () => {
  resetKlinesServerState();
  const newest = 1_791_300_000;
  const m = mock((u) => {
    if (isBinance(u)) return new Response("blocked", { status: 451 });
    if (u.includes("kraken")) return new Response(JSON.stringify({ error: ["EGeneral:Too many requests"] }));
    if (u.includes("coinbase")) return new Response(u.includes("start=") ? coinbase(300, newest - 300 * 3600) : coinbase(300, newest));
    return new Response("x", { status: 500 });
  });
  try {
    const r = await fetchKlinesServer("SOLUSDT", "1h", { limit: 1000, minCandles: 260, market: "futures", outside: true });
    assert.equal(r.venue, "COINBASE");
    assert.equal(r.binance, "BLOQUEADO");
    assert.equal(r.candles.length, 600);
    assert.ok(r.candles.every((c, i) => i === 0 || c.openTime - r.candles[i - 1].openTime === 3_600_000), "ascending, no duplicates");
    assert.equal(r.candles[599].openTime, newest * 1000);
    const pages = m.calls.filter((c) => c.includes("coinbase"));
    assert.equal(pages.length, 2);
    assert.match(pages[0], /\/products\/SOL-USD\/candles\?granularity=3600$/);
    assert.match(pages[1], /&end=/);
  } finally {
    m.restore();
    resetKlinesServerState();
  }
});

test("nothing answers: the error lists what each exchange said", async () => {
  resetKlinesServerState();
  const m = mock((u) => (isBinance(u) ? new Response("blocked", { status: 403 }) : u.includes("kraken") ? new Response(JSON.stringify({ error: ["EQuery:Unknown asset pair"] })) : new Response(JSON.stringify({ message: "NotFound" }), { status: 404 })));
  try {
    await assert.rejects(fetchKlinesServer("BNBUSDT", "1h", { outside: true }), (e: Error) => {
      assert.match(e.message, /Binance HTTP 403/);
      assert.match(e.message, /Kraken: EQuery:Unknown asset pair/);
      assert.match(e.message, /Coinbase HTTP 404/);
      return true;
    });
  } finally {
    m.restore();
    resetKlinesServerState();
  }
});

test("gold and silver never leave Binance, even with `outside`", async () => {
  resetKlinesServerState();
  const m = mock(() => new Response("blocked", { status: 403 }));
  try {
    await assert.rejects(fetchKlinesServer("XAUUSDT", "1h", { outside: true, allowThin: true }), /HTTP 403/);
    assert.ok(m.calls.every((c) => c.includes("/fapi/")), m.calls.join("\n"));
    assert.equal(krakenPair("XAUUSDT"), null);
    assert.equal(coinbaseProduct("XAGUSDT"), null);
  } finally {
    m.restore();
    resetKlinesServerState();
  }
});

test("Kraken with startTime keeps Binance's meaning: from that candle on, never one before it", async () => {
  resetKlinesServerState();
  const t0 = 1_791_000_000;
  const rows = Array.from({ length: 720 }, (_, i) => [t0 + i * 60, "1", "1", "1", "1", "1", "1", 1]);
  const m = mock((u) => (isBinance(u) ? new Response("blocked", { status: 403 }) : new Response(JSON.stringify({ error: [], result: { XXBTZUSD: rows, last: 0 } }))));
  try {
    const start = (t0 + 600 * 60) * 1000;
    const r = await fetchKlinesServer("BTCUSDT", "1m", { limit: 50, startTime: start, outside: true });
    assert.equal(r.candles[0].openTime, start);
    assert.equal(r.candles.length, 50);
    assert.match(m.calls.at(-1)!, /interval=1$/);
  } finally {
    m.restore();
    resetKlinesServerState();
  }
});

test("names and parsers: Kraken's and Coinbase's pairs, errors and bad rows", () => {
  assert.equal(krakenPair("BTCUSDT"), "XBTUSD");
  assert.equal(krakenPair("DOGEUSDT"), "XDGUSD");
  assert.equal(krakenPair("ETHUSDT"), "ETHUSD");
  assert.equal(krakenPair("BTCUSDC"), null);
  assert.equal(coinbaseProduct("SUIUSDT"), "SUI-USD");
  assert.throws(() => parseKrakenOhlc({ error: ["EQuery:Unknown asset pair"] }), /Kraken: EQuery:Unknown asset pair/);
  const k = parseKrakenOhlc({ error: [], result: { XDGUSD: [[60, "1", "2", "0.5", "1.5", "0", "0", 0], [120, "1", "x", "1", "1", "1", "1", 1], [180, "1", "1", "2", "1", "1", "1", 1]], last: 120 } });
  assert.deepEqual(k, [{ openTime: 60_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 0, quoteVolume: 0 }], "a non-number and a high below the low are dropped");
  assert.throws(() => parseCoinbaseCandles({ message: "NotFound" }), /Coinbase: NotFound/);
  const c = parseCoinbaseCandles([[7200, 1, 3, 2, 2.5, 4], [3600, 1, 2, 1.5, 1.8, 2]]);
  assert.deepEqual(c.map((x) => x.openTime), [3_600_000, 7_200_000]);
  assert.equal(c[1].quoteVolume, 4 * ((3 + 1 + 2.5) / 3), "typical price × volume");
});

test("a stale source is skipped: an exchange that stopped trading a coin never passes for today's price", async () => {
  resetKlinesServerState();
  const now = Date.UTC(2026, 9, 7, 18, 30);
  const hour = Math.floor(now / 3_600_000) * 3_600_000;
  const oldEnd = Math.floor((hour - 100 * 3_600_000) / 1000);
  let coinbaseFresh = true;
  const m = mock((u) => {
    if (isBinance(u)) return new Response("blocked", { status: 403 });
    if (u.includes("kraken")) return new Response(kraken(300, oldEnd - 299 * 3600, "TONUSD"));
    return new Response(coinbase(300, coinbaseFresh ? Math.floor(hour / 1000) : oldEnd));
  });
  try {
    const opts = { limit: 300, minCandles: 200, outside: true, maxAgeMs: 3 * 3_600_000, now };
    assert.equal((await fetchKlinesServer("TONUSDT", "1h", opts)).venue, "COINBASE", "Kraken's candles end 100 hours ago");
    coinbaseFresh = false;
    await assert.rejects(fetchKlinesServer("TONUSDT", "1h", opts), (e: Error) => /Kraken: velas viejas/.test(e.message) && /Coinbase: velas viejas/.test(e.message));
    assert.equal((await fetchKlinesServer("TONUSDT", "1h", { ...opts, maxAgeMs: undefined })).venue, "KRAKEN", "without the check, the old behaviour");
  } finally {
    m.restore();
    resetKlinesServerState();
  }
});
