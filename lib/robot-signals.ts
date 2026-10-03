import { flushSeries, type LvStats } from "./liq-vol-signals.ts";
import { mmEvents, runMm, type LiveLevel, type MmFilter, type MmTrade } from "./mm-robot.ts";
import { px } from "./price-alerts.ts";
import type { SwingCandle } from "./swing-entries.ts";

/**
 * ROBOT MM signals: the only signals the app sends.
 *
 * A signal exists only where a wide study (12 coins, chosen on 60% of the
 * history, validated on the other 40% and on at least half the coins) approved
 * a variant for that timeframe. The browser scans those coins with that variant
 * and, when a trade opens on the last closed candle, the server relays it to
 * Telegram once.
 */

export const MM_WIDE_KEY = "alt-radar-pro:mm-wide:v1";
export const MM_WIDE_TTL = 7 * 86_400_000;
export const ROBOT_FRAMES = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h"];

export type WideVariant = { name: string; filter: MmFilter; approved: boolean; inSample: LvStats; outSample: LvStats; breadth: { tested: number; positive: number } };
export type WideSummary = {
  timeframe: string;
  at: number;
  coins: number;
  events: number;
  best: WideVariant | null;
  variants: WideVariant[];
  perCoin: { symbol: string; trades: number; totalR: number }[];
};

/** A trade the robot opens on the last closed candle (or the one before, to survive a late scan). */
export function liveRobotTrade(candles: SwingCandle[], lives: LiveLevel[], filter: MmFilter): MmTrade | null {
  if (candles.length < 200) return null;
  const events = mmEvents(candles, lives, flushSeries(candles.map((c) => c.openTime), lives));
  const trades = runMm(candles, events, filter);
  const last = trades[trades.length - 1];
  return last && last.result === "ABIERTA" && last.event.index >= candles.length - 2 ? last : null;
}

export type RobotSignal = {
  symbol: string;
  timeframe: string;
  side: "LONG" | "SHORT";
  entry: number;
  stop: number;
  target: number;
  /** Open time of the candle that triggered it. */
  time: number;
  variant: string;
  validation: { trades: number; profitFactor: number | null; positive: number; tested: number };
};

/** What the browser sends is checked before anything goes to Telegram. */
export function validateRobotSignal(raw: unknown, now: number): RobotSignal | null {
  const x = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
  const symbol = typeof x.symbol === "string" && /^[A-Z0-9]{2,20}USDT$/.test(x.symbol) ? x.symbol : null;
  const timeframe = typeof x.timeframe === "string" && ROBOT_FRAMES.includes(x.timeframe) ? x.timeframe : null;
  const side = x.side === "LONG" || x.side === "SHORT" ? x.side : null;
  const [entry, stop, target, time] = [num(x.entry), num(x.stop), num(x.target), num(x.time)];
  const variant = typeof x.variant === "string" ? x.variant.slice(0, 120) : "";
  const v = (x.validation ?? {}) as Record<string, unknown>;
  if (!symbol || !timeframe || !side || ![entry, stop, target, time].every((n) => n > 0)) return null;
  // Stop on the losing side, target on the winning side.
  if (side === "LONG" ? !(stop < entry && target > entry) : !(stop > entry && target < entry)) return null;
  // A day old at most, and not from the future.
  if (time > now + 60_000 || now - time > 86_400_000) return null;
  return {
    symbol, timeframe, side, entry, stop, target, time, variant,
    validation: {
      trades: Math.max(0, Math.floor(num(v.trades) || 0)),
      profitFactor: Number.isFinite(num(v.profitFactor)) ? num(v.profitFactor) : null,
      positive: Math.max(0, Math.floor(num(v.positive) || 0)),
      tested: Math.max(0, Math.floor(num(v.tested) || 0)),
    },
  };
}

export const robotSignalKey = (s: RobotSignal) => `mm:${s.symbol}:${s.timeframe}:${s.time}:${s.side}`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pct = (a: number, b: number) => `${b >= a ? "+" : ""}${(((b - a) / a) * 100).toFixed(2).replace(".", ",")}%`;

export function robotSignalText(s: RobotSignal): string {
  const long = s.side === "LONG";
  const r = Math.abs(s.target - s.entry) / Math.abs(s.entry - s.stop);
  const pf = s.validation.profitFactor === null ? "—" : s.validation.profitFactor === Infinity ? "∞" : s.validation.profitFactor.toFixed(2).replace(".", ",");
  return [
    `🤖 <b>ROBOT MM · ${esc(s.symbol.replace(/USDT$/, ""))} · ${long ? "🟢 LONG" : "🔴 SHORT"}</b> · ${esc(s.timeframe)}`,
    `Barrió ${long ? "un mínimo" : "un máximo"} y volvió adentro; objetivo en la liquidez del otro lado.`,
    `Entrada ${px(s.entry)}`,
    `🛑 SL ${px(s.stop)} (${pct(s.entry, s.stop)})`,
    `🎯 TP ${px(s.target)} (${pct(s.entry, s.target)} · ${r.toFixed(1).replace(".", ",")}R)`,
    `Variante: ${esc(s.variant)} · validación PF ${pf} en ${s.validation.trades} operaciones, gana en ${s.validation.positive} de ${s.validation.tested} monedas.`,
    "<i>Del robot en papel, no es una orden. No es asesoramiento financiero.</i>",
  ].join("\n");
}
