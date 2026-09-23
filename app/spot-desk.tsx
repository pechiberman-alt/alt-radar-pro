"use client";

import { useEffect, useState } from "react";
import { readFibZone } from "@/lib/fib-zone";
import { loadRows } from "@/lib/market-fetch";
import { buildMtfZones } from "@/lib/mtf-zones";
import { evaluateSpot, SPOT_RULES, type SpotPlan } from "@/lib/spot-strategy";
import { parseSwingKlines } from "@/lib/swing-entries";
import { parseOverhang } from "@/lib/token-unlocks";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "LINKUSDT", "AVAXUSDT", "SUIUSDT", "ADAUSDT", "DOGEUSDT"];

const px = (v: number) =>
  v >= 1000 ? v.toLocaleString("es-AR", { maximumFractionDigits: 0 }) : v.toLocaleString("es-AR", { maximumFractionDigits: v >= 1 ? 3 : 6 });
const usd = (v: number) => `$${v.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i += 1) e = values[i] * k + e * (1 - k);
  return e;
}

async function loadOverhang(symbol: string): Promise<number | null> {
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1",
    );
    if (!r.ok) return null;
    const rows = (await r.json()) as unknown[];
    const base = symbol.replace(/USDT$/, "").toLowerCase();
    const row = rows.find((x) => (x as { symbol?: string }).symbol === base);
    return row ? (parseOverhang(row, new Set())?.overhangRatio ?? null) : null;
  } catch {
    return null;
  }
}

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
        const [d, h4, overhang] = await Promise.all([
          loadRows(symbol, "1d", 365, controller.signal).then(parseSwingKlines),
          loadRows(symbol, "4h", 400, controller.signal).then(parseSwingKlines),
          loadOverhang(symbol),
        ]);
        if (!alive) return;
        if (d.length < 60) throw new Error("short");
        const current = h4.at(-1)?.close ?? d.at(-1)!.close;
        const board = buildMtfZones(
          [{ timeframe: "1d", candles: d }, { timeframe: "4h", candles: h4 }].filter((s) => s.candles.length >= 40),
          current,
        );
        const fib = readFibZone(d);
        const trend = ema(d.map((c) => c.close), 200);
        const zones = board?.zones ?? [];
        setPrice(current);
        setPlan(
          evaluateSpot(
            {
              symbol,
              price: current,
              demandZones: zones.filter((z) => z.kind === "DEMANDA" && z.low <= current),
              supplyZones: zones.filter((z) => z.kind === "OFERTA" && z.low > current),
              fib: fib ? { inZone: fib.inZone, side: fib.side, levels: fib.levels, legLow: fib.legLow } : null,
              aboveTrend: trend === null ? null : current > trend,
              overhangRatio: overhang,
            },
            Number(budget) || 0,
          ),
        );
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
