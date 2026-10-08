import { arNumber } from "./ai-numbers.ts";
import type { DeskSnapshot } from "./jarvis-desk-data.ts";
import { DEFAULT_DESK_SETTINGS, runDesk, type DeskSettings, type Side } from "./jarvis-desk.ts";
import { canPaper, MIN_SAMPLE, paperFromDesk, paperStats, recordFor, resolvePaper, type PaperTrade } from "./jarvis-paper.ts";
import type { SwingCandle } from "./swing-entries.ts";

/**
 * Backtesting de la mesa de JARVIS: la misma mesa y las mismas reglas del paper
 * trading, caminando hacia adelante sobre velas pasadas. En cada cierre de 4 h
 * la mesa lee SOLO lo que ya había cerrado a esa hora; si aprueba un plan, se
 * sigue con las reglas del papel (un tercio por objetivo, stop fijo, peor caso
 * primero, comisiones, 7 días). Una operación a la vez: mientras hay una
 * abierta, no se evalúa otra.
 *
 * Lo que no tiene historial gratuito (funding, interés abierto, ratio
 * largo/corto, noticias, Miedo y Avaricia, calendario y dominancia) no entra:
 * esos especialistas pesan cero y el resultado lo dice. Es una medición del
 * pasado, no una garantía de nada.
 */

const H = 3_600_000;
export const BACKTEST_STEP_H = 4;
export const WARMUP_H1 = 1000;

export type BacktestInput = {
  symbol: string;
  h1: SwingCandle[];
  h4: SwingCandle[] | null;
  d1: SwingCandle[] | null;
  btc: SwingCandle[] | null;
  eth: SwingCandle[] | null;
  /** Ventana evaluada: cierres de 4 h entre `from` y `to`. */
  from: number;
  to: number;
  settings?: DeskSettings;
  fuente: string;
};

export type BacktestMetrics = {
  operaciones: number;
  ganadas: number;
  perdidas: number;
  winRate: number | null;
  profitFactor: number | null;
  expectativaR: number | null;
  totalR: number;
  maxDrawdownR: number;
  /** Con capital cargado: riesgo fijo por operación sobre el capital inicial, sin interés compuesto. */
  pnlUsd: number | null;
  maxDrawdownUsd: number | null;
  maxDrawdownPct: number | null;
  rrPromedio: number | null;
  mejorR: number | null;
  peorR: number | null;
  duracionMediaH: number | null;
  muestra: "SIN DATOS" | "MUESTRA MÍNIMA" | "MUESTRA RAZONABLE";
};

export type BacktestResult = {
  symbol: string;
  desde: number;
  hasta: number;
  dias: number;
  trades: PaperTrade[];
  /** Operaciones que quedaron abiertas al final de los datos: no cuentan. */
  abiertasAlFinal: number;
  equity: { t: number; r: number }[];
  metricas: BacktestMetrics;
  /** Qué dijo la mesa en cada cierre evaluado (con o sin operación abierta, solo los evaluados). */
  lecturas: { evaluadas: number; long: number; short: number; esperar: number; noTrade: number; sinDatos: number };
  fuente: string;
  limitaciones: string[];
};

export const BACKTEST_LIMITS = [
  "Sin derivados históricos (funding, interés abierto, ratio largo/corto, flujo agresor): ese especialista pesa cero.",
  "Sin noticias, Miedo y Avaricia, calendario macro ni dominancia históricos: esos especialistas pesan cero.",
  "Mapa de liquidaciones estimado con las velas de cada momento, no con liquidaciones reales.",
  "Velas de 1 h: dentro de una misma vela no se sabe qué tocó primero, y se cuenta el peor caso.",
  "Resultados pasados y simulados: no garantizan rentabilidad futura.",
];

const closedAt = (c: SwingCandle[] | null, frameMs: number, now: number, keep: number) => {
  if (!c) return null;
  let hi = c.length;
  while (hi > 0 && c[hi - 1].openTime + frameMs > now) hi -= 1;
  return c.slice(Math.max(0, hi - keep), hi);
};

/** La foto de la mesa a una hora pasada: solo velas cerradas a esa hora; sin datos sin historial. */
export function snapshotAt(input: BacktestInput, now: number): DeskSnapshot {
  return {
    symbol: input.symbol,
    now,
    candles: {
      h1: closedAt(input.h1, H, now, WARMUP_H1) ?? [],
      h4: closedAt(input.h4, 4 * H, now, 300),
      d1: closedAt(input.d1, 24 * H, now, 220),
    },
    btc: input.symbol === "BTCUSDT" ? null : closedAt(input.btc, H, now, 200),
    eth: input.symbol === "ETHUSDT" ? null : closedAt(input.eth, H, now, 200),
    derivatives: null,
    macro: { btcDominance: null, usdtDominance: null, marketCapChange24h: null, events: null, calendarSource: null },
    news: null,
    fearGreed: null,
    sources: [`Velas: ${input.fuente} (backtest, solo cerradas a cada hora)`],
  };
}

export type BacktestState = {
  next: number;
  trades: PaperTrade[];
  lecturas: BacktestResult["lecturas"];
  done: boolean;
};

export function startBacktest(input: BacktestInput): BacktestState {
  const step = BACKTEST_STEP_H * H;
  return { next: Math.ceil(input.from / step) * step, trades: [], lecturas: { evaluadas: 0, long: 0, short: 0, esperar: 0, noTrade: 0, sinDatos: 0 }, done: false };
}

/** Cuántos cierres de 4 h tiene la ventana (para mostrar el avance). */
export function backtestSteps(input: BacktestInput): number {
  const step = BACKTEST_STEP_H * H;
  return Math.max(0, Math.floor((input.to - Math.ceil(input.from / step) * step) / step) + 1);
}

/**
 * Avanza hasta `maxSteps` cierres de 4 h (para no trabar el celular: se
 * llama de a pedazos). La resolución de cada operación usa las velas
 * posteriores a su entrada, como el papel; la decisión, solo las anteriores.
 */
export function stepBacktest(input: BacktestInput, state: BacktestState, maxSteps = 40): BacktestState {
  if (state.done) return state;
  const step = BACKTEST_STEP_H * H;
  const dataEnd = input.h1.length ? input.h1[input.h1.length - 1].openTime + H : 0;
  const settings = input.settings ?? DEFAULT_DESK_SETTINGS;
  let { next } = state;
  const trades = [...state.trades];
  const lecturas = { ...state.lecturas };
  for (let k = 0; k < maxSteps && next <= input.to; k += 1) {
    // One trade at a time: while one is open, the desk is not asked again.
    const open = trades.at(-1);
    if (open && open.estado !== "CERRADA" && open.estado !== "CANCELADA") break;
    if (open?.cerradaA && open.cerradaA > next) {
      next = Math.ceil(open.cerradaA / step) * step;
      continue;
    }
    const now = next + 1000;
    next += step;
    const d = runDesk(snapshotAt(input, now), settings, null);
    lecturas.evaluadas += 1;
    if (!d) {
      lecturas.sinDatos += 1;
      continue;
    }
    if (d.direccion === "LONG") lecturas.long += 1;
    else if (d.direccion === "SHORT") lecturas.short += 1;
    else if (d.direccion === "ESPERAR") lecturas.esperar += 1;
    else lecturas.noTrade += 1;
    if (!canPaper(d)) continue;
    // The desk decided at this close: a market plan enters at it (a person opening by hand enters at the next minute).
    const t = paperFromDesk(d, now, { atClose: true });
    if (!t) continue;
    trades.push(resolvePaper(t, input.h1, dataEnd, input.fuente));
  }
  const last = trades.at(-1);
  const stuck = Boolean(last && last.estado !== "CERRADA" && last.estado !== "CANCELADA");
  return { next, trades, lecturas, done: next > input.to || stuck };
}

/** Las métricas de una lista de operaciones cerradas, con la curva de resultado y la peor caída. */
export function backtestMetrics(trades: PaperTrade[], settings: DeskSettings = DEFAULT_DESK_SETTINGS): { metricas: BacktestMetrics; equity: { t: number; r: number }[] } {
  const closed = trades.filter((t) => t.estado === "CERRADA" && t.resultadoR !== null).sort((a, b) => a.cerradaA! - b.cerradaA!);
  const st = paperStats(closed);
  const equity: { t: number; r: number }[] = [];
  let cum = 0;
  let peak = 0;
  let dd = 0;
  for (const t of closed) {
    cum += t.resultadoR!;
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
    equity.push({ t: t.cerradaA!, r: cum });
  }
  const riskUsd = settings.capital ? (settings.capital * settings.riesgoPct) / 100 : null;
  return {
    metricas: {
      operaciones: closed.length,
      ganadas: st.ganadas,
      perdidas: st.perdidas,
      winRate: st.winRate,
      profitFactor: st.profitFactor,
      expectativaR: st.expectativaR,
      totalR: st.totalR,
      maxDrawdownR: dd,
      pnlUsd: riskUsd === null ? null : st.totalR * riskUsd,
      maxDrawdownUsd: riskUsd === null ? null : dd * riskUsd,
      maxDrawdownPct: riskUsd === null ? null : dd * settings.riesgoPct,
      rrPromedio: closed.length ? closed.reduce((p, t) => p + t.rrPlan, 0) / closed.length : null,
      mejorR: st.mejorR,
      peorR: st.peorR,
      duracionMediaH: st.duracionMediaH,
      muestra: st.muestra,
    },
    equity,
  };
}

export function finishBacktest(input: BacktestInput, state: BacktestState): BacktestResult {
  const { metricas, equity } = backtestMetrics(state.trades, input.settings);
  return {
    symbol: input.symbol,
    desde: input.from,
    hasta: input.to,
    dias: Math.round((input.to - input.from) / (24 * H)),
    trades: state.trades,
    abiertasAlFinal: state.trades.filter((t) => t.estado === "ABIERTA" || t.estado === "PENDIENTE").length,
    equity,
    metricas,
    lecturas: state.lecturas,
    fuente: input.fuente,
    limitaciones: BACKTEST_LIMITS,
  };
}

/** Todo de una vez (pruebas y servidor); en el navegador se usa de a pedazos. */
export function runBacktest(input: BacktestInput): BacktestResult {
  let s = startBacktest(input);
  while (!s.done) s = stepBacktest(input, s, 500);
  return finishBacktest(input, s);
}

/** Los setups del backtest parecidos al de hoy (mismo lado y tramo de confluencia). */
export function backtestRecord(r: BacktestResult, side: Side, score: number) {
  const rec = recordFor(r.trades, side, score);
  return rec ? { ...rec, etiqueta: rec.etiqueta.replace(/operaci(ón|ones) de papel parecidas?/, (m) => m.replace("de papel", "del backtest")) } : null;
}

const r2 = (v: number) => arNumber(Number(v.toFixed(2)));

/** El resumen para la voz y el chat, con su muestra y sin prometer nada. */
export function backtestSpeech(r: BacktestResult): string {
  const m = r.metricas;
  const coin = r.symbol.replace(/USDT$/, "");
  if (!m.operaciones) {
    return `Backtest de ${coin} en ${r.dias} días: la mesa evaluó ${r.lecturas.evaluadas} cierres de 4 horas y no aprobó ninguna operación que haya cerrado (${r.lecturas.esperar} veces esperar, ${r.lecturas.noTrade} no operar). Sin operaciones no hay resultados para medir.`;
  }
  const pf = m.profitFactor === null ? "sin dato" : m.profitFactor === Infinity ? "infinito" : r2(m.profitFactor);
  return [
    `Backtest de ${coin} en ${r.dias} días, con la misma mesa y las reglas del papel: ${m.operaciones} ${m.operaciones === 1 ? "operación" : "operaciones"}, ${m.ganadas} ${m.ganadas === 1 ? "ganada" : "ganadas"}.`,
    `Win rate ${Math.round((m.winRate ?? 0) * 100)} por ciento, profit factor ${pf}, expectativa ${m.expectativaR! >= 0 ? "más" : "menos"} ${r2(Math.abs(m.expectativaR!))} R por operación, total ${m.totalR >= 0 ? "más" : "menos"} ${r2(Math.abs(m.totalR))} R, peor caída ${r2(m.maxDrawdownR)} R.`,
    m.muestra === "MUESTRA MÍNIMA" ? `Es una muestra mínima: menos de ${MIN_SAMPLE} operaciones no alcanzan para sacar conclusiones.` : "",
    "Sin derivados, noticias ni calendario históricos. Resultados pasados y simulados: no garantizan rentabilidad futura.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** El último backtest para el contexto de la IA: lo medido, su muestra y lo que no mide. */
export function backtestForAi(r: BacktestResult) {
  const m = r.metricas;
  return {
    simulado: true,
    moneda: r.symbol.replace(/USDT$/, ""),
    dias: r.dias,
    operaciones: m.operaciones,
    winRate: m.winRate === null ? null : `${Math.round(m.winRate * 100)}%`,
    profitFactor: m.profitFactor === null ? null : m.profitFactor === Infinity ? "infinito" : arNumber(Number(m.profitFactor.toFixed(2))),
    expectativaR: m.expectativaR === null ? null : arNumber(Number(m.expectativaR.toFixed(2))),
    totalR: arNumber(Number(m.totalR.toFixed(2))),
    maxCaidaR: arNumber(Number(m.maxDrawdownR.toFixed(2))),
    muestra: m.muestra,
    noMide: "derivados, noticias, sentimiento y calendario históricos; no garantiza resultados futuros",
  };
}
