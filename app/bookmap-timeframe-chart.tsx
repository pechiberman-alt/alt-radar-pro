"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type BrainTimeframe,
  type MarketVenue,
} from "@/lib/market-brain";

type Candle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  closeTime: number;
};

type HorizonPerformance = {
  evaluated: number;
  wins: number;
  winRate: number | null;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  profitFactorInfinite: boolean;
  averageReturn: number | null;
  falseSignalRate: number | null;
  sampleQuality: "DATA INSUFICIENTE" | "MUESTRA BAJA" | "MUESTRA AUDITABLE";
};

type PerformancePayload = {
  generatedAt: string;
  source: string;
  methodology: string;
  horizons: Record<BrainTimeframe, HorizonPerformance>;
};

type Props = {
  symbol: string;
  venue: MarketVenue;
  timeframe: BrainTimeframe;
};

const frameLabel: Record<BrainTimeframe, string> = {
  "5m": "5M",
  "15m": "15M",
  "1h": "1H",
  "4h": "4H",
  "1d": "1D",
};

const SPOT_BASES = ["https://data-api.binance.vision", "https://api.binance.com"];
const FUTURES_BASES = [
  "https://fapi.binance.com",
  "https://fapi1.binance.com",
  "https://fapi2.binance.com",
  "https://fapi3.binance.com",
  "https://fapi4.binance.com",
];

function formatPrice(value: number) {
  if (value >= 1_000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(4);
  return value.toPrecision(6);
}

function compactUsd(value: number) {
  return `$${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(value)}`;
}

function signed(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function ema(values: number[], period: number) {
  if (!values.length) return [];
  const multiplier = 2 / (period + 1);
  return values.reduce<number[]>((result, value, index) => {
    result.push(index === 0 ? value : value * multiplier + result[index - 1] * (1 - multiplier));
    return result;
  }, []);
}

function parseCandles(data: unknown): Candle[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((row): row is unknown[] => Array.isArray(row) && row.length >= 8)
    .map((row) => ({
      openTime: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
      closeTime: Number(row[6]),
      quoteVolume: Number(row[7]),
    }))
    .filter((candle, index, candles) =>
      Number.isFinite(candle.openTime) &&
      candle.closeTime > candle.openTime &&
      candle.high >= Math.max(candle.open, candle.close) &&
      candle.low <= Math.min(candle.open, candle.close) &&
      candle.close > 0 &&
      candle.volume >= 0 &&
      (index === 0 || candle.openTime > candles[index - 1].openTime),
    );
}

async function fetchCandles(
  symbol: string,
  venue: MarketVenue,
  timeframe: BrainTimeframe,
  signal: AbortSignal,
) {
  const bases = venue === "futures" ? FUTURES_BASES : SPOT_BASES;
  const route = venue === "futures" ? "/fapi/v1/klines" : "/api/v3/klines";
  const query = `symbol=${encodeURIComponent(symbol)}&interval=${timeframe}&limit=180`;
  let lastError: unknown;
  for (const base of bases) {
    try {
      const response = await fetch(`${base}${route}?${query}`, { cache: "no-store", signal });
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      const candles = parseCandles(await response.json());
      if (candles.length < 30) throw new Error("HISTORIAL INSUFICIENTE");
      return { candles, source: new URL(base).hostname };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("SIN DATOS");
}

export default function BookmapTimeframeChart({
  symbol,
  venue,
  timeframe,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [source, setSource] = useState("");
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");
  const [updatedAt, setUpdatedAt] = useState("");
  const [size, setSize] = useState({ width: 900, height: 330 });
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);
  const [performance, setPerformance] = useState<PerformancePayload | null>(null);
  const [performanceError, setPerformanceError] = useState(false);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: Math.max(320, entry.contentRect.width),
        height: Math.max(260, entry.contentRect.height),
      });
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const load = async (quiet = false) => {
      if (!quiet) setStatus("loading");
      try {
        const result = await fetchCandles(symbol, venue, timeframe, controller.signal);
        if (!alive) return;
        setCandles(result.candles);
        setSource(result.source);
        setUpdatedAt(new Date().toISOString());
        setStatus("live");
      } catch {
        if (!alive || controller.signal.aborted) return;
        setCandles([]);
        setSource("");
        setStatus("error");
      }
    };
    void load();
    const refresh = window.setInterval(() => void load(true), 30_000);
    return () => {
      alive = false;
      controller.abort();
      window.clearInterval(refresh);
    };
  }, [symbol, venue, timeframe]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch("/api/performance", { cache: "no-store" });
        if (!response.ok) throw new Error();
        const payload = await response.json() as PerformancePayload;
        if (!alive) return;
        setPerformance(payload);
        setPerformanceError(false);
      } catch {
        if (!alive) return;
        setPerformanceError(true);
      }
    };
    void load();
    const refresh = window.setInterval(() => void load(), 60_000);
    return () => {
      alive = false;
      window.clearInterval(refresh);
    };
  }, []);

  const view = useMemo(() => {
    const maximum = Math.max(36, Math.min(110, Math.floor((size.width - 120) / 8)));
    const start = Math.max(0, candles.length - maximum);
    const visible = candles.slice(start);
    const closes = candles.map((candle) => candle.close);
    return {
      start,
      candles: visible,
      ema20: ema(closes, 20).slice(start),
      ema50: ema(closes, 50).slice(start),
    };
  }, [candles, size.width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    context.fillStyle = "#040b09";
    context.fillRect(0, 0, size.width, size.height);

    if (!view.candles.length) {
      context.fillStyle = "#65786e";
      context.font = "10px monospace";
      context.textAlign = "center";
      context.fillText(status === "error" ? "SIN DATOS" : "CARGANDO VELAS REALES…", size.width / 2, size.height / 2);
      return;
    }

    const left = 16;
    const right = 74;
    const top = 18;
    const priceBottom = size.height * 0.75;
    const volumeTop = size.height * 0.79;
    const bottom = size.height - 22;
    const plotWidth = size.width - left - right;
    const highs = view.candles.map((candle) => candle.high);
    const lows = view.candles.map((candle) => candle.low);
    const high = Math.max(...highs);
    const low = Math.min(...lows);
    const padding = Math.max((high - low) * 0.08, high * 0.0001);
    const chartHigh = high + padding;
    const chartLow = low - padding;
    const priceRange = Math.max(chartHigh - chartLow, Number.EPSILON);
    const volumeMax = Math.max(...view.candles.map((candle) => candle.quoteVolume), 1);
    const column = plotWidth / view.candles.length;
    const xFor = (index: number) => left + column * index + column / 2;
    const yFor = (value: number) => top + ((chartHigh - value) / priceRange) * (priceBottom - top);

    context.strokeStyle = "rgba(65,116,93,.24)";
    context.lineWidth = 1;
    context.font = "10px monospace";
    context.textAlign = "left";
    for (let line = 0; line <= 5; line += 1) {
      const y = top + ((priceBottom - top) / 5) * line;
      const label = chartHigh - (priceRange / 5) * line;
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(size.width - right, y);
      context.stroke();
      context.fillStyle = "#60756a";
      context.fillText(formatPrice(label), size.width - right + 7, y + 3);
    }

    view.candles.forEach((candle, index) => {
      const x = xFor(index);
      const bullish = candle.close >= candle.open;
      const color = bullish ? "#31e89a" : "#ff5b68";
      const yOpen = yFor(candle.open);
      const yClose = yFor(candle.close);
      context.strokeStyle = color;
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(x, yFor(candle.high));
      context.lineTo(x, yFor(candle.low));
      context.stroke();
      context.fillRect(
        x - Math.max(1, column * 0.31),
        Math.min(yOpen, yClose),
        Math.max(2, column * 0.62),
        Math.max(1.2, Math.abs(yClose - yOpen)),
      );
      const volumeHeight = ((candle.quoteVolume / volumeMax) * (bottom - volumeTop));
      context.fillStyle = bullish ? "rgba(49,232,154,.34)" : "rgba(255,91,104,.34)";
      context.fillRect(x - Math.max(1, column * 0.3), bottom - volumeHeight, Math.max(2, column * 0.6), volumeHeight);
    });

    const line = (values: number[], color: string) => {
      context.strokeStyle = color;
      context.lineWidth = 1.4;
      context.beginPath();
      values.forEach((value, index) => {
        const x = xFor(index);
        const y = yFor(value);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
    };
    line(view.ema20, "#e9bd57");
    line(view.ema50, "#63aef0");

    const current = view.candles.at(-1)!;
    const currentY = yFor(current.close);
    context.save();
    context.setLineDash([4, 4]);
    context.strokeStyle = current.close >= current.open ? "#3bf0a0" : "#ff6470";
    context.beginPath();
    context.moveTo(left, currentY);
    context.lineTo(size.width - right, currentY);
    context.stroke();
    context.restore();
    context.fillStyle = current.close >= current.open ? "#39e99c" : "#ff6470";
    context.fillRect(size.width - right + 3, currentY - 9, right - 6, 18);
    context.fillStyle = "#04100b";
    context.font = "bold 9px monospace";
    context.fillText(formatPrice(current.close), size.width - right + 7, currentY + 3);

    const labelIndexes = [0, Math.floor(view.candles.length / 3), Math.floor((view.candles.length * 2) / 3), view.candles.length - 1];
    context.fillStyle = "#586c61";
    context.font = "9px monospace";
    labelIndexes.forEach((index) => {
      const date = new Date(view.candles[index].openTime);
      const label = timeframe === "1d"
        ? date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })
        : date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
      context.fillText(label, Math.min(size.width - right - 35, xFor(index) - 12), size.height - 6);
    });

    if (hover && hover.index >= 0 && hover.index < view.candles.length) {
      const x = xFor(hover.index);
      context.save();
      context.setLineDash([3, 3]);
      context.strokeStyle = "rgba(222,239,230,.48)";
      context.beginPath();
      context.moveTo(x, top);
      context.lineTo(x, bottom);
      context.stroke();
      context.restore();
    }
  }, [hover, size, status, timeframe, view]);

  const latest = candles.at(-1) ?? null;
  const change = latest ? ((latest.close / latest.open) - 1) * 100 : null;
  const selectedPerformance = performance?.horizons[timeframe] ?? null;
  const profitFactor = selectedPerformance?.profitFactorInfinite
    ? "∞"
    : selectedPerformance?.profitFactor === null || selectedPerformance?.profitFactor === undefined
      ? "—"
      : selectedPerformance.profitFactor.toFixed(2);
  const hoverCandle = hover ? view.candles[hover.index] : null;

  const movePointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!view.candles.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const left = 16;
    const right = 74;
    const plotWidth = rect.width - left - right;
    if (x < left || x > rect.width - right) {
      setHover(null);
      return;
    }
    const index = Math.max(0, Math.min(view.candles.length - 1, Math.floor(((x - left) / plotWidth) * view.candles.length)));
    setHover({ index, x, y });
  };

  return (
    <section className="bookmap-timeframe-context">
      <header className="tf-context-head">
        <div>
          <p>MARKET STRUCTURE · KLINES REALES</p>
          <h3>{symbol.replace("USDT", "/USDT")} · Contexto temporal</h3>
          <span>Velas históricas verificables sobre el heatmap de profundidad en vivo</span>
        </div>
      </header>

      <div className="tf-market-strip">
        <div><span>OPEN</span><b>{latest ? formatPrice(latest.open) : "—"}</b></div>
        <div><span>HIGH</span><b className="positive">{latest ? formatPrice(latest.high) : "—"}</b></div>
        <div><span>LOW</span><b className="negative">{latest ? formatPrice(latest.low) : "—"}</b></div>
        <div><span>CLOSE</span><b>{latest ? formatPrice(latest.close) : "—"}</b></div>
        <div><span>CAMBIO {frameLabel[timeframe]}</span><b className={(change ?? 0) >= 0 ? "positive" : "negative"}>{signed(change)}</b></div>
        <div><span>VOLUMEN</span><b>{latest ? compactUsd(latest.quoteVolume) : "—"}</b></div>
        <div className="performance-value"><span>WIN RATE {frameLabel[timeframe]}</span><b>{selectedPerformance?.winRate === null || selectedPerformance?.winRate === undefined ? "—" : `${selectedPerformance.winRate.toFixed(1)}%`}</b><small>{selectedPerformance?.evaluated ?? 0} evaluadas</small></div>
        <div className="performance-value"><span>PROFIT FACTOR {frameLabel[timeframe]}</span><b>{profitFactor}</b><small>{performanceError ? "SIN DATOS" : selectedPerformance?.sampleQuality ?? "CARGANDO"}</small></div>
      </div>

      <div className="tf-chart-shell" ref={shellRef}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Gráfico de velas reales ${frameLabel[timeframe]} de ${symbol}`}
          onPointerMove={movePointer}
          onPointerLeave={() => setHover(null)}
        />
        <div className={`tf-data-status ${status}`}><i /> {status === "live" ? "KLINES LIVE" : status === "loading" ? "CARGANDO" : "SIN DATOS"}</div>
        <div className="tf-chart-legend"><span><i className="ema20" /> EMA 20</span><span><i className="ema50" /> EMA 50</span><span><i className="volume" /> VOLUMEN</span></div>
        {hover && hoverCandle && (
          <div className="tf-crosshair-tooltip" style={{ left: `${Math.min(size.width - 190, Math.max(12, hover.x + 12))}px`, top: `${Math.max(14, hover.y - 78)}px` }}>
            <time>{new Date(hoverCandle.openTime).toLocaleString("es-AR")}</time>
            <p><span>O {formatPrice(hoverCandle.open)}</span><span>H {formatPrice(hoverCandle.high)}</span></p>
            <p><span>L {formatPrice(hoverCandle.low)}</span><span>C {formatPrice(hoverCandle.close)}</span></p>
            <b>VOL {compactUsd(hoverCandle.quoteVolume)}</b>
          </div>
        )}
      </div>

      <div className="tf-audit-line">
        <span>FUENTE: Binance {venue === "futures" ? "Futures" : "Spot"} · {source || "SIN DATOS"}</span>
        <span>ACTUALIZADO: {updatedAt ? new Date(updatedAt).toLocaleTimeString() : "—"}</span>
        <b>{selectedPerformance?.sampleQuality ?? "ESTADÍSTICA PENDIENTE"}</b>
        <small>Win Rate y Profit Factor usan señales registradas, no velas elegidas retroactivamente ni operaciones inventadas.</small>
      </div>
    </section>
  );
}
