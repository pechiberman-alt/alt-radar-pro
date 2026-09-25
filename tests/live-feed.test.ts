import assert from "node:assert/strict";
import test from "node:test";
import { FEED_TIMING, startLiveFeed, type FeedDeps, type FeedStatus } from "../lib/live-feed.ts";

/** Manual clock: timers fire only when the test advances time. */
function harness(fetchImpl: (url: string) => Promise<unknown>) {
  let now = 1_758_000_000_000;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void; every?: number }>();
  const sockets: FakeSocket[] = [];
  const fetched: string[] = [];

  class FakeSocket {
    onopen: ((e?: unknown) => void) | null = null;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e?: unknown) => void) | null = null;
    onclose: ((e?: unknown) => void) | null = null;
    closed = false;
    url: string;
    // No parameter properties: the test runner strips types only.
    constructor(url: string) {
      this.url = url;
      sockets.push(this);
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      this.onclose?.();
    }
    open() {
      this.onopen?.();
    }
    kline(close: number, t = 1_758_000_000_000) {
      this.onmessage?.({
        data: JSON.stringify({ stream: "btcusdt@kline_1h", data: { k: { t, o: "100", h: "110", l: "90", c: String(close), v: "5", x: false } } }),
      });
    }
  }

  const deps: FeedDeps = {
    createSocket: (url) => new FakeSocket(url),
    fetchJson: (url) => {
      fetched.push(url);
      return fetchImpl(url);
    },
    now: () => now,
    setTimeout: (fn, ms) => {
      seq += 1;
      timers.set(seq, { at: now + ms, fn });
      return seq;
    },
    clearTimeout: (id) => void timers.delete(id as number),
    setInterval: (fn, ms) => {
      seq += 1;
      timers.set(seq, { at: now + ms, fn, every: ms });
      return seq;
    },
    clearInterval: (id) => void timers.delete(id as number),
  };

  const advance = async (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, t] = due;
      now = t.at;
      if (t.every) t.at += t.every;
      else timers.delete(id);
      t.fn();
      await new Promise((r) => setImmediate(r));
    }
    now = target;
    await new Promise((r) => setImmediate(r));
  };

  const klines: number[] = [];
  const statuses: FeedStatus[] = [];
  const stop = startLiveFeed(
    {
      symbol: "BTCUSDT",
      timeframe: "1h",
      futuresBases: ["https://fapi.test"],
      spotBases: ["https://spot.test"],
      onKline: (k) => klines.push(k.close),
      onLiquidation: () => undefined,
      onStatus: (s) => statuses.push(s),
    },
    deps,
  );
  return { sockets, fetched, advance, klines, statuses, stop, last: () => statuses.at(-1) };
}

const restRow = (close: number) => [[1_758_000_000_000, "100", "110", "90", String(close), "5"]];

test("the socket uses the routed /market URL", () => {
  const h = harness(async () => restRow(1));
  assert.match(h.sockets[0].url, /^wss:\/\/fstream\.binance\.com\/market\/stream\?streams=btcusdt@kline_1h\/!forceOrder@arr$/);
  h.stop();
});

test("an open socket that delivers nothing is not called live", async () => {
  const h = harness(async () => {
    throw new Error("offline");
  });
  h.sockets[0].open();
  await h.advance(2000);
  assert.notEqual(h.last()?.state, "en vivo");
  h.stop();
});

test("live is claimed on the first candle, and the price reaches the chart", async () => {
  const h = harness(async () => restRow(1));
  h.sockets[0].open();
  h.sockets[0].kline(84_389);
  assert.equal(h.last()?.state, "en vivo");
  assert.equal(h.last()?.source, "WS");
  await h.advance(FEED_TIMING.flushMs);
  assert.deepEqual(h.klines, [84_389]);
  h.sockets[0].kline(84_402);
  await h.advance(FEED_TIMING.flushMs);
  assert.deepEqual(h.klines, [84_389, 84_402], "cada vela nueva llega");
  h.stop();
});

test("a silent socket falls back to REST futures and the price keeps moving", async () => {
  let price = 84_000;
  const h = harness(async (url) => {
    if (url.startsWith("https://fapi.test")) return restRow((price += 5));
    throw new Error("unused");
  });
  h.sockets[0].open();
  await h.advance(FEED_TIMING.fallbackAfterMs + FEED_TIMING.flushMs);
  assert.equal(h.last()?.source, "REST FUTUROS");
  await h.advance(FEED_TIMING.pollMs * 2);
  assert.ok(h.klines.length >= 2);
  assert.notEqual(h.klines[0], h.klines.at(-1), "el precio cambia entre sondeos");
  h.stop();
});

test("with futures blocked, spot keeps the chart alive and says so", async () => {
  const h = harness(async (url) => {
    if (url.startsWith("https://spot.test")) return restRow(84_100);
    throw new Error("blocked");
  });
  h.sockets[0].onclose?.(); // socket refused
  await h.advance(FEED_TIMING.fallbackAfterMs + FEED_TIMING.flushMs);
  assert.equal(h.last()?.source, "REST SPOT");
  assert.deepEqual(h.klines.slice(0, 1), [84_100]);
  h.stop();
});

test("the watchdog closes a silent socket and a new one is opened", async () => {
  const h = harness(async () => restRow(1));
  h.sockets[0].open();
  await h.advance(FEED_TIMING.watchdogMs + 5000);
  assert.ok(h.sockets[0].closed);
  assert.ok(h.sockets.length >= 2, "reconecta");
  h.stop();
});

test("once the socket delivers, polling stops", async () => {
  const h = harness(async () => restRow(1));
  await h.advance(FEED_TIMING.fallbackAfterMs + 100);
  const before = h.fetched.length;
  h.sockets.at(-1)!.open();
  h.sockets.at(-1)!.kline(84_500);
  await h.advance(FEED_TIMING.pollMs * 3);
  assert.equal(h.fetched.length, before, "no vuelve a sondear con el socket vivo");
  h.stop();
});

test("updates that stop arriving turn the badge to delayed", async () => {
  const h = harness(async () => {
    throw new Error("offline");
  });
  h.sockets[0].open();
  h.sockets[0].kline(84_000);
  // Keep the socket from being treated as dead: it is open, just silent now.
  await h.advance(FEED_TIMING.staleAfterMs + 2000);
  assert.equal(h.last()?.state, "demorado");
  h.stop();
});

test("everything down ends as 'sin conexión', never as live", async () => {
  const h = harness(async () => {
    throw new Error("offline");
  });
  h.sockets[0].onclose?.();
  await h.advance(FEED_TIMING.fallbackAfterMs + FEED_TIMING.pollMs * 4);
  assert.equal(h.last()?.state, "sin conexión");
  assert.deepEqual(h.klines, []);
  h.stop();
});

test("the trade stream is added only when asked for", async () => {
  const { startLiveFeed } = await import("../lib/live-feed.ts");
  const urls: string[] = [];
  const noop = () => undefined;
  const deps = {
    createSocket: (url: string) => {
      urls.push(url);
      return { onopen: null, onmessage: null, onerror: null, onclose: null, close: noop };
    },
    fetchJson: async () => [],
    now: () => 0,
    setTimeout: () => 0,
    clearTimeout: noop,
    setInterval: () => 0,
    clearInterval: noop,
  };
  const base = { symbol: "BTCUSDT", timeframe: "1m", futuresBases: [], spotBases: [], onKline: noop, onLiquidation: noop, onStatus: noop };
  startLiveFeed(base, deps)();
  startLiveFeed({ ...base, trades: true }, deps)();
  assert.doesNotMatch(urls[0], /aggTrade/);
  assert.match(urls[1], /btcusdt@aggTrade$/);
});
