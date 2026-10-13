/**
 * La araña en vivo: junta lo que la app ya tiene en el navegador (el último
 * escaneo, las operaciones de papel, el último backtest y la vigilancia) en
 * una foto con su muestra, su intervalo y su veredicto frente a lo medido.
 * Es pura: no lee la red, no guarda nada y no arma órdenes. Si falta un dato,
 * lo dice («sin datos»): desconocido no es cero. Describe; no recomienda.
 */
import type { BacktestResult } from "./jarvis-backtest.ts";
import { MIN_SAMPLE, paperStats, type PaperTrade } from "./jarvis-paper.ts";
import { rankApproved, type ScanResult } from "./jarvis-scan.ts";
import type { WatchStatus } from "./jarvis-watch-run.ts";
import { wilson, type Muestra } from "./jarvis-stats.ts";
import type { MedicionMesa } from "./mesa-medicion.ts";

const MINUTO = 60_000;
/** Igual que SCAN_STALE_MS de lib/jarvis-scan.ts: pasado eso, el escaneo ya no es de ahora. */
export const ESCANEO_VIEJO_MIN = 30;

export const ADVERTENCIA_VIVO =
  "Describe lo que pasó y lo medido en el pasado. No es asesoramiento financiero, no garantiza resultados futuros y no ejecuta ni propone órdenes.";

export type Intervalo = { p: number; low: number; high: number };
export type Veredicto = "sin datos" | "sin muestra" | "compatible" | "distinto";

export type VivoInput = {
  now: number;
  escaneo: ScanResult | null;
  /** Progreso del escaneo que está corriendo ahora, o null si no hay ninguno. */
  escaneando: { hechas: number; total: number } | null;
  papel: PaperTrade[];
  backtest: BacktestResult | null;
  vigilancia: WatchStatus | null;
  medido: MedicionMesa;
};

export type VivoSnapshot = {
  generadoEn: number;
  escaneo: {
    estado: "sin datos" | "escaneando" | "listo" | "parcial";
    haceMin: number | null;
    progreso: number | null;
    total: number | null;
    leidas: number | null;
    aprobadas: number | null;
    largos: number | null;
    cortos: number | null;
    mejores: { symbol: string; direccion: "LONG" | "SHORT"; puntaje: number | null; consenso: number | null }[];
  };
  papel: {
    abiertas: number;
    cerradas: number;
    winRate: Intervalo | null;
    profitFactor: number | null;
    expectativaR: number | null;
    muestra: Muestra;
  };
  backtest: {
    moneda: string;
    dias: number;
    operaciones: number;
    winRate: Intervalo | null;
    profitFactor: number | null;
    muestra: Muestra;
  } | null;
  medido: MedicionMesa;
  veredicto: { estado: Veredicto; texto: string };
  vigilancia: { cinta: WatchStatus["tape"]; haceMin: number | null; errores: number } | null;
  avisos: string[];
  advertencia: string;
};

const finito = (x: number | null | undefined) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const rango = (i: Intervalo) => `IC90 ${pct(i.low)} a ${pct(i.high)}`;
const minutosDesde = (now: number, t: number | null) => (t === null ? null : Math.max(0, Math.round((now - t) / MINUTO)));
const seSuperponen = (a: { low: number; high: number }, b: { low: number; high: number }) => a.low <= b.high && b.low <= a.high;

/** Arma la foto de la araña en vivo. Función pura: mismas entradas, mismo resultado. */
export function buildVivo(i: VivoInput): VivoSnapshot {
  const avisos: string[] = [];
  const e = i.escaneo;
  const haceMinEscaneo = e ? minutosDesde(i.now, e.at) : null;
  const estadoEscaneo = i.escaneando ? "escaneando" : !e ? "sin datos" : e.parcial ? "parcial" : "listo";
  if (e && e.parcial && e.motivoParcial) avisos.push(`El escaneo se cortó: ${e.motivoParcial}.`);
  if (e && !i.escaneando && haceMinEscaneo !== null && haceMinEscaneo > ESCANEO_VIEJO_MIN) {
    avisos.push(`El último escaneo es de hace ${haceMinEscaneo} minutos: ya no es de ahora. Escaneá otra vez para verlo al día.`);
  }

  const ps = paperStats(i.papel);
  const winRatePapel = ps.cerradas ? wilson(ps.ganadas, ps.cerradas) : null;
  const papelWr = winRatePapel ? { p: winRatePapel.p, low: winRatePapel.low, high: winRatePapel.high } : null;

  const b = i.backtest;
  const bWr = b && b.metricas.operaciones ? wilson(b.metricas.ganadas, b.metricas.operaciones) : null;

  const medidoWr = i.medido.winRate;
  let veredicto: VivoSnapshot["veredicto"];
  if (!papelWr) {
    veredicto = { estado: "sin datos", texto: "Todavía no hay operaciones de papel cerradas para comparar con lo medido." };
  } else if (ps.cerradas < MIN_SAMPLE) {
    veredicto = {
      estado: "sin muestra",
      texto: `Hay ${ps.cerradas} ${ps.cerradas === 1 ? "operación" : "operaciones"} de papel cerradas: muestra mínima. Todavía no se compara con lo medido.`,
    };
  } else if (seSuperponen(papelWr, medidoWr)) {
    veredicto = {
      estado: "compatible",
      texto: `El win rate del papel (${pct(papelWr.p)}, ${rango(papelWr)}) se superpone con lo medido (${pct(medidoWr.p)}, ${rango(medidoWr)}). Con ${ps.cerradas} operaciones no se puede decir más.`,
    };
  } else {
    veredicto = {
      estado: "distinto",
      texto: `El win rate del papel (${pct(papelWr.p)}, ${rango(papelWr)}) queda fuera del rango medido (${rango(medidoWr)}). Revisar antes de confiar en la mesa.`,
    };
  }

  return {
    generadoEn: i.now,
    escaneo: {
      estado: estadoEscaneo,
      haceMin: haceMinEscaneo,
      progreso: i.escaneando && i.escaneando.total > 0 ? finito(i.escaneando.hechas / i.escaneando.total) : null,
      total: e ? e.resumen.total : null,
      leidas: e ? e.resumen.leidas : null,
      aprobadas: e ? e.resumen.aprobadas : null,
      largos: e ? e.resumen.largos : null,
      cortos: e ? e.resumen.cortos : null,
      mejores: e
        ? rankApproved(e.filas)
            .slice(0, 5)
            .map((r) => ({ symbol: r.symbol, direccion: r.direccion as "LONG" | "SHORT", puntaje: finito(r.puntaje), consenso: finito(r.consenso) }))
        : [],
    },
    papel: {
      abiertas: ps.abiertas,
      cerradas: ps.cerradas,
      winRate: papelWr,
      profitFactor: finito(ps.profitFactor),
      expectativaR: finito(ps.expectativaR),
      muestra: ps.muestra,
    },
    backtest: b
      ? {
          moneda: b.symbol.replace(/USDT$/, ""),
          dias: b.dias,
          operaciones: b.metricas.operaciones,
          winRate: bWr ? { p: bWr.p, low: bWr.low, high: bWr.high } : null,
          profitFactor: finito(b.metricas.profitFactor),
          muestra: b.metricas.muestra,
        }
      : null,
    medido: i.medido,
    veredicto,
    vigilancia: i.vigilancia
      ? {
          cinta: i.vigilancia.tape,
          haceMin: minutosDesde(i.now, i.vigilancia.lastRun),
          errores: i.vigilancia.errors.length,
        }
      : null,
    avisos,
    advertencia: ADVERTENCIA_VIVO,
  };
}
