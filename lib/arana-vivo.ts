/**
 * La araña en vivo: junta lo que la app ya tiene en el navegador (el escaneo que
 * va llegando o el último completo, las operaciones de papel, el último backtest
 * y la vigilancia) en una foto con su muestra, su intervalo y su veredicto frente
 * a lo medido. Es pura: no lee la red, no guarda nada y no arma órdenes. Si falta
 * un dato, lo dice («sin datos»): desconocido no es cero. Describe; no recomienda.
 */
import { arNumber } from "./ai-numbers.ts";
import type { BacktestResult } from "./jarvis-backtest.ts";
import { MIN_SAMPLE, paperStats, type PaperTrade } from "./jarvis-paper.ts";
import { isApproved, rankApproved, summarize, type ScanResult, type ScanRow } from "./jarvis-scan.ts";
import type { WatchStatus } from "./jarvis-watch-run.ts";
import type { ResumenSombra } from "./mesa-sombra.ts";
import { wilson, type Muestra } from "./jarvis-stats.ts";
import type { MedicionMesa } from "./mesa-medicion.ts";

const MINUTO = 60_000;
/** Igual que SCAN_STALE_MS de lib/jarvis-scan.ts: pasado eso, el escaneo ya no es de ahora. */
export const ESCANEO_VIEJO_MIN = 30;
export const CINTA_MAX = 12;
export const HISTOGRAMA_TRAMOS = 10;

export const ADVERTENCIA_VIVO =
  "Describe lo que pasó y lo medido en el pasado. No es asesoramiento financiero, no garantiza resultados futuros y no ejecuta ni propone órdenes.";
/** Lo que la araña dice del aprendizaje: aprende en sombra, y nada cambia sin la persona. */
export const APRENDIZAJE_VIVO =
  "Aprende sola, en sombra: el laboratorio evoluciona variantes con cada operación cerrada y las mide hacia adelante, con auditoría encadenada. Ninguna filtra el papel sin tu aprobación y nada toca la ejecución real (docs/mesa-aprendizaje.md).";

/** El laboratorio en sombra tal como lo muestra la araña (lib/mesa-sombra-run.ts lo arma). */
export type VivoSombra = {
  resumen: ResumenSombra;
  modo: "cargando" | "cuenta" | "sin sesión" | "error";
  corriendo: boolean;
  aviso: string | null;
  error: string | null;
  cadena: { ok: boolean; revisados: number; motivo: string } | null;
  eventos: { seq: number; at: number; tipo: string; texto: string; hash: string }[];
};

export type Intervalo = { p: number; low: number; high: number };
export type Veredicto = "sin datos" | "sin muestra" | "compatible" | "distinto";
export type Tono = "info" | "ok" | "malo";

export type VivoInput = {
  now: number;
  escaneo: ScanResult | null;
  /** Progreso del escaneo que está corriendo ahora, o null si no hay ninguno. */
  escaneando: { hechas: number; total: number } | null;
  /** Las monedas que van llegando del escaneo en curso (lectura rápida). */
  llegando: ScanRow[];
  papel: PaperTrade[];
  backtest: BacktestResult | null;
  vigilancia: WatchStatus | null;
  medido: MedicionMesa;
  /** El laboratorio en sombra; null o ausente si todavía no cargó. */
  sombra?: VivoSombra | null;
};

export type VivoSnapshot = {
  generadoEn: number;
  escaneo: {
    estado: "sin datos" | "escaneando" | "listo" | "parcial";
    /** Hace cuántos minutos terminó el último escaneo completo (o cortado). */
    haceMin: number | null;
    progreso: number | null;
    /** Monedas del escaneo: las que se van a leer si está corriendo, las leídas si no. */
    total: number | null;
    leidas: number | null;
    sinDatos: number | null;
    aprobadas: number | null;
    largos: number | null;
    cortos: number | null;
    /** Las frenadas, cada una en la compuerta que la frenó. */
    esperan: number | null;
    vetadas: number | null;
    sinLado: number | null;
    sinPlan: number | null;
    mejores: { symbol: string; direccion: "LONG" | "SHORT"; puntaje: number | null; consenso: number | null }[];
  };
  /** Todas las monedas a la vista: las que van llegando, o las del último escaneo completo. */
  filas: ScanRow[];
  /** Cuántas monedas caen en cada tramo de confluencia de 10 puntos (y cuántas son aprobadas). */
  histograma: { desde: number; hasta: number; n: number; aprobadas: number }[];
  /** En cuántas monedas leídas tuvo datos cada especialista. */
  especialistas: { id: string; disponibles: number; de: number }[];
  /** Cobertura media de las aprobadas: qué parte del peso de los especialistas tuvo datos. */
  coberturaMedia: { valor: number | null; n: number };
  papel: {
    abiertas: number;
    cerradas: number;
    winRate: Intervalo | null;
    profitFactor: number | null;
    expectativaR: number | null;
    muestra: Muestra;
  };
  /** Las operaciones de papel abiertas, para dibujar cada una sobre su moneda. */
  arcos: { symbol: string; lado: PaperTrade["lado"] }[];
  /** Riesgo en dólares de las abiertas: null si ninguna lo trae. `sinDato` cuenta las que no lo traen. */
  riesgoAbierto: { usd: number | null; abiertas: number; sinDato: number };
  /** Lo último que pasó: escaneos y operaciones de papel, lo más nuevo primero. */
  cinta: { cuando: number; texto: string; tono: Tono }[];
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
  aprendizaje: string;
  sombra: VivoSombra | null;
};

const finito = (x: number | null | undefined) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const rango = (i: Intervalo) => `IC90 ${pct(i.low)} a ${pct(i.high)}`;
const minutosDesde = (now: number, t: number | null) => (t === null ? null : Math.max(0, Math.round((now - t) / MINUTO)));
const seSuperponen = (a: { low: number; high: number }, b: { low: number; high: number }) => a.low <= b.high && b.low <= a.high;
const sinSufijo = (symbol: string) => symbol.replace(/USDT$/, "");
const signoR = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(2).replace(".", ",")}`;
const precioTxt = (x: number | null | undefined) => (finito(x) === null ? "sin dato" : arNumber(x as number));

function histogramaDe(filas: ScanRow[]): VivoSnapshot["histograma"] {
  const tramos = Array.from({ length: HISTOGRAMA_TRAMOS }, (_, k) => ({ desde: k * 10, hasta: k === HISTOGRAMA_TRAMOS - 1 ? 100 : k * 10 + 9, n: 0, aprobadas: 0 }));
  for (const r of filas) {
    const p = finito(r.puntaje);
    if (r.direccion === "SIN DATOS" || p === null) continue;
    const k = Math.min(HISTOGRAMA_TRAMOS - 1, Math.max(0, Math.floor(p / 10)));
    tramos[k].n += 1;
    if (isApproved(r)) tramos[k].aprobadas += 1;
  }
  return tramos;
}

function especialistasDe(filas: ScanRow[]): VivoSnapshot["especialistas"] {
  const conDetalle = filas.filter((r) => r.direccion !== "SIN DATOS" && Array.isArray(r.agentes));
  const ids = conDetalle[0]?.agentes?.map((a) => a[0]) ?? [];
  return ids.map((id) => ({ id, disponibles: conDetalle.filter((r) => r.agentes?.some((a) => a[0] === id && a[1] === 1)).length, de: conDetalle.length }));
}

function cintaDe(i: VivoInput, e: ScanResult | null, enCurso: boolean): VivoSnapshot["cinta"] {
  const hechos: VivoSnapshot["cinta"] = [];
  if (e && !enCurso) {
    hechos.push(
      e.parcial
        ? { cuando: e.at, texto: `Escaneo cortado: ${e.motivoParcial ?? "no llegó a leer todas"}. Quedaron ${e.resumen.leidas} monedas leídas.`, tono: "malo" }
        : { cuando: e.at, texto: `Escaneo terminado: ${e.resumen.leidas} monedas leídas, ${e.resumen.aprobadas} aprobadas.`, tono: "info" },
    );
  }
  for (const t of i.papel) {
    const m = sinSufijo(t.symbol);
    const lado = t.lado === "LONG" ? "largo" : "corto";
    if (t.llenadaA) hechos.push({ cuando: t.llenadaA, texto: `Papel: entró ${m} ${lado} a ${precioTxt(t.entrada)}.`, tono: "info" });
    const r = finito(t.resultadoR);
    if (t.estado === "CERRADA" && t.cerradaA && r !== null) {
      hechos.push({ cuando: t.cerradaA, texto: `Papel: cerró ${m} ${lado} con ${signoR(r)} R neto.`, tono: r > 0 ? "ok" : r < 0 ? "malo" : "info" });
    }
  }
  return hechos.sort((a, b) => b.cuando - a.cuando).slice(0, CINTA_MAX);
}

/** Arma la foto de la araña en vivo. Función pura: mismas entradas, mismo resultado. */
export function buildVivo(i: VivoInput): VivoSnapshot {
  const avisos: string[] = [];
  const e = i.escaneo;
  const prog = i.escaneando;
  const enCurso = prog !== null;
  const haceMinEscaneo = e ? minutosDesde(i.now, e.at) : null;
  const estadoEscaneo = enCurso ? "escaneando" : !e ? "sin datos" : e.parcial ? "parcial" : "listo";
  if (e && e.parcial && e.motivoParcial && !enCurso) avisos.push(`El escaneo se cortó: ${e.motivoParcial}.`);
  if (e && !enCurso && haceMinEscaneo !== null && haceMinEscaneo > ESCANEO_VIEJO_MIN) {
    avisos.push(`El último escaneo es de hace ${haceMinEscaneo} minutos: ya no es de ahora. Escaneá otra vez para verlo al día.`);
  }

  const filas = enCurso ? i.llegando : e ? e.filas : [];
  const resumen = enCurso ? summarize(i.llegando) : e ? e.resumen : null;

  const ps = paperStats(i.papel);
  // Con menos de MIN_SAMPLE operaciones cerradas no hay porcentaje: ni acierto ni intervalo.
  const winRatePapel = ps.cerradas >= MIN_SAMPLE ? wilson(ps.ganadas, ps.cerradas) : null;
  const papelWr = winRatePapel ? { p: winRatePapel.p, low: winRatePapel.low, high: winRatePapel.high } : null;

  const b = i.backtest;
  const bWr = b && b.metricas.operaciones ? wilson(b.metricas.ganadas, b.metricas.operaciones) : null;

  const medidoWr = i.medido.winRate;
  let veredicto: VivoSnapshot["veredicto"];
  if (!ps.cerradas) {
    veredicto = { estado: "sin datos", texto: "Todavía no hay operaciones de papel cerradas para comparar con lo medido." };
  } else if (!papelWr) {
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

  const abiertas = i.papel.filter((t) => t.estado === "ABIERTA");
  const riesgos = abiertas.map((t) => finito(t.decision?.riesgoUsd)).filter((x): x is number => x !== null);
  const coberturas = rankApproved(filas)
    .map((r) => finito(r.cobertura))
    .filter((x): x is number => x !== null);

  return {
    generadoEn: i.now,
    escaneo: {
      estado: estadoEscaneo,
      haceMin: haceMinEscaneo,
      progreso: prog && prog.total > 0 ? finito(prog.hechas / prog.total) : null,
      total: prog ? prog.total : resumen ? resumen.total : null,
      leidas: resumen ? resumen.leidas : null,
      sinDatos: resumen ? resumen.sinDatos : null,
      aprobadas: resumen ? resumen.aprobadas : null,
      largos: resumen ? resumen.largos : null,
      cortos: resumen ? resumen.cortos : null,
      esperan: resumen ? resumen.esperan : null,
      vetadas: resumen ? resumen.vetadas : null,
      sinLado: resumen ? resumen.sinLado : null,
      sinPlan: resumen ? resumen.sinPlan : null,
      mejores: rankApproved(filas)
        .slice(0, 5)
        .map((r) => ({ symbol: r.symbol, direccion: r.direccion as "LONG" | "SHORT", puntaje: finito(r.puntaje), consenso: finito(r.consenso) })),
    },
    filas,
    histograma: histogramaDe(filas),
    especialistas: especialistasDe(filas),
    coberturaMedia: { valor: coberturas.length ? finito(coberturas.reduce((p, x) => p + x, 0) / coberturas.length) : null, n: coberturas.length },
    papel: {
      abiertas: ps.abiertas,
      cerradas: ps.cerradas,
      winRate: papelWr,
      profitFactor: finito(ps.profitFactor),
      expectativaR: finito(ps.expectativaR),
      muestra: ps.muestra,
    },
    arcos: abiertas.map((t) => ({ symbol: t.symbol, lado: t.lado })),
    riesgoAbierto: { usd: riesgos.length ? riesgos.reduce((p, x) => p + x, 0) : null, abiertas: abiertas.length, sinDato: abiertas.length - riesgos.length },
    cinta: cintaDe(i, e, enCurso),
    backtest: b
      ? {
          moneda: sinSufijo(b.symbol),
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
    aprendizaje: APRENDIZAJE_VIVO,
    sombra: i.sombra ?? null,
  };
}
