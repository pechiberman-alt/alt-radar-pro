"use client";

/**
 * Las vistas de MERCADO AR que comparten el panel y el MAPA: el gráfico diario de un papel (app/grafico-ar-tv.tsx, estilo
 * terminal), el análisis técnico y la zona de compra de Fibonacci, las MENTES (lib/mentes-inversoras.ts) y los agentes del
 * laboratorio (lib/mercado-ar-agentes.ts), y MapaAr, la vista completa de un papel que el MAPA muestra en lugar del mapa de
 * liquidaciones (que para acciones no existe y se dice). Todo con ruedas cerradas; no es asesoramiento financiero.
 */
import { useEffect, useMemo, useState } from "react";
import { PAPELES_AR, TEXTO_SIN_FOOTPRINT, type PapelAr } from "@/lib/mercado-ar";
import { AVISO_MENTES, type Consenso, type LecturaMente } from "@/lib/mentes-inversoras";
import { EXCLUIDOS_AR, ESTUDIO_AR, type AgenteEnPapel } from "@/lib/mercado-ar-agentes";
import { medir } from "@/lib/estrategias";
import { MUESTRA_MINIMA } from "@/lib/registro";
import { TEXTO_SIN_LIQUIDACIONES } from "@/lib/mercado-ar-mapa";
import { analisisAr, type AnalisisAr } from "@/lib/mercado-ar-tecnico";
import { cargarPanel, leerPapel, type LecturaPapel } from "@/lib/mercado-ar-cliente";
import GraficoTv from "./grafico-ar-tv";
import { PizarraPanel, RazonamientoMente } from "./pizarra-panel";
import type { Razonamiento } from "@/lib/mentes-metodo";
import type { SwingCandle } from "@/lib/swing-entries";

export const fmt = (x: number | null | undefined, d = 2) =>
  x === null || x === undefined || !Number.isFinite(x) ? "—" : x.toLocaleString("es-AR", { maximumFractionDigits: Math.abs(x) >= 1000 ? Math.min(d, 1) : d, minimumFractionDigits: 0 });
export const fmtPct = (x: number | null | undefined, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : `${x > 0 ? "+" : ""}${x.toLocaleString("es-AR", { maximumFractionDigits: d })} %`);
const fecha = (t: number) => new Date(t).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
const estrellas = (n: number) => "★".repeat(n);

const CLASE_POSTURA: Record<string, string> = { "A FAVOR": "ok", "EN CONTRA": "mal", NEUTRAL: "alerta", "SIN DATOS": "", INFORMA: "" };

// ── Análisis técnico ──

const tasa = (a: number, n: number) => (n ? `${fmt((a / n) * 100, 0)} %` : "—");

export function TecnicoPanel({ analisis }: { analisis: AnalisisAr }) {
  const { fib, estructura, ruptura, banderas, wyckoff, preRuptura, divergencias, fvg, niveles } = analisis;
  const chips: { texto: string; clase: string }[] = [];
  chips.push({ texto: `ESTRUCTURA · ${estructura.tendencia}${estructura.tendencia !== "SIN DATOS" ? ` · ${estructura.detalle}` : ""}`, clase: estructura.tendencia === "ALCISTA" ? "ok" : estructura.tendencia === "BAJISTA" ? "mal" : "alerta" });
  if (ruptura) chips.push({ texto: `RUPTURA ${ruptura.direction} (línea) · ${ruptura.confirmed ? "confirmada" : "sin confirmar"} · ${ruptura.outcome.toLowerCase()}${ruptura.volumeMultiple ? ` · ${fmt(ruptura.volumeMultiple, 1)}× vol` : ""}`, clase: ruptura.direction === "ALCISTA" ? "ok" : "mal" });
  for (const b of banderas) chips.push({ texto: `${b.kind} · ${b.status} · objetivo ${fmt(b.target)}`, clase: b.kind === "BULL FLAG" ? "ok" : "mal" });
  if (wyckoff) chips.push({ texto: `WYCKOFF · ${wyckoff.kind} posible · ${wyckoff.phase}`, clase: "alerta" });
  if (preRuptura && preRuptura.state !== "QUIETO") chips.push({ texto: `${preRuptura.state} · ${preRuptura.score}/100 · ${preRuptura.side}${preRuptura.level ? ` · ${fmt(preRuptura.level)} (${preRuptura.touches} toques)` : ""}`, clase: preRuptura.side === "ALCISTA" ? "ok" : preRuptura.side === "BAJISTA" ? "mal" : "alerta" });
  for (const d of divergencias) chips.push({ texto: `DIVERGENCIA ${d.kind} ${d.side} · RSI · hace ${d.age} ruedas`, clase: d.side === "ALCISTA" ? "ok" : "mal" });
  if (fvg.length) chips.push({ texto: `FVG · ${fvg.filter((f) => f.side === "ALCISTA").length} de compra · ${fvg.filter((f) => f.side === "BAJISTA").length} de venta`, clase: "" });
  const h = fib?.historial;
  const resueltas = h ? h.aguantaron + h.fallaron : 0;
  return (
    <>
      <div className="ar-box">
        <h3>ZONA DE COMPRA FIBONACCI</h3>
        {!fib && <p>{analisis.fibMotivo}</p>}
        {fib && (
          <>
            <div className="ar-head">
              <span>
                Pierna alcista {fmt(fib.pierna.origen)} → {fmt(fib.pierna.extremo)} (terminó el {fecha(fib.desde)})
              </span>
              <span className={`ar-chip ${fib.estado === "EN LA ZONA" ? "ok" : fib.estado === "INVALIDADA" ? "mal" : "alerta"}`}>{fib.estado}</span>
            </div>
            <div className="ar-grid">
              {fib.niveles.map((n) => (
                <div key={n.r}>
                  <span>RETROCESO {String(n.r).replace(".", ",")}</span>
                  {fmt(n.precio)}
                </div>
              ))}
              {fib.extensiones.map((n) => (
                <div key={n.r}>
                  <span>EXTENSIÓN {String(n.r).replace(".", ",")}</span>
                  {fmt(n.precio)}
                </div>
              ))}
            </div>
            <div className="ar-plan">
              ZONA {fmt(fib.zona.bajo)} – {fmt(fib.zona.alto)}
              {fib.plan
                ? ` · entrada ${fmt(fib.plan.entrada)} · SL ${fmt(fib.plan.stop)} · TP1 ${fmt(fib.plan.tp1)} · TP2 ${fmt(fib.plan.tp2)} · TP3 ${fmt(fib.plan.tp3)} · R:R ${fmt(fib.plan.rr, 1)}`
                : " · sin plan: la pierna quedó invalidada (el precio perdió su origen)"}
            </div>
            <p>
              En este papel el precio volvió a la zona {h!.probadas} {h!.probadas === 1 ? "vez" : "veces"}: aguantó (volvió al máximo antes de perder el origen) {h!.aguantaron}, falló {h!.fallaron}
              {h!.abiertas ? `, ${h!.abiertas} sin resolver` : ""}. {resueltas ? `Aguantó ${tasa(h!.aguantaron, resueltas)} de ${resueltas}` : "Sin casos resueltos"}
              {resueltas < 15 ? " · muestra mínima" : ""}. Si en una misma rueda pasan las dos cosas, cuenta como falla. No es una probabilidad.
            </p>
          </>
        )}
      </div>
      <div className="ar-box">
        <h3>ANÁLISIS TÉCNICO</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {chips.map((c) => (
            <span key={c.texto} className={`ar-chip ${c.clase}`}>{c.texto}</span>
          ))}
        </div>
        {niveles.length > 0 && (
          <div className="ar-scroll">
            <table className="ar-table">
              <tbody>
                {niveles.map((n) => (
                  <tr key={`${n.kind}${n.price}`}>
                    <td className={n.kind === "RESISTENCIA" ? "ar-down" : "ar-up"}>{n.kind === "RESISTENCIA" ? "R" : "S"} {fmt(n.price)}</td>
                    <td>{estrellas(n.stars)}</td>
                    <td className="ar-mute">{fmtPct(n.distancePct, 1)}</td>
                    <td className="ar-mute">{n.sources.map((f) => f.label).join(" + ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="ar-mute">
          Niveles: estructura diaria y semanal, máximo y mínimo de ayer y de la semana pasada, POC y área de valor (aproximados por rueda), números redondos y Fibonacci; más estrellas = más motivos coinciden en ese precio. Banderas, Wyckoff y rupturas son lecturas mecánicas del gráfico: si funcionaron se sabe después. No es asesoramiento financiero.
        </p>
      </div>
    </>
  );
}

// ── Ficha del papel ──

function Ficha({ velas }: { velas: SwingCandle[] }) {
  const v = (n: number) => (velas.length > n ? (velas.at(-1)!.close / velas[velas.length - 1 - n].close - 1) * 100 : null);
  const anio = velas.slice(-252);
  const lo = Math.min(...anio.map((c) => c.low));
  const hi = Math.max(...anio.map((c) => c.high));
  const cierre = velas.at(-1)!.close;
  const pos = hi > lo ? ((cierre - lo) / (hi - lo)) * 100 : 50;
  const celdas: [string, number | null][] = [["1 SEMANA", v(5)], ["1 MES", v(21)], ["3 MESES", v(63)], ["6 MESES", v(126)], ["1 AÑO", v(250)], ["DESDE EL MÁXIMO", (cierre / hi - 1) * 100]];
  return (
    <>
      <div className="ar-ficha">
        {celdas.map(([t, x]) => (
          <div key={t}>
            <span>{t}</span>
            <b className={x === null ? "ar-mute" : x >= 0 ? "ar-up" : "ar-down"}>{fmtPct(x, 1)}</b>
          </div>
        ))}
      </div>
      <div>
        <div className="ar-head ar-mute" style={{ fontSize: 10 }}>
          <span>Mín. {anio.length >= 250 ? "52 sem." : `${anio.length} ruedas`} {fmt(lo)}</span>
          <span>Máx. {fmt(hi)}</span>
        </div>
        <div className="ar-rango" role="img" aria-label={`El cierre está al ${Math.round(pos)} % del rango`}>
          <i style={{ left: `calc(${pos}% - 1px)` }} />
        </div>
      </div>
    </>
  );
}

// ── Mentes ──

export function MentesPanel({ mentes, consenso, razon }: { mentes: LecturaMente[]; consenso: Consenso; razon?: Razonamiento[] }) {
  const [abierta, setAbierta] = useState<string | null>(null);
  return (
    <div className="ar-box">
      <h3>MENTES · {consenso.aFavor} a favor · {consenso.enContra} en contra · {consenso.neutral} neutrales · {consenso.sinDatos} sin datos</h3>
      <div className="ar-avatares">
        {mentes.map((m) => (
          <button key={m.id} className={`ar-avatar ${CLASE_POSTURA[m.postura]}`} onClick={() => setAbierta(abierta === m.id ? null : m.id)} title={`${m.mente}: ${m.postura}`}>
            <i>{m.mente.split(" ").filter((w) => /^[A-ZÁÉÍÓÚ]/.test(w)).slice(0, 2).map((w) => w[0]).join("")}</i>
            {m.mente.split(" (")[0].split(" ").at(-1)}
          </button>
        ))}
      </div>
      {mentes.map((m) => (
        <div className="ar-mente" key={m.id}>
          <div>
            <button className="ar-chip-btn" onClick={() => setAbierta(abierta === m.id ? null : m.id)} aria-expanded={abierta === m.id}>
              {m.mente}
            </button>
            <span className={`ar-chip ${CLASE_POSTURA[m.postura]}`}>{m.postura}</span>
          </div>
          <em>{m.idea}</em>
          {abierta === m.id && (
            <>
              {razon?.find((r) => r.id === m.id) ? (
                <RazonamientoMente r={razon.find((r) => r.id === m.id)!} />
              ) : (
                m.criterios.map((c) => (
                  <div className="ar-crit" key={c.nombre} title={c.regla}>
                    <i className={c.cumple === null ? "ar-mute" : c.cumple ? "ar-up" : "ar-down"}>{c.cumple === null ? "?" : c.cumple ? "✓" : "✗"}</i>
                    <span>{c.nombre}</span>
                    <span className="ar-mute">{c.valor}</span>
                  </div>
                ))
              )}
              <p>{m.nota}</p>
            </>
          )}
        </div>
      ))}
      <p className="ar-mute">{AVISO_MENTES}</p>
    </div>
  );
}

// ── Agentes ──

export function AgentesPanel({ agentes }: { agentes: AgenteEnPapel[] }) {
  if (!agentes.length) return <div className="ar-box"><h3>AGENTES</h3><p>Hacen falta al menos 60 ruedas para que los agentes lean el papel.</p></div>;
  const conSenal = agentes.filter((a) => a.senalHoy);
  return (
    <div className="ar-box">
      <h3>AGENTES DEL LABORATORIO · {conSenal.length} con señal de compra en la última rueda</h3>
      {agentes.map((a) => {
        const m = medir(a.ops);
        const minima = m.operaciones < MUESTRA_MINIMA;
        return (
          <div className="ar-agente" key={a.id} title={a.regla}>
            <div className="ar-head">
              <b>{a.agente}</b>
              <span className="ar-mute">
                {m.operaciones ? `${m.operaciones} op. · acierto ${fmtPct((m.winRate ?? 0) * 100, 0)} · PF ${m.profitFactor === null ? "—" : fmt(m.profitFactor)} · ${fmt(m.netoR, 1)} R${minima ? " · muestra mínima" : ""}` : "sin operaciones en este papel"}
              </span>
            </div>
            <span className="ar-mute">{a.nombre}</span>
            {a.senalHoy && (
              <div className="ar-plan">
                COMPRA en la apertura siguiente a la rueda del {fecha(a.senalHoy.rueda)} · ref. {fmt(a.senalHoy.referencia)} · SL {fmt(a.senalHoy.escalera.stop)} · TP1 {fmt(a.senalHoy.escalera.tp1)} · TP2 {fmt(a.senalHoy.escalera.tp2)} · TP3 {fmt(a.senalHoy.escalera.tp3)} · R:R {fmt(a.senalHoy.rr, 1)}
              </div>
            )}
          </div>
        );
      })}
      <p className="ar-mute">
        Backtest con las ruedas que hay (unos 2 años), solo compras, horizonte de {ESTUDIO_AR.horizonte} ruedas y comisión supuesta de {fmt(ESTUDIO_AR.feePct, 1)} % por lado. Si una rueda toca stop y objetivo, cuenta el stop. {EXCLUIDOS_AR} Resultados pasados, simulados: no garantizan resultados futuros. No es asesoramiento financiero.
      </p>
    </div>
  );
}

// ── La vista de un papel en el MAPA ──

export function MapaAr({ papel, onSalir }: { papel: PapelAr; onSalir: () => void }) {
  const [lectura, setLectura] = useState<LecturaPapel | null>(null);
  const [cargando, setCargando] = useState(true);
  const [cantidad, setCantidad] = useState(120);
  const [panel, setPanel] = useState<{ hechos: number; total: number } | null>(null);
  const [vuelta, setVuelta] = useState(0);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const l = await leerPapel(papel);
      if (!vivo) return;
      setLectura(l);
      setCargando(false);
    })();
    return () => {
      vivo = false;
    };
  }, [papel, vuelta]);

  const leerPanel = async () => {
    setPanel({ hechos: 0, total: 1 });
    await cargarPanel(PAPELES_AR, (hechos, total) => setPanel({ hechos, total }));
    setPanel(null);
    setVuelta((n) => n + 1);
  };

  const s = lectura?.serie;
  const velas = useMemo(() => s?.serie?.velas ?? [], [s]);
  const analisis = useMemo(() => analisisAr(velas), [velas]);
  const ultima = velas.at(-1);
  const previa = velas.at(-2);
  const estado = s?.estado;
  return (
    <div className="ar-wrap">
      <div className="ar-head">
        <div>
          <p className="eyebrow">MERCADO AR · {papel.tipo === "CEDEAR" ? "CEDEAR" : "ACCIÓN"} · BYMA · RUEDAS DIARIAS</p>
          <h2>{papel.ticker}</h2>
          <small>{papel.nombre}{papel.subyacente ? ` · afuera: ${papel.subyacente} (USD)` : ""}</small>
        </div>
        <button className="ar-chip-btn" onClick={onSalir}>VOLVER AL MAPA CRIPTO</button>
      </div>
      <p className="ar-flag"><b>SIN LIQUIDACIONES</b> · {TEXTO_SIN_LIQUIDACIONES}</p>
      {cargando && <p className="liq-loading">LEYENDO {papel.ticker}…</p>}
      {!cargando && lectura && (
        <>
          <div className="ar-box">
            <div className="ar-head">
              <div>
                <h3>ÚLTIMO CIERRE</h3>
                <b style={{ font: "24px var(--font-mono)" }}>
                  {fmt(ultima?.close ?? null)} {s?.serie?.meta.moneda ?? ""}
                </b>{" "}
                <span className={ultima && previa && ultima.close >= previa.close ? "ar-up" : "ar-down"}>{ultima && previa ? fmtPct((ultima.close / previa.close - 1) * 100, 2) : ""}</span>
              </div>
              <span className={`ar-chip ${estado?.estado === "OK" ? "ok" : estado?.estado === "DATA_UNAVAILABLE" ? "mal" : "alerta"}`}>{estado?.estado ?? "—"}</span>
            </div>
            <p>
              {estado?.motivo ? `${estado.motivo}. ` : ""}
              {s?.fuente ? `Fuente: ${s.fuente}` : `Sin fuente: ${s?.error ?? "no respondió"}`}
              {s?.serie?.meta.demoraMin ? ` · demora declarada ${s.serie.meta.demoraMin} min` : ""}
              {ultima ? ` · última rueda cerrada ${fecha(ultima.openTime)}` : ""}. La rueda de hoy, si está abierta, no entra en ninguna cuenta.
            </p>
            {velas.length > 21 && <Ficha velas={velas} />}
          </div>
          {velas.length > 1 && (
            <>
              <div className="ar-tabs">
                {[60, 120, 250].map((n) => (
                  <button key={n} className={cantidad === n ? "on" : ""} onClick={() => setCantidad(n)}>
                    {n} RUEDAS
                  </button>
                ))}
              </div>
              <GraficoTv velas={velas} cantidad={cantidad} analisis={analisis} ticker={papel.ticker} />
              <p className="ar-mute" style={{ fontSize: 10 }}>{TEXTO_SIN_FOOTPRINT}</p>
            </>
          )}
          {velas.length > 1 && <TecnicoPanel analisis={analisis} />}
          <PizarraPanel d={lectura.pizarra} />
          <MentesPanel mentes={lectura.mentes} consenso={lectura.consenso} razon={lectura.razon} />
          {lectura.mentes.some((m) => m.criterios.some((c) => c.valor.startsWith("falta el"))) && (
            <button className="ar-chip-btn" onClick={() => void leerPanel()} disabled={panel !== null}>
              {panel ? `LEYENDO EL PANEL ${panel.hechos}/${panel.total}…` : "LEER TODO EL PANEL PARA COMPARAR (fuerza relativa y riesgo)"}
            </button>
          )}
          <AgentesPanel agentes={lectura.agentes} />
        </>
      )}
    </div>
  );
}
