"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MtfOscillators from "./mtf-oscillators";
import {
  buildLiquidationHeatmap,
  filterHeatmapTiers,
  findKeyLevels,
  leverageTiersFor,
  type HeatBucket,
  type LiquidationHeatmap,
} from "@/lib/liquidation-heatmap";
import { findFairValueGaps, gapStats, type FairValueGap, type GapStats } from "@/lib/fair-value-gaps";
import {
  isPoolTaken,
  liquidationTotals,
  mergeLiveCandle,
  type LiveKline,
  type LiveLiquidation,
} from "@/lib/live-market";
import { browserFeedDeps, startLiveFeed, type FeedStatus } from "@/lib/live-feed";
import { divergenceStats, findDivergences, macd, rsi } from "@/lib/oscillators";
import {
  bucketSize,
  buildFootprints,
  candleDelta,
  cumulativeDelta,
  findStackedImbalances,
  flowVerdict,
  imbalance,
  parseAggTrade,
  stackTally,
  type Trade,
} from "@/lib/footprint";
import { buildLiquidationLives, gridColor, liquidationGrid, type LiquidationLife } from "@/lib/liquidation-columns";
import { findScalpSignals, scalpStats } from "@/lib/scalp-signals";
import { keyLevels as supportResistance } from "@/lib/key-levels";
import { findInducements, idmStats } from "@/lib/inducement";
import { onMapSymbol } from "@/lib/account-events";
import { findLvSignals, flushSeries, lvStats, resolveLv, type LvTrade } from "@/lib/liq-vol-signals";
import { bubbleRadius, dollarsShort, pickBubbles } from "@/lib/trade-bubbles";
import { analyzeTrend, latestBreak, lineAt } from "@/lib/trendlines";
import { findSweeps, sweepStats } from "@/lib/liquidity-sweeps";
import { findFlags, readWyckoff, type FlagPattern, type WyckoffReading } from "@/lib/chart-patterns";
import { findReversalZones, type LevelAtom, type ReversalZone } from "@/lib/reversal-zones";
import { findLiquidityPools, mergeMtfPools, type LiquidityPool, type MtfPool } from "@/lib/liquidity-pools";
import { buildScenarios, type ScenarioBoard } from "@/lib/scenario-analysis";
import { readFibZone, type FibZoneState } from "@/lib/fib-zone";
import {
  breakerBlockStats,
  findBreakerBlocks,
  findOrderBlocks,
  orderBlockStats,
  type BreakerBlock,
  type OrderBlock,
  type ZoneStats,
} from "@/lib/order-blocks";
import { findPivots, parseSwingKlines } from "@/lib/swing-entries";
import {
  BROWSER_BASES,
  FALLBACK_SYMBOLS,
  FUTURES_BASES,
  higherTimeframes,
  loadOiDelta,
  loadOpenInterest,
  loadRows,
  loadTopSymbols,
  timeframeConfig,
  TIMEFRAME_ORDER,
} from "@/lib/market-fetch";

type DisplayCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Aggressive buying (Binance kline field 9); the rest of volume is selling. */
  takerBuy?: number;
};
type LayerKey = "sr" | "liqvol" | "idm" | "calor" | "reversion" | "patrones" | "tendencia" | "liquidez" | "ob" | "breaker" | "fvg" | "fib" | "volumen" | "reales" | "rsi" | "macd" | "footprint" | "burbujas" | "tomas" | "scalp";
/** Footprint needs individual trades: legible and fetchable only on short frames. */
const FOOTPRINT_FRAMES = new Set(["1m", "3m", "5m", "15m"]);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** "1 operación" / "3 operaciones" (Spanish plural that plain "+s" gets wrong). */
const ops = (n: number) => `${n} ${n === 1 ? "operación" : "operaciones"}`;
const LAYERS_KEY = "alt-radar-pro:map-layers:v1";
const SIMPLE_KEY = "alt-radar-pro:map-simple:v1";
/** Candles a LIQ+VOL trade is given to reach its stop or target. */
const LV_HORIZON = 24;
/**
 * What someone starting out sees: price, the nearest floors and ceilings,
 * where the liquidation fuel sits (the side profile, without the coloured
 * columns), the trend, volume and one measured setup. Everything else is one
 * click away, and leaving the mode restores the layers that were on before.
 */
const SIMPLE_ON = new Set(["sr", "liqvol", "calor", "tendencia", "volumen"]);
/**
 * Fewer layers on by default. Order blocks, gaps and Fibonacci are the noisiest
 * and their levels already feed the reversal zones, so a reader who never
 * turns them on still gets their information where it has been cross-checked.
 */
const DEFAULT_LAYERS: Record<LayerKey, boolean> = {
  sr: true,
  liqvol: true,
  idm: true,
  calor: true,
  reversion: true,
  patrones: true,
  tendencia: true,
  liquidez: true,
  ob: false,
  breaker: false,
  fvg: false,
  fib: false,
  volumen: true,
  rsi: true,
  macd: true,
  footprint: false,
  // Only drawn where trades are loaded, i.e. with the footprint on: on by
  // default so turning the footprint on shows them without a second click.
  burbujas: true,
  tomas: true,
  scalp: true,
  reales: true,
};
const simpleLayers = (): Record<LayerKey, boolean> =>
  Object.fromEntries(Object.keys(DEFAULT_LAYERS).map((k) => [k, SIMPLE_ON.has(k)])) as Record<LayerKey, boolean>;
const LAYER_LABELS: [LayerKey, string][] = [
  ["sr", "S/R CLAVE"],
  ["liqvol", "LIQ+VOL"],
  ["idm", "INDUCCIÓN"],
  ["calor", "CALOR"],
  ["reversion", "REVERSIÓN"],
  ["patrones", "PATRONES"],
  ["tendencia", "TENDENCIA"],
  ["liquidez", "LIQUIDEZ"],
  ["reales", "LIQ. REALES"],
  ["volumen", "VOLUMEN"],
  ["tomas", "TOMAS DE LIQ."],
  ["scalp", "SCALP"],
  ["footprint", "FOOTPRINT"],
  ["burbujas", "BURBUJAS"],
  ["rsi", "RSI"],
  ["macd", "MACD"],
  ["ob", "OB"],
  ["breaker", "BREAKER"],
  ["fvg", "FVG"],
  ["fib", "FIB"],
];

// One source: the timeframe table. This used to be a second, hand-typed copy.
const FRAME_MS: Record<string, number> = Object.fromEntries(
  TIMEFRAME_ORDER.map((id) => [id, timeframeConfig(id).frameMs]),
);

/** Time left in the forming candle, like a trading terminal shows under the
 *  price. Its own timer, so the map is not re-rendered every second for it. */
function CandleCountdown({ closeAt }: { closeAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const left = Math.max(0, Math.floor((closeAt - now) / 1000));
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const sec = left % 60;
  const pad = (v: number) => String(v).padStart(2, "0");
  const text = d > 0 ? `${d}d ${pad(h)}:${pad(m)}` : h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  return <small className="lpb-count">{text}</small>;
}

type ApiResponse = {
  heatmap: LiquidationHeatmap;
  candles: DisplayCandle[];
  timeframe: string;
  /** Every estimated level with when it formed and when price took it — the columns. */
  lives: LiquidationLife[];
  halfLife: number | null;
};

/**
 * Candles come from the browser, and the map is built here rather than on the
 * Worker.
 *
 * Binance blocks datacenter addresses on the klines endpoint — api/klines.ts
 * documents this, and it is why that route exists with a browser-contribution
 * fallback at all. The server-side version of this panel therefore returned
 * "SIN DATOS SUFICIENTES" on every single request in production while working
 * perfectly in local tests, because a test machine is not a datacenter IP.
 *
 * Visitors on ordinary connections are not blocked, so the fetch happens here,
 * the same way the comparison, correlation and market-brain panels already do
 * it. buildLiquidationHeatmap is pure arithmetic with no server dependency, so
 * it runs the same in both places.
 */
const FRAME_OPTIONS = TIMEFRAME_ORDER.map((id) => ({ id, label: timeframeConfig(id).label }));

const usd = (value: number) => {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
};

const shortUsd = (value: number) => {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
};

/** "62% · 21 casos" style, or a plain admission when there is nothing to
 *  report — a rate never appears without the sample it came from. */
const confidenceLabel = (stats: ZoneStats | null) => {
  if (!stats || stats.holdRate === null) return "sin muestra todavía";
  const pct = Math.round(stats.holdRate * 100);
  return stats.tested < 8
    ? `${pct}% en ${stats.tested} casos (muestra mínima)`
    : `${pct}% en ${stats.tested} casos`;
};

// Same numbers as confidenceLabel, compact enough to sit directly on the
// chart next to the zone it describes — the fold list below keeps the full
// "X% en Y casos" wording, this is just "X%" so the on-chart label doesn't
// crowd out the price it's labeling. Empty string, not "0%", when there's
// nothing to report yet.
const confidencePct = (stats: ZoneStats | null) =>
  stats && stats.holdRate !== null ? ` · ${Math.round(stats.holdRate * 100)}%` : "";

// K / M for a quantity, with the app's decimal comma. Signed on request.
const compactQty = (value: number, signed = false) => {
  const abs = Math.abs(value);
  const text =
    abs >= 1_000_000
      ? `${(abs / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 2 })}M`
      : abs >= 1_000
        ? `${(abs / 1_000).toLocaleString("es-AR", { maximumFractionDigits: 1 })}K`
        : abs.toLocaleString("es-AR", { maximumFractionDigits: abs >= 10 ? 0 : 2 });
  return signed ? `${value >= 0 ? "+" : "-"}${text}` : text;
};

// Candles a scalping signal is given to reach its target or its stop — the
// same horizon its historical win rate is measured with.
const SCALP_HORIZON = 10;

const priceLabel = (price: number) =>
  price >= 1000
    ? price.toLocaleString("es-AR", { maximumFractionDigits: 0 })
    : price.toLocaleString("es-AR", { maximumFractionDigits: price >= 1 ? 2 : 6 });

/**
 * The canvas is measured, not fixed.
 *
 * A hard-coded viewBox has one aspect ratio; a phone's panel is nearly square
 * and a laptop's is wide. With preserveAspectRatio the browser fits the
 * drawing to the width and centres it, which left thick dead bands above and
 * below the chart on a phone. Measuring the container and drawing at exactly
 * its size removes that entirely, and is what makes one chart genuinely work
 * on both screens rather than being tuned for one of them.
 */
const DEFAULT_BOX = { width: 1000, height: 470 };
/** Candles kept for display; zoom picks a tail of these without refetching. */
const MAX_DISPLAY_CANDLES = 220;
const MARGIN = { top: 12, right: 78, bottom: 28, left: 10 };
/** Leverage tiers the liquidation model works with (identical for every symbol). */
const ALL_TIERS = leverageTiersFor("BTCUSDT").map((t) => t.leverage);
export default function LiquidationHeatmapDesk() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState("1h");
  const [rawData, setData] = useState<ApiResponse | null>(null);
  // Which leverage tiers the liquidation map shows. All by default; a 100x
  // position dies to a ~1% move and a 10x to ~10%, so isolating tiers answers
  // "how much is at stake on a small move" — which the blended map can't.
  const [tiers, setTiers] = useState<number[]>(ALL_TIERS);
  const data = useMemo<ApiResponse | null>(() => {
    if (!rawData) return rawData;
    const filtered = filterHeatmapTiers(rawData.heatmap, tiers);
    if (filtered) return { ...rawData, heatmap: filtered };
    // The chosen tiers leave nothing in range: show that, not the full map
    // under a label that says otherwise.
    return {
      ...rawData,
      heatmap: {
        ...rawData.heatmap,
        buckets: [],
        topZoneAbove: null,
        topZoneBelow: null,
        bias: "SIN SESGO CLARO",
        biasNote: "No hay niveles de liquidación para los apalancamientos elegidos en este rango.",
      },
    };
  }, [rawData, tiers]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  /**
   * Keep the map current without a manual reload.
   *
   * The cadence follows the timeframe: a 15m map has nothing new to say every
   * ten seconds, and hammering Binance for a chart nobody is watching that
   * closely wastes someone else's rate limit. Refreshes are silent — no
   * spinner — so a zoom or a read is never interrupted by the panel blanking
   * out under the reader.
   */
  useEffect(() => {
    // Short frames refresh faster: the liquidation columns show where each
    // level was swept, and on 1m a five-minute refresh left levels drawn for
    // five candles after price had already taken them.
    const period =
      timeframe === "1m"
        ? 30_000
        : timeframe === "3m" || timeframe === "5m" || timeframe === "15m"
          ? 60_000
          : timeframe === "30m" || timeframe === "1h" || timeframe === "2h"
            ? 120_000
            : 300_000;
    const id = setInterval(() => setRefreshKey((key) => key + 1), period);
    return () => clearInterval(id);
  }, [timeframe]);
  const [hovered, setHovered] = useState<HeatBucket | null>(null);
  /** Visible candle count. Fewer candles = zoomed in. */
  const [visibleCandles, setVisibleCandles] = useState(70);
  /**
   * Price-axis view. `scale` multiplies the automatic span (below 1 zooms in);
   * `center` overrides the automatic mid-price so the reader can travel up
   * into the liquidity that sits above the traded range, or down below it.
   * Null center means "follow the data", which is the default and what the
   * reset button returns to.
   */
  const [priceView, setPriceView] = useState<{ scale: number; center: number | null }>({
    scale: 1,
    center: null,
  });
  const [symbols, setSymbols] = useState<string[]>(FALLBACK_SYMBOLS);
  const [symbolQuery, setSymbolQuery] = useState("");
  const [htfPools, setHtfPools] = useState<{ timeframe: string; pools: LiquidityPool[] }[]>([]);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>(DEFAULT_LAYERS);
  const [simple, setSimple] = useState(false);
  // Deferred read, same as the workspace: the server and the first client
  // paint must agree, so the saved choice is applied right after hydration.
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        const saved = JSON.parse(window.localStorage.getItem(LAYERS_KEY) ?? "null");
        if (saved && typeof saved === "object") setLayers({ ...DEFAULT_LAYERS, ...saved });
        if (window.localStorage.getItem(SIMPLE_KEY) === "1") setSimple(true);
      } catch {
        // Keep the defaults.
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, []);
  const toggleSimple = () => {
    const next = !simple;
    let nextLayers: Record<LayerKey, boolean> = simpleLayers();
    try {
      if (next) {
        window.localStorage.setItem(`${SIMPLE_KEY}:before`, JSON.stringify(layers));
      } else {
        const before = JSON.parse(window.localStorage.getItem(`${SIMPLE_KEY}:before`) ?? "null");
        nextLayers = before && typeof before === "object" ? { ...DEFAULT_LAYERS, ...before } : DEFAULT_LAYERS;
      }
      window.localStorage.setItem(SIMPLE_KEY, next ? "1" : "0");
      window.localStorage.setItem(LAYERS_KEY, JSON.stringify(nextLayers));
    } catch {
      if (!next) nextLayers = DEFAULT_LAYERS;
    }
    setSimple(next);
    setLayers(nextLayers);
  };
  const toggleLayer = (key: LayerKey) => {
    if (key === "footprint") setVisibleCandles((v) => (layers.footprint ? Math.max(v, 25) : Math.min(v, 12)));
    setLayers((current) => {
      const next = { ...current, [key]: !current[key] };
      try {
        window.localStorage.setItem(LAYERS_KEY, JSON.stringify(next));
      } catch {
        // Not persisted; still applied for this visit.
      }
      return next;
    });
  };
  const [liveKline, setLiveKline] = useState<LiveKline | null>(null);
  const [liveLiqs, setLiveLiqs] = useState<LiveLiquidation[]>([]);
  // Footprint: trades kept in a ref as they arrive, published to state once a
  // second (a busy pair prints dozens per second).
  const footprintMode = layers.footprint && FOOTPRINT_FRAMES.has(timeframe);
  const tradesRef = useRef<Map<number, Trade>>(new Map());
  const tradesDirty = useRef(false);
  const [trades, setTrades] = useState<Trade[]>([]);
  /** Minimum bubble size in dollars; null = automatic (top 0,5% of what is on screen). */
  const [bubbleMin, setBubbleMin] = useState<number | null>(null);
  const [cross, setCross] = useState<{ i: number; y: number } | null>(null);
  const [feed, setFeed] = useState<FeedStatus>({ state: "conectando", source: null, lastUpdate: null });

  // Live feed: WebSocket first, REST (futures, then spot) as fallback. The
  // logic lives in lib/live-feed.ts, where every failure mode is tested.
  useEffect(() => {
    let alive = true;
    queueMicrotask(() => {
      if (!alive) return;
      setLiveKline(null);
      setLiveLiqs([]);
      setFeed({ state: "conectando", source: null, lastUpdate: null });
    });
    const stop = startLiveFeed(
      {
        symbol,
        timeframe,
        futuresBases: FUTURES_BASES,
        spotBases: BROWSER_BASES,
        onKline: (k) => alive && setLiveKline(k),
        onLiquidation: (l) => alive && setLiveLiqs((current) => [l, ...current].slice(0, 300)),
        onStatus: (next) => alive && setFeed(next),
        trades: footprintMode,
        onTrade: (t) => {
          tradesRef.current.set(t.id, t);
          tradesDirty.current = true;
        },
      },
      browserFeedDeps(),
    );
    return () => {
      alive = false;
      stop();
    };
  }, [symbol, timeframe, footprintMode]);

  // Footprint backfill: the last ~6,000 trades (6 pages of 1,000, newest
  // first), then live trades from the socket. Candles older than the first
  // trade seen are not given a footprint at all.
  useEffect(() => {
    if (!footprintMode) return;
    const controller = new AbortController();
    let alive = true;
    tradesRef.current = new Map();
    const publish = () => {
      const all = [...tradesRef.current.values()];
      // Bounded memory on busy pairs: keep the newest 40,000.
      if (all.length > 40_000) {
        all.sort((a, b) => a.id - b.id);
        for (const t of all.slice(0, all.length - 40_000)) tradesRef.current.delete(t.id);
      }
      setTrades([...tradesRef.current.values()]);
    };
    (async () => {
      let fromId: number | null = null;
      for (let page = 0; page < 6; page += 1) {
        let rows: unknown[] | null = null;
        for (const base of FUTURES_BASES) {
          try {
            const r = await fetch(
              `${base}/fapi/v1/aggTrades?symbol=${symbol}&limit=1000${fromId !== null ? `&fromId=${fromId}` : ""}`,
              { signal: controller.signal, cache: "no-store" },
            );
            if (r.ok) {
              rows = (await r.json()) as unknown[];
              break;
            }
          } catch {
            // Next mirror.
          }
        }
        if (!alive || !rows?.length) break;
        let minId = Infinity;
        for (const raw of rows) {
          const t = parseAggTrade(raw);
          if (!t) continue;
          tradesRef.current.set(t.id, t);
          minId = Math.min(minId, t.id);
        }
        if (!Number.isFinite(minId) || minId < 1000) break;
        fromId = minId - 1000;
      }
      if (alive) publish();
    })();
    const flush = window.setInterval(() => {
      if (tradesDirty.current) {
        tradesDirty.current = false;
        publish();
      }
    }, 1000);
    return () => {
      alive = false;
      controller.abort();
      window.clearInterval(flush);
    };
  }, [footprintMode, symbol, timeframe]);

  // Liquidity from the larger frames, loaded on its own so the map does not
  // wait for it. Only unswept pools matter; findLiquidityPools already drops
  // the rest.
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    (async () => {
      const out: { timeframe: string; pools: LiquidityPool[] }[] = [];
      for (const tf of higherTimeframes(timeframe)) {
        try {
          const rows = await loadRows(symbol, tf, 300, controller.signal);
          const candles = parseSwingKlines(rows);
          if (candles.length >= 20) out.push({ timeframe: tf, pools: findLiquidityPools(candles) });
        } catch {
          // A missing larger frame only means fewer confluences, not an error.
        }
      }
      if (alive) setHtfPools(out);
    })();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [symbol, timeframe]);

  useEffect(() => {
    const controller = new AbortController();
    loadTopSymbols(controller.signal)
      .then((ranked) => {
        if (ranked) setSymbols(ranked);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  const [box, setBox] = useState(DEFAULT_BOX);
  const observerRef = useRef<ResizeObserver | null>(null);

  /**
   * Callback ref, not useEffect.
   *
   * The chart container only exists once data has loaded, so an effect with an
   * empty dependency list ran while the node was still null, bailed out, and
   * never fired again — leaving the canvas stuck at its default size and
   * letterboxed exactly as before. A callback ref runs when the node actually
   * attaches, which is the only moment there is anything to measure.
   */
  const chartRef = (node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!node || typeof ResizeObserver === "undefined") return;
    const apply = (width: number, height: number) => {
      if (width < 10 || height < 10) return;
      setBox((current) =>
        Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
          ? current
          : { width, height },
      );
    };
    apply(node.clientWidth, node.clientHeight);
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) apply(rect.width, rect.height);
    });
    observer.observe(node);
    observerRef.current = observer;
  };

  // Loading/error reset lives here, in the handlers that change symbol or
  // timeframe, rather than at the top of the effect below — so the state
  // update that shows the spinner happens in the same tick as the click,
  // not as a synchronous set-state-in-effect firing right after render.
  // Changing pair or timeframe is a fresh load, not a refresh: clear the old
  // map so a failure can't leave BTC's chart on screen under an ETH label,
  // and reset the refresh counter so that load is allowed to report errors.
  const selectSymbol = (next: string) => {
    setSymbolQuery("");
    setLoading(true);
    setError("");
    setData(null);
    setRefreshKey(0);
    setVisibleCandles(70);
    setSymbol(next);
  };
  // Another panel (SUBEN SOLAS) can ask the map to show a coin.
  useEffect(
    () =>
      onMapSymbol((next) => {
        setSymbolQuery("");
        setLoading(true);
        setError("");
        setData(null);
        setRefreshKey(0);
        setVisibleCandles(70);
        setSymbol(next);
      }),
    [],
  );
  const selectTimeframe = (next: string) => {
    setLoading(true);
    setError("");
    setData(null);
    setRefreshKey(0);
    setVisibleCandles(70);
    setTimeframe(next);
  };

  // A footprint is only readable a handful of candles wide on a phone.
  const MIN_VISIBLE = layers.footprint && FOOTPRINT_FRAMES.has(timeframe) ? 6 : 25;
  const MAX_VISIBLE = 220;
  const clampVisible = (n: number) => Math.max(MIN_VISIBLE, Math.min(MAX_VISIBLE, Math.round(n)));
  const MIN_PRICE_SCALE = 0.12;
  const MAX_PRICE_SCALE = 2.2;
  const clampScale = (v: number) => Math.max(MIN_PRICE_SCALE, Math.min(MAX_PRICE_SCALE, v));
  const resetView = () => {
    setVisibleCandles(70);
    setPriceView({ scale: 1, center: null });
  };
  const zoomIn = () => setVisibleCandles((n) => clampVisible(n / 1.5));
  const zoomOut = () => setVisibleCandles((n) => clampVisible(n * 1.5));

  /**
   * Pinch to zoom, and a two-finger-free drag to zoom on devices or hands
   * that find pinching awkward.
   *
   * The gesture state lives in a ref rather than state: it changes on every
   * touchmove, and re-rendering the whole chart at that rate would make the
   * gesture feel heavy. Only the resulting candle count goes through state.
   */
  const gesture = useRef<{
    dx: number;
    dy: number;
    midY: number;
    candles: number;
    scale: number;
    center: number;
    span: number;
  } | null>(null);
  /** Latest price window, so a gesture can pan in price units, not pixels. */
  const priceWindow = useRef<{ lo: number; hi: number; height: number }>({
    lo: 0,
    hi: 0,
    height: 1,
  });

  const onTouchStart = (event: React.TouchEvent) => {
    if (event.touches.length !== 2) return;
    const [a, b] = [event.touches[0], event.touches[1]];
    const { lo, hi } = priceWindow.current;
    gesture.current = {
      dx: Math.abs(a.clientX - b.clientX),
      dy: Math.abs(a.clientY - b.clientY),
      midY: (a.clientY + b.clientY) / 2,
      candles: visibleCandles,
      scale: priceView.scale,
      center: priceView.center ?? (lo + hi) / 2,
      span: hi - lo,
    };
  };

  const onTouchMove = (event: React.TouchEvent) => {
    if (event.touches.length !== 2 || !gesture.current) return;
    const [a, b] = [event.touches[0], event.touches[1]];
    const start = gesture.current;

    const dx = Math.abs(a.clientX - b.clientX);
    const dy = Math.abs(a.clientY - b.clientY);
    const midY = (a.clientY + b.clientY) / 2;

    // Which axis the fingers are actually working decides what gets zoomed.
    // A pinch that is mostly vertical means "show me more price", which is
    // how a reader travels up into the liquidity above the candles; a mostly
    // horizontal one means "show me more time".
    const movedX = Math.abs(dx - start.dx);
    const movedY = Math.abs(dy - start.dy);

    if (movedY > movedX && start.dy > 20 && dy > 20) {
      setPriceView((view) => ({ ...view, scale: clampScale(start.scale * (start.dy / dy)) }));
    } else if (start.dx > 20 && dx > 20) {
      setVisibleCandles(clampVisible(start.candles * (start.dx / dx)));
    }

    // Dragging both fingers together travels along the price axis. Converting
    // the pixel movement through the current window keeps the chart tracking
    // the fingers instead of drifting at a different rate as zoom changes.
    const pannedPx = midY - start.midY;
    if (Math.abs(pannedPx) > 2 && priceWindow.current.height > 0) {
      const perPixel = start.span / priceWindow.current.height;
      setPriceView((view) => ({ ...view, center: start.center + pannedPx * perPixel }));
    }

    if (event.cancelable) event.preventDefault();
  };

  const onTouchEnd = () => {
    gesture.current = null;
  };

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    // A silent auto-refresh must never blank out a map the reader is looking
    // at. On a background refresh a transient failure is ignored and the last
    // good map stays on screen; only the first load for a symbol reports an
    // error, because then there is nothing to keep.
    const isRefresh = refreshKey > 0;
    const fail = (message: string) => {
      if (isRefresh) return;
      setError(message);
      setData(null);
    };

    (async () => {
      try {
        const interval = timeframe;
        const config = timeframeConfig(timeframe);
        const rows = await loadRows(symbol, interval, config.lookback, controller.signal);
        if (!alive) return;
        if (!rows) {
          fail("MAPA NO DISPONIBLE");
          return;
        }

        const candles = parseSwingKlines(rows);
        if (candles.length < 20) {
          fail("SIN VELAS SUFICIENTES");
          return;
        }

        const currentPrice = candles.at(-1)!.close;
        // Open interest is a strictly better weight than volume, but it is
        // futures-only and short-retention — so it is fetched separately and
        // the engine degrades to volume wherever it is missing.
        const [oiDeltaByIndex, openContracts] = await Promise.all([
          loadOiDelta(
            symbol,
            timeframe,
            candles.map((candle) => candle.openTime),
            controller.signal,
          ),
          loadOpenInterest(symbol, controller.signal),
        ]);
        if (!alive) return;

        const heatmap = buildLiquidationHeatmap(symbol, candles, currentPrice, {
          oiDeltaByIndex: oiDeltaByIndex ?? undefined,
          halfLifeCandles: config.halfLife,
          priceRangePct: config.priceRange,
          totalOpenInterestUsd:
            openContracts !== null ? openContracts * currentPrice : undefined,
        });
        if (!heatmap) {
          fail("MAPA NO DISPONIBLE");
          return;
        }

        const lives = buildLiquidationLives(symbol, candles, {
          oiDeltaByIndex: oiDeltaByIndex ?? undefined,
          priceRangePct: config.priceRange,
        });

        setUpdatedAt(Date.now());
        const takerBuyByTime = new Map<number, number>();
        for (const row of rows as unknown[][]) {
          const v = Number(row[9]);
          if (Number.isFinite(v)) takerBuyByTime.set(Number(row[0]), v);
        }
        setData({
          heatmap,
          candles: candles.slice(-MAX_DISPLAY_CANDLES).map((candle) => ({
            takerBuy: takerBuyByTime.get(candle.openTime),
            time: candle.openTime,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            // Real volume, not a placeholder — order blocks and gaps need it
            // to report anything about size. It was dropped here before,
            // which silently made every order block's volume reading
            // meaningless (see the fix in lib/order-blocks.ts).
            volume: candle.volume,
          })),
          timeframe,
          lives,
          halfLife: config.halfLife ?? null,
        });
      } catch {
        if (alive) fail("MAPA NO DISPONIBLE");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [symbol, timeframe, refreshKey]);

  const layout = useMemo(() => {
    if (!data || !data.candles.length) return null;
    const { heatmap } = data;
    // Only merge a live candle into a series of the same frame: after a
    // frame switch the socket can deliver before the new candles load, and a
    // 4h candle appended to a 1h series would be drawn as if it belonged.
    const series =
      data.timeframe === timeframe && data.heatmap.symbol === symbol
        ? mergeLiveCandle(data.candles, liveKline)
        : data.candles;
    const candles = series.slice(-visibleCandles);
    if (!candles.length) return null;

    const plotW = box.width - MARGIN.left - MARGIN.right;
    const fullH = box.height - MARGIN.top - MARGIN.bottom;
    // Volume gets its own strip under the candles instead of being drawn
    // behind them, where it would compete with the liquidity bands. Everything
    // price-based (y, rows, pinch) uses plotH, which now ends above the strip.
    // Sub-panes under the price, in order: volume, RSI, MACD. Each is a share
    // of the height, shrunk together if the price area would drop under half.
    const PANE_GAP = 8;
    let volH = layers.volumen ? Math.max(26, Math.round(fullH * 0.12)) : 0;
    let rsiH = layers.rsi ? Math.max(40, Math.round(fullH * 0.13)) : 0;
    let macdH = layers.macd ? Math.max(40, Math.round(fullH * 0.13)) : 0;
    const paneCount = [volH, rsiH, macdH].filter((h) => h > 0).length;
    const paneTotal = volH + rsiH + macdH + paneCount * PANE_GAP;
    if (paneTotal > fullH * 0.5) {
      const k = (fullH * 0.5 - paneCount * PANE_GAP) / (volH + rsiH + macdH);
      volH = Math.floor(volH * k);
      rsiH = Math.floor(rsiH * k);
      macdH = Math.floor(macdH * k);
    }
    const plotH = fullH - volH - rsiH - macdH - paneCount * PANE_GAP;
    if (plotW < 80 || plotH < 80) return null;
    let cursor = MARGIN.top + plotH;
    const volTop = volH ? (cursor += PANE_GAP) : cursor;
    cursor += volH;
    const rsiTop = rsiH ? (cursor += PANE_GAP) : cursor;
    cursor += rsiH;
    const macdTop = macdH ? (cursor += PANE_GAP) : cursor;
    // The profile strip scales with width instead of eating a fixed 104px of
    // a narrow phone, where that was a quarter of the whole chart.
    const profileW = Math.max(56, Math.min(150, box.width * 0.15));

    // Scale to cover BOTH the traded range and the two magnet zones the
    // cards above call out. Scaling to candles alone left those zones off
    // the chart entirely — the panel was naming levels the reader could not
    // see, which is worse than not naming them. The span is still capped so
    // a far-away zone cannot squash the candles into a sliver: past the cap
    // the zone is simply outside the window, as in any charting tool.
    const candleHighs = candles.map((c) => c.high);
    const candleLows = candles.map((c) => c.low);
    const tradedHi = Math.max(...candleHighs);
    const tradedLo = Math.min(...candleLows);

    const zonePrices = [heatmap.topZoneAbove?.price, heatmap.topZoneBelow?.price].filter(
      (price): price is number => typeof price === "number",
    );
    const MAX_SPAN = 0.09; // ±9% of price is as far as the window will stretch.
    const capHi = heatmap.currentPrice * (1 + MAX_SPAN);
    const capLo = heatmap.currentPrice * (1 - MAX_SPAN);
    // Footprint mode frames the candles only: its cells are rows of price
    // inside each candle, and a window stretched to a far magnet zone
    // squashed a 1-minute candle to two pixels.
    const fitCandles = layers.footprint && FOOTPRINT_FRAMES.has(timeframe);
    const wantHi = fitCandles ? tradedHi : Math.max(tradedHi, ...zonePrices.filter((p) => p <= capHi));
    const wantLo = fitCandles ? tradedLo : Math.min(tradedLo, ...zonePrices.filter((p) => p >= capLo));

    const headroom = (wantHi - wantLo) * 0.06;
    const autoLo = Math.max(0, wantLo - headroom);
    const autoHi = wantHi + headroom;

    // The reader's price view overrides the automatic window: zooming in
    // narrows the span, and panning moves the centre so the liquidity above
    // or below the traded range can be brought into frame.
    const autoCentre = (autoLo + autoHi) / 2;
    const centre = priceView.center ?? autoCentre;
    const span = Math.max(1e-8, (autoHi - autoLo) * priceView.scale);
    const lo = Math.max(0, centre - span / 2);
    const hi = centre + span / 2;

    const y = (price: number) => MARGIN.top + (1 - (price - lo) / (hi - lo)) * plotH;

    // Candles fill the plot minus the profile strip, so the chart uses its
    // whole width instead of crowding into one side.
    const candleAreaW = plotW - profileW;
    const slot = candleAreaW / candles.length;
    const bodyW = Math.max(2.5, Math.min(9, slot * 0.7));
    const x = (index: number) => MARGIN.left + slot * index + slot / 2;

    // A zone's formedAt indexes the activity lookback, which is longer than
    // the candle window drawn here. Map it proportionally and clamp, so a
    // zone older than the visible window starts at the left edge rather than
    // off-screen.
    const zoneStartX = (formedAt: number) => {
      const fraction = heatmap.profileCandles > 1 ? formedAt / (heatmap.profileCandles - 1) : 0;
      const visibleFraction = Math.max(
        0,
        Math.min(
          1,
          (fraction - (1 - candles.length / heatmap.profileCandles)) /
            (candles.length / heatmap.profileCandles),
        ),
      );
      return MARGIN.left + visibleFraction * candleAreaW;
    };

    /**
     * Collapse the engine's thousands of fine-grained buckets into the number
     * of rows the chart can actually resolve.
     *
     * The engine bins BTC at ~10 USD, so a ±22% projection is ~3,000 buckets
     * competing for ~520px — at a 1px minimum each they overlapped into solid
     * slabs of colour that hid both the structure and the candles. Summing
     * them into one row per visible band is what makes discrete levels legible,
     * and it is also more honest: a 10 USD bucket was never meaningfully
     * distinct from its neighbour at this zoom.
     */
    const ROW_HEIGHT = 3.2;
    const rowCount = Math.max(40, Math.floor(plotH / ROW_HEIGHT));
    const rows = new Map<
      number,
      { longDensity: number; shortDensity: number; notionalUsd: number; formedAt: number; price: number }
    >();
    for (const bucket of heatmap.buckets) {
      if (bucket.price < lo || bucket.price > hi) continue;
      const row = Math.floor(((bucket.price - lo) / (hi - lo)) * rowCount);
      const existing = rows.get(row);
      if (existing) {
        existing.longDensity += bucket.longDensity;
        existing.shortDensity += bucket.shortDensity;
        existing.notionalUsd += bucket.notionalUsd ?? 0;
        existing.formedAt = Math.min(existing.formedAt, bucket.formedAt);
      } else {
        rows.set(row, {
          longDensity: bucket.longDensity,
          shortDensity: bucket.shortDensity,
          notionalUsd: bucket.notionalUsd ?? 0,
          formedAt: bucket.formedAt,
          price: bucket.price,
        });
      }
    }

    const visibleZones = [...rows.values()].map((row) => ({
      ...row,
      total: row.longDensity + row.shortDensity,
    }));
    const rowPeak = Math.max(...visibleZones.map((z) => z.total), 1);
    // Drop the faintest rows outright: at very low intensity they add noise,
    // not information, and keeping them is what produced a wash of colour.
    const scored = visibleZones
      .map((zone) => ({ ...zone, intensity: (zone.total / rowPeak) * 100 }))
      .filter((zone) => zone.intensity >= 6);

    /**
     * Only the heaviest handful of rows may draw a long horizontal band.
     *
     * Filtering by intensity alone did not fix the murky slab: inside a dense
     * cluster nearly every row is intense, so nearly every row still drew a
     * band and they stacked into a solid block again. Bounding the COUNT is
     * what actually guarantees separated lines, regardless of how the
     * intensities happen to be distributed.
     */
    const BAND_LIMIT = 8;
    const banded = new Set(
      [...scored]
        .sort((a, b) => b.intensity - a.intensity)
        .slice(0, BAND_LIMIT)
        .map((zone) => zone.price),
    );

    const zones = scored
      .map((zone) => ({ ...zone, banded: banded.has(zone.price) }))
      .sort((a, b) => a.price - b.price);

    /**
     * The profile on the right, as a solid stepped silhouette rather than
     * hundreds of hairlines.
     *
     * Rows a few pixels tall were drawn as bars 1–3px thick in an intensity
     * rainbow: readable as texture, unreadable as a profile. Merging every
     * three rows into one step gives the chunky staircase a reader can compare
     * at a glance — length carries the size, colour carries the side (shorts
     * liquidated above price, longs below).
     */
    const STEP_ROWS = 3;
    const steps = new Map<number, { long: number; short: number; usd: number; formedAt: number; bestTotal: number; bestPrice: number }>();
    for (const [rowIndex, row] of rows) {
      const group = Math.floor(rowIndex / STEP_ROWS);
      const total = row.longDensity + row.shortDensity;
      const current = steps.get(group);
      if (current) {
        current.long += row.longDensity;
        current.short += row.shortDensity;
        current.usd += row.notionalUsd;
        current.formedAt = Math.min(current.formedAt, row.formedAt);
        if (total > current.bestTotal) {
          current.bestTotal = total;
          current.bestPrice = row.price;
        }
      } else {
        steps.set(group, { long: row.longDensity, short: row.shortDensity, usd: row.notionalUsd, formedAt: row.formedAt, bestTotal: total, bestPrice: row.price });
      }
    }
    const stepPeak = Math.max(...[...steps.values()].map((st) => st.long + st.short), 1);
    const priceSpan = hi - lo;
    const profileSteps = [...steps.entries()]
      .map(([group, st]) => {
        const pLo = lo + ((group * STEP_ROWS) / rowCount) * priceSpan;
        const pHi = lo + (((group + 1) * STEP_ROWS) / rowCount) * priceSpan;
        const total = st.long + st.short;
        return {
          key: group,
          yTop: y(pHi),
          h: y(pLo) - y(pHi),
          frac: total / stepPeak,
          side: (pLo + pHi) / 2 < heatmap.currentPrice ? ("long" as const) : ("short" as const),
          total,
          usd: st.usd,
          long: st.long,
          short: st.short,
          formedAt: st.formedAt,
          price: st.bestPrice,
        };
      })
      // Only steps big enough to read as a pool: the small ones scattered along
      // the axis were noise that made the silhouette look ragged.
      .filter((st) => st.frac >= 0.1);

    // The next-strongest pool on each side, apart from the magnet the cards
    // already name — so the chart marks more than just two levels.
    const groupOf = (price: number) => Math.floor((((price - lo) / priceSpan) * rowCount) / STEP_ROWS);
    const secondaryPool = (side: "long" | "short") => {
      const anchor = side === "short" ? heatmap.topZoneAbove : heatmap.topZoneBelow;
      const anchorGroup = anchor ? groupOf(anchor.price) : null;
      const best = profileSteps
        .filter((st) => st.side === side && (anchorGroup === null || Math.abs(st.key - anchorGroup) > 4))
        .sort((a, b) => b.total - a.total)[0];
      return best && best.frac >= 0.25 ? best : null;
    };
    const secondaryPools = [secondaryPool("short"), secondaryPool("long")].filter(
      (pool): pool is NonNullable<ReturnType<typeof secondaryPool>> => pool !== null,
    );
    const poolTotalUsd = [...rows.values()].reduce((sum, row) => sum + row.notionalUsd, 0);

    return { candles, series, heatmap, y, x, bodyW, zoneStartX, candleAreaW, profileW, plotH, lo, hi, zones, profileSteps, secondaryPools, poolTotalUsd, rowHeight: ROW_HEIGHT, volTop, volH, rsiTop, rsiH, macdTop, macdH };
  }, [data, box, visibleCandles, priceView, liveKline, timeframe, symbol, layers.volumen, layers.rsi, layers.macd, layers.footprint]);

  // Keep the gesture's view of the price window in step with what is drawn.
  // In an effect, not during render: writing a ref while rendering is a side
  // effect in the render path, and React is right to flag it.
  useEffect(() => {
    if (layout) {
      priceWindow.current = { lo: layout.lo, hi: layout.hi, height: layout.plotH };
    }
  }, [layout]);

  const livePrice =
    liveKline && data?.timeframe === timeframe && data.heatmap.symbol === symbol
      ? liveKline.close
      : (data?.heatmap.currentPrice ?? null);
  const liqTotals = useMemo(() => liquidationTotals(liveLiqs), [liveLiqs]);

  const swingView = useMemo(
    () =>
      layout
        ? layout.candles.map((candle) => ({
            openTime: candle.time,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
            quoteVolume: candle.volume * candle.close,
          }))
        : [],
    [layout],
  );

  // Same swingView every OB-family detector reads — previously this built
  // its own copy with volume hard-set to 1, so an order block's volumeUsd
  // on the chart was never the real notional. swingView already exists
  // with real volume; reusing it here fixed that as a side effect.
  const orderBlocks = useMemo<OrderBlock[]>(() => {
    if (!layout || !swingView.length) return [];
    return findOrderBlocks(swingView).filter(
      (block) => block.high >= layout.lo && block.low <= layout.hi,
    );
  }, [layout, swingView]);

  const breakerBlocks = useMemo<BreakerBlock[]>(() => {
    if (!layout || !swingView.length) return [];
    return findBreakerBlocks(swingView).filter(
      (block) => block.high >= layout.lo && block.low <= layout.hi,
    );
  }, [layout, swingView]);

  const gaps = useMemo<FairValueGap[]>(() => {
    if (!layout || !swingView.length) return [];
    return findFairValueGaps(swingView).filter(
      (gap) => gap.high >= layout.lo && gap.low <= layout.hi,
    );
  }, [layout, swingView]);

  // Computed once per load over the full series in view — not per zone, and
  // not a probability: a count of what actually happened in these candles,
  // with the sample size that makes the number readable honestly.
  const gapConfidence = useMemo<GapStats | null>(
    () => (swingView.length ? gapStats(swingView) : null),
    [swingView],
  );

  // Merged across the chart's own frame and the larger ones. A level seen on
  // several frames is one line naming all of them, not a stack of copies.
  const pools = useMemo<(MtfPool & { taken: boolean })[]>(() => {
    if (!layout || !swingView.length) return [];
    return mergeMtfPools([
      // Closed candles only: the forming candle decides "taken" below,
      // live, instead of silently deleting the level mid-candle.
      { timeframe, pools: findLiquidityPools(swingView.slice(0, -1)) },
      ...htfPools,
    ])
      .filter((pool) => pool.price >= layout.lo && pool.price <= layout.hi)
      .map((pool) => ({ ...pool, taken: isPoolTaken(pool, swingView.at(-1) ?? null) }));
  }, [layout, swingView, htfPools, timeframe]);

  const scenarios = useMemo<ScenarioBoard | null>(() => {
    if (!layout) return null;
    return buildScenarios({
      currentPrice: livePrice ?? layout.heatmap.currentPrice,
      // A level already taken has no orders left to aim at.
      pools: pools.filter((pool) => !pool.taken),
      orderBlocks,
      gaps,
      heatmap: layout.heatmap,
    });
  }, [layout, pools, orderBlocks, gaps, livePrice]);
  const obConfidence = useMemo<ZoneStats | null>(
    () => (swingView.length ? orderBlockStats(swingView) : null),
    [swingView],
  );

  const breakerConfidence = useMemo<ZoneStats | null>(
    () => (swingView.length ? breakerBlockStats(swingView) : null),
    [swingView],
  );

  const fibZone = useMemo<FibZoneState | null>(
    () => (swingView.length ? readFibZone(swingView) : null),
    [swingView],
  );

  /**
   * Decides which level labels the chart may draw.
   *
   * Even short labels collide when two levels sit at nearly the same price,
   * and a stack of overlapping text is worse than no text — it hides the
   * candles behind it and none of it can be read. So labels are claimed
   * top-down by strength: the first to claim a vertical slot keeps it, the
   * rest are drawn as their zone without a caption. Nothing is lost, because
   * every level is listed in full under the chart.
   */
  /**
   * Patterns are read on the whole loaded series, not only the zoomed window —
   * otherwise zooming would make a Wyckoff range appear and vanish. Indices
   * are shifted into the visible window for drawing; off-screen parts clip.
   */
  const patternSeries = useMemo(
    () =>
      layout
        ? layout.series.map((c) => ({
            openTime: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
            quoteVolume: 0,
          }))
        : [],
    [layout],
  );
  const patternOffset = layout ? layout.series.length - layout.candles.length : 0;
  const flags = useMemo<FlagPattern[]>(() => findFlags(patternSeries), [patternSeries]);

  // RSI / MACD on the whole loaded series; the panes show the visible slice.
  const osc = useMemo(() => {
    const closes = patternSeries.map((c) => c.close);
    const r = rsi(closes);
    const m = macd(closes);
    const macdRange = Math.max(1e-12, ...m.macd.slice(-150).filter((v): v is number => v !== null).map(Math.abs));
    const divs = [
      ...findDivergences(patternSeries, r, "RSI", { minOscDelta: 2 }),
      ...findDivergences(patternSeries, m.macd, "MACD", { minOscDelta: macdRange * 0.05 }),
    ];
    return { r, m, divs, stats: divergenceStats(patternSeries, divs) };
  }, [patternSeries]);

  const footprints = useMemo(() => {
    if (!footprintMode || !layout || !trades.length) return null;
    let first = Infinity;
    for (const t of trades) if (t.time < first) first = t.time;
    const size = bucketSize(layout.candles.map((c) => c.high - c.low));
    const map = buildFootprints(trades, layout.candles.map((c) => c.time), FRAME_MS[timeframe], size, first);
    let maxCell = 0;
    for (const fp of map.values()) for (const c of fp.cells.values()) maxCell = Math.max(maxCell, c.buy + c.sell);
    return { map, maxCell };
  }, [footprintMode, layout, trades, timeframe]);

  // Liquidity sweeps on 5-candle pivots: about 13 per 300 candles on random
  // data, with a 50–51% "worked" rate there — the baseline shown in the panel.
  const sweeps = useMemo(() => findSweeps(patternSeries, 5), [patternSeries]);
  const sweepSt = useMemo(() => sweepStats(patternSeries, sweeps), [patternSeries, sweeps]);
  const wyckoff = useMemo<WyckoffReading | null>(() => readWyckoff(patternSeries), [patternSeries]);

  /**
   * The stacked liquidation columns, painted once into a small image (one
   * pixel per cell) and stretched over the candle area: tens of thousands of
   * SVG rectangles would make every zoom and every live tick crawl. Skipped in
   * footprint mode, where the candles' own price cells need the space.
   */
  const columnImage = useMemo(() => {
    if (simple || !layers.calor || !layout || !data?.lives?.length || typeof document === "undefined") return null;
    if (layers.footprint && FOOTPRINT_FRAMES.has(timeframe)) return null;
    const times = layout.candles.map((c) => c.time);
    const rows = Math.max(40, Math.min(170, Math.round(layout.plotH / 4)));
    const grid = liquidationGrid(data.lives, {
      times,
      lo: layout.lo,
      hi: layout.hi,
      rows,
      halfLife: data.halfLife,
      frameMs: FRAME_MS[data.timeframe] ?? 3_600_000,
      tiers,
    });
    if (!grid.scale) return null;
    // Three pixels per column, the third left empty, so the columns read as
    // separate bars once there is room for a gap.
    const gap = layout.candleAreaW / grid.cols >= 5;
    const px = gap ? 3 : 1;
    const canvas = document.createElement("canvas");
    canvas.width = grid.cols * px;
    canvas.height = grid.rows;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const image = ctx.createImageData(canvas.width, canvas.height);
    for (let c = 0; c < grid.cols; c += 1) {
      for (let r = 0; r < grid.rows; r += 1) {
        const color = gridColor(grid.cells[c * grid.rows + r], grid.scale);
        if (!color) continue;
        const yPix = grid.rows - 1 - r; // row 0 is the bottom of the price range
        for (let k = 0; k < (gap ? 2 : 1); k += 1) {
          const o = (yPix * canvas.width + c * px + k) * 4;
          image.data[o] = color[0];
          image.data[o + 1] = color[1];
          image.data[o + 2] = color[2];
          image.data[o + 3] = color[3];
        }
      }
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL();
  }, [simple, layers.calor, layers.footprint, layout, data, timeframe, tiers]);

  // Scalping signals run on the whole loaded series, minus its last candle:
  // that one is still forming, and a signal that can appear and vanish while
  // a candle moves is a repainting signal — the one kind that can't be
  // trusted or measured. Only closed candles ever signal.
  const scalpSeries = useMemo(() => patternSeries.slice(0, -1), [patternSeries]);
  // Trendlines and breakouts on the closed candles of the whole loaded series
  // (so zooming never changes them). Fewer candles on each side of a swing on
  // the daily-and-up frames, where a swing is a bigger event and there are
  // fewer candles to find one in.
  const trend = useMemo(() => {
    if (!layers.tendencia || scalpSeries.length < 30) return null;
    const pivotN = ["1m", "3m", "5m", "15m", "30m"].includes(timeframe) ? 5 : ["1h", "2h", "4h"].includes(timeframe) ? 4 : 3;
    return analyzeTrend(scalpSeries, { pivotN });
  }, [layers.tendencia, scalpSeries, timeframe]);
  const scalpSignals = useMemo(
    () => (layers.scalp ? findScalpSignals(scalpSeries, { horizon: SCALP_HORIZON }) : []),
    [layers.scalp, scalpSeries],
  );
  // The newest signal, while it is still inside the horizon it is measured
  // over. One definition so the chip, the box on the chart and the list can't
  // disagree about how old it is.
  const liveScalp = useMemo(() => {
    const newest = scalpSignals.at(-1);
    return newest && patternSeries.length - 1 - newest.index <= SCALP_HORIZON ? newest : null;
  }, [scalpSignals, patternSeries]);
  const scalpSt = useMemo(
    () => scalpStats(scalpSeries, scalpSignals, { horizon: SCALP_HORIZON }),
    [scalpSeries, scalpSignals],
  );

  // Key support and resistance on the closed candles of the loaded series.
  const levels = useMemo(
    () => (layers.sr && scalpSeries.length >= 30 ? supportResistance(scalpSeries, { perSide: 3, span: ["1m", "3m", "5m", "15m", "30m"].includes(timeframe) ? 5 : 3 }) : []),
    [layers.sr, scalpSeries, timeframe],
  );
  // LIQ+VOL, with the liquidation model's flush when the model is loaded,
  // replayed and resolved on this very series: the record is of this coin
  // and this timeframe, not of a backtest somewhere else.
  const lv = useMemo(() => {
    if (!layers.liqvol || scalpSeries.length < 40) return null;
    const flush = data?.lives?.length ? flushSeries(scalpSeries.map((c) => c.openTime), data.lives) : null;
    const trades = resolveLv(scalpSeries, findLvSignals(scalpSeries, { flush }), LV_HORIZON);
    return { trades, stats: lvStats(trades), withModel: Boolean(flush) };
  }, [layers.liqvol, scalpSeries, data]);
  // Inducements (SMC): first real pullback after a break of structure.
  const idms = useMemo(
    () => (layers.idm && scalpSeries.length >= 40 ? findInducements(scalpSeries, { majorSpan: ["1m", "3m", "5m", "15m", "30m"].includes(timeframe) ? 5 : 3 }) : []),
    [layers.idm, scalpSeries, timeframe],
  );
  const idmSt = useMemo(() => idmStats(idms), [idms]);
  const lastIdm = idms.length ? idms.reduce((a, b) => (b.idmIndex > a.idmIndex ? b : a)) : null;
  const liveLv: LvTrade | null = lv && lv.trades.length && lv.trades[lv.trades.length - 1].result === "ABIERTA" ? lv.trades[lv.trades.length - 1] : null;

  // Who is winning, over the candles in view: from the aggressive-buy volume
  // Binance publishes on every kline, so it exists on every timeframe.
  const verdict = useMemo(
    () =>
      layers.footprint && layout
        ? flowVerdict(
            layout.candles.map((c) => ({ open: c.open, close: c.close, volume: c.volume, takerBuy: c.takerBuy })),
          )
        : null,
    [layers.footprint, layout],
  );
  const stacks = useMemo(
    () =>
      footprintMode && layout && footprints
        ? stackTally(layout.candles.map((c) => ({ fp: footprints.map.get(c.time), high: c.high, low: c.low })))
        : null,
    [footprintMode, layout, footprints],
  );

  const bubbles = useMemo(() => {
    if (!footprintMode || !layers.burbujas || !layout || !trades.length || !layout.candles.length) return null;
    const frameMs = FRAME_MS[timeframe] ?? 60_000;
    const first = layout.candles[0].time;
    const picked = pickBubbles(trades, { from: first, to: layout.candles[layout.candles.length - 1].time + frameMs, minNotional: bubbleMin });
    const index = new Map(layout.candles.map((c, i) => [c.time, i] as const));
    const largest = picked.bubbles.reduce((m, b) => Math.max(m, b.notional), 0);
    return { ...picked, index, frameMs, first, largest };
  }, [footprintMode, layers.burbujas, layout, trades, timeframe, bubbleMin]);

  const reversalZones = useMemo<ReversalZone[]>(() => {
    if (!layout || livePrice === null) return [];
    const p = livePrice;
    const atoms: LevelAtom[] = [];
    const around = (price: number, pct: number) => ({ low: price * (1 - pct), high: price * (1 + pct) });
    for (const pool of pools) {
      if (pool.taken) continue;
      atoms.push({ kind: "liquidez", weight: pool.frames.length > 1 ? 1.5 : 1, ...around(pool.price, 0.0005) });
    }
    for (const zone of [layout.heatmap.topZoneAbove, layout.heatmap.topZoneBelow]) {
      if (zone) atoms.push({ kind: "imán de liquidaciones", weight: 1.5, ...around(zone.price, 0.002) });
    }
    for (const block of orderBlocks) atoms.push({ kind: "order block", weight: 1, low: block.low, high: block.high });
    // Same weight as IFVG: both are evidence of an OBSERVED failure — price
    // actually closed through and the level flipped — not just an unfilled
    // level, which is why both rank above their un-broken counterpart.
    for (const block of breakerBlocks) atoms.push({ kind: "breaker block", weight: 1.25, low: block.low, high: block.high });
    for (const gap of gaps) atoms.push({ kind: gap.kind, weight: gap.kind === "IFVG" ? 1.25 : 1, low: gap.low, high: gap.high });
    if (fibZone) for (const l of fibZone.levels) atoms.push({ kind: "Fibonacci", weight: 1, ...around(l.price, 0.001) });
    if (wyckoff) {
      atoms.push({ kind: "borde de rango Wyckoff", weight: 1.25, ...around(wyckoff.support, 0.0015) });
      atoms.push({ kind: "borde de rango Wyckoff", weight: 1.25, ...around(wyckoff.resistance, 0.0015) });
      for (const e of wyckoff.events) {
        if (e.type === "SPRING" || e.type === "UPTHRUST") {
          atoms.push({ kind: e.type === "SPRING" ? "spring" : "upthrust", weight: 1.5, ...around(e.price, 0.0015) });
        }
      }
    }
    return findReversalZones(p, atoms).filter((z) => z.high >= layout.lo && z.low <= layout.hi);
  }, [layout, livePrice, pools, orderBlocks, breakerBlocks, gaps, fibZone, wyckoff]);

  const labelSlots = useMemo(() => {
    if (!layout) return { pool: new Set<string>(), ob: new Set<number>(), breaker: new Set<number>(), gap: new Set<number>(), rev: new Set<number>(), fib: [] as { y: number; text: string }[], wy: false, flag: new Set<string>() };
    const MIN_GAP_PX = 15;
    const taken: number[] = [];
    const claim = (price: number) => {
      const y = layout.y(price);
      if (taken.some((other) => Math.abs(other - y) < MIN_GAP_PX)) return false;
      taken.push(y);
      return true;
    };

    // Magnet lines are claimed first: they are the levels the panel's own
    // summary cards name, so losing their caption would contradict the cards.
    for (const zone of [layout.heatmap.topZoneAbove, layout.heatmap.topZoneBelow]) {
      if (zone && zone.price >= layout.lo && zone.price <= layout.hi) claim(zone.price);
    }

    // Reversal zones next: they are the synthesis, the level a reader most
    // needs named. Hidden layers claim nothing, so turning one off frees space.
    const rev = new Set<number>();
    if (layers.reversion) {
      for (const [i, z] of [...reversalZones.entries()].sort((a, b) => b[1].score - a[1].score)) {
        if (claim(z.high)) rev.add(i);
      }
    }
    // Patterns next: the Wyckoff title sits under its box, flag titles at their
    // channel edge. Both used to be drawn outside this system and collided
    // with the reversal labels.
    let wy = false;
    const flag = new Set<string>();
    if (layers.patrones) {
      if (wyckoff) wy = claim(wyckoff.support * 0.998);
      for (const f of flags) {
        if (claim(f.kind === "BULL FLAG" ? f.upper[0] : f.lower[0])) flag.add(`${f.kind}-${f.poleEnd}`);
      }
    }
    const pool = new Set<string>();
    if (layers.liquidez) for (const p of pools) if (claim(p.price)) pool.add(p.id);
    const ob = new Set<number>();
    if (layers.ob) {
      for (const block of [...orderBlocks].sort((a, b) => b.strength - a.strength)) {
        if (claim(block.high)) ob.add(block.index);
      }
    }
    const breaker = new Set<number>();
    if (layers.breaker) {
      for (const block of [...breakerBlocks].sort((a, b) => b.strength - a.strength)) {
        if (claim(block.high)) breaker.add(block.brokenAtIndex);
      }
    }
    const gap = new Set<number>();
    if (layers.fvg) {
      for (const g of [...gaps].sort((a, b) => b.quality - a.quality)) if (claim(g.high)) gap.add(g.index);
    }
    // Fibonacci labels, merged when close, then claimed like everything else —
    // they used to be drawn outside this system and landed on other labels.
    const fib: { y: number; text: string }[] = [];
    if (layers.fib && fibZone) {
      const merged = fibZone.levels
        .map((level) => ({ price: level.price, ratio: level.ratio }))
        .sort((a, b) => b.price - a.price)
        .reduce<{ price: number; text: string }[]>((acc, level) => {
          const last = acc[acc.length - 1];
          if (last && Math.abs(layout.y(level.price) - layout.y(last.price)) < 12) last.text += ` · ${level.ratio}`;
          else acc.push({ price: level.price, text: String(level.ratio) });
          return acc;
        }, []);
      for (const m of merged) if (claim(m.price)) fib.push({ y: layout.y(m.price), text: m.text });
    }
    return { pool, ob, breaker, gap, rev, fib, wy, flag };
  }, [layout, pools, orderBlocks, breakerBlocks, gaps, reversalZones, fibZone, layers, wyckoff, flags]);

  const keyLevels = useMemo(() => {
    if (!layout) return [];
    // Pivots come from the candles actually on screen, so the levels named
    // are ones the reader can see being tested.
    const swing = layout.candles.map((candle) => ({
      openTime: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: 0,
      quoteVolume: 0,
    }));
    const { highs, lows } = findPivots(swing, 3);
    return findKeyLevels(layout.heatmap, highs, lows);
  }, [layout]);

  const priceTicks = useMemo(() => {
    if (!layout) return [];
    const { lo, hi, y } = layout;
    const step = (hi - lo) / 6;
    // A tick that would sit on one of the pool price tags is dropped: the two
    // labels printed on top of each other read as one garbled number.
    const tagYs = layers.calor
      ? [layout.heatmap.topZoneAbove?.price, layout.heatmap.topZoneBelow?.price, ...layout.secondaryPools.map((p) => p.price)]
          .filter((p): p is number => typeof p === "number" && p >= lo && p <= hi)
          .map((p) => y(p))
      : [];
    return Array.from({ length: 7 }, (_, i) => {
      const price = lo + step * i;
      return { price, yPos: y(price) };
    }).filter((tick) => tagYs.every((ty) => Math.abs(ty - tick.yPos) > 13));
  }, [layout, layers.calor]);

  const dateTicks = useMemo(() => {
    if (!layout) return [];
    const { candles, x, candleAreaW } = layout;
    // Space ticks by pixels, not by candle count. Five fixed ticks meant the
    // labels ran into each other on a phone — "16/09, 09:00" is wide, and at
    // 47 candles across ~300px they overlapped into an unreadable smear.
    const labelW = 74;
    const maxTicks = Math.max(2, Math.floor(candleAreaW / labelW));
    const step = Math.max(1, Math.ceil(candles.length / maxTicks));
    return candles
      .map((c, i) => ({ time: c.time, xPos: x(i), index: i }))
      .filter((tick) => tick.index % step === 0)
      // Drop a final tick that would collide with the profile strip.
      .filter((tick) => tick.xPos < candleAreaW - labelW / 2);
  }, [layout]);

  return (
    <section className="panel liq-desk" id="liquidaciones">
      <div className="panel-head">
        <div>
          <p className="eyebrow">MAPA DE LIQUIDACIONES · MODELO ESTIMADO</p>
          <h2>Dónde se acumula el combustible de liquidación</h2>
        </div>
        <span className={error ? "badge critical" : "badge"}>
          {loading ? "CALCULANDO…" : error ? "NO DISPONIBLE" : "MODELO"}
        </span>
      </div>

      {/* One line up top so nobody reads a single bar as fact; the full
          explanation sits under the chart, where it does not push the map
          itself off a phone screen. */}
      <p className="liq-flag">
        <b>MODELO ESTIMADO</b> · ningún exchange publica el apalancamiento real de cada posición
      </p>

      <div className="liq-controls">
        <input
          className="liq-search"
          value={symbolQuery}
          onChange={(e) => setSymbolQuery(e.target.value)}
          placeholder={`Buscar entre ${symbols.length} pares…`}
          aria-label="Buscar par"
        />
        <div className="liq-symbols">
          {(symbolQuery.trim()
            ? symbols.filter((s) => s.includes(symbolQuery.trim().toUpperCase())).slice(0, 40)
            : [...new Set([symbol, ...symbols.slice(0, 15)])]
          ).map((s) => (
            <button
              key={s}
              className={s === symbol ? "active" : ""}
              onClick={() => selectSymbol(s)}
              title={s}
            >
              {s.replace("USDT", "")}
            </button>
          ))}
        </div>
        <div className="liq-timeframes">
          {FRAME_OPTIONS.map((tf) => (
            <button
              key={tf.id}
              className={tf.id === timeframe ? "active" : ""}
              onClick={() => selectTimeframe(tf.id)}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="liq-loading">CONSTRUYENDO EL MAPA…</p>}
      {error && !loading && (
        <div className="liq-empty">
          <b>{error}</b>
          <span>No se completa con estimaciones adicionales cuando la fuente no responde.</span>
        </div>
      )}

      {data && layout && (
        <>
          {/* Called out above the chart, not left to be spotted: being in
              the retracement band is the condition the reader asked to see. */}
          {fibZone?.inZone && (
            <div className={`liq-fibflag ${fibZone.side === "LONG" ? "buy" : "sell"}`}>
              <b>
                {fibZone.side === "LONG" ? "ZONA DE COMPRA" : "ZONA DE VENTA"} · FIBONACCI{" "}
                {fibZone.levels.map((l) => l.ratio).join(" / ")}
              </b>
              <span>{fibZone.note}</span>
              {fibZone.nearest && (
                <small>
                  Nivel más cercano: {fibZone.nearest.ratio} en {priceLabel(fibZone.nearest.price)}{" "}
                  ({fibZone.nearest.distancePct.toFixed(2)}% de distancia)
                </small>
              )}
            </div>
          )}

          <div className="liq-summary">
          <div
            className={`liq-bias b-${
              data.heatmap.bias.includes("ALZA")
                ? "alza"
                : data.heatmap.bias.includes("BAJA")
                  ? "baja"
                  : "neutro"
            }`}
          >
            <div>
              <span>LECTURA DE SESGO</span>
              <h3>{data.heatmap.bias}</h3>
              <p>{data.heatmap.biasNote}</p>
            </div>
            <div className="liq-bias-price">
              <span>PRECIO ACTUAL</span>
              <b>${priceLabel(livePrice ?? data.heatmap.currentPrice)}</b>
            </div>
          </div>

          {/* The two levels a reader actually acts on, named outright instead
              of left to be eyeballed off the chart. */}
          <div className="liq-zones">
            <div className="up">
              <span>ZONA IMÁN ARRIBA · LIQUIDA CORTOS</span>
              {data.heatmap.topZoneAbove ? (
                <>
                  <b>${priceLabel(data.heatmap.topZoneAbove.price)}</b>
                  {data.heatmap.topZoneAbove.notionalUsd !== null && (
                    <em>{usd(data.heatmap.topZoneAbove.notionalUsd)} estimados</em>
                  )}
                </>
              ) : (
                <b className="none">sin zona activa</b>
              )}
            </div>
            <div className="down">
              <span>ZONA IMÁN ABAJO · LIQUIDA LARGOS</span>
              {data.heatmap.topZoneBelow ? (
                <>
                  <b>${priceLabel(data.heatmap.topZoneBelow.price)}</b>
                  {data.heatmap.topZoneBelow.notionalUsd !== null && (
                    <em>{usd(data.heatmap.topZoneBelow.notionalUsd)} estimados</em>
                  )}
                </>
              ) : (
                <b className="none">sin zona activa</b>
              )}
            </div>
          </div>
          </div>

          <div className="liq-zoom">
            <button onClick={zoomOut} disabled={visibleCandles >= MAX_VISIBLE} aria-label="Alejar">
              −
            </button>
            {/* Panning in price can take the reader somewhere with nothing on
                screen; this is the way back without reloading. */}
            <button
              className="liq-reset"
              onClick={resetView}
              disabled={visibleCandles === 70 && priceView.scale === 1 && priceView.center === null}
              aria-label="Volver a la vista automática"
              title="Vista automática"
            >
              ⟳
            </button>
            <span>
              <i
                className={`liq-live ${feed.state === "en vivo" ? "on" : feed.state === "sin conexión" ? "off" : feed.state === "demorado" ? "warn" : ""}`}
                title={feed.lastUpdate ? `Último dato ${new Date(feed.lastUpdate).toLocaleTimeString()}` : undefined}
              >
                {feed.state.toUpperCase()}
                {feed.source ? ` · ${feed.source === "WS" ? "WS" : feed.source === "REST SPOT" ? "SPOT" : "REST"}` : ""}
                {feed.lastUpdate
                  ? ` · ${new Date(feed.lastUpdate).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}`
                  : ""}
              </i>{" "}
              {visibleCandles} velas
              {updatedAt !== null && (
                <i className="liq-updated">
                  {/* No forced 24h and no seconds: the phone's own clock
                      format is the one the reader recognises, and the second
                      hand only made the label longer. */}
                  · {new Date(updatedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </i>
              )}
              <i className="liq-pinch">· pellizcá ↕ precio ↔ tiempo</i>
            </span>
            <button onClick={zoomIn} disabled={visibleCandles <= MIN_VISIBLE} aria-label="Acercar">
              +
            </button>
          </div>

          {/* Layers, as in any charting tool: the map had grown to seven
              overlays at once, and a chart showing everything shows nothing. */}
          <div className="liq-layers" role="group" aria-label="Capas del mapa">
            <button className={`liq-simple ${simple ? "on" : ""}`} onClick={toggleSimple} aria-pressed={simple} title="Muestra solo lo esencial y explica qué mirar. Al apagarlo vuelven tus capas.">
              {simple ? "✓ MODO SIMPLE" : "MODO SIMPLE"}
            </button>
            {LAYER_LABELS.map(([key, label]) => (
              <button key={key} className={layers[key] ? "on" : ""} onClick={() => toggleLayer(key)} aria-pressed={layers[key]}>
                {label}
              </button>
            ))}
          </div>

          {layers.burbujas && (
            <div className="liq-pools tb-bar" role="group" aria-label="Tamaño mínimo de las burbujas">
              <span className="lp-title">BURBUJAS</span>
              {footprintMode ? (
                <>
                  {([null, 10_000, 50_000, 250_000, 1_000_000] as const).map((v) => (
                    <button key={String(v)} className={bubbleMin === v ? "on" : ""} aria-pressed={bubbleMin === v} onClick={() => setBubbleMin(v)}>
                      {v === null ? "AUTO" : `≥${dollarsShort(v)}`}
                    </button>
                  ))}
                  <span className="lp-note">
                    {!bubbles || bubbles.threshold === null
                      ? "Pocas órdenes en pantalla para elegir las grandes en automático."
                      : `Órdenes a mercado desde ${dollarsShort(bubbles.threshold)} · ` +
                        `${plural(bubbles.bubbles.filter((b) => b.side === "COMPRA").length, "compra")} · ` +
                        `${plural(bubbles.bubbles.filter((b) => b.side === "VENTA").length, "venta")}. Es actividad, no dirección.`}
                  </span>
                </>
              ) : (
                <span className="lp-note">Se ven con FOOTPRINT activado en 1m, 3m, 5m o 15m (usan las operaciones una por una).</span>
              )}
            </div>
          )}

          {layers.calor && layout && (
            <div className="liq-pools">
              <span className="lp-title">POOLS</span>
              {ALL_TIERS.map((tier) => {
                const on = tiers.includes(tier);
                return (
                  <button
                    key={tier}
                    className={on ? "on" : ""}
                    aria-pressed={on}
                    onClick={() =>
                      setTiers((current) =>
                        current.includes(tier)
                          ? current.length > 1
                            ? current.filter((t) => t !== tier)
                            : current
                          : [...current, tier].sort((a, b) => a - b),
                      )
                    }
                  >
                    {tier}X
                  </button>
                );
              })}
              <button className="lp-preset" onClick={() => setTiers(ALL_TIERS)}>
                TODOS
              </button>
              <button className="lp-preset" onClick={() => setTiers([50, 75, 100])} title="Las posiciones más frágiles: una vela chica las liquida">
                ALTO APALANCAMIENTO
              </button>
              <span className="lp-total" title="Reparto proporcional del open interest actual: una estimación, no posiciones medidas una por una">
                Total en vista: <b>{layout.heatmap.totalOpenInterestUsd !== null && layout.poolTotalUsd > 0 ? usd(layout.poolTotalUsd) : "—"}</b>
              </span>
            </div>
          )}

          {/* Always says what the pattern detectors found in this window —
              including "nothing" — so an empty chart is never ambiguous. */}
          {layers.patrones && (
            <div className="liq-pstrip">
              <span className={wyckoff ? (wyckoff.kind === "ACUMULACIÓN" ? "up" : "down") : "none"}>
                WYCKOFF · {wyckoff ? `${wyckoff.kind} ${wyckoff.phase.split(" · ")[0].toUpperCase()}` : "sin rango válido"}
              </span>
              {(["BULL FLAG", "BEAR FLAG"] as const).map((kind) => {
                const f = flags.find((x) => x.kind === kind);
                return (
                  <span key={kind} className={f ? (kind === "BULL FLAG" ? "up" : "down") : "none"}>
                    {kind} · {f ? f.status : "no hay"}
                  </span>
                );
              })}
              {layers.tomas && (
                <span className={sweeps.some((sw) => sw.index - patternOffset >= 0) ? "rev" : "none"}>
                  TOMAS · {sweeps.filter((sw) => sw.index - patternOffset >= 0).length} en vista
                </span>
              )}
              {layers.scalp && (
                <span className={liveScalp ? (liveScalp.side === "COMPRA" ? "up" : "down") : "none"}>
                  SCALP · {liveScalp ? `${liveScalp.side} hace ${patternSeries.length - 1 - liveScalp.index} velas` : "sin señal activa"}
                  {scalpSt.winRate !== null && ` · WR ${Math.round(scalpSt.winRate * 100)}% · PF ${scalpSt.profitFactor === Infinity ? "∞" : (scalpSt.profitFactor ?? 0).toLocaleString("es-AR", { maximumFractionDigits: 2 })}`}
                </span>
              )}
              <span className={reversalZones.length ? "rev" : "none"}>
                REVERSIÓN · {reversalZones.filter((z) => z.side === "SOPORTE").length}↑ {reversalZones.filter((z) => z.side === "RESISTENCIA").length}↓
              </span>
            </div>
          )}

          {simple && layout && (
            <div className="lv-guide">
              <h4>GUÍA RÁPIDA · {timeframe.toUpperCase()}</h4>
              <div className="lv-guide-grid">
                <div>
                  <b>1 · Dónde está el precio</b>
                  {(() => {
                    const r = levels.find((l) => l.kind === "RESISTENCIA");
                    const sp = levels.find((l) => l.kind === "SOPORTE");
                    return (
                      <p>
                        {r ? <>El <b className="down">techo</b> más cercano está en {priceLabel(r.price)} (+{r.distancePct.toFixed(1).replace(".", ",")}%, el precio giró {r.touches} veces ahí). </> : "No hay un techo claro cerca. "}
                        {sp ? <>El <b className="up">piso</b> más cercano está en {priceLabel(sp.price)} ({sp.distancePct.toFixed(1).replace(".", ",")}%, {sp.touches} giros). </> : "No hay un piso claro cerca. "}
                        Cerca de un techo conviene no comprar apurado; cerca de un piso, no vender apurado.
                      </p>
                    );
                  })()}
                </div>
                <div>
                  <b>2 · Hacia dónde tira la liquidez</b>
                  <p>
                    Las barras de la derecha muestran dónde quedarían liquidados los que operan apalancados. El precio suele ir a buscar las zonas más cargadas:
                    {layout.heatmap.topZoneAbove ? <> arriba en {priceLabel(layout.heatmap.topZoneAbove.price)}</> : null}
                    {layout.heatmap.topZoneAbove && layout.heatmap.topZoneBelow ? " y" : ""}
                    {layout.heatmap.topZoneBelow ? <> abajo en {priceLabel(layout.heatmap.topZoneBelow.price)}</> : null}. Es una estimación, no un destino seguro.
                  </p>
                </div>
                <div>
                  <b>3 · La señal LIQ+VOL</b>
                  {liveLv ? (
                    <p>
                      <b className={liveLv.signal.side === "LONG" ? "up" : "down"}>{liveLv.signal.side === "LONG" ? "COMPRA" : "VENTA"}</b> en {priceLabel(liveLv.signal.entry)} · stop {priceLabel(liveLv.signal.stop)} · objetivo {priceLabel(liveLv.signal.target)}. Si toca el stop perdés 1 parte; si llega al objetivo ganás 2.
                    </p>
                  ) : (
                    <p>Ahora no hay señal abierta. Aparece cuando el precio barre un piso o un techo anterior, vuelve adentro y lo hace con volumen fuerte.</p>
                  )}
                  {lv && (
                    <p className={lv.stats.confidence !== "MUESTRA RAZONABLE" ? "warn" : (lv.stats.profitFactor ?? 0) < 1 ? "down" : "up"}>
                      {lv.stats.confidence !== "MUESTRA RAZONABLE"
                        ? `En esta moneda y temporalidad hay solo ${ops(lv.stats.resolved)} medida${lv.stats.resolved === 1 ? "" : "s"}: es poco para confiar. Tomalo como práctica.`
                        : (lv.stats.profitFactor ?? 0) < 1
                          ? `Acá viene perdiendo (profit factor ${(lv.stats.profitFactor ?? 0).toFixed(2).replace(".", ",")} en ${ops(lv.stats.resolved)}). Mejor no seguirla en esta moneda y temporalidad.`
                          : `Acá viene ganando (profit factor ${lv.stats.profitFactor === Infinity ? "∞" : (lv.stats.profitFactor ?? 0).toFixed(2).replace(".", ",")} en ${ops(lv.stats.resolved)}). Igual nada garantiza la próxima.`}
                    </p>
                  )}
                </div>
                <div>
                  <b>4 · Reglas para no quemar la cuenta</b>
                  <p>Arriesgá como máximo 1% de tu cuenta por operación, poné siempre el stop y calculá el tamaño en DIARIO → CALCULADORA. No es asesoramiento financiero.</p>
                </div>
              </div>
            </div>
          )}

          {layers.sr && levels.length > 0 && (
            <div className="liq-pstrip" title="Niveles donde el precio giró varias veces (máximos y mínimos a menos de media ATR cuentan como el mismo nivel). Un nivel para mirar, no una promesa de giro.">
              {levels.map((l, i) => (
                <span key={`sr-${i}`} className={l.kind === "RESISTENCIA" ? "down" : "up"}>
                  {l.kind === "RESISTENCIA" ? "R" : "S"}
                  {levels.filter((x) => x.kind === l.kind).indexOf(l) + 1} · {priceLabel(l.price)} · {l.touches} toques · {l.strength.toLowerCase()}
                  {l.flipped ? " · cambió de rol" : ""}
                </span>
              ))}
            </div>
          )}

          {layers.liqvol && lv && (
            <div className="liq-pstrip" title="Barrida de un máximo o mínimo previo que cierra de vuelta adentro, con volumen ≥1,5× y liquidaciones barridas sobre el promedio. Medida en esta misma serie, peor caso primero y con comisiones.">
              <span className={liveLv ? (liveLv.signal.side === "LONG" ? "up" : "down") : "none"}>
                LIQ+VOL · {liveLv ? `${liveLv.signal.side === "LONG" ? "COMPRA" : "VENTA"} hace ${scalpSeries.length - 1 - liveLv.signal.index} velas` : "sin señal abierta"}
              </span>
              <span className={lv.stats.profitFactor === null ? "none" : lv.stats.profitFactor >= 1 ? "up" : "down"}>
                {lv.stats.winRate === null
                  ? "sin operaciones resueltas"
                  : `WR ${Math.round(lv.stats.winRate * 100)}% · PF ${lv.stats.profitFactor === Infinity ? "∞" : (lv.stats.profitFactor ?? 0).toFixed(2)} · ${ops(lv.stats.resolved)} · ${lv.stats.confidence.toLowerCase()}`}
              </span>
            </div>
          )}

          {layers.idm && lastIdm && (
            <div className="liq-pstrip" title="Inducción (IDM): el primer retroceso real después de una ruptura de estructura. Ahí entran temprano y dejan sus stops; el mercado suele barrerlo antes de seguir.">
              <span className={lastIdm.side === "ALCISTA" ? "up" : "down"}>
                INDUCCIÓN {lastIdm.side.toLowerCase()} · {priceLabel(lastIdm.level)}{" "}
                {lastIdm.sweptIndex === null
                  ? `pendiente (${(((lastIdm.level - scalpSeries[scalpSeries.length - 1].close) / scalpSeries[scalpSeries.length - 1].close) * 100).toFixed(1).replace(".", ",")}%)`
                  : `barrida hace ${scalpSeries.length - 1 - lastIdm.sweptIndex} velas`}
              </span>
              <span className={idmSt.rate === null ? "none" : idmSt.rate >= 0.5 ? "up" : "down"}>
                {idmSt.rate === null
                  ? "sin barridas resueltas"
                  : `tras la barrida siguió ${idmSt.continued} de ${idmSt.resolved} · ${idmSt.confidence.toLowerCase()}`}
              </span>
            </div>
          )}

          {layers.tendencia && trend && (
            <div className="liq-pstrip" title="Una ruptura es un cierre fuera de la línea (la mecha sola no cuenta). «Con volumen» = al menos 1,3 veces el promedio de las 20 velas anteriores.">
              <span className={trend.lines.length ? "rev" : "none"}>
                TENDENCIA · {plural(trend.lines.filter((l) => l.side === "RESISTENCIA").length, "resistencia")} ↘ · {plural(trend.lines.filter((l) => l.side === "SOPORTE").length, "soporte")} ↗
              </span>
              {(() => {
                const lb = latestBreak(trend);
                const ago = lb ? scalpSeries.length - 1 - lb.i : 0;
                if (!lb || ago > 40) return <span className="none">sin rupturas recientes</span>;
                return (
                  <span className={lb.direction === "ALCISTA" ? "up" : "down"}>
                    RUPTURA {lb.direction} ({lb.kind === "LÍNEA" ? "línea" : "rango"}) · {ago === 0 ? "en la última vela cerrada" : `hace ${plural(ago, "vela")}`}
                    {lb.volumeMultiple !== null && ` · ${lb.volumeMultiple.toFixed(1).replace(".", ",")}× vol${lb.confirmed ? " ✓" : ""}`}
                  </span>
                );
              })()}
            </div>
          )}

          {layers.footprint && verdict && (
            <div className={`fp-strip ${verdict.winner === "COMPRADORES" ? "up" : verdict.winner === "VENDEDORES" ? "down" : "flat"}`}>
              <span>QUIÉN VA GANANDO</span>
              <b>{verdict.winner === "EQUILIBRADO" ? "EQUILIBRADO" : `GANAN ${verdict.winner}`}</b>
              {verdict.strength && <em>{verdict.strength}</em>}
              <i style={{ background: `linear-gradient(90deg, var(--green) ${verdict.buyPct}%, var(--red) ${verdict.buyPct}%)` }} />
              <span>compra {verdict.buyPct.toFixed(0)}% · venta {(100 - verdict.buyPct).toFixed(0)}%</span>
              <span>Δ {compactQty(verdict.delta, true)} {symbol.replace(/USDT$/, "")}</span>
              {verdict.notes.length > 0 && (
                <u title={verdict.notes.join(" ")}>⚠ {verdict.notes.some((n) => n.includes("absorbiendo")) ? "absorción" : "cambio reciente"}</u>
              )}
            </div>
          )}

          <div
            className="liq-chart-wrap"
            ref={chartRef}
            // A phone tap also emits a synthetic mouse move before the click;
            // following only real mice keeps the tap from being undone.
            onPointerMove={(e) => {
              if (!layout || e.pointerType !== "mouse") return;
              const r = e.currentTarget.getBoundingClientRect();
              const px = ((e.clientX - r.left) / r.width) * box.width;
              const py = ((e.clientY - r.top) / r.height) * box.height;
              const i = Math.round((px - layout.x(0)) / Math.max(1e-9, layout.x(1) - layout.x(0)));
              if (i < 0 || i >= layout.candles.length) return setCross(null);
              setCross({ i, y: py });
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") setCross(null);
            }}
            // The crosshair walks the candles like a slider: arrows move it,
            // Escape clears it, and the current candle is announced.
            role="slider"
            tabIndex={0}
            aria-label="Vela seleccionada en el gráfico"
            aria-valuemin={0}
            aria-valuemax={Math.max(0, (layout?.candles.length ?? 1) - 1)}
            aria-valuenow={cross?.i ?? Math.max(0, (layout?.candles.length ?? 1) - 1)}
            aria-valuetext={
              cross && layout?.candles[cross.i]
                ? `Cierre ${priceLabel(layout.candles[cross.i].close)}`
                : "Tocá una vela para leerla"
            }
            onKeyDown={(e) => {
              if (!layout) return;
              if (e.key === "Escape") return setCross(null);
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              e.preventDefault();
              const n = layout.candles.length;
              setCross((c) => {
                const i = Math.min(n - 1, Math.max(0, (c?.i ?? n - 1) + (e.key === "ArrowLeft" ? -1 : 1)));
                return { i, y: layout.y(layout.candles[i].close) };
              });
            }}
            onClick={(e) => {
              if (!layout) return;
              const r = e.currentTarget.getBoundingClientRect();
              const px = ((e.clientX - r.left) / r.width) * box.width;
              const py = ((e.clientY - r.top) / r.height) * box.height;
              const i = Math.round((px - layout.x(0)) / Math.max(1e-9, layout.x(1) - layout.x(0)));
              if (i < 0 || i >= layout.candles.length) return setCross(null);
              setCross({ i, y: py });
            }}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchEnd}
          >
            <svg
              viewBox={`0 0 ${box.width} ${box.height}`}
              className="liq-svg"
              role="img"
              aria-label="Mapa de liquidaciones estimado"
            >
              {/* Everything priced is clipped to the price area. The scale is
                  capped around the current price, so old candles, flags or
                  pivots beyond it used to spill down over the volume, RSI and
                  MACD panes. */}
              <defs>
                <clipPath id="liq-price-clip">
                  <rect x={0} y={MARGIN.top - 2} width={box.width} height={layout.plotH + 4} />
                </clipPath>
              </defs>
              {priceTicks.map((tick) => (
                <line
                  key={tick.price}
                  x1={MARGIN.left}
                  x2={box.width - MARGIN.right}
                  y1={tick.yPos}
                  y2={tick.yPos}
                  className="liq-grid"
                />
              ))}

              <g clipPath="url(#liq-price-clip)">
              {/* Each zone is drawn twice: a horizontal span running from
                  where it formed to the right edge — the level existed from
                  that moment on — and a profile bar in the right strip
                  carrying its weight, so a zone formed recently is still
                  comparable to an old one.

                  Spans are deliberately faint and thin: they are context for
                  the candles, not the subject. The profile bar on the right
                  is where intensity is meant to be read. */}
              {/* The columns: each estimated level from the candle that created
                  it to the candle that swept it. */}
              {columnImage && (
                <image
                  href={columnImage}
                  x={MARGIN.left}
                  y={MARGIN.top}
                  width={layout.candleAreaW}
                  height={layout.plotH}
                  preserveAspectRatio="none"
                  className="liq-columns"
                  clipPath="url(#liq-price-clip)"
                />
              )}

              {/* The pools: a solid stepped profile flush against the price axis. */}
              {layers.calor &&
                layout.profileSteps.map((st) => {
                  const w = Math.max(3, st.frac * layout.profileW);
                  const bucket: HeatBucket = {
                    price: st.price,
                    longDensity: st.long,
                    shortDensity: st.short,
                    intensity: st.frac * 100,
                    notionalUsd: st.usd > 0 ? st.usd : null,
                    formedAt: st.formedAt,
                  };
                  return (
                    <rect
                      key={`pf-${st.key}`}
                      x={box.width - MARGIN.right - w}
                      y={st.yTop}
                      width={w}
                      height={st.h + 0.6}
                      className={`liq-pool ${st.side}`}
                      style={{ opacity: 0.42 + st.frac * 0.58 }}
                      onMouseEnter={() => setHovered(bucket)}
                      onMouseLeave={() => setHovered((current) => (current?.price === st.price ? null : current))}
                    />
                  );
                })}

              {layers.calor && !columnImage && layout.zones.map((zone) => {
                const yPos = layout.y(zone.price);
                const startX = layout.zoneStartX(zone.formedAt);
                const endX = MARGIN.left + layout.candleAreaW;
                const relative = zone.intensity / 100;
                const thickness = Math.max(1.2, relative * layout.rowHeight);
                const asBucket = {
                  price: zone.price,
                  longDensity: zone.longDensity,
                  shortDensity: zone.shortDensity,
                  intensity: zone.intensity,
                  notionalUsd: zone.notionalUsd > 0 ? zone.notionalUsd : null,
                  formedAt: zone.formedAt,
                };
                return (
                  <g
                    key={zone.price}
                    onMouseEnter={() => setHovered(asBucket)}
                    onMouseLeave={() =>
                      setHovered((current) => (current?.price === zone.price ? null : current))
                    }
                  >
                    {/* Only strong zones get the long horizontal band. Drawing
                        one for every row stacked dozens of translucent bars on
                        top of each other until the area filled in as a murky
                        slab — which is exactly what looked "dark" and hid the
                        structure. Weaker rows still appear, in the profile bar
                        on the right, where comparing them is the point. */}
                    {endX > startX && zone.banded && (
                      <rect
                        x={startX}
                        y={yPos - thickness / 2}
                        width={endX - startX}
                        height={thickness}
                        fill={
                          zone.price > layout.heatmap.currentPrice
                            ? `rgba(31,229,138,${0.08 + relative * 0.2})`
                            : `rgba(255,47,67,${0.08 + relative * 0.2})`
                        }
                      />
                    )}
                  </g>
                );
              })}

              {/* Reversal zones: bands where several detectors agree. */}
              {layers.reversion &&
                reversalZones.map((z, i) => {
                  const top = layout.y(z.high);
                  const h = Math.max(3, layout.y(z.low) - top);
                  const cls = z.side === "SOPORTE" ? "up" : "down";
                  return (
                    <g key={`rev-${i}`}>
                      <rect x={MARGIN.left} y={top} width={layout.candleAreaW} height={h} className={`liq-rev ${cls}`} />
                      {labelSlots.rev.has(i) && (
                        <text x={MARGIN.left + 5} y={top - 3} className={`liq-rev-label ${cls}`}>
                          {"★".repeat(z.stars)} {z.side === "SOPORTE" ? "REVERSIÓN ↑" : "REVERSIÓN ↓"}
                        </text>
                      )}
                    </g>
                  );
                })}

              {/* Wyckoff range and its events, then flags. */}
              {layers.patrones && wyckoff && (() => {
                const x0 = Math.max(0, wyckoff.start - patternOffset);
                const x1 = wyckoff.end - patternOffset;
                if (x1 < 0) return null;
                const top = layout.y(wyckoff.resistance);
                const bottom = layout.y(wyckoff.support);
                const cls = wyckoff.kind === "ACUMULACIÓN" ? "up" : "down";
                return (
                  <g>
                    <rect
                      x={layout.x(x0) - layout.bodyW}
                      y={top}
                      width={Math.max(4, layout.x(x1) - layout.x(x0) + layout.bodyW * 2)}
                      height={Math.max(2, bottom - top)}
                      className={`liq-wy-box ${cls}`}
                    />
                    {labelSlots.wy && (
                      <text x={layout.x(x0) - layout.bodyW + 3} y={bottom + 11} className={`liq-wy-label ${cls}`}>
                        WYCKOFF · {wyckoff.kind} · {wyckoff.phase.split(" · ")[0]}
                      </text>
                    )}
                    {wyckoff.events.map((e) => {
                      const i = e.index - patternOffset;
                      if (i < 0) return null;
                      const below = e.type === "SC" || e.type === "SPRING" || (e.type === "AR" && wyckoff.kind === "DISTRIBUCIÓN") || e.type === "SOW";
                      const ey = layout.y(e.price) + (below ? 12 : -6);
                      const nearMagnet = [data.heatmap.topZoneAbove?.price, data.heatmap.topZoneBelow?.price].some(
                        (p) => typeof p === "number" && Math.abs(layout.y(p) - 6 - ey) < 14,
                      );
                      return (
                        <g key={`${e.type}-${e.index}`}>
                          <circle cx={layout.x(i)} cy={layout.y(e.price)} r={2.4} className={`liq-wy-dot ${cls}`} />
                          {!nearMagnet && (
                            <text x={layout.x(i)} y={ey} className="liq-wy-event">
                              {e.type}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </g>
                );
              })()}

              {/* Trendlines and breakouts. Series indices are shifted into the visible
                  window the same way the flags are; lines extend to the right edge. */}
              {layers.tendencia && trend && (() => {
                const slot = layout.candles.length > 1 ? layout.x(1) - layout.x(0) : 12;
                const xi = (i: number) => layout.x(0) + slot * (i - patternOffset);
                const endX = MARGIN.left + layout.candleAreaW;
                const iEnd = patternOffset + (endX - layout.x(0)) / slot;
                const visibleBreaks = trend.breaks.filter((b) => b.i >= patternOffset).slice(-10);
                const visibleRanges = trend.ranges.filter((r) => r.i >= patternOffset).slice(-8);
                const mult = (v: number | null) => (v === null ? "" : ` ${v.toFixed(1).replace(".", ",")}×`);
                const mark = (key: string, i: number, dir: "ALCISTA" | "BAJISTA", label: string, confirmed: boolean, outcome: string) => {
                  const candle = layout.series[i];
                  if (!candle) return null;
                  const up = dir === "ALCISTA";
                  const cx = xi(i);
                  const cy = up ? layout.y(candle.low) + 11 : layout.y(candle.high) - 11;
                  const tri = up ? `${cx},${cy - 5} ${cx - 5},${cy + 4} ${cx + 5},${cy + 4}` : `${cx},${cy + 5} ${cx - 5},${cy - 4} ${cx + 5},${cy - 4}`;
                  return (
                    <g key={key}>
                      <polygon points={tri} className={`tl-mark ${up ? "up" : "down"} ${confirmed ? "solid" : "hollow"} ${outcome === "FALLIDA" ? "failed" : ""}`}>
                        <title>{`${label} · ${dir}${confirmed ? " con volumen" : " sin volumen"} · ${outcome === "RECIÉN" ? "todavía muy reciente para saber si se sostiene" : outcome === "FALLIDA" ? "volvió adentro: ruptura fallida" : "se sostuvo 3 velas"}`}</title>
                      </polygon>
                      <text x={cx} y={up ? cy + 17 : cy - 10} className={`tl-lbl ${up ? "up" : "down"}`}>{label}</text>
                    </g>
                  );
                };
                return (
                  <g className="tl-layer" clipPath="url(#liq-price-clip)">
                    {visibleBreaks.map((b) => {
                      const from = Math.max(b.line.a, patternOffset);
                      return (
                        <line key={`bl-${b.i}`} x1={xi(from)} y1={layout.y(lineAt(b.line, from))} x2={xi(b.i)} y2={layout.y(b.linePrice)} className="tl-broken" />
                      );
                    })}
                    {visibleRanges.map((r) => (
                      <line key={`rl-${r.i}`} x1={xi(Math.max(r.i - 20, patternOffset))} x2={xi(r.i)} y1={layout.y(r.level)} y2={layout.y(r.level)} className="tl-broken" />
                    ))}
                    {trend.lines.map((l) => {
                      const from = Math.max(l.a, patternOffset);
                      const res = l.side === "RESISTENCIA";
                      const yEnd = layout.y(lineAt(l, iEnd));
                      return (
                        <g key={`${l.side}-${l.a}-${l.b}`}>
                          <line x1={xi(from)} y1={layout.y(lineAt(l, from))} x2={endX} y2={yEnd} className={`tl-line ${res ? "res" : "sup"}`}>
                            <title>{`${l.side} · ${l.touches} toques · de ${l.priceA.toLocaleString("es-AR", { maximumFractionDigits: 6 })} a ${l.priceB.toLocaleString("es-AR", { maximumFractionDigits: 6 })}`}</title>
                          </line>
                          {[l.a, l.b].filter((i) => i >= patternOffset).map((i) => (
                            <circle key={i} cx={xi(i)} cy={layout.y(i === l.a ? l.priceA : l.priceB)} r={2.6} className={`tl-dot ${res ? "res" : "sup"}`} />
                          ))}
                          <text x={endX - 4} y={Math.min(layout.y(layout.lo) - 4, Math.max(MARGIN.top + 10, yEnd + (res ? -5 : 11)))} className={`tl-tag ${res ? "res" : "sup"}`}>
                            {res ? "↘ RES" : "↗ SOP"} ×{l.touches}
                          </text>
                        </g>
                      );
                    })}
                    {visibleBreaks.map((b) => mark(`b-${b.i}`, b.i, b.direction, `RUP${mult(b.volumeMultiple)}`, b.confirmed, b.outcome))}
                    {visibleRanges.map((r) => mark(`r-${r.i}`, r.i, r.direction, `BO${mult(r.volumeMultiple)}`, r.confirmed, r.outcome))}
                  </g>
                );
              })()}

              {layers.patrones &&
                flags.map((f) => {
                  const bull = f.kind === "BULL FLAG";
                  const ps = f.poleStart - patternOffset;
                  const pe = f.poleEnd - patternOffset;
                  const fs = f.flagStart - patternOffset;
                  const fe = f.flagEnd - patternOffset;
                  if (fe < 0) return null;
                  const cls = bull ? "up" : "down";
                  const poleFrom = bull ? layout.series[f.poleStart].low : layout.series[f.poleStart].high;
                  const poleTo = bull ? layout.series[f.poleEnd].high : layout.series[f.poleEnd].low;
                  const endX = MARGIN.left + layout.candleAreaW;
                  return (
                    <g key={`${f.kind}-${f.poleEnd}`}>
                      {ps >= 0 && (
                        <line x1={layout.x(ps)} y1={layout.y(poleFrom)} x2={layout.x(pe)} y2={layout.y(poleTo)} className={`liq-flag-pole ${cls}`} />
                      )}
                      <line x1={layout.x(Math.max(0, fs))} y1={layout.y(f.upper[0])} x2={layout.x(fe)} y2={layout.y(f.upper[1])} className={`liq-flag-chan ${cls}`} />
                      <line x1={layout.x(Math.max(0, fs))} y1={layout.y(f.lower[0])} x2={layout.x(fe)} y2={layout.y(f.lower[1])} className={`liq-flag-chan ${cls}`} />
                      {f.status !== "FALLIDA" && f.target >= layout.lo && f.target <= layout.hi && (
                        <>
                          <line x1={layout.x(fe)} x2={endX} y1={layout.y(f.target)} y2={layout.y(f.target)} className={`liq-flag-target ${cls}`} />
                          <text x={endX - 4} y={layout.y(f.target) - 3} className={`liq-flag-label ${cls} end`}>
                            OBJ {bull ? "↑" : "↓"}
                          </text>
                        </>
                      )}
                      {labelSlots.flag.has(`${f.kind}-${f.poleEnd}`) && (
                        <text
                          x={layout.x(Math.max(0, fs))}
                          y={layout.y(bull ? f.upper[0] : f.lower[0]) + (bull ? -6 : 13)}
                          className={`liq-flag-label ${cls}`}
                        >
                          {f.kind} · {f.status}
                        </text>
                      )}
                    </g>
                  );
                })}

              {/* Liquidity pools: dashed lines, since they mark a single price
                  where resting orders cluster — not a zone with width like
                  the other layers. Drawn furthest back of the level layers
                  because they are the widest-horizon read on the chart. */}
              {layers.liquidez && pools.map((pool) => {
                const y = layout.y(pool.price);
                const bullish = pool.side === "COMPRA";
                return (
                  <g key={pool.id}>
                    <line
                      x1={MARGIN.left}
                      x2={MARGIN.left + layout.candleAreaW}
                      y1={y}
                      y2={y}
                      className={`liq-pool-line ${bullish ? "up" : "down"}${pool.frames.length > 1 ? " multi" : ""}${pool.taken ? " taken" : ""}`}
                    />
                    {labelSlots.pool.has(pool.id) && (
                      <text
                        x={MARGIN.left + layout.candleAreaW - 4}
                        y={y - 3}
                        className={bullish ? "liq-pool-label up" : "liq-pool-label down"}
                      >
                        {pool.taken ? "TOMADA" : bullish ? "LIQ ↑" : "LIQ ↓"} {pool.frames.join("·")}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* The Fibonacci band sits furthest back: it is the widest
                  piece of context, and everything else is read inside it. */}
              {layers.fib && fibZone && fibZone.zoneHigh >= layout.lo && fibZone.zoneLow <= layout.hi && (
                <g>
                  <rect
                    x={MARGIN.left}
                    y={layout.y(fibZone.zoneHigh)}
                    width={layout.candleAreaW}
                    height={Math.max(2, layout.y(fibZone.zoneLow) - layout.y(fibZone.zoneHigh))}
                    className={fibZone.inZone ? "liq-fib active" : "liq-fib"}
                  />
                  {fibZone.levels.map((level) => (
                    <line
                      key={level.ratio}
                      x1={MARGIN.left}
                      x2={MARGIN.left + layout.candleAreaW}
                      y1={layout.y(level.price)}
                      y2={layout.y(level.price)}
                      className="liq-fib-line"
                    />
                  ))}
                  {/* Levels a few pixels apart get one shared label: three
                      numbers stacked on the same line cannot be read. */}
                  {labelSlots.fib.map((label) => (
                      <text
                        key={label.text}
                        x={MARGIN.left + layout.candleAreaW - 4}
                        y={label.y - 3}
                        className="liq-fib-label"
                      >
                        {label.text}
                      </text>
                    ))}
                </g>
              )}

              {/* Gaps: bands price crossed without trading both sides. */}
              {layers.fvg && gaps.map((gap) => (
                <g key={`fvg-${gap.index}`}>
                  <rect
                    x={MARGIN.left}
                    y={layout.y(gap.high)}
                    width={layout.candleAreaW}
                    height={Math.max(1.5, layout.y(gap.low) - layout.y(gap.high))}
                    className={gap.side === "ALCISTA" ? "liq-fvg up" : "liq-fvg down"}
                    opacity={0.04 + (gap.quality / 100) * 0.07}
                  />
                  {labelSlots.gap.has(gap.index) && (
                    <text
                      x={MARGIN.left + 4}
                      y={layout.y(gap.high) - 2}
                      className={gap.side === "ALCISTA" ? "liq-fvg-label up" : "liq-fvg-label down"}
                    >
                      {gap.kind}
                      {confidencePct(gap.kind === "IFVG" ? (gapConfidence?.ifvg ?? null) : (gapConfidence?.fvg ?? null))}
                    </text>
                  )}
                </g>
              ))}

              {/* Order blocks sit behind the candles: they are context the
                  price action is read against, not marks on top of it. Drawn
                  from where the block formed to the right edge, because the
                  level exists from that candle onward. */}
              {layers.ob && orderBlocks.map((block) => {
                const top = layout.y(block.high);
                const bottom = layout.y(block.low);
                const height = Math.max(2, bottom - top);
                const startX = layout.zoneStartX(
                  Math.round((block.index / Math.max(1, layout.candles.length - 1)) *
                    Math.max(1, layout.heatmap.profileCandles - 1)),
                );
                const bullish = block.side === "ALCISTA";
                return (
                  <g key={`ob-${block.index}`}>
                    <rect
                      x={startX}
                      y={top}
                      width={Math.max(4, MARGIN.left + layout.candleAreaW - startX)}
                      height={height}
                      className={bullish ? "liq-ob up" : "liq-ob down"}
                      opacity={0.05 + (block.strength / 100) * 0.08}
                    />
                    <line
                      x1={startX}
                      x2={MARGIN.left + layout.candleAreaW}
                      y1={top + height / 2}
                      y2={top + height / 2}
                      className={bullish ? "liq-ob-mid up" : "liq-ob-mid down"}
                    />
                    {labelSlots.ob.has(block.index) && (
                      <text
                        x={startX + 5}
                        y={top - 3}
                        className={bullish ? "liq-ob-label up" : "liq-ob-label down"}
                      >
                        OB {bullish ? "↑" : "↓"}
                        {confidencePct(obConfidence)}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Breaker blocks: an order block price closed through, so the
                  zone flips role — drawn dashed to read as "this used to be
                  the other side" rather than as a fresh order block. */}
              {layers.breaker && breakerBlocks.map((block) => {
                const top = layout.y(block.high);
                const bottom = layout.y(block.low);
                const height = Math.max(2, bottom - top);
                const startX = layout.zoneStartX(
                  Math.round((block.brokenAtIndex / Math.max(1, layout.candles.length - 1)) *
                    Math.max(1, layout.heatmap.profileCandles - 1)),
                );
                const bullish = block.side === "ALCISTA";
                return (
                  <g key={`breaker-${block.index}`}>
                    <rect
                      x={startX}
                      y={top}
                      width={Math.max(4, MARGIN.left + layout.candleAreaW - startX)}
                      height={height}
                      className={bullish ? "liq-breaker up" : "liq-breaker down"}
                      opacity={0.05 + (block.strength / 100) * 0.08}
                    />
                    <line
                      x1={startX}
                      x2={MARGIN.left + layout.candleAreaW}
                      y1={top + height / 2}
                      y2={top + height / 2}
                      className={bullish ? "liq-breaker-mid up" : "liq-breaker-mid down"}
                    />
                    {labelSlots.breaker.has(block.brokenAtIndex) && (
                      <text
                        x={startX + 5}
                        y={top - 3}
                        className={bullish ? "liq-breaker-label up" : "liq-breaker-label down"}
                      >
                        BREAKER {bullish ? "↑" : "↓"}
                        {confidencePct(breakerConfidence)}
                      </text>
                    )}
                  </g>
                );
              })}

              {layout.candles.map((candle, i) => {
                const xPos = layout.x(i);
                const up = candle.close >= candle.open;
                const openY = layout.y(candle.open);
                const closeY = layout.y(candle.close);
                const fp = footprints?.map.get(candle.time);
                if (fp && footprints) {
                  // Footprint column: one cell per price row, green where
                  // aggressive buying dominated, red where selling did, shade
                  // by size; POC outlined; numbers only when the column is
                  // wide enough to read them.
                  const colW = Math.max(3, (layout.x(1) - layout.x(0)) * 0.88);
                  const showText = colW >= 40;
                  const q = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2));
                  const delta = fp.buy - fp.sell;
                  return (
                    <g key={candle.time} className={fp.complete ? "" : "fp-partial"}>
                      <line
                        x1={xPos - colW / 2 - 2}
                        x2={xPos - colW / 2 - 2}
                        y1={layout.y(candle.high)}
                        y2={layout.y(candle.low)}
                        className={up ? "liq-wick-up" : "liq-wick-down"}
                      />
                      <line
                        x1={xPos - colW / 2 - 2}
                        x2={xPos - colW / 2 - 2}
                        y1={openY}
                        y2={closeY}
                        className={`fp-body ${up ? "up" : "down"}`}
                      />
                      {[...fp.cells.entries()].map(([price, c]) => {
                        const yTop = layout.y(price + fp.bucket);
                        const h = Math.max(1, layout.y(price) - yTop - 0.6);
                        const total = c.buy + c.sell;
                        // Square root so mid-sized rows stay visible next to the POC.
                        const alpha = 0.14 + 0.66 * Math.sqrt(total / Math.max(footprints.maxCell, 1e-12));
                        const imb = showText ? imbalance(fp, price) : null;
                        return (
                          <g key={price}>
                            <rect
                              x={xPos - colW / 2}
                              y={yTop}
                              width={colW}
                              height={h}
                              fill={c.buy >= c.sell ? `rgba(57,242,154,${alpha})` : `rgba(255,89,100,${alpha})`}
                              className={fp.poc === price ? "fp-poc" : undefined}
                            />
                            {showText && h >= 8 && (
                              <text x={xPos} y={yTop + h / 2 + 3} className={`fp-num${imb ? (imb === "COMPRA" ? " imb-b" : " imb-s") : ""}`}>
                                {q(c.sell)}×{q(c.buy)}
                              </text>
                            )}
                          </g>
                        );
                      })}
                      {colW >= 17 && (
                        <text x={xPos} y={layout.y(candle.low) + 11} className={`fp-delta ${delta >= 0 ? "up" : "down"}`}>
                          {delta >= 0 ? `+${q(delta)}` : `-${q(-delta)}`}
                        </text>
                      )}
                      {/* The rest of the candle's order flow, when there is room:
                          total traded and the share that was aggressive buying. */}
                      {colW >= 40 && fp.buy + fp.sell > 0 && (
                        <text x={xPos} y={layout.y(candle.low) + 21} className="fp-stats">
                          <title>Volumen operado en la vela y qué parte fue compra agresiva (C)</title>
                          VOL {q(fp.buy + fp.sell)} · {Math.round((fp.buy / (fp.buy + fp.sell)) * 100)}% C
                        </text>
                      )}
                      {/* Stacked imbalance: several consecutive footprint
                          levels imbalanced the same direction — the actual
                          footprint signal, as opposed to one isolated cell.
                          Drawn at a fixed offset from the candle rather than
                          gated by colW, so it stays visible zoomed out too,
                          unlike the per-cell numbers above. */}
                      {findStackedImbalances(fp, candle.high, candle.low).map((run, ri) => {
                        const buySide = run.side === "COMPRA";
                        const y = buySide ? layout.y(candle.low) + 24 : layout.y(candle.high) - 10;
                        return (
                          <text
                            key={`stack-${ri}`}
                            x={xPos}
                            y={y}
                            className={`fp-stack ${buySide ? "up" : "down"}`}
                          >
                            {buySide ? "▲" : "▼"} ×{run.levels}
                          </text>
                        );
                      })}
                    </g>
                  );
                }
                return (
                  <g key={candle.time}>
                    <line
                      x1={xPos}
                      x2={xPos}
                      y1={layout.y(candle.high)}
                      y2={layout.y(candle.low)}
                      className={up ? "liq-wick-up" : "liq-wick-down"}
                    />
                    <rect
                      x={xPos - layout.bodyW / 2}
                      y={Math.min(openY, closeY)}
                      width={layout.bodyW}
                      height={Math.max(1, Math.abs(closeY - openY))}
                      className={up ? "liq-candle-up" : "liq-candle-down"}
                    />
                  </g>
                );
              })}

              {/* Liquidity sweeps: the swept level from its pivot to the sweep
                  candle, and a marker on the wick that took it. */}
              {layers.tomas &&
                sweeps
                  .filter((sw) => sw.index - patternOffset >= 0)
                  .slice(0, 6)
                  .map((sw, k) => {
                    const xi = layout.x(sw.index - patternOffset);
                    const xp = layout.x(Math.max(0, sw.pivotIndex - patternOffset));
                    const yl = layout.y(sw.level);
                    const ye = layout.y(sw.extreme);
                    const bull = sw.side === "VENTA"; // stops under a low taken → bullish read
                    const tip = bull ? ye + 3 : ye - 3;
                    const d = bull
                      ? `M ${xi} ${tip} l -4 7 l 8 0 z`
                      : `M ${xi} ${tip} l -4 -7 l 8 0 z`;
                    return (
                      <g key={`sw-${sw.side}-${sw.index}`}>
                        <line x1={xp} x2={xi} y1={yl} y2={yl} className={`sw-level ${bull ? "up" : "down"}`} />
                        <path d={d} className={`sw-mark ${bull ? "up" : "down"}`} />
                        {k < 3 && (
                          <text x={xi} y={bull ? tip + 18 : tip - 11} className={`sw-label ${bull ? "up" : "down"}`}>
                            TOMA {bull ? "↑" : "↓"}
                          </text>
                        )}
                      </g>
                    );
                  })}

              {/* Key support and resistance: a band per level, labelled at the left. */}
              {layers.sr &&
                levels.map((l, i) => {
                  const right = MARGIN.left + layout.candleAreaW;
                  const yTop = layout.y(l.high);
                  const yBot = layout.y(l.low);
                  if (yBot < MARGIN.top || yTop > MARGIN.top + layout.plotH) return null;
                  const n = levels.filter((x) => x.kind === l.kind).indexOf(l) + 1;
                  const res = l.kind === "RESISTENCIA";
                  return (
                    <g key={`srb-${i}`} className={`sr-level ${res ? "res" : "sup"} ${l.strength === "DÉBIL" ? "weak" : ""}`}>
                      <rect x={MARGIN.left} y={Math.min(yTop, yBot)} width={layout.candleAreaW} height={Math.max(2, Math.abs(yBot - yTop))} />
                      <line x1={MARGIN.left} x2={right} y1={layout.y(l.price)} y2={layout.y(l.price)} />
                      {/* Past the IMÁN / POOL captions, which sit at the left edge. */}
                      <text x={MARGIN.left + 118} y={layout.y(l.price) - 3}>
                        {res ? "R" : "S"}
                        {n} {priceLabel(l.price)} · {l.touches} toques
                      </text>
                    </g>
                  );
                })}

              {/* LIQ+VOL: a diamond on each signal candle (filled = reached the
                  target, hollow = stopped or timed out, amber = open), and the
                  open trade's entry, stop and target. */}
              {layers.liqvol &&
                lv &&
                (() => {
                  const right = MARGIN.left + layout.candleAreaW;
                  const live = liveLv && liveLv.signal.index - patternOffset >= 0 ? liveLv.signal : null;
                  return (
                    <g>
                      {live && (
                        <g>
                          <line x1={layout.x(live.index - patternOffset)} x2={right} y1={layout.y(live.entry)} y2={layout.y(live.entry)} className="sc-line entry" />
                          <line x1={layout.x(live.index - patternOffset)} x2={right} y1={layout.y(live.stop)} y2={layout.y(live.stop)} className="sc-line stop" />
                          <line x1={layout.x(live.index - patternOffset)} x2={right} y1={layout.y(live.target)} y2={layout.y(live.target)} className="sc-line target" />
                          <text x={right - 4} y={layout.y(live.entry) - 3} className="sc-tag">LIQ+VOL {live.side === "LONG" ? "COMPRA" : "VENTA"} {priceLabel(live.entry)}</text>
                          <text x={right - 4} y={live.side === "LONG" ? layout.y(live.stop) + 10 : layout.y(live.stop) - 3} className="sc-tag stop">STOP {priceLabel(live.stop)}</text>
                          <text x={right - 4} y={live.side === "LONG" ? layout.y(live.target) - 3 : layout.y(live.target) + 10} className="sc-tag target">OBJ {priceLabel(live.target)} · 2R</text>
                        </g>
                      )}
                      {lv.trades
                        .filter((t) => t.signal.index - patternOffset >= 0)
                        .map((t) => {
                          const c = patternSeries[t.signal.index];
                          const xi = layout.x(t.signal.index - patternOffset);
                          const long = t.signal.side === "LONG";
                          const yi = long ? layout.y(c.low) + 12 : layout.y(c.high) - 12;
                          return (
                            <path
                              key={`lv-${t.signal.index}-${t.signal.side}`}
                              d={`M ${xi} ${yi - 6} l 6 6 l -6 6 l -6 -6 z`}
                              className={`lv-mark ${long ? "up" : "down"} ${t.result === "OBJETIVO" ? "won" : t.result === "ABIERTA" ? "open" : "lost"}`}
                            >
                              <title>{`LIQ+VOL ${long ? "COMPRA" : "VENTA"} · ${t.result.toLowerCase()}${t.r !== null ? ` · ${t.r >= 0 ? "+" : ""}${t.r.toFixed(2)}R` : ""} · volumen ${t.signal.rvol.toFixed(1)}×${t.signal.flushRatio !== null ? ` · liquidaciones ${t.signal.flushRatio.toFixed(1)}×` : ""}`}</title>
                            </path>
                          );
                        })}
                    </g>
                  );
                })()}

              {/* Inducements: a dotted line from the pullback to where it was
                  swept (✕), or to the right edge while it is still pending. */}
              {layers.idm &&
                idms
                  .filter((x) => (x.sweptIndex ?? scalpSeries.length) - patternOffset >= 0)
                  .slice(-6)
                  .map((x) => {
                    const right = MARGIN.left + layout.candleAreaW;
                    const x0 = Math.max(MARGIN.left, layout.x(x.idmIndex - patternOffset));
                    const x1 = x.sweptIndex === null ? right : layout.x(x.sweptIndex - patternOffset);
                    const y = layout.y(x.level);
                    const up = x.side === "ALCISTA";
                    return (
                      <g key={`idm-${x.side}-${x.idmIndex}`} className={`idm ${up ? "up" : "down"} ${x.sweptIndex === null ? "pending" : "swept"}`}>
                        <line x1={x0} x2={x1} y1={y} y2={y} />
                        <text x={x0 + 2} y={up ? y + 10 : y - 4}>IDM</text>
                        {x.sweptIndex !== null && (
                          <text x={x1} y={y + 3} className="idm-x">✕</text>
                        )}
                        <title>{`Inducción ${x.side.toLowerCase()} en ${priceLabel(x.level)} · ${x.sweptIndex === null ? "pendiente" : `barrida · ${x.outcome === "CONTINUÓ" ? "la tendencia siguió" : x.outcome === "FALLÓ" ? "la estructura falló" : "sin resolver"}`}`}</title>
                      </g>
                    );
                  })}

              {/* Scalping signals: an arrow on the candle that triggered, and for
                  the newest one still inside its horizon, the entry, stop and
                  target it defined — the box a trader would actually place. */}
              {layers.scalp &&
                (() => {
                  const visible = scalpSignals.filter((sg) => sg.index - patternOffset >= 0);
                  const right = MARGIN.left + layout.candleAreaW;
                  const live = liveScalp && liveScalp.index - patternOffset >= 0 ? liveScalp : null;
                  const yE = live ? layout.y(live.entry) : 0;
                  const yS = live ? layout.y(live.stop) : 0;
                  const yT = live ? layout.y(live.target) : 0;
                  const x0 = live ? layout.x(live.index - patternOffset) : 0;
                  return (
                    <g>
                      {live && (
                        <g>
                          <rect x={x0} y={Math.min(yE, yT)} width={Math.max(0, right - x0)} height={Math.abs(yT - yE)} className="sc-box target" />
                          <rect x={x0} y={Math.min(yE, yS)} width={Math.max(0, right - x0)} height={Math.abs(yS - yE)} className="sc-box stop" />
                          <line x1={x0} x2={right} y1={yE} y2={yE} className="sc-line entry" />
                          <line x1={x0} x2={right} y1={yS} y2={yS} className="sc-line stop" />
                          <line x1={x0} x2={right} y1={yT} y2={yT} className="sc-line target" />
                          <text x={right - 4} y={yE - 3} className="sc-tag">ENTRADA {priceLabel(live.entry)}</text>
                          <text x={right - 4} y={live.side === "COMPRA" ? yS + 10 : yS - 3} className="sc-tag stop">STOP {priceLabel(live.stop)}</text>
                          <text x={right - 4} y={live.side === "COMPRA" ? yT - 3 : yT + 10} className="sc-tag target">OBJ {priceLabel(live.target)} · {live.rr.toLocaleString("es-AR")}R</text>
                        </g>
                      )}
                      {visible.map((sg, k) => {
                        const candle = patternSeries[sg.index];
                        const xi = layout.x(sg.index - patternOffset);
                        const buy = sg.side === "COMPRA";
                        const tip = buy ? layout.y(candle.low) + 5 : layout.y(candle.high) - 5;
                        const d = buy ? `M ${xi} ${tip} l -5 9 l 10 0 z` : `M ${xi} ${tip} l -5 -9 l 10 0 z`;
                        return (
                          <g key={`sc-${sg.side}-${sg.index}`}>
                            <path d={d} className={`sc-mark ${buy ? "up" : "down"}`} />
                            {k >= visible.length - 2 && (
                              <text x={xi} y={buy ? tip + 21 : tip - 13} className={`sc-label ${buy ? "up" : "down"}`}>
                                {sg.side}
                              </text>
                            )}
                          </g>
                        );
                      })}
                    </g>
                  );
                })()}

              {/* Trade bubbles: each large market order where and when it
                  printed inside its candle's column, area by dollars. */}
              {bubbles && bubbles.bubbles.length > 0 && (
                <g className="tb-layer" clipPath="url(#liq-price-clip)">
                  {(() => {
                    const slot = layout.candles.length > 1 ? layout.x(1) - layout.x(0) : 20;
                    const colW = Math.max(3, slot * 0.88);
                    const rMax = Math.max(6, Math.min(20, slot * 0.6));
                    const labelFrom = bubbles.bubbles.length > 3 ? bubbles.bubbles[bubbles.bubbles.length - 3].notional : 0;
                    return bubbles.bubbles.map((b) => {
                      const open = Math.floor((b.time - bubbles.first) / bubbles.frameMs) * bubbles.frameMs + bubbles.first;
                      const i = bubbles.index.get(open);
                      if (i === undefined) return null;
                      const frac = Math.min(0.999, Math.max(0, (b.time - open) / bubbles.frameMs));
                      const cx = layout.x(i) - colW / 2 + frac * colW;
                      const cy = layout.y(b.price);
                      const r = bubbleRadius(b.notional, bubbles.largest, 3, rMax);
                      const buy = b.side === "COMPRA";
                      return (
                        <g key={b.id}>
                          <circle cx={cx} cy={cy} r={r} className={`tb-bubble ${buy ? "buy" : "sell"}`}>
                            <title>
                              {`${buy ? "Compra" : "Venta"} agresiva ${dollarsShort(b.notional)} · ${b.qty.toLocaleString("es-AR", { maximumFractionDigits: 4 })} a ${b.price.toLocaleString("es-AR", { maximumFractionDigits: 6 })} · ${new Date(b.time).toLocaleTimeString("es-AR", { hour12: false })}`}
                            </title>
                          </circle>
                          {r >= 10 && b.notional >= labelFrom && (
                            <text x={cx} y={cy + 3} className="tb-label">{dollarsShort(b.notional)}</text>
                          )}
                        </g>
                      );
                    });
                  })()}
                </g>
              )}

              {/* Real liquidations, as they print. Bubble area follows size;
                  red = longs forced out, green = shorts. Only the three
                  largest in view carry a label, so a cascade stays readable. */}
              {(() => {
                const cs = layout.candles;
                if (!layers.reales || !cs.length || !liveLiqs.length) return null;
                const visible = liveLiqs.filter(
                  (l) => l.time >= cs[0].time && l.price >= layout.lo && l.price <= layout.hi,
                );
                const labelled = new Set(
                  [...visible].sort((a, b) => b.notionalUsd - a.notionalUsd).slice(0, 3),
                );
                return visible.map((l, k) => {
                  let i = cs.length - 1;
                  while (i > 0 && cs[i].time > l.time) i -= 1;
                  const r = Math.min(14, 2.5 + Math.sqrt(l.notionalUsd / 5000));
                  const cx = layout.x(i);
                  const cy = layout.y(l.price);
                  return (
                    <g key={`lq-${l.time}-${k}`}>
                      <circle
                        cx={cx}
                        cy={cy}
                        r={r}
                        className={l.side === "LARGOS" ? "liq-print long" : "liq-print short"}
                      />
                      {labelled.has(l) && (
                        <text x={cx + r + 3} y={cy + 3} className="liq-print-label">
                          {shortUsd(l.notionalUsd)}
                        </text>
                      )}
                    </g>
                  );
                });
              })()}

              </g>

              {/* Volume strip. Bars scale to the largest candle in view; the
                  line is the 20-candle average, so a bar well above it is a
                  candle traded with unusual size — the part worth noticing. */}
              {(() => {
                if (!layers.volumen) return null;
                const vols = layout.candles.map((c) => c.volume * c.close);
                const maxV = Math.max(0, ...vols);
                if (!(maxV > 0)) return null;
                const vy = (v: number) => layout.volTop + layout.volH - (v / maxV) * layout.volH;
                const avg = vols.map((_, i) => {
                  const from = Math.max(0, i - 19);
                  const slice = vols.slice(from, i + 1);
                  return slice.reduce((a, b) => a + b, 0) / slice.length;
                });
                return (
                  <g>
                    <line
                      x1={MARGIN.left}
                      x2={MARGIN.left + layout.candleAreaW}
                      y1={layout.volTop - 4}
                      y2={layout.volTop - 4}
                      className="liq-vol-sep"
                    />
                    {/* Each bar is split by aggressor when Binance provides it:
                        aggressive buying from the bottom, selling on top. */}
                    {layout.candles.map((c, i) => {
                      const top = vy(vols[i]);
                      const base = layout.volTop + layout.volH;
                      const d = candleDelta(c.volume, c.takerBuy);
                      if (!d) {
                        return (
                          <rect
                            key={`v${c.time}`}
                            x={layout.x(i) - layout.bodyW / 2}
                            y={top}
                            width={layout.bodyW}
                            height={Math.max(0.6, base - top)}
                            className={c.close >= c.open ? "liq-vol-up" : "liq-vol-down"}
                          />
                        );
                      }
                      const buyH = (base - top) * (c.volume > 0 ? d.buy / c.volume : 0);
                      return (
                        <g key={`v${c.time}`}>
                          <rect x={layout.x(i) - layout.bodyW / 2} y={base - buyH} width={layout.bodyW} height={Math.max(0.3, buyH)} className="liq-vol-buy" />
                          <rect x={layout.x(i) - layout.bodyW / 2} y={top} width={layout.bodyW} height={Math.max(0.3, base - buyH - top)} className="liq-vol-sell" />
                        </g>
                      );
                    })}
                    <polyline
                      points={avg.map((v, i) => `${layout.x(i)},${vy(v)}`).join(" ")}
                      className="liq-vol-avg"
                    />
                    {/* CVD: running sum of delta over the visible window, scaled
                        to the pane. Rising = aggressive buyers in control. */}
                    {(() => {
                      const cvd = cumulativeDelta(layout.candles.map((c) => candleDelta(c.volume, c.takerBuy)?.delta ?? null));
                      const vals = cvd.filter((v): v is number => v !== null);
                      if (vals.length < 2) return null;
                      const lo = Math.min(...vals);
                      const hi = Math.max(...vals);
                      const span = hi - lo || 1;
                      const pts = cvd
                        .map((v, i) => (v === null ? "" : `${layout.x(i)},${layout.volTop + 4 + (1 - (v - lo) / span) * (layout.volH - 8)}`))
                        .filter(Boolean)
                        .join(" ");
                      return <polyline points={pts} className="liq-cvd" />;
                    })()}
                    <text x={MARGIN.left + 4} y={layout.volTop + 9} className="liq-vol-label">
                      VOL · máx {shortUsd(maxV)} · <tspan className="lv-buy">compras</tspan>/<tspan className="lv-sell">ventas</tspan> · <tspan className="lv-cvd">CVD</tspan>
                    </text>
                  </g>
                );
              })()}

              {/* Oscillator panes and divergences. A divergence is drawn twice:
                  on the price (its two pivots) and on its oscillator, solid for
                  regular, dotted for hidden, green bullish, red bearish. Only
                  divergences whose indicator pane is on are drawn, so a line on
                  the price always has its counterpart visible below. */}
              {(() => {
                // Up to four per indicator, both pivots inside the window.
                const inView = osc.divs.filter((d) => d.from - patternOffset >= 0);
                const shown = [
                  ...(layout.rsiH > 0 ? inView.filter((d) => d.indicator === "RSI").slice(0, 4) : []),
                  ...(layout.macdH > 0 ? inView.filter((d) => d.indicator === "MACD").slice(0, 4) : []),
                ];
                const tag = (d: (typeof shown)[number]) =>
                  `${d.kind === "OCULTA" ? "OCULTA" : "DIV"} ${d.side === "ALCISTA" ? "↑" : "↓"}`;
                // Pane labels claim space newest-first; one that would land on
                // another label or on the pane title is left out (its line and
                // dots still show, and the list under the chart names it).
                const placed: { x: number; y: number }[] = [];
                const labelFits = (x: number, y: number, top: number) => {
                  if (x < x0 + 175 && y < top + 16) return false;
                  if (placed.some((p) => Math.abs(p.x - x) < 52 && Math.abs(p.y - y) < 11)) return false;
                  placed.push({ x, y });
                  return true;
                };
                const dots = (d: (typeof shown)[number], y1: number, y2: number) => (
                  <>
                    <circle cx={layout.x(d.from - patternOffset)} cy={y1} r={2.6} className={`div-dot ${d.side === "ALCISTA" ? "up" : "down"}`} />
                    <circle cx={layout.x(d.to - patternOffset)} cy={y2} r={2.6} className={`div-dot ${d.side === "ALCISTA" ? "up" : "down"}`} />
                  </>
                );
                const cls = (d: (typeof shown)[number]) =>
                  `div-line ${d.side === "ALCISTA" ? "up" : "down"}${d.kind === "OCULTA" ? " hidden" : ""}`;
                const x0 = MARGIN.left;
                const x1 = MARGIN.left + layout.candleAreaW;

                const rsiPane = layout.rsiH > 0 && (() => {
                  const top = layout.rsiTop;
                  const h = layout.rsiH;
                  const yv = (v: number) => top + h - (v / 100) * h;
                  const vis = osc.r.slice(patternOffset);
                  const pts = vis.map((v, i) => (v === null ? "" : `${layout.x(i)},${yv(v)}`)).filter(Boolean).join(" ");
                  const lastV = [...vis].reverse().find((v) => v !== null);
                  return (
                    <g>
                      <rect x={x0} y={yv(70)} width={layout.candleAreaW} height={yv(30) - yv(70)} className="osc-band" />
                      {[70, 50, 30].map((l) => (
                        <line key={l} x1={x0} x2={x1} y1={yv(l)} y2={yv(l)} className={l === 50 ? "osc-mid" : "osc-level"} />
                      ))}
                      <polyline points={pts} className="osc-rsi" />
                      {shown.filter((d) => d.indicator === "RSI").map((d) => (
                        <g key={`rp-${d.from}-${d.to}`}>
                          <line
                            x1={layout.x(d.from - patternOffset)}
                            y1={yv(d.oscFrom)}
                            x2={layout.x(d.to - patternOffset)}
                            y2={yv(d.oscTo)}
                            className={cls(d)}
                          />
                          {dots(d, yv(d.oscFrom), yv(d.oscTo))}
                          {labelFits(layout.x(d.to - patternOffset), yv(d.oscTo) + (d.side === "ALCISTA" ? 11 : -5), top) && (
                            <text
                              x={layout.x(d.to - patternOffset)}
                              y={yv(d.oscTo) + (d.side === "ALCISTA" ? 11 : -5)}
                              className={`div-label ${d.side === "ALCISTA" ? "up" : "down"} mid`}
                            >
                              {tag(d)}
                            </text>
                          )}
                        </g>
                      ))}
                      <text x={x0 + 4} y={top + 10} className="osc-label">
                        RSI 14 · {lastV != null ? lastV.toFixed(1) : "—"}
                        {lastV != null ? (lastV >= 70 ? " · SOBRECOMPRA" : lastV <= 30 ? " · SOBREVENTA" : "") : ""}
                      </text>
                    </g>
                  );
                })();

                const macdPane = layout.macdH > 0 && (() => {
                  const top = layout.macdTop;
                  const h = layout.macdH;
                  const vm = osc.m.macd.slice(patternOffset);
                  const vs = osc.m.signal.slice(patternOffset);
                  const vh = osc.m.hist.slice(patternOffset);
                  const maxAbs = Math.max(
                    1e-12,
                    ...[...vm, ...vs, ...vh].filter((v): v is number => v !== null).map(Math.abs),
                  );
                  const yv = (v: number) => top + h / 2 - (v / maxAbs) * (h / 2 - 2);
                  const line = (arr: (number | null)[]) =>
                    arr.map((v, i) => (v === null ? "" : `${layout.x(i)},${yv(v)}`)).filter(Boolean).join(" ");
                  const lastH = [...vh].reverse().find((v) => v !== null);
                  return (
                    <g>
                      <line x1={x0} x2={x1} y1={yv(0)} y2={yv(0)} className="osc-mid" />
                      {vh.map((v, i) => {
                        if (v === null) return null;
                        const prev = vh[i - 1];
                        const fading = prev != null && Math.abs(v) < Math.abs(prev);
                        return (
                          <rect
                            key={`h${i}`}
                            x={layout.x(i) - layout.bodyW / 2}
                            y={Math.min(yv(v), yv(0))}
                            width={layout.bodyW}
                            height={Math.max(0.6, Math.abs(yv(v) - yv(0)))}
                            className={`osc-hist ${v >= 0 ? "up" : "down"}${fading ? " fade" : ""}`}
                          />
                        );
                      })}
                      <polyline points={line(vm)} className="osc-macd" />
                      <polyline points={line(vs)} className="osc-signal" />
                      {shown.filter((d) => d.indicator === "MACD").map((d) => (
                        <g key={`mp-${d.from}-${d.to}`}>
                          <line
                            x1={layout.x(d.from - patternOffset)}
                            y1={yv(d.oscFrom)}
                            x2={layout.x(d.to - patternOffset)}
                            y2={yv(d.oscTo)}
                            className={cls(d)}
                          />
                          {dots(d, yv(d.oscFrom), yv(d.oscTo))}
                          {labelFits(layout.x(d.to - patternOffset), yv(d.oscTo) + (d.side === "ALCISTA" ? 11 : -5), top) && (
                            <text
                              x={layout.x(d.to - patternOffset)}
                              y={yv(d.oscTo) + (d.side === "ALCISTA" ? 11 : -5)}
                              className={`div-label ${d.side === "ALCISTA" ? "up" : "down"} mid`}
                            >
                              {tag(d)}
                            </text>
                          )}
                        </g>
                      ))}
                      <text x={x0 + 4} y={top + 10} className="osc-label">
                        MACD 12·26·9{lastH != null ? ` · hist ${lastH >= 0 ? "+" : ""}${lastH.toPrecision(3)}` : ""}
                      </text>
                    </g>
                  );
                })();

                return (
                  <g>
                    {/* On the price: the two pivots joined, no text — the label
                        sits on the oscillator, where there is room for it. */}
                    <g clipPath="url(#liq-price-clip)">
                      {shown.map((d) => (
                        <g key={`pp-${d.indicator}-${d.from}-${d.to}`}>
                          <line
                            x1={layout.x(d.from - patternOffset)}
                            y1={layout.y(d.priceFrom)}
                            x2={layout.x(d.to - patternOffset)}
                            y2={layout.y(d.priceTo)}
                            className={cls(d)}
                          />
                          {dots(d, layout.y(d.priceFrom), layout.y(d.priceTo))}
                        </g>
                      ))}
                    </g>
                    {rsiPane}
                    {macdPane}
                  </g>
                );
              })()}

              <line
                x1={MARGIN.left}
                x2={box.width - MARGIN.right}
                y1={layout.y(livePrice ?? data.heatmap.currentPrice)}
                y2={layout.y(livePrice ?? data.heatmap.currentPrice)}
                className={`liq-price-line ${
                  (layout.candles.at(-1)?.close ?? 0) >= (layout.candles.at(-1)?.open ?? 0) ? "up" : "down"
                }`}
              />

              {/* The same two levels the cards name, drawn where they sit. */}
              {layers.calor && [
                { zone: data.heatmap.topZoneAbove, cls: "up", label: "IMÁN ↑" },
                { zone: data.heatmap.topZoneBelow, cls: "down", label: "IMÁN ↓" },
              ].map(({ zone, cls, label }) =>
                zone && zone.price >= layout.lo && zone.price <= layout.hi ? (
                  <g key={cls}>
                    <line
                      x1={MARGIN.left}
                      x2={box.width - MARGIN.right}
                      y1={layout.y(zone.price)}
                      y2={layout.y(zone.price)}
                      className={`liq-magnet-line ${cls}`}
                    />
                    <text
                      x={MARGIN.left + 6}
                      y={layout.y(zone.price) - 5}
                      className={`liq-magnet-label ${cls}`}
                    >
                      {label} {priceLabel(zone.price)}
                      {zone.notionalUsd !== null ? ` · ${usd(zone.notionalUsd)}` : ""}
                    </text>
                    <rect x={box.width - MARGIN.right} y={layout.y(zone.price) - 8} width={MARGIN.right - 4} height={16} rx={2} className={`liq-axis-tag ${cls}`} />
                    <text x={box.width - MARGIN.right + (MARGIN.right - 4) / 2} y={layout.y(zone.price) + 3.5} className="liq-axis-tag-text">
                      {priceLabel(zone.price)}
                    </text>
                  </g>
                ) : null,
              )}
              {layers.calor &&
                layout.secondaryPools.map((pool) => {
                  const cls = pool.side === "short" ? "up" : "down";
                  const yy = layout.y(pool.price);
                  return (
                    <g key={`sec-${pool.key}`}>
                      <line x1={MARGIN.left} x2={box.width - MARGIN.right} y1={yy} y2={yy} className={`liq-magnet-line secondary ${cls}`} />
                      <text x={MARGIN.left + 6} y={yy - 5} className={`liq-magnet-label secondary ${cls}`}>
                        POOL {pool.side === "short" ? "↑" : "↓"} {priceLabel(pool.price)}
                        {pool.usd > 0 ? ` · ${usd(pool.usd)}` : ""}
                      </text>
                      <rect x={box.width - MARGIN.right} y={yy - 8} width={MARGIN.right - 4} height={16} rx={2} className={`liq-axis-tag secondary ${cls}`} />
                      <text x={box.width - MARGIN.right + (MARGIN.right - 4) / 2} y={yy + 3.5} className="liq-axis-tag-text">
                        {priceLabel(pool.price)}
                      </text>
                    </g>
                  );
                })}

              {priceTicks.map((tick) => (
                <text
                  key={tick.price}
                  x={box.width - MARGIN.right + 8}
                  y={tick.yPos + 3}
                  className="liq-axis-label"
                >
                  {priceLabel(tick.price)}
                </text>
              ))}
              {dateTicks.map((tick) => (
                <text
                  key={tick.time}
                  x={tick.xPos}
                  y={box.height - 10}
                  className="liq-axis-label liq-axis-x"
                >
                  {/* Minute frames need the minute; multi-day frames would be
                      lying to show an hour at all. */}
                  {timeframe === "1m" || timeframe === "5m"
                    ? new Date(tick.time).toLocaleTimeString("es-AR", {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })
                    : timeframe === "1d" || timeframe === "3d" || timeframe === "1w"
                      ? new Date(tick.time).toLocaleDateString("es-AR", {
                          day: "2-digit",
                          month: "2-digit",
                        })
                      : `${new Date(tick.time).getDate()}/${
                          new Date(tick.time).getMonth() + 1
                        } ${String(new Date(tick.time).getHours()).padStart(2, "0")}h`}
                </text>
              ))}

              {/* Crosshair: tap a candle (or move the mouse) to read it. */}
              {cross && layout.candles[cross.i] && (
                <g className="xh">
                  <line x1={layout.x(cross.i)} x2={layout.x(cross.i)} y1={MARGIN.top} y2={box.height - MARGIN.bottom} />
                  {cross.y <= MARGIN.top + layout.plotH && (
                    <>
                      <line x1={MARGIN.left} x2={box.width - MARGIN.right} y1={cross.y} y2={cross.y} />
                      <rect x={box.width - MARGIN.right - 78} y={cross.y - 9} width={76} height={18} rx={3} className="xh-tag" />
                      <text x={box.width - MARGIN.right - 40} y={cross.y + 4} className="xh-price">
                        {priceLabel(layout.lo + (1 - (cross.y - MARGIN.top) / layout.plotH) * (layout.hi - layout.lo))}
                      </text>
                    </>
                  )}
                </g>
              )}
            </svg>
            {cross && layout.candles[cross.i] && (() => {
              const c = layout.candles[cross.i];
              const d = candleDelta(c.volume, c.takerBuy);
              const chg = ((c.close - c.open) / c.open) * 100;
              return (
                <div className="xh-readout">
                  <span>{new Date(c.time).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                  <b>O</b> {priceLabel(c.open)} <b>H</b> {priceLabel(c.high)} <b>L</b> {priceLabel(c.low)} <b>C</b>{" "}
                  <em className={chg >= 0 ? "up" : "down"}>{priceLabel(c.close)} ({chg >= 0 ? "+" : ""}{chg.toFixed(2)}%)</em>
                  <br />
                  <b>VOL</b> {shortUsd(c.volume * c.close)}
                  {d && (
                    <>
                      {" "}<b>Δ</b> <em className={d.delta >= 0 ? "up" : "down"}>{d.delta >= 0 ? "+" : ""}{shortUsd(d.delta * c.close).replace("$-", "-$")}</em>
                      {" "}<b>COMPRA</b> {Math.round((d.buy / Math.max(c.volume, 1e-12)) * 100)}%
                    </>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); setCross(null); }} aria-label="Cerrar lectura">✕</button>
                </div>
              );
            })()}

            {/* It existed before but sat under the chart and the axis strip
                (no z-index), so the live price was never visible on the axis. */}
            <div
              className={`liq-price-badge ${
                (layout.candles.at(-1)?.close ?? 0) >= (layout.candles.at(-1)?.open ?? 0) ? "up" : "down"
              }`}
              style={{ top: `${(layout.y(livePrice ?? data.heatmap.currentPrice) / box.height) * 100}%` }}
            >
              {/* Keyed by price so the flash replays on every change. */}
              <span key={String(livePrice)} className="lpb-price">
                {priceLabel(livePrice ?? data.heatmap.currentPrice)}
              </span>
              {layout.candles.at(-1) && FRAME_MS[timeframe] && (
                <CandleCountdown closeAt={layout.candles.at(-1)!.time + FRAME_MS[timeframe]} />
              )}
            </div>

            {hovered && (
              <div className="liq-tooltip">
                <b>${priceLabel(hovered.price)}</b>
                {hovered.shortDensity > hovered.longDensity ? (
                  <span>liquidación de shorts si sube hasta acá</span>
                ) : (
                  <span>liquidación de longs si baja hasta acá</span>
                )}
                {hovered.notionalUsd !== null && (
                  <b className="liq-tooltip-usd">{usd(hovered.notionalUsd)}</b>
                )}
                <small>intensidad {hovered.intensity.toFixed(0)}/100</small>
              </div>
            )}
          </div>

          {/* Two columns on laptop widths (see laptop.css); one on phones. */}
          <div className="liq-below">
          {keyLevels.length > 0 && (
            <details className="liq-fold liq-keys">
              <summary>PUNTOS CLAVE · ESTRUCTURA + LIQUIDACIÓN</summary>
              <p className="liq-keys-why">
                Niveles donde un máximo o mínimo previo cae sobre una zona densa: los stops de quien
                operó ahí y las liquidaciones proyectadas coinciden en el mismo precio.
              </p>
              {keyLevels.map((level) => (
                <div key={`${level.kind}-${level.price}`} className={level.kind === "TECHO" ? "techo" : "piso"}>
                  <b>{level.kind}</b>
                  <u>${priceLabel(level.price)}</u>
                  <em>
                    {level.touches > 1 ? `${level.touches} toques · ` : ""}
                    {level.notionalUsd !== null ? usd(level.notionalUsd) : `${level.intensity.toFixed(0)}/100`}
                  </em>
                </div>
              ))}
            </details>
          )}

          {/* Detail lives here, not on the chart. A caption long enough to
              carry volume and a hit rate cannot share vertical space with
              another one — on the chart they stacked into an unreadable pile
              that also hid the candles. In a list each line has its own row. */}
          {(reversalZones.length > 0 || flags.length > 0 || wyckoff) && (
            <div className="liq-patterns">
              <h4>PATRONES Y ZONAS DE REVERSIÓN</h4>

              {reversalZones.length > 0 && (
                <div className="pt-block">
                  <span className="pt-sub">MEJORES ZONAS DE REVERSIÓN · por confluencia</span>
                  {reversalZones.map((z, i) => (
                    <div key={`rz-${i}`} className={`pt-row ${z.side === "SOPORTE" ? "up" : "down"}`}>
                      <b>{"★".repeat(z.stars)}</b>
                      <u>{priceLabel(z.low)}–{priceLabel(z.high)}</u>
                      <em>{z.side.toLowerCase()} · a {z.distancePct.toFixed(2)}%</em>
                      <small>{z.kinds.join(" + ")}</small>
                    </div>
                  ))}
                </div>
              )}

              {flags.map((f) => (
                <div key={`${f.kind}-${f.poleEnd}`} className={`pt-block pt-card ${f.kind === "BULL FLAG" ? "up" : "down"}`}>
                  <span className="pt-sub">{f.kind} · {f.status}</span>
                  <div className="pt-grid">
                    <div><span>RUPTURA</span><b>{priceLabel(f.breakout)}</b></div>
                    <div><span>OBJETIVO</span><b>{priceLabel(f.target)}</b></div>
                    <div><span>INVALIDA</span><b>{priceLabel(f.invalidation)}</b></div>
                  </div>
                  <p>
                    Retroceso {f.retracePct.toFixed(0)}% del mástil{f.volumeFades ? ", volumen bajando en la bandera" : ", sin caída de volumen en la bandera (más débil)"}.
                    El objetivo es el movimiento medido —altura del mástil desde la ruptura—, una convención, no una promesa.
                  </p>
                </div>
              ))}

              {wyckoff && (
                <div className={`pt-block pt-card ${wyckoff.kind === "ACUMULACIÓN" ? "up" : "down"}`}>
                  <span className="pt-sub">WYCKOFF · {wyckoff.kind}</span>
                  <b className="pt-phase">{wyckoff.phase}</b>
                  <div className="pt-grid">
                    <div><span>SOPORTE</span><b>{priceLabel(wyckoff.support)}</b></div>
                    <div><span>RESISTENCIA</span><b>{priceLabel(wyckoff.resistance)}</b></div>
                    <div><span>EVENTOS</span><b>{wyckoff.events.map((e) => e.type).join(" · ")}</b></div>
                  </div>
                  <p>{wyckoff.note}</p>
                </div>
              )}

              <p className="pt-note">
                Patrones detectados con reglas mecánicas, no a ojo. Una zona con más estrellas tiene más detectores
                independientes de acuerdo en ese precio: sube las chances de reacción, no garantiza el giro.
              </p>
            </div>
          )}

          {layers.footprint && (
            <div className={`fp-verdict ${verdict ? (verdict.winner === "COMPRADORES" ? "up" : verdict.winner === "VENDEDORES" ? "down" : "flat") : "flat"}`}>
              {verdict ? (
                <>
                  <div className="fp-verdict-head">
                    <span>QUIÉN VA GANANDO</span>
                    <b>{verdict.winner === "EQUILIBRADO" ? "EQUILIBRADO" : `GANAN ${verdict.winner}`}</b>
                    {verdict.strength && <em>{verdict.strength}</em>}
                  </div>
                  <div
                    className="fp-verdict-bar"
                    style={{ background: `linear-gradient(90deg, var(--green) ${verdict.buyPct}%, var(--red) ${verdict.buyPct}%)` }}
                  />
                  <div className="fp-verdict-nums">
                    <span>compra agresiva {verdict.buyPct.toFixed(0)}% · venta {(100 - verdict.buyPct).toFixed(0)}%</span>
                    <span>Δ {compactQty(verdict.delta, true)} {symbol.replace(/USDT$/, "")}</span>
                    <span>{verdict.candles} velas en vista</span>
                    {verdict.recent && (
                      <span>
                        últimas {verdict.recent.candles}: {verdict.recent.winner.toLowerCase()} ({verdict.recent.buyPct.toFixed(0)}% compra)
                      </span>
                    )}
                    {stacks && stacks.candles > 0 && (
                      <span>
                        apilados (operaciones reales): ▲ {stacks.compra} compra · ▼ {stacks.venta} venta
                      </span>
                    )}
                  </div>
                  {verdict.notes.map((note) => (
                    <p key={note}>{note}</p>
                  ))}
                  <small>
                    Agresor = quien cruza el spread para ejecutar. Sale del volumen comprador agresivo que Binance publica en cada
                    vela, así que vale en todas las temporalidades. Describe quién fue más agresivo, no anticipa el precio.
                  </small>
                </>
              ) : (
                <p>Sin datos suficientes de volumen agresivo en las velas a la vista.</p>
              )}
            </div>
          )}

          {layers.footprint && (
            <p className="fp-hint">
              {!FOOTPRINT_FRAMES.has(timeframe)
                ? "FOOTPRINT (celdas por precio): necesita cada operación y solo existe en 1M, 3M, 5M y 15M. En este marco te queda el veredicto de arriba, que sí cubre todo el historial."
                : !trades.length
                  ? "FOOTPRINT: cargando operaciones…"
                  : `FOOTPRINT con ${trades.length.toLocaleString("es-AR")} operaciones reales. Solo las velas cubiertas por esas operaciones tienen footprint (las parciales se ven atenuadas). Acercá con + a ~20 velas para leer los números venta×compra.`}
            </p>
          )}

          {layers.idm && (
            <div className="div-list sc-list idm-list">
              <h4>INDUCCIONES · {timeframe.toUpperCase()}</h4>
              {idms.length ? (
                idms
                  .slice(-6)
                  .reverse()
                  .map((x) => (
                    <div key={`idml-${x.side}-${x.idmIndex}`} className={x.side === "ALCISTA" ? "up" : "down"}>
                      <b>
                        IDM {x.side.toLowerCase()} · {priceLabel(x.level)} ·{" "}
                        {x.sweptIndex === null ? "pendiente" : x.outcome === "CONTINUÓ" ? "barrida → siguió" : x.outcome === "FALLÓ" ? "barrida → falló" : "barrida, sin resolver"}
                      </b>
                      <span>
                        ruptura de {priceLabel(x.brokenLevel)} · origen del tramo {priceLabel(x.legOrigin)}
                      </span>
                      <em>hace {scalpSeries.length - 1 - x.idmIndex} velas</em>
                    </div>
                  ))
              ) : (
                <p className="div-none">Sin rupturas de estructura con retroceso en las velas cargadas.</p>
              )}
              <small>
                Qué es: cuando el precio rompe la estructura (cierra arriba del último máximo o abajo del último mínimo), el primer retroceso deja
                un mínimo (o máximo) fácil donde muchos entran temprano y ponen el stop. Esa es la inducción: el mercado suele barrerla antes de
                seguir, y la zona de interés que queda detrás gana validez. Para principiantes: no entres en el primer retroceso; esperá que barra
                la IDM y reaccione.{" "}
                {idmSt.rate === null
                  ? "Todavía no hay barridas resueltas para medir."
                  : `En esta serie, después de barrer la IDM la tendencia siguió ${idmSt.continued} de ${idmSt.resolved} veces (${Math.round(idmSt.rate * 100)}%, ${idmSt.confidence.toLowerCase()}).`}{" "}
                Es una lectura, no asesoramiento financiero.
              </small>
            </div>
          )}

          {layers.liqvol && lv && (
            <div className="div-list sc-list lv-list">
              <h4>
                REGISTRO LIQ+VOL · {timeframe.toUpperCase()}
                {lv.trades.length > 0 && (
                  <button
                    className="lv-csv"
                    onClick={() => {
                      const rows = lv.trades.map((t) =>
                        [new Date(t.signal.time).toISOString(), t.signal.side, t.signal.entry, t.signal.stop, t.signal.target, t.result, t.r === null ? "" : t.r.toFixed(3), t.signal.rvol.toFixed(2), t.signal.flushRatio === null ? "" : t.signal.flushRatio.toFixed(2)].join(";"),
                      );
                      const blob = new Blob([`\uFEFFfecha;lado;entrada;stop;objetivo;resultado;R;volumen_x;liquidaciones_x\r\n${rows.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `liqvol-${timeframe}.csv`;
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    }}
                  >
                    CSV
                  </button>
                )}
              </h4>
              {lv.trades.length ? (
                lv.trades
                  .slice(-12)
                  .reverse()
                  .map((t) => (
                    <div key={`lvr-${t.signal.index}-${t.signal.side}`} className={t.r === null ? "" : t.r > 0 ? "up" : "down"}>
                      <b>
                        {t.signal.side === "LONG" ? "COMPRA" : "VENTA"} · {priceLabel(t.signal.entry)} → {t.result === "ABIERTA" ? "abierta" : t.result.toLowerCase()}
                        {t.r !== null ? ` · ${t.r >= 0 ? "+" : ""}${t.r.toFixed(2).replace(".", ",")}R` : ""}
                      </b>
                      <span>
                        stop {priceLabel(t.signal.stop)} · objetivo {priceLabel(t.signal.target)} · volumen {t.signal.rvol.toFixed(1).replace(".", ",")}×
                        {t.signal.flushRatio !== null ? ` · liquidaciones ${t.signal.flushRatio.toFixed(1).replace(".", ",")}×` : ""}
                      </span>
                      <em>hace {scalpSeries.length - 1 - t.signal.index} velas</em>
                    </div>
                  ))
              ) : (
                <p className="div-none">Sin señales LIQ+VOL en las velas cargadas.</p>
              )}
              <small>
                Cada operación se mide con las velas que vinieron después: si una vela toca stop y objetivo, cuenta el stop; las que no se
                resuelven en {LV_HORIZON} velas se cierran a precio de cierre; comisiones descontadas.{" "}
                {lv.stats.winRate === null
                  ? "Todavía no hay operaciones resueltas."
                  : `Resultado: ${plural(lv.stats.wins, "ganadora")} y ${plural(lv.stats.losses, "perdedora")} · win rate ${Math.round(lv.stats.winRate * 100)}% · profit factor ${lv.stats.profitFactor === Infinity ? "∞" : (lv.stats.profitFactor ?? 0).toFixed(2).replace(".", ",")} · total ${lv.stats.totalR >= 0 ? "+" : ""}${lv.stats.totalR.toFixed(1).replace(".", ",")}R.`}{" "}
                {lv.withModel ? "Usa el mapa de liquidaciones." : "Sin el mapa de liquidaciones cargado: solo barrida y volumen."} El win rate de equilibrio a 2R es 33%. Es
                una medición, no asesoramiento financiero.
              </small>
            </div>
          )}

          {layers.scalp && (
            <div className="div-list sc-list">
              <h4>SEÑALES SCALPING · {timeframe.toUpperCase()}</h4>
              {scalpSignals.filter((sg) => sg.index - patternOffset >= 0).length ? (
                scalpSignals
                  .filter((sg) => sg.index - patternOffset >= 0)
                  .slice(-6)
                  .reverse()
                  .map((sg) => (
                    <div key={`scl-${sg.side}-${sg.index}`} className={sg.side === "COMPRA" ? "up" : "down"}>
                      <b>{sg.side} · entrada {priceLabel(sg.entry)}</b>
                      <span>
                        stop {priceLabel(sg.stop)} · objetivo {priceLabel(sg.target)} ({sg.rr.toLocaleString("es-AR")}:1) · {sg.reason}
                      </span>
                      <em>hace {patternSeries.length - 1 - sg.index} velas</em>
                    </div>
                  ))
              ) : (
                <p className="div-none">No hay señales en la ventana visible. Alejá el zoom para ver más velas.</p>
              )}
              <small>
                Regla mecánica: pullback a la EMA20 a favor de la tendencia (EMA20 sobre/bajo EMA50, RSI sin estirar), tomado en la
                vela que lo rechaza. Solo velas cerradas: una señal no aparece ni desaparece mientras la vela se mueve.{" "}
                {scalpSt.winRate === null
                  ? "Sin señales resueltas en la serie todavía."
                  : `En esta serie: ${scalpSt.wins} al objetivo · ${scalpSt.losses} al stop (win rate ${Math.round(scalpSt.winRate * 100)}% · profit factor ${scalpSt.profitFactor === Infinity ? "∞" : (scalpSt.profitFactor ?? 0).toLocaleString("es-AR", { maximumFractionDigits: 2 })}; ${scalpSt.confidence.toLowerCase()}). Con ${scalpSt.rr.toLocaleString("es-AR")}:1 el punto de equilibrio es ${Math.round(scalpSt.breakevenRate * 100)}%; en datos aleatorios este mismo método gana ~37% y da profit factor ~0,9. ${
                      scalpSt.confidence === "MUESTRA RAZONABLE"
                        ? `Expectativa ${(scalpSt.expectancyR ?? 0) >= 0 ? "+" : ""}${(scalpSt.expectancyR ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}R por operación, sin comisiones ni deslizamiento.`
                        : "Con tan pocas señales resueltas todavía no se puede estimar una expectativa: un porcentaje sobre unas pocas operaciones cambia decenas de puntos por azar."
                    }`}{" "}
                Es una lectura, no asesoramiento financiero.
              </small>
            </div>
          )}

          {layers.tomas && (
            <div className="div-list sw-list">
              <h4>TOMAS DE LIQUIDEZ · {timeframe.toUpperCase()}</h4>
              {sweeps.filter((sw) => sw.index - patternOffset >= 0).length ? (
                sweeps
                  .filter((sw) => sw.index - patternOffset >= 0)
                  .slice(0, 6)
                  .map((sw) => (
                    <div key={`swl-${sw.side}-${sw.index}`} className={sw.side === "VENTA" ? "up" : "down"}>
                      <b>{sw.side === "VENTA" ? "TOMA BAJO MÍNIMO ↑" : "TOMA SOBRE MÁXIMO ↓"}</b>
                      <span>
                        nivel {priceLabel(sw.level)} · mecha hasta {priceLabel(sw.extreme)} ({sw.depthPct.toFixed(2)}%) y cierre de vuelta adentro
                      </span>
                      <em>hace {patternSeries.length - 1 - sw.index} velas</em>
                    </div>
                  ))
              ) : (
                <p className="div-none">No hay tomas en la ventana visible. Alejá el zoom para ver más velas.</p>
              )}
              <small>
                Toma = mecha más allá de un máximo o mínimo previo (donde descansan stops) con cierre de vuelta
                adentro; si cierra afuera es ruptura, no toma.{" "}
                {sweepSt.rate === null
                  ? "Sin tomas resueltas en la serie."
                  : `En esta serie revirtieron 1 ATR antes de seguir ${Math.round(sweepSt.rate * 100)}% de ${sweepSt.tested} veces; en gráficos aleatorios da ~50%.`}
              </small>
            </div>
          )}

          {(layers.rsi || layers.macd) && (
            <div className="div-list">
              <h4>DIVERGENCIAS EN ESTE GRÁFICO · {timeframe.toUpperCase()}</h4>
              {osc.divs.filter((d) => d.from - patternOffset >= 0).length ? (
                osc.divs
                  .filter((d) => d.from - patternOffset >= 0)
                  .slice(0, 8)
                  .map((d) => (
                    <div key={`dl-${d.indicator}-${d.from}-${d.to}`} className={`${d.side === "ALCISTA" ? "up" : "down"}${d.kind === "OCULTA" ? " hidden" : ""}`}>
                      <b>
                        {d.indicator} · {d.kind === "OCULTA" ? "OCULTA" : "REGULAR"} {d.side}
                      </b>
                      <span>
                        precio {priceLabel(d.priceFrom)} → {priceLabel(d.priceTo)} · {d.indicator}{" "}
                        {d.oscFrom.toPrecision(3)} → {d.oscTo.toPrecision(3)}
                      </span>
                      <em>hace {d.age} velas</em>
                    </div>
                  ))
              ) : (
                <p className="div-none">
                  No hay divergencias en la ventana visible. Alejá el zoom (−) para ver más velas o probá otra temporalidad.
                </p>
              )}
              <small>
                {osc.stats.rate === null
                  ? "Sin divergencias resueltas en la serie cargada."
                  : `En esta serie funcionaron ${Math.round(osc.stats.rate * 100)}% de ${osc.stats.tested} (el azar da ~50%).`}
              </small>
            </div>
          )}

          {(layers.rsi || layers.macd) && <MtfOscillators symbol={symbol} />}

          {/* The measured counterpart to the estimated map above. */}
          <div className="liq-live-feed">
            <div className="lf-head">
              <h4>LIQUIDEZ TOMADA · EN VIVO</h4>
              <i
                className={`liq-live ${feed.state === "en vivo" ? "on" : feed.state === "sin conexión" ? "off" : feed.state === "demorado" ? "warn" : ""}`}
                title={feed.lastUpdate ? `Último dato ${new Date(feed.lastUpdate).toLocaleTimeString()}` : undefined}
              >
                {feed.state.toUpperCase()}
                {feed.source ? ` · ${feed.source === "WS" ? "WS" : feed.source === "REST SPOT" ? "SPOT" : "REST"}` : ""}
                {feed.lastUpdate
                  ? ` · ${new Date(feed.lastUpdate).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}`
                  : ""}
              </i>
            </div>

            <div className="lf-totals">
              <div className="long">
                <span>LARGOS LIQUIDADOS</span>
                <b>{shortUsd(liqTotals.longsUsd)}</b>
              </div>
              <div className="short">
                <span>CORTOS LIQUIDADOS</span>
                <b>{shortUsd(liqTotals.shortsUsd)}</b>
              </div>
              <div>
                <span>EVENTOS</span>
                <b>{liqTotals.count}</b>
                <em>
                  {liqTotals.dominant === "PAREJO"
                    ? "sin lado dominante"
                    : `pierden más los ${liqTotals.dominant.toLowerCase()}`}
                </em>
              </div>
            </div>

            {pools.some((pool) => pool.taken) && (
              <div className="lf-taken">
                {pools
                  .filter((pool) => pool.taken)
                  .map((pool) => (
                    <span key={pool.id} className={pool.side === "COMPRA" ? "up" : "down"}>
                      {pool.side === "COMPRA" ? "↑" : "↓"} {priceLabel(pool.price)} · {pool.frames.join("·")} tomada en esta vela
                    </span>
                  ))}
              </div>
            )}

            {liveLiqs.length === 0 ? (
              <p className="lf-empty">
                Sin liquidaciones en {symbol.replace("USDT", "")} desde que abriste el mapa. En un par
                tranquilo pueden pasar minutos sin ninguna; no es una falla de conexión.
              </p>
            ) : (
              <div className="lf-list">
                {liveLiqs.slice(0, 12).map((l, k) => (
                  <div key={`${l.time}-${k}`} className={l.side === "LARGOS" ? "long" : "short"}>
                    <em>
                      {new Date(l.time).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </em>
                    <b>{l.side}</b>
                    <u>{priceLabel(l.price)}</u>
                    <span>{shortUsd(l.notionalUsd)}</span>
                  </div>
                ))}
              </div>
            )}

            <p className="lf-note">
              Estos son cierres forzados reales de Binance, no la estimación del mapa. Binance publica como
              máximo uno por segundo por par, así que en una cascada el conteo se queda corto; y es un
              solo exchange. Sirve para ver dónde se quemó el combustible, no el total del mercado.
            </p>
          </div>

          {(orderBlocks.length > 0 || gaps.length > 0 || pools.length > 0) && (
            <details className="liq-fold liq-levels">
              <summary>NIVELES DETECTADOS EN LA VENTANA</summary>
              <div className="liq-levels-list">
                {[
                  ...pools.map((pool) => ({
                    key: pool.id,
                    kind: `LIQ ${pool.side === "COMPRA" ? "↑" : "↓"}`,
                    cls: pool.side === "COMPRA" ? "up" : "down",
                    price: pool.price,
                    low: pool.price,
                    high: pool.price,
                    volumeUsd: null as number | null,
                    stats: null,
                    noStats: true,
                    rank: pool.strength,
                    detail: `${pool.frames.join("·")} · ×${pool.touches}`,
                  })),
                  ...orderBlocks.map((block) => ({
                    key: `ob-${block.index}`,
                    kind: `OB ${block.side === "ALCISTA" ? "↑" : "↓"}`,
                    cls: block.side === "ALCISTA" ? "up" : "down",
                    price: block.mid,
                    low: block.low,
                    high: block.high,
                    volumeUsd: block.volumeUsd,
                    stats: obConfidence,
                    rank: block.strength,
                    detail: undefined as string | undefined,
                  })),
                  ...breakerBlocks.map((block) => ({
                    key: `breaker-${block.index}`,
                    kind: `BREAKER ${block.side === "ALCISTA" ? "↑" : "↓"}`,
                    cls: block.side === "ALCISTA" ? "up" : "down",
                    price: block.mid,
                    low: block.low,
                    high: block.high,
                    volumeUsd: block.volumeUsd,
                    stats: breakerConfidence,
                    rank: block.strength,
                    detail: undefined as string | undefined,
                  })),
                  ...gaps.map((gap) => ({
                    key: `gap-${gap.index}`,
                    kind: gap.kind,
                    cls: gap.side === "ALCISTA" ? "up" : "down",
                    price: gap.mid,
                    low: gap.low,
                    high: gap.high,
                    volumeUsd: gap.volumeUsd,
                    stats: gap.kind === "IFVG" ? (gapConfidence?.ifvg ?? null) : (gapConfidence?.fvg ?? null),
                    rank: gap.quality,
                    detail: undefined as string | undefined,
                  })),
                ]
                  .sort((a, b) => b.price - a.price)
                  .map((level) => (
                    <div key={level.key} className={level.cls}>
                      <b className="lv-kind">{level.kind}</b>
                      <u className="lv-price">
                        {level.low === level.high ? priceLabel(level.low) : `${priceLabel(level.low)}–${priceLabel(level.high)}`}
                      </u>
                      <span className="lv-vol">
                        {level.volumeUsd !== null ? shortUsd(level.volumeUsd) : (level as { detail?: string }).detail ?? ""}
                      </span>
                      <em
                        className={
                          level.stats && level.stats.tested > 0 && level.stats.tested < 8
                            ? "lv-conf thin"
                            : "lv-conf"
                        }
                      >
                        {"noStats" in level && level.noStats ? "" : confidenceLabel(level.stats)}
                      </em>
                    </div>
                  ))}
              </div>
            </details>
          )}

          {scenarios && scenarios.scenarios.length > 0 && (
            <div className="liq-scenarios">
              <h4>ESCENARIOS POSIBLES</h4>
              <p className="sc-note">{scenarios.note}</p>
              <div className="sc-list">
                {scenarios.scenarios.map((scenario) => (
                  <div key={scenario.id} className={`sc-${scenario.id.toLowerCase()}`}>
                    <div className="sc-head">
                      <b>{scenario.title}</b>
                    </div>
                    <div className="sc-row">
                      <span>GATILLO</span>
                      <em>
                        {priceLabel(scenario.trigger.price)} · {scenario.trigger.label}
                      </em>
                    </div>
                    {scenario.target && (
                      <div className="sc-row">
                        <span>OBJETIVO</span>
                        <em>
                          {priceLabel(scenario.target.price)} · {scenario.target.label}
                          {scenario.target.confluences.length > 0
                            ? ` (+ ${scenario.target.confluences.join(", ")})`
                            : ""}
                        </em>
                      </div>
                    )}
                    {scenario.invalidation && (
                      <div className="sc-row">
                        <span>INVALIDA SI</span>
                        <em>
                          rompe {priceLabel(scenario.invalidation.price)} · {scenario.invalidation.label}
                        </em>
                      </div>
                    )}
                    <p className="sc-reasoning">{scenario.reasoning}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          </div>

          <details className="liq-fold liq-method-fold">
            <summary>LEYENDA, METODOLOGÍA Y ADVERTENCIAS</summary>
          <div className="liq-legend">
            <span>
              <i className="up" />
              Vela alcista
            </span>
            <span>
              <i className="down" />
              Vela bajista
            </span>
            <span>
              <i className="heat" />
              Densidad de liquidación (verde → rojo)
            </span>
            <span>
              <i className="ob" />
              Order block sin mitigar
            </span>
            <span>
              <i className="fvg" />
              FVG / IFVG
            </span>
            <span>
              <i className="fib" />
              Banda Fibonacci
            </span>
            <span>
              <i className="print" />
              Liquidación real (en vivo)
            </span>
            <span>
              <i className="pool" />
              Liquidez mín/máx · gruesa = varios marcos
            </span>
          </div>

      {/* Stated before a single bar renders — this is never confirmed data. */}
      <div className="liq-lag">
        <b>ESTIMACIÓN, NO LIQUIDACIONES CONFIRMADAS</b>
        <span>
          Ningún exchange publica el apalancamiento real de cada posición, así que ninguna
          herramienta —ni las pagas— puede mostrarte clusters reales. Este mapa proyecta dónde
          liquidaría una posición abierta en cada nivel, bajo una distribución asumida de
          apalancamientos. Es un modelo estándar del sector, no una medición: tratalo como zonas de
          interés, no como niveles garantizados.
        </span>
      </div>

      {/* Three things this engine does that the naive version of this chart
          does not — stated where the reader can check them, since they are the
          difference between a plausible-looking picture and a defensible one. */}
      <div className="liq-upgrades">
        <div>
          <b>POSICIONES ABIERTAS, NO OPERADAS</b>
          <span>
            Donde hay datos de open interest, el peso de cada nivel es el alta real de contratos, no
            el volumen. El volumen cuenta abrir y cerrar como dos eventos aunque no quede nada
            abierto.
          </span>
        </div>
        <div>
          <b>ZONAS YA BARRIDAS SE DESCARTAN</b>
          <span>
            Si el precio ya atravesó un nivel después de que se formó, esa posición ya se liquidó.
            Dejarla en el mapa sería mostrar combustible que no existe.
          </span>
        </div>
        <div>
          <b>MARGEN REAL DE BINANCE</b>
          <span>
            BTC y ETH usan la tasa de mantenimiento publicada por Binance para el primer tramo, no
            un número redondo. El resto usa un estimado, y el panel lo aclara abajo.
          </span>
        </div>
      </div>

          <p className="liq-method">
            <b>Cómo se calcula.</b> {data.heatmap.method} {data.heatmap.assumptions}
          </p>

          <p className="liq-method">
            <b>Qué es el % que aparece junto a OB, FVG e IFVG.</b> No es una probabilidad: es cuántas
            veces esa clase de nivel se puso a prueba en las velas que estás viendo, y cuántas de
            esas pruebas aguantó. Con menos de 8 casos se marca como muestra mínima — un 100% sobre
            dos casos no es un historial. Un FVG y su IFVG miden cosas distintas: el FVG mide si el
            hueco original aguantó sin invertirse; el IFVG mide, una vez invertido, si ese nuevo rol
            aguantó una segunda prueba. Por eso pueden dar porcentajes distintos.
          </p>
          </details>
        </>
      )}
    </section>
  );
}
