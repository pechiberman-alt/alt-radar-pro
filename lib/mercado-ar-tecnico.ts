/**
 * El análisis técnico de un papel de BYMA con ruedas diarias, con los mismos motores del mapa cripto: zona de compra de
 * Fibonacci (retroceso 0,618–0,786 de la última pierna alcista, con extensiones 1,272 y 1,618 de objetivo y cuántas veces
 * aguantó en este mismo papel), su espejo, la zona de venta (el mismo retroceso de la última pierna bajista, con sus
 * objetivos hacia abajo), las zonas de compra y de venta por confluencia (varios motivos independientes en el mismo precio,
 * el motor de lib/reversal-zones.ts), niveles con estrellas (estructura diaria y semanal, máximos y mínimos de ayer y de la
 * semana pasada, POC y área de valor, números redondos y Fibonacci), estructura de máximos y mínimos, líneas de
 * tendencia y sus rupturas, banderas, Wyckoff, «a punto de romper», FVG y divergencias de RSI.
 *
 * Todo con ruedas cerradas y pivotes ya confirmados: el análisis de un día no cambia si después pasa otra cosa. Las tasas
 * van con su muestra; nada es una probabilidad. No es asesoramiento financiero. Pura.
 */
import { findFlags, readWyckoff, type FlagPattern, type WyckoffReading } from "./chart-patterns.ts";
import { findFairValueGaps, type FairValueGap } from "./fair-value-gaps.ts";
import { findReversalZones, type LevelAtom, type ReversalZone } from "./reversal-zones.ts";
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
  /** Si la última pierna es bajista, no hay zona de compra: se dice, y hay zona de venta. */
  fibMotivo: string | null;
  /** La zona de venta de Fibonacci (la última pierna es bajista); null si no. */
  fibVenta: ZonaVentaAr | null;
  /** Zonas de compra y de venta por confluencia de motivos distintos. */
  zonas: ReversalZone[];
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

/** Los niveles de una pierna: en la alcista los retrocesos bajan desde el máximo; en la bajista suben desde el mínimo y las extensiones siguen hacia abajo. */
const nivelesFib = (p: Pierna) => {
  const largo = p.lado === "LONG";
  const rango = Math.abs(p.extremo - p.origen);
  const sentido = largo ? -1 : 1;
  const ext = largo ? 1 : -1;
  return {
    niveles: RETROCESOS.map((r) => ({ r, precio: p.extremo + sentido * r * rango })),
    zona: largo ? { alto: p.extremo - ZONA_COMPRA[0] * rango, bajo: p.extremo - ZONA_COMPRA[1] * rango } : { alto: p.extremo + ZONA_COMPRA[1] * rango, bajo: p.extremo + ZONA_COMPRA[0] * rango },
    extensiones: EXTENSIONES.map((r) => ({ r, precio: p.origen + ext * r * rango })),
  };
};

/**
 * Cada pierna alcista ya conocida: si el precio volvió a la zona antes de hacer un máximo nuevo, ¿llegó otra vez al
 * máximo de la pierna (aguantó) o perdió el origen primero (falló)? Si en la misma rueda pasan las dos, cuenta como
 * falla. Lo que no se resolvió todavía queda abierto y no cuenta.
 */
export function historialFib(v: SwingCandle[], legs: Pierna[], vida = 80, lado: "LONG" | "SHORT" = "LONG"): HistorialFib {
  const h: HistorialFib = { probadas: 0, aguantaron: 0, fallaron: 0, abiertas: 0 };
  const vistas = new Set<string>();
  const largo = lado === "LONG";
  for (const p of legs) {
    if (p.lado !== lado) continue;
    const clave = `${p.origen}-${p.extremo}`;
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    const { zona } = nivelesFib(p);
    // Compra: el precio baja hasta la zona. Venta: el precio rebota hasta la zona. Sin volver, no se probó.
    const toca = (c: SwingCandle) => (largo ? c.low <= zona.alto : c.high >= zona.bajo);
    const sigue = (c: SwingCandle) => (largo ? c.high > p.extremo : c.low < p.extremo);
    const pierdeOrigen = (c: SwingCandle) => (largo ? c.low < p.origen : c.high > p.origen);
    const vuelveAlExtremo = (c: SwingCandle) => (largo ? c.high >= p.extremo : c.low <= p.extremo);
    let toco = -1;
    for (let k = p.conocida + 1; k < Math.min(v.length, p.conocida + 1 + vida); k += 1) {
      if (toca(v[k])) {
        toco = k;
        break;
      }
      if (sigue(v[k])) break; // siguió en la dirección de la pierna sin volver: no se probó
    }
    if (toco < 0) continue;
    h.probadas += 1;
    let resuelta = false;
    for (let k = toco; k < v.length; k += 1) {
      if (pierdeOrigen(v[k])) {
        h.fallaron += 1;
        resuelta = true;
        break;
      }
      if (k > toco && vuelveAlExtremo(v[k])) {
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

export type ZonaVentaAr = {
  pierna: Pierna;
  desde: number;
  niveles: { r: number; precio: number }[];
  zona: { alto: number; bajo: number };
  /** Objetivos hacia abajo (extensiones 1,272 y 1,618 de la pierna bajista). */
  extensiones: { r: number; precio: number }[];
  /** EN LA ZONA: el rebote llegó al retroceso 0,618–0,786. DEBAJO: todavía no rebotó hasta ahí. ARRIBA: lo pasó. INVALIDADA: superó el origen de la caída. */
  estado: EstadoZona;
  /**
   * Plan si se vende (o se reduce, o se opera corto) en la zona: entrada a mitad de zona, stop sobre el origen de la caída,
   * TP1 en el mínimo y TP2/TP3 en las extensiones. En BYMA el corto minorista es limitado: para quien tiene el papel es la zona
   * donde tomar ganancias o reducir; no es una orden.
   */
  plan: { entrada: number; stop: number; tp1: number; tp2: number; tp3: number; rr: number } | null;
  /** En este papel: cuántas veces el rebote llegó a la zona después de una pierna bajista y qué pasó (aguantó = volvió a caer al mínimo). */
  historial: HistorialFib;
};

/** La zona de venta: el espejo de la zona de compra, cuando la última pierna de impulso es bajista; null si no (el motivo lo da zonaFib). */
export function zonaVentaFib(v: SwingCandle[]): ZonaVentaAr | null {
  if (v.length < 60) return null;
  const atr = atrSeries(v);
  const legs = piernas(v, atr);
  const ultima = legs.at(-1);
  if (!ultima || ultima.lado !== "SHORT") return null;
  const { niveles, zona, extensiones } = nivelesFib(ultima);
  const cierre = v.at(-1)!.close;
  const maximoDesde = Math.max(...v.slice(ultima.i + 1).map((c) => c.high), Number.NEGATIVE_INFINITY);
  const estado: EstadoZona = maximoDesde > ultima.origen ? "INVALIDADA" : cierre < zona.bajo ? "DEBAJO DE LA ZONA" : cierre <= zona.alto ? "EN LA ZONA" : "ARRIBA DE LA ZONA";
  const a = atr.at(-1)!;
  const entrada = (zona.alto + zona.bajo) / 2;
  const stop = ultima.origen + MARGEN_STOP_ATR * a;
  const [tp2, tp3] = extensiones.map((x) => x.precio);
  const plan = estado !== "INVALIDADA" && Number.isFinite(a) && stop > entrada && entrada > ultima.extremo ? { entrada, stop, tp1: ultima.extremo, tp2, tp3, rr: (entrada - tp3) / (stop - entrada) } : null;
  return { pierna: ultima, desde: v[ultima.i].openTime, niveles, zona, extensiones, estado, plan, historial: historialFib(v, legs, 80, "SHORT") };
}

/** Las familias de motivos: los niveles de Fibonacci cuentan como un solo motivo y las estructuras de varios marcos también. */
const familiaDeMotivo = (kind: string) => (kind.startsWith("FIB") ? "FIBONACCI" : kind.startsWith("S/R") ? "ESTRUCTURA" : kind);

/**
 * Las zonas de compra (soporte) y de venta (resistencia) por confluencia en un papel: se juntan los niveles con sus motivos
 * (estructura, máximos y mínimos previos, POC y área de valor, números redondos, Fibonacci) y los huecos de valor sin llenar, y
 * se marcan las bandas donde coinciden motivos distintos (lib/reversal-zones.ts). La confluencia sube la chance de reacción;
 * no garantiza un giro ni es una probabilidad. Los márgenes se ajustan al ATR del papel.
 */
export function zonasConfluencia(precio: number, atr: number, niveles: Level[], fvg: FairValueGap[], fib: ZonaFibAr | null, venta: ZonaVentaAr | null): ReversalZone[] {
  if (!(precio > 0) || !(atr > 0)) return [];
  const mitad = 0.15 * atr;
  const atomos: LevelAtom[] = niveles.flatMap((l) => l.sources.map((s) => ({ kind: familiaDeMotivo(s.kind), low: s.price - mitad, high: s.price + mitad, weight: s.weight })));
  for (const g of fvg) atomos.push({ kind: "FVG", low: g.low, high: g.high, weight: 1.5 });
  // La banda 0,618–0,786 entera (los niveles sueltos ya están arriba): una sola vez por pierna.
  const banda = fib?.zona ?? venta?.zona;
  if (banda) atomos.push({ kind: "FIBONACCI", low: banda.bajo, high: banda.alto, weight: 2 });
  const atrPct = atr / precio;
  return findReversalZones(precio, atomos, { tolerancePct: Math.max(0.004, 0.3 * atrPct), maxWidthPct: Math.max(0.015, 1.2 * atrPct), perSide: 2, fillSides: true });
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
  const fibVenta = zonaVentaFib(v);
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
          ...(fib ?? fibVenta ? (fib ?? fibVenta)!.niveles.filter((n) => n.r >= 0.5).map((n) => ({ kind: `FIB ${n.r}`, label: `Fibonacci ${String(n.r).replace(".", ",")}${fib ? "" : " (venta)"}`, price: n.precio, weight: 2 })) : []),
        ]
      : [];
  const niveles = fuentes.length && atr > 0 ? buildLevels(fuentes, precio, atr, { perSide: 4, range: 0.25 }) : [];
  const tend = analyzeTrend(v);
  const ruptura = tend.breaks.at(-1) ?? null;
  const r = rsi(v.map((c) => c.close), 14);
  const huecos = findFairValueGaps(v, { limit: 4 }).filter((g) => g.filledPct < 100);
  return {
    fib,
    fibMotivo: motivo,
    fibVenta,
    zonas: zonasConfluencia(precio, atr, niveles, huecos, fib, fibVenta),
    niveles,
    estructura: estructura(v),
    lineas: tend.lines.slice(-2),
    ruptura: ruptura && v.length - 1 - ruptura.i <= 30 ? ruptura : null,
    banderas: findFlags(v).filter((f) => f.status !== "FALLIDA"),
    wyckoff: readWyckoff(v),
    preRuptura: readPreBreak(v),
    fvg: huecos,
    divergencias: findDivergences(v, r, "RSI").filter((d) => d.age <= 15),
  };
}
