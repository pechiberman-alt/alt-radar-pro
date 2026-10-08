"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { arNumber } from "@/lib/ai-numbers";
import { backtestRecord, type BacktestResult } from "@/lib/jarvis-backtest";
import { BACKTEST_DAYS, BACKTEST_EVENT, lastBacktest, runBacktestFor, type BacktestProgress } from "@/lib/jarvis-backtest-run";
import type { DeskDecision } from "@/lib/jarvis-desk";
import { MIN_SAMPLE } from "@/lib/jarvis-paper";

/**
 * Backtesting de la mesa: la misma mesa y las reglas del papel sobre velas
 * pasadas de Binance, corrido en el celular. Muestra lo medido con su muestra
 * y lo que no pudo medir; nunca lo presenta como garantía.
 */

const r2 = (v: number) => `${v >= 0 ? "+" : "−"}${arNumber(Number(Math.abs(v).toFixed(2)))} R`;
const day = (t: number) => new Date(t).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit" });
const usd = (v: number) => `${v >= 0 ? "+" : "−"}$${arNumber(Number(Math.abs(v).toFixed(2)))}`;

function subscribe(cb: () => void) {
  window.addEventListener(BACKTEST_EVENT, cb);
  return () => window.removeEventListener(BACKTEST_EVENT, cb);
}

export function BacktestBlock({ symbol, d }: { symbol: string; d: DeskDecision | null }) {
  const latest = useSyncExternalStore(subscribe, lastBacktest, () => null);
  const result = latest && latest.symbol === symbol ? latest : null;
  const [days, setDays] = useState<number>(90);
  const [progress, setProgress] = useState<BacktestProgress | null>(null);
  const [error, setError] = useState("");
  const [nota, setNota] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Leaving the section stops a run in progress.
  useEffect(() => () => abortRef.current?.abort(), []);
  const coin = symbol.replace(/USDT$/, "");

  const run = async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setError("");
    setNota(null);
    setProgress({ fase: "datos", hechos: 0, total: 1 });
    const r = await runBacktestFor(symbol, days, setProgress, ac.signal);
    if (abortRef.current === ac) abortRef.current = null;
    setProgress(null);
    if (!r.ok) setError(r.error);
    else setNota(r.nota);
  };

  return (
    <div className="jt-bt">
      <p className="jt-note">
        La misma mesa y las mismas reglas del papel, caminando hacia adelante sobre velas pasadas de {coin}: en cada cierre de 4 h decide solo con lo que ya había cerrado.
      </p>
      <div className="jt-quick" role="group" aria-label="Período del backtest">
        {BACKTEST_DAYS.map((n) => (
          <button key={n} type="button" className={days === n ? "on" : ""} onClick={() => setDays(n)} disabled={Boolean(progress)}>
            {n} días
          </button>
        ))}
      </div>
      <div className="jt-row">
        <button type="button" className="jt-run" onClick={() => void run()} disabled={Boolean(progress)}>
          {progress ? "CORRIENDO…" : `CORRER BACKTEST DE ${coin}`}
        </button>
        {progress && (
          <button type="button" className="jt-mini" onClick={() => abortRef.current?.abort()}>
            CANCELAR
          </button>
        )}
      </div>
      {progress && (
        <div className="jt-progress" role="status">
          <progress max={progress.total || 1} value={progress.fase === "datos" ? 0 : progress.hechos} />
          <span>{progress.fase === "datos" ? "Bajando la historia de Binance…" : `La mesa evalúa el cierre ${progress.hechos} de ${progress.total}…`}</span>
        </div>
      )}
      {error && <p className="jt-error">{error}</p>}
      {nota && <p className="jt-note jt-warn">{nota}</p>}
      {result && !progress && <BacktestView r={result} d={d} />}
    </div>
  );
}

function BacktestView({ r, d }: { r: BacktestResult; d: DeskDecision | null }) {
  const m = r.metricas;
  const pf = m.profitFactor === null ? "sin dato" : m.profitFactor === Infinity ? "∞" : arNumber(Number(m.profitFactor.toFixed(2)));
  const similar = d?.plan ? backtestRecord(r, d.plan.lado, d.puntaje) : null;
  const closed = r.trades.filter((t) => t.estado === "CERRADA").slice(-20).reverse();
  return (
    <>
      <p className="jt-lead">
        {r.symbol.replace(/USDT$/, "")} · {r.dias} días · del {day(r.desde)} al {day(r.hasta)} · velas de {r.fuente}
      </p>
      <div className="jt-facts">
        <span>
          Operaciones <b>{m.operaciones}</b>
        </span>
        <span>
          Win rate <b>{m.winRate === null ? "sin dato" : `${Math.round(m.winRate * 100)}%`}</b>
        </span>
        <span>
          Profit factor <b>{pf}</b>
        </span>
        <span>
          Expectativa <b>{m.expectativaR === null ? "sin dato" : r2(m.expectativaR)}</b>
        </span>
        <span>
          Total <b>{r2(m.totalR)}</b>
        </span>
        <span>
          Máx. caída <b>{`${arNumber(Number(m.maxDrawdownR.toFixed(2)))} R`}</b>
        </span>
        <span>
          PnL <b>{m.pnlUsd === null ? "sin capital" : usd(m.pnlUsd)}</b>
        </span>
        <span>
          Caída en $ <b>{m.maxDrawdownUsd === null ? "sin capital" : `$${arNumber(Number(m.maxDrawdownUsd.toFixed(2)))} (${arNumber(Number(m.maxDrawdownPct!.toFixed(1)))}%)`}</b>
        </span>
        <span>
          R:R promedio <b>{m.rrPromedio === null ? "—" : `1:${arNumber(Number(m.rrPromedio.toFixed(2)))}`}</b>
        </span>
        <span>
          Mejor / peor <b>{m.mejorR === null ? "—" : `${r2(m.mejorR)} / ${r2(m.peorR!)}`}</b>
        </span>
      </div>
      <p className={`jt-note ${m.muestra === "MUESTRA RAZONABLE" ? "" : "jt-warn"}`}>
        {m.muestra === "SIN DATOS"
          ? "La mesa no aprobó ninguna operación que haya cerrado en este período: no hay resultados para medir."
          : m.muestra === "MUESTRA MÍNIMA"
            ? `Muestra mínima (${m.operaciones} de ${MIN_SAMPLE}): no alcanza para sacar conclusiones.`
            : `Muestra de ${m.operaciones} operaciones.`}{" "}
        {r.abiertasAlFinal ? `${r.abiertasAlFinal} quedó abierta al final y no cuenta. ` : ""}
        {m.pnlUsd === null ? "Cargá tu capital en «Mi riesgo» para verlo en dólares." : "En dólares: el riesgo de «Mi riesgo» fijo sobre el capital inicial, sin interés compuesto."}
      </p>
      {r.equity.length > 0 && <EquityCurve r={r} />}
      <p className="jt-note">
        La mesa evaluó {r.lecturas.evaluadas} cierres de 4 h: LONG {r.lecturas.long}, SHORT {r.lecturas.short}, ESPERAR {r.lecturas.esperar}, NO TRADE {r.lecturas.noTrade}
        {r.lecturas.sinDatos ? `, sin velas suficientes ${r.lecturas.sinDatos}` : ""}. Mientras hay una operación abierta no evalúa otra.
      </p>
      {similar && <p className="jt-record">Setups parecidos al de hoy: {similar.etiqueta}</p>}
      {closed.length > 0 && (
        <>
          <h3 className="jt-sub">Operaciones (las últimas {closed.length})</h3>
          <ul className="jt-list">
            {closed.map((t) => (
              <li key={t.id} className={t.resultadoR! < 0 ? "bad" : ""}>
                {day(t.abiertaA)} · {t.lado} · {r2(t.resultadoR!)} · {t.motivoCierre}
              </li>
            ))}
          </ul>
        </>
      )}
      <h3 className="jt-sub">Lo que este backtest no mide</h3>
      <ul className="jt-list off">
        {r.limitaciones.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </>
  );
}

const W = 360;
const HGT = 132;
const PAD = { l: 8, r: 8, t: 14, b: 18 };

/** Resultado acumulado en R a lo largo del período; tocá o pasá el dedo para ver cada cierre. */
function EquityCurve({ r }: { r: BacktestResult }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = [{ t: r.desde, r: 0 }, ...r.equity];
  const lo = Math.min(0, ...pts.map((p) => p.r));
  const hi = Math.max(0, ...pts.map((p) => p.r));
  const span = hi - lo || 1;
  const x = (t: number) => PAD.l + ((t - r.desde) / Math.max(1, r.hasta - r.desde)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + ((hi - v) / span) * (HGT - PAD.t - PAD.b);
  // A step line: the result only changes when a trade closes.
  let d = `M${x(pts[0].t)},${y(0)}`;
  for (let i = 1; i < pts.length; i += 1) d += ` H${x(pts[i].t)} V${y(pts[i].r)}`;
  d += ` H${x(r.hasta)}`;
  const final = pts[pts.length - 1].r;
  // The crosshair snaps to the nearest trade close: the reader aims at a date, not at a 2 px line.
  const pick = (clientX: number, box: DOMRect) => {
    const sx = ((clientX - box.left) / box.width) * W;
    const t = r.desde + ((sx - PAD.l) / (W - PAD.l - PAD.r)) * (r.hasta - r.desde);
    let best = 1;
    for (let i = 1; i < pts.length; i += 1) if (Math.abs(pts[i].t - t) < Math.abs(pts[best].t - t)) best = i;
    setHover(best);
  };
  const h = hover !== null ? pts[hover] : null;
  return (
    <figure className="jt-curve">
      <figcaption>Resultado acumulado (R)</figcaption>
      <div className="jt-curve-box">
        <svg
          viewBox={`0 0 ${W} ${HGT}`}
          role="img"
          aria-label={`Resultado acumulado de ${r.equity.length} operaciones: termina en ${r2(final)}, con una caída máxima de ${arNumber(Number(r.metricas.maxDrawdownR.toFixed(2)))} R.`}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          // A finger lifting also "leaves": on touch the readout stays until the next tap.
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse") setHover(null);
          }}
        >
          <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className="jt-curve-zero" />
          {/* The curve always starts on zero, so its label goes at the other end, unless the result ends there too. */}
          {Math.abs(y(final) - y(0)) > 16 && (
            <text x={W - PAD.r} y={y(0) - 4} textAnchor="end" className="jt-curve-label">
              0 R
            </text>
          )}
          <path d={d} className="jt-curve-line" />
          <circle cx={x(r.hasta)} cy={y(final)} r={4} className="jt-curve-dot" />
          <text x={W - PAD.r - 10} y={Math.max(PAD.t - 2, y(final) - 8)} textAnchor="end" className="jt-curve-label strong">
            {r2(final)}
          </text>
          {h && hover !== null && (
            <g>
              <line x1={x(h.t)} x2={x(h.t)} y1={PAD.t} y2={HGT - PAD.b} className="jt-curve-cross" />
              <circle cx={x(h.t)} cy={y(h.r)} r={4} className="jt-curve-dot" />
            </g>
          )}
          <text x={PAD.l} y={HGT - 4} className="jt-curve-label">
            {day(r.desde)}
          </text>
          <text x={W - PAD.r} y={HGT - 4} textAnchor="end" className="jt-curve-label">
            {day(r.hasta)}
          </text>
        </svg>
      </div>
      {/* The readout lives under the plot, so it never covers the curve. */}
      <p className="jt-readout" aria-live="polite">
        {h && hover !== null && hover > 0 ? (
          <>
            <b>{r2(h.r)}</b> después de la operación {hover} · {day(h.t)}
          </>
        ) : (
          "Tocá la curva para ver el resultado en cada cierre."
        )}
      </p>
    </figure>
  );
}
