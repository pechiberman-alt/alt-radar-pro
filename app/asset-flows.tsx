"use client";

import { useEffect, useState } from "react";
import type { AssetFlow, FlowComparison } from "@/lib/etf-flows-multi";

const money = (usd: number) => {
  const sign = usd >= 0 ? "+" : "−";
  const abs = Math.abs(usd);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
};

export default function AssetFlowDesk() {
  const [data, setData] = useState<FlowComparison | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    fetch("/api/etf-flows", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!alive) return;
        if (!response.ok) {
          setError("FLUJOS POR ACTIVO NO DISPONIBLES");
          return;
        }
        setData((await response.json()) as FlowComparison);
      })
      .catch(() => alive && setError("FLUJOS POR ACTIVO NO DISPONIBLES"))
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  const peak = data
    ? Math.max(...data.assets.map((a) => Math.abs(a.sum7dUsd)), 1)
    : 1;

  return (
    <section className="panel aflow-desk" id="flujo-activos">
      <div className="panel-head">
        <div>
          <p className="eyebrow">FLUJO INSTITUCIONAL POR ACTIVO</p>
          <h2>A qué le meten plata los fondos</h2>
        </div>
        <span className={error ? "badge critical" : "badge"}>
          {loading ? "CARGANDO…" : error ? "NO DISPONIBLE" : data?.assets[0]?.asOf ?? ""}
        </span>
      </div>

      <p className="aflow-premise">
        Ya existen ETF al contado de BTC, ETH, SOL y XRP, así que la comparación entre activos es
        una medición y no una suposición. Lo interesante no es el número de uno: es que un día
        entre dinero a uno mientras sale de los otros. Ahí el capital está eligiendo.
      </p>

      {loading && <p className="aflow-loading">LEYENDO FLUJOS…</p>}
      {error && !loading && (
        <div className="aflow-empty">
          <b>{error}</b>
          <span>No se completa con estimaciones cuando la fuente no responde.</span>
        </div>
      )}

      {data && (
        <>
          <div className="aflow-reading">{data.reading}</div>

          <div className="aflow-list">
            {data.assets.map((asset: AssetFlow) => {
              const positive = asset.sum7dUsd >= 0;
              const share = (Math.abs(asset.sum7dUsd) / peak) * 100;
              return (
                <div
                  key={asset.asset}
                  className={
                    asset === data.leader ? "leader" : asset === data.laggard ? "laggard" : ""
                  }
                >
                  <div className="aflow-name">
                    <b>{asset.asset}</b>
                    <em>
                      {asset.streakDays > 1
                        ? `${asset.streakDays}d ${asset.streakDirection.toLowerCase()}`
                        : "sin racha"}
                    </em>
                  </div>
                  <div className="aflow-bar">
                    <i
                      className={positive ? "in" : "out"}
                      style={{ width: `${Math.max(2, share)}%` }}
                    />
                  </div>
                  <div className="aflow-figures">
                    <b className={positive ? "positive" : "negative"}>{money(asset.sum7dUsd)}</b>
                    <em>7 días · últ. {money(asset.lastDayUsd)}</em>
                  </div>
                </div>
              );
            })}
          </div>

          {data.assets.length < 4 && (
            <p className="aflow-partial">
              Mostrando {data.assets.length} de 4 activos: la fuente no respondió para el resto.
              Se listan los que sí, en vez de completar los faltantes con ceros.
            </p>
          )}

          <p className="aflow-caveat">
            <b>Cómo leerlo.</b> {data.caveat} Fuente: {data.source}.
          </p>
        </>
      )}
    </section>
  );
}
