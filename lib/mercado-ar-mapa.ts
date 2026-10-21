/**
 * El mapa de un papel de BYMA (acción o CEDEAR): lo que se puede dibujar honestamente con ruedas diarias. Soportes y
 * resistencias de pivotes confirmados (agrupados a medio ATR, con sus toques), perfil de volumen aproximado por rueda y
 * las zonas que en el mapa cripto vienen de liquidaciones.
 *
 * LIQUIDACIONES: no hay. En BYMA no se publica el apalancamiento de cada posición ni hay liquidaciones forzadas públicas
 * como en los futuros cripto; un mapa de liquidaciones de una acción sería inventado. Se dice, no se dibuja. Pura.
 */
import { findPivots } from "./trendlines.ts";
import type { SwingCandle } from "./swing-entries.ts";

export const TEXTO_SIN_LIQUIDACIONES =
  "MAPA DE LIQUIDACIONES NO DISPONIBLE: BYMA no publica el apalancamiento de cada posición ni hay liquidaciones forzadas públicas como en los futuros cripto. Lo que se ve son niveles de precio y volumen.";

export type NivelAr = { precio: number; tipo: "SOPORTE" | "RESISTENCIA"; toques: number; ultimo: number };

/** ATR simple de 14 ruedas al final de la serie; null si no alcanza. */
export function atrFinal(v: SwingCandle[], n = 14): number | null {
  if (v.length <= n) return null;
  let s = 0;
  for (let k = v.length - n; k < v.length; k += 1) s += Math.max(v[k].high - v[k].low, Math.abs(v[k].high - v[k - 1].close), Math.abs(v[k].low - v[k - 1].close));
  return s / n;
}

/**
 * Soportes y resistencias del último año: pivotes de 5 ruedas a cada lado ya confirmados (no se usa un pivote que todavía
 * puede cambiar), agrupados si están a menos de medio ATR. Del lado de arriba del cierre son resistencias y de abajo,
 * soportes; los más cercanos primero.
 */
export function nivelesAr(v: SwingCandle[], maximo = 3): { soportes: NivelAr[]; resistencias: NivelAr[] } {
  const atr = atrFinal(v);
  if (!atr || v.length < 30) return { soportes: [], resistencias: [] };
  const desde = Math.max(0, v.length - 252);
  const ultima = v.length - 1;
  const pivotes = findPivots(v, 5).filter((p) => p.i >= desde && p.confirmedAt <= ultima);
  const grupos: { precio: number; toques: number; ultimo: number }[] = [];
  for (const p of [...pivotes].sort((a, b) => a.price - b.price)) {
    const g = grupos.at(-1);
    if (g && p.price - g.precio < atr * 0.5) {
      g.precio = (g.precio * g.toques + p.price) / (g.toques + 1);
      g.toques += 1;
      g.ultimo = Math.max(g.ultimo, v[p.i].openTime);
    } else grupos.push({ precio: p.price, toques: 1, ultimo: v[p.i].openTime });
  }
  const cierre = v[ultima].close;
  const resistencias = grupos
    .filter((g) => g.precio > cierre)
    .sort((a, b) => a.precio - b.precio)
    .slice(0, maximo)
    .map((g) => ({ ...g, tipo: "RESISTENCIA" as const }));
  const soportes = grupos
    .filter((g) => g.precio <= cierre)
    .sort((a, b) => b.precio - a.precio)
    .slice(0, maximo)
    .map((g) => ({ ...g, tipo: "SOPORTE" as const }));
  return { soportes, resistencias };
}

export type FranjaPerfil = { desde: number; hasta: number; volumen: number };

/**
 * Perfil de volumen APROXIMADO: el volumen de cada rueda repartido parejo entre su mínimo y su máximo. Con operaciones
 * reales se sabría a qué precio se operó cada acción; con ruedas diarias no. Devuelve las franjas y el POC (la de más volumen).
 */
export function perfilAprox(v: SwingCandle[], franjas = 24): { franjas: FranjaPerfil[]; poc: number | null } {
  if (!v.length) return { franjas: [], poc: null };
  const lo = Math.min(...v.map((c) => c.low));
  const hi = Math.max(...v.map((c) => c.high));
  if (!(hi > lo)) return { franjas: [], poc: null };
  const paso = (hi - lo) / franjas;
  const vol = new Array<number>(franjas).fill(0);
  for (const c of v) {
    const rango = c.high - c.low;
    for (let k = 0; k < franjas; k += 1) {
      const a = lo + k * paso;
      const b = a + paso;
      if (rango <= 0) {
        if (c.close >= a && (c.close < b || k === franjas - 1)) vol[k] += c.volume;
        continue;
      }
      const solape = Math.max(0, Math.min(b, c.high) - Math.max(a, c.low));
      vol[k] += (c.volume * solape) / rango;
    }
  }
  const lista = vol.map((volumen, k) => ({ desde: lo + k * paso, hasta: lo + (k + 1) * paso, volumen }));
  const mejor = lista.reduce((m, f) => (f.volumen > m.volumen ? f : m), lista[0]);
  return { franjas: lista, poc: mejor.volumen > 0 ? (mejor.desde + mejor.hasta) / 2 : null };
}
