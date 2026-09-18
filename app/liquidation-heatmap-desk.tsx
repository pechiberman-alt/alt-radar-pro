"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildLiquidationHeatmap,
  type HeatBucket,
  type LiquidationHeatmap,
} from "@/lib/liquidation-heatmap";
import { parseSwingKlines } from "@/lib/swing-entries";

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
  const path = `/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  for (const base of BROWSER_BASES) {
    try {
      const response = await fetch(`${base}${path}`, { signal });
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

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
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

const CHART_W = 1000;
const CHART_H = 580;
const MARGIN = { top: 14, right: 86, bottom: 30, left: 8 };
const PLOT_W = CHART_W - MARGIN.left - MARGIN.right;
const PLOT_H = CHART_H - MARGIN.top - MARGIN.bottom;
/** Right-hand strip where every zone renders its full weight as a profile bar,
 *  so zones that formed recently are still readable next to older ones. */
const PROFILE_W = 104;

export default function LiquidationHeatmapDesk() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState("1h");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState<HeatBucket | null>(null);

  // Loading/error reset lives here, in the handlers that change symbol or
  // timeframe, rather than at the top of the effect below — so the state
  // update that shows the spinner happens in the same tick as the click,
  // not as a synchronous set-state-in-effect firing right after render.
  const selectSymbol = (next: string) => {
    setLoading(true);
    setError("");
    setSymbol(next);
  };
  const selectTimeframe = (next: string) => {
    setLoading(true);
    setError("");
    setTimeframe(next);
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
          candles: candles.slice(-70).map((candle) => ({
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
    const { candles, heatmap } = data;

    // Scale to the traded range, not to the full spread of projected levels.
    // The engine projects ±22% around price; letting that set the axis
    // squashed the candles into a thin band in the middle with dead space
    // above and below. Zones outside the visible window still exist — they
    // are simply off-chart, the way any charting tool handles them.
    const candleHighs = candles.map((c) => c.high);
    const candleLows = candles.map((c) => c.low);
    const tradedHi = Math.max(...candleHighs);
    const tradedLo = Math.min(...candleLows);
    const headroom = (tradedHi - tradedLo) * 0.35;
    const lo = Math.max(0, tradedLo - headroom);
    const hi = tradedHi + headroom;

    const y = (price: number) => MARGIN.top + (1 - (price - lo) / (hi - lo)) * PLOT_H;

    // Candles fill the plot minus the profile strip, so the chart uses its
    // whole width instead of crowding into one side.
    const candleAreaW = PLOT_W - PROFILE_W;
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
    const rowCount = Math.max(40, Math.floor(PLOT_H / ROW_HEIGHT));
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

    return { candles, heatmap, y, x, bodyW, zoneStartX, candleAreaW, lo, hi, zones, rowHeight: ROW_HEIGHT };
  }, [data]);

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
    const { candles, x } = layout;
    const step = Math.max(1, Math.floor(candles.length / 5));
    return candles
      .map((c, i) => ({ time: c.time, xPos: x(i) }))
      .filter((_, i) => i % step === 0);
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
          {SYMBOLS.map((s) => (
            <button key={s} className={s === symbol ? "active" : ""} onClick={() => selectSymbol(s)}>
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

          <div className="liq-chart-wrap">
            <svg
              viewBox={`0 0 ${CHART_W} ${CHART_H}`}
              className="liq-svg"
              role="img"
              aria-label="Mapa de liquidaciones estimado"
            >
              {priceTicks.map((tick) => (
                <line
                  key={tick.price}
                  x1={MARGIN.left}
                  x2={CHART_W - MARGIN.right}
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
                const barW = Math.max(2, relative * PROFILE_W);
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
                    {endX > startX && (
                      <rect
                        x={startX}
                        y={yPos - thickness / 2}
                        width={endX - startX}
                        height={thickness}
                        fill={intensityColor(zone.intensity, 0.06 + relative * 0.22)}
                      />
                    )}
                    <rect
                      x={endX}
                      y={yPos - thickness / 2}
                      width={barW}
                      height={thickness}
                      fill={intensityColor(zone.intensity, 0.9)}
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
                x2={CHART_W - MARGIN.right}
                y1={layout.y(data.heatmap.currentPrice)}
                y2={layout.y(data.heatmap.currentPrice)}
                className="liq-price-line"
              />

              {priceTicks.map((tick) => (
                <text
                  key={tick.price}
                  x={CHART_W - MARGIN.right + 8}
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
                  y={CHART_H - 12}
                  className="liq-axis-label liq-axis-x"
                >
                  {new Date(tick.time).toLocaleDateString("es-AR", {
                    day: "2-digit",
                    month: "2-digit",
                  })}
                </text>
              ))}
            </svg>

            <div
              className="liq-price-badge"
              style={{ top: `${(layout.y(data.heatmap.currentPrice) / CHART_H) * 100}%` }}
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
