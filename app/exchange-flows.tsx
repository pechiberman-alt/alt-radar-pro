"use client";

import { useEffect, useState } from "react";
import type { ExchangeFlows } from "@/lib/exchange-reserves";

const money = (usd: number) => {
  const sign = usd >= 0 ? "+" : "−";
  const abs = Math.abs(usd);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  return `${sign}$${abs.toFixed(0)}`;
};

const size = (usd: number) =>
  usd >= 1e9 ? `$${(usd / 1e9).toFixed(1)}B` : `$${(usd / 1e6).toFixed(0)}M`;

const pct = (value: number | null) =>
  value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

export default function ExchangeFlowDesk() {
  const [flows, setFlows] = useState<ExchangeFlows | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/exchange-flows", { cache: "no-store" })
      .then(async (response) => {
        if (!alive) return;
        if (!response.ok) {
          setError("RESERVAS DE EXCHANGE NO DISPONIBLES");
          return;
        }
        setFlows((await response.json()) as ExchangeFlows);
      })
      .catch(() => alive && setError("RESERVAS DE EXCHANGE NO DISPONIBLES"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const peak = flows
    ? Math.max(...flows.venues.map((venue) => Math.abs(venue.netFlow7dUsd ?? 0)), 1)
    : 1;

  return (
    <section className="panel xflow-desk" id="reservas">
      <div className="panel-head">
        <div>
          <p className="eyebrow">RESERVAS DE EXCHANGE · CUSTODIA</p>
          <h2>Entran o salen las monedas</h2>
        </div>
        <span className={error ? "badge critical" : "badge"}>
          {loading ? "CARGANDO…" : error ? "NO DISPONIBLE" : "EN VIVO"}
        </span>
      </div>

      <p className="xflow-premise">
        No se puede vender lo que no está en un exchange. Cuando las monedas salen hacia custodia
        propia queda menos oferta en el libro; cuando entran, alguien las está posicionando para
        vender. A diferencia del flujo de ETF, esto se ve on-chain mientras pasa.
      </p>

      {loading && <p className="xflow-loading">LEYENDO RESERVAS…</p>}
      {error && !loading && (
        <div className="xflow-empty">
          <b>{error}</b>
          <span>No se completa con estimaciones cuando la fuente no responde.</span>
        </div>
      )}

      {flows && (
        <>
          <div className={`xflow-state s-${flows.state.split(" ")[0].toLowerCase()}`}>
            <div>
              <span>SESGO DE CUSTODIA · 7 DÍAS</span>
              <h3>{flows.state}</h3>
              <p>{flows.reading}</p>
            </div>
            <div className="xflow-figures">
              <div>
                <span>RESERVAS RASTREADAS</span>
                <b>{size(flows.totalReserveUsd)}</b>
              </div>
              <div>
                <span>MOVIMIENTO DEL PRECIO 7D</span>
                <b>{pct(flows.marketMove7dPct)}</b>
              </div>
            </div>
          </div>

          <h4 className="xflow-section">POR EXCHANGE · MOVIMIENTO REAL A 7 DÍAS</h4>
          <div className="xflow-venues">
            {flows.venues.slice(0, 10).map((venue) => {
              const flow = venue.netFlow7dUsd ?? 0;
              return (
                <div key={venue.slug}>
                  <div className="xflow-venue-name">
                    <b>{venue.name}</b>
                    <em>{size(venue.reserveUsd)} en reservas</em>
                  </div>
                  <div className="xflow-track">
                    <i
                      className={flow <= 0 ? "out" : "in"}
                      style={{ width: `${Math.min(100, (Math.abs(flow) / peak) * 100)}%` }}
                    />
                  </div>
                  <b className={flow <= 0 ? "positive" : "negative"}>{money(flow)}</b>
                  <small>
                    {pct(venue.change7dPct)} bruto · {pct(venue.netFlow7dPct)} neto de precio
                  </small>
                </div>
              );
            })}
          </div>
          <small className="xflow-legend">
            Verde = monedas saliendo (acumulación) · Rojo = monedas entrando (posible venta)
          </small>

          {/* The derivation is stated on the panel, not buried in the code. */}
          <p className="xflow-method">
            <b>Cómo se calcula.</b> Las reservas se publican en dólares, así que una caída del 5%
            puede ser solo un mercado que cayó 5% con cada moneda en su lugar. Para separar una cosa
            de la otra, se toma la mediana del cambio entre exchanges como el movimiento del precio
            —que los afecta a todos igual— y lo que cada exchange se desvía de esa mediana es el
            movimiento real de monedas. Es un cálculo derivado, no un flujo on-chain medido moneda
            por moneda. Fuente: {flows.source}.
          </p>
        </>
      )}
    </section>
  );
}
