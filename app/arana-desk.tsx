"use client";

import { useEffect, useRef, useState } from "react";
import { ControlesSombra, ControlesVivo, PanelVivo, useAutoEscaneo, useRegistro, useSombra, useVivo } from "./arana-vivo";

/**
 * La araña dentro de la app, en dos pestañas. EN VIVO: todas las monedas que la
 * mesa leyó (el escaneo que va llegando o el último completo), con el escaneo
 * automático y la lectura frente a lo medido. MAPA DEL PROYECTO: la araña que
 * recorre los archivos. Las dos páginas las arma el build (public/arana/) y van en
 * marcos aparte, sandboxeados, para que su estilo y su código no toquen los de la app.
 *
 * Cada página avisa su alto por postMessage y el marco se ajusta. Solo se atiende
 * al mensaje de ese marco (e.source) y solo un número dentro de un rango razonable.
 */
const ALTO_MIN = 480;
const ALTO_MAX = 12000;

type Pestana = "vivo" | "mapa";

export default function AranaDesk() {
  const [pestana, setPestana] = useState<Pestana>("vivo");
  const [listo, setListo] = useState<Record<Pestana, boolean>>({ vivo: false, mapa: false });
  const [alto, setAlto] = useState<Record<Pestana, number | null>>({ vivo: null, mapa: null });
  const marcoVivo = useRef<HTMLIFrameElement>(null);
  const marcoMapa = useRef<HTMLIFrameElement>(null);
  const zonaVivo = useRef<HTMLDivElement>(null);
  const vivo = useVivo();
  useSombra();
  useRegistro();
  const { auto, estado, pausado, alternarPausa, escanearAhora, cancelar } = useAutoEscaneo(zonaVivo);

  // La foto y el estado del escaneo automático van al marco de la mesa en vivo.
  useEffect(() => {
    if (!listo.vivo || !vivo) return;
    const autoFoto = auto ? { estado, proximoEnMin: auto.proximoEnMin, motivo: auto.motivo } : null;
    marcoVivo.current?.contentWindow?.postMessage({ arana: "vivo", vivo, auto: autoFoto }, "*");
  }, [listo.vivo, vivo, auto, estado]);

  useEffect(() => {
    const escuchar = (e: MessageEvent) => {
      const quien: Pestana | null =
        marcoVivo.current && e.source === marcoVivo.current.contentWindow ? "vivo" : marcoMapa.current && e.source === marcoMapa.current.contentWindow ? "mapa" : null;
      if (!quien) return;
      const d = e.data as { arana?: unknown; h?: unknown } | null;
      if (!d || d.arana !== "alto" || typeof d.h !== "number" || !Number.isFinite(d.h)) return;
      const h = Math.max(ALTO_MIN, Math.min(ALTO_MAX, Math.round(d.h)));
      setAlto((prev) => (prev[quien] === h ? prev : { ...prev, [quien]: h }));
    };
    window.addEventListener("message", escuchar);
    return () => window.removeEventListener("message", escuchar);
  }, []);

  return (
    <section className="panel arana-desk" aria-label="La araña de ALT RADAR PRO">
      <div className="panel-head">
        <div>
          <p className="eyebrow">LA ARAÑA · EN VIVO Y MAPA DEL PROYECTO</p>
          <h2>{pestana === "vivo" ? "Todas las monedas, a la vista" : "La araña recorre ALT RADAR PRO"}</h2>
        </div>
        {pestana === "mapa" && (
          <a className="arana-open" href="/arana/index.html" target="_blank" rel="noopener noreferrer">
            PANTALLA COMPLETA ↗
          </a>
        )}
      </div>
      <p className="arana-note">
        {pestana === "vivo"
          ? "Cada punto es una moneda que la mesa leyó: verde, plan largo; rojo, plan corto; gris, esperar o sin datos. Se llena mientras escanea y se actualiza sola cada 15 minutos con la araña a la vista. Nada de esto manda una orden."
          : "Una esfera con cada archivo del proyecto: los colores son los objetivos, los arcos son imports reales y la araña camina por ellos. Tocá un objetivo, buscá un tema o copiá una consulta para Claude. Se arma en cada despliegue con el código real."}
      </p>
      <div className="arana-tabs" role="tablist" aria-label="Qué mirar de la araña">
        <button type="button" role="tab" id="arana-tab-vivo" aria-controls="arana-panel-vivo" aria-selected={pestana === "vivo"} onClick={() => setPestana("vivo")}>
          EN VIVO
        </button>
        <button type="button" role="tab" id="arana-tab-mapa" aria-controls="arana-panel-mapa" aria-selected={pestana === "mapa"} onClick={() => {
            setListo((p) => ({ ...p, mapa: false }));
            setPestana("mapa");
          }}>
          MAPA DEL PROYECTO
        </button>
      </div>
      <div id="arana-panel-vivo" role="tabpanel" aria-labelledby="arana-tab-vivo" hidden={pestana !== "vivo"} ref={zonaVivo}>
        <ControlesVivo auto={auto} estado={estado} pausado={pausado} onPausa={alternarPausa} onEscanear={escanearAhora} onCancelar={cancelar} />
        <ControlesSombra sombra={vivo?.sombra ?? null} />
        <PanelVivo vivo={vivo} />
        <div className="arana-frame" aria-busy={!listo.vivo}>
          {!listo.vivo && <span className="arana-wait">ARMANDO LA MESA EN VIVO…</span>}
          <iframe
            ref={marcoVivo}
            src="/arana/vivo.html"
            title="La mesa en vivo: todas las monedas que la app leyó, con sus compuertas y sus especialistas"
            sandbox="allow-scripts allow-popups"
            allow="clipboard-write"
            referrerPolicy="no-referrer"
            style={alto.vivo ? { height: alto.vivo } : undefined}
            onLoad={() => setListo((p) => ({ ...p, vivo: true }))}
          />
        </div>
      </div>
      <div id="arana-panel-mapa" role="tabpanel" aria-labelledby="arana-tab-mapa" hidden={pestana !== "mapa"}>
        <div className="arana-frame" aria-busy={!listo.mapa}>
          {!listo.mapa && <span className="arana-wait">DIBUJANDO LA ARAÑA…</span>}
          {/* Solo montado con la pestaña a la vista: dos páginas pesadas a la vez pueden tirar el marco en un celular (carita triste). */}
          {pestana === "mapa" && (
          <iframe
            ref={marcoMapa}
            src="/arana/index.html"
            title="La araña de ALT RADAR PRO recorriendo los archivos del proyecto"
            sandbox="allow-scripts allow-popups"
            allow="clipboard-write"
            referrerPolicy="no-referrer"
            style={alto.mapa ? { height: alto.mapa } : undefined}
            onLoad={() => setListo((p) => ({ ...p, mapa: true }))}
          />
          )}
        </div>
      </div>
    </section>
  );
}
