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
 * entre s y c). Si el stop queda a más de RIESGO_MAXIMO_ATR ATR, no se opera.
 *
 * Objetivo (PLAN_AMD_2, desde el 2026-10-21, como en el video: «AMD en la temporalidad baja, IFVG de la última pata, objetivo en
 * el FVG de la temporalidad alta»): la temporalidad alta es la de FACTOR_HTF velas de la serie (4 h → diario, 1 h → 6 h, 15 min
 * → 1 h 30), armada con las mismas velas en bloques UTC. El objetivo es el borde cercano del FVG de esa temporalidad más cercano
 * en la dirección de la operación que siga sin llenarse (el precio no lo cruzó entero desde que se formó). Si ese FVG queda a
 * menos de MIN_R_HTF del cierre, o no hay ninguno, no se opera. PLAN_AMD_1 (objetivo fijo a RR_AMD) queda para comparar.
 */
import { RIESGO_MAXIMO_ATR } from "./breaker-busqueda.ts";
import type { Lado } from "./escalera.ts";
import type { Senal } from "./estrategias.ts";
import type { SwingCandle } from "./swing-entries.ts";

export const PLAN_AMD = "PLAN_AMD_2";
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
/** Objetivo fijo del PLAN_AMD_1, que se sigue midiendo para comparar. */
export const RR_AMD = 2;
/** Velas de la serie por vela de la temporalidad alta. */
export const FACTOR_HTF = 6;
/** El FVG de la temporalidad alta tiene que quedar a 1 R o más; más cerca, la operación no paga el riesgo. */
export const MIN_R_HTF = 1;
export type ObjetivoAmd = "HTF" | "RR";

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

/** Un FVG de la temporalidad alta, con la vela de la serie en que ya se conoce (`formada`) y la primera que lo cruzó entero (`llena`). */
export type ZonaHtf = { bajo: number; alto: number; formada: number; llena: number };

/** El marco de la serie: el salto más chico entre las primeras velas (los huecos de fin de semana no lo agrandan). */
function marcoDe(v: SwingCandle[]): number {
  let m = Number.POSITIVE_INFINITY;
  for (let k = 1; k < Math.min(v.length, 21); k += 1) {
    const d = v[k].openTime - v[k - 1].openTime;
    if (d > 0) m = Math.min(m, d);
  }
  return m;
}

/**
 * Los FVG de la temporalidad alta (FACTOR_HTF velas de la serie por vela, en bloques UTC). Solo velas altas ya cerradas: una vela
 * alta se conoce en la última vela de la serie de su bloque, y el FVG cuando cierra la tercera. `llena` es Infinity si nadie lo cruzó.
 */
export function fvgsAltos(v: SwingCandle[]): ZonaHtf[] {
  const marco = marcoDe(v);
  if (!Number.isFinite(marco) || v.length < 3) return [];
  const bloque = marco * FACTOR_HTF;
  type Alta = { high: number; low: number; ultima: number; fin: number };
  const altas: Alta[] = [];
  for (let k = 0; k < v.length; k += 1) {
    const b = Math.floor(v[k].openTime / bloque);
    const fin = (b + 1) * bloque;
    const a = altas[altas.length - 1];
    if (a && a.fin === fin) {
      a.high = Math.max(a.high, v[k].high);
      a.low = Math.min(a.low, v[k].low);
      a.ultima = k;
    } else altas.push({ high: v[k].high, low: v[k].low, ultima: k, fin });
  }
  // Una vela alta está cerrada cuando la última vela de la serie de su bloque cierra en el fin del bloque o después.
  const cerradas = altas.filter((a) => v[a.ultima].openTime + marco >= a.fin);
  const out: ZonaHtf[] = [];
  for (let j = 2; j < cerradas.length; j += 1) {
    const p = cerradas[j - 2];
    const x = cerradas[j];
    const bajista = x.high < p.low;
    const alcista = x.low > p.high;
    if (!bajista && !alcista) continue;
    const bajo = bajista ? x.high : p.high;
    const alto = bajista ? p.low : x.low;
    let llena = Number.POSITIVE_INFINITY;
    for (let k = x.ultima + 1; k < v.length; k += 1) {
      if (bajista ? v[k].high >= alto : v[k].low <= bajo) {
        llena = k;
        break;
      }
    }
    out.push({ bajo, alto, formada: x.ultima, llena });
  }
  return out;
}

/**
 * El objetivo en la temporalidad alta para una entrada que se decide en la vela e: el borde cercano del FVG sin llenar más cercano
 * en la dirección de la operación. Null si no hay, o si queda a menos de MIN_R_HTF (no se salta al siguiente: el cercano llega antes).
 */
export function objetivoHtf(zonas: ZonaHtf[], lado: Lado, cierre: number, riesgo: number, e: number): number | null {
  let mejor: number | null = null;
  for (const z of zonas) {
    if (z.formada > e || z.llena <= e) continue;
    const borde = lado === "LONG" ? z.bajo : z.alto;
    if (lado === "LONG" ? borde <= cierre : borde >= cierre) continue;
    if (mejor === null || (lado === "LONG" ? borde < mejor : borde > mejor)) mejor = borde;
  }
  if (mejor === null || Math.abs(mejor - cierre) < MIN_R_HTF * riesgo) return null;
  return mejor;
}

/** Las señales de toda la serie: `senal(i)` da lado, stop y objetivo si la vela i completa el AMD, o null. */
export function senalesAmd(v: SwingCandle[], atr14: number[], objetivo: ObjetivoAmd = "HTF"): (i: number) => Senal | null {
  const señales = new Array<Senal | null>(v.length).fill(null);
  const zonas = objetivo === "HTF" ? fvgsAltos(v) : [];
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
    const destino = objetivo === "HTF" ? objetivoHtf(zonas, m.lado, cierre, riesgo, e) : largo ? cierre + RR_AMD * riesgo : cierre - RR_AMD * riesgo;
    if (destino === null) continue;
    señales[e] = { lado: m.lado, stop, objetivo: destino };
  }
  return (i) => señales[i] ?? null;
}
