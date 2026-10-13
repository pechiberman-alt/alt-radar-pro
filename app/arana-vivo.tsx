"use client";

import { useEffect, useState } from "react";
import { buildVivo, type VivoSnapshot } from "../lib/arana-vivo.ts";
import { BACKTEST_EVENT, lastBacktest } from "../lib/jarvis-backtest-run.ts";
import { loadPaper, PAPER_EVENT, paperTrades } from "../lib/jarvis-paper-run.ts";
import { lastScan, SCAN_EVENT, scanState } from "../lib/jarvis-scan-run.ts";
import { watchStatus, WATCH_EVENT } from "../lib/jarvis-watch-run.ts";
import { MEDICION } from "../lib/mesa-medicion.ts";

/**
 * La mesa en vivo, para la araña: lo que la app leyó ahora mismo (escaneo, papel,
 * último backtest y vigilancia) junto con lo medido en el pasado, cada cosa con su
 * muestra. Se rearma cuando cambia alguno de esos datos: no consulta nada a
 * intervalos, y no manda ninguna orden. La foto también va al marco de la araña.
 */
const EVENTOS = [SCAN_EVENT, PAPER_EVENT, BACKTEST_EVENT, WATCH_EVENT] as const;

function armar(): VivoSnapshot {
  const st = scanState();
  return buildVivo({
    now: Date.now(),
    escaneo: lastScan(),
    escaneando: st.running && st.progress ? { hechas: st.progress.hechas, total: st.progress.total } : null,
    papel: paperTrades(),
    backtest: lastBacktest(),
    vigilancia: watchStatus(),
    medido: MEDICION,
  });
}

/** La foto en vivo. Empieza en null (se dibuja después de montar, así no hay diferencias entre servidor y navegador). */
export function useVivo(): VivoSnapshot | null {
  const [vivo, setVivo] = useState<VivoSnapshot | null>(null);
  useEffect(() => {
    let activo = true;
    const refrescar = () => {
      if (activo) setVivo(armar());
    };
    EVENTOS.forEach((n) => window.addEventListener(n, refrescar));
    void (async () => {
      await loadPaper().catch(() => null);
      refrescar();
    })();
    return () => {
      activo = false;
      EVENTOS.forEach((n) => window.removeEventListener(n, refrescar));
    };
  }, []);
  return vivo;
}

const pct = (x: number | null) => (x === null ? "sin dato" : `${Math.round(x * 100)}%`);
const num = (x: number | null, d = 2) => (x === null ? "sin dato" : x.toFixed(d).replace(".", ","));
const ic = (i: { low: number; high: number } | null) => (i ? `IC90 ${pct(i.low)} a ${pct(i.high)}` : "sin dato");
const estadoEscaneo = { "sin datos": "sin escaneo", escaneando: "escaneando", listo: "al día", parcial: "parcial" } as const;

export function PanelVivo({ vivo }: { vivo: VivoSnapshot | null }) {
  if (!vivo) return <p className="vivo-wait">LEYENDO LA MESA EN VIVO…</p>;
  const e = vivo.escaneo;
  const bt = vivo.backtest;
  return (
    <div className="vivo" aria-live="polite">
      <div className="vivo-head">
        <span className={`vivo-dot ${e.estado}`} aria-hidden="true" />
        <b>EN VIVO</b>
        <span>lo que la app leyó ahora, contra lo medido</span>
      </div>
      <div className="vivo-grid">
        <div>
          <small>Escaneo</small>
          <b>{estadoEscaneo[e.estado]}</b>
          <span>
            {e.estado === "escaneando" && e.progreso !== null ? `${Math.round(e.progreso * 100)}% leídas` : e.haceMin === null ? "todavía no escaneaste" : `hace ${e.haceMin} min`}
          </span>
        </div>
        <div>
          <small>Aprobadas ahora</small>
          <b>{e.aprobadas ?? "–"}</b>
          <span>
            {e.largos ?? "–"} largos · {e.cortos ?? "–"} cortos · de {e.leidas ?? "–"} leídas
          </span>
        </div>
        <div>
          <small>Papel cerrado</small>
          <b>{vivo.papel.cerradas}</b>
          <span>
            {vivo.papel.winRate ? `${pct(vivo.papel.winRate.p)} · ${ic(vivo.papel.winRate)}` : "sin operaciones cerradas"} · {vivo.papel.muestra.toLowerCase()}
          </span>
        </div>
        <div>
          <small>Backtest {bt ? `de ${bt.moneda}, ${bt.dias} días` : ""}</small>
          <b>{bt ? bt.operaciones : "–"}</b>
          <span>{bt ? `${bt.winRate ? `${pct(bt.winRate.p)} · ${ic(bt.winRate)}` : "sin operaciones"} · ${bt.muestra.toLowerCase()}` : "todavía no corriste uno"}</span>
        </div>
        <div>
          <small>Medido en el pasado</small>
          <b>{pct(vivo.medido.winRate.p)}</b>
          <span>
            {ic(vivo.medido.winRate)} · {vivo.medido.n} operaciones · PF {num(vivo.medido.profitFactor.p)}
          </span>
        </div>
      </div>
      {e.mejores.length > 0 && (
        <ol className="vivo-mejores" aria-label="Mejores aprobadas del último escaneo">
          {e.mejores.map((m) => (
            <li key={m.symbol}>
              <b>{m.symbol.replace(/USDT$/, "")}</b> {m.direccion === "LONG" ? "largo" : "corto"} · puntaje {m.puntaje ?? "sin dato"}
              {m.consenso !== null ? ` · consenso ${num(m.consenso)}` : ""}
            </li>
          ))}
        </ol>
      )}
      <p className={`vivo-veredicto ${vivo.veredicto.estado}`}>{vivo.veredicto.texto}</p>
      {vivo.avisos.map((a) => (
        <p className="vivo-aviso" key={a}>
          {a}
        </p>
      ))}
      <p className="vivo-adv">{vivo.advertencia}</p>
    </div>
  );
}
