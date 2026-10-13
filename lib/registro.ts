/**
 * El registro unificado de operaciones: el único lugar donde la app calcula el acierto, el profit factor y la
 * expectancia. Cada fuente lleva su muestra y su intervalo (Wilson, 90 %). Una fuente que no se pudo leer dice
 * «sin datos», no cero. Un resultado cuenta una sola vez: R mayor que 0 gana, menor que 0 pierde, igual a 0
 * empata, y las abiertas no entran al acierto. Pura: no lee la base ni la red; lib/registro-db.ts le pasa los números.
 */
import { wilson } from "./jarvis-stats.ts";

/** Por debajo de esta cantidad de operaciones cerradas el porcentaje sigue visible, pero marcado como muestra mínima. */
export const MUESTRA_MINIMA = 15;

export type FuenteId = "NUCLEO_ROMPE" | "NUCLEO_IMAN" | "NUCLEO_IA" | "NUCLEO_SOMBRA" | "PAPEL" | "ROBOT" | "FLUJO";

export type Conteo = {
  abiertas: number;
  cerradas: number;
  ganadas: number;
  perdidas: number;
  empatadas: number;
  /** Suma de R de las ganadoras (positiva). */
  ganado: number;
  /** Suma de |R| de las perdedoras (positiva). */
  perdido: number;
  /** Suma de R de todas las cerradas. */
  neto: number;
};

export const CONTEO_CERO: Conteo = { abiertas: 0, cerradas: 0, ganadas: 0, perdidas: 0, empatadas: 0, ganado: 0, perdido: 0, neto: 0 };

/** Una operación leída: `abierta` si todavía corre; `r` es su resultado cuando está cerrada y se conoce. */
export type OperacionLeida = { r: number | null; abierta: boolean };

export function contar(ops: OperacionLeida[]): Conteo {
  const c: Conteo = { ...CONTEO_CERO };
  for (const o of ops) {
    if (o.abierta) {
      c.abiertas += 1;
      continue;
    }
    // Cerrada sin resultado conocido: no se cuenta ni como acierto ni como cero.
    if (o.r === null || !Number.isFinite(o.r)) continue;
    c.cerradas += 1;
    c.neto += o.r;
    if (o.r > 0) {
      c.ganadas += 1;
      c.ganado += o.r;
    } else if (o.r < 0) {
      c.perdidas += 1;
      c.perdido += -o.r;
    } else {
      c.empatadas += 1;
    }
  }
  return c;
}

export function sumarConteos(list: Conteo[]): Conteo {
  const c: Conteo = { ...CONTEO_CERO };
  for (const x of list) {
    c.abiertas += x.abiertas;
    c.cerradas += x.cerradas;
    c.ganadas += x.ganadas;
    c.perdidas += x.perdidas;
    c.empatadas += x.empatadas;
    c.ganado += x.ganado;
    c.perdido += x.perdido;
    c.neto += x.neto;
  }
  return c;
}

export type Muestra = "SIN DATOS" | "MINIMA" | "RAZONABLE";

export type Estadistica = Conteo & {
  winRate: number | null;
  intervalo: { low: number; high: number } | null;
  /** Ganado / perdido. Null sin pérdidas (no se divide por cero) o sin operaciones. */
  profitFactor: number | null;
  /** R promedio por operación cerrada. */
  expectancia: number | null;
  muestra: Muestra;
};

export function estadistica(c: Conteo): Estadistica {
  const w = c.cerradas > 0 ? wilson(c.ganadas, c.cerradas) : null;
  return {
    ...c,
    winRate: c.cerradas > 0 ? c.ganadas / c.cerradas : null,
    intervalo: w ? { low: w.low, high: w.high } : null,
    profitFactor: c.perdido > 0 ? c.ganado / c.perdido : null,
    expectancia: c.cerradas > 0 ? c.neto / c.cerradas : null,
    muestra: c.cerradas === 0 ? "SIN DATOS" : c.cerradas < MUESTRA_MINIMA ? "MINIMA" : "RAZONABLE",
  };
}

export type Ambito = "GLOBAL" | "CUENTA";

/** Qué es cada fuente: su nombre para la persona, si es global o de tu cuenta, y si entra en el total. */
export const FUENTES: Record<FuenteId, { nombre: string; ambito: Ambito; enTotal: boolean }> = {
  NUCLEO_ROMPE: { nombre: "JARVIS · ruptura", ambito: "GLOBAL", enTotal: true },
  NUCLEO_IMAN: { nombre: "JARVIS · barrida de imán", ambito: "GLOBAL", enTotal: true },
  NUCLEO_IA: { nombre: "JARVIS · tesis de la IA", ambito: "GLOBAL", enTotal: true },
  NUCLEO_SOMBRA: { nombre: "JARVIS · señales en sombra (no se operan)", ambito: "GLOBAL", enTotal: false },
  PAPEL: { nombre: "Bot de papel · tu cuenta", ambito: "CUENTA", enTotal: true },
  ROBOT: { nombre: "Robot MM · tu cuenta", ambito: "CUENTA", enTotal: true },
  FLUJO: { nombre: "Flujo de órdenes · tu cuenta", ambito: "CUENTA", enTotal: true },
};

export type EntradaRegistro = {
  id: FuenteId;
  /** Null si la fuente no se pudo leer: «sin datos», no cero. */
  conteo: Conteo | null;
  /** La lectura alcanzó su tope o hubo filas ilegibles: el número es de lo que se pudo leer. */
  incompleta?: boolean;
};

export type FuenteRegistro = Estadistica & {
  id: FuenteId;
  nombre: string;
  ambito: Ambito;
  enTotal: boolean;
  disponible: boolean;
  incompleta: boolean;
};

export type Registro = {
  generado: number;
  fuentes: FuenteRegistro[];
  /** Lo que suman las fuentes que entran en el total y se pudieron leer. */
  total: Estadistica;
};

export function armarRegistro(entradas: EntradaRegistro[], generado: number): Registro {
  const fuentes: FuenteRegistro[] = entradas.map((e) => ({
    ...estadistica(e.conteo ?? CONTEO_CERO),
    id: e.id,
    nombre: FUENTES[e.id].nombre,
    ambito: FUENTES[e.id].ambito,
    enTotal: FUENTES[e.id].enTotal,
    disponible: e.conteo !== null,
    incompleta: Boolean(e.incompleta),
  }));
  const sumables = entradas.filter((e) => e.conteo !== null && FUENTES[e.id].enTotal).map((e) => e.conteo as Conteo);
  return { generado, fuentes, total: estadistica(sumarConteos(sumables)) };
}

export const porcentaje = (v: number | null | undefined) => (v === null || v === undefined ? "sin dato" : `${Math.round(v * 100)} %`);
const coma = (v: number, d = 2) => v.toFixed(d).replace(".", ",");
const signo = (v: number) => `${v > 0 ? "+" : ""}${coma(v)}`;

/** Una línea por fuente, en el lenguaje de la app: cuántas, acierto con su intervalo, profit factor, expectancia y muestra. */
export function lineaFuente(f: FuenteRegistro): string {
  if (!f.disponible) return `${f.nombre}: sin datos`;
  if (f.cerradas === 0) return `${f.nombre}: ${f.abiertas} abiertas, todavía sin cerrar ninguna`;
  const iv = f.intervalo ? ` (IC 90 %: ${porcentaje(f.intervalo.low)}–${porcentaje(f.intervalo.high)})` : "";
  const pf = f.profitFactor !== null ? `PF ${coma(f.profitFactor)}` : f.perdido === 0 ? "sin pérdidas todavía" : "PF sin dato";
  const exp = f.expectancia !== null ? `expectancia ${signo(f.expectancia)} R` : "expectancia sin dato";
  const muestra = f.muestra === "MINIMA" ? " · muestra mínima" : "";
  const inc = f.incompleta ? " · lectura incompleta" : "";
  return `${f.nombre}: ${f.cerradas} cerradas · acierto ${porcentaje(f.winRate)}${iv} · ${pf} · ${exp}${muestra}${inc}`;
}
