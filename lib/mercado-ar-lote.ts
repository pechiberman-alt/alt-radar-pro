/**
 * El formato compacto con el que viajan las series de MERCADO AR en lote (/api/mercado-ar/lote): cada rueda como
 * [hora, apertura, máximo, mínimo, cierre, volumen], con los precios a 6 cifras significativas. Un pedido trae hasta
 * 12 papeles en lugar de uno por papel, y pesa menos de la mitad. El monto operado no viaja: se vuelve a aproximar con
 * volumen × cierre, igual que antes (la fuente no lo da). Puro: lo usan la ruta y el navegador.
 */
import type { SerieAr } from "./mercado-ar.ts";
import type { SwingCandle } from "./swing-entries.ts";

export const MAX_LOTE = 12;

export type VelaCompacta = [number, number, number, number, number, number];
export type SerieCompacta = { meta: SerieAr["meta"]; v: VelaCompacta[]; enCurso: VelaCompacta | null };
export type ItemLote = { serie: SerieCompacta | null; fuente: string | null; edadSeg: number; error: string | null };

const r6 = (x: number) => Number(x.toPrecision(6));

export const compactarVela = (c: SwingCandle): VelaCompacta => [c.openTime, r6(c.open), r6(c.high), r6(c.low), r6(c.close), Math.round(c.volume)];
export const expandirVela = ([t, o, h, l, c, v]: VelaCompacta): SwingCandle => ({ openTime: t, open: o, high: h, low: l, close: c, volume: v, quoteVolume: v * c });

export function compactar(s: SerieAr | null): SerieCompacta | null {
  return s ? { meta: s.meta, v: s.velas.map(compactarVela), enCurso: s.enCurso ? compactarVela(s.enCurso) : null } : null;
}

export function expandir(s: SerieCompacta | null): SerieAr | null {
  return s ? { meta: s.meta, velas: s.v.map(expandirVela), enCurso: s.enCurso ? expandirVela(s.enCurso) : null } : null;
}

/** Los símbolos pedidos: sin repetir, solo los permitidos, a lo sumo MAX_LOTE. */
export function simbolosDelLote(texto: string, permitidos: ReadonlySet<string>): string[] {
  return [...new Set(texto.split(",").map((s) => s.trim()).filter((s) => permitidos.has(s)))].slice(0, MAX_LOTE);
}
