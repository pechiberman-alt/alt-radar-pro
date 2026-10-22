/**
 * Las señales de BYMA en el servidor (PLAN_AR_1): una vez por rueda, con el mercado cerrado, cada papel del panel se lee con lo
 * mismo que en la app (agentes de lib/mercado-ar-agentes.ts, Fibonacci y la pizarra de lib/pizarra-activos.ts) y queda
 * registrado: cada señal de compra de un agente y cada decisión «hay plan» de la pizarra, con entrada al cierre de esa rueda,
 * SL, TP1, TP2 y TP3. Se resuelven con las ruedas siguientes (si una rueda toca stop y objetivo, cuenta el stop), con el
 * horizonte y la comisión del estudio de BYMA (20 ruedas, 0,6 % por lado). Así entran al registro unificado con su muestra.
 *
 * El plan gratis de Cloudflare da pocos milisegundos de CPU por corrida: un papel por minuto, de lunes a viernes entre las
 * 21:00 y las 21:47 UTC (BYMA cierra a las 20:00 UTC). Solo entra la rueda de ese día: con feriado no hay entradas nuevas.
 * En el servidor la fuerza relativa y el riesgo del universo no se calculan (harían falta todos los papeles en una corrida):
 * esas preguntas de las mentes quedan «sin dato», y por eso su pizarra puede diferir de la de la app, que sí los tiene.
 * Solo papel: no manda órdenes. No es asesoramiento financiero. Pura: sin red ni base.
 */
import { escaleraValida, recorrer, type Escalera, type Recorrido } from "./escalera.ts";
import { ESTUDIO_AR, type AgenteEnPapel } from "./mercado-ar-agentes.ts";
import type { ZonaFibAr } from "./mercado-ar-tecnico.ts";
import { PAPELES_AR, type PapelAr } from "./mercado-ar.ts";
import type { Deliberacion } from "./pizarra.ts";
import type { SwingCandle } from "./swing-entries.ts";

export const PLAN_AR = "PLAN_AR_1";
export const HORA_AR_UTC = 21;
/**
 * Cuánto dura una rueda para recorrer la escalera: la serie ya trae solo ruedas cerradas (lib/mercado-ar.ts deja aparte la de
 * la sesión abierta), y Yahoo marca cada rueda con la apertura de BYMA (11 hora argentina); 7 horas pone su cierre después de
 * las 17, así la hora de cada nivel tocado es la del cierre de esa rueda y no la del día siguiente.
 */
export const MARCO_RUEDA_AR = 7 * 3_600_000;

export type FuenteAr = "AGENTE" | "PIZARRA";

/** Qué papel le toca a esta corrida: minuto k de las 21 UTC → el papel k; fines de semana y fuera de hora, null. */
export function papelDeTurno(t: number): PapelAr | null {
  const d = new Date(t);
  const dia = d.getUTCDay();
  if (dia === 0 || dia === 6 || d.getUTCHours() !== HORA_AR_UTC) return null;
  return PAPELES_AR[d.getUTCMinutes()] ?? null;
}

/** La última rueda cerrada es de hoy (fecha UTC de la corrida). Si no, es feriado o la fuente no actualizó: no hay entradas. */
export const ruedaDeHoy = (velas: SwingCandle[], ahora: number) => {
  const u = velas.at(-1);
  return Boolean(u) && new Date(u!.openTime).toISOString().slice(0, 10) === new Date(ahora).toISOString().slice(0, 10);
};

export const claveAr = (fuente: FuenteAr, estrategia: string, ticker: string, vela: number) => `ar:${fuente}:${estrategia}:${ticker}:${vela}`;

export type EntradaAr = {
  clave: string;
  fuente: FuenteAr;
  estrategia: string;
  ticker: string;
  vela: number;
  detectada: number;
  entrada: number;
  escalera: Escalera;
  /** La huella de la decisión de la pizarra; null para los agentes. */
  huella: string | null;
  /** Por qué, en una línea (para el aviso y la oficina). */
  detalle: string;
};

/**
 * Las entradas de un papel en la rueda de hoy: cada agente que da compra (su escalera, ya validada en lib/mercado-ar-agentes.ts)
 * y la pizarra si dice «hay plan». La pizarra entra al cierre de la rueda con los niveles de su plan; si con ese cierre la
 * escalera no queda en orden (el plan era una orden límite más abajo), no se registra y se dice por qué.
 */
export function entradasAr(
  ticker: string,
  velas: SwingCandle[],
  agentes: AgenteEnPapel[],
  pizarra: Deliberacion,
  ahora: number,
): { entradas: EntradaAr[]; descartada: string | null } {
  const u = velas.at(-1);
  if (!u || !ruedaDeHoy(velas, ahora)) return { entradas: [], descartada: null };
  const out: EntradaAr[] = [];
  for (const a of agentes) {
    const s = a.senalHoy;
    if (!s || s.rueda !== u.openTime) continue;
    out.push({ clave: claveAr("AGENTE", a.id, ticker, u.openTime), fuente: "AGENTE", estrategia: a.id, ticker, vela: u.openTime, detectada: ahora, entrada: s.referencia, escalera: s.escalera, huella: null, detalle: `${a.agente}: compra (R:R 1:${s.rr.toFixed(1).replace(".", ",")}).` });
  }
  let descartada: string | null = null;
  const p = pizarra.plan;
  if (pizarra.veredicto === "HAY PLAN" && p) {
    const e: Escalera = { stop: p.stop, tp1: p.tp1, tp2: p.tp2, tp3: p.tp3 };
    if (escaleraValida("LONG", u.close, e)) {
      out.push({ clave: claveAr("PIZARRA", "PIZARRA", ticker, u.openTime), fuente: "PIZARRA", estrategia: "PIZARRA", ticker, vela: u.openTime, detectada: ahora, entrada: u.close, escalera: e, huella: pizarra.huella, detalle: `Pizarra: ${pizarra.razon}` });
    } else descartada = `La pizarra dio plan (${p.fuente}) pero con el cierre de hoy la escalera no queda en orden: no se registra.`;
  }
  return { entradas: out, descartada };
}

export type AbiertaAr = { clave: string; vela: number; entrada: number; sl: number; tp1: number; tp2: number; tp3: number; tp1_at: number | null; tp2_at: number | null };

/** Recorre las abiertas con las ruedas ya cerradas; devuelve las que cerraron o tocaron un objetivo nuevo. */
export function avancesAr(abiertas: AbiertaAr[], velas: SwingCandle[], ahora: number): { clave: string; recorrido: Recorrido }[] {
  const out: { clave: string; recorrido: Recorrido }[] = [];
  for (const a of abiertas) {
    const rec = recorrer("LONG", a.entrada, { stop: a.sl, tp1: a.tp1, tp2: a.tp2, tp3: a.tp3 }, a.vela, velas, MARCO_RUEDA_AR, ahora, { horizonte: ESTUDIO_AR.horizonte, feePct: ESTUDIO_AR.feePct });
    if (rec.desenlace !== "ABIERTA" || (rec.tp1At !== null && a.tp1_at === null) || (rec.tp2At !== null && a.tp2_at === null)) out.push({ clave: a.clave, recorrido: rec });
  }
  return out;
}

// ── Avisos (Telegram) ──

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n = (x: number) => x.toLocaleString("es-AR", { maximumFractionDigits: x >= 100 ? 2 : 3 });

export type AvisoAr = { clave: string; ticker: string; texto: string };

/**
 * Los avisos de un papel: cuando entra a la zona de compra de Fibonacci (estaba en otro estado la rueda anterior leída) y
 * cuando la pizarra registra un plan. Sin estado anterior (la primera lectura) no hay aviso de entrada: no se sabe si «entró».
 */
export function avisosAr(papel: PapelAr, vela: number, fibAntes: string | null, fib: ZonaFibAr | null, registradas: EntradaAr[], pizarra: Deliberacion): AvisoAr[] {
  const out: AvisoAr[] = [];
  if (fib && fib.estado === "EN LA ZONA" && fibAntes !== null && fibAntes !== "EN LA ZONA") {
    const h = fib.historial.aguantaron + fib.historial.fallaron;
    const hist = h ? `Antes, en este papel, aguantó ${fib.historial.aguantaron} de ${h}${h < 15 ? " (muestra mínima)" : ""}.` : "Sin casos anteriores en este papel.";
    const plan = fib.plan ? ` Plan: entrada ${n(fib.plan.entrada)}, SL ${n(fib.plan.stop)}, TP1 ${n(fib.plan.tp1)}, TP2 ${n(fib.plan.tp2)}, TP3 ${n(fib.plan.tp3)}.` : "";
    out.push({ clave: `ar-fib:${papel.ticker}:${vela}`, ticker: papel.ticker, texto: `📐 <b>BYMA · ${papel.ticker}</b> entró en la zona de compra de Fibonacci (0,618–0,786) al cierre.${plan} ${hist} La pizarra dice: ${esc(pizarra.veredicto)}. No es asesoramiento financiero.` });
  }
  const pz = registradas.find((e) => e.fuente === "PIZARRA");
  if (pz) {
    const e = pz.escalera;
    out.push({ clave: `ar-plan:${papel.ticker}:${vela}`, ticker: papel.ticker, texto: `🧭 <b>BYMA · ${papel.ticker}</b>: la pizarra da plan. ${esc(pizarra.razon)} Entrada al cierre ${n(pz.entrada)}, SL ${n(e.stop)}, TP1 ${n(e.tp1)}, TP2 ${n(e.tp2)}, TP3 ${n(e.tp3)}. Decisión ${pizarra.huella}. Papel, no es asesoramiento financiero.` });
  }
  return out;
}
