"use client";

import { useEffect, useState } from "react";

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
      <h3 className="lab-sub">Agente de papel · Supertrend MTF + Volumen</h3>
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
        <ol className="piso-ranking">
          {filas.map((f) => (
            <li key={f.clave} className={f.desenlace === "ABIERTA" ? "piso-duda" : (f.r ?? 0) > 0 ? "piso-gana" : "piso-pierde"}>
              <b>{f.symbol.replace("USDT", "")}</b> largo · {hora(f.detectada)} · entrada {px(f.entrada)} · SL {px(f.sl)}
              {f.sl_at ? " ✗" : ""} · TP1 {px(f.tp1)}
              {f.tp1_at ? " ✓" : ""} · TP2 {px(f.tp2)}
              {f.tp2_at ? " ✓" : ""} · TP3 {px(f.tp3)}
              {f.tp3_at ? " ✓" : ""} · <span>{f.desenlace === "ABIERTA" ? "ABIERTA" : `${f.desenlace} ${rTxt(f.r)}`}</span>
              <br />
              <small>{foto(f.foto)}</small>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
