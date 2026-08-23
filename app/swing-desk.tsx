"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MarketAsset } from "@/lib/radar";
import {
  detectSwingEntry,
  parseSwingKlines,
  type SwingSetup,
} from "@/lib/swing-entries";
import { fetchKlineRows } from "./binance-klines";

type Horizon = "4h" | "1d";

const HORIZONS: { value: Horizon; label: string; limit: number }[] = [
  { value: "4h", label: "4H · SWING CORTO", limit: 200 },
  { value: "1d", label: "1D · SWING LARGO", limit: 200 },
];

const assetName = (symbol: string) => symbol.replace("USDT", "");
const priceLabel = (value: number) =>
  value >= 1000
    ? value.toLocaleString("en-US", { maximumFractionDigits: 1 })
    : value >= 1
      ? value.toFixed(4)
      : value.toPrecision(5);

export default function SwingDesk({
  market,
  confluence = [],
}: {
  market: MarketAsset[];
  /** Structural levels from the order-flow brain, for the current symbol. */
  confluence?: number[];
}) {
  const [horizon, setHorizon] = useState<Horizon>("4h");
  const [setups, setSetups] = useState<SwingSetup[]>([]);
  const [scanned, setScanned] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const marketRef = useRef(market);
  const confluenceRef = useRef(confluence);
  const runId = useRef(0);

  useEffect(() => {
    marketRef.current = market;
    confluenceRef.current = confluence;
  }, [market, confluence]);

  const scan = useCallback(async () => {
    const id = ++runId.current;
    const universe = marketRef.current;
    if (!universe.length) return;
    setLoading(true);
    try {
      const config = HORIZONS.find((entry) => entry.value === horizon) ?? HORIZONS[0];
      // Swing setups need liquidity to be tradable at size, so the scan stays
      // on the deepest part of the book rather than the whole universe.
      const candidates = universe
        .filter((asset) => asset.quoteVolume >= 50_000_000)
        .slice(0, 14);
      setScanned(candidates.length);

      const settled = await Promise.allSettled(
        candidates.map(async (asset) => {
          const rows = await fetchKlineRows(asset.symbol, horizon, config.limit);
          const candles = parseSwingKlines(rows);
          return detectSwingEntry(asset.symbol, candles, {
            confluence: asset.symbol === "BTCUSDT" ? confluenceRef.current : [],
          });
        }),
      );
      if (runId.current !== id) return;

      const found = settled
        .flatMap((result) =>
          result.status === "fulfilled" && result.value ? [result.value] : [],
        )
        .sort((left, right) => right.score - left.score);
      const failures = settled.filter((result) => result.status === "rejected").length;

      setSetups(found);
      setError(failures === candidates.length ? "DATA UNAVAILABLE" : "");
      setLastRun(new Date());
    } catch {
      if (runId.current === id) setError("DATA UNAVAILABLE");
    } finally {
      if (runId.current === id) setLoading(false);
    }
  }, [horizon]);

  useEffect(() => {
    const boot = window.setTimeout(scan, 1_200);
    // Swing structure changes on candle closes, so the cycle is slow on purpose.
    const timer = window.setInterval(scan, 10 * 60_000);
    return () => {
      window.clearTimeout(boot);
      window.clearInterval(timer);
    };
  }, [scan]);

  const highConviction = setups.filter((setup) => setup.quality === "ALTA CONVICCIÓN").length;

  return (
    <section className="panel swing-desk" id="swing">
      <div className="panel-head">
        <div>
          <p className="eyebrow">ENTRADAS SWING · ESTRUCTURA Y RETROCESO</p>
          <h2>Mesa de swing</h2>
        </div>
        <div className="swing-actions">
          <span className={error ? "badge critical" : "badge"}>
            {loading ? "ESCANEANDO…" : error ? "DATOS PARCIALES" : "EN VIVO"}
          </span>
          <button onClick={scan} disabled={loading}>
            {loading ? "ESCANEANDO…" : "↻ ESCANEAR"}
          </button>
        </div>
      </div>

      <div className="swing-horizons">
        {HORIZONS.map((entry) => (
          <button
            key={entry.value}
            className={horizon === entry.value ? "active" : ""}
            onClick={() => setHorizon(entry.value)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="swing-ribbon">
        <div><span>ANALIZADOS</span><b>{scanned} PARES LÍQUIDOS</b></div>
        <div><span>SETUPS</span><b className={setups.length ? "positive" : ""}>{setups.length}</b></div>
        <div><span>ALTA CONVICCIÓN</span><b className={highConviction ? "positive" : ""}>{highConviction}</b></div>
        <div><span>ÚLTIMO CICLO</span><b>{lastRun?.toLocaleTimeString() ?? "—"}</b></div>
      </div>

      {setups.length ? (
        <div className="swing-grid">
          {setups.map((setup) => (
            <article className={`swing-card ${setup.side.toLowerCase()}`} key={setup.symbol}>
              <header>
                <div>
                  <b>{assetName(setup.symbol)}</b><small>/USDT</small>
                </div>
                <span className={`swing-side ${setup.side.toLowerCase()}`}>{setup.side}</span>
                <em className={`swing-quality q-${setup.quality.replace(/\s/g, "-").toLowerCase()}`}>
                  {setup.quality}
                </em>
              </header>

              <div className="swing-score">
                <strong>{setup.score}</strong>
                <span>/100</span>
                <i>R:R 1:{setup.riskRewardFirst.toFixed(1)}</i>
              </div>

              <div className="swing-levels">
                <div>
                  <span>ZONA DE ENTRADA</span>
                  <b>{priceLabel(setup.entryLow)} – {priceLabel(setup.entryHigh)}</b>
                </div>
                <div>
                  <span>INVALIDACIÓN</span>
                  <b className="negative">{priceLabel(setup.stop)}</b>
                </div>
                <div>
                  <span>RIESGO AL STOP</span>
                  <b>{setup.riskPct.toFixed(2)}%</b>
                </div>
                <div>
                  <span>RETROCESO</span>
                  <b>{((1 - setup.retracement) * 100).toFixed(0)}% de la pierna</b>
                </div>
              </div>

              <div className="swing-targets">
                {setup.targets.map((target, index) => (
                  <span key={target}>
                    OBJ {index + 1} <b>{priceLabel(target)}</b>
                  </span>
                ))}
              </div>

              <div className="swing-reasons">
                {setup.reasons.map((reason) => (
                  <span key={reason}>✓ {reason}</span>
                ))}
              </div>
              {setup.warnings.length > 0 && (
                <div className="swing-warnings">
                  {setup.warnings.map((warning) => (
                    <span key={warning}>⚠ {warning}</span>
                  ))}
                </div>
              )}

              <p className="swing-invalidation">{setup.invalidation}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="swing-empty">
          <div>◎</div>
          <h3>{error || "SIN ENTRADAS SWING VÁLIDAS"}</h3>
          <p>
            {error
              ? "No se pudieron leer velas en este ciclo."
              : "Ningún par líquido combina tendencia confirmada, retroceso dentro de la zona operable y una invalidación estructural que deje un R:R aceptable. El motor no baja el estándar para mostrar algo."}
          </p>
        </div>
      )}

      <p className="swing-footnote">
        Un setup exige tres cosas a la vez: tendencia confirmada por estructura y medias, un
        retroceso que no la haya roto, y un stop detrás del pivote que la sostiene con un
        objetivo que pague ese riesgo. Si falta alguna, no hay entrada: el motor rechaza en vez
        de rebajar. La vela en curso se excluye, así que la lectura no cambia mientras se forma.
        Son escenarios probabilísticos, no asesoramiento financiero.
      </p>
    </section>
  );
}
