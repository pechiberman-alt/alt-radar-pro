"use client";

import { useEffect, useState } from "react";
import { loadSpotPlan } from "@/lib/spot-plan-client";
import { SPOT_RULES, type SpotPlan } from "@/lib/spot-strategy";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "LINKUSDT", "AVAXUSDT", "SUIUSDT", "ADAUSDT", "DOGEUSDT"];

const px = (v: number) =>
  v >= 1000 ? v.toLocaleString("es-AR", { maximumFractionDigits: 0 }) : v.toLocaleString("es-AR", { maximumFractionDigits: v >= 1 ? 3 : 6 });
const usd = (v: number) => `$${v.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;

export default function SpotDesk() {
  const [symbol, setSymbol] = useState("SOLUSDT");
  const [budget, setBudget] = useState("500");
  const [plan, setPlan] = useState<SpotPlan | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const result = await loadSpotPlan(symbol, Number(budget) || 0, controller.signal);
        if (!alive) return;
        if (!result) throw new Error("short");
        setPrice(result.price);
        setPlan(result.plan);
        setError("");
      } catch {
        if (alive) setError("NO SE PUDO EVALUAR ESTE PAR");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [symbol, budget]);

  return (
    <section className="panel spot-desk" id="spot">
      <div className="panel-head">
        <div>
          <p className="eyebrow">ESTRATEGIA SPOT · PLAN Y EVALUADOR</p>
          <h2>Dónde comprar, dónde salir, dónde admitir el error</h2>
        </div>
        <span className={error ? "badge critical" : "badge"}>
          {loading ? "EVALUANDO…" : error ? "NO DISPONIBLE" : plan?.status ?? ""}
        </span>
      </div>

      <details className="spot-rules">
        <summary>EL PLAN · 7 REGLAS</summary>
        <ol>
          {SPOT_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ol>
      </details>

      <div className="spot-controls">
        <select value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Par">
          {SYMBOLS.map((s) => (
            <option key={s} value={s}>{s.replace("USDT", "")}</option>
          ))}
        </select>
        <input type="number" min="0" step="any" value={budget} onChange={(e) => setBudget(e.target.value)} aria-label="Presupuesto USD" placeholder="Presupuesto USD" />
        {price !== null && <span>precio {px(price)}</span>}
      </div>

      {error && !loading && <div className="spot-empty"><b>{error}</b></div>}

      {plan && !error && (
        <>
          <div className={`spot-status s-${plan.status.split(" ")[0].toLowerCase()}`}>
            <b>{plan.status}</b>
            <span>{plan.passed} de {plan.known} condiciones con dato</span>
            <p>{plan.note}</p>
          </div>

          <div className="spot-checks">
            {plan.checks.map((c) => (
              <div key={c.id} className={`c-${c.state === "SÍ" ? "ok" : c.state === "NO" ? "no" : "na"}`}>
                <i>{c.state === "SÍ" ? "✓" : c.state === "NO" ? "✕" : "–"}</i>
                <b>{c.label}</b>
                <em>{c.detail}</em>
              </div>
            ))}
          </div>

          <h4 className="spot-h">ESCALERA DE COMPRA</h4>
          {plan.entries.length ? (
            <div className="spot-ladder">
              {plan.entries.map((t) => (
                <div key={t.price}>
                  <b>{px(t.price)}</b>
                  <em>{t.source}</em>
                  <u>{usd(t.usd)} · {Math.round(t.weight * 100)}%</u>
                </div>
              ))}
              {plan.averageEntry && <p>Promedio si se llenan todos: <b>{px(plan.averageEntry)}</b></p>}
            </div>
          ) : (
            <p className="spot-none">Sin niveles detectados debajo del precio, o sin presupuesto cargado.</p>
          )}

          <h4 className="spot-h">INVALIDACIÓN</h4>
          <p className="spot-inval">
            {plan.invalidation
              ? <>Si hay <b>{plan.invalidation.source}</b> ({px(plan.invalidation.price)}), la idea quedó invalidada.{plan.riskPct !== null ? ` Distancia desde el promedio: ${plan.riskPct.toFixed(1)}%.` : ""}</>
              : "No hay estructura debajo para anclar la invalidación: sin ese punto, el plan no recomienda entrar."}
          </p>

          <h4 className="spot-h">TOMA DE GANANCIAS</h4>
          {plan.exits.length ? (
            <div className="spot-ladder exits">
              {plan.exits.map((t) => (
                <div key={t.price}>
                  <b>{px(t.price)}</b>
                  <em>{t.source}</em>
                  <u>vender {Math.round(t.weight * 100)}%</u>
                </div>
              ))}
            </div>
          ) : (
            <p className="spot-none">Sin zona de oferta detectada arriba: revisar en marco mayor antes de fijar salidas.</p>
          )}

          <p className="spot-caveat">
            Nada de esto ejecuta órdenes ni es una recomendación personalizada. Es el plan aplicado a los niveles que detecta el radar. Las compras que hagas podés cargarlas en DCA y las operaciones en REGISTRO para medir tu propio resultado.
          </p>
        </>
      )}
    </section>
  );
}
