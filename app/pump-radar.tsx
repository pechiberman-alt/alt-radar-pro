"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MarketAsset } from "@/lib/radar";
import {
  analyzePump,
  parsePumpKlines,
  screenPumpCandidates,
  type PumpReading,
  type PumpStage,
} from "@/lib/pump-radar";
import { fetchKlineRows } from "./binance-klines";

type Props = {
  market: MarketAsset[];
  minimumQuoteVolume: number;
  /** Reports each completed scan so the assistant can answer about it. */
  onReadings?: (readings: PumpReading[]) => void;
};


const STAGE_ORDER: Record<PumpStage, number> = {
  "IGNICIÓN": 0,
  "PUMP ACTIVO": 1,
  "CLÍMAX": 2,
  "DISTRIBUCIÓN": 3,
  "ACUMULACIÓN": 4,
  "SIN PUMP": 5,
};

const STAGE_NOTE: Record<PumpStage, string> = {
  "ACUMULACIÓN": "Volumen creciendo con precio contenido. Presión previa, sin ruptura.",
  "IGNICIÓN": "Volumen y rango disparados con recorrido aún corto. Fase temprana.",
  "PUMP ACTIVO": "Impulso en curso con volumen sostenido y recorrido acumulado.",
  "CLÍMAX": "Vertical con venta absorbiendo el impulso. Riesgo de reversión alto.",
  "DISTRIBUCIÓN": "Retrocede desde el máximo con volumen alto. El movimiento se está vendiendo.",
  "SIN PUMP": "No supera los umbrales de volumen y expansión.",
};

const assetName = (symbol: string) => symbol.replace("USDT", "");
const compact = (value: number) =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
const formatPrice = (value: number) =>
  value >= 1000
    ? `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : value >= 1
      ? `$${value.toFixed(3)}`
      : `$${value.toPrecision(4)}`;

async function fetchKlines(symbol: string) {
  return parsePumpKlines(await fetchKlineRows(symbol, "5m", 60));
}

function MetricBar({ label, value, cap }: { label: string; value: number; cap: number }) {
  const width = Math.max(2, Math.min(100, (value / cap) * 100));
  const hot = value >= cap * 0.6;
  return (
    <div className="pump-metric">
      <span>{label}</span>
      <i>
        <b className={hot ? "hot" : ""} style={{ width: `${width}%` }} />
      </i>
      <em className={hot ? "hot" : ""}>{value.toFixed(1)}×</em>
    </div>
  );
}

function PumpCard({ reading }: { reading: PumpReading }) {
  const { metrics } = reading;
  return (
    <article className={`pump-card stage-${STAGE_ORDER[reading.stage]}`}>
      <header>
        <div>
          <b>{assetName(reading.symbol)}</b>
          <small>/USDT</small>
        </div>
        <span className={`pump-stage stage-${STAGE_ORDER[reading.stage]}`}>{reading.stage}</span>
      </header>

      <div className="pump-headline">
        <strong>{reading.score}</strong>
        <span>/100 INTENSIDAD</span>
        <div>
          <b>{formatPrice(reading.price)}</b>
          <small>${compact(reading.quoteVolume)} 24H</small>
        </div>
      </div>

      <div className="pump-metrics">
        <MetricBar label="VOLUMEN vs MEDIANA 2H" value={metrics.relativeVolume} cap={10} />
        <MetricBar label="VOLUMEN SOSTENIDO 3 VELAS" value={metrics.volumeAcceleration} cap={6} />
        <MetricBar label="EXPANSIÓN DE RANGO" value={metrics.rangeExpansion} cap={6} />
        <MetricBar label="INTENSIDAD DE EJECUCIONES" value={metrics.tradeIntensity} cap={8} />
      </div>

      <div className="pump-readout">
        <div>
          <span>ÚLTIMA VELA</span>
          <b className={metrics.velocity5m >= 0 ? "positive" : "negative"}>
            {metrics.velocity5m >= 0 ? "+" : ""}
            {metrics.velocity5m.toFixed(2)}%
          </b>
        </div>
        <div>
          <span>DESDE BASE 2H</span>
          <b className={metrics.runFromBase >= 0 ? "positive" : "negative"}>
            +{metrics.runFromBase.toFixed(1)}%
          </b>
        </div>
        <div>
          <span>DESDE MÁXIMO</span>
          <b className={metrics.drawdownFromHigh >= 5 ? "negative" : ""}>
            -{metrics.drawdownFromHigh.toFixed(1)}%
          </b>
        </div>
        <div>
          <span>MECHA SUPERIOR</span>
          <b className={metrics.upperWickRatio >= 0.45 ? "negative" : ""}>
            {(metrics.upperWickRatio * 100).toFixed(0)}%
          </b>
        </div>
      </div>

      <p className="pump-note">{STAGE_NOTE[reading.stage]}</p>

      {reading.reasons.length > 0 && (
        <div className="pump-reasons">
          {reading.reasons.map((reason) => (
            <span key={reason}>✓ {reason}</span>
          ))}
        </div>
      )}
      {reading.warnings.length > 0 && (
        <div className="pump-warnings">
          {reading.warnings.map((warning) => (
            <span key={warning}>⚠ {warning}</span>
          ))}
        </div>
      )}
    </article>
  );
}

export default function PumpRadar({ market, minimumQuoteVolume, onReadings }: Props) {
  const [readings, setReadings] = useState<PumpReading[]>([]);
  const [scanned, setScanned] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const [showAll, setShowAll] = useState(false);
  const marketRef = useRef(market);
  const runId = useRef(0);

  useEffect(() => {
    marketRef.current = market;
  }, [market]);

  const scan = useCallback(async () => {
    const id = ++runId.current;
    const universe = marketRef.current;
    if (!universe.length) return;
    setLoading(true);
    try {
      const candidates = screenPumpCandidates(universe, {
        minimumQuoteVolume: Math.min(minimumQuoteVolume, 3_000_000),
        limit: 8,
      });
      setScanned(candidates.length);
      if (!candidates.length) {
        if (runId.current === id) {
          setReadings([]);
          onReadings?.([]);
          setError("");
          setLastRun(new Date());
        }
        return;
      }
      const settled = await Promise.allSettled(
        candidates.map(async (candidate) => {
          const candles = await fetchKlines(candidate.asset.symbol);
          return analyzePump(candidate.asset, candles);
        }),
      );
      if (runId.current !== id) return;
      const next = settled
        .flatMap((result) =>
          result.status === "fulfilled" && result.value ? [result.value] : [],
        )
        .sort((left, right) => {
          const stageDelta = STAGE_ORDER[left.stage] - STAGE_ORDER[right.stage];
          return stageDelta !== 0 ? stageDelta : right.score - left.score;
        });
      const failures = settled.filter((result) => result.status === "rejected").length;
      setReadings(next);
      onReadings?.(next);
      setError(failures === candidates.length ? "DATA UNAVAILABLE" : "");
      setLastRun(new Date());
    } catch {
      if (runId.current === id) setError("DATA UNAVAILABLE");
    } finally {
      if (runId.current === id) setLoading(false);
    }
  }, [minimumQuoteVolume, onReadings]);

  // The 5m rolling window arrives after the first market payload, so the scan
  // waits for that coverage instead of burning its first cycle on empty data.
  const hasShortTermCoverage = market.some(
    (asset) => asset.change5m !== null && asset.change5m !== undefined,
  );

  useEffect(() => {
    if (!hasShortTermCoverage) return;
    const boot = window.setTimeout(scan, 300);
    const timer = window.setInterval(scan, 2 * 60_000);
    return () => {
      window.clearTimeout(boot);
      window.clearInterval(timer);
    };
  }, [scan, hasShortTermCoverage]);

  const confirmed = readings.filter((reading) => reading.stage !== "SIN PUMP");
  const visible = showAll ? readings : confirmed;
  const early = confirmed.filter(
    (reading) => reading.stage === "IGNICIÓN" || reading.stage === "ACUMULACIÓN",
  ).length;
  const late = confirmed.filter(
    (reading) => reading.stage === "CLÍMAX" || reading.stage === "DISTRIBUCIÓN",
  ).length;

  return (
    <section className="panel pump-panel" id="pumpeo">
      <div className="panel-head">
        <div>
          <p className="eyebrow">DETECCIÓN DE PUMPEO · VOLUMEN Y MICROESTRUCTURA REAL</p>
          <h2>Radar de pumpeo</h2>
        </div>
        <div className="pump-actions">
          <span className={error ? "badge critical" : "badge"}>
            {loading ? "ESCANEANDO…" : error ? "DATOS PARCIALES" : "EN VIVO"}
          </span>
          <button onClick={scan} disabled={loading}>
            {loading ? "ESCANEANDO…" : "↻ ESCANEAR"}
          </button>
        </div>
      </div>

      <div className="pump-ribbon">
        <div>
          <span>PRESELECCIONADOS</span>
          <b>{scanned} DE {market.length}</b>
        </div>
        <div>
          <span>CONFIRMADOS</span>
          <b className={confirmed.length ? "positive" : ""}>{confirmed.length}</b>
        </div>
        <div>
          <span>FASE TEMPRANA</span>
          <b className={early ? "positive" : ""}>{early}</b>
        </div>
        <div>
          <span>CLÍMAX / DISTRIBUCIÓN</span>
          <b className={late ? "negative" : ""}>{late}</b>
        </div>
        <div>
          <span>ÚLTIMO CICLO</span>
          <b>{lastRun?.toLocaleTimeString() ?? "—"}</b>
        </div>
      </div>

      {visible.length ? (
        <div className="pump-grid">
          {visible.map((reading) => (
            <PumpCard key={reading.symbol} reading={reading} />
          ))}
        </div>
      ) : (
        <div className="pump-empty">
          <div>◎</div>
          <h3>
            {error ||
              (!hasShortTermCoverage
                ? "ESPERANDO VENTANA DE 5 MINUTOS"
                : "SIN PUMPEO CONFIRMADO EN ESTE CICLO")}
          </h3>
          <p>
            {error
              ? "No se pudieron leer velas de confirmación en este ciclo."
              : !hasShortTermCoverage
                ? "El detector necesita la ventana móvil de 5 minutos del universo. Escanea en cuanto Binance la entrega."
                : "Ningún activo superó los umbrales de volumen relativo, expansión de rango e intensidad de ejecuciones. El sistema no marca un pump sin confirmación real."}
          </p>
        </div>
      )}

      {readings.length > confirmed.length && (
        <button className="pump-toggle" onClick={() => setShowAll((open) => !open)}>
          {showAll
            ? "OCULTAR DESCARTADOS"
            : `VER ${readings.length - confirmed.length} PRESELECCIONADOS DESCARTADOS`}
        </button>
      )}

      <p className="pump-footnote">
        Dos etapas: primero se filtra el universo con las ventanas móviles ya cargadas, luego se
        confirma cada candidato con velas de 5 minutos cerradas de Binance Spot. La vela en curso
        se excluye de todas las métricas, así que la lectura no usa datos futuros y es reproducible.
        Detectar un pump no es una recomendación de comprarlo: las fases CLÍMAX y DISTRIBUCIÓN
        señalan exactamente lo contrario.
      </p>
    </section>
  );
}
