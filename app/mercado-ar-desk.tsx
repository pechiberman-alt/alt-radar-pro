"use client";

/**
 * MERCADO AR: acciones del panel líder de BYMA y CEDEARs, con ruedas diarias (Yahoo Finance, con demora). Tres pestañas:
 * las listas de acciones y de CEDEARs (tocar un papel lo abre en el MAPA con su gráfico, sus mentes y sus agentes) y el
 * ESCÁNER, donde las MENTES (Buffett, Graham, Lynch, Musk, Tudor Jones, Darvas, O'Neil, Templeton, Dalio) y los agentes
 * del laboratorio leen todos los papeles: ranking, señales de compra de la última rueda con su plan, y cada agente medido
 * en todo el panel contra el azar. Sin footprint ni liquidaciones (BYMA no los publica). No es asesoramiento financiero.
 */
import { useEffect, useState } from "react";
import { ACCIONES_AR, CEDEARS, PAPELES_AR, type PapelAr } from "@/lib/mercado-ar";
import { cargarPanel, cargarSerie, leerPapel, universoCargado, type LecturaPapel, type SerieCargada } from "@/lib/mercado-ar-cliente";
import { medirUniverso, ESTUDIO_AR, EXCLUIDOS_AR } from "@/lib/mercado-ar-agentes";
import { MUESTRA_ESTUDIO } from "@/lib/estrategias";
import { AVISO_MENTES } from "@/lib/mentes-inversoras";
import { openArEnMapa } from "@/lib/account-events";
import { fmt, fmtPct } from "./mercado-ar-vistas";

type Pestania = "ACCIONES" | "CEDEARS" | "ESCANER";

function Lista({ papeles }: { papeles: PapelAr[] }) {
  const [series, setSeries] = useState<Record<string, SerieCargada>>({});
  useEffect(() => {
    let vivo = true;
    void (async () => {
      for (const p of papeles) {
        const s = await cargarSerie(p.yahoo);
        if (!vivo) return;
        setSeries((x) => ({ ...x, [p.ticker]: s }));
      }
    })();
    return () => {
      vivo = false;
    };
  }, [papeles]);
  return (
    <div className="ar-list">
      {papeles.map((p) => {
        const s = series[p.ticker];
        const v = s?.serie?.velas ?? [];
        const u = v.at(-1);
        const a = v.at(-2);
        const cambio = u && a ? (u.close / a.close - 1) * 100 : null;
        return (
          <button key={p.ticker} className="ar-row" onClick={() => openArEnMapa(p.ticker)} title={`${p.nombre}: abrir en el MAPA`}>
            <b>{p.ticker}</b>
            <small>{p.nombre}</small>
            <span>{s ? fmt(u?.close ?? null) : "…"}</span>
            <span className={cambio === null ? "ar-mute" : cambio >= 0 ? "ar-up" : "ar-down"}>
              {s && !s.serie ? <span className="ar-chip mal">SIN DATOS</span> : s && s.estado.estado !== "OK" ? <span className="ar-chip alerta">{s.estado.estado}</span> : fmtPct(cambio, 2)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Escaner() {
  const [avance, setAvance] = useState<{ texto: string; hechos: number; total: number } | null>(null);
  const [lecturas, setLecturas] = useState<LecturaPapel[] | null>(null);

  const correr = async () => {
    setAvance({ texto: "Bajando ruedas", hechos: 0, total: 1 });
    await cargarPanel(PAPELES_AR, (hechos, total) => setAvance({ texto: "Bajando ruedas", hechos, total }));
    const u = await universoCargado();
    const out: LecturaPapel[] = [];
    for (const [k, p] of PAPELES_AR.entries()) {
      setAvance({ texto: `Mentes y agentes leyendo ${p.ticker}${p.tipo === "CEDEAR" ? " (y sus balances)" : ""}`, hechos: k, total: PAPELES_AR.length });
      out.push(await leerPapel(p, u));
      await new Promise((r) => setTimeout(r, 0)); // que la pantalla respire entre papel y papel
    }
    setLecturas(out);
    setAvance(null);
  };

  if (!lecturas) {
    return (
      <div className="ar-box">
        <h3>ESCÁNER · {PAPELES_AR.length} PAPELES</h3>
        <p>
          Las mentes y los agentes leen todas las acciones y los CEDEARs: ranking por mentes a favor, señales de compra de la última rueda con
          SL, TP1, TP2 y TP3, y cada agente medido en todo el panel contra el agente de azar. La primera vez tarda (los balances de SEC se bajan de a
          una empresa); después queda guardado.
        </p>
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
          <button className="ar-chip-btn on" onClick={() => void correr()}>
            LEER TODO EL PANEL
          </button>
        )}
      </div>
    );
  }

  const ranking = [...lecturas].sort((a, b) => b.consenso.aFavor - b.consenso.enContra - (a.consenso.aFavor - a.consenso.enContra) || b.consenso.aFavor - a.consenso.aFavor);
  const senales = lecturas.flatMap((l) => l.agentes.filter((a) => a.senalHoy).map((a) => ({ l, a })));
  const universo = medirUniverso(lecturas.map((l) => l.agentes)).sort((a, b) => (b.medicion.expectancia ?? -9) - (a.medicion.expectancia ?? -9));
  const sinDatos = lecturas.filter((l) => !l.serie.serie);

  return (
    <div className="ar-wrap" style={{ padding: 0 }}>
      <div className="ar-head">
        <span className="ar-mute">
          {lecturas.length - sinDatos.length} papeles con datos{sinDatos.length ? ` · sin datos: ${sinDatos.map((l) => l.papel.ticker).join(", ")}` : ""}
        </span>
        <button className="ar-chip-btn" onClick={() => void correr()} disabled={avance !== null}>
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
                <th>SIN DATOS</th>
                <th>SEÑALES HOY</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((l) => {
                const v = l.serie.serie?.velas ?? [];
                return (
                  <tr key={l.papel.ticker} onClick={() => openArEnMapa(l.papel.ticker)} style={{ cursor: "pointer" }}>
                    <td>
                      <b>{l.papel.ticker}</b> <span className="ar-mute">{l.papel.tipo === "CEDEAR" ? "CEDEAR" : "ACCIÓN"}</span>
                    </td>
                    <td>{fmt(v.at(-1)?.close ?? null)}</td>
                    <td className="ar-up">
                      {l.consenso.aFavor} de {l.consenso.opinan}
                      {l.consenso.aFavor ? ` · ${l.mentes.filter((m) => m.postura === "A FAVOR").map((m) => m.mente.split(" ")[1] ?? m.mente).join(", ")}` : ""}
                    </td>
                    <td className="ar-down">{l.consenso.enContra}</td>
                    <td className="ar-mute">{l.consenso.sinDatos}</td>
                    <td>{l.agentes.filter((a) => a.senalHoy).length || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="ar-mute">Cuenta mentes, no es una probabilidad. Tocá un papel para verlo en el MAPA con cada criterio. {AVISO_MENTES}</p>
      </div>

      <div className="ar-box">
        <h3>SEÑALES DE COMPRA EN LA ÚLTIMA RUEDA · {senales.length}</h3>
        {senales.length === 0 && <p>Ningún agente disparó en la última rueda cerrada.</p>}
        {senales.map(({ l, a }) => (
          <button className="ar-agente" key={`${l.papel.ticker}-${a.id}`} onClick={() => openArEnMapa(l.papel.ticker)}>
            <b>
              {l.papel.ticker} · {a.agente}
            </b>
            <div className="ar-plan">
              ref. {fmt(a.senalHoy!.referencia)} · SL {fmt(a.senalHoy!.escalera.stop)} · TP1 {fmt(a.senalHoy!.escalera.tp1)} · TP2 {fmt(a.senalHoy!.escalera.tp2)} · TP3 {fmt(a.senalHoy!.escalera.tp3)} · R:R {fmt(a.senalHoy!.rr, 1)}
            </div>
          </button>
        ))}
        <p className="ar-mute">Entrada en la apertura de la rueda siguiente. Mirá cómo le fue a cada agente abajo antes de darle peso. No es asesoramiento financiero.</p>
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
  return (
    <div className="ar-wrap">
      <p className="ar-flag">
        <b>RUEDAS DIARIAS CON DEMORA</b> · Yahoo Finance (BYMA). Sin footprint ni liquidaciones: BYMA no publica cada operación con su lado agresor ni el apalancamiento de las posiciones. No es asesoramiento financiero.
      </p>
      <div className="ar-tabs">
        <button className={pestania === "ACCIONES" ? "on" : ""} onClick={() => setPestania("ACCIONES")}>
          ACCIONES ({ACCIONES_AR.length})
        </button>
        <button className={pestania === "CEDEARS" ? "on" : ""} onClick={() => setPestania("CEDEARS")}>
          CEDEARS ({CEDEARS.length})
        </button>
        <button className={pestania === "ESCANER" ? "on" : ""} onClick={() => setPestania("ESCANER")}>
          MENTES Y AGENTES
        </button>
      </div>
      {pestania === "ACCIONES" && <Lista papeles={ACCIONES_AR} />}
      {pestania === "CEDEARS" && <Lista papeles={CEDEARS} />}
      {/* El escáner queda montado: cambiar de pestaña no borra lo que ya leyó. */}
      <div hidden={pestania !== "ESCANER"}>
        <Escaner />
      </div>
    </div>
  );
}
