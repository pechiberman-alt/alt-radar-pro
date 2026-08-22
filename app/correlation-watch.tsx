"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Candle = { openTime: number; close: number };

type AssetState = {
  candles: Candle[];
  price: number | null;
  change24h: number | null;
  loading: boolean;
  error: string;
};

type Interval = "1h" | "4h" | "1d";

const WATCHLIST = [
  { symbol: "BTCUSDT", label: "BTC" },
  { symbol: "SOLUSDT", label: "SOL" },
  { symbol: "BABYUSDT", label: "BABY" },
  { symbol: "LINKUSDT", label: "LINK" },
  { symbol: "AVAXUSDT", label: "AVAX" },
  { symbol: "UNIUSDT", label: "UNI" },
  { symbol: "PAXGUSDT", label: "ORO · PAXG" },
] as const;

const INTERVALS: { value: Interval; label: string; limit: number }[] = [
  { value: "1h", label: "1H · 7D", limit: 168 },
  { value: "4h", label: "4H · 30D", limit: 180 },
  { value: "1d", label: "1D · 6M", limit: 180 },
];

const BASES = [
  "https://data-api.binance.vision",
  "https://api1.binance.com",
  "https://api.binance.com",
];

async function fetchJson<T>(url: string, timeout = 8_000): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function fetchKlines(symbol: string, interval: Interval, limit: number): Promise<Candle[]> {
  let lastError: unknown;
  for (const base of BASES) {
    try {
      const rows = await fetchJson<unknown[]>(
        `${base}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`,
      );
      if (!Array.isArray(rows) || !rows.length) throw new Error("SIN VELAS");
      return rows
        .filter((row): row is unknown[] => Array.isArray(row) && row.length >= 5)
        .map((row) => ({ openTime: Number(row[0]), close: Number(row[4]) }))
        .filter((candle) => Number.isFinite(candle.close) && candle.close > 0);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("DATA UNAVAILABLE");
}

async function fetchTicker(symbol: string): Promise<{ price: number; change24h: number }> {
  let lastError: unknown;
  for (const base of BASES) {
    try {
      const row = await fetchJson<{ lastPrice: string; priceChangePercent: string }>(
        `${base}/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`,
      );
      const price = Number(row.lastPrice);
      const change24h = Number(row.priceChangePercent);
      if (!Number.isFinite(price) || price <= 0) throw new Error("PRECIO INVÁLIDO");
      return { price, change24h };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("DATA UNAVAILABLE");
}

function returnsOf(candles: Candle[]) {
  const out: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const previous = candles[index - 1].close;
    const current = candles[index].close;
    if (previous > 0) out.push((current - previous) / previous);
  }
  return out;
}

function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 8) return null;
  const sliceA = a.slice(a.length - n);
  const sliceB = b.slice(b.length - n);
  const meanA = sliceA.reduce((sum, value) => sum + value, 0) / n;
  const meanB = sliceB.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denomA = 0;
  let denomB = 0;
  for (let index = 0; index < n; index += 1) {
    const diffA = sliceA[index] - meanA;
    const diffB = sliceB[index] - meanB;
    numerator += diffA * diffB;
    denomA += diffA * diffA;
    denomB += diffB * diffB;
  }
  if (denomA === 0 || denomB === 0) return null;
  return numerator / Math.sqrt(denomA * denomB);
}

function correlationTone(value: number | null) {
  if (value === null) return "na";
  if (value >= 0.7) return "strong-positive";
  if (value >= 0.3) return "positive";
  if (value > -0.3) return "neutral";
  if (value > -0.7) return "negative";
  return "strong-negative";
}

const percentage = (value: number | null) =>
  value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const formatPrice = (value: number | null) => {
  if (value === null) return "—";
  return value >= 1000
    ? `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : value >= 1
      ? `$${value.toFixed(3)}`
      : `$${value.toPrecision(4)}`;
};

export default function CorrelationWatch() {
  const [interval, setInterval_] = useState<Interval>("1h");
  const [assets, setAssets] = useState<Record<string, AssetState>>({});
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    const config = INTERVALS.find((entry) => entry.value === interval) ?? INTERVALS[0];

    async function loadAll() {
      setAssets((current) => {
        const next: Record<string, AssetState> = {};
        for (const item of WATCHLIST) {
          next[item.symbol] = {
            candles: current[item.symbol]?.candles ?? [],
            price: current[item.symbol]?.price ?? null,
            change24h: current[item.symbol]?.change24h ?? null,
            loading: true,
            error: "",
          };
        }
        return next;
      });
      await Promise.all(
        WATCHLIST.map(async (item) => {
          try {
            const [candles, ticker] = await Promise.all([
              fetchKlines(item.symbol, interval, config.limit),
              fetchTicker(item.symbol),
            ]);
            if (requestId.current !== id) return;
            setAssets((current) => ({
              ...current,
              [item.symbol]: {
                candles,
                price: ticker.price,
                change24h: ticker.change24h,
                loading: false,
                error: "",
              },
            }));
          } catch {
            if (requestId.current !== id) return;
            setAssets((current) => ({
              ...current,
              [item.symbol]: {
                candles: [],
                price: null,
                change24h: null,
                loading: false,
                error: "DATA UNAVAILABLE",
              },
            }));
          }
        }),
      );
    }

    void loadAll();
    const timer = window.setInterval(loadAll, 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [interval]);

  const returnsBySymbol = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const item of WATCHLIST) {
      map.set(item.symbol, returnsOf(assets[item.symbol]?.candles ?? []));
    }
    return map;
  }, [assets]);

  const loading = WATCHLIST.some((item) => assets[item.symbol]?.loading);
  const anyError = WATCHLIST.some((item) => assets[item.symbol]?.error);

  return (
    <article className="panel correlation-panel" id="vigilancia">
      <div className="panel-head">
        <div>
          <p className="eyebrow">VIGILANCIA DE CARTERA · CORRELACIÓN HISTÓRICA REAL</p>
          <h2>SOL · BABY · LINK · BTC · AVAX · UNI · ORO</h2>
        </div>
        <span className={anyError ? "badge critical" : "badge"}>
          {loading ? "CARGANDO…" : anyError ? "DATOS PARCIALES" : "EN VIVO"}
        </span>
      </div>

      <div className="correlation-intervals">
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

      <div className="watch-strip">
        {WATCHLIST.map((item) => {
          const state = assets[item.symbol];
          return (
            <div className="watch-tile" key={item.symbol}>
              <span>{item.label}</span>
              {state?.error ? (
                <strong className="muted">DATA UNAVAILABLE</strong>
              ) : (
                <>
                  <strong>{formatPrice(state?.price ?? null)}</strong>
                  <small className={(state?.change24h ?? 0) >= 0 ? "positive" : "negative"}>
                    {percentage(state?.change24h ?? null)} 24H
                  </small>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="correlation-matrix-wrap">
        <table className="correlation-matrix">
          <thead>
            <tr>
              <th />
              {WATCHLIST.map((item) => (
                <th key={item.symbol}>{item.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WATCHLIST.map((row) => (
              <tr key={row.symbol}>
                <th>{row.label}</th>
                {WATCHLIST.map((column) => {
                  if (row.symbol === column.symbol) {
                    return (
                      <td key={column.symbol} className="correlation-cell diagonal">
                        1.00
                      </td>
                    );
                  }
                  const value = pearson(
                    returnsBySymbol.get(row.symbol) ?? [],
                    returnsBySymbol.get(column.symbol) ?? [],
                  );
                  return (
                    <td
                      key={column.symbol}
                      className={`correlation-cell ${correlationTone(value)}`}
                    >
                      {value === null ? "—" : value.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="correlation-legend">
        <span><i className="strong-positive" />≥ 0.70 fuerte positiva</span>
        <span><i className="positive" />0.30 a 0.70 positiva</span>
        <span><i className="neutral" />-0.30 a 0.30 sin relación clara</span>
        <span><i className="negative" />-0.70 a -0.30 negativa</span>
        <span><i className="strong-negative" />≤ -0.70 fuerte negativa</span>
      </div>

      <p className="correlation-footnote">
        Correlación de Pearson sobre retornos reales de velas cerradas (Binance Spot), sin
        look-ahead. XAUUSDT no existe como par Spot en Binance; se usa PAXGUSDT (Pax Gold,
        token respaldado 1:1 por oro físico) como proxy verificable del oro. El sistema no
        estima ni inventa una serie de XAU cuando falta la fuente.
      </p>
    </article>
  );
}
