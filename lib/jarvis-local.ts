import { ask, type AssistantContext } from "./assistant/index.ts";

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
  "JARVIS TRADING": { about: "la mesa de especialistas de JARVIS (plan de trading del activo en pantalla)", local: "cual es la mejor señal" },
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
  "jarvis-trading": "JARVIS TRADING",
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

/**
 * The local analyst's answer: the asset's full analysis (jarvis-analyst.ts,
 * already written as a report) when the question is about a coin — named, or
 * on the map — and the app's rules-based analyst for the rest.
 */
export function localAnswer(question: string, focus: Focus | null, ctx: AssistantContext | null, report: string | null): string {
  const onScreen = pointsAtScreen(question);
  const topic = focus?.screen ? SCREEN_TOPIC[focus.screen] : undefined;
  if (report && (!onScreen || focus?.screen === "LIQUIDACIONES" || !topic)) return report;
  if (!ctx) return report ?? "Todavía no tengo los datos del radar cargados. Abrí el resumen un momento y preguntame de nuevo.";
  const q = onScreen && topic ? topic.local : question;
  return ask(q, ctx).text;
}
