import { futuresStreamUrl } from "./binance-ws.ts";
import { parseAggTrade, type Trade } from "./footprint.ts";
import { parseForceOrder, parseKline, type LiveKline, type LiveLiquidation } from "./live-market.ts";

/**
 * The live price feed for the map, independent of React so it can be tested
 * against a fake socket and a fake network — the real Binance hosts are not
 * reachable from the build environment, and "it should work" was not good
 * enough after the first attempt shipped a frozen price under a green badge.
 *
 * Order of sources:
 *   1. Futures WebSocket on /market — real time.
 *   2. REST polling every 3 s: futures hosts first, then spot hosts. Spot is
 *      the last resort for networks where futures endpoints are blocked; its
 *      price differs from the perpetual by the basis, and the status says so.
 *
 * The status always names the source actually feeding the chart and when the
 * last update arrived. "En vivo" is only ever claimed on data received.
 */

export type FeedSource = "WS" | "REST FUTUROS" | "REST SPOT";
export type FeedState = "conectando" | "en vivo" | "demorado" | "sin conexión";
export type FeedStatus = { state: FeedState; source: FeedSource | null; lastUpdate: number | null };

type SocketLike = {
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  close: () => void;
};

export type FeedDeps = {
  createSocket: (url: string) => SocketLike;
  fetchJson: (url: string) => Promise<unknown>;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
};

export const FEED_TIMING = {
  flushMs: 1000,
  watchdogMs: 10_000,
  fallbackAfterMs: 6000,
  pollMs: 3000,
  staleAfterMs: 15_000,
};

export function startLiveFeed(
  opts: {
    symbol: string;
    timeframe: string;
    futuresBases: string[];
    spotBases: string[];
    onKline: (k: LiveKline) => void;
    onLiquidation: (l: LiveLiquidation) => void;
    onStatus: (s: FeedStatus) => void;
    /** Subscribe to individual trades too (for the footprint). */
    trades?: boolean;
    onTrade?: (t: Trade) => void;
  },
  deps: FeedDeps,
): () => void {
  const { symbol, timeframe } = opts;
  let closed = false;
  let socket: SocketLike | null = null;
  let socketLive = false;
  let failures = 0;
  let pollFailures = 0;
  let retry: unknown;
  let watchdog: unknown;
  let poller: unknown;
  let pending: LiveKline | null = null;
  let status: FeedStatus = { state: "conectando", source: null, lastUpdate: null };

  const report = (next: Partial<FeedStatus>) => {
    status = { ...status, ...next };
    opts.onStatus(status);
  };

  const receive = (k: LiveKline, source: FeedSource) => {
    pending = k;
    report({ state: "en vivo", source, lastUpdate: deps.now() });
  };

  const flush = deps.setInterval(() => {
    if (pending) {
      opts.onKline(pending);
      pending = null;
    }
    if (status.lastUpdate !== null && status.state === "en vivo" && deps.now() - status.lastUpdate > FEED_TIMING.staleAfterMs) {
      report({ state: "demorado" });
    }
  }, FEED_TIMING.flushMs);

  const parseRestRow = (rows: unknown): LiveKline | null => {
    const row = Array.isArray(rows) ? (rows[rows.length - 1] as unknown[]) : null;
    if (!Array.isArray(row)) return null;
    const k = {
      time: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
      takerBuy: Number.isFinite(Number(row[9])) ? Number(row[9]) : undefined,
      closed: false,
    };
    return [k.time, k.open, k.high, k.low, k.close].every((v) => Number.isFinite(v) && v > 0) ? k : null;
  };

  const poll = async () => {
    if (closed || socketLive) return;
    const q = `symbol=${symbol}&interval=${timeframe}&limit=1`;
    const attempts: [string, FeedSource][] = [
      ...opts.futuresBases.map((b) => [`${b}/fapi/v1/klines?${q}`, "REST FUTUROS"] as [string, FeedSource]),
      ...opts.spotBases.map((b) => [`${b}/api/v3/klines?${q}`, "REST SPOT"] as [string, FeedSource]),
    ];
    for (const [url, source] of attempts) {
      try {
        const k = parseRestRow(await deps.fetchJson(url));
        if (closed || socketLive) return;
        if (k) {
          pollFailures = 0;
          receive(k, source);
          return;
        }
      } catch {
        // Next source.
      }
    }
    pollFailures += 1;
    if (!socketLive && pollFailures >= 3) report({ state: "sin conexión" });
  };

  const startPolling = () => {
    if (poller !== undefined || closed) return;
    void poll();
    poller = deps.setInterval(() => void poll(), FEED_TIMING.pollMs);
  };
  const stopPolling = () => {
    if (poller !== undefined) deps.clearInterval(poller);
    poller = undefined;
  };

  const fallback = deps.setTimeout(() => {
    if (!socketLive) startPolling();
  }, FEED_TIMING.fallbackAfterMs);

  const connect = () => {
    if (closed) return;
    const key = symbol.toLowerCase();
    const ws = deps.createSocket(
      futuresStreamUrl([`${key}@kline_${timeframe}`, "!forceOrder@arr", ...(opts.trades ? [`${key}@aggTrade`] : [])]),
    );
    socket = ws;
    ws.onopen = () => {
      deps.clearTimeout(watchdog);
      watchdog = deps.setTimeout(() => {
        if (!socketLive && ws === socket) ws.close();
      }, FEED_TIMING.watchdogMs);
    };
    ws.onmessage = (event) => {
      if (closed || ws !== socket) return;
      let msg: { stream?: string; data?: unknown };
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (msg.stream?.includes("@kline_")) {
        const k = parseKline(msg.data);
        if (!k) return;
        if (!socketLive) {
          socketLive = true;
          failures = 0;
          deps.clearTimeout(watchdog);
          stopPolling();
        }
        receive(k, "WS");
      } else if (msg.stream?.includes("@aggTrade")) {
        const t = parseAggTrade(msg.data);
        if (t) opts.onTrade?.(t);
      } else if (msg.stream?.includes("forceOrder")) {
        const liq = parseForceOrder(msg.data);
        if (liq && liq.symbol === symbol) opts.onLiquidation(liq);
      }
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      if (closed || ws !== socket) return;
      deps.clearTimeout(watchdog);
      socketLive = false;
      failures += 1;
      if (failures >= 2) startPolling();
      retry = deps.setTimeout(connect, Math.min(15_000, 1000 + failures * 1500));
    };
  };
  connect();

  return () => {
    closed = true;
    deps.clearTimeout(retry);
    deps.clearTimeout(watchdog);
    deps.clearTimeout(fallback);
    deps.clearInterval(flush);
    stopPolling();
    socket?.close();
  };
}

/** Browser implementations of the dependencies. REST calls bypass every cache,
 *  because a cached candle is exactly a frozen price. */
export function browserFeedDeps(): FeedDeps {
  return {
    createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
    fetchJson: async (url) => {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    now: () => Date.now(),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id as number),
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (id) => window.clearInterval(id as number),
  };
}
