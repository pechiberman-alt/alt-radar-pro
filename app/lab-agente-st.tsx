"use client";

import { useEffect, useState } from "react";
import MiniArana from "./lab-mini-arana.tsx";

/**
 * El agente de papel Supertrend MTF + Volumen (lib/agente-st.ts): sus últimas entradas con el plan completo (SL, TP1, TP2
 * y TP3), qué niveles tocó cada una y la foto de condiciones con la que entró. Lo lee de tu cuenta (/api/registro/agente-st):
 * sin sesión no hay cuenta donde mirar. Solo papel; no manda órdenes. Medición hacia adelante, no garantiza resultados y no
 * es asesoramiento financiero.
 */

type Fila = {
  clave: string;
  symbol: string;
  lado: string;
  detectada: number;
  entrada: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  foto: string;
  sl_at: number | null;
  tp1_at: number | null;
  tp2_at: number | null;
  tp3_at: number | null;
  desenlace: string;
  salida: number | null;
  r: number | null;
};

const px = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: v < 1 ? 5 : v < 100 ? 3 : 1 });
const hora = (ms: number) => new Date(ms).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const rTxt = (v: number | null) => (v === null ? "abierta" : `${v > 0 ? "+" : ""}${(Math.round(v * 100) / 100 || 0).toFixed(2).replace(".", ",")} R`);

function foto(texto: string): string {
  try {
    const f = JSON.parse(texto) as { volRel?: number; idm?: number; compras?: number | null };
    const partes = [`volumen ${typeof f.volRel === "number" ? f.volRel.toFixed(1).replace(".", ",") : "?"}×`, f.idm === 1 ? "IDM barrido" : "sin IDM"];
    if (typeof f.compras === "number") partes.push(`compras agresivas ${Math.round(f.compras * 100)} %`);
    return partes.join(" · ");
  } catch {
    return "sin foto";
  }
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));

/** La escalera de una entrada: del stop (0 %) al TP3 (100 %), con la entrada y cada objetivo en su lugar real; lo que tocó va lleno. */
function Escalera({ f }: { f: Fila }) {
  const span = f.tp3 - f.sl;
  const pos = (v: number) => (span ? clamp(((v - f.sl) / span) * 100) : 0);
  const niveles = [
    { k: "SL", v: f.sl, toco: f.sl_at !== null, clase: "mal" },
    { k: "ENTRADA", v: f.entrada, toco: true, clase: "ent" },
    { k: "TP1", v: f.tp1, toco: f.tp1_at !== null, clase: "ok" },
    { k: "TP2", v: f.tp2, toco: f.tp2_at !== null, clase: "ok" },
    { k: "TP3", v: f.tp3, toco: f.tp3_at !== null, clase: "ok" },
  ];
  const lleno = Math.max(pos(f.entrada), ...niveles.filter((n) => n.toco && n.clase === "ok").map((n) => pos(n.v)));
  return (
    <div className="senal-escalera" role="img" aria-label={`Escalera: ${niveles.map((n) => `${n.k} ${px(n.v)}${n.toco && n.k !== "ENTRADA" ? " tocado" : ""}`).join(", ")}`}>
      <div className="senal-pista">
        <span className="senal-relleno" style={{ left: `${pos(f.entrada)}%`, width: `${Math.max(0, lleno - pos(f.entrada))}%` }} />
        {niveles.map((n) => (
          <i key={n.k} className={`senal-marca senal-${n.clase}${n.toco ? " senal-toco" : ""}`} style={{ left: `${pos(n.v)}%` }} />
        ))}
      </div>
      <div className="senal-niveles">
        {niveles.map((n) => (
          <span key={n.k} className={`senal-nivel senal-${n.clase}${n.toco ? " senal-toco" : ""}`} style={{ left: `${pos(n.v)}%` }}>
            <b>{n.k === "ENTRADA" ? "ENT" : n.k}</b>
            {px(n.v)}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function LabAgenteSt() {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [estado, setEstado] = useState<"cargando" | "ok" | "sin-sesion" | "error">("cargando");
  useEffect(() => {
    let activo = true;
    const leer = async () => {
      try {
        const r = await fetch("/api/registro/agente-st", { credentials: "same-origin", cache: "no-store" });
        if (!activo) return;
        if (r.status === 401) return setEstado("sin-sesion");
        if (!r.ok) return setEstado("error");
        setFilas(((await r.json()) as { recientes: Fila[] }).recientes);
        if (activo) setEstado("ok");
      } catch {
        if (activo) setEstado("error");
      }
    };
    void (async () => {
      await Promise.resolve();
      await leer();
    })();
    // Cada 10 minutos y solo con la pestaña visible: la base cuida sus lecturas.
    const cada = setInterval(() => document.visibilityState === "visible" && void leer(), 10 * 60_000);
    return () => {
      activo = false;
      clearInterval(cada);
    };
  }, []);
  return (
    <section className="piso" aria-label="Agente de papel Supertrend MTF + Volumen">
      <h3 className="lab-sub senal-titulo">
        <svg viewBox="-14 -9 28 21" width="22" height="16" aria-hidden="true" className="piso-gana">
          <MiniArana activa />
        </svg>
        Agente de papel · Supertrend MTF + Volumen
      </h3>
      <p className="lab-nota">
        Corre hacia adelante, solo en papel: velas de 4 h de 10 monedas, solo largos y solo con BTC alcista, con volumen de ruptura y el Supertrend diario a favor. Cada
        entrada fija SL, TP1, TP2 y TP3 al abrir y registra la hora de cada nivel que toca. Corre mientras tenés el laboratorio abierto con sesión, en la primera media hora
        de cada vela de 4 h; lo que no se vio a tiempo no se rellena. En el pasado dio unas tres entradas por mes: con muestra chica los porcentajes no se leen todavía.
      </p>
      {estado === "cargando" && <p className="lab-nota">Cargando…</p>}
      {estado === "sin-sesion" && <p className="lab-nota">Iniciá sesión para ver y registrar las entradas de tu cuenta.</p>}
      {estado === "error" && <p className="lab-nota">No se pudieron leer las entradas ahora. Se reintenta solo.</p>}
      {estado === "ok" && filas && filas.length === 0 && <p className="lab-nota">Todavía sin entradas: la regla es estricta (BTC alcista, volumen, marco superior) y hoy no se dio.</p>}
      {estado === "ok" && filas && filas.length > 0 && (
        <>
          <ul className="piso-resumen" aria-label="Resumen de las últimas entradas">
            <li>
              <b>{filas.length}</b> últimas entradas
            </li>
            <li className="piso-duda">
              <b>{filas.filter((f) => f.desenlace === "ABIERTA").length}</b> abiertas
            </li>
            <li className="piso-gana">
              <b>{filas.filter((f) => f.r !== null && f.r > 0).length}</b> ganadas
            </li>
            <li className="piso-pierde">
              <b>{filas.filter((f) => f.r !== null && f.r <= 0).length}</b> perdidas
            </li>
            <li>
              R neto <b>{rTxt(filas.reduce((t, f) => t + (f.r ?? 0), 0))}</b>
            </li>
          </ul>
          <ol className="senal-lista">
            {filas.map((f) => (
              <li key={f.clave} className={`senal-tarjeta ${f.desenlace === "ABIERTA" ? "piso-duda" : (f.r ?? 0) > 0 ? "piso-gana" : "piso-pierde"}`}>
                <header>
                  <b>{f.symbol.replace("USDT", "")}</b>
                  <span className="senal-lado">{f.lado === "SHORT" ? "CORTO" : "LARGO"}</span>
                  <time>{hora(f.detectada)}</time>
                  <em className={f.desenlace === "ABIERTA" ? "senal-abierta" : ""}>{f.desenlace === "ABIERTA" ? "ABIERTA" : `${f.desenlace} ${rTxt(f.r)}`}</em>
                </header>
                <Escalera f={f} />
                <small>{foto(f.foto)}</small>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
