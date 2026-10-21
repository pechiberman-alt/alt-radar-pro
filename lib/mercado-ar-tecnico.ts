/**
 * El análisis técnico de un papel de BYMA con ruedas diarias, con los mismos motores del mapa cripto: zona de compra de
 * Fibonacci (retroceso 0,618–0,786 de la última pierna alcista, con extensiones 1,272 y 1,618 de objetivo y cuántas veces
 * aguantó en este mismo papel), niveles con estrellas (estructura diaria y semanal, máximos y mínimos de ayer y de la
 * semana pasada, POC y área de valor, números redondos y Fibonacci), estructura de máximos y mínimos, líneas de
 * tendencia y sus rupturas, banderas, Wyckoff, «a punto de romper», FVG y divergencias de RSI.
 *
 * Todo con ruedas cerradas y pivotes ya confirmados: el análisis de un día no cambia si después pasa otra cosa. Las tasas
 * van con su muestra; nada es una probabilidad. No es asesoramiento financiero. Pura.
 */
import { findFlags, readWyckoff, type FlagPattern, type WyckoffReading } from "./chart-patterns.ts";
import { findFairValueGaps, type FairValueGap } from "./fair-value-gaps.ts";
import { MARGEN_STOP_ATR, piernas, type Pierna } from "./fibonacci-niveles.ts";
import { buildLevels, profileSources, referenceSources, roundSources, structureSources, type Level, type LevelSource } from "./level-engine.ts";
import { findDivergences, rsi, type Divergence } from "./oscillators.ts";
import { readPreBreak, type PreBreak } from "./pre-breakout.ts";
import { analyzeTrend, atrSeries, findPivots, type TrendBreak, type Trendline } from "./trendlines.ts";
import type { SwingCandle } from "./swing-entries.ts";

const DIA = 86_400_000;

export const RETROCESOS = [0.382, 0.5, 0.618, 0.786] as const;
export const EXTENSIONES = [1.272, 1.618] as const;
/** La zona de compra: el retroceso 0,618–0,786 de la pierna alcista (la misma del agente Fibonacci del laboratorio). */
export const ZONA_COMPRA: [number, number] = [0.618, 0.786];

export type EstadoZona = "EN LA ZONA" | "ARRIBA DE LA ZONA" | "DEBAJO DE LA ZONA" | "INVALIDADA";

export type HistorialFib = { probadas: number; aguantaron: number; fallaron: number; abiertas: number };

export type ZonaFibAr = {
  pierna: Pierna;
  /** Hora de la rueda donde terminó la pierna. */
  desde: number;
  niveles: { r: number; precio: number }[];
  zona: { alto: number; bajo: number };
  extensiones: { r: number; precio: number }[];
  estado: EstadoZona;
  /** Plan si se compra en la zona: entrada a mitad de zona, stop bajo el origen, TP1 en el máximo y TP2/TP3 en las extensiones. */
  plan: { entrada: number; stop: number; tp1: number; tp2: number; tp3: number; rr: number } | null;
  /** En este papel: cuántas veces el precio volvió a la zona después de una pierna alcista y qué pasó después. */
  historial: HistorialFib;
};

export type Estructura = { tendencia: "ALCISTA" | "BAJISTA" | "LATERAL" | "SIN DATOS"; detalle: string };

export type AnalisisAr = {
  fib: ZonaFibAr | null;
  /** Si la última pierna es bajista, no hay zona de compra: se dice. */
  fibMotivo: string | null;
  niveles: Level[];
  estructura: Estructura;
  lineas: Trendline[];
  ruptura: TrendBreak | null;
  banderas: FlagPattern[];
  wyckoff: WyckoffReading | null;
  preRuptura: PreBreak | null;
  fvg: FairValueGap[];
  divergencias: Divergence[];
};

/** Ruedas diarias agrupadas en semanas (de lunes a viernes), para la estructura semanal. */
export function semanales(v: SwingCandle[]): SwingCandle[] {
  const out: SwingCandle[] = [];
  const lunes = (t: number) => {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DIA;
  };
  for (const c of v) {
    const k = lunes(c.openTime);
    const u = out.at(-1);
    if (u && u.openTime === k) {
      u.high = Math.max(u.high, c.high);
      u.low = Math.min(u.low, c.low);
      u.close = c.close;
      u.volume += c.volume;
      u.quoteVolume += c.quoteVolume;
    } else out.push({ ...c, openTime: k });
  }
  return out;
}

const nivelesFib = (p: Pierna) => {
  const rango = p.extremo - p.origen;
  return {
    niveles: RETROCESOS.map((r) => ({ r, precio: p.extremo - r * rango })),
    zona: { alto: p.extremo - ZONA_COMPRA[0] * rango, bajo: p.extremo - ZONA_COMPRA[1] * rango },
    extensiones: EXTENSIONES.map((r) => ({ r, precio: p.origen + r * rango })),
  };
};

/**
 * Cada pierna alcista ya conocida: si el precio volvió a la zona antes de hacer un máximo nuevo, ¿llegó otra vez al
 * máximo de la pierna (aguantó) o perdió el origen primero (falló)? Si en la misma rueda pasan las dos, cuenta como
 * falla. Lo que no se resolvió todavía queda abierto y no cuenta.
 */
export function historialFib(v: SwingCandle[], legs: Pierna[], vida = 80): HistorialFib {
  const h: HistorialFib = { probadas: 0, aguantaron: 0, fallaron: 0, abiertas: 0 };
  const vistas = new Set<string>();
  for (const p of legs) {
    if (p.lado !== "LONG") continue;
    const clave = `${p.origen}-${p.extremo}`;
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    const { zona } = nivelesFib(p);
    let toco = -1;
    for (let k = p.conocida + 1; k < Math.min(v.length, p.conocida + 1 + vida); k += 1) {
      if (v[k].low <= zona.alto) {
        toco = k;
        break;
      }
      if (v[k].high > p.extremo) break; // siguió subiendo sin volver: no se probó
    }
    if (toco < 0) continue;
    h.probadas += 1;
    let resuelta = false;
    for (let k = toco; k < v.length; k += 1) {
      if (v[k].low < p.origen) {
        h.fallaron += 1;
        resuelta = true;
        break;
      }
      if (k > toco && v[k].high >= p.extremo) {
        h.aguantaron += 1;
        resuelta = true;
        break;
      }
    }
    if (!resuelta) h.abiertas += 1;
  }
  return h;
}

export function zonaFib(v: SwingCandle[]): { fib: ZonaFibAr | null; motivo: string | null } {
  if (v.length < 60) return { fib: null, motivo: `hacen falta 60 ruedas (hay ${v.length})` };
  const atr = atrSeries(v);
  const legs = piernas(v, atr);
  const ultima = legs.at(-1);
  if (!ultima) return { fib: null, motivo: "no hay una pierna de impulso clara (al menos 2 ATR de recorrido)" };
  if (ultima.lado !== "LONG")
    return { fib: null, motivo: "la última pierna es bajista: no hay zona de compra de Fibonacci hasta que se arme una pierna alcista (el retroceso de una caída es zona de venta)" };
  const { niveles, zona, extensiones } = nivelesFib(ultima);
  const cierre = v.at(-1)!.close;
  const minimoDesde = Math.min(...v.slice(ultima.i + 1).map((c) => c.low), Number.POSITIVE_INFINITY);
  const estado: EstadoZona = minimoDesde < ultima.origen ? "INVALIDADA" : cierre > zona.alto ? "ARRIBA DE LA ZONA" : cierre >= zona.bajo ? "EN LA ZONA" : "DEBAJO DE LA ZONA";
  const a = atr.at(-1)!;
  const entrada = (zona.alto + zona.bajo) / 2;
  const stop = ultima.origen - MARGEN_STOP_ATR * a;
  const [tp2, tp3] = extensiones.map((x) => x.precio);
  const plan = estado !== "INVALIDADA" && Number.isFinite(a) && stop < entrada && entrada < ultima.extremo ? { entrada, stop, tp1: ultima.extremo, tp2, tp3, rr: (tp3 - entrada) / (entrada - stop) } : null;
  return { fib: { pierna: ultima, desde: v[ultima.i].openTime, niveles, zona, extensiones, estado, plan, historial: historialFib(v, legs) }, motivo: null };
}

/** Máximos y mínimos de los dos últimos pivotes confirmados (5 ruedas a cada lado). */
export function estructura(v: SwingCandle[]): Estructura {
  const p = findPivots(v, 5).filter((x) => x.confirmedAt <= v.length - 1);
  const altos = p.filter((x) => x.kind === "high").slice(-2);
  const bajos = p.filter((x) => x.kind === "low").slice(-2);
  if (altos.length < 2 || bajos.length < 2) return { tendencia: "SIN DATOS", detalle: "faltan pivotes confirmados" };
  const mas = (a: number, b: number) => (b > a ? "creciente" : "decreciente");
  const detalle = `máximos ${mas(altos[0].price, altos[1].price)}s · mínimos ${mas(bajos[0].price, bajos[1].price)}s`;
  if (altos[1].price > altos[0].price && bajos[1].price > bajos[0].price) return { tendencia: "ALCISTA", detalle };
  if (altos[1].price < altos[0].price && bajos[1].price < bajos[0].price) return { tendencia: "BAJISTA", detalle };
  return { tendencia: "LATERAL", detalle };
}

export function analisisAr(v: SwingCandle[]): AnalisisAr {
  const { fib, motivo } = zonaFib(v);
  const ultima = v.at(-1);
  const precio = ultima?.close ?? 0;
  const atr = v.length > 15 ? atrSeries(v).at(-1)! : 0;
  const fuentes: LevelSource[] =
    v.length >= 30
      ? [
          ...structureSources(v, "1d", 2.5),
          ...structureSources(semanales(v), "1s", 4),
          ...referenceSources(v, ultima!.openTime + DIA), // con todas las ruedas cerradas: ayer es la última
          ...profileSources(v.slice(-250)),
          ...roundSources(precio),
          ...(fib ? fib.niveles.filter((n) => n.r >= 0.5).map((n) => ({ kind: `FIB ${n.r}`, label: `Fibonacci ${String(n.r).replace(".", ",")}`, price: n.precio, weight: 2 })) : []),
        ]
      : [];
  const niveles = fuentes.length && atr > 0 ? buildLevels(fuentes, precio, atr, { perSide: 4, range: 0.25 }) : [];
  const tend = analyzeTrend(v);
  const ruptura = tend.breaks.at(-1) ?? null;
  const r = rsi(v.map((c) => c.close), 14);
  return {
    fib,
    fibMotivo: motivo,
    niveles,
    estructura: estructura(v),
    lineas: tend.lines.slice(-2),
    ruptura: ruptura && v.length - 1 - ruptura.i <= 30 ? ruptura : null,
    banderas: findFlags(v).filter((f) => f.status !== "FALLIDA"),
    wyckoff: readWyckoff(v),
    preRuptura: readPreBreak(v),
    fvg: findFairValueGaps(v, { limit: 4 }).filter((g) => g.filledPct < 100),
    divergencias: findDivergences(v, r, "RSI").filter((d) => d.age <= 15),
  };
}
