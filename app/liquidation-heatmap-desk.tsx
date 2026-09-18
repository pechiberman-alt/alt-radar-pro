"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildLiquidationHeatmap,
  findKeyLevels,
  type HeatBucket,
  type LiquidationHeatmap,
} from "@/lib/liquidation-heatmap";
import { findPivots, parseSwingKlines } from "@/lib/swing-entries";

type DisplayCandle = { time: number; open: number; high: number; low: number; close: number };
type ApiResponse = { heatmap: LiquidationHeatmap; candles: DisplayCandle[]; timeframe: string };

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
const BROWSER_BASES = ["https://data-api.binance.vision", "https://api.binance.com"];

/** Futures hosts, for open interest. Same mirror list market-brain already uses. */
const FUTURES_BASES = [
  "https://fapi.binance.com",
  "https://fapi1.binance.com",
  "https://fapi2.binance.com",
];

/** Candles per timeframe for the activity profile that feeds the map. */
const LOOKBACK: Record<string, number> = { "15m": 500, "1h": 500, "4h": 500, "1d": 365 };

/**
 * Binance's open-interest history endpoint takes its own period names and,
 * critically, only retains about 30 days of history — and caps a single call
 * at 500 rows. Daily candles therefore get no OI coverage at all, and the
 * shorter frames get partial coverage. That is fine: the engine falls back to
 * volume per-candle wherever OI is missing, and reports how much of the map
 * came from which source.
 */
/**
 * Half-life in candles, chosen so each timeframe discounts activity on a
 * comparable real-time scale (~2 days). Leveraged perpetual positions turn
 * over fast — a published study of BitMEX found roughly 3.5% of longs were
 * force-liquidated every single day — so treating month-old activity as
 * still-open would overstate the map badly.
 */
const HALF_LIFE_CANDLES: Record<string, number> = {
  "15m": 192,
  "1h": 48,
  "4h": 12,
  "1d": 3,
};

const OI_PERIOD: Record<string, string | null> = {
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1d": null,
};

async function loadRows(symbol: string, interval: string, limit: number, signal: AbortSignal) {
  const query = `symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;

  // Futures first, for two reasons. This map is entirely about futures
  // positions, so futures candles are the right series to project from. And
  // several liquid perpetuals — the 1000PEPE / 1000SHIB style contracts —
  // have no spot pair at all, so a spot-only fetch would simply fail for them
  // now that the selector offers the whole top-30.
  for (const base of FUTURES_BASES) {
    try {
      const response = await fetch(`${base}/fapi/v1/klines?${query}`, { signal });
      if (!response.ok) continue;
      const rows = await response.json();
      if (Array.isArray(rows) && rows.length) return rows;
    } catch {
      // Next mirror.
    }
  }

  for (const base of BROWSER_BASES) {
    try {
      const response = await fetch(`${base}/api/v3/klines?${query}`, { signal });
      if (!response.ok) continue;
      const rows = await response.json();
      if (Array.isArray(rows) && rows.length) {
        // Hand the series to the Worker so a rate-limited visitor still gets a
        // map — the same contribution mechanism /api/klines already runs on.
        void fetch(`/api/klines?symbol=${symbol}&interval=${interval}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rows.slice(-500)),
        }).catch(() => undefined);
        return rows;
      }
    } catch {
      // Try the next mirror, then the Worker.
    }
  }

  // This visitor is throttled or offline: fall back to whatever the Worker has,
  // which may be a series another visitor contributed.
  const proxied = await fetch(
    `/api/klines?symbol=${symbol}&interval=${interval}&limit=500`,
    { signal, cache: "no-store" },
  );
  if (!proxied.ok) return null;
  const rows = await proxied.json();
  return Array.isArray(rows) && rows.length ? rows : null;
}

/**
 * Per-candle change in open interest, aligned by candle open time.
 *
 * Volume counts a position opening and closing as two events; open interest
 * counts only what is still held. A rise in OI on a candle means contracts
 * were opened at that price — the thing this map is actually trying to find.
 * Returns null on any failure so the engine simply keeps using volume.
 */
/**
 * Current total open interest, in contracts. Multiplied by price it gives the
 * notional the whole map is scaled against, which turns an abstract intensity
 * into an amount a reader can weigh. Null on any failure — the panel then
 * shows intensity alone rather than a made-up figure.
 */
async function loadOpenInterest(symbol: string, signal: AbortSignal): Promise<number | null> {
  const path = `/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`;
  for (const base of FUTURES_BASES) {
    try {
      const response = await fetch(`${base}${path}`, { signal });
      if (!response.ok) continue;
      const body = (await response.json()) as { openInterest?: unknown };
      const contracts = Number(body.openInterest);
      if (Number.isFinite(contracts) && contracts > 0) return contracts;
    } catch {
      // Next mirror; if all fail the map simply has no dollar scale.
    }
  }
  return null;
}

async function loadOiDelta(
  symbol: string,
  timeframe: string,
  candleOpenTimes: number[],
  signal: AbortSignal,
): Promise<(number | null)[] | null> {
  const period = OI_PERIOD[timeframe];
  if (!period) return null;

  const path = `/futures/data/openInterestHist?symbol=${encodeURIComponent(symbol)}&period=${period}&limit=500`;
  for (const base of FUTURES_BASES) {
    try {
      const response = await fetch(`${base}${path}`, { signal });
      if (!response.ok) continue;
      const rows = (await response.json()) as unknown;
      if (!Array.isArray(rows) || rows.length < 2) continue;

      const byTime = new Map<number, number>();
      for (const row of rows) {
        const entry = row as { timestamp?: unknown; sumOpenInterest?: unknown };
        const time = Number(entry.timestamp);
        const oi = Number(entry.sumOpenInterest);
        if (Number.isFinite(time) && Number.isFinite(oi)) byTime.set(time, oi);
      }
      if (byTime.size < 2) continue;

      // Align to the candles we actually drew, by open time. A candle with no
      // OI row, or whose predecessor has none, gets null and falls back.
      const sorted = [...byTime.keys()].sort((a, b) => a - b);
      const previousOf = new Map<number, number>();
      for (let i = 1; i < sorted.length; i += 1) previousOf.set(sorted[i], sorted[i - 1]);

      return candleOpenTimes.map((time) => {
        const current = byTime.get(time);
        const previousTime = previousOf.get(time);
        if (current === undefined || previousTime === undefined) return null;
        const previous = byTime.get(previousTime);
        if (previous === undefined) return null;
        return current - previous;
      });
    } catch {
      // Next mirror; if all fail, the engine uses volume.
    }
  }
  return null;
}

/** Shown until the live ranking arrives, and as the fallback if it fails. */
const FALLBACK_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
/** How many pairs to offer. Enough to cover what actually trades, few enough
 *  that the row stays scannable rather than becoming a wall of tickers. */
const SYMBOL_COUNT = 30;

/**
 * The most-traded USDT perpetuals, by real 24h quote volume.
 *
 * A hardcoded list goes stale — the pairs that matter in an altseason are not
 * the ones that mattered when the list was written. This ranks them from
 * Binance itself, so the selector always offers what is actually liquid, and
 * only perpetuals, since the whole map depends on futures data.
 */
async function loadTopSymbols(signal: AbortSignal): Promise<string[] | null> {
  for (const base of FUTURES_BASES) {
    try {
      const response = await fetch(`${base}/fapi/v1/ticker/24hr`, { signal });
      if (!response.ok) continue;
      const rows = (await response.json()) as unknown;
      if (!Array.isArray(rows)) continue;
      const ranked = rows
        .map((row) => row as { symbol?: unknown; quoteVolume?: unknown })
        .filter(
          (row): row is { symbol: string; quoteVolume: string } =>
            typeof row.symbol === "string" &&
            row.symbol.endsWith("USDT") &&
            // Leveraged tokens and index products are not pairs a trader maps.
            !/(UP|DOWN|BEAR|BULL)USDT$/.test(row.symbol) &&
            Number.isFinite(Number(row.quoteVolume)),
        )
        .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
        .slice(0, SYMBOL_COUNT)
        .map((row) => row.symbol);
      if (ranked.length >= 5) return ranked;
    } catch {
      // Next mirror; the fallback list keeps the panel usable either way.
    }
  }
  return null;
}
const TIMEFRAMES: { id: string; label: string }[] = [
  { id: "15m", label: "15M" },
  { id: "1h", label: "1H" },
  { id: "4h", label: "4H" },
  { id: "1d", label: "1D" },
];

/** Green → amber → red, matching the app's own tokens rather than a stock
 *  colormap, so a dense cluster reads with the same alarm colour as
 *  everything else risk-related in this terminal. */
const GREEN: [number, number, number] = [57, 242, 154];
const AMBER: [number, number, number] = [244, 184, 74];
const RED: [number, number, number] = [255, 89, 100];

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function intensityColor(intensity: number, alpha: number): string {
  const t = Math.max(0, Math.min(100, intensity)) / 100;
  const [from, to] = t < 0.55 ? [GREEN, AMBER] : [AMBER, RED];
  const localT = t < 0.55 ? t / 0.55 : (t - 0.55) / 0.45;
  const r = Math.round(lerp(from[0], to[0], localT));
  const g = Math.round(lerp(from[1], to[1], localT));
  const b = Math.round(lerp(from[2], to[2], localT));
  return `rgba(${r},${g},${b},${alpha})`;
}

const usd = (value: number) => {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
};

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
export default function LiquidationHeatmapDesk() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState("1h");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState<HeatBucket | null>(null);
  /** Visible candle count. Fewer candles = zoomed in. */
  const [visibleCandles, setVisibleCandles] = useState(70);
  const [symbols, setSymbols] = useState<string[]>(FALLBACK_SYMBOLS);

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
  const selectSymbol = (next: string) => {
    setLoading(true);
    setError("");
    setVisibleCandles(70);
    setSymbol(next);
  };
  const selectTimeframe = (next: string) => {
    setLoading(true);
    setError("");
    setVisibleCandles(70);
    setTimeframe(next);
  };

  const MIN_VISIBLE = 25;
  const MAX_VISIBLE = 220;
  const clampVisible = (n: number) => Math.max(MIN_VISIBLE, Math.min(MAX_VISIBLE, Math.round(n)));
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
  const gesture = useRef<{ distance: number; candles: number } | null>(null);

  const touchDistance = (touches: React.TouchList) => {
    const [a, b] = [touches[0], touches[1]];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };

  const onTouchStart = (event: React.TouchEvent) => {
    if (event.touches.length !== 2) return;
    gesture.current = {
      distance: touchDistance(event.touches),
      candles: visibleCandles,
    };
  };

  const onTouchMove = (event: React.TouchEvent) => {
    if (event.touches.length !== 2 || !gesture.current) return;
    const distance = touchDistance(event.touches);
    if (distance < 20 || gesture.current.distance < 20) return;
    // Fingers apart = zoom in = fewer candles, hence the inverse ratio.
    const ratio = gesture.current.distance / distance;
    setVisibleCandles(clampVisible(gesture.current.candles * ratio));
    // Stop the browser turning the pinch into a page zoom mid-gesture.
    if (event.cancelable) event.preventDefault();
  };

  const onTouchEnd = () => {
    gesture.current = null;
  };

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    (async () => {
      try {
        const interval = timeframe === "1d" ? "1d" : timeframe;
        const rows = await loadRows(
          symbol,
          interval,
          LOOKBACK[timeframe] ?? 500,
          controller.signal,
        );
        if (!alive) return;
        if (!rows) {
          setError("MAPA NO DISPONIBLE");
          setData(null);
          return;
        }

        const candles = parseSwingKlines(rows);
        if (candles.length < 20) {
          setError("SIN VELAS SUFICIENTES");
          setData(null);
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
          halfLifeCandles: HALF_LIFE_CANDLES[timeframe],
          totalOpenInterestUsd:
            openContracts !== null ? openContracts * currentPrice : undefined,
        });
        if (!heatmap) {
          setError("MAPA NO DISPONIBLE");
          setData(null);
          return;
        }

        setData({
          heatmap,
          candles: candles.slice(-MAX_DISPLAY_CANDLES).map((candle) => ({
            time: candle.openTime,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
          })),
          timeframe,
        });
      } catch {
        if (alive) setError("MAPA NO DISPONIBLE");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [symbol, timeframe]);

  const layout = useMemo(() => {
    if (!data || !data.candles.length) return null;
    const { heatmap } = data;
    const candles = data.candles.slice(-visibleCandles);
    if (!candles.length) return null;

    const plotW = box.width - MARGIN.left - MARGIN.right;
    const plotH = box.height - MARGIN.top - MARGIN.bottom;
    if (plotW < 80 || plotH < 80) return null;
    // The profile strip scales with width instead of eating a fixed 104px of
    // a narrow phone, where that was a quarter of the whole chart.
    const profileW = Math.max(52, Math.min(120, box.width * 0.13));

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
    const wantHi = Math.max(tradedHi, ...zonePrices.filter((p) => p <= capHi));
    const wantLo = Math.min(tradedLo, ...zonePrices.filter((p) => p >= capLo));

    const headroom = (wantHi - wantLo) * 0.06;
    const lo = Math.max(0, wantLo - headroom);
    const hi = wantHi + headroom;

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
    const zones = visibleZones
      .map((zone) => ({ ...zone, intensity: (zone.total / rowPeak) * 100 }))
      .filter((zone) => zone.intensity >= 6)
      .sort((a, b) => a.price - b.price);

    return { candles, heatmap, y, x, bodyW, zoneStartX, candleAreaW, profileW, plotH, lo, hi, zones, rowHeight: ROW_HEIGHT };
  }, [data, box, visibleCandles]);

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
    return Array.from({ length: 7 }, (_, i) => {
      const price = lo + step * i;
      return { price, yPos: y(price) };
    });
  }, [layout]);

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
        <div className="liq-symbols">
          {symbols.map((s) => (
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
          {TIMEFRAMES.map((tf) => (
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
              <b>${priceLabel(data.heatmap.currentPrice)}</b>
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
            <span>
              {visibleCandles} velas<i className="liq-pinch">· pellizcá para ampliar</i>
            </span>
            <button onClick={zoomIn} disabled={visibleCandles <= MIN_VISIBLE} aria-label="Acercar">
              +
            </button>
          </div>

          <div
            className="liq-chart-wrap"
            ref={chartRef}
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

              {/* Each zone is drawn twice: a horizontal span running from
                  where it formed to the right edge — the level existed from
                  that moment on — and a profile bar in the right strip
                  carrying its weight, so a zone formed recently is still
                  comparable to an old one.

                  Spans are deliberately faint and thin: they are context for
                  the candles, not the subject. The profile bar on the right
                  is where intensity is meant to be read. */}
              {layout.zones.map((zone) => {
                const yPos = layout.y(zone.price);
                const startX = layout.zoneStartX(zone.formedAt);
                const endX = MARGIN.left + layout.candleAreaW;
                const relative = zone.intensity / 100;
                const thickness = Math.max(1.2, relative * layout.rowHeight);
                const barW = Math.max(2, relative * layout.profileW);
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
                    {endX > startX && zone.intensity >= 45 && (
                      <rect
                        x={startX}
                        y={yPos - thickness / 2}
                        width={endX - startX}
                        height={thickness}
                        fill={intensityColor(zone.intensity, 0.12 + relative * 0.3)}
                      />
                    )}
                    <rect
                      x={endX}
                      y={yPos - thickness / 2}
                      width={barW}
                      height={thickness}
                      fill={intensityColor(zone.intensity, 1)}
                    />
                  </g>
                );
              })}

              {layout.candles.map((candle, i) => {
                const xPos = layout.x(i);
                const up = candle.close >= candle.open;
                const openY = layout.y(candle.open);
                const closeY = layout.y(candle.close);
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

              <line
                x1={MARGIN.left}
                x2={box.width - MARGIN.right}
                y1={layout.y(data.heatmap.currentPrice)}
                y2={layout.y(data.heatmap.currentPrice)}
                className="liq-price-line"
              />

              {/* The same two levels the cards name, drawn where they sit. */}
              {[
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
                  </g>
                ) : null,
              )}

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
                  {timeframe === "1d"
                    ? new Date(tick.time).toLocaleDateString("es-AR", {
                        day: "2-digit",
                        month: "2-digit",
                      })
                    : `${new Date(tick.time).getDate()}/${
                        new Date(tick.time).getMonth() + 1
                      } ${String(new Date(tick.time).getHours()).padStart(2, "0")}h`}
                </text>
              ))}
            </svg>

            <div
              className="liq-price-badge"
              style={{ top: `${(layout.y(data.heatmap.currentPrice) / box.height) * 100}%` }}
            >
              ${priceLabel(data.heatmap.currentPrice)}
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

          {keyLevels.length > 0 && (
            <div className="liq-keys">
              <h4>PUNTOS CLAVE · ESTRUCTURA + LIQUIDACIÓN</h4>
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
            </div>
          )}

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
        </>
      )}
    </section>
  );
}
