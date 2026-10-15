"use client";

// Los universos de monedas en el panel: qué grupo vigila cada agente y, sobre todo, cuáles se pueden medir en el pasado y
// cuáles no. Un universo sin velas descargadas se puede vigilar en vivo pero no tiene acierto ni profit factor, y la tarjeta
// lo dice en vez de mostrar un número inventado. Solo muestra texto: no pide datos ni opera.
import { UNIVERSOS, comandoDescarga, estadoUniverso, monedasFaltantes } from "../lib/universos.ts";

const corta = (s: string) => s.replace(/USDT$/, "");

export default function LabUniversos() {
  const faltantes = monedasFaltantes();
  const comando = comandoDescarga();
  return (
    <section className="universos" aria-label="Universos de monedas">
      <h3 className="lab-sub">Universos de monedas</h3>
      <p className="lab-nota">
        Cada universo es un grupo de monedas con un criterio escrito de antemano. Vigilar en vivo se puede con cualquiera; medir en
        el pasado solo con las que tienen velas descargadas. Donde no hay velas, no hay acierto ni profit factor que mostrar.
      </p>
      {UNIVERSOS.map((u) => {
        const e = estadoUniverso(u);
        return (
          <article key={u.id} className={`universo universo-${e.medible ? "medible" : "solo-vivo"}`}>
            <h4>
              {u.nombre} <span className="universo-marca">{e.medible ? "se mide" : e.vigilable ? "solo en vivo" : "sin definir"}</span>
            </h4>
            <p>{u.describe}</p>
            {u.monedas.length > 0 && (
              <p className="universo-monedas">
                {u.monedas.map((m) => (
                  <span key={m} className={e.conDatos.includes(m) ? "universo-con" : "universo-sin"} title={e.conDatos.includes(m) ? "tiene velas descargadas" : "sin velas: no se puede medir"}>
                    {corta(m)}
                  </span>
                ))}
              </p>
            )}
            <p className="universo-estado">{e.texto}</p>
            <p className="universo-criterio">
              <strong>Criterio:</strong> {u.criterio}
            </p>
          </article>
        );
      })}
      {comando && (
        <details className="universo-bajar">
          <summary>Qué falta bajar para poder medir todo ({faltantes.length} monedas)</summary>
          <p>Esto corre en tu computadora: desde acá no hay salida a los datos de Binance.</p>
          <pre>
            <code>{comando}</code>
          </pre>
          <p className="lab-nota">Una vez bajadas, se vuelve a correr el estudio y recién ahí hay números para esos universos.</p>
        </details>
      )}
    </section>
  );
}
