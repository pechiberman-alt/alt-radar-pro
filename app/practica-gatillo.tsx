"use client";

// La práctica del gatillo: se ven las velas hasta una vela y se decide si la estrategia dispara ahí (LONG, SHORT o no hay
// gatillo). La verdad y el resultado aparecen recién al contestar. Usa lib/practica-gatillo.ts y las velas del navegador
// (lib/market-fetch.ts). Practicar no es operar: no hay dinero ni órdenes, y no mide ganancias.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ESTRATEGIAS, type EstrategiaId, type Operacion } from "../lib/estrategias.ts";
import { loadRows } from "../lib/market-fetch.ts";
import {
  COSTO_PRACTICA_PCT,
  HORIZONTE_PRACTICA,
  MONEDAS_PRACTICA,
  MARCOS_PRACTICA,
  corregir,
  nivelesDeLaOperacion,
  prepararTanda,
  resumenPractica,
  type Respuesta,
  type Resultado,
} from "../lib/practica-gatillo.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const PREGUNTAS = 20;
const VELAS_A_LA_VISTA = 70;

const n2 = (x: number, d = 2) => x.toFixed(d).replace(".", ",");
const pct = (x: number | null) => (x === null ? "muestra mínima" : `${n2(x * 100, 0)} %`);
const precio = (x: number) => (x >= 100 ? n2(x, 2) : n2(x, 4));

function aVelas(rows: unknown[]): SwingCandle[] {
  return rows.map((r) => {
    const f = r as (string | number)[];
    return { openTime: Number(f[0]), open: Number(f[1]), high: Number(f[2]), low: Number(f[3]), close: Number(f[4]), volume: Number(f[5]), quoteVolume: Number(f[7]) };
  });
}

function Velas({ velas, desde, hasta, marca, lineas }: { velas: SwingCandle[]; desde: number; hasta: number; marca: number; lineas: { y: number; color: string; texto: string }[] }) {
  const ver = velas.slice(desde, hasta + 1);
  const max = Math.max(...ver.map((x) => x.high), ...lineas.map((l) => l.y));
  const min = Math.min(...ver.map((x) => x.low), ...lineas.map((l) => l.y));
  const ancho = 640;
  const alto = 300;
  const paso = ancho / Math.max(ver.length, 1);
  const y = (p: number) => ((max - p) / (max - min || 1)) * (alto - 20) + 10;
  return (
    <svg className="practica-grafico" viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label="Velas hasta la vela de la pregunta">
      {ver.map((x, k) => {
        const i = desde + k;
        const sube = x.close >= x.open;
        const cx = k * paso + paso / 2;
        const cuerpoTope = y(Math.max(x.open, x.close));
        const cuerpoBase = y(Math.min(x.open, x.close));
        return (
          <g key={x.openTime} className={i > marca ? "practica-futura" : undefined}>
            <line x1={cx} x2={cx} y1={y(x.high)} y2={y(x.low)} stroke="currentColor" strokeWidth={1} />
            <rect x={cx - paso * 0.3} y={cuerpoTope} width={paso * 0.6} height={Math.max(1, cuerpoBase - cuerpoTope)} fill={sube ? "#2fbf71" : "#e5484d"} />
            {i === marca && <line x1={cx} x2={cx} y1={0} y2={alto} stroke="#f5c542" strokeDasharray="4 4" />}
          </g>
        );
      })}
      {lineas.map((l) => (
        <g key={l.texto}>
          <line x1={0} x2={ancho} y1={y(l.y)} y2={y(l.y)} stroke={l.color} strokeDasharray="6 4" />
          <text x={6} y={y(l.y) - 4} fill={l.color} fontSize={12}>{l.texto}</text>
        </g>
      ))}
    </svg>
  );
}

export default function PracticaGatillo() {
  const [moneda, setMoneda] = useState(MONEDAS_PRACTICA[0]);
  const [marco, setMarco] = useState(MARCOS_PRACTICA[1].id);
  const [estrategiaId, setEstrategiaId] = useState(ESTRATEGIAS[0].id);
  // Las velas van marcadas con la moneda y el marco que las pidieron: si cambia la elección, no se muestran las anteriores.
  const [datos, setDatos] = useState<{ clave: string; velas: SwingCandle[] } | null>(null);
  const [fallo, setFallo] = useState<{ clave: string; texto: string } | null>(null);
  const [semilla, setSemilla] = useState(1);
  const [pos, setPos] = useState(0);
  const [respuesta, setRespuesta] = useState<Respuesta | null>(null);
  const [resultados, setResultados] = useState<Resultado[]>([]);

  const marcoInfo = MARCOS_PRACTICA.find((m) => m.id === marco) ?? MARCOS_PRACTICA[1];
  const estrategia = ESTRATEGIAS.find((e) => e.id === estrategiaId) ?? ESTRATEGIAS[0];
  const clave = `${moneda}|${marco}`;
  const velas = datos && datos.clave === clave ? datos.velas : null;
  const error = fallo && fallo.clave === clave ? fallo.texto : null;

  useEffect(() => {
    const ctl = new AbortController();
    const pedida = `${moneda}|${marco}`;
    (async () => {
      const rows = await loadRows(moneda, marco, 500, ctl.signal);
      if (ctl.signal.aborted) return;
      if (!rows) {
        setFallo({ clave: pedida, texto: "No llegaron velas. Revisá la conexión y probá otra vez." });
        return;
      }
      setFallo(null);
      setDatos({ clave: pedida, velas: aVelas(rows) });
    })();
    return () => ctl.abort();
  }, [moneda, marco]);

  const tanda = useMemo(
    () => (velas ? prepararTanda(velas, estrategia, moneda, { marcoMs: marcoInfo.ms, horizonte: HORIZONTE_PRACTICA, feePct: COSTO_PRACTICA_PCT }, PREGUNTAS, semilla) : null),
    [velas, estrategia, moneda, marcoInfo, semilla],
  );

  function reiniciar() {
    setPos(0);
    setRespuesta(null);
    setResultados([]);
  }

  function nuevaTanda() {
    setSemilla(Math.floor(Math.random() * 1_000_000) + 1);
    reiniciar();
  }

  const total = tanda?.preguntas.length ?? 0;
  const terminada = tanda !== null && pos >= total;
  const i = tanda && pos < total ? tanda.preguntas[pos] : null;
  const vd = tanda && i !== null ? tanda.verdades.get(i) ?? null : null;
  const correccion = vd && respuesta ? corregir(vd, respuesta) : null;
  const operacion: Operacion | null = vd?.operacion ?? null;
  const niveles = velas && i !== null && vd?.senal ? nivelesDeLaOperacion(velas, i, vd.senal) : null;

  function contestar(r: Respuesta) {
    if (!vd || respuesta) return;
    const c = corregir(vd, r);
    setRespuesta(r);
    setResultados((xs) => [...xs, { gatillo: vd.tipo === "GATILLO", respuesta: r, acierto: c.acierto }]);
  }

  function siguiente() {
    setPos((p) => p + 1);
    setRespuesta(null);
  }

  const resumen = resumenPractica(resultados);
  const etiquetaEsperada = (r: Respuesta) => (r === "LONG" ? "LONG" : r === "SHORT" ? "SHORT" : "sin gatillo");

  let grafico: ReactNode = null;
  if (velas && i !== null && vd) {
    const hasta = respuesta ? Math.min(velas.length - 1, i + HORIZONTE_PRACTICA) : i;
    const lineas: { y: number; color: string; texto: string }[] = [];
    if (respuesta && niveles) {
      lineas.push({ y: niveles.entrada, color: "#f5c542", texto: `Entrada ${precio(niveles.entrada)}` });
      lineas.push({ y: niveles.stop, color: "#e5484d", texto: `Stop ${precio(niveles.stop)}` });
      lineas.push({ y: niveles.objetivo, color: "#2fbf71", texto: `Objetivo ${precio(niveles.objetivo)}` });
    }
    grafico = (
      <Velas velas={velas} desde={Math.max(0, i - VELAS_A_LA_VISTA + 1)} hasta={hasta} marca={i} lineas={lineas} />
    );
  }

  return (
    <section className="practica" aria-label="Práctica del gatillo">
      <div className="practica-controles">
        <label>
          Moneda
          <select value={moneda} onChange={(e) => { setMoneda(e.target.value); reiniciar(); }}>
            {MONEDAS_PRACTICA.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label>
          Marco
          <select value={marco} onChange={(e) => { setMarco(e.target.value); reiniciar(); }}>
            {MARCOS_PRACTICA.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
        </label>
        <label>
          Gatillo
          <select value={estrategiaId} onChange={(e) => { setEstrategiaId(e.target.value as EstrategiaId); reiniciar(); }}>
            {ESTRATEGIAS.map((e) => <option key={e.id} value={e.id}>{e.agente}</option>)}
          </select>
        </label>
      </div>
      <p className="practica-regla"><strong>Regla:</strong> {estrategia.regla}</p>
      {estrategia.id === "AZAR" && (
        <p className="practica-regla">Este gatillo entra al azar. Si tu acierto es mejor que con este control, tu ojo no detecta nada: es ruido.</p>
      )}

      {error && <p className="lab-error">{error}</p>}
      {!velas && !error && <p>Bajando velas…</p>}

      {tanda && !terminada && vd && i !== null && (
        <>
          <p className="practica-progreso">Pregunta {pos + 1} de {total} · {moneda} · {marcoInfo.nombre}</p>
          {grafico}
          {respuesta === null ? (
            <div className="practica-botones">
              <button type="button" onClick={() => contestar("LONG")}>LONG</button>
              <button type="button" onClick={() => contestar("SHORT")}>SHORT</button>
              <button type="button" onClick={() => contestar("NADA")}>No hay gatillo</button>
            </div>
          ) : (
            <div className="practica-veredicto" role="status">
              <p>
                <strong>{correccion?.acierto ? "Acertaste." : "No acertaste."}</strong> Respondiste {etiquetaEsperada(respuesta)}; el gatillo era {etiquetaEsperada(correccion?.esperada ?? "NADA")}.
              </p>
              {operacion && niveles && (
                <p>
                  Entrada a la apertura de la vela siguiente: {precio(niveles.entrada)} · Stop {precio(niveles.stop)} · Objetivo {precio(niveles.objetivo)}.
                  Resultado: {n2(operacion.r, 2)} R después de costos ({n2(COSTO_PRACTICA_PCT, 2)} % por lado).
                  Tocó: {[operacion.tp1 && "TP1", operacion.tp2 && "TP2", operacion.tp3 && "TP3", operacion.sl && "SL"].filter(Boolean).join(", ") || "ningún nivel en el plazo"}.
                </p>
              )}
              {vd.tipo === "NADA" && <p>En esta vela la regla no dispara: no había nada que operar.</p>}
              <button type="button" onClick={siguiente}>{pos + 1 < total ? "Siguiente" : "Ver resumen"}</button>
            </div>
          )}
        </>
      )}

      {tanda && terminada && (
        <div className="practica-resumen">
          <h3>Resumen de la tanda</h3>
          <p>Aciertos: {resumen.total.aciertos} de {resumen.total.n} (acierto {pct(resumen.total.tasa)}).</p>
          <p>Con gatillo: {resumen.conGatillo.aciertos} de {resumen.conGatillo.n} ({pct(resumen.conGatillo.tasa)}). Sin gatillo: {resumen.sinGatillo.aciertos} de {resumen.sinGatillo.n} ({pct(resumen.sinGatillo.tasa)}).</p>
          <p>Falsos gatillos: viste gatillo en {resumen.falsosGatillos.n} de {resumen.falsosGatillos.sobre} velas sin gatillo.</p>
          {tanda.gatillosDisponibles === 0 && <p>Esta regla no disparó en estas velas: probá otra moneda o marco.</p>}
          <button type="button" onClick={nuevaTanda}>Nueva tanda</button>
        </div>
      )}

      {tanda && !terminada && pos === 0 && respuesta === null && (
        <p className="practica-nota">Cada tanda mezcla gatillos y no-gatillos al 50 %; no es la frecuencia real de la regla. Tu muestra se muestra aparte y debajo de 15 no da porcentaje.</p>
      )}
      <p className="lab-aviso">Práctica sin dinero: lo que se ve en el pasado no garantiza resultados. No es asesoramiento financiero.</p>
    </section>
  );
}
