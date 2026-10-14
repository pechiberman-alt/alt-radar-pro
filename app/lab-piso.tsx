"use client";

import { useState } from "react";
import { ESTUDIO_FILAS, ESTUDIO_META, type FilaEstudio } from "../lib/estudio-estrategias-datos.ts";
import {
  CONEXION_TEXTO,
  combatientes,
  conexionCerebro,
  controlDelMarco,
  marcosDisponibles,
  nombreCorto,
  partirNombre,
  posicion,
  repartirAnillos,
  textoCombatiente,
  tonoBarra,
  tonoNumero,
  topeEscala,
  type Combatiente,
} from "../lib/lab-arena.ts";
import MiniArana from "./lab-mini-arana.tsx";

/**
 * El piso de estrategias del AI TRADING LAB. El cerebro (JARVIS) va al centro y cada agente lo rodea con su mini araña, uno por
 * estrategia. El borde sale del veredicto medido en la EVALUACIÓN (lib/estudio-estrategias-datos.ts): verde con ventaja, ámbar
 * sin conclusión, rojo sin ventaja, gris el control al azar. La línea al cerebro es sólida si el agente corre en papel y
 * punteada si solo está medido en el pasado. Abajo, la arena los pone a competir: barras de R por operación con su intervalo
 * del 90 % y la raya del control. Nada inventa ni anima resultados: los datos son los del estudio, con su muestra.
 */

type Agente = { id: string; agente: string; nombre: string; regla: string; filas: FilaEstudio[]; mejor: FilaEstudio };

const ORDEN_VEREDICTO: Record<string, number> = { VENTAJA: 0, CANDIDATA: 1, "SIN CONCLUSIÓN": 2, CONTROL: 3, "SIN VENTAJA": 4 };

function agentes(): Agente[] {
  const por = new Map<string, FilaEstudio[]>();
  for (const f of ESTUDIO_FILAS) por.set(f.estrategia, [...(por.get(f.estrategia) ?? []), f]);
  return [...por.entries()].map(([id, filas]) => {
    // Su mejor resultado en evaluación: primero el veredicto, después la expectancia.
    const mejor = [...filas].sort(
      (a, b) => (ORDEN_VEREDICTO[a.veredicto] ?? 9) - (ORDEN_VEREDICTO[b.veredicto] ?? 9) || (b.evaluacion.expectancia ?? -9) - (a.evaluacion.expectancia ?? -9),
    )[0];
    return { id, agente: filas[0].agente, nombre: filas[0].nombre, regla: filas[0].regla, filas, mejor };
  });
}

const tono = (v: string) => (v === "VENTAJA" ? "gana" : v === "SIN VENTAJA" ? "pierde" : v === "CONTROL" ? "control" : "duda");
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);
const r2 = (v: number | null) => {
  if (v === null) return "—";
  const x = Math.round(v * 100) / 100 || 0; // sin «-0,00»
  return `${x > 0 ? "+" : ""}${x.toFixed(2).replace(".", ",")} R`;
};
const n2 = (v: number | null) => (v === null ? "—" : v.toFixed(2).replace(".", ","));

// El piso: el cerebro al centro y dos anillos de agentes.
const ANCHO = 380;
const ALTO = 412;
const CENTRO = { x: ANCHO / 2, y: 200 };
const RADIO_NODO = 19;

function Nodo({ a, x, y, activo, elegir }: { a: Agente; x: number; y: number; activo: boolean; elegir: () => void }) {
  const ev = a.mejor.evaluacion;
  const renglones = partirNombre(nombreCorto(a.agente));
  const yTexto = y + RADIO_NODO + 9;
  return (
    <g
      className={`piso-nodo piso-${tono(a.mejor.veredicto)}${activo ? " piso-activa" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`${a.agente}: ${a.mejor.veredicto}`}
      aria-pressed={activo}
      onClick={elegir}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), elegir())}
    >
      {activo && <circle className="piso-nodo-aro" cx={x} cy={y} r={RADIO_NODO + 4} />}
      <circle className="piso-nodo-disco" cx={x} cy={y} r={RADIO_NODO} />
      <MiniArana x={x} y={y + 0.5} escala={1.15} activa={activo} />
      {renglones.map((t, k) => (
        <text key={k} className="piso-rotulo" x={x} y={yTexto + k * 8.5} textAnchor="middle">
          {t}
        </text>
      ))}
      <text className={`piso-valor piso-valor-${tonoNumero(a.mejor.veredicto)}`} x={x} y={yTexto + renglones.length * 8.5 + 1} textAnchor="middle">
        {r2(ev.expectancia)} · {a.mejor.marco}
      </text>
    </g>
  );
}

function Cerebro() {
  return (
    <g className="piso-cerebro" aria-hidden="true">
      <circle className="piso-cerebro-pulso" cx={CENTRO.x} cy={CENTRO.y} r={34} />
      <circle className="piso-cerebro-disco" cx={CENTRO.x} cy={CENTRO.y} r={30} />
      <g transform={`translate(${CENTRO.x} ${CENTRO.y})`}>
        <path className="piso-cerebro-lobulo" d="M -15 3 C -18 -9 -5 -17 0 -10 C 5 -17 18 -9 15 3 C 18 13 5 17 0 12 C -5 17 -18 13 -15 3 Z" />
        <path className="piso-cerebro-surco" d="M 0 -10 V 12 M -9 -3 Q -5 -1 -9 3 M 9 -3 Q 5 -1 9 3 M -8 7 Q -4 8 -2 5 M 8 7 Q 4 8 2 5" />
      </g>
      <text className="piso-cerebro-rotulo" x={CENTRO.x} y={CENTRO.y + 44} textAnchor="middle">
        CEREBRO · JARVIS
      </text>
    </g>
  );
}

function Barra({ c, tope, control }: { c: Combatiente; tope: number; control: number | null }) {
  const e = c.expectancia;
  const p = e === null ? 0 : posicion(e, tope);
  const izq = p >= 0 ? 50 : 50 + p * 50;
  const ancho = Math.abs(p) * 50;
  const ic = c.ic;
  const lo = ic ? posicion(ic.low, tope) : 0;
  const hi = ic ? posicion(ic.high, tope) : 0;
  const clase = tonoBarra(c.veredicto);
  return (
    <div className={`arena-pista arena-${clase}`} aria-hidden="true">
      <span className="arena-cero" />
      {e !== null && <span className="arena-barra" style={{ left: `${izq}%`, width: `${ancho}%` }} />}
      {ic && <span className="arena-ic" style={{ left: `${50 + lo * 50}%`, width: `${(hi - lo) * 50}%` }} />}
      {control !== null && c.conexion !== "CONTROL" && <span className="arena-control" style={{ left: `${50 + posicion(control, tope) * 50}%` }} />}
    </div>
  );
}

const MARCO_TEXTO = (m: string) => (m === "todos" ? "TODAS" : m.toUpperCase());

export default function LabPiso() {
  const lista = agentes();
  const [elegido, setElegido] = useState<string>(lista[0]?.id ?? "");
  const [marco, setMarco] = useState<string>("todos");
  const [verTodas, setVerTodas] = useState(false);
  const a = lista.find((x) => x.id === elegido) ?? lista[0];
  // El control al azar no es un agente: va aparte y sin conexión al cerebro.
  // Los que mejor rinden, cerca del cerebro (anillo de adentro): ordenados por R por operación de su mejor temporalidad.
  const agentesAnillo = lista.filter((x) => x.id !== "AZAR").sort((p, q) => (q.mejor.evaluacion.expectancia ?? -9) - (p.mejor.evaluacion.expectancia ?? -9));
  const azar = lista.find((x) => x.id === "AZAR");
  const lugares = repartirAnillos(agentesAnillo.length, CENTRO, 84, 152);
  const nodos = agentesAnillo.map((ag, k) => ({ ag, px: lugares[k].x, py: lugares[k].y }));

  const marcos = marcosDisponibles(ESTUDIO_FILAS);
  const cs = combatientes(ESTUDIO_FILAS, marco);
  const tope = topeEscala(cs);
  const visibles = verTodas ? cs : cs.slice(0, 10);
  const cuenta = (v: string) => ESTUDIO_FILAS.filter((f) => f.veredicto === v).length;
  const nEnPapel = agentesAnillo.filter((x) => conexionCerebro(x.id) === "PAPEL").length;

  return (
    <section className="piso" aria-label="Piso de estrategias">
      <h3 className="lab-sub">Piso de estrategias · cada agente estudia una</h3>
      <p className="lab-nota">
        {ESTUDIO_META.monedas.length} monedas, velas de Binance del {ESTUDIO_META.datosDesde.split("-").reverse().join("/")} al{" "}
        {ESTUDIO_META.datosHasta.split("-").reverse().join("/")}, con costos de {String(ESTUDIO_META.costoPorLadoPct).replace(".", ",")} % por lado. Todo sale de la
        evaluación (después del {ESTUDIO_META.corte.split("-").reverse().join("/")}), que no se miró al elegir las reglas.
      </p>
      <ul className="piso-resumen" aria-label="Cuántas mediciones hay por veredicto">
        <li className="piso-gana">
          <b>{cuenta("VENTAJA")}</b> ventaja
        </li>
        <li className="piso-cand">
          <b>{cuenta("CANDIDATA")}</b> candidata
        </li>
        <li className="piso-duda">
          <b>{cuenta("SIN CONCLUSIÓN")}</b> sin conclusión
        </li>
        <li className="piso-pierde">
          <b>{cuenta("SIN VENTAJA")}</b> sin ventaja
        </li>
      </ul>
      <svg className="piso-svg" viewBox={`0 0 ${ANCHO} ${ALTO}`} role="group" aria-label="Los agentes alrededor del cerebro">
        <circle className="piso-guia" cx={CENTRO.x} cy={CENTRO.y} r={84} />
        <circle className="piso-guia" cx={CENTRO.x} cy={CENTRO.y} r={152} />
        {nodos.map(({ ag, px, py }) => (
          <line
            key={`c-${ag.id}`}
            className={`piso-cable piso-cable-${conexionCerebro(ag.id) === "PAPEL" ? "papel" : "estudio"}${ag.id === a?.id ? " piso-cable-activo" : ""}`}
            x1={px}
            y1={py}
            x2={CENTRO.x}
            y2={CENTRO.y}
          />
        ))}
        <Cerebro />
        {nodos.map(({ ag, px, py }) => (
          <Nodo key={ag.id} a={ag} x={px} y={py} activo={ag.id === a?.id} elegir={() => setElegido(ag.id)} />
        ))}
        {azar && <Nodo a={azar} x={42} y={ALTO - 50} activo={azar.id === a?.id} elegir={() => setElegido(azar.id)} />}
      </svg>
      <ul className="piso-leyenda" aria-label="Cómo leer el piso">
        <li>
          <i className="piso-leyenda-linea piso-leyenda-papel" /> En papel ({nEnPapel}): corre hacia adelante y registra sus entradas
        </li>
        <li>
          <i className="piso-leyenda-linea piso-leyenda-estudio" /> Solo estudio: el cerebro lee su resultado medido
        </li>
        <li>El borde es el veredicto; el número, su R por operación en su mejor temporalidad (verde o rojo solo si el veredicto es decisivo)</li>
      </ul>
      {a && (
        <article className={`piso-ficha piso-${tono(a.mejor.veredicto)}`} aria-live="polite">
          <header>
            <b>{a.agente}</b> <span>{a.mejor.veredicto}</span>
          </header>
          <p>
            {a.nombre}. {a.regla}
          </p>
          <p className="piso-conexion">{CONEXION_TEXTO[conexionCerebro(a.id)]}.</p>
          <div className="piso-tabla-wrap">
            <table className="piso-tabla">
              <thead>
                <tr>
                  <th>Velas</th>
                  <th>Oper.</th>
                  <th>Acierto</th>
                  <th>TP1</th>
                  <th>TP2</th>
                  <th>TP3</th>
                  <th>PF</th>
                  <th>R/oper.</th>
                </tr>
              </thead>
              <tbody>
                {a.filas.map((f) => (
                  <tr key={f.marco}>
                    <td>{f.marco}</td>
                    <td>{f.evaluacion.operaciones}</td>
                    <td>{pct(f.evaluacion.winRate)}</td>
                    <td>{pct(f.evaluacion.tasaTp1)}</td>
                    <td>{pct(f.evaluacion.tasaTp2)}</td>
                    <td>{pct(f.evaluacion.tasaTp3)}</td>
                    <td>{n2(f.evaluacion.profitFactor)}</td>
                    <td>{r2(f.evaluacion.expectancia)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <small>
            Intervalo del 90 % de R por operación ({a.mejor.marco}):{" "}
            {a.mejor.evaluacion.expectanciaIc ? `${r2(a.mejor.evaluacion.expectanciaIc.low)} a ${r2(a.mejor.evaluacion.expectanciaIc.high)}` : "sin dato"} · caída máxima{" "}
            {n2(a.mejor.evaluacion.maxCaidaR)} R · en {a.mejor.monedasPositivas} de {a.mejor.monedasConOperaciones} monedas ganó. En desarrollo:{" "}
            {r2(a.mejor.desarrollo.expectancia)} por operación.
          </small>
        </article>
      )}

      <h3 className="lab-sub">Arena · quién gana y quién pierde</h3>
      <p className="lab-nota">
        Cada barra es el R medio por operación en la evaluación, con costos. La raya fina es el intervalo del 90 %: si toca el cero, no se sabe si gana o pierde. El rombo
        es el control al azar de esa temporalidad: lo que se gana sin ninguna regla. Verde sólido: ventaja confirmada. Verde rayado: candidata, con el intervalo sobre el cero
        pero sin pasar la auditoría de sobreajuste. Ámbar rayado: sin conclusión. Rojo: sin ventaja.
      </p>
      <div className="arena-marcos" role="group" aria-label="Temporalidad">
        {marcos.map((m) => (
          <button key={m} type="button" aria-pressed={m === marco} onClick={() => (setMarco(m), setVerTodas(false))}>
            {MARCO_TEXTO(m)}
          </button>
        ))}
      </div>
      <ol className="arena-lista">
        {visibles.map((c, k) => {
          const control = marco === "todos" ? controlDelMarco(ESTUDIO_FILAS, c.marco) : controlDelMarco(ESTUDIO_FILAS, marco);
          const ag = lista.find((x) => x.id === c.estrategia);
          return (
            <li key={c.clave} className={`piso-${tono(c.veredicto)}`}>
              <button type="button" className="arena-fila" onClick={() => ag && setElegido(ag.id)} aria-label={textoCombatiente(c)}>
                <span className={`arena-puesto${k < 3 && c.conexion !== "CONTROL" ? " arena-podio" : ""}`}>{k + 1}</span>
                <span className="arena-nombre">
                  <b>{c.nombre}</b> <em>{c.marco}</em>
                  {c.conexion === "PAPEL" && <u>EN PAPEL</u>}
                  {c.conexion === "CONTROL" && <u>CONTROL</u>}
                </span>
                <span className={`arena-r piso-valor-${tonoNumero(c.veredicto)}`}>{r2(c.expectancia)}</span>
                <Barra c={c} tope={tope} control={control} />
                <span className="arena-datos">
                  acierto {pct(c.winRate)} · PF {n2(c.profitFactor)} · R neto {r2(c.netoR)} · n={c.operaciones}
                  {c.muestraMinima ? " (muestra mínima)" : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {cs.length > 10 && (
        <button type="button" className="arena-mas" onClick={() => setVerTodas(!verTodas)}>
          {verTodas ? "VER MENOS" : `VER LAS ${cs.length}`}
        </button>
      )}
      <p className="lab-nota">
        Acertar más no es ganar más: las de reversión tocan TP1 seguido y aun así pierden. Para que un agente pase a papel en vivo tiene que mostrar VENTAJA acá y
        después sostenerla hacia adelante. CANDIDATA: pasa la regla simple pero no la auditoría de sobreajuste (se probaron muchas variantes sobre
        los mismos datos), así que solo la medición en papel la puede confirmar. Medición del pasado: no garantiza resultados y no es asesoramiento financiero.
      </p>
    </section>
  );
}
