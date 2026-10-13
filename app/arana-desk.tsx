"use client";

import { useEffect, useRef, useState } from "react";
import { PanelVivo, useVivo } from "./arana-vivo";

/**
 * La araña dentro de la app. La página la arma el build con el código real
 * (`npm run arana -- --pagina`, en public/arana/) y acá se muestra en un marco
 * aparte, sandboxeado, para que su estilo y su código no toquen los de la app.
 * El mapa nombra rutas, tablas y secretos pero nunca sus valores.
 *
 * La página le avisa su alto por postMessage y el marco se ajusta: así se
 * desplaza con la app y no queda un scroll adentro de otro. Solo se atiende
 * al mensaje de ese marco y solo un número dentro de un rango razonable.
 */
const ALTO_MIN = 480;
const ALTO_MAX = 12000;

export default function AranaDesk() {
  const [listo, setListo] = useState(false);
  const [alto, setAlto] = useState<number | null>(null);
  const marco = useRef<HTMLIFrameElement>(null);
  const vivo = useVivo();

  // La foto de la mesa en vivo también llega al marco: la araña la muestra en su cinta superior.
  useEffect(() => {
    if (listo && vivo) marco.current?.contentWindow?.postMessage({ arana: "vivo", vivo }, "*");
  }, [listo, vivo]);

  useEffect(() => {
    const escuchar = (e: MessageEvent) => {
      if (!marco.current || e.source !== marco.current.contentWindow) return;
      const d = e.data as { arana?: unknown; h?: unknown } | null;
      if (!d || d.arana !== "alto" || typeof d.h !== "number" || !Number.isFinite(d.h)) return;
      setAlto(Math.max(ALTO_MIN, Math.min(ALTO_MAX, Math.round(d.h))));
    };
    window.addEventListener("message", escuchar);
    return () => window.removeEventListener("message", escuchar);
  }, []);

  return (
    <section className="panel arana-desk" aria-label="La araña del proyecto">
      <div className="panel-head">
        <div>
          <p className="eyebrow">MAPA VIVO DEL PROYECTO</p>
          <h2>La araña recorre ALT RADAR PRO</h2>
        </div>
        <a className="arana-open" href="/arana/index.html" target="_blank" rel="noopener noreferrer">
          PANTALLA COMPLETA ↗
        </a>
      </div>
      <p className="arana-note">
        Una esfera con cada archivo del proyecto: los colores son los objetivos, los arcos son imports reales y la araña camina por ellos. Tocá un objetivo,
        buscá un tema o copiá una consulta para Claude. Se arma en cada despliegue con el código real, así que siempre es el de esta versión.
      </p>
      <PanelVivo vivo={vivo} />
      <div className="arana-frame" aria-busy={!listo}>
        {!listo && <span className="arana-wait">DIBUJANDO LA ARAÑA…</span>}
        <iframe
          ref={marco}
          src="/arana/index.html"
          title="La araña de ALT RADAR PRO recorriendo los archivos del proyecto"
          sandbox="allow-scripts allow-popups"
          allow="clipboard-write"
          referrerPolicy="no-referrer"
          style={alto ? { height: alto } : undefined}
          onLoad={() => setListo(true)}
        />
      </div>
    </section>
  );
}
