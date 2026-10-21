"use client";

/**
 * El tutorial de toda la plataforma (lib/tutorial.ts): una tarjeta al pie de la pantalla, que no tapa la app, con el
 * capítulo, el paso, un botón que lleva a esa parte y anterior/siguiente; en el primer paso, el índice de capítulos. Se abre sola la primera vez y con ?tutorial=1 (el QR impreso); después, con
 * el botón TUTORIAL. Lo único que guarda es que ya se vio (en este navegador).
 */
import { useEffect, useState } from "react";
import { onTutorial, openAccount, openMercadoAr, showSection } from "@/lib/account-events";
import { CAPITULOS, debeAbrirse, inicioCapitulo, PASOS_TUTORIAL, TUTORIAL_KEY, type PasoTutorial } from "@/lib/tutorial";

function marcarVisto() {
  try {
    window.localStorage.setItem(TUTORIAL_KEY, "1");
  } catch {
    // Sin almacenamiento: a lo sumo se vuelve a ofrecer la próxima vez.
  }
}

function ir(p: PasoTutorial) {
  const a = p.accion;
  if (!a) return;
  if (a.tipo === "seccion") showSection(a.destino);
  else if (a.tipo === "ar") openMercadoAr(a.destino);
  else openAccount("register");
}

export default function Tutorial() {
  const [paso, setPaso] = useState<number | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => {
      let visto = false;
      try {
        visto = window.localStorage.getItem(TUTORIAL_KEY) === "1";
      } catch {
        visto = false;
      }
      if (debeAbrirse(window.location.search, visto)) setPaso(0);
    }, 600);
    const corta = onTutorial(() => setPaso(0));
    return () => {
      window.clearTimeout(id);
      corta();
    };
  }, []);

  if (paso === null) return null;
  const p = PASOS_TUTORIAL[paso];
  const ultimo = paso === PASOS_TUTORIAL.length - 1;
  const cerrar = () => {
    marcarVisto();
    setPaso(null);
  };
  return (
    <div className="tut" role="dialog" aria-modal="false" aria-labelledby="tut-titulo">
      <div className="tut-puntos" aria-hidden="true">
        {PASOS_TUTORIAL.map((x, k) => (
          <i key={x.id} className={k === paso ? "on" : k < paso ? "hecho" : ""} />
        ))}
      </div>
      <span className="tut-cap">{p.capitulo}</span>
      <b id="tut-titulo">{p.titulo}</b>
      <p>{p.texto}</p>
      {paso === 0 && (
        <div className="tut-indice" aria-label="Capítulos">
          {CAPITULOS.map((c) => (
            <button key={c} onClick={() => setPaso(inicioCapitulo(c))}>
              {c}
            </button>
          ))}
        </div>
      )}
      {p.accion && (
        <button className="tut-ir" onClick={() => ir(p)}>
          {p.accion.boton} →
        </button>
      )}
      <div className="tut-nav">
        {ultimo ? <span /> : <button onClick={cerrar}>SALTAR</button>}
        <span>
          {paso > 0 && <button onClick={() => setPaso(paso - 1)}>ANTERIOR</button>}
          <button className="tut-sig" onClick={() => (ultimo ? cerrar() : setPaso(paso + 1))}>
            {ultimo ? "LISTO" : paso === 0 ? "EMPEZAR" : "SIGUIENTE"}
          </button>
        </span>
      </div>
      <small>Paso {paso + 1} de {PASOS_TUTORIAL.length} · lo volvés a ver con el botón TUTORIAL</small>
    </div>
  );
}
