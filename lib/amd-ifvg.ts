/**
 * El agente «AMD + IFVG» (AMD_IFVG): acumulación, manipulación y distribución en la temporalidad de la serie, con la entrada en
 * el IFVG de la última pata. Es fractal: la misma función corre igual en 15 min, 1 h o 4 h, sin cambiar ningún número.
 * Pura y causal: cada señal usa solo velas hasta la suya. Parámetros fijados de antemano (PLAN_AMD_1), sin buscarlos.
 *
 * La regla, para LARGO (el CORTO es el espejo):
 * 1. Acumulación: las RANGO_N velas anteriores a la vela s forman un rango de altura menor o igual a RANGO_MAX_ATR veces el
 *    ATR14 de la vela s−1.
 * 2. Manipulación: la vela s pasa con su mínimo el mínimo del rango (barrida). Si la misma vela pasa los dos lados, no cuenta.
 *    Solo cuenta la primera barrida de una racha: si la vela anterior ya había barrido ese lado de su propio rango, esta no (si
 *    no, la vela de la barrida entraría en el rango de la siguiente y correría el mínimo).
 * 3. Última pata: un hueco de valor justo bajista (de IFVG_MINIMO_ATR o más) formado entre PATA_PREVIA velas antes de s y la
 *    vela del gatillo, que una vela c cierra por arriba (IFVG) a VENTANA_AMD velas de s como mucho.
 * 4. Distribución: el cierre de c vuelve adentro del rango (por encima de su mínimo).
 * Entra a la apertura de la vela siguiente a c. Stop a MARGEN_AMD_ATR ATR por debajo del extremo de la manipulación (el mínimo
 * entre s y c). Objetivo a RR_AMD veces el riesgo. Si el stop queda a más de RIESGO_MAXIMO_ATR ATR, no se opera.
 */
import { RIESGO_MAXIMO_ATR } from "./breaker-busqueda.ts";
import type { Lado } from "./escalera.ts";
import type { Senal } from "./estrategias.ts";
import type { SwingCandle } from "./swing-entries.ts";

export const PLAN_AMD = "PLAN_AMD_1";
/** Velas del rango de acumulación. */
export const RANGO_N = 20;
/** Altura máxima del rango, en ATR14: más alto ya no es una acumulación. */
export const RANGO_MAX_ATR = 4;
/** Velas después de la barrida en las que puede llegar el IFVG. */
export const VENTANA_AMD = 12;
/** El hueco de la última pata puede haberse formado hasta estas velas antes de la barrida. */
export const PATA_PREVIA = 5;
/** Hueco mínimo del FVG que se invierte, en ATR14 (el mismo que el agente de liquidez). */
export const IFVG_MINIMO_ATR = 0.3;
export const MARGEN_AMD_ATR = 0.5;
export const RR_AMD = 2;

export type Manipulacion = { s: number; lado: Lado; rangoBajo: number; rangoAlto: number };

/** Barridas de un rango de acumulación: la vela s pasa un solo lado de un rango compacto de las RANGO_N velas anteriores. */
export function manipulaciones(v: SwingCandle[], atr14: number[]): Manipulacion[] {
  const out: Manipulacion[] = [];
  let previa: Lado | null = null;
  for (let s = RANGO_N; s < v.length; s += 1) {
    const ladoAnterior = previa;
    previa = null;
    const t = atr14[s - 1];
    if (!Number.isFinite(t) || !(t > 0)) continue;
    let alto = Number.NEGATIVE_INFINITY;
    let bajo = Number.POSITIVE_INFINITY;
    for (let k = s - RANGO_N; k < s; k += 1) {
      alto = Math.max(alto, v[k].high);
      bajo = Math.min(bajo, v[k].low);
    }
    if (alto - bajo > RANGO_MAX_ATR * t) continue;
    const abajo = v[s].low < bajo;
    const arriba = v[s].high > alto;
    if (abajo === arriba) continue;
    const lado: Lado = abajo ? "LONG" : "SHORT";
    previa = lado;
    if (ladoAnterior === lado) continue;
    out.push({ s, lado, rangoBajo: bajo, rangoAlto: alto });
  }
  return out;
}

export type Inversion = { a: number; c: number; lado: Lado };

/**
 * IFVG con la vela que formó el hueco (`a`, la tercera de las tres) y la que lo cierra por el otro lado (`c`). Un hueco bajista
 * cerrado hacia arriba es de LARGO. Se busca la inversión solo hasta `hasta` (incluida), así que nada mira más allá.
 */
export function inversionesEntre(v: SwingCandle[], atr14: number[], desde: number, hasta: number): Inversion[] {
  const out: Inversion[] = [];
  for (let a = Math.max(2, desde); a <= hasta; a += 1) {
    const t = atr14[a];
    if (!Number.isFinite(t) || !(t > 0)) continue;
    const p = v[a - 2];
    const x = v[a];
    const bajista = x.high < p.low && p.low - x.high >= IFVG_MINIMO_ATR * t;
    const alcista = x.low > p.high && x.low - p.high >= IFVG_MINIMO_ATR * t;
    if (!bajista && !alcista) continue;
    const bajo = bajista ? x.high : p.high;
    const alto = bajista ? p.low : x.low;
    for (let m = a + 1; m <= hasta; m += 1) {
      if (bajista ? v[m].close > alto : v[m].close < bajo) {
        out.push({ a, c: m, lado: bajista ? "LONG" : "SHORT" });
        break;
      }
    }
  }
  return out.sort((x, y) => x.c - y.c);
}

/** Las señales de toda la serie: `senal(i)` da lado, stop y objetivo si la vela i completa el AMD, o null. */
export function senalesAmd(v: SwingCandle[], atr14: number[]): (i: number) => Senal | null {
  const señales = new Array<Senal | null>(v.length).fill(null);
  for (const m of manipulaciones(v, atr14)) {
    const hasta = Math.min(v.length - 1, m.s + VENTANA_AMD);
    const largo = m.lado === "LONG";
    const inv = inversionesEntre(v, atr14, m.s - PATA_PREVIA, hasta).find((f) => f.lado === m.lado && f.c >= m.s);
    if (!inv) continue;
    const e = inv.c;
    const cierre = v[e].close;
    if (largo ? cierre <= m.rangoBajo : cierre >= m.rangoAlto) continue;
    let extremo = largo ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    for (let k = m.s; k <= e; k += 1) extremo = largo ? Math.min(extremo, v[k].low) : Math.max(extremo, v[k].high);
    const t = atr14[e];
    if (señales[e] || !Number.isFinite(t) || !(t > 0)) continue;
    const stop = largo ? extremo - MARGEN_AMD_ATR * t : extremo + MARGEN_AMD_ATR * t;
    const riesgo = Math.abs(cierre - stop);
    if (!(riesgo > 0) || (largo ? stop >= cierre : stop <= cierre) || riesgo > RIESGO_MAXIMO_ATR * t) continue;
    señales[e] = { lado: m.lado, stop, objetivo: largo ? cierre + RR_AMD * riesgo : cierre - RR_AMD * riesgo };
  }
  return (i) => señales[i] ?? null;
}
