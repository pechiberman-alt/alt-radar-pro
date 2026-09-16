"use client";

import { useEffect, useState } from "react";
import type { InstitutionalFlows } from "@/lib/institutional-flows";

const money = (usd: number) => {
  const sign = usd >= 0 ? "+" : "−";
  const abs = Math.abs(usd);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  return `${sign}$${abs.toFixed(0)}`;
};

const pct = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

const REGIME_NOTE: Record<InstitutionalFlows["regime"], string> = {
  "ACUMULACIÓN SOSTENIDA":
    "El mes y la semana entran, con racha encadenada. Es el contexto más favorable que estos datos pueden describir.",
  "DEMANDA FIRME": "El mes y la semana entran, pero sin racha sostenida todavía.",
  "GIRO A LA ENTRADA": "El mes venía saliendo y la semana giró a entrada. Un giro no es una tendencia.",
  "GIRO A LA SALIDA": "El mes venía entrando y la semana giró a salida. Vigilar si se confirma.",
  DISTRIBUCIÓN: "El mes y la semana salen. El capital institucional está reduciendo exposición.",
  NEUTRAL: "Ni entrada ni salida significativa. Este dato no aporta dirección ahora.",
};

export default function InstitutionalDesk() {
  const [flows, setFlows] = useState<InstitutionalFlows | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/institutional", { cache: "no-store" })
      .then(async (response) => {
        if (!alive) return;
        if (!response.ok) {
          setError("FLUJO INSTITUCIONAL NO DISPONIBLE");
          return;
        }
        setFlows((await response.json()) as InstitutionalFlows);
      })
      .catch(() => alive && setError("FLUJO INSTITUCIONAL NO DISPONIBLE"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const peak = flows ? Math.max(...flows.recent.map((day) => Math.abs(day.netFlowUsd)), 1) : 1;

  return (
    <section className="panel inst-desk" id="institucional">
      <div className="panel-head">
        <div>
          <p className="eyebrow">FLUJO INSTITUCIONAL · ETF SPOT DE BITCOIN</p>
          <h2>Qué compraron los fondos</h2>
        </div>
        <span className={error ? "badge critical" : "badge"}>
          {loading ? "CARGANDO…" : error ? "NO DISPONIBLE" : `CIERRE ${flows?.asOf ?? "—"}`}
        </span>
      </div>

      {/* The delay is the first thing on the panel, not a footnote: read as a
          live feed this would be a lie about what the number can do. */}
      <div className="inst-lag">
        <b>DATO CONFIRMATORIO, NO ANTICIPADO</b>
        <span>
          Los emisores reportan creaciones y redenciones después del cierre de EE.UU. Esta lectura
          corresponde al {flows?.asOf ?? "—"}
          {flows && flows.publishedLagDays > 0
            ? ` — ${flows.publishedLagDays} día${flows.publishedLagDays === 1 ? "" : "s"} de atraso`
            : ""}
          , y todo el mercado la ve al mismo tiempo. Sirve para leer el régimen de demanda, no para
          cronometrar una entrada.
        </span>
      </div>

      {loading && <p className="inst-loading">LEYENDO FLUJOS…</p>}
      {error && !loading && (
        <div className="inst-empty">
          <b>{error}</b>
          <span>No se completa con estimaciones cuando la fuente no responde.</span>
        </div>
      )}

      {flows && (
        <>
          <div className={`inst-regime r-${flows.regime.split(" ")[0].toLowerCase()}`}>
            <div>
              <span>RÉGIMEN DE DEMANDA · 20 SESIONES</span>
              <h3>{flows.regime}</h3>
              <p>{REGIME_NOTE[flows.regime]}</p>
            </div>
            <div className="inst-regime-figures">
              <div>
                <span>ÚLTIMA SESIÓN</span>
                <b className={flows.lastDayUsd >= 0 ? "positive" : "negative"}>
                  {money(flows.lastDayUsd)}
                </b>
              </div>
              <div>
                <span>RACHA</span>
                <b>
                  {flows.streakDays}d {flows.streakDirection}
                </b>
              </div>
              <div>
                <span>5 SESIONES</span>
                <b className={flows.sum5dUsd >= 0 ? "positive" : "negative"}>
                  {money(flows.sum5dUsd)}
                </b>
              </div>
              <div>
                <span>20 SESIONES</span>
                <b className={flows.sum20dUsd >= 0 ? "positive" : "negative"}>
                  {money(flows.sum20dUsd)}
                </b>
              </div>
            </div>
          </div>

          <div className="inst-spark" aria-label="Flujo neto de las últimas sesiones">
            {flows.recent.map((day) => (
              <i
                key={day.date}
                className={day.netFlowUsd >= 0 ? "up" : "down"}
                style={{ height: `${Math.max(4, (Math.abs(day.netFlowUsd) / peak) * 100)}%` }}
                title={`${day.date} · ${money(day.netFlowUsd)}`}
              />
            ))}
          </div>
          <small className="inst-hint">
            Últimas {flows.recent.length} sesiones reportadas · verde entrada, rojo salida
            {flows.acceleration !== null && (
              <>
                {" · "}
                ritmo de 5 sesiones {flows.acceleration >= 1 ? "por encima" : "por debajo"} del de 20
                ({flows.acceleration.toFixed(2)}×)
              </>
            )}
          </small>

          {flows.divergence && flows.divergence.kind !== "ALINEADO" && (
            <div className="inst-divergence">
              <b>⚠ {flows.divergence.kind}</b>
              <span>{flows.divergence.reading}</span>
              <small>
                5 sesiones: flujo {money(flows.divergence.flow5dUsd)} · BTC{" "}
                {pct(flows.divergence.pricePct5d)}
              </small>
            </div>
          )}

          <h4 className="inst-section">POR EMISOR · 20 SESIONES</h4>
          <div className="inst-issuers">
            {flows.issuers.slice(0, 8).map((issuer) => (
              <div key={issuer.ticker} className={issuer.ticker === "IBIT" ? "flagship" : ""}>
                <div className="inst-issuer-name">
                  <b>{issuer.issuer}</b>
                  <em>{issuer.ticker}</em>
                </div>
                <div className="inst-issuer-bar">
                  <i
                    className={issuer.sum20dUsd >= 0 ? "up" : "down"}
                    style={{ width: `${Math.min(100, issuer.shareOfGross20d ?? 0)}%` }}
                  />
                </div>
                <b className={issuer.sum20dUsd >= 0 ? "positive" : "negative"}>
                  {money(issuer.sum20dUsd)}
                </b>
                <small>
                  5d {money(issuer.sum5dUsd)}
                  {issuer.lastDayUsd !== null && <> · últ. {money(issuer.lastDayUsd)}</>}
                </small>
              </div>
            ))}
          </div>

          <p className="inst-footnote">
            Cada creación es bitcoin retirado del mercado y guardado en custodia; cada redención lo
            devuelve. Por eso esto es el censo más honesto de lo que los asignadores hicieron, y no
            de lo que dijeron. Lo que <b>no</b> es: una vista de las órdenes de BlackRock en tiempo
            real. Ese dato no existe públicamente — los fondos custodian en Coinbase Custody y lo
            que se ve on-chain es la liquidación de creaciones ya ocurridas. Fuente:{" "}
            {flows.source}. {flows.attribution}.
          </p>
        </>
      )}
    </section>
  );
}
