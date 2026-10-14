/**
 * Las monedas que la persona pide por nombre en Telegram y JARVIS no vigila (por ejemplo ONDO): se detecta cuál pidió y se
 * arma una lectura corta de 4 h con los mismos indicadores del estudio (lib/estrategias.ts), sobre velas ya cerradas. Si el dato
 * no llega, el bot lo dice en vez de inventar niveles. Pura: no usa la red; el servidor trae las velas y el precio.
 */
import { indicadores } from "./estrategias.ts";
import type { SwingCandle } from "./swing-entries.ts";

/** Palabras comunes que no son una moneda aunque tengan forma de ticker. */
const NO_MONEDA = new Set([
  "HOLA", "DECIME", "COMO", "QUE", "PARA", "CON", "SOBRE", "ANALIZA", "MIRA", "VER", "LA", "EL", "DE", "DEL", "LOS", "LAS", "UNA", "UN", "ES", "POR",
  "SI", "NO", "MAS", "ME", "TE", "SE", "LO", "AL", "EN", "Y", "O", "HAY", "TIENE", "PASA", "OK", "GRACIAS", "DALE", "SEGUI", "JARVIS",
]);
/** Las que el bot ya trae siempre. */
const SIEMPRE = new Set(["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "LINK"]);
const GATILLOS = new Set(["DE", "DEL", "SOBRE", "ANALIZA", "ANALIZÁ", "MIRA", "MIRÁ", "VER", "OPINAS", "OPINÁS", "PRECIO"]);

/** Hasta tres símbolos (sin USDT) que la persona pudo estar pidiendo: la palabra suelta, una en mayúsculas o la que sigue a «de», «sobre»... */
export function candidatosMoneda(texto: string): string[] {
  const palabras = texto.match(/[\p{L}\p{N}]+/gu) ?? [];
  const out: string[] = [];
  const agregar = (w: string) => {
    const t = w.toUpperCase();
    if (/^[A-Z0-9]{2,10}$/.test(t) && !NO_MONEDA.has(t) && !SIEMPRE.has(t) && !out.includes(t)) out.push(t);
  };
  if (palabras.length === 1) agregar(palabras[0]);
  palabras.forEach((w, i) => {
    if (w === w.toUpperCase() && /[A-Z]/.test(w) && palabras.length > 1) agregar(w);
    if (i > 0 && GATILLOS.has(palabras[i - 1].toUpperCase())) agregar(w);
  });
  return out.slice(0, 3);
}

export type LecturaMoneda = {
  s: string;
  price: number;
  ch24h: number | null;
  /** Lo que se lee en las velas de 4 h cerradas: dirección del Supertrend, posición frente a la EMA 200 y RSI. */
  supertrend4h: "ALCISTA" | "BAJISTA" | null;
  supertrendDiario: "ALCISTA" | "BAJISTA" | null;
  sobreEma200: boolean | null;
  rsi14: number | null;
  velas: number;
};

const dir = (x: number | undefined) => (x === 1 ? "ALCISTA" : x === -1 ? "BAJISTA" : null);

/** La lectura de una moneda a partir de sus velas de 4 h (la que está formándose se descarta) y su precio actual. */
export function lecturaMoneda(symbol: string, velas: SwingCandle[], price: number, ch24h: number | null, ahora: number, marcoMs = 4 * 3_600_000): LecturaMoneda | null {
  const cerradas = velas.filter((v) => v.openTime + marcoMs <= ahora);
  if (!(price > 0) || cerradas.length < 30) return null;
  const ind = indicadores(cerradas);
  const i = cerradas.length - 1;
  const fin = (x: number) => (Number.isFinite(x) ? x : null);
  const ema = fin(ind.ema200[i]);
  return {
    s: symbol,
    price,
    ch24h,
    supertrend4h: dir(ind.stDir[i]),
    supertrendDiario: dir(ind.htfDir[i]),
    sobreEma200: ema === null ? null : cerradas[i].close > ema,
    rsi14: fin(ind.rsi14[i]) === null ? null : Math.round(ind.rsi14[i]),
    velas: cerradas.length,
  };
}
