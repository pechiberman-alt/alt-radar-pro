"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BRAIN_TIMEFRAMES,
  type BrainTimeframe,
  type MarketBrainPayload,
  type MarketVenue,
} from "@/lib/market-brain";

type AltseasonContext = {
  score: number | null;
  raw: number | null;
  adjustment: number;
  state: string;
};

type LiveLiquidation = {
  time: number;
  side: "LONG" | "SHORT";
  price: number;
  notional: number;
};

type MarketBrainProps = {
  symbol: string;
  venue: MarketVenue;
  currentPrice: number;
  winner: string;
  delta: number;
  imbalance: number;
  cvd: number;
  altseason: AltseasonContext;
  liveLiquidations: LiveLiquidation[];
  timeframe: BrainTimeframe;
  onTimeframeChange: (timeframe: BrainTimeframe) => void;
  onDerivativesChange?: (derivatives: MarketBrainPayload["derivatives"]) => void;
};

type ChatEntry = { id: string; question: string; answer: string; at: string };
type DirectSnapshot = {
  klines: Partial<Record<BrainTimeframe, unknown>>;
  derivatives: {
    premium: unknown;
    interest: unknown;
    history: unknown;
    taker: unknown;
    accounts: unknown;
  };
};

const frameLabel: Record<BrainTimeframe, string> = {
  "5m": "5M",
  "15m": "15M",
  "1h": "1H",
  "4h": "4H",
  "1d": "1D",
};

const browserSpotBases = ["https://data-api.binance.vision", "https://api.binance.com"];
const browserFuturesBases = [
  "https://fapi.binance.com",
  "https://fapi1.binance.com",
  "https://fapi2.binance.com",
  "https://fapi3.binance.com",
  "https://fapi4.binance.com",
];

async function directJson(bases: string[], path: string, signal: AbortSignal) {
  let lastError: unknown;
  for (const base of bases) {
    try {
      const response = await fetch(`${base}${path}`, { cache: "no-store", signal });
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("DATA UNAVAILABLE");
}

async function directOptional(bases: string[], path: string, signal: AbortSignal) {
  try {
    return await directJson(bases, path, signal);
  } catch {
    return null;
  }
}

async function loadDirectSnapshot(
  symbol: string,
  venue: MarketVenue,
  timeframe: BrainTimeframe,
  signal: AbortSignal,
): Promise<DirectSnapshot> {
  const encoded = encodeURIComponent(symbol);
  const klineSettled = await Promise.allSettled(BRAIN_TIMEFRAMES.map(async (frame) => {
    const path = venue === "futures"
      ? `/fapi/v1/klines?symbol=${encoded}&interval=${frame}&limit=210`
      : `/api/v3/klines?symbol=${encoded}&interval=${frame}&limit=210`;
    const data = await directJson(venue === "futures" ? browserFuturesBases : browserSpotBases, path, signal);
    return [frame, data] as const;
  }));
  const klines: Partial<Record<BrainTimeframe, unknown>> = {};
  klineSettled.forEach((result) => {
    if (result.status === "fulfilled") klines[result.value[0]] = result.value[1];
  });
  if (!klines[timeframe]) throw new Error("BINANCE DIRECT DATA UNAVAILABLE");
  const period = encodeURIComponent(timeframe);
  const [premium, interest, history, taker, accounts] = await Promise.all([
    directOptional(browserFuturesBases, `/fapi/v1/premiumIndex?symbol=${encoded}`, signal),
    directOptional(browserFuturesBases, `/fapi/v1/openInterest?symbol=${encoded}`, signal),
    directOptional(browserFuturesBases, `/futures/data/openInterestHist?symbol=${encoded}&period=${period}&limit=3`, signal),
    directOptional(browserFuturesBases, `/futures/data/takerlongshortRatio?symbol=${encoded}&period=${period}&limit=3`, signal),
    directOptional(browserFuturesBases, `/futures/data/globalLongShortAccountRatio?symbol=${encoded}&period=${period}&limit=3`, signal),
  ]);
  return { klines, derivatives: { premium, interest, history, taker, accounts } };
}

function price(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "DATA UNAVAILABLE";
  if (value >= 1_000) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (value >= 1) return `$${value.toFixed(4)}`;
  return `$${value.toPrecision(6)}`;
}

function pct(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function multiple(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}×`;
}

function usd(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `$${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(value)}`;
}

function biasText(value: "BULLISH" | "BEARISH" | "NEUTRAL") {
  return value === "BULLISH" ? "ALCISTA" : value === "BEARISH" ? "BAJISTA" : "NEUTRAL";
}

function buildAnswer(
  question: string,
  brain: MarketBrainPayload,
  context: Omit<MarketBrainProps, "symbol" | "venue">,
) {
  const selected = brain.selected;
  const normalized = question.toLocaleLowerCase("es");
  const stamp = new Date(brain.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const evidence = `Lectura ${brain.selectedTimeframe.toUpperCase()} · ${stamp} · ${brain.sources.join(" + ") || "fuente no disponible"}.`;
  if (!selected) {
    return `No puedo emitir análisis para ${brain.symbol}: DATA UNAVAILABLE. No completaré los valores faltantes con estimaciones. ${evidence}`;
  }

  if (normalized.includes("memoria") || normalized.includes("aprend") || normalized.includes("segur") || normalized.includes("privacidad")) {
    const hash = brain.security.latestHash ? `${brain.security.latestHash.slice(0, 12)}…` : "—";
    return `El cerebro conserva ${brain.security.storedEvents} eventos de mercado en una cadena de integridad SHA-256 (${brain.security.status.toLowerCase()}, huella ${hash}). Aprende sólo al comparar una observación con el precio real posterior; no memoriza esta pregunta, conversaciones ni datos personales. La confianza no se recalibra hasta reunir ${brain.learning.minimumSamples} resultados evaluados y nunca usa información futura. ${evidence}`;
  }

  if (normalized.includes("scalp") || normalized.includes("entrada") || normalized.includes("stop") || normalized.includes("objetivo")) {
    const aligned = brain.analyses["5m"]?.bias === brain.analyses["15m"]?.bias && brain.analyses["5m"]?.bias !== "NEUTRAL";
    return `Lectura scalping: 5M ${brain.analyses["5m"] ? biasText(brain.analyses["5m"]!.bias).toLowerCase() : "DATA UNAVAILABLE"} y 15M ${brain.analyses["15m"] ? biasText(brain.analyses["15m"]!.bias).toLowerCase() : "DATA UNAVAILABLE"}. ${aligned ? "Los marcos están alineados, pero la entrada exige además volumen, spread, estructura y stop ATR válidos en el Modo Scalping." : "No hay alineación mínima 5M/15M; no corresponde fabricar una entrada."} Este analista no improvisa niveles: el panel Scalping calcula entrada, invalidación y objetivos únicamente con velas y estructura reales. ${evidence}`;
  }

  if (normalized.includes("liquid") || /x(?:5|10|20|50|100)/.test(normalized)) {
    const requested = normalized.match(/x(5|10|20|50|100)/)?.[1];
    const zones = requested
      ? brain.liquidationZones.filter((zone) => String(zone.leverage) === requested)
      : brain.liquidationZones;
    const zoneText = zones.map((zone) =>
      `x${zone.leverage}: long ≈ ${price(zone.longPrice)} (${pct(zone.longDistancePct)}), short ≈ ${price(zone.shortPrice)} (${pct(zone.shortDistancePct)})`,
    ).join(" · ");
    const longUsd = context.liveLiquidations.filter((item) => item.side === "LONG").reduce((sum, item) => sum + item.notional, 0);
    const shortUsd = context.liveLiquidations.filter((item) => item.side === "SHORT").reduce((sum, item) => sum + item.notional, 0);
    return `${zoneText}. En la ventana WebSocket visible: ${context.liveLiquidations.length} liquidaciones reales, longs ${usd(longUsd)} y shorts ${usd(shortUsd)}. Las zonas x5–x100 son teóricas: Binance no publica el apalancamiento real de cada force-order y el precio exacto depende del margen y maintenance tier. ${evidence}`;
  }

  if (normalized.includes("altseason") || normalized.includes("alt sesión") || normalized.includes("altseson")) {
    const score = context.altseason.score === null ? "DATA UNAVAILABLE" : `${context.altseason.score}/100`;
    return `El entorno Altseason está en “${context.altseason.state}” con score ajustado ${score} (técnico ${context.altseason.raw ?? "—"}, ajuste macro ${context.altseason.adjustment}). ${brain.consensus.alignedFrames}/${brain.consensus.validFrames} temporalidades acompañan el sesgo ${biasText(brain.consensus.bias).toLowerCase()}. Una altseason no se confirma por un solo activo ni por una subida aislada. ${evidence}`;
  }

  if (normalized.includes("long") || normalized.includes("short") || normalized.includes("compr") || normalized.includes("vend")) {
    const conflict =
      (brain.consensus.bias === "BULLISH" && context.winner === "VENDEDORES") ||
      (brain.consensus.bias === "BEARISH" && context.winner === "COMPRADORES");
    return `Sesgo cuantitativo: ${biasText(brain.consensus.bias)} (${brain.consensus.score}/100), confianza ${brain.consensus.calibratedConfidence}/100. En microestructura ganan ${context.winner.toLowerCase()}, delta ${pct(context.delta)} y book bid ${context.imbalance.toFixed(1)}%. ${conflict ? "Hay conflicto entre tendencia y flujo; no existe confluencia suficiente para perseguir una entrada." : `La lectura combinada es ${brain.consensus.verdict.toLowerCase()}; aun así este módulo no fabrica una señal ni una entrada.`} ${evidence}`;
  }

  if (normalized.includes("riesgo") || normalized.includes("fomo")) {
    const risks = [...selected.risks, ...brain.consensus.risks];
    return `Riesgos detectados: ${risks.length ? risks.join("; ") : "ninguna penalización técnica fuerte en la muestra actual"}. ATR ${pct(selected.atrPct)}, RSI ${selected.rsi14?.toFixed(1) ?? "—"}, funding ${pct(brain.derivatives.fundingRatePct, 4)}. Esto es evaluación probabilística, no garantía. ${evidence}`;
  }

  const derivativeText = brain.derivatives.available
    ? `OI ${pct(brain.derivatives.openInterestChangePct)}, funding ${pct(brain.derivatives.fundingRatePct, 4)} y taker ratio ${multiple(brain.derivatives.takerBuySellRatio)}`
    : "derivados DATA UNAVAILABLE";
  return `${brain.symbol} presenta sesgo ${biasText(brain.consensus.bias).toLowerCase()} y score ${brain.consensus.score}/100, con ${brain.consensus.alignedFrames}/${brain.consensus.validFrames} marcos alineados. En ${brain.selectedTimeframe.toUpperCase()}: RSI ${selected.rsi14?.toFixed(1) ?? "—"}, volumen relativo ${multiple(selected.relativeVolume)}, ATR ${pct(selected.atrPct)}; ${derivativeText}. Flujo en vivo: ${context.winner.toLowerCase()}, delta ${pct(context.delta)}. Estado: ${brain.consensus.verdict}. ${evidence}`;
}

export default function MarketBrain(props: MarketBrainProps) {
  const timeframe = props.timeframe;
  const [brain, setBrain] = useState<MarketBrainPayload | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const publishDerivatives = props.onDerivativesChange;
  const publishBrainDerivatives = useCallback(
    (payload: MarketBrainPayload) => publishDerivatives?.(payload.derivatives),
    [publishDerivatives],
  );

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const load = async (quiet = false) => {
      if (!quiet) setStatus("loading");
      try {
        const post = async (snapshot?: DirectSnapshot) => {
          const response = await fetch("/api/brain", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbol: props.symbol, venue: props.venue, timeframe, snapshot }),
            signal: controller.signal,
          });
          const payload = await response.json() as MarketBrainPayload & { error?: string };
          return { response, payload };
        };
        let directSnapshot: DirectSnapshot | undefined;
        try {
          directSnapshot = await loadDirectSnapshot(
            props.symbol,
            props.venue,
            timeframe,
            controller.signal,
          );
        } catch {
          directSnapshot = undefined;
        }
        let result = await post(directSnapshot);
        if ((!result.response.ok || !result.payload.selected) && directSnapshot) {
          result = await post();
        }
        const { response, payload } = result;
        if (!response.ok || !payload.selected) throw new Error(payload.error ?? "DATA UNAVAILABLE");
        if (!alive) return;
        setBrain(payload);
        publishBrainDerivatives(payload);
        setError("");
        setStatus("ready");
      } catch (loadError) {
        if (!alive || controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "DATA UNAVAILABLE");
        setStatus("error");
      }
    };
    const delay = setTimeout(() => void load(), 180);
    const refresh = setInterval(() => void load(true), 60_000);
    return () => {
      alive = false;
      clearTimeout(delay);
      clearInterval(refresh);
      controller.abort();
    };
  }, [props.symbol, props.venue, publishBrainDerivatives, timeframe]);

  const defaultAnswer = useMemo(() => {
    if (!brain) return "Selecciona una temporalidad. El analista utilizará únicamente los datos reales disponibles.";
    return buildAnswer("resumen", brain, props);
  }, [brain, props]);

  const current = brain?.selected ?? null;
  const enoughLearning = Boolean(
    brain && brain.learning.samples >= brain.learning.minimumSamples,
  );
  const realLongs = props.liveLiquidations.filter((item) => item.side === "LONG");
  const realShorts = props.liveLiquidations.filter((item) => item.side === "SHORT");
  const longNotional = realLongs.reduce((sum, item) => sum + item.notional, 0);
  const shortNotional = realShorts.reduce((sum, item) => sum + item.notional, 0);
  const biggestLiquidation = [...props.liveLiquidations].sort((left, right) => right.notional - left.notional)[0];

  const ask = (suggestion?: string) => {
    const prompt = (suggestion ?? question).trim();
    if (!prompt || !brain) return;
    const entry: ChatEntry = {
      id: `${brain.generatedAt}:${chat.length}`,
      question: prompt,
      answer: buildAnswer(prompt, brain, props),
      at: new Date(brain.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setChat((entries) => [entry, ...entries].slice(0, 4));
    setQuestion("");
  };

  return (
    <section className="market-brain" aria-label="Cerebro cuantitativo autónomo">
      <header className="brain-header">
        <div className="brain-title">
          <div className="neural-orb"><i /><i /><i /><i /></div>
          <div>
            <p>ALT RADAR NEURAL DESK · MOTOR EXPLICABLE</p>
            <h2>Cerebro cuantitativo autónomo</h2>
            <span>{props.symbol.replace("USDT", "/USDT")} · análisis multi-timeframe y derivados</span>
          </div>
        </div>
        <div className="brain-badges">
          <span><i /> LOCAL ENGINE</span>
          <span>0 TOKENS</span>
          <span className={brain?.learning.status === "CALIBRADO" ? "learned" : "learning"}>
            {brain?.learning.status ?? "CARGANDO MEMORIA"}
          </span>
          <span className={brain?.security.chainVerified ? "verified" : "learning"}>
            {brain?.security.chainVerified ? "SHA-256 VERIFIED" : "AUDITANDO"}
          </span>
        </div>
      </header>

      <div className="brain-timeframes" role="tablist" aria-label="Temporalidad del análisis">
        {BRAIN_TIMEFRAMES.map((frame) => (
          <button
            key={frame}
            className={frame === timeframe ? "active" : ""}
            onClick={() => props.onTimeframeChange(frame)}
          >
            {frameLabel[frame]}
          </button>
        ))}
        <div className={`brain-feed ${status}`}>
          <i /> {status === "loading" ? "CALCULANDO" : status === "error" ? "DATA UNAVAILABLE" : "AUTO · 60S"}
        </div>
      </div>

      {status === "error" && !brain ? (
        <div className="brain-unavailable">
          <b>DATA UNAVAILABLE</b>
          <span>{error}. El sistema no sustituye datos faltantes con números ficticios.</span>
        </div>
      ) : (
        <>
          <div className="brain-console">
            <article className="brain-verdict">
              <span>CONSENSO DEL CEREBRO</span>
              <div className={`verdict-score ${brain?.consensus.bias.toLowerCase() ?? "neutral"}`}>
                <strong>{brain?.consensus.score ?? "—"}</strong><small>/100</small>
              </div>
              <h3>{brain?.consensus.verdict ?? "CALCULANDO"}</h3>
              <p>{brain ? `${brain.consensus.alignedFrames}/${brain.consensus.validFrames} temporalidades alineadas · confianza ${brain.consensus.calibratedConfidence}/100` : "Esperando velas verificables…"}</p>
              <div className="verdict-meter"><i style={{ width: `${brain?.consensus.score ?? 0}%` }} /></div>
              <small>Probabilidad modelada; no es una orden de trading.</small>
            </article>

            <article className="selected-frame">
              <div className="frame-head">
                <div><span>LECTURA SELECCIONADA</span><b>{frameLabel[timeframe]} · {current ? biasText(current.bias) : "—"}</b></div>
                <strong>{current?.score ?? "—"}<small>/100</small></strong>
              </div>
              <div className="indicator-grid">
                <div><span>PRECIO</span><b>{price(current?.price ?? (props.currentPrice || null))}</b></div>
                <div><span>CAMBIO VELA</span><b className={(current?.changePct ?? 0) >= 0 ? "positive" : "negative"}>{pct(current?.changePct)}</b></div>
                <div><span>RSI 14</span><b>{current?.rsi14?.toFixed(1) ?? "—"}</b></div>
                <div><span>REL VOL</span><b>{multiple(current?.relativeVolume)}</b></div>
                <div><span>ATR</span><b>{pct(current?.atrPct)}</b></div>
                <div><span>MACD HIST</span><b className={(current?.macdHistogram ?? 0) >= 0 ? "positive" : "negative"}>{current?.macdHistogram?.toPrecision(3) ?? "—"}</b></div>
                <div><span>SOPORTE 50</span><b>{price(current?.support)}</b></div>
                <div><span>RESISTENCIA 50</span><b>{price(current?.resistance)}</b></div>
              </div>
              <div className="ema-ribbon">
                <span>EMA 20 <b>{price(current?.ema20)}</b></span>
                <span>EMA 50 <b>{price(current?.ema50)}</b></span>
                <span>EMA 200 <b>{price(current?.ema200)}</b></span>
              </div>
            </article>

            <article className="derivatives-card">
              <div className="derivatives-head"><span>DERIVATIVES PULSE</span><b>{brain?.derivatives.available ? "BINANCE FUTURES" : "DATA UNAVAILABLE"}</b></div>
              <div className="derivatives-grid">
                <div><span>OPEN INTEREST</span><b>{usd(brain?.derivatives.openInterestUsd)}</b><small>{pct(brain?.derivatives.openInterestChangePct)} / {frameLabel[timeframe]}</small></div>
                <div><span>FUNDING</span><b className={(brain?.derivatives.fundingRatePct ?? 0) > 0.05 ? "negative" : ""}>{pct(brain?.derivatives.fundingRatePct, 4)}</b><small>ÚLTIMO RATE</small></div>
                <div><span>TAKER BUY/SELL</span><b>{multiple(brain?.derivatives.takerBuySellRatio)}</b><small>&gt;1 COMPRADOR</small></div>
                <div><span>LONG / SHORT</span><b>{multiple(brain?.derivatives.longShortAccountRatio)}</b><small>CUENTAS GLOBALES</small></div>
              </div>
              <div className="live-flow-bridge">
                <div><span>ORDER FLOW EN VIVO</span><b>{props.winner}</b></div>
                <div><span>DELTA</span><b className={props.delta >= 0 ? "positive" : "negative"}>{pct(props.delta)}</b></div>
                <div><span>BOOK BID</span><b>{props.imbalance.toFixed(1)}%</b></div>
                <div><span>CVD</span><b className={props.cvd >= 0 ? "positive" : "negative"}>{usd(props.cvd)}</b></div>
              </div>
            </article>
          </div>

          <section className="mtf-matrix">
            <div className="brain-section-title"><div><span>MULTI-TIMEFRAME MATRIX</span><h3>Una lectura, cinco horizontes</h3></div><small>5M + 15M + 1H + 4H + 1D</small></div>
            <div className="mtf-grid">
              {BRAIN_TIMEFRAMES.map((frame) => {
                const item = brain?.analyses[frame] ?? null;
                return (
                  <button key={frame} className={`${item?.bias.toLowerCase() ?? "unavailable"} ${frame === timeframe ? "selected" : ""}`} onClick={() => props.onTimeframeChange(frame)}>
                    <span>{frameLabel[frame]}</span>
                    <strong>{item?.score ?? "—"}<small>/100</small></strong>
                    <b>{item ? biasText(item.bias) : "DATA UNAVAILABLE"}</b>
                    <div><i style={{ width: `${item?.score ?? 0}%` }} /></div>
                    <p><em>{pct(item?.changePct)}</em><em>RSI {item?.rsi14?.toFixed(0) ?? "—"}</em><em>RV {multiple(item?.relativeVolume)}</em></p>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="brain-lower-grid">
            <section className="liquidation-lab">
              <div className="brain-section-title">
                <div><span>LEVERAGE STRESS MAP</span><h3>Mapa teórico de liquidación</h3></div>
                <small>REFERENCIA {price(brain?.derivatives.markPrice ?? current?.price ?? (props.currentPrice || null))}</small>
              </div>
              <div className="liquidation-table">
                <div className="liq-table-head"><span>APALANCAMIENTO</span><span>LONG LIQ. APROX.</span><span>SHORT LIQ. APROX.</span></div>
                {brain?.liquidationZones.map((zone) => (
                  <div className="liq-zone" key={zone.leverage}>
                    <strong>x{zone.leverage}</strong>
                    <span className="negative"><b>{price(zone.longPrice)}</b><small>{pct(zone.longDistancePct)}</small></span>
                    <i><u style={{ left: `${Math.max(2, 50 + zone.longDistancePct)}%`, right: `${Math.max(2, 50 - zone.shortDistancePct)}%` }} /></i>
                    <span className="positive"><b>{price(zone.shortPrice)}</b><small>{pct(zone.shortDistancePct)}</small></span>
                  </div>
                ))}
              </div>
              <p className="model-warning">⚠ MODELO TEÓRICO: no son órdenes liquidadas ni clusters observados. El precio exacto cambia según entrada, maintenance margin, margin mode y comisiones. Binance forceOrder no revela el apalancamiento real.</p>
            </section>

            <section className="real-liquidations">
              <div className="brain-section-title"><div><span>FORCE ORDER STREAM</span><h3>Liquidaciones reales</h3></div><small>{props.venue === "futures" ? "WEBSOCKET LIVE" : "CAMBIA A FUTUROS"}</small></div>
              <div className="real-liq-stats">
                <div><span>EVENTOS VISIBLES</span><b>{props.venue === "futures" ? props.liveLiquidations.length : "—"}</b></div>
                <div><span>LONGS LIQ.</span><b className="negative">{props.venue === "futures" ? usd(longNotional) : "—"}</b></div>
                <div><span>SHORTS LIQ.</span><b className="positive">{props.venue === "futures" ? usd(shortNotional) : "—"}</b></div>
                <div><span>MAYOR EVENTO</span><b>{biggestLiquidation ? `${biggestLiquidation.side} ${usd(biggestLiquidation.notional)}` : "—"}</b></div>
              </div>
              <div className="liquidation-balance">
                <span style={{ width: `${longNotional + shortNotional ? (longNotional / (longNotional + shortNotional)) * 100 : 50}%` }} />
                <b>LONGS</b><b>SHORTS</b>
              </div>
              <p>{props.venue === "futures" ? "Ventana reciente recibida desde Binance Futures forceOrder; los eventos se reinician al cambiar de activo." : "Selecciona Binance Futuros en el Bookmap para activar el stream público real de liquidaciones."}</p>
            </section>
          </div>

          <div className="brain-bottom-grid">
            <section className="brain-learning">
              <div className="brain-section-title"><div><span>WALK-FORWARD MEMORY</span><h3>Aprendizaje verificable</h3></div><small>{brain?.learning.status ?? "—"}</small></div>
              <div className="learning-stats">
                <div><span>MUESTRAS EVALUADAS</span><b>{brain?.learning.samples ?? 0}</b></div>
                <div><span>ACIERTOS</span><b>{enoughLearning ? `${brain?.learning.accuracyPct?.toFixed(1)}%` : "DATA INSUFICIENTE"}</b></div>
                <div><span>RETORNO DIRECCIONAL</span><b>{enoughLearning ? pct(brain?.learning.averageDirectionalReturnPct) : "DATA INSUFICIENTE"}</b></div>
              </div>
              <div className="learning-progress"><i style={{ width: `${Math.min(100, ((brain?.learning.samples ?? 0) / (brain?.learning.minimumSamples ?? 20)) * 100)}%` }} /></div>
              <p>{brain?.learning.methodology ?? "La memoria se inicializa con observaciones reales."}</p>
              <small>No reescribe el pasado, no usa datos futuros y no inventa win rate. Mínimo {brain?.learning.minimumSamples ?? 20} resultados antes de mostrar rendimiento.</small>
              <div className="secure-memory">
                <div>
                  <span>CEREBRO SEGURO · AUDIT LEDGER</span>
                  <b className={brain?.security.chainVerified ? "positive" : "negative"}>{brain?.security.status ?? "MEMORIA NO DISPONIBLE"}</b>
                </div>
                <div className="secure-memory-stats">
                  <span>EVENTOS <b>{brain?.security.storedEvents ?? 0}</b></span>
                  <span>VERIFICADOS <b>{brain?.security.checkedEvents ?? 0}</b></span>
                  <span>MODELO <b>{brain?.security.modelVersion ?? "—"}</b></span>
                </div>
                <code>{brain?.security.latestHash ? `${brain.security.latestHash.slice(0, 20)}…${brain.security.latestHash.slice(-8)}` : "HUELLA NO DISPONIBLE"}</code>
                <p>{brain?.security.policy ?? "Sólo se guardan observaciones de mercado verificables."}</p>
                <small>{brain?.security.privacy ?? "El chat no se guarda."}</small>
              </div>
            </section>

            <section className="brain-chat">
              <div className="brain-section-title"><div><span>LOCAL MARKET ANALYST</span><h3>Pregúntale al cerebro</h3></div><small>SIN LLM · 0 TOKENS</small></div>
              <div className="analyst-response">
                <div><i /><b>ALT RADAR AI</b><time>{chat[0]?.at ?? "AHORA"}</time></div>
                <p>{chat[0]?.answer ?? defaultAnswer}</p>
                <small>Respuesta determinística generada con el snapshot actual; no envía el texto a servicios externos.</small>
              </div>
              <div className="quick-prompts">
                {["Resumen 4H", "¿Long o short?", "¿Hay scalp?", "¿Cómo aprende?", "Liquidaciones x20", "¿Cómo está altseason?"].map((prompt) => (
                  <button key={prompt} disabled={!brain} onClick={() => ask(prompt)}>{prompt}</button>
                ))}
              </div>
              <form onSubmit={(event) => { event.preventDefault(); ask(); }}>
                <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Pregunta por momentum, scalp, riesgo o memoria…" aria-label="Pregunta al analista local" />
                <button disabled={!brain || !question.trim()}>ANALIZAR</button>
              </form>
            </section>
          </div>

          <footer className="brain-audit-footer">
            <span>FUENTES: {brain?.sources.join(" · ") || "DATA UNAVAILABLE"}</span>
            <span>ACTUALIZADO: {brain ? new Date(brain.generatedAt).toLocaleString() : "—"}</span>
            <b>Signals are probabilistic market setups, not guarantees or financial advice.</b>
          </footer>
        </>
      )}
    </section>
  );
}
