/**
 * La evaluación del AI TRADING LAB sobre un backtest de la mesa (lib/jarvis-backtest.ts): parte el período en
 * DESARROLLO y EVALUACIÓN por fecha (corte fijado antes de mirar), y en cada tramo calcula resultado bruto y neto, con
 * deslizamiento, drawdown, acierto, ganancia y pérdida media, profit factor, relación ganancia/pérdida, exposición y
 * duración. Cada operación cae en el tramo en que se abrió. Lo pasado no garantiza nada: es una medición. Pura.
 */
import { FEE_PCT } from "./jarvis-ledger.ts";
import type { BacktestResult } from "./jarvis-backtest.ts";
import type { PaperTrade } from "./jarvis-paper.ts";

/** Qué parte final del período queda para EVALUACIÓN. Fijada antes de mirar resultados; no se ajusta. */
export const FRACCION_EVALUACION = 0.3;
/** Deslizamiento supuesto por lado, en % del precio, cuando la persona no da otro. Es un supuesto, no una medición. */
export const DESLIZAMIENTO_DEFECTO_PCT = 0.02;
export const MUESTRA_MINIMA = 15;

export type Tramo = "DESARROLLO" | "EVALUACIÓN";

export type MetricasTramo = {
  tramo: Tramo;
  desde: number;
  hasta: number;
  operaciones: number;
  ganadas: number;
  perdidas: number;
  winRate: number | null;
  gananciaMediaR: number | null;
  perdidaMediaR: number | null;
  /** Ganancia media / pérdida media. */
  relacionGP: number | null;
  profitFactor: number | null;
  /** Resultado sin comisiones, en R. */
  brutoR: number;
  /** Resultado con comisiones (lo que mide el motor de papel), en R. */
  netoR: number;
  comisionesR: number;
  /** Neto menos el deslizamiento supuesto, en R. */
  conDeslizamientoR: number;
  maxDrawdownR: number;
  duracionMediaH: number | null;
  /** Qué parte del tramo hubo al menos una posición abierta (0 a 1). */
  exposicion: number | null;
  muestra: "SIN DATOS" | "MUESTRA MÍNIMA" | "MUESTRA RAZONABLE";
};

export type Evaluacion = {
  /** Identifica la corrida: con las mismas velas y la misma versión de reglas da lo mismo. */
  id: string;
  symbol: string;
  desde: number;
  hasta: number;
  corte: number;
  reglas: number;
  fuente: string;
  deslizamientoPct: number;
  desarrollo: MetricasTramo;
  evaluacion: MetricasTramo;
  abiertasAlFinal: number;
  calidad: string[];
};

const H = 3_600_000;

const entradaDe = (t: PaperTrade) => (typeof t.entradaReal === "number" && t.entradaReal > 0 ? t.entradaReal : t.entrada);

/** Cuánto pesa un costo de `pct` % por lado (entrada y salida) medido en R de esta operación. */
export function costoEnR(t: PaperTrade, pctPorLado: number): number {
  const e = entradaDe(t);
  const riesgo = Math.abs(e - t.stop);
  if (!(riesgo > 0) || !(e > 0)) return 0;
  return ((2 * pctPorLado) / 100) * (e / riesgo);
}

/** El momento que define el tramo: cuando la mesa la abrió. */
const momento = (t: PaperTrade) => t.abiertaA;

function metricas(tramo: Tramo, desde: number, hasta: number, trades: PaperTrade[], deslizamientoPct: number): MetricasTramo {
  const cerradas = trades
    .filter((t) => t.estado === "CERRADA" && t.resultadoR !== null && Number.isFinite(t.resultadoR) && t.cerradaA !== null)
    .sort((a, b) => (a.cerradaA as number) - (b.cerradaA as number));
  const rs = cerradas.map((t) => t.resultadoR as number);
  const ganadoras = rs.filter((r) => r > 0);
  const perdedoras = rs.filter((r) => r < 0);
  const ganado = ganadoras.reduce((s, r) => s + r, 0);
  const perdido = -perdedoras.reduce((s, r) => s + r, 0);
  const netoR = rs.reduce((s, r) => s + r, 0);
  const comisionesR = cerradas.reduce((s, t) => s + costoEnR(t, FEE_PCT), 0);
  const deslizamientoR = cerradas.reduce((s, t) => s + costoEnR(t, deslizamientoPct), 0);
  let acum = 0;
  let pico = 0;
  let dd = 0;
  for (const r of rs) {
    acum += r;
    pico = Math.max(pico, acum);
    dd = Math.max(dd, pico - acum);
  }
  const conLlenado = cerradas.filter((t) => t.llenadaA !== null);
  const duraciones = conLlenado.map((t) => ((t.cerradaA as number) - (t.llenadaA as number)) / H);
  // Exposición: la unión de los intervalos con posición, recortada al tramo.
  const intervalos = conLlenado
    .map((t) => [Math.max(desde, t.llenadaA as number), Math.min(hasta, t.cerradaA as number)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let cubierto = 0;
  let finActual = -Infinity;
  for (const [a, b] of intervalos) {
    if (a > finActual) {
      cubierto += b - a;
      finActual = b;
    } else if (b > finActual) {
      cubierto += b - finActual;
      finActual = b;
    }
  }
  const n = cerradas.length;
  const gm = ganadoras.length ? ganado / ganadoras.length : null;
  const pm = perdedoras.length ? perdido / perdedoras.length : null;
  return {
    tramo,
    desde,
    hasta,
    operaciones: n,
    ganadas: ganadoras.length,
    perdidas: perdedoras.length,
    winRate: n ? ganadoras.length / n : null,
    gananciaMediaR: gm,
    perdidaMediaR: pm,
    relacionGP: gm !== null && pm !== null && pm > 0 ? gm / pm : null,
    profitFactor: perdido > 0 ? ganado / perdido : null,
    brutoR: netoR + comisionesR,
    netoR,
    comisionesR,
    conDeslizamientoR: netoR - deslizamientoR,
    maxDrawdownR: dd,
    duracionMediaH: duraciones.length ? duraciones.reduce((s, d) => s + d, 0) / duraciones.length : null,
    exposicion: hasta > desde ? cubierto / (hasta - desde) : null,
    muestra: n === 0 ? "SIN DATOS" : n < MUESTRA_MINIMA ? "MUESTRA MÍNIMA" : "MUESTRA RAZONABLE",
  };
}

/** El corte entre DESARROLLO y EVALUACIÓN para un período. */
export const corteDe = (desde: number, hasta: number) => Math.round(desde + (hasta - desde) * (1 - FRACCION_EVALUACION));

export function evaluarBacktest(r: BacktestResult, deslizamientoPct = DESLIZAMIENTO_DEFECTO_PCT): Evaluacion {
  const slip = Number.isFinite(deslizamientoPct) && deslizamientoPct >= 0 ? Math.min(deslizamientoPct, 1) : DESLIZAMIENTO_DEFECTO_PCT;
  const corte = corteDe(r.desde, r.hasta);
  const dev = r.trades.filter((t) => momento(t) < corte);
  const ev = r.trades.filter((t) => momento(t) >= corte);
  const desarrollo = metricas("DESARROLLO", r.desde, corte, dev, slip);
  const evaluacion = metricas("EVALUACIÓN", corte, r.hasta, ev, slip);
  const calidad = [...r.limitaciones];
  if (desarrollo.muestra !== "MUESTRA RAZONABLE" || evaluacion.muestra !== "MUESTRA RAZONABLE") {
    calidad.push(`Menos de ${MUESTRA_MINIMA} operaciones cerradas en algún tramo: el resultado no alcanza para concluir.`);
  }
  if (r.abiertasAlFinal) calidad.push(`${r.abiertasAlFinal} operación(es) quedaron abiertas al final de los datos y no cuentan.`);
  calidad.push(`El deslizamiento (${slip.toLocaleString("es-AR")} % por lado) es un supuesto, no una medición.`);
  calidad.push("Una operación abierta en DESARROLLO que cierra después del corte cuenta en DESARROLLO: el tramo lo decide la apertura.");
  return {
    id: `bt:${r.symbol}:${r.desde}:${r.hasta}:reglas${r.reglas}:${r.fuente}`,
    symbol: r.symbol,
    desde: r.desde,
    hasta: r.hasta,
    corte,
    reglas: r.reglas,
    fuente: r.fuente,
    deslizamientoPct: slip,
    desarrollo,
    evaluacion,
    abiertasAlFinal: r.abiertasAlFinal,
    calidad,
  };
}
