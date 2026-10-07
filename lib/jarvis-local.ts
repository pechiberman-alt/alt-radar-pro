import { ask, type AssistantContext } from "./assistant/index.ts";
import { buildLiquidationHeatmap } from "./liquidation-heatmap.ts";
import { atrPct, strongestMagnets } from "./magnet-watch.ts";
import { timeframeConfig } from "./market-fetch.ts";
import { readPreBreak, type PreBreak } from "./pre-breakout.ts";
import type { SwingCandle } from "./swing-entries.ts";

/**
 * JARVIS's own analyst: what it says when no AI is available (no session, or
 * every AI's daily allowance is used up), and the data every AI gets about
 * what is on screen. No limit and no cost: fixed rules over the same live data.
 */

/** What the person is looking at: the section on screen and the coin JARVIS last opened or talked about. */
export type Focus = { screen: string | null; symbol: string | null; timeframe: string | null };

/** "Analizalo", "¿qué ves?", "explicame esto": the question points at the screen instead of naming something. */
export function pointsAtScreen(question: string): boolean {
  const t = fold(question);
  return /\b(analiza(lo|la|me)?( esto| eso)?|que (ves|opinas|te parece|me decis|decis)( de (esto|eso))?|explica(me)?( esto| eso| lo que veo)?|esto|eso|lo que veo|lo que tengo|en pantalla|interpreta(lo)?|lee(lo)?|leelo|resumi(lo)?|resumime)\b/.test(t) && t.split(" ").length <= 8;
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[¿?¡!.,;:"'()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Each section of the app, in words for an AI, and as the question its local analyst understands. */
export const SCREEN_TOPIC: Record<string, { about: string; local: string }> = {
  RESUMEN: { about: "el resumen del mercado", local: "resumen del mercado" },
  "ESCÁNER": { about: "el escáner de señales", local: "cuál es la mejor señal" },
  PUMPEO: { about: "el radar de pumpeo (monedas con volumen y rango anormales y su etapa)", local: "hay pumpeo" },
  LIQUIDACIONES: { about: "el mapa de liquidaciones", local: "liquidaciones y presión" },
  "OFERTA PENDIENTE": { about: "la oferta pendiente (desbloqueos de tokens)", local: "riesgo macro y noticias" },
  "FLUJO POR ACTIVO": { about: "el flujo de órdenes por activo", local: "order flow" },
  "ÓRDENES GRANDES": { about: "las órdenes grandes (ballenas)", local: "ordenes grandes" },
  "ZONAS MTF": { about: "las zonas de oferta y demanda en varias temporalidades", local: "soportes y resistencias" },
  "PRESIÓN": { about: "el panel de presión (compresión antes de una ruptura)", local: "presion y squeeze" },
  ALERTAS: { about: "las alertas", local: "riesgo macro y noticias" },
  NOTICIAS: { about: "las noticias", local: "noticias y riesgo macro" },
  REGISTRO: { about: "el registro de señales y su rendimiento", local: "rendimiento" },
  "MI CARTERA": { about: "la cartera del usuario", local: "cuanto arriesgo" },
  FUTUROS: { about: "las posiciones de futuros del usuario", local: "cuanto arriesgo" },
  "A PUNTO DE ROMPER": { about: "las monedas a punto de romper (comprimidas contra un nivel)", local: "cual es la mejor señal" },
  "SUBEN SOLAS": { about: "las monedas que suben solas, desacopladas de BTC", local: "correlaciones y rotacion" },
  "SEÑALES": { about: "las señales del robot MM", local: "cual es la mejor señal" },
  DIARIO: { about: "el diario de operaciones del usuario", local: "cuanto arriesgo" },
  RIESGO: { about: "la calculadora de riesgo", local: "cuanto arriesgo" },
  DCA: { about: "la calculadora de compras escalonadas (DCA)", local: "cuanto arriesgo" },
};

/** JARVIS's section ids (lib/jarvis.ts) as the app's screen names, for when JARVIS itself opens one. */
export const SECTION_SCREEN: Record<string, string> = {
  resumen: "RESUMEN",
  scanner: "ESCÁNER",
  pumpeo: "PUMPEO",
  liquidaciones: "LIQUIDACIONES",
  alertas: "ALERTAS",
  noticias: "NOTICIAS",
  cartera: "MI CARTERA",
  historial: "REGISTRO",
  rompe: "A PUNTO DE ROMPER",
  desacople: "SUBEN SOLAS",
  inteligencia: "SEÑALES",
  diario: "DIARIO",
  riesgo: "RIESGO",
  dca: "DCA",
};

/**
 * The question with what is on screen made explicit, so every brain — and the
 * local analyst — knows what "lo" is. A coin in focus wins on the map; any
 * other section is described by name.
 */
export function withFocus(question: string, focus: Focus | null): { question: string; about: string | null } {
  if (!focus || !pointsAtScreen(question)) return { question, about: null };
  const coin = focus.symbol?.replace(/USDT$/, "") ?? null;
  const topic = focus.screen ? SCREEN_TOPIC[focus.screen] : undefined;
  const about =
    coin && (focus.screen === "LIQUIDACIONES" || !topic)
      ? `${coin}${focus.timeframe ? ` en ${focus.timeframe}` : ""}${focus.screen === "LIQUIDACIONES" ? " (su mapa de liquidaciones está en pantalla)" : ""}`
      : topic?.about ?? (coin ? coin : null);
  return about ? { question: `${question.trim()} — se refiere a ${about}.`, about } : { question, about: null };
}

// ── A coin, read from its candles (only closed ones) ─────────────────────────

export type CoinBrief = {
  symbol: string;
  timeframe: string;
  /** Open time of the last closed candle read. */
  at: number;
  price: number;
  change24h: number | null;
  change7d: number | null;
  trend: "ALCISTA" | "BAJISTA" | "LATERAL";
  atrPct: number;
  high48: number;
  low48: number;
  /** Volume of the last closed candle against the average of the 20 before it. */
  relVolume: number | null;
  preBreak: Pick<PreBreak, "state" | "side" | "score" | "level"> | null;
  magnets: { above: { price: number; distancePct: number; intensity: number } | null; below: { price: number; distancePct: number; intensity: number } | null };
};

function ema(values: number[], n: number): number[] {
  const k = 2 / (n + 1);
  const out: number[] = [];
  values.forEach((v, i) => out.push(i === 0 ? v : v * k + out[i - 1] * (1 - k)));
  return out;
}

/**
 * The brief of a coin on 1h candles. `now` drops the candle still forming:
 * the reading never uses a candle that has not closed.
 */
export function coinBrief(symbol: string, candles: SwingCandle[], now: number, frameMs = 3_600_000, timeframe = "1h"): CoinBrief | null {
  const c = candles.filter((x) => x.openTime + frameMs <= now);
  if (c.length < 60) return null;
  const last = c[c.length - 1];
  const closes = c.map((x) => x.close);
  const e50 = ema(closes, 50);
  const slope = e50[e50.length - 1] / e50[e50.length - 11] - 1;
  const trend = last.close > e50[e50.length - 1] && slope > 0.002 ? "ALCISTA" : last.close < e50[e50.length - 1] && slope < -0.002 ? "BAJISTA" : "LATERAL";
  const back = (n: number) => (c.length > n ? last.close / c[c.length - 1 - n].close - 1 : null);
  const recent = c.slice(-48);
  const prev20 = c.slice(-21, -1);
  const avgVol = prev20.reduce((a, x) => a + x.volume, 0) / (prev20.length || 1);
  const pre = c.length >= 80 ? readPreBreak(c.slice(-200), symbol) : null;
  const cfg = timeframeConfig(timeframe);
  const map = c.length >= 120 ? buildLiquidationHeatmap(symbol, c.slice(-500), last.close, { halfLifeCandles: cfg.halfLife, priceRangePct: cfg.priceRange }) : null;
  const pair = map ? strongestMagnets(map, last.close) : null;
  const mag = (m: { price: number; distancePct: number; intensity: number } | null | undefined) => (m ? { price: m.price, distancePct: m.distancePct, intensity: m.intensity } : null);
  return {
    symbol,
    timeframe,
    at: last.openTime,
    price: last.close,
    change24h: back(24),
    change7d: back(168),
    trend,
    atrPct: atrPct(c),
    high48: Math.max(...recent.map((x) => x.high)),
    low48: Math.min(...recent.map((x) => x.low)),
    relVolume: avgVol > 0 ? last.volume / avgVol : null,
    preBreak: pre ? { state: pre.state, side: pre.side, score: pre.score, level: pre.level } : null,
    magnets: { above: mag(pair?.above), below: mag(pair?.below) },
  };
}

const px = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: v >= 1000 ? 0 : v >= 1 ? 3 : 6 });
const pc = (v: number, d = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d).replace(".", ",")}%`;

/** The brief in a few plain sentences: what it is doing, where the levels are, what would change the read. */
export function briefText(b: CoinBrief): string {
  const coin = b.symbol.replace(/USDT$/, "");
  const parts = [
    `${coin} en ${px(b.price)}${b.change24h !== null ? `, ${pc(b.change24h)} en 24 horas` : ""}${b.change7d !== null ? ` y ${pc(b.change7d)} en 7 días` : ""}.`,
    b.trend === "LATERAL"
      ? `En ${b.timeframe} está de costado: el precio va y viene alrededor de su media de 50 velas.`
      : `En ${b.timeframe} la tendencia es ${b.trend === "ALCISTA" ? "alcista: precio arriba de su media de 50 velas y la media subiendo" : "bajista: precio abajo de su media de 50 velas y la media bajando"}.`,
    `Rango de las últimas 48 velas: ${px(b.low48)} a ${px(b.high48)}; se mueve ${b.atrPct.toFixed(2).replace(".", ",")}% por vela en promedio.`,
  ];
  if (b.preBreak && b.preBreak.state !== "QUIETO") {
    const dir = b.preBreak.side === "ALCISTA" ? "hacia arriba" : b.preBreak.side === "BAJISTA" ? "hacia abajo" : "sin dirección clara";
    parts.push(`${b.preBreak.state === "A PUNTO" ? "Está a punto de romper" : "Se está armando una ruptura"} ${dir} (presión ${b.preBreak.score}/100${b.preBreak.level ? `, contra ${px(b.preBreak.level)}` : ""}): es probable, no seguro.`);
  }
  const { above, below } = b.magnets;
  if (above || below) {
    const z = (m: NonNullable<CoinBrief["magnets"]["above"]>) => `${px(m.price)} (${pc(m.distancePct / 100)}, intensidad ${Math.round(m.intensity)})`;
    parts.push(`Imanes de liquidación estimados: ${above ? `arriba ${z(above)}` : ""}${above && below ? "; " : ""}${below ? `abajo ${z(below)}` : ""}. Son zonas de un modelo, no posiciones reales.`);
  }
  if (b.relVolume !== null && (b.relVolume >= 2 || b.relVolume <= 0.4)) {
    parts.push(b.relVolume >= 2 ? `La última vela tuvo ${b.relVolume.toFixed(1).replace(".", ",")} veces el volumen normal: hay interés.` : "La última vela tuvo muy poco volumen: el movimiento no tiene respaldo.");
  }
  const invalid = b.trend === "ALCISTA" ? `perder ${px(b.low48)}` : b.trend === "BAJISTA" ? `recuperar ${px(b.high48)}` : `salir del rango ${px(b.low48)}–${px(b.high48)}`;
  parts.push(`Lo que cambiaría la lectura: ${invalid}. No es asesoramiento financiero.`);
  return parts.join(" ");
}

/** For the AIs: the brief as compact numbers. */
export function briefForAi(b: CoinBrief) {
  const r = (v: number | null, d = 4) => (v === null ? null : Number(v.toFixed(d)));
  return {
    moneda: b.symbol,
    temporalidad: b.timeframe,
    ultimaVelaCerrada: new Date(b.at).toISOString(),
    precio: b.price,
    cambio24h: r(b.change24h),
    cambio7d: r(b.change7d),
    tendencia: b.trend,
    atrPct: r(b.atrPct, 3),
    rango48: [b.low48, b.high48],
    volumenRelativo: r(b.relVolume, 2),
    aPuntoDeRomper: b.preBreak,
    imanesEstimados: b.magnets,
  };
}

/**
 * The local analyst's answer: the coin's brief when the question is about a
 * coin (named or on screen), and the app's rules-based analyst for the rest.
 */
export function localAnswer(question: string, focus: Focus | null, ctx: AssistantContext | null, brief: CoinBrief | null): string {
  const onScreen = pointsAtScreen(question);
  const topic = focus?.screen ? SCREEN_TOPIC[focus.screen] : undefined;
  if (brief && (!onScreen || focus?.screen === "LIQUIDACIONES" || !topic)) return briefText(brief);
  if (!ctx) return brief ? briefText(brief) : "Todavía no tengo los datos del radar cargados. Abrí el resumen un momento y preguntame de nuevo.";
  const q = onScreen && topic ? topic.local : question;
  return ask(q, ctx).text;
}
