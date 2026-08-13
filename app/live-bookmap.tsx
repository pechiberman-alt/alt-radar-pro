"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BrainTimeframe } from "@/lib/market-brain";
import type { LiquiditySnapshot } from "@/lib/liquidity-history";
import BookmapTimeframeChart from "./bookmap-timeframe-chart";
import MarketBrain from "./market-brain";

type Level = [number, number];
type Trade = {
  price: number;
  qty: number;
  notional: number;
  buyerMaker: boolean;
  time: number;
};
type TapeTrade = Trade & { large: boolean };
type Liquidation = {
  time: number;
  side: "LONG" | "SHORT";
  price: number;
  qty: number;
  notional: number;
};
type Frame = {
  bids: Level[];
  asks: Level[];
  trades: Trade[];
  mid: number;
  time: number;
};
type Metrics = {
  levels: number;
  trades: number;
  frames: number;
  imbalance: number;
  spread: number;
  buyQty: number;
  sellQty: number;
  buyNotional: number;
  sellNotional: number;
  bid: number;
  ask: number;
  latency: number | null;
  velocity: number;
};
type AltseasonContext = {
  score: number | null;
  raw: number | null;
  adjustment: number;
  state: string;
};
type FlowEvent = {
  id: string;
  time: number;
  type: "WALL" | "SWEEP" | "ABSORPTION" | "LARGE TRADE";
  side: "BUY" | "SELL";
  price: number;
  notional: number;
  detail: string;
};
type Wall = {
  side: "BID" | "ASK";
  price: number;
  qty: number;
  notional: number;
  strength: number;
  distance: number;
  persistence: number;
};
type FootprintRow = {
  price: number;
  buy: number;
  sell: number;
};
type HoverPoint = {
  x: number;
  y: number;
  price: number;
  time: number;
  liquidity: number;
  canvasWidth: number;
};
type ViewState = {
  low: number;
  high: number;
  plotTop: number;
  plotBottom: number;
  plotLeft: number;
  plotRight: number;
  columnWidth: number;
  frames: Frame[];
  maxPanOffset: number;
};
type ChartGesture =
  | {
      kind: "drag";
      pointerId: number;
      startX: number;
      startY: number;
      startPanOffset: number;
      startPricePan: number;
    }
  | {
      kind: "pinch";
      pointerIds: [number, number];
      startDistance: number;
      startTimeZoom: number;
      startPriceZoom: number;
    };

const EMPTY_METRICS: Metrics = {
  levels: 0,
  trades: 0,
  frames: 0,
  imbalance: 50,
  spread: 0,
  buyQty: 0,
  sellQty: 0,
  buyNotional: 0,
  sellNotional: 0,
  bid: 0,
  ask: 0,
  latency: null,
  velocity: 0,
};

const LIQUIDITY_WINDOW_MS: Record<BrainTimeframe, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

const LIQUIDITY_FRAME_LABEL: Record<BrainTimeframe, string> = {
  "5m": "5M",
  "15m": "15M",
  "1h": "1H",
  "4h": "4H",
  "1d": "1D",
};

const base = (symbol: string) => symbol.replace("USDT", "");
const clamp = (value: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, value));
const priceLabel = (value: number) =>
  value >= 1000
    ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : value >= 1
      ? value.toFixed(3)
      : value.toPrecision(6);
const usdLabel = (value: number) =>
  `${value < 0 ? "-" : ""}$${new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: Math.abs(value) >= 1_000_000 ? 2 : 1,
  }).format(Math.abs(value))}`;
const footprintNumber = (value: number) =>
  `$${new Intl.NumberFormat("en", {
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 1_000 ? 1 : 0,
  }).format(Math.abs(value))}`;
const signed = (value: number, digits = 1) =>
  `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
const wallStrengthLabel = (value: number) =>
  value >= 99 ? "99×+" : `${value.toFixed(1)}×`;

function percentile(values: number[], quantile: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * quantile)));
  return sorted[index];
}

function currentWalls(
  book: { bids: Level[]; asks: Level[] },
  frames: Frame[],
): Wall[] {
  if (!book.bids.length || !book.asks.length) return [];
  const mid = (book.bids[0][0] + book.asks[0][0]) / 2;
  const candidates = [
    ...book.bids.map(([price, qty]) => ({ side: "BID" as const, price, qty })),
    ...book.asks.map(([price, qty]) => ({ side: "ASK" as const, price, qty })),
  ].map((level) => ({ ...level, notional: level.price * level.qty }));
  const notionals = candidates.map((level) => level.notional);
  const baseline = Math.max(percentile(notionals, 0.6), 1);
  const threshold = Math.max(baseline * 2.15, percentile(notionals, 0.82));
  const history = frames.slice(-60);

  return candidates
    .filter((level) => level.notional >= threshold)
    .sort((left, right) => right.notional - left.notional)
    .slice(0, 6)
    .map((level) => {
      const appearances = history.filter((frame) => {
        const levels = level.side === "BID" ? frame.bids : frame.asks;
        return levels.some(
          ([price, qty]) =>
            Math.abs(price - level.price) <= Math.max(level.price * 1e-8, Number.EPSILON) &&
            price * qty >= level.notional * 0.4,
        );
      }).length;
      return {
        ...level,
        strength: level.notional / baseline,
        distance: ((level.price / mid) - 1) * 100,
        persistence: history.length ? (appearances / history.length) * 100 : 0,
      };
    });
}

function footprintRows(trades: Trade[], mid: number, spread: number): FootprintRow[] {
  if (!trades.length || !mid) return [];
  const step = Math.max(spread, mid * 0.00015, Number.EPSILON);
  const rows = new Map<number, { buy: number; sell: number }>();
  trades.forEach((trade) => {
    const bucket = Math.round(trade.price / step) * step;
    const current = rows.get(bucket) ?? { buy: 0, sell: 0 };
    if (trade.buyerMaker) current.sell += trade.notional;
    else current.buy += trade.notional;
    rows.set(bucket, current);
  });
  return [...rows.entries()]
    .map(([price, value]) => ({ price, ...value }))
    .sort((left, right) => right.price - left.price)
    .slice(0, 14);
}

function depthWithCumulative(levels: Level[]) {
  let cumulative = 0;
  return levels.map(([price, qty]) => {
    const notional = price * qty;
    cumulative += notional;
    return { price, qty, notional, cumulative };
  });
}

export default function LiveBookmap({
  symbols,
  altseason,
}: {
  symbols: string[];
  altseason: AltseasonContext;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const framesRef = useRef<Frame[]>([]);
  const bookRef = useRef<{ bids: Level[]; asks: Level[] }>({ bids: [], asks: [] });
  const pendingTradesRef = useRef<Trade[]>([]);
  const tapeRef = useRef<Trade[]>([]);
  const cvdRef = useRef<{ time: number; value: number }[]>([]);
  const liquidationsRef = useRef<Liquidation[]>([]);
  const latencyRef = useRef<number[]>([]);
  const eventCooldownRef = useRef(new Map<string, number>());
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const viewRef = useRef<ViewState | null>(null);
  const pointerPositionsRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<ChartGesture | null>(null);
  const totalsRef = useRef({
    trades: 0,
    buyQty: 0,
    sellQty: 0,
    buyNotional: 0,
    sellNotional: 0,
  });

  const [symbol, setSymbol] = useState("BTCUSDT");
  const [venue, setVenue] = useState<"spot" | "futures">("spot");
  const [futuresSymbols, setFuturesSymbols] = useState<string[]>([]);
  const [status, setStatus] = useState<"conectando" | "en vivo" | "no disponible">(
    "conectando",
  );
  const [reconnects, setReconnects] = useState(0);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [started, setStarted] = useState("");
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [ladder, setLadder] = useState<{ bids: Level[]; asks: Level[] }>({
    bids: [],
    asks: [],
  });
  const [tape, setTape] = useState<TapeTrade[]>([]);
  const [footprintTrades, setFootprintTrades] = useState<Trade[]>([]);
  const [liquidations, setLiquidations] = useState<Liquidation[]>([]);
  const [events, setEvents] = useState<FlowEvent[]>([]);
  const [walls, setWalls] = useState<Wall[]>([]);
  const [hover, setHover] = useState<HoverPoint | null>(null);
  const [sampleMs, setSampleMs] = useState(500);
  const [depth, setDepth] = useState(20);
  const [historySize, setHistorySize] = useState(180);
  const [rangePct, setRangePct] = useState<"auto" | number>("auto");
  const [scale, setScale] = useState<"log" | "linear">("log");
  const [showTrades, setShowTrades] = useState(true);
  const [showCvd, setShowCvd] = useState(true);
  const [showWalls, setShowWalls] = useState(true);
  const [showFootprintNumbers, setShowFootprintNumbers] = useState(true);
  const [sidePanel, setSidePanel] = useState<"dom" | "tape" | "alerts">("dom");
  const [marketTimeframe, setMarketTimeframe] = useState<BrainTimeframe>("4h");
  const [liquidityHistory, setLiquidityHistory] = useState<Frame[]>([]);
  const [liquidityCoverage, setLiquidityCoverage] = useState({ minutes: 0, samples: 0 });
  const [liquidityArchiveStatus, setLiquidityArchiveStatus] = useState<"loading" | "recording" | "unavailable">("loading");
  const [timeZoom, setTimeZoom] = useState(1);
  const [priceZoom, setPriceZoom] = useState(1);
  const [panOffset, setPanOffset] = useState(0);
  const [pricePan, setPricePan] = useState(0);
  const [draggingChart, setDraggingChart] = useState(false);


  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const load = async (quiet = false) => {
      if (!quiet) setLiquidityArchiveStatus("loading");
      try {
        const response = await fetch(
          `/api/liquidity-history?symbol=${encodeURIComponent(symbol)}&venue=${venue}&hours=24`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) throw new Error();
        const payload = await response.json() as {
          snapshots?: LiquiditySnapshot[];
          coverage?: { minutes?: number; samples?: number };
        };
        if (!alive) return;
        const frames = (payload.snapshots ?? [])
          .map((snapshot) => ({
            bids: snapshot.bids as Level[],
            asks: snapshot.asks as Level[],
            trades: [],
            mid: snapshot.mid,
            time: Date.parse(snapshot.capturedAt),
          }))
          .filter((frame) => Number.isFinite(frame.time) && frame.bids.length && frame.asks.length);
        setLiquidityHistory(frames);
        setLiquidityCoverage({
          minutes: Number(payload.coverage?.minutes ?? 0),
          samples: Number(payload.coverage?.samples ?? frames.length),
        });
        setLiquidityArchiveStatus("recording");
      } catch {
        if (!alive || controller.signal.aborted) return;
        setLiquidityArchiveStatus("unavailable");
      }
    };
    void load();
    const refresh = window.setInterval(() => void load(true), 60_000);
    return () => {
      alive = false;
      controller.abort();
      window.clearInterval(refresh);
    };
  }, [symbol, venue]);

  useEffect(() => {
    let stopped = false;
    const upload = async () => {
      const book = bookRef.current;
      if (
        stopped ||
        pausedRef.current ||
        status !== "en vivo" ||
        book.bids.length < 5 ||
        book.asks.length < 5
      ) return;
      const mid = (book.bids[0][0] + book.asks[0][0]) / 2;
      try {
        const response = await fetch("/api/liquidity-history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol,
            venue,
            capturedAt: new Date().toISOString(),
            mid,
            bids: book.bids.slice(0, 20),
            asks: book.asks.slice(0, 20),
          }),
        });
        if (response.ok && !stopped) setLiquidityArchiveStatus("recording");
      } catch {
        if (!stopped) setLiquidityArchiveStatus("unavailable");
      }
    };
    const first = window.setTimeout(() => void upload(), 12_000);
    const interval = window.setInterval(() => void upload(), 60_000);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [symbol, venue, status]);

  useEffect(() => {
    let alive = true;
    fetch("https://fapi.binance.com/fapi/v1/exchangeInfo")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: { symbols?: { symbol: string; quoteAsset: string; status: string }[] }) => {
        if (!alive) return;
        setFuturesSymbols(
          (data.symbols ?? [])
            .filter((item) => item.quoteAsset === "USDT" && item.status === "TRADING")
            .map((item) => item.symbol),
        );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    framesRef.current = [];
    bookRef.current = { bids: [], asks: [] };
    pendingTradesRef.current = [];
    tapeRef.current = [];
    cvdRef.current = [];
    liquidationsRef.current = [];
    latencyRef.current = [];
    eventCooldownRef.current.clear();
    totalsRef.current = {
      trades: 0,
      buyQty: 0,
      sellQty: 0,
      buyNotional: 0,
      sellNotional: 0,
    };
    const resetTimer = setTimeout(() => {
      setStatus("conectando");
      setReconnects(0);
      setStarted(new Date().toLocaleTimeString());
      setMetrics(EMPTY_METRICS);
      setLadder({ bids: [], asks: [] });
      setTape([]);
      setFootprintTrades([]);
      setLiquidations([]);
      setEvents([]);
      setWalls([]);
    }, 0);

    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    let watchdog: ReturnType<typeof setTimeout>;
    let activeSocket: WebSocket | null = null;
    let failures = 0;
    const key = symbol.toLowerCase();

    const connect = (host: string) => {
      if (closed) return;
      const streams = `${key}@depth${depth}@100ms/${key}@${venue === "futures" ? "trade" : "aggTrade"}${venue === "futures" ? `/${key}@forceOrder` : ""}`;
      const socket = new WebSocket(`${host}/stream?streams=${streams}`);
      activeSocket = socket;
      let receivedDepth = false;
      watchdog = setTimeout(() => {
        if (!receivedDepth) socket.close();
      }, 9_000);

      socket.onmessage = (event) => {
        if (closed || socket !== activeSocket) return;
        try {
          const message = JSON.parse(event.data);
          const data = message.data ?? message;
          const rawBids = data?.b ?? data?.bids;
          const rawAsks = data?.a ?? data?.asks;

          if (Array.isArray(rawBids) && Array.isArray(rawAsks)) {
            const bids = rawBids
              .map((item: unknown[]) => [Number(item?.[0]), Number(item?.[1])] as Level)
              .filter(
                ([price, qty]) =>
                  Number.isFinite(price) && Number.isFinite(qty) && price > 0 && qty > 0,
              )
              .sort((left, right) => right[0] - left[0]);
            const asks = rawAsks
              .map((item: unknown[]) => [Number(item?.[0]), Number(item?.[1])] as Level)
              .filter(
                ([price, qty]) =>
                  Number.isFinite(price) && Number.isFinite(qty) && price > 0 && qty > 0,
              )
              .sort((left, right) => left[0] - right[0]);

            if (bids.length && asks.length) {
              const bestBid = bids[0][0];
              const bestAsk = asks[0][0];
              const mid = (bestBid + bestAsk) / 2;
              const spread = (bestAsk - bestBid) / mid;
              const previousMid =
                framesRef.current.at(-1)?.mid ?? tapeRef.current.at(-1)?.price ?? 0;
              const consistent = !previousMid || Math.abs((mid / previousMid) - 1) < 0.12;
              if (bestBid < bestAsk && spread >= 0 && spread < 0.08 && consistent) {
                const floor = mid * 0.75;
                const ceiling = mid * 1.25;
                const cleanBids = bids.filter(
                  ([price]) => price >= floor && price <= bestBid,
                );
                const cleanAsks = asks.filter(
                  ([price]) => price >= bestAsk && price <= ceiling,
                );
                if (cleanBids.length && cleanAsks.length) {
                  bookRef.current = { bids: cleanBids, asks: cleanAsks };
                  receivedDepth = true;
                  failures = 0;
                  setStatus("en vivo");
                }
              }
            }
          } else if (data?.e === "aggTrade" || data?.e === "trade") {
            const price = Number(data.p);
            const qty = Number(data.q);
            const tradeTime = Number(data.T || data.E) || Date.now();
            if (price > 0 && qty > 0) {
              const trade: Trade = {
                price,
                qty,
                notional: price * qty,
                buyerMaker: Boolean(data.m),
                time: tradeTime,
              };
              pendingTradesRef.current.push(trade);
              tapeRef.current.push(trade);
              if (pendingTradesRef.current.length > 300) pendingTradesRef.current.shift();
              if (tapeRef.current.length > 500) tapeRef.current.shift();
              totalsRef.current.trades += 1;
              if (trade.buyerMaker) {
                totalsRef.current.sellQty += qty;
                totalsRef.current.sellNotional += trade.notional;
              } else {
                totalsRef.current.buyQty += qty;
                totalsRef.current.buyNotional += trade.notional;
              }
              const eventTime = Number(data.E || data.T);
              if (eventTime > 0) {
                latencyRef.current.push(Math.max(0, Date.now() - eventTime));
                if (latencyRef.current.length > 40) latencyRef.current.shift();
              }
            }
          } else if (data?.e === "forceOrder" && data.o) {
            const price = Number(data.o.ap || data.o.p);
            const qty = Number(data.o.z || data.o.q);
            if (price > 0 && qty > 0) {
              liquidationsRef.current.push({
                time: Number(data.o.T || data.E) || Date.now(),
                side: data.o.S === "SELL" ? "LONG" : "SHORT",
                price,
                qty,
                notional: price * qty,
              });
              if (liquidationsRef.current.length > 80) liquidationsRef.current.shift();
            }
          }
        } catch {
          return;
        }
      };

      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (socket !== activeSocket) return;
        clearTimeout(watchdog);
        activeSocket = null;
        if (closed) return;
        failures += 1;
        setReconnects(failures);
        setStatus(failures >= 4 ? "no disponible" : "conectando");
        const next =
          venue === "futures"
            ? "wss://fstream.binance.com"
            : host.includes("stream.binance.com")
              ? "wss://data-stream.binance.vision"
              : "wss://stream.binance.com:9443";
        retry = setTimeout(() => connect(next), Math.min(5_000, 900 + failures * 450));
      };
    };

    connect(
      venue === "futures"
        ? "wss://fstream.binance.com"
        : "wss://stream.binance.com:9443",
    );

    return () => {
      closed = true;
      clearTimeout(retry);
      clearTimeout(watchdog);
      clearTimeout(resetTimer);
      activeSocket?.close();
      activeSocket = null;
    };
  }, [symbol, venue, depth]);

  useEffect(() => {
    const recordEvent = (event: Omit<FlowEvent, "id" | "time">, key: string, cooldown: number) => {
      const now = Date.now();
      const previous = eventCooldownRef.current.get(key) ?? 0;
      if (now - previous < cooldown) return;
      eventCooldownRef.current.set(key, now);
      const next = { ...event, id: `${key}-${now}`, time: now };
      setEvents((current) => [next, ...current].slice(0, 24));
    };

    const capture = setInterval(() => {
      if (pausedRef.current) return;
      const book = bookRef.current;
      if (!book.bids.length || !book.asks.length) return;

      const trades = pendingTradesRef.current.splice(0);
      const bid = book.bids[0][0];
      const ask = book.asks[0][0];
      const mid = (bid + ask) / 2;
      const previousMid = framesRef.current.at(-1)?.mid ?? mid;
      framesRef.current.push({
        bids: book.bids.slice(0, depth).map((level) => [...level] as Level),
        asks: book.asks.slice(0, depth).map((level) => [...level] as Level),
        trades,
        mid,
        time: Date.now(),
      });
      if (framesRef.current.length > historySize) framesRef.current.shift();

      const cvd = totalsRef.current.buyNotional - totalsRef.current.sellNotional;
      cvdRef.current.push({ time: Date.now(), value: cvd });
      if (cvdRef.current.length > historySize) cvdRef.current.shift();

      const bidNotional = book.bids.reduce((sum, [price, qty]) => sum + price * qty, 0);
      const askNotional = book.asks.reduce((sum, [price, qty]) => sum + price * qty, 0);
      const totalBook = bidNotional + askNotional;
      const recent = tapeRef.current.slice(-180);
      const tradeNotionals = recent.map((item) => item.notional);
      const largeAt = percentile(tradeNotionals, 0.9);
      const averageTrade = tradeNotionals.length
        ? tradeNotionals.reduce((sum, value) => sum + value, 0) / tradeNotionals.length
        : 0;
      const tapeRows = recent
        .slice(-28)
        .reverse()
        .map((trade) => ({
          ...trade,
          large: recent.length >= 10 && trade.notional >= largeAt,
        }));
      setTape(tapeRows);
      setFootprintTrades(recent.slice(-240));
      setLiquidations(liquidationsRef.current.slice(-12).reverse());
      setLadder({ bids: book.bids.slice(0, 12), asks: book.asks.slice(0, 12) });

      const latency = latencyRef.current.length
        ? latencyRef.current.reduce((sum, value) => sum + value, 0) /
          latencyRef.current.length
          : null;
      const recentFrames = framesRef.current.slice(-20);
      const velocity =
        recentFrames.length > 1
          ? ((recentFrames.at(-1)!.mid / recentFrames[0].mid) - 1) * 100
          : 0;
      setMetrics({
        levels: book.bids.length + book.asks.length,
        trades: totalsRef.current.trades,
        frames: framesRef.current.length,
        imbalance: totalBook ? (bidNotional / totalBook) * 100 : 50,
        spread: mid ? ((ask - bid) / mid) * 100 : 0,
        buyQty: totalsRef.current.buyQty,
        sellQty: totalsRef.current.sellQty,
        buyNotional: totalsRef.current.buyNotional,
        sellNotional: totalsRef.current.sellNotional,
        bid,
        ask,
        latency,
        velocity,
      });

      const walls = currentWalls(book, framesRef.current);
      setWalls(walls);
      const strongestWall = walls[0];
      if (strongestWall && strongestWall.strength >= 3.2) {
        recordEvent(
          {
            type: "WALL",
            side: strongestWall.side === "BID" ? "BUY" : "SELL",
            price: strongestWall.price,
            notional: strongestWall.notional,
            detail: `${wallStrengthLabel(strongestWall.strength)} vs P60 · persistencia ${strongestWall.persistence.toFixed(0)}%`,
          },
          `wall-${strongestWall.side}-${strongestWall.price}`,
          30_000,
        );
      }

      if (trades.length) {
        const sampleBuy = trades
          .filter((trade) => !trade.buyerMaker)
          .reduce((sum, trade) => sum + trade.notional, 0);
        const sampleSell = trades
          .filter((trade) => trade.buyerMaker)
          .reduce((sum, trade) => sum + trade.notional, 0);
        const sampleTotal = sampleBuy + sampleSell;
        const buyShare = sampleTotal ? sampleBuy / sampleTotal : 0.5;
        const priceMove = previousMid ? Math.abs((mid / previousMid) - 1) : 0;
        const dominantBuy = buyShare >= 0.86;
        const dominantSell = buyShare <= 0.14;
        const unusual = averageTrade > 0 && sampleTotal >= averageTrade * 4;

        if (unusual && (dominantBuy || dominantSell) && trades.length >= 3) {
          recordEvent(
            {
              type: "SWEEP",
              side: dominantBuy ? "BUY" : "SELL",
              price: mid,
              notional: sampleTotal,
              detail: `${Math.round((dominantBuy ? buyShare : 1 - buyShare) * 100)}% agresión en la muestra`,
            },
            `sweep-${dominantBuy ? "buy" : "sell"}`,
            8_000,
          );
        }

        const opposingWall = walls.find((wall) =>
          dominantBuy ? wall.side === "ASK" : wall.side === "BID",
        );
        if (
          unusual &&
          priceMove < 0.00012 &&
          (dominantBuy || dominantSell) &&
          opposingWall &&
          opposingWall.strength >= 2.5
        ) {
          recordEvent(
            {
              type: "ABSORPTION",
              side: dominantBuy ? "SELL" : "BUY",
              price: opposingWall.price,
              notional: sampleTotal,
              detail: "Posible absorción: agresión elevada sin desplazamiento proporcional",
            },
            `absorption-${dominantBuy ? "ask" : "bid"}`,
            15_000,
          );
        }

        const largestTrade = [...trades].sort(
          (left, right) => right.notional - left.notional,
        )[0];
        if (recent.length >= 10 && largestTrade.notional >= largeAt) {
          recordEvent(
            {
              type: "LARGE TRADE",
              side: largestTrade.buyerMaker ? "SELL" : "BUY",
              price: largestTrade.price,
              notional: largestTrade.notional,
              detail: "Operación grande relativa al percentil 90 de la sesión",
            },
            `large-${largestTrade.buyerMaker ? "sell" : "buy"}-${Math.round(largestTrade.price * 1e6)}`,
            5_000,
          );
        }
      }
    }, sampleMs);

    return () => clearInterval(capture);
  }, [sampleMs, historySize, depth]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let animation = 0;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const width = Math.max(320, rect.width);
      const height = Math.max(380, rect.height);
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.fillStyle = "#030a08";
      context.fillRect(0, 0, width, height);

      const liveFrames = framesRef.current.slice(-historySize);
      const windowStart = Date.now() - LIQUIDITY_WINDOW_MS[marketTimeframe];
      const archivedFrames = liquidityHistory.filter((frame) => frame.time >= windowStart);
      const allFrames = [...archivedFrames, ...liveFrames]
        .sort((left, right) => left.time - right.time)
        .filter((frame, index, values) =>
          index === 0 || frame.time - values[index - 1].time >= 180,
        );
      if (!allFrames.length) {
        context.fillStyle = "#718078";
        context.font = "11px monospace";
        context.textAlign = "center";
        context.fillText(
          status === "no disponible"
            ? "PROFUNDIDAD NO DISPONIBLE"
            : "CONECTANDO CON PROFUNDIDAD DE BINANCE…",
          width / 2,
          height / 2,
        );
        animation = requestAnimationFrame(draw);
        return;
      }

      const visibleCount = Math.min(
        allFrames.length,
        Math.max(12, Math.round(allFrames.length / timeZoom)),
      );
      const maxPanOffset = Math.max(0, allFrames.length - visibleCount);
      const safePanOffset = Math.round(clamp(panOffset, 0, maxPanOffset));
      const frameEnd = allFrames.length - safePanOffset;
      const frames = allFrames.slice(Math.max(0, frameEnd - visibleCount), frameEnd);

      const latestMid = frames.at(-1)!.mid;
      const plotLeft = 0;
      const plotRight = width - 88;
      const plotTop = 58;
      const plotBottom = showCvd ? height - 118 : height - 34;
      const plotHeight = plotBottom - plotTop;
      const plotWidth = plotRight - plotLeft;
      const visiblePrices = frames
        .flatMap((frame) => [...frame.bids, ...frame.asks].map(([price]) => price))
        .filter(
          (price) =>
            Number.isFinite(price) && price > 0 && Math.abs((price / latestMid) - 1) < 0.2,
        )
        .sort((left, right) => left - right);

      if (!visiblePrices.length) {
        framesRef.current = [];
        animation = requestAnimationFrame(draw);
        return;
      }

      let low: number;
      let high: number;
      if (rangePct === "auto") {
        low = visiblePrices[Math.floor((visiblePrices.length - 1) * 0.01)];
        high = visiblePrices[Math.ceil((visiblePrices.length - 1) * 0.99)];
        const midPrices = frames
          .map((frame) => frame.mid)
          .filter((price) => Math.abs((price / latestMid) - 1) < 0.12);
        low = Math.min(low, ...midPrices);
        high = Math.max(high, ...midPrices);
        const range = Math.max(high - low, latestMid * 0.00015);
        low -= range * 0.1;
        high += range * 0.1;
      } else {
        low = latestMid * (1 - rangePct / 100);
        high = latestMid * (1 + rangePct / 100);
      }

      const baseRange = Math.max(high - low, latestMid * 0.00001);
      const priceCenter = (low + high) / 2 + pricePan;
      const zoomedHalfRange = baseRange / (2 * priceZoom);
      low = priceCenter - zoomedHalfRange;
      high = priceCenter + zoomedHalfRange;

      const y = (price: number) =>
        plotBottom - ((price - low) / (high - low)) * plotHeight;
      const columnWidth = plotWidth / Math.max(frames.length, 1);
      viewRef.current = {
        low,
        high,
        plotTop,
        plotBottom,
        plotLeft,
        plotRight,
        columnWidth,
        frames,
        maxPanOffset,
      };

      context.fillStyle = "#07110e";
      context.fillRect(plotRight, 0, width - plotRight, height);
      context.strokeStyle = "rgba(65, 121, 94, .22)";
      context.lineWidth = 1;
      for (let row = 0; row < 8; row += 1) {
        const yy = plotTop + (row * plotHeight) / 7;
        context.beginPath();
        context.moveTo(plotLeft, yy);
        context.lineTo(plotRight, yy);
        context.stroke();
        context.fillStyle = "#708079";
        context.font = "9px monospace";
        context.textAlign = "left";
        context.fillText(priceLabel(high - ((high - low) * row) / 7), plotRight + 8, yy + 3);
      }

      for (let column = 0; column < 5; column += 1) {
        const xx = plotLeft + (column * plotWidth) / 4;
        context.strokeStyle = "rgba(45, 91, 69, .14)";
        context.beginPath();
        context.moveTo(xx, plotTop);
        context.lineTo(xx, plotBottom);
        context.stroke();
      }

      const visibleNotionals = frames.flatMap((frame) =>
        [...frame.bids, ...frame.asks]
          .filter(([price]) => price >= low && price <= high)
          .map(([price, qty]) => price * qty),
      );
      const liquidityReference = Math.max(percentile(visibleNotionals, 0.95), 1);
      const tradePriceStep = Math.max(
        (high - low) / Math.max(plotHeight / 4, 1),
        Number.EPSILON,
      );
      const plottedTrades = frames.flatMap((frame, index) => {
        const grouped = new Map<string, Trade>();
        frame.trades.forEach((trade) => {
          if (trade.price < low || trade.price > high) return;
          const bucketIndex = Math.round(trade.price / tradePriceStep);
          const key = `${trade.buyerMaker ? "sell" : "buy"}-${bucketIndex}`;
          const current = grouped.get(key);
          if (current) {
            current.qty += trade.qty;
            current.notional += trade.notional;
            current.time = Math.max(current.time, trade.time);
          } else {
            grouped.set(key, {
              ...trade,
              price: bucketIndex * tradePriceStep,
            });
          }
        });
        const x = plotRight - (frames.length - index) * columnWidth + columnWidth / 2;
        return [...grouped.values()].map((trade) => ({ ...trade, x }));
      });
      const tradeNotionals = plottedTrades.map((trade) => trade.notional);
      const tradeReference = Math.max(percentile(tradeNotionals, 0.94), 1);
      const largeTradeAt = percentile(tradeNotionals, 0.9);

      frames.forEach((frame, index) => {
        const x = plotRight - (frames.length - index) * columnWidth;
        [...frame.bids, ...frame.asks].forEach(([price, qty]) => {
          if (price < low || price > high) return;
          const notional = price * qty;
          const rawIntensity =
            scale === "log"
              ? Math.log1p(notional) / Math.log1p(liquidityReference)
              : notional / liquidityReference;
          const intensity = clamp(rawIntensity, 0, 1);
          context.fillStyle =
            intensity >= 0.88
              ? `rgba(255, 75, 44, ${0.62 + intensity * 0.32})`
              : intensity >= 0.63
                ? `rgba(255, 214, 58, ${0.42 + intensity * 0.42})`
                : intensity >= 0.36
                  ? `rgba(25, 202, 190, ${0.25 + intensity * 0.45})`
                  : `rgba(22, 91, 129, ${0.12 + intensity * 0.42})`;
          context.fillRect(x, y(price) - 2.5, columnWidth + 1.1, 5);
        });
      });

      if (showTrades) {
        plottedTrades.forEach((trade) => {
          const radius = Math.min(
            11.5,
            2.1 + Math.sqrt(trade.notional / tradeReference) * 5.5,
          );
          context.beginPath();
          context.arc(trade.x, y(trade.price), radius, 0, Math.PI * 2);
          context.fillStyle = trade.buyerMaker
            ? "rgba(255, 73, 88, .86)"
            : "rgba(42, 241, 150, .86)";
          context.fill();
          if (tradeNotionals.length >= 10 && trade.notional >= largeTradeAt) {
            context.strokeStyle = "#fff1a6";
            context.lineWidth = 1.2;
            context.stroke();
          }
        });
      }

      if (showWalls) {
        currentWalls(bookRef.current, frames).slice(0, 4).forEach((wall) => {
          if (wall.price < low || wall.price > high) return;
          const yy = y(wall.price);
          context.save();
          context.setLineDash([5, 5]);
          context.strokeStyle = wall.side === "BID" ? "rgba(77,255,173,.58)" : "rgba(255,98,113,.58)";
          context.beginPath();
          context.moveTo(Math.max(plotLeft, plotRight - plotWidth * 0.32), yy);
          context.lineTo(plotRight, yy);
          context.stroke();
          context.restore();
          context.fillStyle = wall.side === "BID" ? "#4dffad" : "#ff6271";
          context.font = "bold 7px monospace";
          context.textAlign = "right";
          context.fillText(`WALL ${usdLabel(wall.notional)}`, plotRight - 5, yy - 4);
        });
      }

      context.strokeStyle = "#eaf3ee";
      context.lineWidth = 1.25;
      context.beginPath();
      frames.forEach((frame, index) => {
        const x = plotRight - (frames.length - index) * columnWidth + columnWidth / 2;
        const yy = y(frame.mid);
        if (index) context.lineTo(x, yy);
        else context.moveTo(x, yy);
      });
      context.stroke();

      const last = frames.at(-1)!;
      const lastY = clamp(y(last.mid), plotTop + 11, plotBottom - 11);
      context.fillStyle = "#eff8f3";
      context.fillRect(plotRight, lastY - 11, width - plotRight, 22);
      context.fillStyle = "#06100d";
      context.font = "bold 10px monospace";
      context.textAlign = "center";
      context.fillText(priceLabel(last.mid), plotRight + (width - plotRight) / 2, lastY + 4);

      context.fillStyle = "#65766e";
      context.font = "8px monospace";
      context.textAlign = "center";
      for (let index = 0; index < 4; index += 1) {
        const frameIndex = Math.max(
          0,
          frames.length - 1 - Math.round((index * (frames.length - 1)) / 3),
        );
        const frame = frames[frameIndex];
        const x = plotRight - (frames.length - frameIndex) * columnWidth;
        context.fillText(
          marketTimeframe === "1d"
            ? new Date(frame.time).toLocaleString([], { day: "2-digit", hour: "2-digit", minute: "2-digit" })
            : marketTimeframe === "4h" || marketTimeframe === "1h"
              ? new Date(frame.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : new Date(frame.time).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
          x,
          plotBottom + 15,
        );
      }

      if (showCvd) {
        const cvd = cvdRef.current.slice(-historySize);
        if (cvd.length > 1) {
          const values = cvd.map((item) => item.value);
          const cvdMin = Math.min(...values, 0);
          const cvdMax = Math.max(...values, 0);
          const cvdRange = Math.max(cvdMax - cvdMin, 1);
          const cvdTop = plotBottom + 36;
          const cvdBottom = height - 13;
          const cy = (value: number) =>
            cvdBottom - ((value - cvdMin) / cvdRange) * (cvdBottom - cvdTop);
          const zeroY = cy(0);
          context.strokeStyle = "rgba(70, 119, 95, .3)";
          context.beginPath();
          context.moveTo(plotLeft, zeroY);
          context.lineTo(plotRight, zeroY);
          context.stroke();
          context.fillStyle = "#718078";
          context.font = "8px monospace";
          context.textAlign = "left";
          context.fillText("CVD NOTIONAL", 7, cvdTop - 7);
          context.fillStyle = values.at(-1)! >= 0 ? "#4dffad" : "#ff6271";
          context.textAlign = "right";
          context.fillText(usdLabel(values.at(-1)!), plotRight - 6, cvdTop - 7);
          context.strokeStyle = values.at(-1)! >= values[0] ? "#4dffad" : "#ff6271";
          context.lineWidth = 1.4;
          context.beginPath();
          cvd.forEach((item, index) => {
            const x = plotRight - (cvd.length - index) * columnWidth;
            const yy = cy(item.value);
            if (index) context.lineTo(x, yy);
            else context.moveTo(x, yy);
          });
          context.stroke();
        }
      }

      if (hoverRef.current) {
        const { x, y: pointerY } = hoverRef.current;
        if (x >= plotLeft && x <= plotRight && pointerY >= plotTop && pointerY <= plotBottom) {
          context.save();
          context.setLineDash([3, 4]);
          context.strokeStyle = "rgba(225, 240, 232, .52)";
          context.beginPath();
          context.moveTo(x, plotTop);
          context.lineTo(x, plotBottom);
          context.moveTo(plotLeft, pointerY);
          context.lineTo(plotRight, pointerY);
          context.stroke();
          context.restore();
        }
      }

      context.fillStyle = "rgba(77, 255, 173, .18)";
      context.font = "bold 10px monospace";
      context.textAlign = "left";
      context.fillText("ALT RADAR PRO · ORDER FLOW", 10, 13);
      animation = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animation);
  }, [
    status,
    scale,
    rangePct,
    historySize,
    showTrades,
    showCvd,
    showWalls,
    liquidityHistory,
    marketTimeframe,
    timeZoom,
    priceZoom,
    panOffset,
    pricePan,
  ]);

  const flowTotal = metrics.buyNotional + metrics.sellNotional;
  const delta = flowTotal
    ? ((metrics.buyNotional - metrics.sellNotional) / flowTotal) * 100
    : 0;
  const cvd = metrics.buyNotional - metrics.sellNotional;
  const availableSymbols =
    venue === "futures" && futuresSymbols.length
      ? symbols.filter((item) => futuresSymbols.includes(item))
      : symbols;

  const changeVenue = (next: "spot" | "futures") => {
    setVenue(next);
    if (next === "futures" && futuresSymbols.length && !futuresSymbols.includes(symbol)) {
      setSymbol(futuresSymbols.includes("BTCUSDT") ? "BTCUSDT" : futuresSymbols[0]);
    }
  };

  const largeTrades = tape.filter((trade) => trade.large);
  const largeBuy = largeTrades
    .filter((trade) => !trade.buyerMaker)
    .reduce((sum, trade) => sum + trade.notional, 0);
  const largeSell = largeTrades
    .filter((trade) => trade.buyerMaker)
    .reduce((sum, trade) => sum + trade.notional, 0);
  const largeTotal = largeBuy + largeSell;
  const largeDelta = largeTotal ? ((largeBuy - largeSell) / largeTotal) * 100 : 0;
  const velocity = metrics.velocity;
  const dataConfidence = Math.round(
    clamp(
      Math.min(metrics.frames / 40, 1) * 35 +
        Math.min(metrics.trades / 60, 1) * 40 +
        Math.min(metrics.levels / 40, 1) * 25,
    ),
  );
  const buyerPower = Math.round(
    clamp(
      50 +
        delta * 0.22 +
        (metrics.imbalance - 50) * 0.45 +
        largeDelta * 0.18 +
        clamp(velocity * 90, -10, 10),
    ),
  );
  const sellerPower = 100 - buyerPower;
  const winner =
    dataConfidence < 25
      ? "MUESTRA BAJA"
      : buyerPower >= 58
        ? "COMPRADORES"
        : buyerPower <= 42
          ? "VENDEDORES"
          : "EQUILIBRIO";
  const winnerConfidence = Math.min(
    dataConfidence,
    Math.round(Math.abs(buyerPower - 50) * 2),
  );
  const confluence =
    altseason.score === null
      ? "CONTEXTO INCOMPLETO"
      : winner === "COMPRADORES" && altseason.score >= 61
        ? "CONFLUENCIA ALCISTA"
        : winner === "VENDEDORES"
          ? "PRESIÓN VENDEDORA"
          : altseason.score >= 61
            ? "ALTSEASON SIN TRIGGER"
            : "SIN CONFLUENCIA";

  const actualFootprint = useMemo(
    () =>
      footprintRows(
        footprintTrades,
        metrics.bid && metrics.ask ? (metrics.bid + metrics.ask) / 2 : 0,
        metrics.ask && metrics.bid ? metrics.ask - metrics.bid : 0,
      ),
    [footprintTrades, metrics.bid, metrics.ask],
  );
  const footprintTotal = actualFootprint.reduce(
    (sum, row) => sum + row.buy + row.sell,
    0,
  );
  const footprintDelta = actualFootprint.reduce(
    (sum, row) => sum + row.buy - row.sell,
    0,
  );
  const footprintPoc = [...actualFootprint].sort(
    (left, right) => right.buy + right.sell - (left.buy + left.sell),
  )[0] ?? null;
  const stackedImbalances = actualFootprint.filter((row) => {
    const weakerSide = Math.min(row.buy, row.sell);
    const strongerSide = Math.max(row.buy, row.sell);
    return strongerSide > 0 && (weakerSide === 0 || strongerSide / weakerSide >= 3);
  }).length;
  const bidRows = depthWithCumulative(ladder.bids);
  const askRows = depthWithCumulative(ladder.asks);
  const maxCumulative = Math.max(
    bidRows.at(-1)?.cumulative ?? 1,
    askRows.at(-1)?.cumulative ?? 1,
  );
  const strongestWall = walls[0] ?? null;

  const clearHistory = () => {
    framesRef.current = [];
    pendingTradesRef.current = [];
    tapeRef.current = [];
    cvdRef.current = [];
    liquidationsRef.current = [];
    eventCooldownRef.current.clear();
    totalsRef.current = {
      trades: 0,
      buyQty: 0,
      sellQty: 0,
      buyNotional: 0,
      sellNotional: 0,
    };
    setTape([]);
    setFootprintTrades([]);
    setLiquidations([]);
    setEvents([]);
    setWalls([]);
    setMetrics((current) => ({ ...EMPTY_METRICS, bid: current.bid, ask: current.ask }));
    resetViewport();
  };

  const updateHover = (
    canvas: HTMLCanvasElement,
    clientX: number,
    clientY: number,
  ) => {
    const view = viewRef.current;
    if (!view) return;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    hoverRef.current = { x, y };
    if (
      x < view.plotLeft ||
      x > view.plotRight ||
      y < view.plotTop ||
      y > view.plotBottom
    ) {
      setHover(null);
      return;
    }
    const frameOffset = Math.floor((view.plotRight - x) / view.columnWidth);
    const frameIndex = Math.max(0, view.frames.length - 1 - frameOffset);
    const frame = view.frames[frameIndex];
    const price =
      view.high - ((y - view.plotTop) / (view.plotBottom - view.plotTop)) *
        (view.high - view.low);
    const nearest = [...frame.bids, ...frame.asks].sort(
      (left, right) => Math.abs(left[0] - price) - Math.abs(right[0] - price),
    )[0];
    setHover({
      x,
      y,
      price,
      time: frame.time,
      liquidity: nearest ? nearest[0] * nearest[1] : 0,
      canvasWidth: rect.width,
    });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const view = viewRef.current;
    if (!view) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    pointerPositionsRef.current.set(event.pointerId, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    const pointers = [...pointerPositionsRef.current.entries()];
    if (pointers.length >= 2) {
      const [first, second] = pointers;
      gestureRef.current = {
        kind: "pinch",
        pointerIds: [first[0], second[0]],
        startDistance: Math.max(
          1,
          Math.hypot(first[1].x - second[1].x, first[1].y - second[1].y),
        ),
        startTimeZoom: timeZoom,
        startPriceZoom: priceZoom,
      };
    } else {
      gestureRef.current = {
        kind: "drag",
        pointerId: event.pointerId,
        startX: pointers[0][1].x,
        startY: pointers[0][1].y,
        startPanOffset: panOffset,
        startPricePan: pricePan,
      };
    }
    hoverRef.current = null;
    setHover(null);
    setDraggingChart(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const view = viewRef.current;
    if (!view) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (pointerPositionsRef.current.has(event.pointerId)) {
      pointerPositionsRef.current.set(event.pointerId, { x, y });
    }

    const gesture = gestureRef.current;
    if (gesture?.kind === "pinch") {
      const first = pointerPositionsRef.current.get(gesture.pointerIds[0]);
      const second = pointerPositionsRef.current.get(gesture.pointerIds[1]);
      if (!first || !second) return;
      const ratio = Math.hypot(first.x - second.x, first.y - second.y) /
        gesture.startDistance;
      setTimeZoom(clamp(gesture.startTimeZoom * ratio, 1, 16));
      setPriceZoom(clamp(gesture.startPriceZoom * ratio, 1, 12));
      return;
    }

    if (gesture?.kind === "drag" && gesture.pointerId === event.pointerId) {
      const horizontalFrames = (x - gesture.startX) / Math.max(view.columnWidth, 1);
      const verticalPrice =
        ((y - gesture.startY) / Math.max(view.plotBottom - view.plotTop, 1)) *
        (view.high - view.low);
      setPanOffset(
        Math.round(
          clamp(
            gesture.startPanOffset + horizontalFrames,
            0,
            view.maxPanOffset,
          ),
        ),
      );
      setPricePan(gesture.startPricePan + verticalPrice);
      return;
    }

    updateHover(event.currentTarget, event.clientX, event.clientY);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointerPositionsRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const remaining = [...pointerPositionsRef.current.entries()];
    if (remaining.length === 1) {
      gestureRef.current = {
        kind: "drag",
        pointerId: remaining[0][0],
        startX: remaining[0][1].x,
        startY: remaining[0][1].y,
        startPanOffset: panOffset,
        startPricePan: pricePan,
      };
    } else if (!remaining.length) {
      gestureRef.current = null;
      setDraggingChart(false);
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.16 : 1 / 1.16;
    if (event.ctrlKey) {
      setTimeZoom((value) => clamp(value * factor, 1, 16));
      setPriceZoom((value) => clamp(value * factor, 1, 12));
    } else if (event.shiftKey || event.altKey) {
      setPriceZoom((value) => clamp(value * factor, 1, 12));
    } else {
      setTimeZoom((value) => clamp(value * factor, 1, 16));
    }
  };

  const resetViewport = () => {
    setTimeZoom(1);
    setPriceZoom(1);
    setPanOffset(0);
    setPricePan(0);
  };

  const followLive = () => {
    setPanOffset(0);
    setPricePan(0);
  };

  const handleChartKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    const view = viewRef.current;
    if (!view) return;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setTimeZoom((value) => clamp(value * 1.2, 1, 16));
    } else if (event.key === "-") {
      event.preventDefault();
      setTimeZoom((value) => clamp(value / 1.2, 1, 16));
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setPanOffset((value) =>
        Math.round(clamp(value + (event.key === "ArrowLeft" ? 8 : -8), 0, view.maxPanOffset)),
      );
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const step = (view.high - view.low) * 0.08;
      setPricePan((value) => value + (event.key === "ArrowUp" ? step : -step));
    } else if (event.key === "Escape" || event.key === "0") {
      event.preventDefault();
      resetViewport();
    }
  };

  const handlePointerLeave = () => {
    if (gestureRef.current) return;
    hoverRef.current = null;
    setHover(null);
  };

  return (
    <section className="panel live-bookmap orderflow-terminal">
      <div className="panel-head orderflow-head">
        <div>
          <p className="eyebrow">ORDER FLOW TERMINAL · BINANCE {venue === "futures" ? "FUTUROS" : "SPOT"}</p>
          <h2>Heatmap de liquidez y microestructura</h2>
        </div>
        <div className="feed-health">
          <span className={`ws-status ${status.replace(" ", "-")}`}>● {status.toUpperCase()}</span>
          <small>{metrics.latency === null ? "LATENCIA —" : `${metrics.latency.toFixed(0)} MS`} · REC {reconnects}</small>
        </div>
      </div>

      <div className="terminal-commandbar">
        <label className="market-command" htmlFor="bookmap-symbol">
          <span>MERCADO</span>
          <select
            id="bookmap-symbol"
            value={symbol}
            onChange={(event) => setSymbol(event.target.value)}
          >
            {availableSymbols.map((item) => (
              <option key={item} value={item}>{base(item)}/USDT</option>
            ))}
          </select>
        </label>
        <div><span>ÚLTIMO</span><b>{metrics.bid && metrics.ask ? priceLabel((metrics.bid + metrics.ask) / 2) : "—"}</b></div>
        <div><span>HISTORIAL VISIBLE</span><b>{Math.round((metrics.frames * sampleMs) / 1000)} S</b></div>
        <div><span>UNIVERSO</span><b>{availableSymbols.length} PARES</b></div>
        <div><span>SESIÓN</span><b>{started || "—"}</b></div>
      </div>

      <div className="heatmap-controls advanced-controls">
        <label>FUENTE
          <select value={venue} onChange={(event) => changeVenue(event.target.value as "spot" | "futures")}>
            <option value="spot">Binance Spot</option>
            <option value="futures">Binance Futuros</option>
          </select>
        </label>
        <label>PROFUNDIDAD
          <select value={depth} onChange={(event) => setDepth(Number(event.target.value))}>
            <option value={5}>5 niveles</option>
            <option value={10}>10 niveles</option>
            <option value={20}>20 niveles</option>
          </select>
        </label>
        <label>MUESTREO
          <select value={sampleMs} onChange={(event) => setSampleMs(Number(event.target.value))}>
            <option value={250}>250 ms</option>
            <option value={500}>500 ms</option>
            <option value={1000}>1 segundo</option>
          </select>
        </label>
        <label>VENTANA
          <select value={historySize} onChange={(event) => setHistorySize(Number(event.target.value))}>
            <option value={100}>100 muestras</option>
            <option value={180}>180 muestras</option>
            <option value={240}>240 muestras</option>
          </select>
        </label>
        <label>RANGO PRECIO
          <select
            value={rangePct}
            onChange={(event) => setRangePct(event.target.value === "auto" ? "auto" : Number(event.target.value))}
          >
            <option value="auto">Automático</option>
            <option value={0.25}>±0.25%</option>
            <option value={0.5}>±0.50%</option>
            <option value={1}>±1.00%</option>
            <option value={2}>±2.00%</option>
          </select>
        </label>
        <label>INTENSIDAD
          <select value={scale} onChange={(event) => setScale(event.target.value as "log" | "linear")}>
            <option value="log">Logarítmica</option>
            <option value="linear">Lineal</option>
          </select>
        </label>
        <div className="layer-switches" aria-label="Capas visibles">
          <button className={showTrades ? "enabled" : ""} onClick={() => setShowTrades((value) => !value)}>TRADES</button>
          <button className={showWalls ? "enabled" : ""} onClick={() => setShowWalls((value) => !value)}>WALLS</button>
          <button className={showCvd ? "enabled" : ""} onClick={() => setShowCvd((value) => !value)}>CVD</button>
          <button className={showFootprintNumbers ? "enabled" : ""} onClick={() => setShowFootprintNumbers((value) => !value)}>FOOTPRINT #</button>
        </div>
      </div>

      <div className="flow-metrics pro-flow-metrics">
        <div><span>MEJOR BID</span><b className="positive">{metrics.bid ? priceLabel(metrics.bid) : "—"}</b></div>
        <div><span>MEJOR ASK</span><b className="negative">{metrics.ask ? priceLabel(metrics.ask) : "—"}</b></div>
        <div><span>SPREAD</span><b>{metrics.spread.toFixed(4)}%</b></div>
        <div><span>BOOK IMBALANCE</span><b className={metrics.imbalance >= 50 ? "positive" : "negative"}>{metrics.imbalance.toFixed(1)}% BID</b></div>
        <div><span>DELTA AGRESIVO</span><b className={delta >= 0 ? "positive" : "negative"}>{signed(delta)}</b></div>
        <div><span>CVD NOTIONAL</span><b className={cvd >= 0 ? "positive" : "negative"}>{usdLabel(cvd)}</b></div>
        <div><span>MAYOR WALL</span><b>{strongestWall ? usdLabel(strongestWall.notional) : "—"}</b></div>
        <div><span>CALIDAD MUESTRA</span><b>{dataConfidence}%</b></div>
      </div>

      <section className="decision-board pro-decision-board">
        <article className={`battle-card ${winner.toLowerCase().replaceAll(" ", "-")}`}>
          <div className="decision-title">
            <span>DOMINIO DE MICROESTRUCTURA</span>
            <b>GANANDO: {winner}</b>
          </div>
          <div className="battle-numbers">
            <strong className="negative">{sellerPower}%<small>VENDEDORES</small></strong>
            <div className="battle-track">
              <i style={{ left: `${sellerPower}%` }} />
              <span style={{ width: `${sellerPower}%` }} />
              <b style={{ width: `${buyerPower}%` }} />
            </div>
            <strong className="positive">{buyerPower}%<small>COMPRADORES</small></strong>
          </div>
          <div className="battle-reasons">
            <span>Delta {signed(delta)}</span>
            <span>Libro {metrics.imbalance.toFixed(1)}% bid</span>
            <span>Grandes {signed(largeDelta)}</span>
            <span>Velocidad {signed(velocity, 2)}</span>
            <em>Confianza ajustada {winnerConfidence}%</em>
          </div>
        </article>
        <article className="altseason-live">
          <div
            className="alt-live-ring"
            style={{ "--alt-live": `${(altseason.score ?? 0) * 3.6}deg` } as React.CSSProperties}
          >
            <b>{altseason.score ?? "—"}</b><small>/100</small>
          </div>
          <div>
            <span>ENTORNO ALTSEASON</span>
            <h3>{altseason.state}</h3>
            <p><i>TÉCNICO {altseason.raw ?? "—"}</i><i>MACRO {altseason.adjustment}</i><i>FINAL {altseason.score ?? "—"}</i></p>
          </div>
        </article>
        <article className={`confluence-card ${confluence.toLowerCase().replaceAll(" ", "-")}`}>
          <span>LECTURA COMBINADA</span>
          <h3>{confluence}</h3>
          <p>
            {confluence === "CONFLUENCIA ALCISTA"
              ? "El flujo comprador coincide con un entorno de rotación favorable."
              : confluence === "PRESIÓN VENDEDORA"
                ? "La oferta domina el flujo. No perseguir entradas largas."
                : "Falta alineación suficiente entre flujo y contexto de mercado."}
          </p>
          <small>Lectura probabilística · nunca constituye una señal por sí sola</small>
        </article>
      </section>

      <div className="bookmap-toolbar pro-toolbar">
        <div><b>{base(symbol)}/USDT</b><span>{venue.toUpperCase()} · PROFUNDIDAD REAL</span></div>
        <span>{metrics.levels} niveles · {metrics.trades} ejecuciones · {metrics.frames} muestras</span>
        <div className="toolbar-actions">
          <button onClick={clearHistory}>LIMPIAR</button>
          <button className={paused ? "paused" : ""} onClick={() => setPaused((value) => !value)}>
            {paused ? "REANUDAR" : "PAUSAR"}
          </button>
        </div>
      </div>

      <BookmapTimeframeChart
        symbol={symbol}
        venue={venue}
        timeframe={marketTimeframe}
        onTimeframeChange={setMarketTimeframe}
      />

      <div className="liquidity-horizon-bar">
        <div>
          <span>MAPA DE LIQUIDEZ</span>
          <b>VENTANA {LIQUIDITY_FRAME_LABEL[marketTimeframe]}</b>
        </div>
        <div className="liquidity-horizon-tabs" role="tablist" aria-label="Horizonte del mapa de liquidez">
          {(Object.keys(LIQUIDITY_FRAME_LABEL) as BrainTimeframe[]).map((frame) => (
            <button
              key={frame}
              role="tab"
              aria-selected={marketTimeframe === frame}
              className={marketTimeframe === frame ? "active" : ""}
              onClick={() => setMarketTimeframe(frame)}
            >
              {LIQUIDITY_FRAME_LABEL[frame]}
            </button>
          ))}
        </div>
        <div className={`liquidity-archive-state ${liquidityArchiveStatus}`}>
          <i />
          <span>{liquidityArchiveStatus === "recording" ? "ARCHIVO REAL ACTIVO" : liquidityArchiveStatus === "loading" ? "CARGANDO ARCHIVO" : "ARCHIVO NO DISPONIBLE"}</span>
          <small>{liquidityCoverage.samples} snapshots · {Math.round(liquidityCoverage.minutes)} min observados</small>
        </div>
      </div>

      <div className="bookmap-live-divider">
        LIQUIDEZ OBSERVADA {LIQUIDITY_FRAME_LABEL[marketTimeframe]} + MICROESTRUCTURA EN VIVO
      </div>

      <div className="professional-map advanced-map">
        <div className={`chart-stage interactive-chart ${draggingChart ? "dragging" : ""}`}>
          <div className="chart-viewport-controls" role="toolbar" aria-label="Controles del mapa de liquidez">
            <div className="viewport-zoom-group">
              <span>TIEMPO</span>
              <button aria-label="Alejar tiempo" onClick={() => setTimeZoom((value) => clamp(value / 1.25, 1, 16))}>−</button>
              <b>{timeZoom.toFixed(1)}×</b>
              <button aria-label="Acercar tiempo" onClick={() => setTimeZoom((value) => clamp(value * 1.25, 1, 16))}>+</button>
            </div>
            <div className="viewport-zoom-group">
              <span>PRECIO</span>
              <button aria-label="Alejar precio" onClick={() => setPriceZoom((value) => clamp(value / 1.25, 1, 12))}>−</button>
              <b>{priceZoom.toFixed(1)}×</b>
              <button aria-label="Acercar precio" onClick={() => setPriceZoom((value) => clamp(value * 1.25, 1, 12))}>+</button>
            </div>
            <button
              className={`viewport-live ${panOffset === 0 && pricePan === 0 ? "active" : ""}`}
              onClick={followLive}
            >
              <i /> {panOffset === 0 && pricePan === 0 ? "SIGUIENDO LIVE" : `${panOffset} MUESTRAS ATRÁS`}
            </button>
            <button
              className={showFootprintNumbers ? "viewport-footprint active" : "viewport-footprint"}
              onClick={() => setShowFootprintNumbers((value) => !value)}
            >
              BID × ASK #
            </button>
            <button className="viewport-reset" onClick={resetViewport}>RESET</button>
          </div>
          <canvas
            ref={canvasRef}
            className="bookmap-canvas pro-bookmap-canvas"
            role="img"
            tabIndex={0}
            aria-label={`Heatmap de liquidez real de ${base(symbol)} con profundidad, trades, paredes y CVD`}
            aria-describedby="bookmap-gesture-help"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerLeave}
            onWheel={handleWheel}
            onDoubleClick={followLive}
            onKeyDown={handleChartKeyDown}
          />
          <div className="chart-live-badge"><i /> {LIQUIDITY_FRAME_LABEL[marketTimeframe]} · LIVE DEPTH</div>
          {liquidityCoverage.minutes < LIQUIDITY_WINDOW_MS[marketTimeframe] / 60_000 && (
            <div className="liquidity-coverage-warning">
              ACUMULANDO {LIQUIDITY_FRAME_LABEL[marketTimeframe]} · DISPONIBLE {Math.round(liquidityCoverage.minutes)} MIN
            </div>
          )}
          <div className="chart-legend-overlay">
            <span>BAJA</span><i /><span>ALTA LIQUIDEZ</span>
          </div>
          <div id="bookmap-gesture-help" className="chart-gesture-help">
            RUEDA: ZOOM TIEMPO · SHIFT+RUEDA: PRECIO · ARRASTRAR: MOVER · PINZA: ZOOM · DOBLE TOQUE: LIVE
          </div>
          {showFootprintNumbers && (
            <div className="chart-footprint-numbers" aria-label="Footprint numérico de ejecuciones reales">
              <header>
                <div><span>FOOTPRINT</span><b>BID × ASK</b></div>
                <small>USD EJECUTADO</small>
              </header>
              <div className="chart-footprint-summary">
                <span>Δ <b className={footprintDelta >= 0 ? "positive" : "negative"}>{footprintDelta >= 0 ? "+" : "−"}{footprintNumber(footprintDelta)}</b></span>
                <span>POC <b>{footprintPoc ? priceLabel(footprintPoc.price) : "—"}</b></span>
                <span>IMB <b>{stackedImbalances}</b></span>
              </div>
              <div className="chart-footprint-head"><span>BID</span><b>PRECIO</b><span>ASK</span><em>Δ</em></div>
              <div className="chart-footprint-body">
                {actualFootprint.slice(0, 10).map((row) => {
                  const total = Math.max(row.buy + row.sell, 1);
                  const weaker = Math.min(row.buy, row.sell);
                  const ratio = Math.max(row.buy, row.sell) / Math.max(weaker, 1);
                  const dominant = ratio >= 3 ? (row.buy > row.sell ? "buy-imbalance" : "sell-imbalance") : "";
                  const rowDelta = row.buy - row.sell;
                  return (
                    <div
                      className={`chart-footprint-row ${dominant} ${footprintPoc?.price === row.price ? "poc" : ""}`}
                      key={`chart-footprint-${row.price}`}
                      style={{ "--sell-share": `${(row.sell / total) * 100}%`, "--buy-share": `${(row.buy / total) * 100}%` } as React.CSSProperties}
                    >
                      <span>{footprintNumber(row.sell)}</span>
                      <b>{priceLabel(row.price)}</b>
                      <span>{footprintNumber(row.buy)}</span>
                      <em className={rowDelta >= 0 ? "positive" : "negative"}>{rowDelta >= 0 ? "+" : "−"}{footprintNumber(rowDelta)}</em>
                    </div>
                  );
                })}
                {!actualFootprint.length && <p>ESPERANDO EJECUCIONES…</p>}
              </div>
            </div>
          )}
          {hover && (
            <div
              className="chart-tooltip"
              style={{
                left: `${Math.min(hover.x + 14, Math.max(10, hover.canvasWidth - 170))}px`,
                top: `${Math.max(12, hover.y - 64)}px`,
              }}
            >
              <b>{priceLabel(hover.price)}</b>
              <span>{new Date(hover.time).toLocaleTimeString()}</span>
              <small>LIQ. {usdLabel(hover.liquidity)}</small>
            </div>
          )}
        </div>

        <aside className="market-sidebar pro-sidebar">
          <div className="sidebar-tabs" role="tablist" aria-label="Panel de microestructura">
            {(["dom", "tape", "alerts"] as const).map((panel) => (
              <button
                key={panel}
                role="tab"
                aria-selected={sidePanel === panel}
                className={sidePanel === panel ? "active" : ""}
                onClick={() => setSidePanel(panel)}
              >
                {panel === "dom" ? "DOM" : panel === "tape" ? "TAPE" : "ALERTAS"}
              </button>
            ))}
          </div>

          {sidePanel === "dom" && (
            <div className="pro-dom">
              <header><span>PROFUNDIDAD</span><small>PRECIO · USD · ACUM.</small></header>
              <div className="dom-columns"><span>LADO</span><b>PRECIO</b><em>TAMAÑO</em><i>ACUM.</i></div>
              <div className="dom-book asks">
                {askRows.slice().reverse().map((row) => (
                  <div className="dom-row ask" key={`ask-${row.price}`}>
                    <u style={{ width: `${(row.cumulative / maxCumulative) * 100}%` }} />
                    <span>ASK</span><b>{priceLabel(row.price)}</b><em>{usdLabel(row.notional)}</em><i>{usdLabel(row.cumulative)}</i>
                  </div>
                ))}
              </div>
              <div className="dom-mid">
                <b>{metrics.bid && metrics.ask ? priceLabel((metrics.bid + metrics.ask) / 2) : "—"}</b>
                <span>SPREAD {metrics.spread.toFixed(4)}%</span>
              </div>
              <div className="dom-book bids">
                {bidRows.map((row) => (
                  <div className="dom-row bid" key={`bid-${row.price}`}>
                    <u style={{ width: `${(row.cumulative / maxCumulative) * 100}%` }} />
                    <span>BID</span><b>{priceLabel(row.price)}</b><em>{usdLabel(row.notional)}</em><i>{usdLabel(row.cumulative)}</i>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sidePanel === "tape" && (
            <div className="pro-tape">
              <header><span>TIME &amp; SALES</span><small>USD EJECUTADO</small></header>
              {tape.map((trade, index) => (
                <div
                  className={`tape-row ${trade.buyerMaker ? "sell" : "buy"} ${trade.large ? "large" : ""}`}
                  key={`${trade.time}-${index}`}
                >
                  <time>{new Date(trade.time).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" })}</time>
                  <b>{priceLabel(trade.price)}</b>
                  <em>{usdLabel(trade.notional)}</em>
                  <span>{trade.buyerMaker ? "SELL" : "BUY"}</span>
                </div>
              ))}
              {!tape.length && <p>ESPERANDO EJECUCIONES REALES…</p>}
            </div>
          )}

          {sidePanel === "alerts" && (
            <div className="pro-alerts">
              <header><span>DETECTOR DE FLUJO</span><small>REGLAS AUDITABLES</small></header>
              {events.slice(0, 16).map((event) => (
                <div className={`flow-event ${event.side.toLowerCase()}`} key={event.id}>
                  <time>{new Date(event.time).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" })}</time>
                  <div><b>{event.type}</b><span>{event.detail}</span></div>
                  <em>{usdLabel(event.notional)}</em>
                </div>
              ))}
              {!events.length && <p>SIN ANOMALÍAS CONFIRMADAS EN LA MUESTRA</p>}
              <div className="liquidation-block">
                <h4>LIQUIDACIONES</h4>
                {venue === "spot" ? (
                  <p>DISPONIBLES AL CAMBIAR A BINANCE FUTUROS</p>
                ) : liquidations.length ? (
                  liquidations.map((item) => (
                    <div className={item.side === "LONG" ? "long" : "short"} key={`${item.time}-${item.price}`}>
                      <time>{new Date(item.time).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" })}</time>
                      <b>{item.side}</b><span>{usdLabel(item.notional)}</span>
                    </div>
                  ))
                ) : (
                  <p>SIN LIQUIDACIONES RECIBIDAS</p>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>

      <section className="microstructure-grid">
        <article className="micro-card wall-monitor">
          <header><div><span>LIQUIDITY WALLS</span><b>Paredes persistentes</b></div><small>{walls.length} DETECTADAS</small></header>
          <div className="wall-list">
            {walls.slice(0, 5).map((wall) => (
              <div className={wall.side.toLowerCase()} key={`${wall.side}-${wall.price}`}>
                <span>{wall.side}</span>
                <b>{priceLabel(wall.price)}</b>
                <em>{usdLabel(wall.notional)}</em>
                <i>{wall.distance >= 0 ? "+" : ""}{wall.distance.toFixed(3)}%</i>
                <small>{wallStrengthLabel(wall.strength)} P60 · {wall.persistence.toFixed(0)}% persist.</small>
              </div>
            ))}
            {!walls.length && <p>ACUMULANDO HISTORIAL DE PROFUNDIDAD…</p>}
          </div>
        </article>

        <article className="micro-card footprint-pro">
          <header><div><span>FOOTPRINT NOTIONAL</span><b>BID × ASK por nivel</b></div><small>TRADES REALES · USD</small></header>
          <div className="footprint-kpis">
            <span>VOLUMEN <b>{footprintNumber(footprintTotal)}</b></span>
            <span>DELTA <b className={footprintDelta >= 0 ? "positive" : "negative"}>{footprintDelta >= 0 ? "+" : "−"}{footprintNumber(footprintDelta)}</b></span>
            <span>POC <b>{footprintPoc ? priceLabel(footprintPoc.price) : "—"}</b></span>
            <span>IMBALANCES <b>{stackedImbalances}</b></span>
          </div>
          <div className="footprint-columns footprint-columns-pro"><span>BID HIT</span><b>PRECIO</b><span>ASK LIFT</span><em>DELTA</em></div>
          {actualFootprint.map((row) => {
            const total = Math.max(row.buy + row.sell, 1);
            const rowDelta = row.buy - row.sell;
            const weaker = Math.min(row.buy, row.sell);
            const ratio = Math.max(row.buy, row.sell) / Math.max(weaker, 1);
            const dominant = ratio >= 3 ? (row.buy > row.sell ? "buy-imbalance" : "sell-imbalance") : "";
            return (
              <div className={`footprint-row footprint-row-pro ${dominant} ${footprintPoc?.price === row.price ? "poc" : ""}`} key={row.price}>
                <em className="negative">{footprintNumber(row.sell)}</em>
                <span style={{ "--sell": `${(row.sell / total) * 100}%`, "--buy": `${(row.buy / total) * 100}%` } as React.CSSProperties}>
                  <i /><b>{priceLabel(row.price)}</b><u />
                </span>
                <em className="positive">{footprintNumber(row.buy)}</em>
                <strong className={rowDelta >= 0 ? "positive" : "negative"}>{rowDelta >= 0 ? "+" : "−"}{footprintNumber(rowDelta)}</strong>
              </div>
            );
          })}
          {!actualFootprint.length && <p>ESPERANDO TRADES PARA CONSTRUIR EL FOOTPRINT…</p>}
        </article>

        <article className="micro-card session-stats">
          <header><div><span>SESSION ANALYTICS</span><b>Flujo ejecutado</b></div><small>DESDE {started || "—"}</small></header>
          <div className="session-stat-grid">
            <div><span>BUY MARKET</span><b className="positive">{usdLabel(metrics.buyNotional)}</b></div>
            <div><span>SELL MARKET</span><b className="negative">{usdLabel(metrics.sellNotional)}</b></div>
            <div><span>LARGE BUY</span><b>{usdLabel(largeBuy)}</b></div>
            <div><span>LARGE SELL</span><b>{usdLabel(largeSell)}</b></div>
            <div><span>EVENTOS</span><b>{events.length}</b></div>
            <div><span>TRADES</span><b>{metrics.trades}</b></div>
          </div>
          <p>
            “Grande” significa percentil 90 de esta sesión; no identifica instituciones. Absorción y walls son lecturas probabilísticas de microestructura.
          </p>
        </article>
      </section>

      <div className="bookmap-caption pro-caption">
        <span><i className="liq" /> Liquidez baja → alta</span>
        <span><i className="buy" /> Compra agresiva</span>
        <span><i className="sell" /> Venta agresiva</span>
        <span><i className="large-dot" /> Trade grande relativo</span>
        <small>
          Binance {venue === "futures" ? "Futures" : "Spot"} WebSocket · profundidad 100 ms · trades reales · sin órdenes simuladas
        </small>
      </div>

      <MarketBrain
        symbol={symbol}
        venue={venue}
        currentPrice={metrics.bid && metrics.ask ? (metrics.bid + metrics.ask) / 2 : 0}
        winner={winner}
        delta={delta}
        imbalance={metrics.imbalance}
        cvd={cvd}
        altseason={altseason}
        liveLiquidations={liquidations}
        timeframe={marketTimeframe}
        onTimeframeChange={setMarketTimeframe}
      />
    </section>
  );
}
