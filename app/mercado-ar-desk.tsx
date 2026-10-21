"use client";

/**
 * MERCADO AR: acciones del panel líder de BYMA y CEDEARs, con ruedas diarias (Yahoo Finance, con demora). Arriba el Merval
 * y el S&P 500; abajo cinco pestañas: ACCIONES y CEDEARS (tarjetas con su recorrido de 3 meses; tocar una abre el papel en
 * el MAPA), MEJORES COMPRAS FIBONACCI (los papeles con el precio en la zona 0,618–0,786 o cerca, con plan), MENTES Y
 * AGENTES (ranking, señales con lo que opinan las mentes, cada agente medido contra el azar) y la SALA DE LAS MENTES
 * (reuniones y preguntas). Las series llegan en lotes. Sin footprint ni liquidaciones (BYMA no los publica). No es
 * asesoramiento financiero.
 */
import { useEffect, useMemo, useState } from "react";
import { ACCIONES_AR, CEDEARS, INDICE_EEUU, INDICE_MERVAL, PAPELES_AR, type PapelAr } from "@/lib/mercado-ar";
import { cargarLote, panelCompleto, type LecturaPapel, type SerieCargada } from "@/lib/mercado-ar-cliente";
import { medirUniverso, ESTUDIO_AR, EXCLUIDOS_AR } from "@/lib/mercado-ar-agentes";
import { mejoresComprasFib, senalesConMentes, CERCA_ZONA, type PapelLeido } from "@/lib/mercado-ar-ranking";
import { MUESTRA_ESTUDIO } from "@/lib/estrategias";
import { AVISO_MENTES } from "@/lib/mentes-inversoras";
import { onMercadoAr, openArEnMapa, openTutorial } from "@/lib/account-events";
import type { SwingCandle } from "@/lib/swing-entries";
import { fmt, fmtPct } from "./mercado-ar-vistas";
import SalaMentes from "./sala-mentes";

type Pestania = "ACCIONES" | "CEDEARS" | "FIBONACCI" | "ESCANER" | "SALA";

const leidoDe = (l: LecturaPapel): PapelLeido => ({ ...l, cierre: l.serie.serie?.velas.at(-1)?.close ?? null });
const variacion = (v: SwingCandle[], n: number) => (v.length > n ? (v.at(-1)!.close / v[v.length - 1 - n].close - 1) * 100 : null);

/** El recorrido de las últimas ruedas, en una línea. */
function Spark({ velas, n = 63 }: { velas: SwingCandle[]; n?: number }) {
  const v = velas.slice(-n);
  if (v.length < 2) return <svg className="ar-spark" viewBox="0 0 100 30" aria-hidden="true" />;
  const lo = Math.min(...v.map((c) => c.close));
  const hi = Math.max(...v.map((c) => c.close));
  const pts = v.map((c, k) => `${((k / (v.length - 1)) * 100).toFixed(1)},${(28 - ((c.close - lo) / (hi - lo || 1)) * 26).toFixed(1)}`).join(" ");
  const sube = v.at(-1)!.close >= v[0].close;
  return (
    <svg className="ar-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={sube ? "#39f29a" : "#ff5964"} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Indices() {
  const [s, setS] = useState<SerieCargada[] | null>(null);
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const r = await cargarLote([INDICE_MERVAL, INDICE_EEUU]);
      if (vivo) setS(r);
    })();
    return () => {
      vivo = false;
    };
  }, []);
  const nombres = ["MERVAL", "S&P 500 (SPY)"];
  return (
    <div className="ar-indices">
      {nombres.map((n, k) => {
        const v = s?.[k]?.serie?.velas ?? [];
        const d = variacion(v, 1);
        return (
          <div className="ar-indice" key={n}>
            <span>{n}</span>
            <b>{s ? fmt(v.at(-1)?.close ?? null, 0) : "…"}</b>
            <small className={d === null ? "ar-mute" : d >= 0 ? "ar-up" : "ar-down"}>{s ? `${fmtPct(d, 2)} · 1 mes ${fmtPct(variacion(v, 21), 1)}` : ""}</small>
            <Spark velas={v} />
          </div>
        );
      })}
    </div>
  );
}

function Tarjetas({ papeles }: { papeles: PapelAr[] }) {
  const [series, setSeries] = useState<Record<string, SerieCargada>>({});
  const [buscar, setBuscar] = useState("");
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const r = await cargarLote(papeles.map((p) => p.yahoo));
      if (vivo) setSeries(Object.fromEntries(papeles.map((p, k) => [p.ticker, r[k]])));
    })();
    return () => {
      vivo = false;
    };
  }, [papeles]);
  const q = buscar.trim().toUpperCase();
  const visibles = q ? papeles.filter((p) => p.ticker.includes(q) || p.nombre.toUpperCase().includes(q)) : papeles;
  return (
    <>
      <input className="ar-buscar" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por ticker o nombre…" aria-label="Buscar papel" />
      <div className="ar-cards">
        {visibles.map((p) => {
          const s = series[p.ticker];
          const v = s?.serie?.velas ?? [];
          const d1 = variacion(v, 1);
          return (
            <button key={p.ticker} className="ar-card" onClick={() => openArEnMapa(p.ticker)} title={`${p.nombre}: abrir en el MAPA`}>
              <span className="ar-card-top">
                <b>{p.ticker}</b>
                <span className={d1 === null ? "ar-mute" : d1 >= 0 ? "ar-up" : "ar-down"}>{s ? fmtPct(d1, 2) : "…"}</span>
              </span>
              <small>{p.nombre}</small>
              <span className="ar-precio">{s ? (s.serie ? fmt(v.at(-1)?.close ?? null) : "SIN DATOS") : "…"}</span>
              <Spark velas={v} />
              <small>
                {s && s.estado.estado !== "OK" ? <span className="ar-warn">{s.estado.estado}</span> : `1 mes ${fmtPct(variacion(v, 21), 1)} · 1 año ${fmtPct(variacion(v, 250), 0)}`}
              </small>
            </button>
          );
        })}
      </div>
    </>
  );
}

/** Lee todo el panel una vez (lo comparten las pestañas que lo necesitan). */
function usePanel() {
  const [lecturas, setLecturas] = useState<LecturaPapel[] | null>(null);
  const [avance, setAvance] = useState<{ texto: string; hechos: number; total: number } | null>(null);
  const correr = async (nuevo = false) => {
    setAvance({ texto: "Empezando", hechos: 0, total: 1 });
    const out = await panelCompleto((texto, hechos, total) => setAvance({ texto, hechos, total }), nuevo);
    setLecturas(out);
    setAvance(null);
  };
  return { lecturas, avance, correr };
}

function Cargar({ titulo, texto, avance, correr }: { titulo: string; texto: string; avance: { texto: string; hechos: number; total: number } | null; correr: () => void }) {
  return (
    <div className="ar-box">
      <h3>{titulo}</h3>
      <p>{texto}</p>
      {avance ? (
        <>
          <p>
            {avance.texto}… {avance.hechos}/{avance.total}
          </p>
          <div className="ar-progress">
            <i style={{ width: `${(avance.hechos / Math.max(1, avance.total)) * 100}%` }} />
          </div>
        </>
      ) : (
        <button className="ar-chip-btn on" onClick={correr}>
          LEER TODO EL PANEL
        </button>
      )}
    </div>
  );
}

function MejoresFib({ lecturas }: { lecturas: LecturaPapel[] }) {
  const lista = useMemo(() => mejoresComprasFib(lecturas.map(leidoDe), 15), [lecturas]);
  return (
    <div className="ar-wrap" style={{ padding: 0 }}>
      <p className="ar-mute" style={{ fontSize: 11 }}>
        Papeles con el precio dentro de la zona de compra de Fibonacci (retroceso 0,618–0,786 de su última subida) o hasta {fmt(CERCA_ZONA * 100, 0)} % arriba. Primero los que están adentro; después,
        los que más veces aguantaron en esa zona en el mismo papel (con al menos 3 casos) y los de mejor relación riesgo/objetivo. Es un orden, no una probabilidad.
      </p>
      {lista.length === 0 && <div className="ar-box"><p>Hoy ningún papel está en su zona de compra de Fibonacci ni cerca.</p></div>}
      <div className="ar-cards" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))" }}>
        {lista.map((c) => (
          <button key={c.ticker} className="ar-fib-card" onClick={() => openArEnMapa(c.ticker)}>
            <span className="ar-card-top">
              <b>{c.ticker}</b>
              <span className={`ar-chip ${c.estado === "EN LA ZONA" ? "ok" : "alerta"}`}>{c.estado === "EN LA ZONA" ? "EN LA ZONA" : `A ${fmt(c.distancia * 100, 1)} % DE LA ZONA`}</span>
            </span>
            <small>
              {c.tipo === "CEDEAR" ? "CEDEAR" : "ACCIÓN"} · subida {fmt(c.fib.pierna.origen)} → {fmt(c.fib.pierna.extremo)}
            </small>
            <span>
              ZONA {fmt(c.fib.zona.bajo)} – {fmt(c.fib.zona.alto)}
            </span>
            {c.fib.plan && (
              <span className="ar-plan">
                SL {fmt(c.fib.plan.stop)} · TP1 {fmt(c.fib.plan.tp1)} · TP2 {fmt(c.fib.plan.tp2)} · TP3 {fmt(c.fib.plan.tp3)} · R:R {fmt(c.fib.plan.rr, 1)}
              </span>
            )}
            <small>
              {c.resueltas ? `En este papel aguantó ${c.fib.historial.aguantaron} de ${c.resueltas}${c.resueltas < 15 ? " (muestra mínima)" : ""}` : "Sin casos anteriores resueltos en este papel"} · mentes{" "}
              {c.consenso.aFavor}▲ {c.consenso.enContra}▼
            </small>
          </button>
        ))}
      </div>
      <p className="ar-mute" style={{ fontSize: 10 }}>Entrada a mitad de zona, stop bajo el origen de la subida, TP1 en el máximo, TP2 y TP3 en las extensiones 1,272 y 1,618. No es asesoramiento financiero.</p>
    </div>
  );
}

function Escaner({ lecturas, correr, avance }: { lecturas: LecturaPapel[]; correr: () => void; avance: { hechos: number; total: number } | null }) {
  const leidos = lecturas.map(leidoDe);
  const ranking = [...lecturas].sort((a, b) => b.consenso.aFavor - b.consenso.enContra - (a.consenso.aFavor - a.consenso.enContra) || b.consenso.aFavor - a.consenso.aFavor);
  const senales = senalesConMentes(leidos);
  const universo = medirUniverso(lecturas.map((l) => l.agentes)).sort((a, b) => (b.medicion.expectancia ?? -9) - (a.medicion.expectancia ?? -9));
  const sinDatos = lecturas.filter((l) => !l.serie.serie);
  return (
    <div className="ar-wrap" style={{ padding: 0 }}>
      <div className="ar-head">
        <span className="ar-mute">
          {lecturas.length - sinDatos.length} papeles con datos{sinDatos.length ? ` · sin datos: ${sinDatos.map((l) => l.papel.ticker).join(", ")}` : ""}
        </span>
        <button className="ar-chip-btn" onClick={correr} disabled={avance !== null}>
          {avance ? `${avance.hechos}/${avance.total}…` : "VOLVER A LEER"}
        </button>
      </div>

      <div className="ar-box">
        <h3>RANKING DE LAS MENTES</h3>
        <div className="ar-scroll">
          <table className="ar-table">
            <thead>
              <tr>
                <th>PAPEL</th>
                <th>CIERRE</th>
                <th>A FAVOR</th>
                <th>EN CONTRA</th>
                <th>FIBONACCI</th>
                <th>SEÑALES</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((l) => (
                <tr key={l.papel.ticker} onClick={() => openArEnMapa(l.papel.ticker)} style={{ cursor: "pointer" }}>
                  <td>
                    <b>{l.papel.ticker}</b> <span className="ar-mute">{l.papel.tipo === "CEDEAR" ? "CEDEAR" : "ACCIÓN"}</span>
                  </td>
                  <td>{fmt(l.serie.serie?.velas.at(-1)?.close ?? null)}</td>
                  <td className="ar-up">
                    {l.consenso.aFavor} de {l.consenso.opinan}
                    {l.consenso.aFavor ? ` · ${l.mentes.filter((m) => m.postura === "A FAVOR").map((m) => m.mente.split(" ")[1] ?? m.mente).join(", ")}` : ""}
                  </td>
                  <td className="ar-down">{l.consenso.enContra}</td>
                  <td className={l.fib?.estado === "EN LA ZONA" ? "ar-up" : "ar-mute"}>{l.fib ? l.fib.estado.toLowerCase() : "sin zona"}</td>
                  <td>{l.agentes.filter((a) => a.senalHoy).length || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="ar-mute">Cuenta mentes, no es una probabilidad. Tocá un papel para verlo en el MAPA con cada criterio. {AVISO_MENTES}</p>
      </div>

      <div className="ar-box">
        <h3>SEÑALES DE COMPRA DE LOS AGENTES, CON LAS MENTES · {senales.length}</h3>
        {senales.length === 0 && <p>Ningún agente disparó en la última rueda cerrada.</p>}
        {senales.map(({ ticker, agente: a, consenso: c }) => (
          <button className="ar-agente" key={`${ticker}-${a.id}`} onClick={() => openArEnMapa(ticker)}>
            <b>
              {ticker} · {a.agente} · mentes {c.aFavor}▲ {c.enContra}▼ de {c.opinan}
            </b>
            <div className="ar-plan">
              ref. {fmt(a.senalHoy!.referencia)} · SL {fmt(a.senalHoy!.escalera.stop)} · TP1 {fmt(a.senalHoy!.escalera.tp1)} · TP2 {fmt(a.senalHoy!.escalera.tp2)} · TP3 {fmt(a.senalHoy!.escalera.tp3)} · R:R {fmt(a.senalHoy!.rr, 1)}
            </div>
          </button>
        ))}
        <p className="ar-mute">Primero las que más mentes acompañan. Entrada en la apertura de la rueda siguiente. Mirá cómo le fue a cada agente abajo antes de darle peso. No es asesoramiento financiero.</p>
      </div>

      <div className="ar-box">
        <h3>LOS AGENTES EN TODO EL PANEL (BACKTEST)</h3>
        <div className="ar-scroll">
          <table className="ar-table">
            <thead>
              <tr>
                <th>AGENTE</th>
                <th>OP.</th>
                <th>ACIERTO</th>
                <th>PF</th>
                <th>EXPECTANCIA (90 %)</th>
                <th>VEREDICTO</th>
              </tr>
            </thead>
            <tbody>
              {universo.map((x) => {
                const m = x.medicion;
                return (
                  <tr key={x.id}>
                    <td>
                      <b>{x.agente}</b>
                    </td>
                    <td>{m.operaciones}</td>
                    <td>{m.winRate === null ? "—" : fmtPct(m.winRate * 100, 0)}</td>
                    <td>{m.profitFactor === null ? "—" : fmt(m.profitFactor)}</td>
                    <td>
                      {m.expectancia === null ? "—" : `${fmt(m.expectancia, 2)} R`}
                      {m.expectanciaIc ? <span className="ar-mute"> [{fmt(m.expectanciaIc.low, 2)}; {fmt(m.expectanciaIc.high, 2)}]</span> : null}
                    </td>
                    <td className={x.veredicto === "VENTAJA" ? "ar-up" : x.veredicto === "SIN VENTAJA" ? "ar-down" : "ar-mute"}>{x.id === "AZAR" ? "CONTROL" : x.veredicto}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="ar-mute">
          Todas las operaciones de cada agente en todos los papeles, solo compras, horizonte {ESTUDIO_AR.horizonte} ruedas, comisión supuesta {fmt(ESTUDIO_AR.feePct, 1)} % por lado. VENTAJA pide al menos{" "}
          {MUESTRA_ESTUDIO} operaciones, el intervalo de la expectancia entero sobre cero y ganarle al azar; con menos, SIN CONCLUSIÓN. Es un estudio sobre el pasado, no el registro unificado: no garantiza nada. {EXCLUIDOS_AR}
        </p>
      </div>
    </div>
  );
}

export default function MercadoArDesk() {
  const [pestania, setPestania] = useState<Pestania>("ACCIONES");
  const { lecturas, avance, correr } = usePanel();
  // El tutorial (y cualquier otra parte) puede pedir una pestaña.
  useEffect(
    () =>
      onMercadoAr((p) => {
        if (["ACCIONES", "CEDEARS", "FIBONACCI", "ESCANER", "SALA"].includes(p)) setPestania(p as Pestania);
      }),
    [],
  );
  const pestanias: { id: Pestania; texto: string }[] = [
    { id: "ACCIONES", texto: `ACCIONES (${ACCIONES_AR.length})` },
    { id: "CEDEARS", texto: `CEDEARS (${CEDEARS.length})` },
    { id: "FIBONACCI", texto: "MEJORES COMPRAS FIBONACCI" },
    { id: "ESCANER", texto: "MENTES Y AGENTES" },
    { id: "SALA", texto: "SALA DE LAS MENTES" },
  ];
  const textoCarga = `Las mentes, los agentes y Fibonacci leen los ${PAPELES_AR.length} papeles. La primera vez tarda un poco (los balances de SEC se bajan de a una empresa); después queda en memoria mientras la pestaña esté abierta.`;
  return (
    <div className="ar-wrap">
      <Indices />
      <p className="ar-flag">
        <b>RUEDAS DIARIAS CON DEMORA</b> · Yahoo Finance (BYMA). Sin footprint ni liquidaciones: BYMA no publica cada operación con su lado agresor ni el apalancamiento de las posiciones. No es asesoramiento financiero.
      </p>
      <button className="ar-chip-btn ar-ayuda" onClick={openTutorial}>¿CÓMO SE USA? · TUTORIAL</button>
      <div className="ar-tabs" role="tablist">
        {pestanias.map((p) => (
          <button key={p.id} role="tab" aria-selected={pestania === p.id} className={pestania === p.id ? "on" : ""} onClick={() => setPestania(p.id)}>
            {p.texto}
          </button>
        ))}
      </div>
      {pestania === "ACCIONES" && <Tarjetas papeles={ACCIONES_AR} />}
      {pestania === "CEDEARS" && <Tarjetas papeles={CEDEARS} />}
      {(pestania === "FIBONACCI" || pestania === "ESCANER") &&
        (lecturas ? (
          pestania === "FIBONACCI" ? (
            <MejoresFib lecturas={lecturas} />
          ) : (
            <Escaner lecturas={lecturas} correr={() => void correr(true)} avance={avance} />
          )
        ) : (
          <Cargar titulo={pestania === "FIBONACCI" ? "MEJORES COMPRAS FIBONACCI" : "MENTES Y AGENTES"} texto={textoCarga} avance={avance} correr={() => void correr()} />
        ))}
      {/* La sala queda montada: cambiar de pestaña no corta la reunión. */}
      <div hidden={pestania !== "SALA"}>
        <SalaMentes />
      </div>
    </div>
  );
}
