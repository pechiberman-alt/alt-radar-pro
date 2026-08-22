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

/**
 * Slope of the asset against BTC: how much it historically amplifies (or damps)
 * a BTC move. Beta 1.8 means a 1% BTC candle has come with ~1.8% here.
 */
function beta(assetReturns: number[], btcReturns: number[]): number | null {
  const n = Math.min(assetReturns.length, btcReturns.length);
  if (n < 8) return null;
  const asset = assetReturns.slice(assetReturns.length - n);
  const btc = btcReturns.slice(btcReturns.length - n);
  const meanAsset = asset.reduce((sum, value) => sum + value, 0) / n;
  const meanBtc = btc.reduce((sum, value) => sum + value, 0) / n;
  let covariance = 0;
  let varianceBtc = 0;
  for (let index = 0; index < n; index += 1) {
    const diffBtc = btc[index] - meanBtc;
    covariance += (asset[index] - meanAsset) * diffBtc;
    varianceBtc += diffBtc * diffBtc;
  }
  if (varianceBtc === 0) return null;
  return covariance / varianceBtc;
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

  const insights = useMemo(() => {
    const btcReturns = returnsBySymbol.get("BTCUSDT") ?? [];
    const gold = "PAXGUSDT";
    const crypto = WATCHLIST.filter(
      (item) => item.symbol !== gold && item.symbol !== "BTCUSDT",
    );

    const betas = crypto
      .map((item) => ({
        label: item.label as string,
        value: beta(returnsBySymbol.get(item.symbol) ?? [], btcReturns),
      }))
      .filter((entry): entry is { label: string; value: number } => entry.value !== null)
      .sort((left, right) => right.value - left.value);

    // Every distinct crypto pair, to find what actually moves together.
    const cryptoSymbols = WATCHLIST.filter((item) => item.symbol !== gold);
    const pairs: { label: string; value: number }[] = [];
    for (let i = 0; i < cryptoSymbols.length; i += 1) {
      for (let j = i + 1; j < cryptoSymbols.length; j += 1) {
        const value = pearson(
          returnsBySymbol.get(cryptoSymbols[i].symbol) ?? [],
          returnsBySymbol.get(cryptoSymbols[j].symbol) ?? [],
        );
        if (value !== null) {
          pairs.push({ label: `${cryptoSymbols[i].label} · ${cryptoSymbols[j].label}`, value });
        }
      }
    }
    pairs.sort((left, right) => right.value - left.value);

    const averagePair = pairs.length
      ? pairs.reduce((sum, pair) => sum + pair.value, 0) / pairs.length
      : null;

    const goldReturns = returnsBySymbol.get(gold) ?? [];
    const goldVsBtc = pearson(goldReturns, btcReturns);

    return {
      highestBeta: betas[0] ?? null,
      lowestBeta: betas[betas.length - 1] ?? null,
      tightestPair: pairs[0] ?? null,
      loosestPair: pairs[pairs.length - 1] ?? null,
      averagePair,
      goldVsBtc,
    };
  }, [returnsBySymbol]);

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

      <div className="key-readings">
        <p className="key-readings-title">LECTURAS CLAVE</p>
        <div className="key-grid">
          <div>
            <span>MAYOR BETA vs BTC</span>
            <b>
              {insights.highestBeta
                ? `${insights.highestBeta.label} ${insights.highestBeta.value.toFixed(2)}×`
                : "—"}
            </b>
            <small>Amplifica más cada movimiento de BTC</small>
          </div>
          <div>
            <span>MENOR BETA vs BTC</span>
            <b>
              {insights.lowestBeta
                ? `${insights.lowestBeta.label} ${insights.lowestBeta.value.toFixed(2)}×`
                : "—"}
            </b>
            <small>El más amortiguado del bloque</small>
          </div>
          <div>
            <span>PAR MÁS ACOPLADO</span>
            <b className={insights.tightestPair && insights.tightestPair.value >= 0.7 ? "negative" : ""}>
              {insights.tightestPair
                ? `${insights.tightestPair.label} ${insights.tightestPair.value.toFixed(2)}`
                : "—"}
            </b>
            <small>Operarlos juntos no diversifica</small>
          </div>
          <div>
            <span>PAR MÁS DESACOPLADO</span>
            <b className={insights.loosestPair && insights.loosestPair.value < 0.3 ? "positive" : ""}>
              {insights.loosestPair
                ? `${insights.loosestPair.label} ${insights.loosestPair.value.toFixed(2)}`
                : "—"}
            </b>
            <small>El par con mayor lectura independiente</small>
          </div>
          <div>
            <span>ACOPLE MEDIO DEL BLOQUE</span>
            <b className={insights.averagePair !== null && insights.averagePair >= 0.7 ? "negative" : ""}>
              {insights.averagePair === null ? "—" : insights.averagePair.toFixed(2)}
            </b>
            <small>
              {insights.averagePair === null
                ? "Muestra insuficiente"
                : insights.averagePair >= 0.7
                  ? "Riesgo concentrado: el bloque se mueve como un solo activo"
                  : insights.averagePair >= 0.4
                    ? "Acople moderado entre criptos"
                    : "Bloque disperso: hay lecturas independientes"}
            </small>
          </div>
          <div>
            <span>ORO vs BTC</span>
            <b
              className={
                insights.goldVsBtc === null
                  ? ""
                  : insights.goldVsBtc < 0.2
                    ? "positive"
                    : "negative"
              }
            >
              {insights.goldVsBtc === null ? "—" : insights.goldVsBtc.toFixed(2)}
            </b>
            <small>
              {insights.goldVsBtc === null
                ? "Muestra insuficiente"
                : insights.goldVsBtc < 0.2
                  ? "Oro desacoplado: sirve como refugio frente a esta cartera"
                  : "Oro acompañando a cripto: no está cubriendo el riesgo"}
            </small>
          </div>
        </div>
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
