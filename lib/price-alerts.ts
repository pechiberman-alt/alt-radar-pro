import { FUTURES_ONLY } from "./klines-server.ts";
import type { SwingCandle } from "./swing-entries.ts";

/**
 * Price alerts you ask the bot for: "/alerta BTC 90000" and the Worker watches
 * the price for you, with every browser closed, and writes when it gets there.
 *
 * HOW A TOUCH IS DETECTED
 * Not by comparing the last price every few minutes — a wick that goes and
 * comes back between two checks would be missed. Each run reads the 1-minute
 * candles since the alert was created (up to the last two hours) and fires on
 * the first candle whose high (for a level above) or low (for a level below)
 * reached it. The minute in which the alert was created is skipped: part of
 * it happened before the alert existed, and firing on that would be a false
 * alarm. Once fired, the alert is deleted: it fires once.
 *
 * NUMBERS AS PEOPLE WRITE THEM
 * "90.000" is ninety thousand in Argentina and ninety in the US; "1,495" is
 * one-and-a-half here and fifteen hundred there. Every reading the text allows
 * is considered and the one closest to the coin's current price wins, so both
 * habits work without asking which one the person uses.
 */

export type AlertDirection = "ARRIBA" | "ABAJO";
export type PriceAlert = {
  id: number;
  symbol: string;
  target: number;
  direction: AlertDirection;
  createdAt: number;
  createdPrice: number;
};

export const MAX_ALERTS_PER_USER = 10;
export const LOOKBACK_MINUTES = 120;
/** A level this close to the current price is "already there". */
export const MIN_DISTANCE = 0.0005;

const QUOTES = ["USDT", "USDC", "FDUSD", "BTC", "ETH", "BNB"];

/** Names people use for the metals, mapped to Binance's perpetuals. */
const ALIASES: Record<string, string> = {
  XAU: "XAUUSDT", XAUUSD: "XAUUSDT", ORO: "XAUUSDT", GOLD: "XAUUSDT",
  XAG: "XAGUSDT", XAGUSD: "XAGUSDT", PLATA: "XAGUSDT", SILVER: "XAGUSDT",
};

export function normalizeSymbol(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[\s/_-]/g, "");
  if (ALIASES[s]) return ALIASES[s];
  if (!/^[A-Z0-9]{2,20}$/.test(s)) return null;
  const full = QUOTES.some((q) => s.length > q.length && s.endsWith(q)) ? s : `${s}USDT`;
  return full.length <= 20 ? full : null;
}

function readings(text: string): number[] {
  const dots = (text.match(/\./g) ?? []).length;
  const commas = (text.match(/,/g) ?? []).length;
  const grouped = (sep: string) => text.split(sep).slice(1).every((g) => g.length === 3) && text.split(sep)[0].length >= 1 && text.split(sep)[0].length <= 3;
  if (dots && commas) {
    const decimal = text.lastIndexOf(".") > text.lastIndexOf(",") ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    return [Number(text.split(thousands).join("").replace(decimal, "."))];
  }
  const sep = dots ? "." : commas ? "," : null;
  if (!sep) return [Number(text)];
  const out: number[] = [];
  if ((sep === "." ? dots : commas) === 1) out.push(Number(text.replace(sep, ".")));
  if (grouped(sep)) out.push(Number(text.split(sep).join("")));
  return out;
}

/** The price the person meant, using the coin's current price to settle "90.000" and "1,495". */
export function parseTarget(raw: string, reference: number): number | null {
  let text = raw.trim().toLowerCase().replace(/^\$/, "");
  let scale = 1;
  if (/[km]$/.test(text)) {
    scale = text.endsWith("k") ? 1_000 : 1_000_000;
    text = text.slice(0, -1);
  }
  if (!/^\d[\d.,]*$/.test(text) || /[.,]$/.test(text)) return null;
  const options = readings(text)
    .map((v) => v * scale)
    .filter((v) => Number.isFinite(v) && v > 0);
  if (!options.length) return null;
  if (!(reference > 0)) return options[0];
  return options.reduce((best, v) => (Math.abs(Math.log(v / reference)) < Math.abs(Math.log(best / reference)) ? v : best));
}

export function parseAlertArgs(arg: string): { symbol: string; target: string } | null {
  const parts = arg.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const symbol = normalizeSymbol(parts[0]);
  return symbol ? { symbol, target: parts[1] } : null;
}

export function directionFor(target: number, price: number): AlertDirection | null {
  if (!(target > 0) || !(price > 0)) return null;
  if (Math.abs(target / price - 1) < MIN_DISTANCE) return null;
  return target > price ? "ARRIBA" : "ABAJO";
}

/** Open time of the first 1-minute candle after the alert was created that reached its level, or null. */
export function firstTouch(alert: Pick<PriceAlert, "target" | "direction" | "createdAt">, candles: SwingCandle[]): number | null {
  for (const c of [...candles].sort((a, b) => a.openTime - b.openTime)) {
    if (c.openTime < alert.createdAt) continue;
    if (alert.direction === "ARRIBA" ? c.high >= alert.target : c.low <= alert.target) return c.openTime;
  }
  return null;
}

// ─── messages ─────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const group = (int: string) => int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
/** Argentine format without depending on the runtime's locale data. */
export function px(v: number): string {
  // Two decimals above 1.000 too: gold at 4.123,50 must not read as 4.124.
  const digits = v >= 100 ? 2 : v >= 1 ? 4 : v >= 0.01 ? 5 : 8;
  const [int, frac] = v.toFixed(digits).split(".");
  const trimmed = (frac ?? "").replace(/0+$/, "");
  return trimmed ? `${group(int)},${trimmed}` : group(int);
}
const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2).replace(".", ",")}%`;
const coin = (symbol: string) => esc(symbol.replace(/USDT$/, ""));
const arrow = (d: AlertDirection) => (d === "ARRIBA" ? "↑" : "↓");
const hhmm = (t: number, tzOffsetMin: number) => new Date(t - tzOffsetMin * 60_000).toISOString().slice(11, 16);

export const ALERT_USAGE =
  "<b>Alertas de precio</b>\n" +
  "/alerta BTC 90000 — te aviso cuando BTC llegue a 90.000 (subiendo o bajando, lo deduzco del precio actual)\n" +
  "/alertas — ver las que tenés\n" +
  "/borrar 2 — borrar la número 2 · /borrar todas\n" +
  `Hasta ${MAX_ALERTS_PER_USER} a la vez. Cada una avisa una sola vez y se borra.`;

export function createdMessage(alert: Pick<PriceAlert, "symbol" | "target" | "direction">, price: number): string {
  const distance = (alert.target / price - 1) * 100;
  return (
    `✅ <b>Alerta creada: ${coin(alert.symbol)} ${arrow(alert.direction)} ${px(alert.target)}</b>\n` +
    `Ahora está en ${px(price)} (falta ${pct(distance)}). Te aviso cuando ${alert.direction === "ARRIBA" ? "suba" : "baje"} hasta ahí.\n` +
    (FUTURES_ONLY.has(alert.symbol)
      ? `<i>Precio del perpetuo ${esc(alert.symbol)} de Binance: sigue al ${alert.symbol.startsWith("XAU") ? "oro" : "metal"}, pero puede diferir unos dólares del de tu broker, y con el mercado cerrado (fin de semana) se mueve poco.</i>\n`
      : "") +
    `<i>Se revisa cada 5 minutos con las velas de 1 minuto, así que también cuentan las mechas.</i>`
  );
}

/** `elsewhere`: the exchange whose dollar price was read because Binance refused the server (Kraken, Coinbase). */
export function triggeredMessage(alert: PriceAlert, touchedAt: number, price: number | null, tzOffsetMin: number, elsewhere: string | null = null): string {
  return (
    `🔔 <b>${coin(alert.symbol)} llegó a ${px(alert.target)}</b> ${alert.direction === "ARRIBA" ? "subiendo" : "bajando"}\n` +
    `Lo tocó a las ${hhmm(touchedAt, tzOffsetMin)}${price ? ` · ahora ${px(price)}` : ""}.\n` +
    (elsewhere ? `Medido con el precio de ${elsewhere} en dólares: Binance no deja leer al servidor ahora. Puede diferir levemente del de Binance.\n` : "") +
    `<i>La pusiste cuando estaba en ${px(alert.createdPrice)}. Esta alerta ya se borró.</i>`
  );
}

export function listMessage(alerts: PriceAlert[], prices: Record<string, number>): string {
  if (!alerts.length) return `No tenés alertas de precio.\n\n${ALERT_USAGE}`;
  const lines = alerts.map((a, i) => {
    const now = prices[a.symbol];
    return `${i + 1}. <b>${coin(a.symbol)} ${arrow(a.direction)} ${px(a.target)}</b>${now ? ` · ahora ${px(now)} (falta ${pct((a.target / now - 1) * 100)})` : ""}`;
  });
  return `<b>Tus alertas de precio</b> (${alerts.length}/${MAX_ALERTS_PER_USER})\n${lines.join("\n")}\n\n/borrar N para quitar una · /borrar todas`;
}
