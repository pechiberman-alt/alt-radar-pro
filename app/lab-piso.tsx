"use client";

import { useState } from "react";
import { ESTUDIO_FILAS, ESTUDIO_META, type FilaEstudio } from "../lib/estudio-estrategias-datos.ts";

/**
 * El piso de estrategias del AI TRADING LAB: una vista isométrica con un escritorio por agente, cada uno estudiando
 * UNA estrategia. El color sale del veredicto medido en la EVALUACIÓN (lib/estudio-estrategias-datos.ts): verde con
 * ventaja, ámbar sin conclusión, rojo sin ventaja, gris el control al azar. Tocar un escritorio muestra sus números.
 * Nada inventa ni anima resultados: los datos son los del estudio, con su muestra.
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

// Proyección isométrica: (columna, fila) del piso → punto en el SVG.
const W = 118;
const Hh = 59;
const iso = (c: number, r: number) => ({ x: 190 + ((c - r) * W) / 2, y: 50 + ((c + r) * Hh) / 2 });

function Escritorio({ a, c, r, activo, elegir }: { a: Agente; c: number; r: number; activo: boolean; elegir: () => void }) {
  const p = iso(c, r);
  const top = `${p.x},${p.y} ${p.x + 34},${p.y + 17} ${p.x},${p.y + 34} ${p.x - 34},${p.y + 17}`;
  const izq = `${p.x - 34},${p.y + 17} ${p.x},${p.y + 34} ${p.x},${p.y + 44} ${p.x - 34},${p.y + 27}`;
  const der = `${p.x + 34},${p.y + 17} ${p.x},${p.y + 34} ${p.x},${p.y + 44} ${p.x + 34},${p.y + 27}`;
  return (
    <g
      className={`piso-mesa piso-${tono(a.mejor.veredicto)}${activo ? " piso-activa" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`${a.agente}: ${a.mejor.veredicto}`}
      aria-pressed={activo}
      onClick={elegir}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), elegir())}
    >
      <polygon className="piso-lado" points={izq} />
      <polygon className="piso-lado piso-lado-d" points={der} />
      <polygon className="piso-tapa" points={top} />
      {/* El monitor y el agente sentado frente a él. */}
      <polygon className="piso-pantalla" points={`${p.x - 8},${p.y + 4} ${p.x + 12},${p.y + 14} ${p.x + 12},${p.y + 2} ${p.x - 8},${p.y - 8}`} />
      <circle className="piso-agente" cx={p.x - 4} cy={p.y + 24} r={5} />
    </g>
  );
}

export default function LabPiso() {
  const lista = agentes();
  const [elegido, setElegido] = useState<string>(lista[0]?.id ?? "");
  const a = lista.find((x) => x.id === elegido) ?? lista[0];
  // Cuatro escritorios por fila.
  const lugares = lista.map((x, i) => ({ x, c: i % 4, r: Math.floor(i / 4) }));
  const ranking = [...ESTUDIO_FILAS].sort((p, q) => (q.evaluacion.expectancia ?? -9) - (p.evaluacion.expectancia ?? -9));
  return (
    <section className="piso" aria-label="Piso de estrategias">
      <h3 className="lab-sub">Piso de estrategias · cada agente estudia una</h3>
      <p className="lab-nota">
        {ESTUDIO_META.monedas.length} monedas, velas de Binance del {ESTUDIO_META.datosDesde.split("-").reverse().join("/")} al{" "}
        {ESTUDIO_META.datosHasta.split("-").reverse().join("/")}, con costos de {String(ESTUDIO_META.costoPorLadoPct).replace(".", ",")} % por lado. El color
        sale de la evaluación (después del {ESTUDIO_META.corte.split("-").reverse().join("/")}): verde con ventaja, ámbar sin conclusión, rojo sin ventaja, gris el
        control al azar.
      </p>
      <svg className="piso-svg" viewBox="0 0 440 312" role="group" aria-label="Escritorios de los agentes">
        <polygon className="piso-suelo" points={`${iso(-0.6, -0.6).x},${iso(-0.6, -0.6).y} ${iso(3.5, -0.6).x},${iso(3.5, -0.6).y} ${iso(3.5, 3.8).x},${iso(3.5, 3.8).y} ${iso(-0.6, 3.8).x},${iso(-0.6, 3.8).y}`} />
        {lugares.map(({ x, c, r }) => (
          <Escritorio key={x.id} a={x} c={c} r={r} activo={x.id === a?.id} elegir={() => setElegido(x.id)} />
        ))}
        {/* Los nombres van después de todos los escritorios, para que ninguno quede tapado. */}
        {lugares.map(({ x, c, r }) => (
          <text key={`n-${x.id}`} className="piso-rotulo" x={iso(c, r).x} y={iso(c, r).y + 56} textAnchor="middle" aria-hidden="true">
            {x.agente.replace("Agente ", "").replace(" (azar)", "")}
          </text>
        ))}
      </svg>
      {a && (
        <article className={`piso-ficha piso-${tono(a.mejor.veredicto)}`} aria-live="polite">
          <header>
            <b>{a.agente}</b> <span>{a.mejor.veredicto}</span>
          </header>
          <p>
            {a.nombre}. {a.regla}
          </p>
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
      <h3 className="lab-sub">Ranking por R por operación en evaluación</h3>
      <ol className="piso-ranking">
        {ranking.map((f) => (
          <li key={`${f.estrategia}-${f.marco}`} className={`piso-${tono(f.veredicto)}`}>
            <b>{f.agente.replace("Agente ", "")}</b> {f.marco} · {r2(f.evaluacion.expectancia)} · acierto {pct(f.evaluacion.winRate)} · TP1 {pct(f.evaluacion.tasaTp1)} · TP2 {pct(f.evaluacion.tasaTp2)} · TP3 {pct(f.evaluacion.tasaTp3)} · SL {pct(f.evaluacion.tasaSl)} · n=
            {f.evaluacion.operaciones} · DSR {pct(f.dsrDeclarado)} · <span>{f.veredicto}</span>
          </li>
        ))}
      </ol>
      <p className="lab-nota">
        Acertar más no es ganar más: las de reversión tocan TP1 seguido y aun así pierden. Para que un agente pase a papel en vivo tiene que mostrar VENTAJA acá y
        después sostenerla hacia adelante. CANDIDATA: pasa la regla simple pero no la auditoría de sobreajuste (se probaron muchas variantes sobre
        los mismos datos), así que solo la medición en papel la puede confirmar. Medición del pasado: no garantiza resultados y no es asesoramiento financiero.
      </p>
    </section>
  );
}
