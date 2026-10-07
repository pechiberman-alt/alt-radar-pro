"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { arNumber } from "@/lib/ai-numbers";
import type { DeskDecision } from "@/lib/jarvis-desk";
import { auditOf, canPaper, MIN_SAMPLE, openR, paperCsv, paperStats, statsBy, type PaperTrade } from "@/lib/jarvis-paper";
import { closeNow, lastPrice, loadPaper, openFromDesk, PAPER_EVENT, paperState, refreshPaper } from "@/lib/jarvis-paper-run";
import { everyVisible } from "@/lib/visible-interval";

/**
 * Paper trading de JARVIS TRADING: seguir un plan aprobado sin plata real y
 * medir el resultado con su cadena de auditoría. Separado del análisis (la
 * mesa) y de cualquier ejecución real: acá no hay nada que opere en un exchange.
 */

const px = (v: number) => arNumber(v);
const r2 = (v: number) => `${v >= 0 ? "+" : "−"}${arNumber(Number(Math.abs(v).toFixed(2)))} R`;
const when = (t: number) => new Date(t).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const isLive = (t: PaperTrade) => t.estado === "ABIERTA" || t.estado === "PENDIENTE";

function subscribe(cb: () => void) {
  window.addEventListener(PAPER_EVENT, cb);
  return () => window.removeEventListener(PAPER_EVENT, cb);
}

/** La lista de papel, compartida con el chat de JARVIS; se revisa al abrir y cada 10 min con la pestaña visible. */
export function usePaper() {
  const state = useSyncExternalStore(subscribe, paperState, paperState);
  useEffect(() => {
    let live = true;
    void (async () => {
      await loadPaper();
      if (live) await refreshPaper().catch(() => null);
    })();
    // Binance candles only (no database reads), and never in a hidden tab.
    const stop = everyVisible(() => void refreshPaper().catch(() => null), 10 * 60_000);
    return () => {
      live = false;
      stop();
    };
  }, []);
  return state;
}

/** El botón de la tarjeta: seguir este plan en papel. */
export function PaperFollow({ d, onOpened }: { d: DeskDecision; onOpened?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!canPaper(d)) return null;
  return (
    <div className="jt-follow">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await openFromDesk(d);
          setBusy(false);
          if (r.ok) onOpened?.();
          setMsg(
            r.ok
              ? { ok: true, text: `En papel: ${r.trade.lado} ${d.moneda} ${r.trade.tipoEntrada === "LÍMITE" ? `con orden límite en ${px(r.trade.entrada)}` : `desde ${px(r.trade.entrada)}`}. La sigo con velas de 1 h y te muestro el resultado abajo, en Paper trading.` }
              : { ok: false, text: r.error },
          );
        }}
      >
        {busy ? "ABRIENDO…" : "📝 SIMULAR EN PAPEL"}
      </button>
      <small>Sin plata real: sigue este plan tal cual y mide qué habría pasado.</small>
      {msg && <p className={msg.ok ? "jt-ok" : "jt-error"}>{msg.text}</p>}
    </div>
  );
}

function download(trades: PaperTrade[]) {
  const url = URL.createObjectURL(new Blob([paperCsv(trades)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `jarvis-papel-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** El bloque «Paper trading»: números medidos, abiertas, cerradas y su auditoría. */
export function PaperBlock({ state }: { state: ReturnType<typeof usePaper> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const trades = state.trades;
  const st = paperStats(trades);
  const open = trades.filter(isLive);
  const done = trades.filter((t) => !isLive(t)).slice(0, 30);
  const groups = statsBy(trades);
  const pf = st.profitFactor === null ? "sin dato" : st.profitFactor === Infinity ? "∞" : arNumber(Number(st.profitFactor.toFixed(2)));
  return (
    <div className="jt-paper">
      <p className="jt-note">
        <span className="jt-tag jt-tag-paper">PAPEL · SIMULADO</span>{" "}
        {state.mode === "cuenta" ? "Guardado en tu cuenta." : state.mode === "equipo" ? "Sin sesión: se guarda solo en este equipo." : state.error}
      </p>
      {!state.loaded ? (
        <p className="jt-muted">Leyendo tu registro de papel…</p>
      ) : !trades.length ? (
        <p className="jt-note">Todavía no hay operaciones. Con un plan aprobado (LONG o SHORT), tocá «Simular en papel» en la tarjeta o decile a JARVIS «simulá la operación».</p>
      ) : (
        <>
          <div className="jt-facts">
            <span>
              Cerradas <b>{st.cerradas}</b>
            </span>
            <span>
              Win rate <b>{st.winRate === null ? "sin dato" : `${Math.round(st.winRate * 100)}%`}</b>
            </span>
            <span>
              Profit factor <b>{pf}</b>
            </span>
            <span>
              Expectativa <b>{st.expectativaR === null ? "sin dato" : r2(st.expectativaR)}</b>
            </span>
            <span>
              Total <b>{r2(st.totalR)}</b>
            </span>
            <span>
              PnL <b>{st.pnlUsd === null ? "sin capital" : `${st.pnlUsd >= 0 ? "+" : "−"}$${arNumber(Number(Math.abs(st.pnlUsd).toFixed(2)))}`}</b>
            </span>
            <span>
              Mejor / peor <b>{st.mejorR === null ? "—" : `${r2(st.mejorR)} / ${r2(st.peorR!)}`}</b>
            </span>
            <span>
              Duración media <b>{st.duracionMediaH === null ? "—" : `${arNumber(Number(st.duracionMediaH.toFixed(1)))} h`}</b>
            </span>
          </div>
          <p className={`jt-note ${st.muestra === "MUESTRA RAZONABLE" ? "" : "jt-warn"}`}>
            {st.muestra === "SIN DATOS" ? "Sin operaciones cerradas todavía: no hay resultados para medir." : st.muestra === "MUESTRA MÍNIMA" ? `Muestra mínima (${st.cerradas} de ${MIN_SAMPLE}): todavía no alcanza para sacar conclusiones.` : `Muestra de ${st.cerradas} operaciones. Resultados pasados, simulados: no garantizan resultados futuros.`}
          </p>

          {open.length > 0 && (
            <>
              <h3 className="jt-sub">Abiertas ({open.length})</h3>
              <div className="jt-trades">
                {open.map((t) => {
                  const lp = lastPrice(t.symbol);
                  const now = lp ? openR(t, lp.price) : null;
                  return (
                    <div key={t.id} className={`jt-trade ${t.lado === "LONG" ? "long" : "short"}`}>
                      <div className="jt-trade-top">
                        <b>
                          {t.symbol.replace(/USDT$/, "")} {t.lado}
                        </b>
                        <i>{t.estado === "PENDIENTE" ? "LÍMITE SIN LLENAR" : now === null ? "ABIERTA" : r2(now)}</i>
                      </div>
                      <p>
                        Entrada {px(t.entrada)} · Stop {px(t.stop)} · TP {t.tp.map((p, i) => `${px(p)}${t.salidas.some((e) => e.kind === `TP${i + 1}`) ? " ✓" : ""}`).join(" / ")}
                      </p>
                      <p className="jt-note">
                        Abierta {when(t.abiertaA)} · confluencia {t.confianza}/100{lp ? ` · último cierre de 1 h ${px(lp.price)}` : ""}
                      </p>
                      <button
                        type="button"
                        className="jt-mini"
                        disabled={busy === t.id}
                        onClick={async () => {
                          setBusy(t.id);
                          const r = await closeNow(t.id);
                          setBusy(null);
                          setNote(r.ok ? "" : r.error);
                        }}
                      >
                        {busy === t.id ? "CERRANDO…" : t.estado === "PENDIENTE" ? "CANCELAR" : "CERRAR AL ÚLTIMO CIERRE"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {done.length > 0 && (
            <>
              <h3 className="jt-sub">Cerradas · auditoría</h3>
              <div className="jt-agents">
                {done.map((t) => {
                  const a = auditOf(t);
                  return (
                    <details key={t.id} className="jt-agent">
                      <summary>
                        <span>
                          {t.symbol.replace(/USDT$/, "")} {t.lado} · {when(t.abiertaA)}
                        </span>
                        <i className={a.veredicto === "ACIERTO" ? "up" : a.veredicto === "ERROR" ? "down" : "off"}>{t.resultadoR === null ? a.veredicto : `${r2(t.resultadoR)} · ${a.veredicto}`}</i>
                      </summary>
                      <ol className="jt-audit">
                        <li>
                          <b>ANÁLISIS.</b> {a.analisis}
                        </li>
                        <li>
                          <b>DECISIÓN.</b> {a.decision}
                        </li>
                        <li>
                          <b>RESULTADO.</b> {a.resultado}
                        </li>
                        <li>
                          <b>{a.veredicto === "ACIERTO" ? "ACIERTO" : a.veredicto === "ERROR" ? "ERROR" : a.veredicto}.</b> {a.detalle}
                        </li>
                        <li>
                          <b>APRENDIZAJE.</b> {a.aprendizaje}
                        </li>
                      </ol>
                      {t.fuenteVelas && <p className="jt-note">Resuelta con velas de 1 h de {t.fuenteVelas}.</p>}
                    </details>
                  );
                })}
              </div>
            </>
          )}

          {groups.length > 0 && (
            <>
              <h3 className="jt-sub">Por grupo (lo que la mesa aprende, sin cambiar sus reglas)</h3>
              <div className="jt-compare">
                <table>
                  <thead>
                    <tr>
                      <th>Grupo</th>
                      <th>Cerradas</th>
                      <th>Win rate</th>
                      <th>Expectativa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <tr key={g.grupo}>
                        <td>{g.grupo}</td>
                        <td>
                          {g.stats.cerradas}
                          {g.stats.cerradas < MIN_SAMPLE ? " · mínima" : ""}
                        </td>
                        <td>{g.stats.winRate === null ? "—" : `${Math.round(g.stats.winRate * 100)}%`}</td>
                        <td>{g.stats.expectativaR === null ? "—" : r2(g.stats.expectativaR)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
      {note && <p className="jt-error">{note}</p>}
      <div className="jt-row">
        <button
          type="button"
          className="jt-mini"
          disabled={busy === "refresh"}
          onClick={async () => {
            setBusy("refresh");
            const r = await refreshPaper().catch(() => null);
            setBusy(null);
            setNote(r && r.sinDatos.length ? `Binance no respondió para ${r.sinDatos.join(", ")}: siguen sin revisar.` : "");
          }}
        >
          {busy === "refresh" ? "REVISANDO…" : "REVISAR AHORA"}
        </button>
        {trades.length > 0 && (
          <button type="button" className="jt-mini" onClick={() => download(trades)}>
            EXPORTAR CSV
          </button>
        )}
      </div>
      <p className="jt-note">
        Reglas fijas: entrada al cierre de la vela que leyó la mesa (o al tocar la límite), un tercio en cada objetivo, stop fijo, si una vela toca stop y objetivo cuenta el stop, comisión 0,05% por lado, cierre a los 7 días. Simulado: no es asesoramiento financiero.
      </p>
    </div>
  );
}
