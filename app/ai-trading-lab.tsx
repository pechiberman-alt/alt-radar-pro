"use client";

import { useEffect, useRef, useState } from "react";
import { useRegistro, useVivo } from "./arana-vivo";
import { iniciarAgenteSt } from "../lib/agente-st-run.ts";
import LabAgenteSt from "./lab-agente-st";
import { BACKTEST_DAYS, runBacktestFor } from "../lib/jarvis-backtest-run.ts";
import { PAPER_EVENT, paperTrades } from "../lib/jarvis-paper-run.ts";
import { agentesDe, centroDe, type EstadoMotor, type FotoLab } from "../lib/lab.ts";
import { DESLIZAMIENTO_DEFECTO_PCT, evaluarBacktest, FRACCION_EVALUACION, type Evaluacion, type MetricasTramo } from "../lib/lab-evaluacion.ts";
import { respuestaLab } from "../lib/lab-jarvis.ts";
import { operacionDePapel, TOPES, type LimitesRiesgo } from "../lib/lab-riesgo.ts";
import { fijarBacktest, fijarError, fijarEvaluacion, fotoLab, guardarLimites, LAB_EVENT, registrarActividad } from "../lib/lab-run.ts";
import { lineaFuente } from "../lib/registro.ts";
import LabAxiDiario from "./lab-axi-diario";
import LabFondeo from "./lab-fondeo";
import LabUniversos from "./lab-universos";
import PracticaGatillo from "./practica-gatillo";
import { lecturaTramo, veredictoNovato } from "../lib/lectura-novato.ts";
import { MONEDAS_PRACTICA } from "../lib/practica-gatillo.ts";
import AprenderLab from "./aprender-lab";
import LabPiso from "./lab-piso";
import LabOficina from "./lab-oficina";

/**
 * AI TRADING LAB · LA ARAÑA — CENTRO DE OPERACIONES. Junta en un panel para el celular el estado real del motor de la
 * araña, los agentes, el backtest evaluado por tramos, el papel con el gestor de riesgo central y las preguntas a JARVIS.
 * Solo simulación: no hay ningún camino a una orden real. Sin dato de avance, el avance es indeterminado.
 */

type Pestana = "aprender" | "centro" | "oficina" | "agentes" | "practica" | "backtest" | "riesgo" | "jarvis" | "actividad";
const PESTANAS: [Pestana, string][] = [
  ["aprender", "APRENDER"],
  ["practica", "PRÁCTICA"],
  ["centro", "CENTRO"],
  ["oficina", "OFICINA"],
  ["agentes", "AGENTES"],
  ["backtest", "BACKTEST"],
  ["riesgo", "PAPEL Y RIESGO"],
  ["jarvis", "JARVIS"],
  ["actividad", "ACTIVIDAD"],
];

const PREGUNTAS = [
  "¿Qué está haciendo La Araña?",
  "¿Qué encontró el último análisis?",
  "¿Qué estrategias estamos evaluando?",
  "¿Cuál tiene mejor rendimiento histórico?",
  "¿Cuál presenta el mayor drawdown?",
  "¿Qué riesgos detectaste?",
  "¿Qué datos faltan para confiar en este resultado?",
  "¿Qué pruebas conviene ejecutar después?",
];

const CAMPOS: [keyof LimitesRiesgo, string, number][] = [
  ["riesgoMaxPct", "Riesgo máx. por operación (%)", 0.1],
  ["maxPosiciones", "Posiciones abiertas máx.", 1],
  ["exposicionMaxR", "Riesgo abierto máx. (R)", 1],
  ["perdidaDiariaMaxR", "Pérdida diaria máx. (R)", 0.5],
  ["drawdownMaxR", "Caída máx. desde el pico (R)", 1],
  ["maxPorActivo", "Posiciones por activo", 1],
  ["maxPorEstrategia", "Posiciones por estrategia", 1],
  ["rrMinimo", "R:R mínimo", 0.1],
];

const coma = (v: number, d = 2) => v.toFixed(d).replace(".", ",");
const hora = (t: number) => new Date(t).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
const pctTxt = (v: number | null) => (v === null ? "sin dato" : `${Math.round(v * 100)} %`);
const rTxt = (v: number | null) => (v === null ? "sin dato" : `${v > 0 ? "+" : ""}${coma(v)} R`);

/** La foto del laboratorio, rearmada cuando cambia algo de verdad (escaneo, papel, backtest, riesgo, conexión). */
function useLab(): FotoLab | null {
  const vivo = useVivo();
  useRegistro();
  const [foto, setFoto] = useState<FotoLab | null>(null);
  // El agente de papel Supertrend MTF + Volumen corre hacia adelante mientras el laboratorio está abierto y con sesión.
  useEffect(() => iniciarAgenteSt(), []);
  useEffect(() => {
    let activo = true;
    const armarFoto = () => {
      if (!activo) return;
      setFoto(fotoLab({ vivo, operaciones: paperTrades().map((t) => operacionDePapel(t)), ahora: Date.now(), enLinea: navigator.onLine !== false, autoPausado: false }));
    };
    const eventos = [LAB_EVENT, PAPER_EVENT, "online", "offline"];
    for (const e of eventos) window.addEventListener(e, armarFoto);
    void (async () => {
      await Promise.resolve();
      armarFoto();
    })();
    return () => {
      activo = false;
      for (const e of eventos) window.removeEventListener(e, armarFoto);
    };
  }, [vivo]);
  return foto;
}

const PATAS = 8;

function Arana({ estado, progreso }: { estado: EstadoMotor; progreso: number | null }) {
  const patas = Array.from({ length: PATAS }, (_, k) => {
    const lado = k < PATAS / 2 ? -1 : 1;
    const i = k % (PATAS / 2);
    const y = 46 + i * 9;
    return `M ${60 + lado * 8} ${y} Q ${60 + lado * 34} ${y - 22 + i * 4} ${60 + lado * 52} ${y + 6 + i * 6}`;
  });
  return (
    <figure className={`lab-arana lab-arana-${estado}`} aria-label={`La araña: ${estado}`}>
      <svg viewBox="0 0 120 110" role="img" aria-hidden="true">
        <circle className="lab-red" cx="60" cy="58" r="50" />
        <circle className="lab-red" cx="60" cy="58" r="32" />
        {patas.map((d, k) => (
          <path key={k} d={d} className="lab-pata" style={{ animationDelay: `${k * 0.12}s` }} />
        ))}
        <ellipse className="lab-torso" cx="60" cy="62" rx="12" ry="15" />
        <circle className="lab-cabeza" cx="60" cy="43" r="7" />
        <circle className="lab-ojo" cx="57.5" cy="42" r="1.3" />
        <circle className="lab-ojo" cx="62.5" cy="42" r="1.3" />
      </svg>
      {progreso !== null ? (
        <div className="lab-barra" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progreso * 100)}>
          <span style={{ width: `${Math.round(progreso * 100)}%` }} />
        </div>
      ) : estado === "scanning" || estado === "processing" || estado === "initializing" ? (
        <div className="lab-barra lab-indeterminada" role="progressbar" aria-valuetext="avance desconocido">
          <span />
        </div>
      ) : null}
    </figure>
  );
}

/** El veredicto en castellano de una corrida: lo primero que ve quien no sabe leer las métricas. */
function Veredicto({ ev }: { ev: Evaluacion }) {
  const v = veredictoNovato(ev);
  return (
    <div className={`lab-veredicto lab-v-${v.fuerza.replace(/ /g, "-").toLowerCase()}`} role="status">
      <p className="lab-veredicto-fuerza">{v.fuerza}</p>
      <p className="lab-veredicto-titulo">{v.titulo}</p>
      <ul>
        {v.porque.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
      <p className="lab-veredicto-hacer">
        <strong>Qué hacer:</strong> {v.queHacer}
      </p>
    </div>
  );
}

function Tramo({ m }: { m: MetricasTramo }) {
  const filas: [string, string][] = [
    ["Operaciones", `${m.operaciones} (${m.muestra.toLowerCase()})`],
    ["Acierto", pctTxt(m.winRate)],
    ["Ganancia media", rTxt(m.gananciaMediaR)],
    ["Pérdida media", m.perdidaMediaR === null ? "sin dato" : `−${coma(m.perdidaMediaR)} R`],
    ["Ganancia/pérdida", m.relacionGP === null ? "sin dato" : coma(m.relacionGP)],
    ["Profit factor", m.profitFactor === null ? "sin dato" : coma(m.profitFactor)],
    ["Bruto", rTxt(m.brutoR)],
    ["Neto (comisiones)", rTxt(m.netoR)],
    ["Neto con deslizamiento", rTxt(m.conDeslizamientoR)],
    ["Caída máxima", `${coma(m.maxDrawdownR)} R`],
    ["Duración media", m.duracionMediaH === null ? "sin dato" : `${coma(m.duracionMediaH, 1)} h`],
    ["Exposición", pctTxt(m.exposicion)],
  ];
  return (
    <div className="lab-tramo">
      <h4>{m.tramo}</h4>
      <dl>
        {filas.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function AiTradingLab() {
  const f = useLab();
  const [pestana, setPestana] = useState<Pestana>("centro");
  const [moneda, setMoneda] = useState("BTC");
  const [dias, setDias] = useState<number>(90);
  const [slip, setSlip] = useState(String(DESLIZAMIENTO_DEFECTO_PCT).replace(".", ","));
  const [pregunta, setPregunta] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<LimitesRiesgo | null>(null);
  const corriendo = useRef<AbortController | null>(null);

  if (!f) return <section className="panel lab lab-cargando">ARMANDO EL LABORATORIO…</section>;
  const c = centroDe(f);
  const agentes = agentesDe(f);
  const lim = borrador ?? f.limites;
  const ev = f.evaluacion;

  async function correrBacktest() {
    if (corriendo.current) return;
    const ctl = new AbortController();
    corriendo.current = ctl;
    const s = Number(slip.replace(",", "."));
    fijarError(null);
    fijarBacktest({ hechos: 0, total: 0 });
    registrarActividad(`Backtest de ${moneda.toUpperCase()} en ${dias} días: bajando historia de Binance.`, "info");
    const r = await runBacktestFor(moneda, dias, (p) => fijarBacktest(p.fase === "mesa" ? { hechos: p.hechos, total: p.total } : { hechos: 0, total: 0 }), ctl.signal);
    corriendo.current = null;
    fijarBacktest(null);
    if (!r.ok) return fijarError(r.error);
    fijarEvaluacion(evaluarBacktest(r.result, Number.isFinite(s) ? s : DESLIZAMIENTO_DEFECTO_PCT));
    if (r.nota) registrarActividad(r.nota, "aviso");
  }

  return (
    <section className={`panel lab${f.enLinea ? "" : " lab-desconectado"}`} aria-label="AI TRADING LAB">
      <div className="panel-head">
        <div>
          <p className="eyebrow">AI TRADING LAB · LA ARAÑA — CENTRO DE OPERACIONES</p>
          <h2>La araña está {c.texto}</h2>
        </div>
      </div>
      <p className="lab-aviso">Simulación y paper trading: nada opera con dinero real. Lo medido en el pasado no garantiza resultados. No es asesoramiento financiero.</p>
      {!f.enLinea && <p className="lab-error">Sin conexión: no se leen precios y no se generan operaciones simuladas hasta que vuelva.</p>}
      <div className="lab-tabs" role="tablist" aria-label="Secciones del laboratorio">
        {PESTANAS.map(([id, txt]) => (
          <button key={id} type="button" role="tab" aria-selected={pestana === id} onClick={() => setPestana(id)}>
            {txt}
          </button>
        ))}
      </div>

      {pestana === "centro" && (
        <div className="lab-cuerpo">
          <div className="lab-centro">
            <Arana estado={c.estado} progreso={c.progreso} />
            <ul className="lab-tareas">
              {c.tareas.map((t) => (
                <li key={t.id} className={`lab-tarea lab-t-${t.estado.replace(" ", "-")}`}>
                  <b>{t.nombre}</b> <span>{t.estado}{t.progreso !== null && t.estado === "corriendo" ? ` · ${Math.round(t.progreso * 100)} %` : ""}</span>
                  <small>{t.detalle}</small>
                </li>
              ))}
            </ul>
          </div>
          {c.errores.map((e) => (
            <p key={e} className="lab-error">{e}</p>
          ))}
          {c.avisos.map((a) => (
            <p key={a} className="lab-nota">{a}</p>
          ))}
          <h3 className="lab-sub">Conexiones</h3>
          <ul className="lab-conexiones">
            <li className={f.enLinea ? "ok" : "mal"}>Red: {f.enLinea ? "en línea" : "sin conexión"}</li>
            <li className={f.vivo && f.vivo.escaneo.estado !== "sin datos" ? "ok" : "mal"}>Escaneo de Binance: {f.vivo?.escaneo.haceMin != null ? `hace ${f.vivo.escaneo.haceMin} min` : "sin lectura"}</li>
            <li className={f.vivo?.registro ? "ok" : "mal"}>Registro unificado: {f.vivo?.registro ? "leído" : "sin leer"}</li>
            <li className={f.vivo?.registro?.fuentes.some((x) => x.ambito === "CUENTA" && x.disponible) ? "ok" : "mal"}>Tu cuenta: {f.vivo?.registro?.fuentes.some((x) => x.ambito === "CUENTA" && x.disponible) ? "con sesión" : "sin sesión (papel en este equipo)"}</li>
            <li className="ok">Ejecución real: bloqueada en este laboratorio</li>
          </ul>
        </div>
      )}

      {pestana === "oficina" && (
        <div className="lab-cuerpo">
          <LabOficina />
        </div>
      )}

      {pestana === "agentes" && (
        <div className="lab-cuerpo lab-agentes">
          <LabFondeo />
          <LabAxiDiario />
          <LabUniversos />
          <LabPiso />
          <LabAgenteSt />
          <h3 className="lab-sub">Los agentes de la araña</h3>
          {agentes.map((a) => (
            <article key={a.id} className={`lab-agente lab-a-${a.estado.replace(" ", "-")}`}>
              <header>
                <b>{a.nombre}</b> <span>{a.estado}</span>
              </header>
              <p>{a.rol}</p>
              <small>Entra: {a.entradas.join(" · ")}</small>
              <small>Sale: {a.salidas.join(" · ")}</small>
              <small>Módulos: {a.modulos.join(", ")}</small>
              <small>{a.detalle}</small>
              {a.pendiente.map((p) => (
                <small key={p} className="lab-pendiente">Pendiente: {p}</small>
              ))}
              {a.errores.map((e) => (
                <small key={e} className="lab-error">{e}</small>
              ))}
            </article>
          ))}
        </div>
      )}

      {pestana === "aprender" && (
        <div className="lab-cuerpo">
          <AprenderLab />
        </div>
      )}
      {pestana === "practica" && (
        <div className="lab-cuerpo">
          <PracticaGatillo />
        </div>
      )}
      {pestana === "backtest" && (
        <div className="lab-cuerpo">
          <form
            className="lab-form"
            onSubmit={(e) => {
              e.preventDefault();
              void correrBacktest();
            }}
          >
            <label>
              Moneda
              <input list="lab-monedas" value={moneda} onChange={(e) => setMoneda(e.target.value.replace(/[^a-z0-9]/gi, "").slice(0, 12))} inputMode="text" autoCapitalize="characters" />
              <datalist id="lab-monedas">
                {MONEDAS_PRACTICA.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            <label>
              Período
              <select value={dias} onChange={(e) => setDias(Number(e.target.value))}>
                {BACKTEST_DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d} días
                  </option>
                ))}
              </select>
            </label>
            <label>
              Deslizamiento por lado (%)
              <input value={slip} onChange={(e) => setSlip(e.target.value)} inputMode="decimal" />
            </label>
            <div className="lab-botones">
              <button type="submit" disabled={Boolean(f.backtestEnCurso) || !f.enLinea}>
                {f.backtestEnCurso ? "CORRIENDO…" : "CORRER BACKTEST"}
              </button>
              {f.backtestEnCurso && (
                <button type="button" onClick={() => corriendo.current?.abort()}>
                  CANCELAR
                </button>
              )}
            </div>
          </form>
          <p className="lab-nota">La misma mesa y las mismas reglas del papel, caminando hacia adelante sobre velas cerradas de Binance. El último {Math.round(FRACCION_EVALUACION * 100)} % del período queda para EVALUACIÓN, fijado antes de mirar. Comisión 0,05 % por lado; el deslizamiento es un supuesto.</p>
          {f.ultimoError && <p className="lab-error">{f.ultimoError}</p>}
          {ev ? (
            <>
              <p className="lab-nota">
                {ev.symbol.replace(/USDT$/, "")} · reglas v{ev.reglas} · {ev.fuente} · corrida <code>{ev.id}</code>
              </p>
              <Veredicto ev={ev} />
              <div className="lab-tramos">
                <Tramo m={ev.desarrollo} />
                <Tramo m={ev.evaluacion} />
              </div>
              <details className="lab-lectura">
                <summary>¿Qué quieren decir estos números?</summary>
                {[ev.desarrollo, ev.evaluacion].map((m) => {
                  const l = lecturaTramo(m);
                  return (
                    <div key={m.tramo}>
                      <h4>{l.titulo}</h4>
                      <ul>
                        {l.frases.map((x) => (
                          <li key={x}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </details>
              <ul className="lab-calidad">
                {ev.calidad.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </>
          ) : (
            !f.backtestEnCurso && <p className="lab-vacio">Todavía no corriste un backtest en esta sesión.</p>
          )}
        </div>
      )}

      {pestana === "riesgo" && (
        <div className="lab-cuerpo">
          <p className={f.cartera.suspendida ? "lab-error" : "lab-nota"}>
            {f.cartera.suspendida
              ? `Operaciones nuevas suspendidas: ${f.cartera.motivoSuspension}.`
              : `Cartera simulada: ${f.cartera.abiertas} de ${f.limites.maxPosiciones} posiciones · pérdida de hoy ${coma(f.cartera.perdidaHoyR)} R · caída máxima ${coma(f.cartera.drawdownR)} R.`}
          </p>
          <h3 className="lab-sub">Registro de cada estrategia</h3>
          {f.vivo?.registro ? (
            <ul className="lab-registro">
              {f.vivo.registro.fuentes.map((x) => (
                <li key={x.id}>{lineaFuente(x)}</li>
              ))}
            </ul>
          ) : (
            <p className="lab-vacio">El registro todavía no se leyó.</p>
          )}
          <h3 className="lab-sub">Límites del gestor de riesgo</h3>
          <form
            className="lab-form lab-limites"
            onSubmit={(e) => {
              e.preventDefault();
              guardarLimites(lim);
              setBorrador(null);
            }}
          >
            {CAMPOS.map(([k, txt, paso]) => (
              <label key={k}>
                {txt}
                <input
                  type="number"
                  step={paso}
                  min={TOPES[k].min}
                  max={TOPES[k].max}
                  value={lim[k]}
                  onChange={(e) => setBorrador({ ...lim, [k]: Number(e.target.value) })}
                />
                <small>
                  entre {coma(TOPES[k].min, 1)} y {coma(TOPES[k].max, 1)}
                </small>
              </label>
            ))}
            <div className="lab-botones">
              <button type="submit" disabled={!borrador}>
                GUARDAR LÍMITES
              </button>
            </div>
          </form>
          <p className="lab-nota">Los límites se aplican en el motor de papel y en el servidor, no solo acá. Lo que pase los topes se recorta: ningún agente puede aflojarlos ni apagar la compuerta.</p>
        </div>
      )}

      {pestana === "jarvis" && (
        <div className="lab-cuerpo">
          <div className="lab-preguntas">
            {PREGUNTAS.map((q) => (
              <button key={q} type="button" aria-pressed={pregunta === q} onClick={() => setPregunta(q)}>
                {q}
              </button>
            ))}
          </div>
          {pregunta ? <p className="lab-respuesta">{respuestaLab(pregunta, f) ?? "No tengo datos del laboratorio para eso."}</p> : <p className="lab-vacio">Tocá una pregunta. JARVIS responde con los datos de esta pantalla; en el chat de JARVIS también las entiende.</p>}
        </div>
      )}

      {pestana === "actividad" && (
        <div className="lab-cuerpo">
          {c.actividad.length ? (
            <ol className="lab-actividad">
              {c.actividad.map((a, k) => (
                <li key={`${a.cuando}-${k}`} className={`lab-act-${a.tono}`}>
                  <time dateTime={new Date(a.cuando).toISOString()}>{hora(a.cuando)}</time> {a.texto}
                </li>
              ))}
            </ol>
          ) : (
            <p className="lab-vacio">Sin actividad todavía en esta sesión.</p>
          )}
        </div>
      )}
    </section>
  );
}
