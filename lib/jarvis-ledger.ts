import { lvStats, type LvStats } from "./liq-vol-signals.ts";
import type { MagnetEvent, MagnetPair } from "./magnet-watch.ts";
import type { PreBreak } from "./pre-breakout.ts";
import type { SwingCandle } from "./swing-entries.ts";

/**
 * JARVIS's own track record. Every alert JARVIS gives with a direction becomes
 * a signal with a fixed plan the moment it is given — entry at that candle's
 * close, a stop and a target — and is resolved later with the candles that
 * followed: worst case first (a candle touching stop and target counts as the
 * stop), fees on both sides, closed at market after `HORIZON` candles. Nothing
 * is edited after the fact, so win rate, profit factor and expectancy are what
 * following JARVIS literally would have done.
 *
 * Two sources:
 *   ROMPE  "a punto de romper" with a direction: trade the break that way.
 *          Stop under the lowest low of the last 10 candles (above the highest
 *          high for shorts), between 1 and 2,5 ATR; target 2R.
 *   IMÁN   a liquidation magnet swept and closed back (sweep and reverse):
 *          trade the reversal. Stop beyond the wick; target the magnet on the
 *          other side if it sits 1–4R away, else 2R.
 * Alerts without a direction ("sin dirección", "cerca de un imán") are not
 * signals and are not counted.
 */

export const HORIZON = 48;
export const FEE_PCT = 0.05;

export type JarvisSource = "ROMPE" | "IMÁN";
export type JarvisSignal = {
  id: string;
  source: JarvisSource;
  symbol: string;
  timeframe: string;
  side: "LONG" | "SHORT";
  /** Open time of the candle whose close is the entry. */
  time: number;
  entry: number;
  stop: number;
  target: number;
  note: string;
  result: "ABIERTA" | "OBJETIVO" | "STOP" | "TIEMPO";
  /** Net of fees, in R; null while open. */
  r: number | null;
  closedAt: number | null;
};

function atr(c: SwingCandle[], n = 14): number {
  let s = 0;
  let k = 0;
  for (let i = Math.max(1, c.length - n); i < c.length; i += 1) {
    s += Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
    k += 1;
  }
  return k ? s / k : 0;
}

const base = (source: JarvisSource, symbol: string, timeframe: string, side: "LONG" | "SHORT", c: SwingCandle) => ({
  id: `${source}:${symbol}:${timeframe}:${c.openTime}:${side}`,
  source, symbol, timeframe, side, time: c.openTime, entry: c.close,
  result: "ABIERTA" as const, r: null, closedAt: null,
});

/** A breakout signal from a pre-break reading on the last closed candle. */
export function breakoutSignal(symbol: string, timeframe: string, candles: SwingCandle[], reading: PreBreak): JarvisSignal | null {
  if (reading.state !== "A PUNTO" || reading.side === "SIN DIRECCIÓN" || candles.length < 20) return null;
  const a = atr(candles);
  if (!(a > 0)) return null;
  const last = candles[candles.length - 1];
  const long = reading.side === "ALCISTA";
  const recent = candles.slice(-10);
  const swing = long ? Math.min(...recent.map((c) => c.low)) - 0.2 * a : Math.max(...recent.map((c) => c.high)) + 0.2 * a;
  const dist = Math.min(2.5 * a, Math.max(a, Math.abs(last.close - swing)));
  const stop = long ? last.close - dist : last.close + dist;
  return {
    ...base("ROMPE", symbol, timeframe, long ? "LONG" : "SHORT", last),
    stop, target: long ? last.close + 2 * dist : last.close - 2 * dist,
    note: `a punto de romper · presión ${reading.score}/100${reading.level ? ` · nivel ${reading.level}` : ""}`,
  };
}

/** A reversal signal from a swept-and-rejected magnet on the last closed candle. */
export function magnetSignal(symbol: string, timeframe: string, candles: SwingCandle[], e: MagnetEvent, after: MagnetPair | null): JarvisSignal | null {
  if (e.kind !== "BARRIDA" || !e.closedBack || candles.length < 20) return null;
  const a = atr(candles);
  const last = candles[candles.length - 1];
  if (!(a > 0) || last.openTime !== e.candleOpenTime) return null;
  // Shorts swept above and rejected: price goes back down.
  const long = e.magnet.side === "LARGOS";
  const stop = long ? last.low - 0.1 * a : last.high + 0.1 * a;
  const risk = Math.abs(last.close - stop);
  if (!(risk > 0) || risk > 4 * a) return null;
  const other = long ? after?.above : after?.below;
  const rr = other ? Math.abs(other.price - last.close) / risk : 0;
  const target = other && rr >= 1 && rr <= 4 ? other.price : long ? last.close + 2 * risk : last.close - 2 * risk;
  return {
    ...base("IMÁN", symbol, timeframe, long ? "LONG" : "SHORT", last),
    stop, target,
    note: `barrió la zona de ${e.magnet.side.toLowerCase()} en ${e.magnet.price} y volvió`,
  };
}

/** Resolves an open signal with the candles after its entry candle. */
export function resolveSignal(s: JarvisSignal, candles: SwingCandle[], frameMs: number): JarvisSignal {
  if (s.result !== "ABIERTA") return s;
  const after = candles.filter((c) => c.openTime > s.time).sort((a, b) => a.openTime - b.openTime);
  const risk = Math.abs(s.entry - s.stop);
  if (!(risk > 0)) return s;
  const fee = ((FEE_PCT / 100) * 2 * s.entry) / risk;
  const long = s.side === "LONG";
  for (let i = 0; i < after.length && i < HORIZON; i += 1) {
    const c = after[i];
    if (long ? c.low <= s.stop : c.high >= s.stop) return { ...s, result: "STOP", r: -1 - fee, closedAt: c.openTime + frameMs };
    if (long ? c.high >= s.target : c.low <= s.target) return { ...s, result: "OBJETIVO", r: Math.abs(s.target - s.entry) / risk - fee, closedAt: c.openTime + frameMs };
    if (i === HORIZON - 1) {
      return { ...s, result: "TIEMPO", r: (long ? c.close - s.entry : s.entry - c.close) / risk - fee, closedAt: c.openTime + frameMs };
    }
  }
  return s;
}

/** Adds signals not already recorded (by id), newest last, keeping at most `max`. */
export function addSignals(ledger: JarvisSignal[], fresh: JarvisSignal[], max = 400): JarvisSignal[] {
  const have = new Set(ledger.map((s) => s.id));
  const merged = [...ledger, ...fresh.filter((s) => !have.has(s.id))].sort((a, b) => a.time - b.time);
  return merged.slice(-max);
}

export type LedgerStats = LvStats & { bySource: Record<JarvisSource, LvStats> };

export function ledgerStats(ledger: JarvisSignal[]): LedgerStats {
  return {
    ...lvStats(ledger),
    bySource: { ROMPE: lvStats(ledger.filter((s) => s.source === "ROMPE")), "IMÁN": lvStats(ledger.filter((s) => s.source === "IMÁN")) },
  };
}

const pf = (v: number | null) => (v === null ? "sin dato" : v === Infinity ? "infinito" : v.toFixed(2).replace(".", ","));

/** What JARVIS says when asked how its signals are doing. */
export function statsSpeech(st: LedgerStats): string {
  if (st.resolved === 0) {
    return st.open
      ? `Tengo ${st.open} ${st.open === 1 ? "señal abierta" : "señales abiertas"} y ninguna cerrada todavía: no hay resultados para medir.`
      : "Todavía no di ninguna señal con dirección. Activá la vigilancia o preguntame qué está por romper.";
  }
  const wr = Math.round((st.winRate ?? 0) * 100);
  const parts = [
    `Llevo ${st.resolved} ${st.resolved === 1 ? "señal cerrada" : "señales cerradas"}: ${st.wins} ganadoras y ${st.losses} perdedoras, win rate ${wr} por ciento, profit factor ${pf(st.profitFactor)}, total ${st.totalR >= 0 ? "más" : "menos"} ${Math.abs(st.totalR).toFixed(1).replace(".", ",")} R.`,
  ];
  for (const src of ["ROMPE", "IMÁN"] as const) {
    const b = st.bySource[src];
    if (b.resolved) parts.push(`${src === "ROMPE" ? "Rupturas" : "Barridas de imán"}: ${b.resolved}, profit factor ${pf(b.profitFactor)}.`);
  }
  if (st.open) parts.push(`${st.open} ${st.open === 1 ? "sigue abierta" : "siguen abiertas"}.`);
  parts.push(st.confidence === "MUESTRA RAZONABLE" ? "Es una muestra razonable." : "Es una muestra mínima: todavía no alcanza para confiar.");
  return parts.join(" ");
}

export function ledgerCsv(ledger: JarvisSignal[]): string {
  const head = "fecha;fuente;moneda;marco;lado;entrada;stop;objetivo;resultado;R;nota";
  const rows = ledger.map((s) =>
    [new Date(s.time).toISOString(), s.source, s.symbol, s.timeframe, s.side, s.entry, s.stop, s.target, s.result, s.r === null ? "" : s.r.toFixed(3).replace(".", ","), s.note.replace(/;/g, ",")]
      .map((v) => (typeof v === "number" ? String(v).replace(".", ",") : String(v)))
      .join(";"),
  );
  return `\uFEFF${[head, ...rows].join("\r\n")}\r\n`;
}
