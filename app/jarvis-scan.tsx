"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { arNumber } from "@/lib/ai-numbers";
import { signed } from "@/lib/jarvis-council";
import { DEFAULT_SCAN_VOLUME, SCAN_LIMITS, SCAN_MAX_COINS, SCAN_MIN_VOLUMES, SCAN_STALE_MS, isApproved, rankApproved, scanLine, scanSummaryText, type ScanResult, type ScanRow } from "@/lib/jarvis-scan";
import { cancelScan, SCAN_EVENT, scanState, startScan, type ScanProgress } from "@/lib/jarvis-scan-run";

/**
 * El escáner de todo el mercado de JARVIS TRADING: lee todas las monedas de
 * Binance Futures con volumen suficiente con la misma mesa de arriba y muestra
 * las que hoy tienen un plan aprobado. Es análisis: no hay ningún botón que
 * opere. Tocar una moneda la abre en la mesa, con la lectura completa.
 */

const px = (v: number) => arNumber(v);
const hour = (t: number) => new Date(t).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const ago = (ms: number) => {
  const min = Math.max(0, Math.round(ms / 60_000));
  return min < 1 ? "hace menos de un minuto" : min < 60 ? `hace ${min} min` : `hace ${Math.floor(min / 60)} h ${min % 60} min`;
};
const eta = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
};
const volumeLabel = (v: number) => `$${arNumber(v / 1_000_000)} M`;
/** Tantas filas de «las demás» se dibujan: el resto se cuenta pero no se pinta (250 renglones en un celular no sirven de nada). */
const OTHERS_SHOWN = 150;

function subscribe(cb: () => void) {
  window.addEventListener(SCAN_EVENT, cb);
  return () => window.removeEventListener(SCAN_EVENT, cb);
}

function ProgressView({ p }: { p: ScanProgress }) {
  const text =
    p.fase === "monedas"
      ? "Pidiéndole a Binance la lista de monedas…"
      : p.fase === "datos"
        ? "Bajando lo que comparten todas: BTC, ETH, calendario, noticias y sentimiento…"
        : p.fase === "lectura"
          ? `Leyendo ${p.actual ?? ""} · ${p.hechas} de ${p.total}${p.restanteMs ? ` · faltan unos ${eta(p.restanteMs)}` : ""}`
          : `Releyendo completas las aprobadas: ${p.hechas} de ${p.total}${p.actual ? ` (${p.actual})` : ""}…`;
  return (
    <div className="jt-progress" role="status">
      {p.total > 0 && <progress value={p.hechas} max={p.total} />}
      <span>{text}</span>
    </div>
  );
}

function RowButton({ r, onPick }: { r: ScanRow; onPick: (coin: string) => void }) {
  const p = r.plan;
  const side = r.direccion === "LONG" ? "long" : "short";
  return (
    <li>
      <button type="button" className={`jt-scan-row ${side}`} onClick={() => onPick(r.moneda)} title={`Abrir ${r.moneda} en la mesa, con la lectura completa`}>
        <span className="jt-scan-top">
          <b>{r.moneda}</b>
          <i className={side}>{r.direccion}</i>
          <span className="jt-scan-score">confluencia {r.puntaje}</span>
        </span>
        {p && (
          <span className="jt-scan-plan">
            entrada {px(p.entrada)}
            {p.tipoEntrada === "LÍMITE" ? " (límite)" : ""} · stop {px(p.stop)} · TP1 {px(p.tp1)} · R:R 1:{arNumber(Number(p.rr.toFixed(2)))} · riesgo {p.riesgo}
          </span>
        )}
        <span className="jt-scan-meta">
          consenso {signed(r.consenso ?? 0)} · datos leídos {Math.round((r.cobertura ?? 0) * 100)}% del peso · lectura {r.lectura}
          {r.lectura === "rápida" ? " (sin derivados ni liquidaciones: tocá para leerla completa)" : ""}
        </span>
        {r.nota && <span className="jt-scan-note">{r.nota}</span>}
      </button>
    </li>
  );
}

function CopyList({ rows }: { rows: ScanRow[] }) {
  const [done, setDone] = useState<"" | "ok" | "no">("");
  return (
    <button
      type="button"
      className="jt-mini"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(rows.map(scanLine).join("\n"));
          setDone("ok");
        } catch {
          setDone("no");
        }
        window.setTimeout(() => setDone(""), 2500);
      }}
    >
      {done === "ok" ? "COPIADA ✓" : done === "no" ? "NO SE PUDO COPIAR" : "COPIAR LISTA"}
    </button>
  );
}

function ResultView({ r, now, onPick }: { r: ScanResult; now: number; onPick: (coin: string) => void }) {
  const approved = rankApproved(r.filas);
  const fell = r.filas.filter((x) => (x.antes === "LONG" || x.antes === "SHORT") && !isApproved(x));
  const others = r.filas.filter((x) => !isApproved(x));
  const stale = now - r.at > SCAN_STALE_MS;
  const u = r.universo;
  return (
    <div className="jt-scan-result">
      <p className="jt-lead">{scanSummaryText(r)}</p>
      <p className="jt-note">
        Escaneo de las {hour(r.at)} ({ago(now - r.at)}) · duró {eta(r.duracionMs)}. De {u.contratos} contratos USDT: {u.elegibles} con el volumen mínimo, {u.noMonedas} que no son monedas (dólares sintéticos, índices, metales), {u.sinVolumen} con menos volumen
        {u.recortadas ? `, ${u.recortadas} fuera por el tope de ${SCAN_MAX_COINS} monedas por escaneo` : ""}.
      </p>
      {stale && <p className="jt-warn">Es un escaneo viejo: el mercado cambió desde entonces. Volvé a escanear antes de mirar los planes.</p>}

      <h3 className="jt-sub">Con plan aprobado ({approved.length})</h3>
      {approved.length ? (
        <>
          <ul className="jt-scan-list">
            {approved.map((x) => (
              <RowButton key={x.symbol} r={x} onPick={onPick} />
            ))}
          </ul>
          <div className="jt-row">
            <CopyList rows={approved} />
          </div>
        </>
      ) : (
        <p className="jt-note">Ninguna moneda pasa hoy todos los controles. Esperar también es una decisión.</p>
      )}

      {fell.length > 0 && (
        <details className="jt-agent">
          <summary>
            <span>Aprobadas en la lectura rápida que dejaron de estarlo ({fell.length})</span>
          </summary>
          <ul className="jt-list">
            {fell.map((x) => (
              <li key={x.symbol}>
                <b>{x.moneda}</b> (antes {x.antes}, ahora {x.direccion}): {x.motivo}
              </li>
            ))}
          </ul>
        </details>
      )}

      {others.length > 0 && (
        <details className="jt-agent">
          <summary>
            <span>Las demás ({others.length}): dónde se frenó cada una</span>
          </summary>
          <ul className="jt-list">
            {others.slice(0, OTHERS_SHOWN).map((x) => (
              <li key={x.symbol} className={x.direccion === "SIN DATOS" ? "warn" : undefined}>
                <b>{x.moneda}</b> · {x.direccion}
                {x.consenso !== null ? ` · consenso ${signed(x.consenso)}` : ""}: {x.motivo}
              </li>
            ))}
          </ul>
          {others.length > OTHERS_SHOWN && <p className="jt-note">Se muestran {OTHERS_SHOWN} de {others.length}, en el orden en que se leyeron (de más a menos volumen).</p>}
        </details>
      )}
    </div>
  );
}

export function ScanBlock({ onPick }: { onPick: (coin: string) => void }) {
  const st = useSyncExternalStore(subscribe, scanState, scanState);
  const [minVolume, setMinVolume] = useState<number>(DEFAULT_SCAN_VOLUME);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="jt-scan">
      <p className="jt-note">
        <span className="jt-tag">ANÁLISIS</span> Lee todas las monedas de Binance Futures con volumen suficiente, una por una, con la misma mesa de arriba, y te muestra las que hoy tienen un plan aprobado. Corre en tu navegador, con la pantalla abierta: tarda unos minutos porque va de a poco para no saturar a Binance. El núcleo del servidor sigue leyendo solo 20 monedas cada 15 minutos.
      </p>
      <div className="jt-scan-controls">
        <label>
          Volumen mínimo en 24 h
          <select value={minVolume} disabled={st.running} onChange={(e) => setMinVolume(Number(e.target.value))}>
            {SCAN_MIN_VOLUMES.map((v) => (
              <option key={v} value={v}>
                {volumeLabel(v)}
                {v === DEFAULT_SCAN_VOLUME ? " (recomendado)" : ""}
              </option>
            ))}
          </select>
        </label>
        {st.running ? (
          <button type="button" className="jt-run stop" onClick={cancelScan}>
            CANCELAR
          </button>
        ) : (
          <button
            type="button"
            className="jt-run"
            onClick={() => {
              setNow(Date.now());
              void startScan({ minVolume });
            }}
          >
            {st.result ? "ESCANEAR DE NUEVO" : "ESCANEAR TODO EL MERCADO"}
          </button>
        )}
      </div>
      {st.running && st.progress && <ProgressView p={st.progress} />}
      {st.error && <p className="jt-error">{st.error}</p>}
      {st.result && <ResultView r={st.result} now={now} onPick={onPick} />}
      <ul className="jt-list">
        {SCAN_LIMITS.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  );
}
