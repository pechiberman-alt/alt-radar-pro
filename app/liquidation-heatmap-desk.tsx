"use client";

import { useEffect, useMemo, useState } from "react";
import type { HeatBucket, LiquidationHeatmap } from "@/lib/liquidation-heatmap";

type DisplayCandle = { time: number; open: number; high: number; low: number; close: number };
type ApiResponse = { heatmap: LiquidationHeatmap; candles: DisplayCandle[]; timeframe: string };

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

const priceLabel = (price: number) =>
  price >= 1000
    ? price.toLocaleString("es-AR", { maximumFractionDigits: 0 })
    : price.toLocaleString("es-AR", { maximumFractionDigits: price >= 1 ? 2 : 6 });

const CHART_W = 1000;
const CHART_H = 560;
const MARGIN = { top: 16, right: 78, bottom: 34, left: 10 };
const PLOT_W = CHART_W - MARGIN.left - MARGIN.right;
const PLOT_H = CHART_H - MARGIN.top - MARGIN.bottom;
/** How far the densest possible heat bar reaches into the chart from the right edge. */
const MAX_BAR_FRACTION = 0.62;

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
    let alive = true;
    fetch(`/api/liquidation-heatmap?symbol=${symbol}&timeframe=${timeframe}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!alive) return;
        if (!response.ok) {
          setError("MAPA NO DISPONIBLE");
          setData(null);
          return;
        }
        setData((await response.json()) as ApiResponse);
      })
      .catch(() => alive && setError("MAPA NO DISPONIBLE"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [symbol, timeframe]);

  const layout = useMemo(() => {
    if (!data || !data.candles.length) return null;
    const { candles, heatmap } = data;

    const bucketPrices = heatmap.buckets.map((b) => b.price);
    const candlePrices = candles.flatMap((c) => [c.high, c.low]);
    const minPrice = Math.min(...bucketPrices, ...candlePrices);
    const maxPrice = Math.max(...bucketPrices, ...candlePrices);
    const pad = (maxPrice - minPrice) * 0.04;
    const lo = minPrice - pad;
    const hi = maxPrice + pad;

    const y = (price: number) => MARGIN.top + (1 - (price - lo) / (hi - lo)) * PLOT_H;

    const candleAreaW = PLOT_W * (1 - MAX_BAR_FRACTION * 0.6);
    const slot = candleAreaW / candles.length;
    const bodyW = Math.max(1.5, Math.min(7, slot * 0.62));
    const x = (index: number) => MARGIN.left + slot * index + slot / 2;

    const peakIntensity = Math.max(...heatmap.buckets.map((b) => b.intensity), 1);
    const barMaxW = PLOT_W * MAX_BAR_FRACTION;

    return { candles, heatmap, y, x, bodyW, peakIntensity, barMaxW, lo, hi };
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

      {/* Stated before a single bar renders — this is never confirmed data. */}
      <div className="liq-lag">
        <b>ESTIMACIÓN, NO LIQUIDACIONES CONFIRMADAS</b>
        <span>
          Ningún exchange publica el apalancamiento real de cada posición. Este mapa toma dónde se
          operó (perfil de volumen) y proyecta dónde liquidaría esa posición bajo una distribución
          asumida de apalancamientos. Es un modelo estándar del sector, no una medición — tratalo
          como zonas de interés, no como niveles garantizados.
        </span>
      </div>

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

              {layout.heatmap.buckets.map((bucket) => {
                const barW = (bucket.intensity / layout.peakIntensity) * layout.barMaxW;
                if (barW < 1) return null;
                const yPos = layout.y(bucket.price);
                return (
                  <rect
                    key={bucket.price}
                    x={CHART_W - MARGIN.right - barW}
                    y={yPos - 1.4}
                    width={barW}
                    height={2.8}
                    fill={intensityColor(bucket.intensity, 0.85)}
                    onMouseEnter={() => setHovered(bucket)}
                    onMouseLeave={() =>
                      setHovered((current) => (current === bucket ? null : current))
                    }
                  />
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

          <p className="liq-method">
            <b>Cómo se calcula.</b> {data.heatmap.method} {data.heatmap.assumptions}
          </p>
        </>
      )}
    </section>
  );
}
