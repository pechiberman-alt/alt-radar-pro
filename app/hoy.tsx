"use client";

/**
 * La pantalla HOY (lib/hoy.ts): lo que importa hoy en tarjetas grandes, pensada primero para el celular y que en la
 * notebook se acomoda en columnas. Planes de la pizarra, papeles en zona de compra, avisos, señales abiertas del núcleo y
 * el semáforo de evidencia de cada fuente. Se lee una vez al abrirla (sin intervalos) y se actualiza con un botón.
 * No es asesoramiento financiero.
 */
import { useEffect, useState } from "react";
import type { Hoy, TarjetaEvidencia } from "@/lib/hoy";
import { openArEnMapa, openInMap, openMercadoAr, openTutorial, showSection } from "@/lib/account-events";

const num = (x: number) => x.toLocaleString("es-AR", { maximumFractionDigits: x >= 100 ? 2 : x >= 1 ? 3 : 6 });
const hora = (t: number) => new Date(t).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const COLOR: Record<TarjetaEvidencia["nivel"], string> = { POSITIVA: "ok", NEGATIVA: "mal", "SIN VENTAJA CLARA": "alerta", "SIN SERIE": "", "MUESTRA MÍNIMA": "", "SIN DATOS": "" };

export default function HoyPanel() {
  const [hoy, setHoy] = useState<Hoy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vuelta, setVuelta] = useState(0);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await fetch("/api/hoy", { credentials: "same-origin", cache: vuelta ? "no-store" : "default" });
        const d = (await r.json().catch(() => null)) as (Hoy & { error?: string }) | null;
        if (!vivo) return;
        if (!r.ok || !d || d.error) setError(d?.error ?? "No se pudo leer HOY. Probá de nuevo en un rato.");
        else {
          setHoy(d);
          setError(null);
        }
      } catch {
        if (vivo) setError("Sin conexión: no se pudo leer HOY.");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [vuelta]);

  return (
    <section className="hoy" aria-labelledby="hoy-titulo">
      <div className="hoy-cabeza">
        <div>
          <p className="eyebrow">LO QUE IMPORTA HOY</p>
          <h2 id="hoy-titulo">HOY</h2>
          <p className="hoy-titular">{hoy ? hoy.titular : cargando ? "Leyendo…" : (error ?? "")}</p>
        </div>
        <button
          className="hoy-recargar"
          onClick={() => {
            setCargando(true);
            setVuelta((n) => n + 1);
          }}
          disabled={cargando}
        >
          {cargando ? "…" : "ACTUALIZAR"}
        </button>
      </div>

      <div className="hoy-atajos">
        <button onClick={() => showSection("liquidaciones")}>
          <b>▨</b>MAPA
        </button>
        <button onClick={() => showSection("jarvis-trading")}>
          <b>◬</b>JARVIS
        </button>
        <button onClick={() => openMercadoAr("ACCIONES")}>
          <b>$</b>ACCIONES
        </button>
        <button onClick={() => openTutorial()}>
          <b>?</b>TUTORIAL
        </button>
      </div>

      {hoy && (
        <div className="hoy-grilla">
          <article className="hoy-tarjeta">
            <h3>PLANES DE LA PIZARRA</h3>
            {hoy.planesAr.length === 0 && hoy.planesCripto.length === 0 ? (
              <p className="hoy-vacio">Ninguno. Esperar también es una decisión: la pizarra solo da plan con dos miradas distintas a favor, ventaja clara y riesgo aprobado.</p>
            ) : (
              <ul className="hoy-lista">
                {hoy.planesCripto.map((p) => (
                  <li key={p.huella}>
                    <button onClick={() => openInMap(p.symbol)}>
                      <b>{p.symbol.replace(/USDT$/, "")}</b>
                      <span>{p.lado === "CORTO" ? "corto" : "largo"} · {p.razon}</span>
                      <small>cripto · decisión {p.huella}</small>
                    </button>
                  </li>
                ))}
                {hoy.planesAr.map((p) => (
                  <li key={p.ticker}>
                    <button onClick={() => openArEnMapa(p.ticker)}>
                      <b>{p.ticker}</b>
                      <span>BYMA · la pizarra da plan al cierre{p.viejo ? " (lectura vieja)" : ""}</span>
                      <small>{p.huella ? `decisión ${p.huella}` : ""}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {hoy.planesCripto.length > 0 && <p className="hoy-vacio">La pizarra de cripto se probó con 2021–2026: pierde menos que los agentes sueltos, pero no demostró ventaja. Sus planes se miden en papel; no son una recomendación.</p>}
          </article>

          <article className="hoy-tarjeta">
            <h3>EN ZONA DE COMPRA · FIBONACCI</h3>
            {hoy.enZonaAr.length ? (
              <div className="hoy-chips">
                {hoy.enZonaAr.map((t) => (
                  <button key={t} onClick={() => openArEnMapa(t)}>
                    {t}
                  </button>
                ))}
              </div>
            ) : (
              <p className="hoy-vacio">Ningún papel de BYMA en la zona 0,618–0,786 al último cierre.</p>
            )}
          </article>

          <article className="hoy-tarjeta">
            <h3>SEÑALES ABIERTAS · NÚCLEO DE JARVIS</h3>
            {hoy.nucleo.length ? (
              <ul className="hoy-lista">
                {hoy.nucleo.map((s) => (
                  <li key={`${s.symbol}${s.time}${s.source}`}>
                    <button onClick={() => openInMap(s.symbol)}>
                      <b className={s.side === "LONG" ? "ar-up" : "ar-down"}>
                        {s.symbol.replace(/USDT$/, "")} {s.side === "LONG" ? "LARGO" : "CORTO"}
                      </b>
                      <span>
                        entrada {num(s.entry)} · SL {num(s.stop)} · objetivo {num(s.target)}
                      </span>
                      <small>
                        {s.source} · {hora(s.time)}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hoy-vacio">El núcleo no tiene señales abiertas.</p>
            )}
          </article>

          <article className="hoy-tarjeta">
            <h3>AVISOS · ÚLTIMAS 24 HORAS</h3>
            {hoy.avisos.length ? (
              <ul className="hoy-avisos">
                {hoy.avisos.map((a) => (
                  <li key={a.clave}>{a.texto}</li>
                ))}
              </ul>
            ) : (
              <p className="hoy-vacio">Sin avisos de BYMA en las últimas 24 horas.</p>
            )}
          </article>

          <article className="hoy-tarjeta hoy-ancha">
            <h3>¿HAY EVIDENCIA? · SEMÁFORO DEL REGISTRO</h3>
            <p className="hoy-vacio">Si los resultados de cada fuente ya dicen algo: la ventaja promedio contra su ruido, con su muestra. Menos de 15 cierres no dice nada.</p>
            {hoy.evidencia.length ? (
              <ul className="hoy-semaforo">
                {hoy.evidencia.map((e) => (
                  <li key={e.id}>
                    <span className={`ar-chip ${COLOR[e.nivel]}`}>{e.nivel}</span>
                    <b>{e.nombre}</b>
                    <small>
                      {e.texto} · {e.cerradas} cerradas, {e.abiertas} abiertas
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hoy-vacio">Todavía ninguna fuente global tiene operaciones.</p>
            )}
            <button className="ar-chip-btn" onClick={() => showSection("registro")}>
              VER EL REGISTRO COMPLETO
            </button>
          </article>

          <article className="hoy-tarjeta">
            <h3>TU RIESGO</h3>
            <p>Arriesgá como máximo 1 % de tu cuenta por operación y siempre con stop. El tamaño sale de la distancia al stop, no de las ganas.</p>
            <button className="ar-chip-btn on" onClick={() => showSection("riesgo")}>
              CALCULAR EL TAMAÑO
            </button>
          </article>
        </div>
      )}

      <p className="hoy-pie">
        {hoy ? `Leído ${hora(hoy.generado)}. ` : ""}
        {hoy?.faltan.length ? `No se pudo leer: ${hoy.faltan.join(", ")}. ` : ""}
        Todo es papel o pasado, con su muestra. No es asesoramiento financiero.
      </p>
    </section>
  );
}
