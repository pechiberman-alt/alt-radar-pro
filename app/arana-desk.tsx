"use client";

import { useState } from "react";

/**
 * La araña dentro de la app. La página la arma el build con el código real
 * (`npm run arana -- --pagina`, en public/arana/) y acá se muestra en un marco
 * aparte, sandboxeado, para que su estilo y su código no toquen los de la app.
 * El mapa nombra rutas, tablas y secretos pero nunca sus valores.
 */
export default function AranaDesk() {
  const [listo, setListo] = useState(false);
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
        Cada nube es un objetivo del proyecto y cada punto un archivo; la araña camina por los imports. Tocá un objetivo, buscá un tema o copiá una consulta para
        Claude. Se arma en cada despliegue con el código real, así que siempre es el de esta versión.
      </p>
      <div className="arana-frame" aria-busy={!listo}>
        {!listo && <span className="arana-wait">DIBUJANDO LA ARAÑA…</span>}
        <iframe
          src="/arana/index.html"
          title="La araña de ALT RADAR PRO recorriendo los archivos del proyecto"
          sandbox="allow-scripts allow-popups"
          allow="clipboard-write"
          referrerPolicy="no-referrer"
          onLoad={() => setListo(true)}
        />
      </div>
    </section>
  );
}
