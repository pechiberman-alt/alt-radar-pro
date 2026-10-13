/**
 * La escalera de toda operación: SL, TP1, TP2 y TP3, fijados al abrirla, y su
 * recorrido vela por vela. Es pura: no lee la red, no guarda nada y no arma órdenes.
 *
 * CUANDO LA OPERACIÓN NACE CON UN SOLO OBJETIVO (el ROBOT MM, JARVIS, la MENTE),
 * ese objetivo es el TP3: es el que se midió y se validó, así que lo medido
 * conserva su sentido. TP1 y TP2 quedan a un tercio y a dos tercios del camino,
 * para tomar parciales como la mesa (un tercio en cada objetivo). La mesa ya trae
 * sus tres objetivos propios (lib/jarvis-desk.ts) y no pasa por acá.
 *
 * CÓMO SE RECORRE, con las mismas reglas con que se midió el robot (runMm):
 * solo velas cerradas posteriores a la de la señal, en orden. Si una vela toca el
 * SL, termina en SL aunque también toque un objetivo, y los objetivos de esa vela
 * no cuentan: el resultado nunca se favorece. Cada objetivo alcanzado antes queda
 * con su hora. Al tocar el TP3 termina. Si pasan `horizonte` velas sin SL ni TP3,
 * termina por tiempo al cierre de la última. El resultado va en R, neto de la
 * comisión de ida y vuelta, para la operación entera (hasta TP3, SL o tiempo).
 */
import { isValidPlan } from "./signal-plan.ts";
import type { SwingCandle } from "./swing-entries.ts";

export type Lado = "LONG" | "SHORT";
export type Escalera = { stop: number; tp1: number; tp2: number; tp3: number };
export type Desenlace = "ABIERTA" | "SL" | "TP3" | "TIEMPO";

/** Hasta dónde llegó: la hora de cierre de la vela que tocó cada nivel, cómo terminó y su resultado. */
export type Recorrido = {
  slAt: number | null;
  tp1At: number | null;
  tp2At: number | null;
  tp3At: number | null;
  desenlace: Desenlace;
  cerradaA: number | null;
  /** Precio de salida: el SL, el TP3 o el cierre de la última vela si salió por tiempo. */
  salida: number | null;
  /** Neto de comisión, en R; null mientras está abierta. */
  r: number | null;
};

export const ABIERTA: Recorrido = { slAt: null, tp1At: null, tp2At: null, tp3At: null, desenlace: "ABIERTA", cerradaA: null, salida: null, r: null };

export const escaleraValida = (lado: Lado, entrada: number, e: Escalera) => isValidPlan(lado, entrada, e);

/** La escalera hacia un único objetivo: TP3 = ese objetivo; TP1 y TP2 a un tercio y a dos tercios del camino. */
export function escaleraHacia(lado: Lado, entrada: number, stop: number, objetivo: number): Escalera | null {
  if (![entrada, stop, objetivo].every(Number.isFinite)) return null;
  const paso = (objetivo - entrada) / 3;
  const e: Escalera = { stop, tp1: entrada + paso, tp2: entrada + 2 * paso, tp3: objetivo };
  return escaleraValida(lado, entrada, e) ? e : null;
}

/** Cuándo tocó cada nivel (hora de cierre de la vela), si lo tocó. */
export type Toques = { sl?: number | null; tp1?: number | null; tp2?: number | null; tp3?: number | null };

const hhmm = (ms: number) => `${new Date(ms).toISOString().slice(11, 16)} UTC`;

/** La escalera en una línea: ✓ y la hora (UTC) en cada objetivo alcanzado, ✗ y la hora si terminó en el SL. */
export function escaleraTexto(e: Escalera, px: (v: number) => string, t: Toques = {}): string {
  const ok = (ms?: number | null) => (ms ? ` ✓ ${hhmm(ms)}` : "");
  return `SL ${px(e.stop)}${t.sl ? ` ✗ ${hhmm(t.sl)}` : ""} · TP1 ${px(e.tp1)}${ok(t.tp1)} · TP2 ${px(e.tp2)}${ok(t.tp2)} · TP3 ${px(e.tp3)}${ok(t.tp3)}`;
}

/** Distancia en R: múltiplos del riesgo (de la entrada al SL). */
export const enR = (entrada: number, stop: number, precio: number) => Math.abs(precio - entrada) / Math.abs(entrada - stop);

/** La comisión de ida y vuelta expresada en R. */
export const comisionEnR = (entrada: number, stop: number, feePct: number) => ((feePct / 100) * 2 * entrada) / Math.abs(entrada - stop);

/** El resultado en R de una salida a `salida`, neto de comisión. */
export function resultadoR(lado: Lado, entrada: number, stop: number, salida: number, feePct: number): number {
  const riesgo = Math.abs(entrada - stop);
  return (lado === "LONG" ? salida - entrada : entrada - salida) / riesgo - comisionEnR(entrada, stop, feePct);
}

/**
 * Recorre la escalera con las velas posteriores a la de la señal (`vela` es su
 * hora de apertura). Solo usa velas ya cerradas en `ahora`: lo que todavía no
 * pasó no entra, así que nunca mira el futuro.
 */
export function recorrer(
  lado: Lado,
  entrada: number,
  e: Escalera,
  vela: number,
  velas: SwingCandle[],
  marcoMs: number,
  ahora: number,
  opts: { horizonte: number; feePct: number },
): Recorrido {
  if (!escaleraValida(lado, entrada, e)) return { ...ABIERTA };
  const largo = lado === "LONG";
  const despues = velas
    .filter((c) => c.openTime > vela && c.openTime + marcoMs <= ahora)
    .sort((a, b) => a.openTime - b.openTime)
    .slice(0, opts.horizonte);
  const out: Recorrido = { ...ABIERTA };
  for (let k = 0; k < despues.length; k += 1) {
    const c = despues[k];
    const cierre = c.openTime + marcoMs;
    if (largo ? c.low <= e.stop : c.high >= e.stop) {
      return { ...out, slAt: cierre, desenlace: "SL", cerradaA: cierre, salida: e.stop, r: resultadoR(lado, entrada, e.stop, e.stop, opts.feePct) };
    }
    const llega = (p: number) => (largo ? c.high >= p : c.low <= p);
    if (out.tp1At === null && llega(e.tp1)) out.tp1At = cierre;
    if (out.tp2At === null && llega(e.tp2)) out.tp2At = cierre;
    if (llega(e.tp3)) {
      return { ...out, tp3At: cierre, desenlace: "TP3", cerradaA: cierre, salida: e.tp3, r: resultadoR(lado, entrada, e.stop, e.tp3, opts.feePct) };
    }
    if (k + 1 === opts.horizonte) {
      return { ...out, desenlace: "TIEMPO", cerradaA: cierre, salida: c.close, r: resultadoR(lado, entrada, e.stop, c.close, opts.feePct) };
    }
  }
  return out;
}
