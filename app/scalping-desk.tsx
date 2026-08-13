"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MarketAsset } from "@/lib/radar";
import type { ScalpSignal } from "@/lib/scalping-engine";

type Props = {
  market: MarketAsset[];
  riskScore: number | null;
  killSwitch: boolean;
  altseasonScore: number | null;
  minimumQuoteVolume: number;
};

type Payload = {
  ok: boolean;
  generatedAt: string;
  scanned: number;
  unavailable: number;
  sources: string[];
  signals: ScalpSignal[];
  error?: string;
};

const SPOT_BASES = ["https://data-api.binance.vision", "https://api.binance.com"];

function formatPrice(value: number) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_000) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (value >= 1) return `$${value.toFixed(4)}`;
  return `$${value.toPrecision(6)}`;
}

function pct(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function compact(value: number) {
  return `$${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(value)}`;
}

async function directKlines(symbol: string, interval: "5m" | "15m", signal: AbortSignal) {
  let lastError: unknown;
  for (const base of SPOT_BASES) {
    try {
      const response = await fetch(
        `${base}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=120`,
        { cache: "no-store", signal },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("DATA UNAVAILABLE");
}

async function buildDirectSnapshots(assets: MarketAsset[], signal: AbortSignal) {
  const entries = await Promise.allSettled(assets.map(async (asset) => {
    const [five, fifteen] = await Promise.all([
      directKlines(asset.symbol, "5m", signal),
      directKlines(asset.symbol, "15m", signal),
    ]);
    return [asset.symbol, { "5m": five, "15m": fifteen }] as const;
  }));
  return Object.fromEntries(entries.flatMap((entry) =>
    entry.status === "fulfilled" ? [entry.value] : [],
  ));
}

function assetMomentum(asset: MarketAsset) {
  return Math.abs(asset.change5m ?? 0) * 2.4 +
    Math.abs(asset.change15m ?? 0) * 1.4 +
    Math.abs(asset.change1h ?? 0) * 0.35 +
    Math.log10(Math.max(asset.quoteVolume, 1)) * 0.05;
}

export default function ScalpingDesk({
  market,
  riskScore,
  killSwitch,
  altseasonScore,
  minimumQuoteVolume,
}: Props) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [auto, setAuto] = useState(true);
  const [selected, setSelected] = useState<ScalpSignal | null>(null);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(0);

  const candidates = useMemo(() => {
    const majors = market.filter((asset) => ["BTCUSDT", "ETHUSDT"].includes(asset.symbol));
    const liquid = market
      .filter((asset) => !["BTCUSDT", "ETHUSDT"].includes(asset.symbol))
      .filter((asset) => asset.quoteVolume >= Math.max(5_000_000, minimumQuoteVolume))
      .sort((left, right) => assetMomentum(right) - assetMomentum(left))
      .slice(0, 10);
    return [...majors, ...liquid].slice(0, 12);
  }, [market, minimumQuoteVolume]);

  const refresh = useCallback(async () => {
    if (!candidates.length || killSwitch) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 18_000);
    setStatus("loading");
    try {
      let snapshots: Record<string, unknown> = {};
      try {
        snapshots = await buildDirectSnapshots(candidates, controller.signal);
      } catch {
        snapshots = {};
      }
      const response = await fetch("/api/scalping", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          assets: candidates,
          snapshots,
          context: { riskScore, killSwitch, altseasonScore, minimumQuoteVolume },
        }),
      });
      const next = await response.json() as Payload;
      if (!response.ok || !next.signals?.length) throw new Error(next.error ?? "DATA UNAVAILABLE");
      setPayload(next);
      setSelected((current) =>
        current
          ? next.signals.find(
              (signal) => signal.symbol === current.symbol && signal.status !== "NO SIGNAL",
            ) ?? next.signals.find((signal) => signal.status !== "NO SIGNAL") ?? null
          : next.signals.find((signal) => signal.status !== "NO SIGNAL") ?? null,
      );
      setError("");
      setStatus("ready");
    } catch (loadError) {
      if (controller.signal.aborted) setError("Tiempo de espera agotado; reintenta el ciclo.");
      else setError(loadError instanceof Error ? loadError.message : "DATA UNAVAILABLE");
      setStatus("error");
    } finally {
      window.clearTimeout(timeout);
    }
  }, [altseasonScore, candidates, killSwitch, minimumQuoteVolume, riskScore]);

  useEffect(() => {
    if (!auto || killSwitch) return;
    const boot = window.setTimeout(() => void refresh(), 900);
    const interval = window.setInterval(() => void refresh(), 5 * 60_000);
    return () => {
      window.clearTimeout(boot);
      window.clearInterval(interval);
    };
  }, [auto, killSwitch, refresh]);

  useEffect(() => {
    const tick = window.setTimeout(() => setClock(Date.now()), 0);
    const interval = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => {
      window.clearTimeout(tick);
      window.clearInterval(interval);
    };
  }, []);

  const signals = payload?.signals ?? [];
  const qualified = signals.filter((signal) => signal.status !== "NO SIGNAL");
  const triggers = signals.filter((signal) => signal.status === "TRIGGER").length;
  const setups = signals.filter((signal) => signal.status === "SETUP").length;
  const visible = signals.slice(0, 10);
  const remainingSeconds = selected
    ? Math.max(0, Math.ceil((Date.parse(selected.expiresAt) - clock) / 1_000))
    : 0;

  return (
    <section className="scalp-desk" id="scalping" aria-label="Modo scalping profesional">
      <header className="scalp-header">
        <div className="scalp-identity">
          <div className="scalp-pulse"><i /><i /><i /></div>
          <div>
            <p>ALT RADAR EXECUTION LAB · 5M / 15M</p>
            <h2>Modo Scalping</h2>
            <span>Confluencia rápida con riesgo estructural y filtro anti-FOMO</span>
          </div>
        </div>
        <div className="scalp-controls">
          <span className={`scalp-state ${killSwitch ? "paused" : status}`}>
            <i /> {killSwitch ? "PAUSADO POR RIESGO" : status === "loading" ? "ANALIZANDO" : status === "error" ? "DEGRADADO" : "MOTOR ACTIVO"}
          </span>
          <button className={auto ? "enabled" : ""} onClick={() => setAuto((value) => !value)}>
            {auto ? "● AUTO 5M" : "○ MANUAL"}
          </button>
          <button onClick={() => void refresh()} disabled={status === "loading" || killSwitch}>↻ ESCANEAR</button>
        </div>
      </header>

      <div className="scalp-command">
        <div><span>UNIVERSO DEL CICLO</span><b>{candidates.length} PARES LÍQUIDOS</b></div>
        <div><span>TRIGGERS</span><b className="positive">{triggers}</b></div>
        <div><span>SETUPS</span><b>{setups}</b></div>
        <div><span>MOTOR</span><b>LOCAL · 0 TOKENS</b></div>
        <div><span>FUENTE</span><b>BINANCE REAL</b></div>
      </div>

      {killSwitch ? (
        <div className="scalp-empty danger">
          <b>🔴 NUEVOS SCALPS PAUSADOS</b>
          <span>El kill switch geopolítico bloquea nuevas señales. No se ignora el régimen macro.</span>
        </div>
      ) : status === "error" && !payload ? (
        <div className="scalp-empty">
          <b>SCALPING DATA UNAVAILABLE</b>
          <span>{error}. No se generan niveles con datos incompletos.</span>
          <button onClick={() => void refresh()}>REINTENTAR</button>
        </div>
      ) : (
        <div className="scalp-workspace">
          <article className="scalp-primary">
            {selected ? (
              <>
                <div className="scalp-primary-head">
                  <div>
                    <span>OPORTUNIDAD SELECCIONADA</span>
                    <h3>{selected.symbol.replace("USDT", "")}<small>/USDT</small></h3>
                  </div>
                  <div className={`scalp-score ${selected.status.toLowerCase().replace(" ", "-")}`}>
                    <strong>{selected.score}</strong><span>/100</span><small>{selected.status}</small>
                  </div>
                </div>
                {selected.extended && <div className="scalp-fomo">⚠ MOVIMIENTO EXTENDIDO · NO PERSEGUIR</div>}
                <div className="scalp-direction">
                  <span className={`side-pill ${selected.side.toLowerCase()}`}>{selected.side}</span>
                  <b>{selected.timeframe}</b>
                  <small>VENCE EN {Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, "0")}</small>
                </div>
                <div className="scalp-levels">
                  <div className="entry"><span>ENTRADA</span><b>{formatPrice(selected.entryLow)} – {formatPrice(selected.entryHigh)}</b></div>
                  <div className="stop"><span>INVALIDACIÓN</span><b>{formatPrice(selected.stop)}</b></div>
                  <div><span>TP1 · 1.2R</span><b>{formatPrice(selected.target1)}</b></div>
                  <div><span>TP2 · 1.8R</span><b>{formatPrice(selected.target2)}</b></div>
                  <div><span>TP3 · 2.6R</span><b>{formatPrice(selected.target3)}</b></div>
                  <div><span>R:R MÁX.</span><b>1 : {selected.riskReward.toFixed(1)}</b></div>
                </div>
                <div className="scalp-metrics">
                  <div><span>5M</span><b className={(selected.change5m ?? 0) >= 0 ? "positive" : "negative"}>{pct(selected.change5m)}</b></div>
                  <div><span>15M</span><b className={(selected.change15m ?? 0) >= 0 ? "positive" : "negative"}>{pct(selected.change15m)}</b></div>
                  <div><span>REL VOL</span><b>{selected.relativeVolume?.toFixed(2) ?? "—"}×</b></div>
                  <div><span>SPREAD</span><b>{pct(selected.spreadPct, 3)}</b></div>
                  <div><span>RSI 5M</span><b>{selected.rsi5m?.toFixed(1) ?? "—"}</b></div>
                  <div><span>ATR 5M</span><b>{pct(selected.atrPct)}</b></div>
                </div>
                <div className="scalp-trace">
                  <div>
                    <span>CONFIRMACIONES</span>
                    {selected.reasons.filter((reason) => reason.points >= 7).slice(0, 6).map((reason) => (
                      <b key={reason.label}>✓ {reason.label}<em>+{reason.points}</em></b>
                    ))}
                  </div>
                  <div>
                    <span>RIESGOS / BLOQUEOS</span>
                    {selected.penalties.length ? selected.penalties.slice(0, 6).map((penalty) => (
                      <b key={penalty.label}>– {penalty.label}<em>{penalty.points}</em></b>
                    )) : <b>Sin penalización crítica en la muestra actual</b>}
                  </div>
                </div>
              </>
            ) : status === "loading" || status === "idle" ? (
              <div className="scalp-loading">ANALIZANDO VELAS CERRADAS…</div>
            ) : (
              <div className="scalp-no-entry">
                <i>◎</i>
                <b>NO HAY ENTRADA SCALPING VÁLIDA</b>
                <span>Ningún activo superó todas las confirmaciones 5M/15M. No se muestran entrada, stop ni objetivos sin una señal calificada.</span>
              </div>
            )}
          </article>

          <aside className="scalp-radar-list">
            <div className="scalp-list-head"><span>RADAR DEL CICLO</span><b>{payload?.generatedAt ? new Date(payload.generatedAt).toLocaleTimeString() : "—"}</b></div>
            {visible.map((signal, index) => (
              <button
                key={signal.symbol}
                className={`${selected?.symbol === signal.symbol ? "selected" : ""} ${signal.status.toLowerCase().replace(" ", "-")}`}
                onClick={() => signal.status !== "NO SIGNAL" && setSelected(signal)}
                disabled={signal.status === "NO SIGNAL"}
              >
                <em>{String(index + 1).padStart(2, "0")}</em>
                <div><b>{signal.symbol.replace("USDT", "")}<small>/USDT</small></b><span>{signal.side} · {signal.status}</span></div>
                <strong>{signal.score}<small>/100</small></strong>
                <i style={{ width: `${signal.score}%` }} />
              </button>
            ))}
            {!visible.length && <div className="scalp-loading">ESPERANDO PRIMER CICLO…</div>}
          </aside>
        </div>
      )}

      {!killSwitch && status === "ready" && !qualified.length && (
        <div className="scalp-empty compact-state">
          <b>NO HAY SCALPS DE ALTA CONVICCIÓN</b>
          <span>El motor revisó {payload?.scanned ?? 0} activos y no forzará una operación.</span>
        </div>
      )}

      <footer className="scalp-footer">
        <span>Último ciclo: {payload?.generatedAt ? new Date(payload.generatedAt).toLocaleString() : "—"}</span>
        <span>Volumen: {selected ? compact(selected.quoteVolume) : "—"} / 24H</span>
        <span>Fuente: {selected?.source ?? "Binance Spot public API"}</span>
        <b>Escenarios probabilísticos; no garantizan resultado ni ejecutan órdenes.</b>
      </footer>
    </section>
  );
}
