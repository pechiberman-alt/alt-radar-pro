/**
 * La búsqueda de la mejor confirmación y configuración de la ruptura de línea de tendencia (TENDENCIA_LINEA, en
 * lib/estrategias.ts). Una confirmación decide qué rupturas se operan y cuándo (sin filtro, o con volumen, cierre fuerte,
 * EMA 200, marco superior, cierre siguiente o retesteo); una configuración fija los pivotes (velas a cada lado), el stop
 * (en ATR) y el objetivo (en R). También tiene las reglas para elegir, que solo miran el desarrollo. Pura: sin red ni base.
 * Todo es causal: la decisión de la vela i usa velas hasta la i (y un retesteo, solo velas hasta el suyo).
 */
import { eventosLinea, MUESTRA_ESTUDIO, precioLinea, type EventoLinea, type Indicadores, type Medicion, type Operacion, type Senal } from "./estrategias.ts";
import type { Lado } from "./escalera.ts";
import { BREAK_ATR } from "./trendlines.ts";
import type { SwingCandle } from "./swing-entries.ts";

export const CONFIRMACIONES = ["NINGUNA", "VOLUMEN", "CIERRE_FUERTE", "EMA200", "HTF", "CIERRE_SIGUIENTE", "REENTRADA"] as const;
export type Confirmacion = (typeof CONFIRMACIONES)[number];

/** Qué exige cada confirmación, para leer la tabla. */
export const DESCRIPCION_CONFIRMACION: Record<Confirmacion, string> = {
  NINGUNA: "Opera la ruptura en el cierre que la confirma, sin filtro (la regla de TENDENCIA_LINEA).",
  VOLUMEN: "Solo si el volumen de la vela de ruptura es 1,5 veces o más el promedio de las 20 velas anteriores.",
  CIERRE_FUERTE: "Solo si la vela de ruptura cierra en el 30 % superior de su rango (alcista) o inferior (bajista).",
  EMA200: "Solo si el cierre queda del lado de la ruptura respecto de la EMA 200 de su propia temporalidad.",
  HTF: "Solo si el Supertrend del marco superior va en el sentido de la ruptura (4 h para 1 h y 15 min; diario para 4 h).",
  CIERRE_SIGUIENTE: "Entra si la vela siguiente a la ruptura también cierra del lado de la ruptura; la entrada es la apertura de la vela después.",
  REENTRADA: "Espera el retesteo: hasta 30 velas después, una mecha vuelve a la línea (a 0,3 ATR) y cierra del lado de la ruptura. Si antes cierra 0,1 ATR del otro lado, la línea falló.",
};

/** Umbrales de las confirmaciones, fijados antes de medir: no se afinan. */
export const VOLUMEN_MINIMO = 1.5;
/** La vela de ruptura tiene que cerrar en el 30 % superior (alcista) o inferior (bajista) de su rango. */
export const CIERRE_FUERTE_FRACCION = 0.3;
/** Velas después de una ruptura en las que puede llegar el retesteo. */
export const RETESTE_VENTANA = 30;
/** El retesteo toca la línea si su mecha llega a menos de esto (en ATR) de ella. */
export const RETESTE_TOQUE_ATR = 0.3;

/** Pivotes (velas a cada lado), stop (en ATR) y objetivo (en R) de una variante. */
export type Configuracion = { pivotes: number; stopAtr: number; rr: number };

/** La de TENDENCIA_LINEA en el estudio: pivotes de 5 velas, stop a 1,5 ATR y objetivo a 2 R. */
export const CONFIGURACION_BASE: Configuracion = { pivotes: 5, stopAtr: 1.5, rr: 2 };

/** La grilla de la fase 2: 3 pivotes × 3 stops × 3 objetivos = 27 configuraciones (la base está entre ellas). */
export function grilla(): Configuracion[] {
  const out: Configuracion[] = [];
  for (const pivotes of [3, 5, 8]) for (const stopAtr of [1, 1.5, 2]) for (const rr of [1.5, 2, 3]) out.push({ pivotes, stopAtr, rr });
  return out;
}

export const mismaConfiguracion = (a: Configuracion, b: Configuracion): boolean => a.pivotes === b.pivotes && a.stopAtr === b.stopAtr && a.rr === b.rr;

/** Etiqueta con coma decimal, como se lee en español. */
export const etiquetaConfiguracion = (c: Configuracion): string => `pivotes ${c.pivotes} · stop ${c.stopAtr} ATR · objetivo ${c.rr} R`.replace(/\./g, ",");

/** Los indicadores que usan las confirmaciones (los calcula indicadores(v) sobre la misma serie). */
export type IndicadoresLinea = Pick<Indicadores, "atr14" | "volRel" | "ema200" | "htfDir">;

const ladoDe = (signo: 1 | -1): Lado => (signo === 1 ? "LONG" : "SHORT");

/**
 * Retesteos: para cada ruptura, la primera vela (hasta RETESTE_VENTANA después) cuya mecha vuelve a la línea a menos de
 * 0,3 ATR y cierra del lado de la ruptura. Si antes cierra del otro lado por más de 0,1 ATR, la línea falló y ya no hay
 * retesteo. Devuelve, por vela, la ruptura que se retesteó en ella; si en una misma vela se retestean dos, gana la más antigua.
 */
export function retesteLinea(v: SwingCandle[], atr14: number[], eventos: (EventoLinea | null)[]): (EventoLinea | null)[] {
  const out = new Array<EventoLinea | null>(v.length).fill(null);
  for (let i0 = 0; i0 < v.length; i0 += 1) {
    const e = eventos[i0];
    if (!e) continue;
    const ultima = Math.min(v.length - 1, i0 + RETESTE_VENTANA);
    for (let j = i0 + 1; j <= ultima; j += 1) {
      const t = atr14[j];
      if (!Number.isFinite(t) || !(t > 0)) continue;
      const linea = precioLinea(e, j);
      const x = v[j];
      if (e.signo * (x.close - linea) < -BREAK_ATR * t) break;
      const toca = e.signo === 1 ? x.low <= linea + RETESTE_TOQUE_ATR * t : x.high >= linea - RETESTE_TOQUE_ATR * t;
      if (toca && e.signo * (x.close - linea) > 0) {
        if (!out[j]) out[j] = e;
        break;
      }
    }
  }
  return out;
}

/**
 * Las señales de una confirmación con una configuración sobre una moneda: `senal(i)` da lado, stop y objetivo si la vela i
 * confirma una operación, o null. El stop va a `stopAtr` ATR del cierre y el objetivo a `rr` veces ese riesgo (la misma
 * cuenta que conRR de lib/estrategias.ts). Cada valor usa velas hasta i.
 */
export function senalesLinea(v: SwingCandle[], ind: IndicadoresLinea, confirmacion: Confirmacion, cfg: Configuracion): (i: number) => Senal | null {
  const eventos = eventosLinea(v, cfg.pivotes);
  const retestes = confirmacion === "REENTRADA" ? retesteLinea(v, ind.atr14, eventos) : [];
  const senal = (lado: Lado, i: number): Senal | null => {
    const t = ind.atr14[i];
    if (!Number.isFinite(t) || !(t > 0)) return null;
    const c = v[i].close;
    const stop = lado === "LONG" ? c - cfg.stopAtr * t : c + cfg.stopAtr * t;
    const objetivo = lado === "LONG" ? c + cfg.rr * (c - stop) : c - cfg.rr * (stop - c);
    return { lado, stop, objetivo };
  };
  return (i) => {
    const e = eventos[i];
    switch (confirmacion) {
      case "NINGUNA":
        return e ? senal(ladoDe(e.signo), i) : null;
      case "VOLUMEN":
        return e && ind.volRel[i] >= VOLUMEN_MINIMO ? senal(ladoDe(e.signo), i) : null;
      case "CIERRE_FUERTE": {
        if (!e) return null;
        const x = v[i];
        const rango = x.high - x.low;
        if (!(rango > 0)) return null;
        const posicion = (x.close - x.low) / rango;
        const fuerte = e.signo === 1 ? posicion >= 1 - CIERRE_FUERTE_FRACCION : posicion <= CIERRE_FUERTE_FRACCION;
        return fuerte ? senal(ladoDe(e.signo), i) : null;
      }
      case "EMA200": {
        if (!e || !Number.isFinite(ind.ema200[i])) return null;
        const delLado = e.signo === 1 ? v[i].close > ind.ema200[i] : v[i].close < ind.ema200[i];
        return delLado ? senal(ladoDe(e.signo), i) : null;
      }
      case "HTF":
        return e && ind.htfDir[i] === e.signo ? senal(ladoDe(e.signo), i) : null;
      case "CIERRE_SIGUIENTE": {
        const previo = i > 0 ? eventos[i - 1] : null;
        if (!previo) return null;
        const siguio = previo.signo * (v[i].close - precioLinea(previo, i)) > 0;
        return siguio ? senal(ladoDe(previo.signo), i) : null;
      }
      case "REENTRADA": {
        const r = retestes[i];
        return r ? senal(ladoDe(r.signo), i) : null;
      }
    }
  };
}

// ── Reglas para elegir: solo con el DESARROLLO (lo que pasó antes del corte) ──

/** Operaciones mínimas en cada mitad del desarrollo para contarla como estable. */
export const MUESTRA_MITAD = 30;

/** Una variante vista solo con el desarrollo: su medición total y en cada mitad. */
export type Candidata = { dev: Medicion; mitades: [Medicion, Medicion] };

/** El piso del intervalo del 90 % de la expectancia: lo que se ordena al elegir. Sin intervalo, -infinito. */
export const pisoIc = (m: Medicion): number => (m.expectanciaIc ? m.expectanciaIc.low : Number.NEGATIVE_INFINITY);

/**
 * Candidata: al menos MUESTRA_ESTUDIO operaciones en el desarrollo, y expectancia positiva en cada mitad, con al menos
 * MUESTRA_MITAD operaciones en cada una. Una variante que gana en una mitad y pierde en la otra no es estable.
 */
export function esCandidata(c: Candidata): boolean {
  return c.dev.operaciones >= MUESTRA_ESTUDIO && c.mitades.every((m) => m.operaciones >= MUESTRA_MITAD && m.expectancia !== null && m.expectancia > 0);
}

/** La candidata de piso más alto en el desarrollo; null si ninguna es candidata. */
export function mejorEnDesarrollo<T extends Candidata>(cs: T[]): T | null {
  let mejor: T | null = null;
  for (const c of cs) {
    if (esCandidata(c) && (!mejor || pisoIc(c.dev) > pisoIc(mejor.dev))) mejor = c;
  }
  return mejor;
}

/** Sin candidata estable: la de piso más alto, para que la fase siga, pero marcada como no estable. */
export function masAltoPiso<T extends Candidata>(cs: T[]): T | null {
  let mejor: T | null = null;
  for (const c of cs) if (!mejor || pisoIc(c.dev) > pisoIc(mejor.dev)) mejor = c;
  return mejor;
}

/** Las operaciones del desarrollo partidas en dos mitades por fecha de apertura (la operación cae en la mitad en que se abrió). */
export function mitadesDesarrollo(ops: Operacion[], desde: number, corte: number): [Operacion[], Operacion[]] {
  const medio = desde + (corte - desde) / 2;
  return [ops.filter((o) => o.abiertaA < medio), ops.filter((o) => o.abiertaA >= medio && o.abiertaA < corte)];
}
