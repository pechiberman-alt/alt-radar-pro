"use client";

/**
 * Los agentes en el mapa de liquidaciones: el panel con sus posiciones en el par (servidor 24/7 y tu cuenta), la capa del
 * gráfico con un marcador por posición y los niveles de la que elijas, y el aprendizaje diario de la oficina. Lee
 * /api/mapa/agentes al cambiar de par y cada 5 minutos con la pestaña a la vista (nunca en segundo plano). Solo papel.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { diaAr, type Diario } from "../lib/aprendizaje-diario.ts";
import { openLabTab } from "../lib/account-events.ts";
import { textosFoto } from "../lib/mapa-contexto.ts";
import { consensoPar, lecturaViva, rAhora, separar, type FilaPosicion, type MapaVivo, type PosicionAgente } from "../lib/mapa-agentes.ts";
import { haceVelas, LECTORES_FLUJO, textosFlujo, type LecturaFlujo } from "../lib/flujo-lectura.ts";
import { motivosContra, TEXTO_VEREDICTO } from "../lib/confluencia.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

type Respuesta = { symbol: string; servidor: FilaPosicion[] | null; cuenta: FilaPosicion[] | null; sesion: boolean; diario: Diario | null };
const REFRESCO_MS = 5 * 60_000;
const MIN_ENTRE_LECTURAS_MS = 60_000;

/** Las posiciones de los agentes en el par: se leen al cambiar de par y cada 5 minutos, solo con la pestaña a la vista. */
export function useAgentesDelPar(symbol: string, activo: boolean) {
  const [estado, setEstado] = useState<{ symbol: string; datos: Respuesta | null; error: boolean } | null>(null);
  const ultima = useRef(0);
  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    const cargar = async (forzar: boolean) => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (!forzar && Date.now() - ultima.current < MIN_ENTRE_LECTURAS_MS) return;
      ultima.current = Date.now();
      try {
        const r = await fetch(`/api/mapa/agentes?symbol=${encodeURIComponent(symbol)}`, { credentials: "same-origin", cache: "no-store" });
        const d = r.ok ? ((await r.json()) as Respuesta) : null;
        if (vivo) setEstado({ symbol, datos: d, error: !d });
      } catch {
        if (vivo) setEstado({ symbol, datos: null, error: true });
      }
    };
    void cargar(true);
    const id = window.setInterval(() => void cargar(true), REFRESCO_MS);
    const alVolver = () => void cargar(false);
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      vivo = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [symbol, activo]);

  return useMemo(() => {
    const d = estado?.symbol === symbol ? estado.datos : null;
    const sv = separar(d?.servidor, "SERVIDOR");
    const cu = separar(d?.cuenta, "CUENTA");
    return {
      cargando: activo && estado?.symbol !== symbol,
      error: estado?.symbol === symbol && estado.error,
      sinServidor: Boolean(d) && d?.servidor === null,
      sesion: d?.sesion ?? false,
      abiertas: [...cu.abiertas, ...sv.abiertas],
      cerradas: [...cu.cerradas, ...sv.cerradas].sort((a, b) => (b.cerrada ?? 0) - (a.cerrada ?? 0)).slice(0, 8),
      diario: d?.diario ?? null,
    };
  }, [estado, symbol, activo]);
}

const rTxt = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2).replace(".", ",")} R`);
const hace = (t: number) => {
  const h = Math.max(0, (Date.now() - t) / 3_600_000);
  return h < 1 ? "hace menos de 1 h" : h < 48 ? `hace ${Math.round(h)} h` : `hace ${Math.round(h / 24)} días`;
};
const base = (symbol: string) => (symbol === "XAUUSDT" ? "ORO" : symbol === "XAGUSDT" ? "PLATA" : symbol === "PAXGUSDT" ? "ORO (PAXG)" : symbol.replace(/USDT$/, ""));

/** Un disparo de la mesa de flujo dibujado en su vela: debajo del mínimo si es de compra, encima del máximo si es de venta. */
export type MarcaFlujo = { clave: string; x: number; y: number; lado: "LONG" | "SHORT"; codigo: string; titulo: string };

/** La capa del gráfico: un marcador por posición abierta en su entrada y, para la elegida, sus niveles de punta a punta. */
export function CapaAgentes(props: {
  abiertas: PosicionAgente[];
  flujo?: MarcaFlujo[];
  elegida: string | null;
  onElegir: (clave: string | null) => void;
  y: (precio: number) => number;
  x0: number;
  ancho: number;
  arriba: number;
  abajo: number;
  fmt: (precio: number) => string;
}) {
  const { abiertas, elegida, onElegir, y, x0, ancho, arriba, abajo, fmt, flujo = [] } = props;
  const dentro = (yy: number) => yy >= arriba && yy <= abajo;
  // Los marcadores se apilan hacia la izquierda cuando dos entradas caen a menos de 14 px.
  const marcas = [...abiertas].sort((a, b) => a.entrada - b.entrada).reduce<{ p: PosicionAgente; yy: number; col: number }[]>((acc, p) => {
    const yy = y(p.entrada);
    const previas = acc.filter((m) => Math.abs(m.yy - yy) < 14);
    acc.push({ p, yy, col: previas.length });
    return acc;
  }, []);
  const sel = abiertas.find((p) => p.clave === elegida) ?? null;
  const xFin = x0 + ancho;
  const niveles = sel
    ? [
        { k: "entrada", precio: sel.entrada, txt: `${sel.lado === "LONG" ? "▲" : "▼"} ${sel.codigo} · entrada ${fmt(sel.entrada)}`, cls: `ag-l-entrada ${sel.lado === "LONG" ? "up" : "down"}` },
        { k: "sl", precio: sel.sl, txt: `SL ${fmt(sel.sl)} · −1 R`, cls: "ag-l-sl" },
        { k: "tp1", precio: sel.tp1, txt: `TP1 ${fmt(sel.tp1)}${sel.tp1At ? " ✓" : ""}`, cls: `ag-l-tp${sel.tp1At ? " hit" : ""}` },
        { k: "tp2", precio: sel.tp2, txt: `TP2 ${fmt(sel.tp2)}${sel.tp2At ? " ✓" : ""}`, cls: `ag-l-tp${sel.tp2At ? " hit" : ""}` },
        { k: "tp3", precio: sel.tp3, txt: `TP3 ${fmt(sel.tp3)} · ${rTxt(Math.abs(sel.tp3 - sel.entrada) / Math.abs(sel.entrada - sel.sl))}`, cls: "ag-l-tp" },
      ]
    : [];
  return (
    <g className="ag-capa">
      {flujo.map((m) => {
        if (m.y < arriba - 2 || m.y > abajo + 2) return null;
        const up = m.lado === "LONG";
        const yy = up ? m.y + 9 : m.y - 9;
        return (
          <g key={m.clave} className={`ag-flujo ${up ? "up" : "down"}`} transform={`translate(${m.x},${yy})`}>
            <title>{m.titulo}</title>
            <path d={up ? "M-4 3 L0 -3 L4 3 Z" : "M-4 -3 L0 3 L4 -3 Z"} />
            <text y={up ? 13 : -7} textAnchor="middle">
              {m.codigo}
            </text>
          </g>
        );
      })}
      {sel && (
        <rect
          x={x0}
          y={Math.min(y(sel.sl), y(sel.tp3))}
          width={ancho}
          height={Math.abs(y(sel.sl) - y(sel.tp3))}
          className={`ag-banda ${sel.lado === "LONG" ? "up" : "down"}`}
        />
      )}
      {niveles.map((n) => {
        const yy = y(n.precio);
        if (!dentro(yy)) return null;
        return (
          <g key={n.k} className={n.cls}>
            <line x1={x0} x2={xFin} y1={yy} y2={yy} />
            <text x={xFin - 44} y={yy - 3} textAnchor="end">
              {n.txt}
            </text>
          </g>
        );
      })}
      {marcas.map(({ p, yy, col }) => {
        if (!dentro(yy)) return null;
        const x = xFin - 4 - col * 40;
        const on = p.clave === elegida;
        return (
          <g
            key={p.clave}
            className={`ag-marca ${p.lado === "LONG" ? "up" : "down"}${p.plan === "CUENTA" ? " cuenta" : ""}${on ? " on" : ""}`}
            transform={`translate(${x},${yy})`}
            onClick={() => onElegir(on ? null : p.clave)}
          >
            <title>{`${p.nombre} · ${p.lado === "LONG" ? "largo" : "corto"} desde ${fmt(p.entrada)} (${p.plan === "SERVIDOR" ? "servidor 24/7" : "tu cuenta"})`}</title>
            <rect x={-38} y={-7} width={38} height={14} rx={3} />
            <path d={p.lado === "LONG" ? "M-6 3 L-2 -3 L2 3 Z" : "M-6 -3 L-2 3 L2 -3 Z"} transform="translate(-1,0)" />
            <text x={-11} y={3.5} textAnchor="end">
              {p.codigo}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function Chips({ items }: { items: { tono: "bien" | "mal" | "neutro"; texto: string }[] }) {
  return (
    <span className="ag-chips">
      {items.map((c) => (
        <span key={c.texto} className={`ag-chip ${c.tono}`}>
          {c.texto}
        </span>
      ))}
    </span>
  );
}

/** El panel: posiciones con su foto al entrar y la lectura de ahora, cierres recientes y el aprendizaje diario. */
export function PanelAgentes(props: {
  symbol: string;
  datos: ReturnType<typeof useAgentesDelPar>;
  /** La mesa de flujo leyendo las velas cerradas del gráfico (null mientras el mapa carga). */
  flujo?: { lectura: LecturaFlujo; cerradas: SwingCandle[]; timeframe: string } | null;
  precio: number | null;
  mapa: MapaVivo | null;
  elegida: string | null;
  onElegir: (clave: string | null) => void;
  fmt: (precio: number) => string;
}) {
  const { symbol, datos, precio, mapa, elegida, onElegir, fmt, flujo = null } = props;
  const { largos, cortos } = consensoPar(datos.abiertas);
  const total = largos + cortos;
  const par = base(symbol);
  const diario = datos.diario;
  return (
    <section className="ag-panel" aria-label={`Agentes en ${par}`}>
      <header className="ag-cab">
        <div>
          <h4>
            AGENTES EN {par} <small>· papel · servidor 24/7{datos.sesion ? " y tu cuenta" : ""}</small>
          </h4>
          <p>Las posiciones de los agentes en este par, con la foto del mapa al entrar y lo que el mapa dice ahora.</p>
        </div>
        {total > 0 && (
          <div className="ag-consenso" title="Cuántos van largos y cuántos cortos. Es una cuenta, no una predicción.">
            <span className="up">{largos} ▲</span>
            <span className="ag-barra" aria-hidden="true">
              <i style={{ width: `${(largos / total) * 100}%` }} />
            </span>
            <span className="down">▼ {cortos}</span>
          </div>
        )}
      </header>

      {datos.cargando ? (
        <p className="ag-vacio">Leyendo a los agentes…</p>
      ) : datos.error ? (
        <p className="ag-vacio">No pude leer a los agentes ahora: sin datos (no es cero). Se vuelve a intentar en unos minutos.</p>
      ) : datos.abiertas.length === 0 ? (
        <p className="ag-vacio">
          Ningún agente tiene posición abierta en {par}. Corren en velas de 4 h: entran cuando su regla se cumple al cierre de una vela.
          {datos.sinServidor ? " (No pude leer el servidor: lo de tu cuenta sí está.)" : ""}
        </p>
      ) : (
        <ul className="ag-lista">
          {datos.abiertas.map((p) => {
            const r = rAhora(p, precio);
            const on = elegida === p.clave;
            const viva = lecturaViva(p, mapa);
            return (
              <li key={p.clave} className={`ag-pos ${p.lado === "LONG" ? "up" : "down"}${on ? " on" : ""}`}>
                <button type="button" className="ag-pos-cab" aria-pressed={on} onClick={() => onElegir(on ? null : p.clave)}>
                  <span className="ag-cod">{p.codigo}</span>
                  <b>{p.nombre}</b>
                  <span className={`ag-plan ${p.plan === "SERVIDOR" ? "sv" : "cu"}`}>{p.plan === "SERVIDOR" ? "SERVIDOR 24/7" : "TU CUENTA"}</span>
                  <span className="ag-lado">{p.lado === "LONG" ? "▲ LARGO" : "▼ CORTO"}</span>
                  <span className={`ag-r ${r === null ? "" : r >= 0 ? "up" : "down"}`} title="Al precio del mapa, sin comisiones: es para mirar. El R que cuenta es el del cierre.">
                    {rTxt(r)} <small>ahora</small>
                  </span>
                </button>
                <div className="ag-niveles">
                  <span>
                    ENTRADA <b>{fmt(p.entrada)}</b>
                  </span>
                  <span className="sl">
                    SL <b>{fmt(p.sl)}</b>
                  </span>
                  <span className={p.tp1At ? "hit" : ""}>
                    TP1 <b>{fmt(p.tp1)}</b>
                    {p.tp1At ? " ✓" : ""}
                  </span>
                  <span className={p.tp2At ? "hit" : ""}>
                    TP2 <b>{fmt(p.tp2)}</b>
                    {p.tp2At ? " ✓" : ""}
                  </span>
                  <span>
                    TP3 <b>{fmt(p.tp3)}</b>
                  </span>
                </div>
                <div className="ag-lecturas">
                  <div>
                    <small>AL ENTRAR</small>
                    {p.foto ? <Chips items={textosFoto(p.foto)} /> : <em>sin foto del mapa: entró antes de que existiera</em>}
                    {p.flujo && <Chips items={textosFlujo(p.flujo)} />}
                  </div>
                  <div>
                    <small>CON EL MAPA</small>
                    {p.veredicto ? (
                      <Chips
                        items={[
                          {
                            tono: p.veredicto === "EN_CONTRA" ? "mal" : p.veredicto === "A_FAVOR" ? "bien" : "neutro",
                            texto: p.veredicto === "EN_CONTRA" ? `${TEXTO_VEREDICTO.EN_CONTRA} (${motivosContra(p.foto, p.flujo).join(", ")})` : TEXTO_VEREDICTO[p.veredicto],
                          },
                        ]}
                      />
                    ) : (
                      <em>sin veredicto: entró antes de la foto del flujo</em>
                    )}
                  </div>
                  <div>
                    <small>AHORA</small>
                    {viva.length ? <Chips items={viva} /> : <em>el mapa todavía no terminó de leer este par</em>}
                  </div>
                </div>
                <p className="ag-meta">
                  Abierta {hace(p.detectada)} · {p.venue === "KRAKEN" ? "precios de Kraken (USD): puede diferir unos centavos del mapa" : p.plan === "SERVIDOR" ? "precios del servidor" : "precios de Binance"}
                  {p.acuerdo !== null ? ` · ${p.acuerdo ? `entró junto con ${p.acuerdo} ${p.acuerdo === 1 ? "agente más" : "agentes más"}` : "entró solo"}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {flujo && <MesaFlujo flujo={flujo} par={par} fmt={fmt} />}

      {datos.cerradas.length > 0 && (
        <div className="ag-cierres">
          <h5>ÚLTIMOS CIERRES EN {par}</h5>
          {datos.cerradas.map((p) => (
            <div key={p.clave} className={`ag-cierre ${(p.r ?? 0) >= 0 ? "up" : "down"}`}>
              <span className="ag-cod">{p.codigo}</span>
              <span>{p.nombre}</span>
              <span>{p.lado === "LONG" ? "▲" : "▼"}</span>
              <b>{rTxt(p.r)}</b>
              <small>
                {p.desenlace} · {p.cerrada ? diaAr(p.cerrada).slice(5).split("-").reverse().join("/") : ""}
              </small>
            </div>
          ))}
        </div>
      )}

      <div className="ag-aprende">
        <h5>
          APRENDIZAJE DIARIO <small>{diario ? `· ${diario.dia.slice(8, 10)}/${diario.dia.slice(5, 7)} · servidor 24/7` : ""}</small>
        </h5>
        {diario ? (
          <ul>
            {diario.comparaciones
              .filter((c) => c.tema !== "CONSENSO")
              .map((c) => (
                <li key={c.tema} className={c.firme ? "firme" : ""}>
                  {c.texto}
                </li>
              ))}
          </ul>
        ) : (
          <p className="ag-vacio">El primer diario se arma esta noche a las 00:15 (Argentina) con lo que cierren los agentes.</p>
        )}
        <button type="button" className="ag-boton" onClick={() => openLabTab("oficina")}>
          VER LA OFICINA Y EL DIARIO
        </button>
      </div>

      <p className="ag-nota">
        Papel: ningún agente opera con dinero real ni cambia su regla por lo que diga el mapa. La foto se toma al entrar, con las velas
        de 4 h ya cerradas; la lectura de ahora usa el mapa que estás viendo. Aprender es medir y contarlo. No es asesoramiento
        financiero.
      </p>
    </section>
  );
}

/** Lo que ve la mesa de flujo en el gráfico de ahora: las mismas cinco reglas, sobre las velas ya cerradas. Lectura, no operación. */
function MesaFlujo({ flujo, par, fmt }: { flujo: { lectura: LecturaFlujo; cerradas: SwingCandle[]; timeframe: string }; par: string; fmt: (precio: number) => string }) {
  const { lectura, cerradas, timeframe } = flujo;
  const ultimos = lectura.disparos.slice(0, 6);
  const ultimoDe = LECTORES_FLUJO.map((l) => ({ l, d: lectura.disparos.find((x) => x.id === l.id) ?? null }));
  return (
    <div className="ag-flujo-mesa">
      <h5>
        MESA DE FLUJO EN {par} {timeframe.toUpperCase()} <small>· últimas {lectura.velas} velas cerradas</small>
      </h5>
      <div className="ag-flujo-estado">
        {ultimoDe.map(({ l, d }) => (
          <span key={l.id} className={`ag-flujo-chip ${d ? (d.lado === "LONG" ? "up" : "down") : l.delta && lectura.sinDelta ? "sin" : ""}`} title={l.corto}>
            <b>{l.codigo}</b> {d ? `${d.lado === "LONG" ? "▲" : "▼"} ${haceVelas(d, cerradas)}` : l.delta && lectura.sinDelta ? "sin volumen agresor" : "sin disparo"}
          </span>
        ))}
      </div>
      {ultimos.length ? (
        <ul className="ag-flujo-lista">
          {ultimos.map((d) => (
            <li key={`${d.id}-${d.openTime}`} className={d.lado === "LONG" ? "up" : "down"}>
              <span className="ag-cod">{d.codigo}</span>
              <span>
                {d.corto} {d.lado === "LONG" ? "▲ compra" : "▼ venta"} · {haceVelas(d, cerradas)} · cierre {fmt(d.cierre)}
              </span>
              <small>
                SL {fmt(d.stop)} · TP {fmt(d.objetivo)} (2 R)
              </small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ag-vacio">Ninguna de las cinco reglas disparó en estas velas: no hay absorción, esfuerzo, barrida ni delta que leer.</p>
      )}
      <p className="ag-nota">
        Las mismas reglas de los agentes de flujo, sobre las velas cerradas de este gráfico: es una lectura para mirar, no una operación. En
        papel operan solo en 4 h.{lectura.sinDelta ? " Estas velas no traen el volumen agresor (no vienen de Binance): las dos reglas de delta no pueden leer, y eso no es cero." : " El delta sale del volumen agresor de Binance."}{" "}
        Medición en el historial: sin ventaja después de costos en 1 h y 15 min, sin conclusión en 4 h. No es asesoramiento financiero.
      </p>
    </div>
  );
}
