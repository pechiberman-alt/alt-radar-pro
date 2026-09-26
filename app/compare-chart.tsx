"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchKlineRows } from "./binance-klines";

type Candle = {
  openTime: number;
  close: number;
};

type SeriesState = {
  symbol: string;
  candles: Candle[];
  loading: boolean;
  error: string;
};

type Interval = "15m" | "1h" | "4h" | "1d";

const INTERVALS: { value: Interval; label: string; limit: number }[] = [
  { value: "15m", label: "15M · 24H", limit: 96 },
  { value: "1h", label: "1H · 7D", limit: 168 },
  { value: "4h", label: "4H · 30D", limit: 180 },
  { value: "1d", label: "1D · 6M", limit: 180 },
];

const COLORS = ["var(--green)", "var(--cyan)", "var(--amber)"] as const;

const assetName = (symbol: string) => symbol.replace("USDT", "");

async function fetchKlines(symbol: string, interval: Interval, limit: number): Promise<Candle[]> {
  const rows = await fetchKlineRows(symbol, interval, limit);
  return rows
    .filter((row): row is unknown[] => Array.isArray(row) && row.length >= 5)
    .map((row) => ({ openTime: Number(row[0]), close: Number(row[4]) }))
    .filter((candle) => Number.isFinite(candle.close) && candle.close > 0);
}

function normalize(candles: Candle[]) {
  const base = candles[0]?.close;
  if (!base) return [] as { time: number; pct: number }[];
  return candles.map((candle) => ({
    time: candle.openTime,
    pct: ((candle.close - base) / base) * 100,
  }));
}

function CompareLine({
  series,
}: {
  series: { symbol: string; points: { time: number; pct: number }[]; color: string }[];
}) {
  const width = 960;
  const height = 300;
  const padding = 30;
  const all = series.flatMap((entry) => entry.points.map((point) => point.pct));
  if (!all.length) {
    return (
      <div className="compare-empty">
        <b>SIN DATOS</b>
        <span>No se pudieron cargar velas para los activos seleccionados.</span>
      </div>
    );
  }
  const maxAbs = Math.max(1, ...all.map((value) => Math.abs(value)));
  const yFor = (pct: number) =>
    height / 2 - (pct / maxAbs) * (height / 2 - padding);
  const xFor = (index: number, total: number) =>
    padding + (index / Math.max(1, total - 1)) * (width - padding * 2);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="compare-svg" preserveAspectRatio="none">
      <line x1={padding} x2={width - padding} y1={height / 2} y2={height / 2} className="zero-line" />
      {[0.25, 0.75].map((fraction) => (
        <line
          key={fraction}
          x1={padding}
          x2={width - padding}
          y1={height * fraction}
          y2={height * fraction}
          className="grid-line"
        />
      ))}
      {series.map((entry) => {
        if (!entry.points.length) return null;
        const path = entry.points
          .map((point, index) => {
            const x = xFor(index, entry.points.length);
            const y = yFor(point.pct);
            return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
          })
          .join(" ");
        const last = entry.points[entry.points.length - 1];
        const lastX = xFor(entry.points.length - 1, entry.points.length);
        const lastY = yFor(last.pct);
        return (
          <g key={entry.symbol}>
            <path d={path} fill="none" stroke={entry.color} strokeWidth={1.6} />
            <circle cx={lastX} cy={lastY} r={3} fill={entry.color} />
          </g>
        );
      })}
    </svg>
  );
}

export default function CompareChart({
  symbols,
  defaultInterval = "1h",
}: {
  symbols: string[];
  defaultInterval?: Interval;
}) {
  const [interval, setInterval_] = useState<Interval>(defaultInterval);
  const appliedProfileInterval = useRef(defaultInterval);

  // The trading profile sets the horizon, but a manual pick afterwards stands.
  useEffect(() => {
    if (appliedProfileInterval.current === defaultInterval) return;
    appliedProfileInterval.current = defaultInterval;
    setInterval_(defaultInterval);
  }, [defaultInterval]);
  const [picks, setPicks] = useState<string[]>(["SOLUSDT", "BTCUSDT"]);
  const [states, setStates] = useState<Record<string, SeriesState>>({});
  const requestId = useRef(0);

  const options = useMemo(() => {
    const set = new Set(["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", ...symbols]);
    return [...set].sort();
  }, [symbols]);

  useEffect(() => {
    const id = ++requestId.current;
    const config = INTERVALS.find((entry) => entry.value === interval) ?? INTERVALS[1];

    async function loadAll() {
      setStates((current) => {
        const next = { ...current };
        for (const symbol of picks) {
          next[symbol] = { symbol, candles: next[symbol]?.candles ?? [], loading: true, error: "" };
        }
        return next;
      });
      await Promise.all(
        picks.map(async (symbol) => {
          try {
            const candles = await fetchKlines(symbol, interval, config.limit);
            if (requestId.current !== id) return;
            setStates((current) => ({
              ...current,
              [symbol]: { symbol, candles, loading: false, error: "" },
            }));
          } catch {
            if (requestId.current !== id) return;
            setStates((current) => ({
              ...current,
              [symbol]: { symbol, candles: [], loading: false, error: "SIN DATOS" },
            }));
          }
        }),
      );
    }

    void loadAll();
  }, [picks, interval]);

  const series = picks.map((symbol, index) => ({
    symbol,
    color: COLORS[index % COLORS.length],
    points: normalize(states[symbol]?.candles ?? []),
  }));
  const loading = picks.some((symbol) => states[symbol]?.loading);
  const anyError = picks.some((symbol) => states[symbol]?.error);

  const updatePick = (index: number, symbol: string) => {
    setPicks((current) => current.map((value, position) => (position === index ? symbol : value)));
  };

  const addPick = () => {
    if (picks.length >= 3) return;
    const next = options.find((symbol) => !picks.includes(symbol)) ?? options[0];
    setPicks((current) => [...current, next]);
  };

  const removePick = (index: number) => {
    if (picks.length <= 2) return;
    setPicks((current) => current.filter((_, position) => position !== index));
  };

  return (
    <article className="panel compare-panel" id="comparador">
      <div className="panel-head">
        <div>
          <p className="eyebrow">RENDIMIENTO RELATIVO · MISMA VENTANA TEMPORAL</p>
          <h2>Comparador de activos</h2>
        </div>
        <span className={anyError ? "badge critical" : "badge"}>
          {loading ? "CARGANDO…" : anyError ? "DATOS PARCIALES" : "EN VIVO"}
        </span>
      </div>

      <div className="compare-controls">
        <div className="compare-picks">
          {picks.map((symbol, index) => (
            <div className="compare-pick" key={index}>
              <i style={{ background: COLORS[index % COLORS.length] }} />
              <select value={symbol} onChange={(event) => updatePick(index, event.target.value)}>
                {options.map((option) => (
                  <option key={option} value={option}>
                    {assetName(option)}/USDT
                  </option>
                ))}
              </select>
              {picks.length > 2 && (
                <button className="compare-remove" onClick={() => removePick(index)} aria-label="Quitar activo">
                  ×
                </button>
              )}
            </div>
          ))}
          {picks.length < 3 && (
            <button className="compare-add" onClick={addPick}>
              + AGREGAR ACTIVO
            </button>
          )}
        </div>
        <div className="compare-intervals">
          {INTERVALS.map((entry) => (
            <button
              key={entry.value}
              className={interval === entry.value ? "active" : ""}
              onClick={() => setInterval_(entry.value)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      <div className="compare-chart-wrap">
        <CompareLine series={series} />
      </div>

      <div className="compare-legend">
        {picks.map((symbol, index) => {
          const point = series[index]?.points.at(-1);
          const state = states[symbol];
          return (
            <div key={symbol} className="compare-legend-item">
              <i style={{ background: COLORS[index % COLORS.length] }} />
              <b>{assetName(symbol)}</b>
              {state?.error ? (
                <span className="muted">SIN DATOS</span>
              ) : (
                <span className={point && point.pct >= 0 ? "positive" : "negative"}>
                  {point ? `${point.pct >= 0 ? "+" : ""}${point.pct.toFixed(2)}%` : "—"}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <p className="compare-footnote">
        Normalizado a variación porcentual desde el inicio de la ventana visible, con velas reales
        de Binance Spot. No incluye dominancia por activo (SOL.D, ETH.D, etc.) porque no existe una
        fuente pública gratuita confiable para esa serie; el sistema no la reemplaza con estimaciones.
      </p>
    </article>
  );
}
