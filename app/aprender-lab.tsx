"use client";

// APRENDER: las lecciones del laboratorio para quien recién empieza. Cada lección tiene su texto, preguntas con explicación y
// un glosario al final. Solo muestra texto y responde preguntas: no hace llamadas de red ni opera.
import { Fragment, useState } from "react";
import { GLOSARIO, LECCIONES, esCorrecta } from "../lib/aprender.ts";

export default function AprenderLab() {
  const [indice, setIndice] = useState(0);
  const [elegidas, setElegidas] = useState<Record<string, number>>({});
  const leccion = LECCIONES[indice];

  function elegir(preguntaId: string, opcion: number) {
    if (elegidas[preguntaId] !== undefined) return;
    setElegidas((previas) => ({ ...previas, [preguntaId]: opcion }));
  }

  return (
    <section className="aprender" aria-label="Aprender a leer el laboratorio">
      <p className="lab-nota">
        Esta sección explica cómo leer el laboratorio. No da señales, no promete ganancias y no es asesoramiento financiero.
      </p>

      <div className="lab-botones" role="tablist" aria-label="Lecciones">
        {LECCIONES.map((l, k) => (
          <button key={l.id} type="button" role="tab" aria-selected={k === indice} onClick={() => setIndice(k)}>
            {k + 1}. {l.titulo}
          </button>
        ))}
      </div>

      <h3 className="lab-sub">{leccion.titulo}</h3>
      {leccion.parrafos.map((p) => (
        <p key={p}>{p}</p>
      ))}

      <h4 className="lab-sub">Comprobá lo que entendiste</h4>
      {leccion.preguntas.map((p) => {
        const e = elegidas[p.id];
        return (
          <div key={p.id} className="aprender-pregunta">
            <p>
              <strong>{p.pregunta}</strong>
            </p>
            <div className="lab-preguntas">
              {p.opciones.map((o, k) => (
                <button key={o} type="button" aria-pressed={e === k} disabled={e !== undefined} onClick={() => elegir(p.id, k)}>
                  {o}
                </button>
              ))}
            </div>
            {e !== undefined && (
              <p role="status">
                <strong>{esCorrecta(p, e) ? "Correcto." : "No es esa."}</strong> {p.explicacion}
              </p>
            )}
          </div>
        );
      })}

      <div className="lab-botones">
        <button type="button" disabled={indice === 0} onClick={() => setIndice((k) => k - 1)}>
          Anterior
        </button>
        <button type="button" disabled={indice === LECCIONES.length - 1} onClick={() => setIndice((k) => k + 1)}>
          Siguiente
        </button>
      </div>

      <details className="aprender-glosario">
        <summary className="lab-sub">Glosario</summary>
        <dl>
          {GLOSARIO.map((g) => (
            <Fragment key={g.termino}>
              <dt>
                <strong>{g.termino}</strong>
              </dt>
              <dd>{g.definicion}</dd>
            </Fragment>
          ))}
        </dl>
      </details>
    </section>
  );
}
