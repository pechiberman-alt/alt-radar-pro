"use client";

/**
 * La pizarra (lib/pizarra.ts) de una criptomoneda: las mentes de precio (las de valor se abstienen: no hay balances), la
 * estructura, la mesa de JARVIS con sus compuertas y los agentes del servidor con posición abierta en el activo, deliberando
 * sobre lo que la mesa ya leyó. No pide datos nuevos si la mesa ya los tiene; si no, un botón la arma con la misma lectura que
 * JARVIS TRADING. Ver app/pizarra-panel.tsx.
 */
import { useEffect, useMemo, useState } from "react";
import { cachedEntry, deskFor } from "@/lib/jarvis-desk-run";
import { pizarraCripto, type EscritorioLite } from "@/lib/pizarra-activos";
import { escritoriosServidor } from "@/lib/oficina-run";
import { PizarraPanel, RazonamientoMente } from "./pizarra-panel";

export default function PizarraCripto({ symbol, abierta = false }: { symbol: string; abierta?: boolean }) {
  const [vuelta, setVuelta] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mente, setMente] = useState<string | null>(null);
  const [oficina, setOficina] = useState<EscritorioLite[]>([]);
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const e = await escritoriosServidor();
      if (vivo && e) setOficina(e);
    })();
    return () => {
      vivo = false;
    };
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `vuelta` fuerza volver a leer lo que la mesa ya guardó
  const entrada = useMemo(() => cachedEntry(symbol), [symbol, vuelta]);
  const p = useMemo(() => (entrada ? pizarraCripto(entrada, oficina) : null), [entrada, oficina]);

  const armar = async () => {
    setCargando(true);
    setError(null);
    try {
      await deskFor(symbol);
      setVuelta((n) => n + 1);
    } catch {
      setError("La mesa no pudo leer este activo ahora. No se completa con datos inventados.");
    } finally {
      setCargando(false);
    }
  };

  if (!p) {
    return (
      <div className="ar-box">
        <h3>PIZARRA · {symbol.replace(/USDT$/, "")}</h3>
        <p>Mentes, estructura y la mesa de JARVIS deliberando sobre este activo, con las reglas de la plataforma.</p>
        <button className="ar-chip-btn on" onClick={() => void armar()} disabled={cargando}>
          {cargando ? "LEYENDO…" : "ARMAR LA PIZARRA"}
        </button>
        {error && <p className="ar-flag">{error}</p>}
      </div>
    );
  }
  return (
    <>
      <PizarraPanel d={p.deliberacion} abierta={abierta} />
      <details className="ar-box">
        <summary>
          <h3 style={{ display: "inline" }}>EL MÉTODO DE CADA MENTE · {symbol.replace(/USDT$/, "")}</h3>
        </summary>
        <div className="ar-tabs">
          {p.razon.map((r) => (
            <button key={r.id} className={mente === r.id ? "on" : ""} onClick={() => setMente(mente === r.id ? null : r.id)}>
              {r.mente.split(" (")[0].split(" ").at(-1)?.toUpperCase()}
            </button>
          ))}
        </div>
        {p.razon.filter((r) => r.id === mente).map((r) => (
          <RazonamientoMente key={r.id} r={r} />
        ))}
        {!mente && <p className="ar-mute">Elegí una mente para ver, en orden, las preguntas que se hace su método. Las de valor se abstienen con un criptoactivo: no tiene balances.</p>}
      </details>
    </>
  );
}
