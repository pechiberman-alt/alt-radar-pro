/**
 * El registro unificado de operaciones: el único lugar donde la app calcula el acierto, el profit factor y la
 * expectancia. Cada fuente lleva su muestra y su intervalo (Wilson, 90 %). Una fuente que no se pudo leer dice
 * «sin datos», no cero. Un resultado cuenta una sola vez: R mayor que 0 gana, menor que 0 pierde, igual a 0
 * empata, y las abiertas no entran al acierto. Pura: no lee la base ni la red; lib/registro-db.ts le pasa los números.
 */
import { wilson } from "./jarvis-stats.ts";

/** Por debajo de esta cantidad de operaciones cerradas el porcentaje sigue visible, pero marcado como muestra mínima. */
export const MUESTRA_MINIMA = 15;

export type FuenteId = "NUCLEO_ROMPE" | "NUCLEO_IMAN" | "NUCLEO_IA" | "NUCLEO_SOMBRA" | "PAPEL" | "ROBOT" | "FLUJO" | "AGENTE_ST";

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
  AGENTE_ST: { nombre: "Agente Supertrend MTF + Volumen · tu cuenta", ambito: "CUENTA", enTotal: true },
};

// ── Capital simulado: cuánto dinero virtual tendría cada bot si hubiera operado todo lo que registró ──

/** Capital virtual con el que arranca cada bot. Es un supuesto fijo, igual para todos, para poder compararlos. */
export const CAPITAL_INICIAL_USD = 1000;
/** Riesgo fijo por operación, en % del capital inicial: 1 R vale siempre lo mismo (sin interés compuesto). */
export const RIESGO_POR_OPERACION_PCT = 1;
/** Puntos de la curva que viajan a la pantalla. */
const PUNTOS_CURVA = 40;

/** Una operación cerrada con su resultado y cuándo cerró (y cuándo se abrió, si se sabe). */
export type Cierre = { r: number; cerradaA: number; abiertaA: number | null };

export type Capital = {
  inicialUsd: number;
  /** Cuánto vale 1 R en dólares. */
  riesgoUsd: number;
  /** Capital inicial más el neto en R por el valor de 1 R. Sale del conteo: es exacto aunque la serie esté recortada. */
  actualUsd: number;
  netoUsd: number;
  retornoPct: number;
  /** Lo más alto que llegó la curva; null sin serie. */
  picoUsd: number | null;
  /** La peor caída desde un pico, en dólares y en % de ese pico; null sin serie. */
  maxCaidaUsd: number | null;
  maxCaidaPct: number | null;
  /** Desde cuándo opera: la primera operación registrada que se pudo leer. */
  desde: number | null;
  /** La curva del capital después de cada cierre (recortada a 40 puntos). */
  curva: number[];
  /** La serie cubre todas las cerradas del conteo. Si no, la caída y la curva son de las últimas que se leyeron. */
  serieCompleta: boolean;
  /** El capital simulado llegó a cero o menos: con este riesgo fijo, el bot se habría quedado sin dinero. */
  quebrado: boolean;
};

/**
 * El capital de un bot desde que opera: USD 1.000 y 1 % fijo por operación. El final sale
 * del neto del conteo; la caída máxima, del orden real de los cierres. No suma ni resta nada que no esté en el R
 * medido por la fuente (si su R ya trae comisiones, las trae; si no, no se inventan).
 */
export function simularCapital(conteo: Conteo, cierres: Cierre[] | null, desde: number | null): Capital {
  const inicialUsd = CAPITAL_INICIAL_USD;
  const riesgoUsd = (CAPITAL_INICIAL_USD * RIESGO_POR_OPERACION_PCT) / 100;
  const netoUsd = conteo.neto * riesgoUsd;
  const actualUsd = inicialUsd + netoUsd;
  const serie = (cierres ?? []).filter((c) => Number.isFinite(c.r) && Number.isFinite(c.cerradaA)).sort((a, b) => a.cerradaA - b.cerradaA);
  let picoUsd: number | null = null;
  let maxCaidaUsd: number | null = null;
  let maxCaidaPct: number | null = null;
  const puntos: number[] = [];
  if (serie.length) {
    // Si la serie está recortada, arranca donde tiene que arrancar para terminar en el capital exacto.
    let eq = actualUsd - serie.reduce((s, c) => s + c.r, 0) * riesgoUsd;
    picoUsd = eq;
    maxCaidaUsd = 0;
    maxCaidaPct = 0;
    puntos.push(eq);
    for (const c of serie) {
      eq += c.r * riesgoUsd;
      puntos.push(eq);
      if (eq > picoUsd) picoUsd = eq;
      const caida = picoUsd - eq;
      if (caida > maxCaidaUsd) {
        maxCaidaUsd = caida;
        maxCaidaPct = picoUsd > 0 ? (caida / picoUsd) * 100 : null;
      }
    }
  }
  const paso = puntos.length > PUNTOS_CURVA ? (puntos.length - 1) / (PUNTOS_CURVA - 1) : 1;
  const curva = puntos.length > PUNTOS_CURVA ? Array.from({ length: PUNTOS_CURVA }, (_, i) => puntos[Math.round(i * paso)]) : puntos;
  const primeras = serie.map((c) => c.abiertaA ?? c.cerradaA);
  const inicio = [desde, ...primeras].filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return {
    inicialUsd,
    riesgoUsd,
    actualUsd,
    netoUsd,
    retornoPct: (netoUsd / inicialUsd) * 100,
    picoUsd,
    maxCaidaUsd,
    maxCaidaPct,
    desde: inicio.length ? Math.min(...inicio) : null,
    curva,
    serieCompleta: serie.length >= conteo.cerradas,
    quebrado: actualUsd <= 0,
  };
}

export type EntradaRegistro = {
  id: FuenteId;
  /** Null si la fuente no se pudo leer: «sin datos», no cero. */
  conteo: Conteo | null;
  /** La lectura alcanzó su tope o hubo filas ilegibles: el número es de lo que se pudo leer. */
  incompleta?: boolean;
  /** Las cerradas con su fecha, para la curva del capital; null o ausente si no se pudieron leer. */
  cierres?: Cierre[] | null;
  /** La primera operación registrada de la fuente, si se sabe. */
  desde?: number | null;
};

export type FuenteRegistro = Estadistica & {
  id: FuenteId;
  nombre: string;
  ambito: Ambito;
  enTotal: boolean;
  disponible: boolean;
  incompleta: boolean;
  /** El capital simulado del bot; null si la fuente no se pudo leer. */
  capital: Capital | null;
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
    capital: e.conteo === null ? null : simularCapital(e.conteo, e.cierres ?? null, e.desde ?? null),
  }));
  const sumables = entradas.filter((e) => e.conteo !== null && FUENTES[e.id].enTotal).map((e) => e.conteo as Conteo);
  return { generado, fuentes, total: estadistica(sumarConteos(sumables)) };
}

export const porcentaje = (v: number | null | undefined) => (v === null || v === undefined ? "sin dato" : `${Math.round(v * 100)} %`);
const coma = (v: number, d = 2) => v.toFixed(d).replace(".", ",");
const signo = (v: number) => `${v > 0 ? "+" : ""}${coma(v)}`;
const usd = (v: number) => `USD ${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(Math.round(v))}`;
const fecha = (ms: number) => new Date(ms).toISOString().slice(0, 10).split("-").reverse().join("/");

/** El capital simulado en una frase: cuánto queda de USD 1.000, la peor caída y desde cuándo. */
export function lineaCapital(c: Capital | null): string {
  if (!c) return "capital simulado sin datos";
  const ret = `${c.retornoPct > 0 ? "+" : ""}${coma(c.retornoPct, 1)} %`;
  const caida = c.maxCaidaUsd !== null ? `, caída máxima ${usd(c.maxCaidaUsd)}${c.serieCompleta ? "" : " (de las últimas leídas)"}` : "";
  const desde = c.desde !== null ? ` desde el ${fecha(c.desde)}` : "";
  const quiebra = c.quebrado ? " · se habría quedado sin capital" : "";
  return `con ${usd(c.inicialUsd)} y ${coma(RIESGO_POR_OPERACION_PCT, 0)} % por operación: ${usd(c.actualUsd)} (${ret})${caida}${desde}${quiebra}`;
}

/** Una línea por fuente, en el lenguaje de la app: cuántas, acierto con su intervalo, profit factor, expectancia y muestra. */
export function lineaFuente(f: FuenteRegistro): string {
  if (!f.disponible) return `${f.nombre}: sin datos`;
  if (f.cerradas === 0) return `${f.nombre}: ${f.abiertas} abiertas, todavía sin cerrar ninguna`;
  const iv = f.intervalo ? ` (IC 90 %: ${porcentaje(f.intervalo.low)}–${porcentaje(f.intervalo.high)})` : "";
  const pf = f.profitFactor !== null ? `PF ${coma(f.profitFactor)}` : f.perdido === 0 ? "sin pérdidas todavía" : "PF sin dato";
  const exp = f.expectancia !== null ? `expectancia ${signo(f.expectancia)} R` : "expectancia sin dato";
  const muestra = f.muestra === "MINIMA" ? " · muestra mínima" : "";
  const inc = f.incompleta ? " · lectura incompleta" : "";
  return `${f.nombre}: ${f.cerradas} cerradas · acierto ${porcentaje(f.winRate)}${iv} · ${pf} · ${exp} · ${lineaCapital(f.capital)}${muestra}${inc}`;
}
