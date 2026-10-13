"use client";

import { arNumber } from "@/lib/ai-numbers";
import { NOT_AVAILABLE } from "@/lib/jarvis-desk-agents";
import type { DeskDecision, DeskSettings } from "@/lib/jarvis-desk";
import { capitalAtRisk, council, fix2, gates, record, signed, tape, type CapitalEnRiesgo, type Consejo, type Registro, type Voto } from "@/lib/jarvis-council";
import type { PaperTrade } from "@/lib/jarvis-paper";
import { lastPrice } from "@/lib/jarvis-paper-run";
import type { usePaper } from "./jarvis-paper";

/**
 * El tablero de mando de JARVIS TRADING: la misma decisión de la mesa, vista
 * por dentro. A la izquierda el análisis (el voto de cada especialista, lo que
 * pesa y lo que aporta al consenso, y las compuertas hasta la decisión); a la
 * derecha el papel (capital en riesgo, cinta y registro medido). Son dos cosas
 * separadas: acá no hay nada que ejecute una operación.
 *
 * Todo sale de números que la mesa y el papel ya tienen. El consenso mide
 * cuánto coinciden los especialistas, no la probabilidad de acertar; lo único
 * medido es el registro del papel, siempre con cuántas operaciones lo sostienen.
 */

const pctOf = (share: number) => `${Math.round(share * 100)}%`;
const usd = (v: number) => `$${arNumber(Number(v.toFixed(2)))}`;
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const when = (t: number) => new Date(t).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const priceOf = (symbol: string) => lastPrice(symbol)?.price ?? null;
const tone = (v: number) => (v >= 0.05 ? "up" : v <= -0.05 ? "down" : "flat");

/** Una barra de −1 a +1 con el cero al medio; las marcas son umbrales de la mesa. */
function Meter({ value, marks = [], vetoMarks = [], label }: { value: number; marks?: number[]; vetoMarks?: number[]; label: string }) {
  const v = Math.max(-1, Math.min(1, value));
  const left = v >= 0 ? 50 : 50 + v * 50;
  return (
    <div className="jt-meter" role="img" aria-label={label}>
      <span className={`jt-meter-fill ${v >= 0 ? "up" : "down"}`} style={{ left: `${left}%`, width: `${Math.abs(v) * 50}%` }} />
      {vetoMarks.flatMap((m) => [-m, m]).map((m) => (
        <i key={`v${m}`} className="jt-meter-mark veto" style={{ left: `${50 + m * 50}%` }} />
      ))}
      {marks.flatMap((m) => [-m, m]).map((m) => (
        <i key={`m${m}`} className="jt-meter-mark" style={{ left: `${50 + m * 50}%` }} />
      ))}
      <i className="jt-meter-zero" />
    </div>
  );
}

function VoteRow({ v }: { v: Voto }) {
  const cls = v.estado !== "VOTA" ? "off" : v.postura === "ALCISTA" ? "up" : v.postura === "BAJISTA" ? "down" : "flat";
  const etiqueta = v.estado === "VOTA" ? v.postura : v.estado;
  const meta =
    v.estado === "VOTA"
      ? `pesa ${pctOf(v.parte)} · aporta ${signed(v.aporte)}${v.frente === "A FAVOR" ? " · a favor" : v.frente === "EN CONTRA" ? " · en contra" : ""}`
      : v.estado === "CONTEXTO"
        ? "No vota (peso 0): da contexto a los demás."
        : "Sin datos: no cuenta en el consenso, y tampoco es neutral.";
  return (
    <li>
      <details className={`jt-vote ${cls}`}>
        <summary>
          <span className="jt-vote-top">
            <span className="jt-vote-name">{v.nombre}</span>
            <i className={cls}>{etiqueta}</i>
          </span>
          {v.estado === "VOTA" && v.sesgo !== null && (
            <span className="jt-vote-line">
              <Meter value={v.sesgo} label={`${v.nombre}: voto ${signed(v.sesgo)} de −1 a +1`} />
              <span className="jt-vote-num">{signed(v.sesgo)}</span>
            </span>
          )}
          <span className="jt-vote-meta">{meta}</span>
        </summary>
        <p>{v.estado === "SIN DATOS" ? NOT_AVAILABLE : (v.hallazgo ?? NOT_AVAILABLE)}</p>
        {v.falta.length > 0 && <p className="jt-note">Falta: {v.falta.join(", ")}.</p>}
      </details>
    </li>
  );
}

function CouncilPanel({ c, d }: { c: Consejo; d: DeskDecision }) {
  const lean = tone(c.consenso);
  return (
    <div className="jt-col">
      <h3 className="jt-sub">
        Consejo de especialistas <span className="jt-tag">ANÁLISIS</span>
      </h3>
      <div className="jt-consensus">
        <div className="jt-consensus-top">
          <strong className={lean}>{signed(c.consenso)}</strong>
          <span>
            Consenso de la mesa
            <small>de −1 (bajista) a +1 (alcista)</small>
          </span>
          <em className={c.lado ? "yes" : "no"}>{c.lado ? `Alcanza para ${c.lado}` : "No alcanza para un lado"}</em>
        </div>
        <Meter value={c.consenso} marks={[c.minimo]} vetoMarks={[c.vetoContra]} label={`Consenso ${signed(c.consenso)} de −1 a +1. La mesa pide al menos ${fix2(c.minimo)} en cualquier sentido.`} />
        <div className="jt-scale" aria-hidden="true">
          <span>−1 bajista</span>
          <span>0</span>
          <span>+1 alcista</span>
        </div>
        <p className="jt-note">
          Marcas ámbar: consenso mínimo (±{fix2(c.minimo)}) para que la mesa tome un lado. Marcas rojas: desde ±{fix2(c.vetoContra)} en contra de un plan, el gestor de riesgo lo veta.
        </p>
      </div>
      <p className="jt-lead">{c.resumen}</p>
      {c.fragilidad && <p className="jt-warn">{c.fragilidad}</p>}
      <p className="jt-note">
        Datos leídos: {pctOf(c.cobertura)} del peso total · votan {c.votan}
        {c.sinDatos > 0 ? ` · ${plural(c.sinDatos, "especialista sin datos (no cuenta)", "especialistas sin datos (no cuentan)")}` : ""}.
      </p>

      <h3 className="jt-sub">Voto de cada especialista</h3>
      <ul className="jt-votes">
        {c.votos.map((v) => (
          <VoteRow key={v.id} v={v} />
        ))}
      </ul>
      <p className="jt-note">
        Cada aporte es el voto por el peso de ese especialista entre los que votan; sumados dan el consenso ({signed(c.consenso)}). Tocá uno para ver lo que encontró.
      </p>

      <h3 className="jt-sub">Del consenso a la decisión</h3>
      <ol className="jt-gates">
        {gates(d).map((g, i) => (
          <li key={g.id} className={g.estado === "OK" ? "ok" : g.estado === "FALLA" ? "no" : "na"}>
            <span className="jt-gate-mark" aria-hidden="true">
              {g.estado === "OK" ? "✓" : g.estado === "FALLA" ? "✕" : "–"}
            </span>
            <span className="jt-gate-body">
              <b>
                {i + 1}. {g.titulo} · {g.estado}
              </b>
              <span>{g.detalle}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className={`jt-gate-result ${d.direccion === "LONG" ? "long" : d.direccion === "SHORT" ? "short" : d.direccion === "NO TRADE" ? "stop" : "wait"}`}>
        Decisión: <b>{d.direccion}</b>. El gestor de riesgo manda: si veta o pide esperar, gana a cualquier confianza.
      </p>
    </div>
  );
}

function CapitalPanel({ k, aprobada }: { k: CapitalEnRiesgo; aprobada: boolean }) {
  const usado = k.riesgoAbiertoPct === null ? 0 : Math.min(100, (k.riesgoAbiertoPct / k.limitePct) * 100);
  const suma = k.conEsta && k.capital ? Math.min(100 - usado, ((k.conEsta.riesgoUsd / k.capital) * 100 / k.limitePct) * 100) : 0;
  const pasa = k.conEsta?.superaLimite === true;
  return (
    <>
      <h3 className="jt-sub">Capital en riesgo</h3>
      <div className="jt-facts">
        <span>
          Abiertas
          <b>{k.abiertas}</b>
          <small>
            {k.largos} LONG · {k.cortos} SHORT
          </small>
        </span>
        <span>
          Riesgo abierto
          <b>{usd(k.riesgoAbiertoUsd)}</b>
          <small>
            {k.riesgoAbiertoPct === null ? "capital sin cargar" : `${arNumber(Number(k.riesgoAbiertoPct.toFixed(2)))}% del capital`}
            {k.sinRiesgoCalculado > 0 ? ` · +${k.sinRiesgoCalculado} sin calcular` : ""}
          </small>
        </span>
        <span>
          Con la tarjeta de arriba
          <b className={pasa ? "alto" : ""}>{k.conEsta ? (k.conEsta.totalPct === null ? usd(k.conEsta.totalUsd) : `${arNumber(Number(k.conEsta.totalPct.toFixed(2)))}%`) : "—"}</b>
          <small>{k.conEsta ? (k.conEsta.superaLimite === null ? "sin capital cargado" : pasa ? `pasa el límite de ${arNumber(k.limitePct)}%` : `dentro del límite de ${arNumber(k.limitePct)}%`) : aprobada ? "sin capital cargado: riesgo sin calcular" : "la tarjeta no es una operación aprobada"}</small>
        </span>
        <span>
          Resultado abierto
          <b className={k.resultadoAbiertoR === null ? "" : k.resultadoAbiertoR >= 0 ? "bajo" : "alto"}>{k.resultadoAbiertoR === null ? "sin dato" : `${signed(k.resultadoAbiertoR)} R`}</b>
          <small>{k.sinPrecio > 0 ? `sin precio de ${k.sinPrecio}` : "con el último cierre revisado"}</small>
        </span>
      </div>
      {k.riesgoAbiertoPct !== null && (
        <>
          <div className="jt-gauge" role="img" aria-label={`Riesgo abierto ${arNumber(Number(k.riesgoAbiertoPct.toFixed(2)))}% del capital, límite ${arNumber(k.limitePct)}%`}>
            <span className={`used${usado >= 100 ? " over" : ""}`} style={{ width: `${usado}%` }} />
            {suma > 0 && <span className={`add${pasa ? " over" : ""}`} style={{ left: `${usado}%`, width: `${suma}%` }} />}
          </div>
          <p className="jt-note">
            Lleno: lo que está en juego hoy. Rayado: lo que sumaría la tarjeta de arriba. El borde derecho es el límite de {arNumber(k.limitePct)}% del capital.
          </p>
        </>
      )}
      {k.notas.length > 0 && (
        <ul className="jt-list">
          {k.notas.map((n) => (
            <li key={n} className="warn">
              {n}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function TapePanel({ trades }: { trades: PaperTrade[] }) {
  const rows = tape(trades, priceOf);
  return (
    <>
      <h3 className="jt-sub">Cinta de papel</h3>
      {!rows.length ? (
        <p className="jt-note">Todavía no hay operaciones de papel. Con un plan aprobado, tocá «Simular en papel» en la tarjeta.</p>
      ) : (
        <ul className="jt-tape">
          {rows.map((r) => (
            <li key={r.id} className={r.tono}>
              <b>
                {r.lado} {r.moneda}
              </b>
              <span className={`jt-r ${r.tono}`}>{r.texto}</span>
              <time>{when(r.cuando)}</time>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function RecordPanel({ r }: { r: Registro }) {
  const pf = r.profitFactor === null ? "sin dato" : r.profitFactor === Infinity ? "∞" : arNumber(Number(r.profitFactor.toFixed(2)));
  const de = `de ${r.cerradas}${r.muestra === "MUESTRA MÍNIMA" ? " · muestra mínima" : ""}`;
  return (
    <>
      <h3 className="jt-sub">Registro medido</h3>
      {r.cerradas > 0 && (
        <div className="jt-facts">
          <span>
            Cerradas
            <b>{r.cerradas}</b>
            <small>{plural(r.ganadas, "ganada", "ganadas")}</small>
          </span>
          <span>
            Acierto
            <b>{r.winRate === null ? "sin dato" : pctOf(r.winRate)}</b>
            <small>{de}</small>
          </span>
          <span>
            Profit factor
            <b>{pf}</b>
            <small>{de}</small>
          </span>
          <span>
            Expectativa
            <b>{r.expectativaR === null ? "sin dato" : `${signed(r.expectativaR)} R`}</b>
            <small>por operación · {de}</small>
          </span>
        </div>
      )}
      <p className={`jt-note ${r.muestra === "MUESTRA RAZONABLE" ? "" : "jt-warn"}`}>{r.nota}</p>
    </>
  );
}

function PaperPanel({ d, settings, paper }: { d: DeskDecision; settings: DeskSettings; paper: ReturnType<typeof usePaper> }) {
  return (
    <div className="jt-col">
      <h3 className="jt-sub">
        Papel <span className="jt-tag jt-tag-paper">PAPEL · SIMULADO</span>
      </h3>
      <p className="jt-note">{paper.mode === "cuenta" ? "Guardado en tu cuenta." : paper.mode === "equipo" ? "Sin sesión: se guarda solo en este equipo." : paper.error}</p>
      {!paper.loaded ? (
        <p className="jt-muted">Leyendo tu registro de papel…</p>
      ) : (
        <>
          <CapitalPanel k={capitalAtRisk(paper.trades, settings, d, priceOf)} aprobada={d.direccion === "LONG" || d.direccion === "SHORT"} />
          <TapePanel trades={paper.trades} />
          <RecordPanel r={record(paper.trades)} />
        </>
      )}
    </div>
  );
}

/** El tablero completo: consejo y compuertas (análisis) junto al papel. */
export function CommandBoard({ d, settings, paper }: { d: DeskDecision; settings: DeskSettings; paper: ReturnType<typeof usePaper> }) {
  const c = council(d);
  return (
    <details className="jt-block jt-board" open>
      <summary>Tablero de mando · consejo y papel</summary>
      <div className="jt-board-grid">
        <CouncilPanel c={c} d={d} />
        <PaperPanel d={d} settings={settings} paper={paper} />
      </div>
      <p className="jt-note">
        El consenso mide cuánto coinciden los especialistas, no la probabilidad de acertar: lo único medido es el registro del papel, con su muestra. Este tablero no ejecuta nada en ninguna cuenta. Los resultados simulados no garantizan resultados futuros. No es asesoramiento financiero.
      </p>
    </details>
  );
}
