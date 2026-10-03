import { keyLevels } from "./key-levels.ts";
import { readPressure } from "./pump-pressure.ts";
import type { SwingCandle } from "./swing-entries.ts";

/**
 * A PUNTO DE ROMPER: a coiled market pressing a level.
 *
 * Three things, each with its own reason to matter:
 *   PRESSURE   compression, quiet accumulation, time in range — the existing
 *              pressure model (lib/pump-pressure.ts). Volatility clusters: a
 *              market that has coiled tends to move hard. It says nothing
 *              about direction.
 *   LEVEL      price within an ATR of a support or resistance that turned it
 *              at least twice. That is where the move would start, and it is
 *              the only honest source of a likely direction here.
 *   STRUCTURE  rising lows into a ceiling (or falling highs onto a floor):
 *              buyers (or sellers) giving up less ground each time.
 *
 * The score is 0–100; "A PUNTO" from 70. Direction comes only from the level
 * and the structure; without them the reading says "sin dirección".
 *
 * MEASURED: replayPreBreakout walks the history with data up to each candle and
 * checks, after each "A PUNTO", whether price moved at least 2 ATR within the
 * next candles — next to how often that happens from any moment. If the two
 * rates are close, the alert is not telling you anything on that coin.
 */

export type PreBreakSide = "ALCISTA" | "BAJISTA" | "SIN DIRECCIÓN";
export type PreBreak = {
  score: number;
  state: "A PUNTO" | "ARMÁNDOSE" | "QUIETO";
  side: PreBreakSide;
  /** The level being pressed, if any. */
  level: number | null;
  touches: number;
  /** Distance to the level in ATRs (0 = on it). */
  distanceAtr: number | null;
  pressure: number;
  reasons: string[];
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

/** Lows of the last `n` candles in 3 thirds: rising if each third's low is above the previous one. */
function thirds(c: SwingCandle[], n: number, pick: (x: SwingCandle) => number, agg: (a: number[]) => number) {
  const w = c.slice(-n);
  const size = Math.floor(w.length / 3);
  return [0, 1, 2].map((i) => agg(w.slice(i * size, (i + 1) * size).map(pick)));
}

export function readPreBreak(candles: SwingCandle[], symbol = ""): PreBreak | null {
  if (candles.length < 80) return null;
  const p = readPressure({ symbol, candles });
  if (!p) return null;
  const a = atr(candles);
  if (!(a > 0)) return null;
  const close = candles[candles.length - 1].close;
  const reasons: string[] = [];
  let score = Math.round(p.pressure * 0.5);
  if (p.pressure >= 60) reasons.push("compresión fuerte");
  else if (p.pressure >= 40) reasons.push("compresión");

  // Levels within 1 ATR that turned price at least twice: the nearest ceiling and floor.
  const levels = keyLevels(candles, { perSide: 3, span: 3 });
  const within = levels.map((l) => ({ l, dist: Math.abs(l.price - close) / a })).filter((x) => x.dist <= 1 && x.l.touches >= 2);
  const nearest = (kind: string) => within.filter((x) => x.l.kind === kind).sort((x, y) => x.dist - y.dist)[0];
  const up = nearest("RESISTENCIA");
  const dn = nearest("SOPORTE");
  const lows = thirds(candles, 30, (x) => x.low, (v) => Math.min(...v));
  const highs = thirds(candles, 30, (x) => x.high, (v) => Math.max(...v));
  const risingLows = lows[0] < lows[1] && lows[1] < lows[2];
  const fallingHighs = highs[0] > highs[1] && highs[1] > highs[2];
  // In a tight range both a ceiling and a floor are within reach: structure
  // decides first, then a clearly more-tested level; otherwise no direction.
  let near = up && risingLows ? up : dn && fallingHighs ? dn : up && !dn ? up : dn && !up ? dn : undefined;
  if (!near && up && dn) near = up.l.touches >= dn.l.touches * 1.5 ? up : dn.l.touches >= up.l.touches * 1.5 ? dn : undefined;
  let side: PreBreakSide = "SIN DIRECCIÓN";
  if (near) {
    side = near.l.kind === "RESISTENCIA" ? "ALCISTA" : "BAJISTA";
    score += Math.round(25 * (1 - near.dist)) + Math.min(10, (near.l.touches - 2) * 4);
    reasons.push(`${side === "ALCISTA" ? "presionando resistencia" : "presionando soporte"} (${near.l.touches} toques)`);
    if (side === "ALCISTA" && risingLows) {
      score += 15;
      reasons.push("mínimos crecientes");
    }
    if (side === "BAJISTA" && fallingHighs) {
      score += 15;
      reasons.push("máximos decrecientes");
    }
  } else if (up && dn) {
    reasons.push("rango apretado entre techo y piso");
  }
  if (p.factors.quietAccumulation >= 1.3) reasons.push("volumen creciendo sin mover el precio");
  score = Math.max(0, Math.min(100, score));
  return {
    score,
    state: score >= 70 ? "A PUNTO" : score >= 50 ? "ARMÁNDOSE" : "QUIETO",
    side, level: near ? near.l.price : null, touches: near ? near.l.touches : 0, distanceAtr: near ? near.dist : null,
    pressure: p.pressure, reasons,
  };
}

export type PreBreakReplay = { alerts: number; moved: number; rate: number | null; baseRate: number | null; sameSide: number; confidence: "SIN MUESTRA" | "MUESTRA MÍNIMA" | "MUESTRA RAZONABLE" };

/** Walks the history; after each "A PUNTO", did price move 2 ATR within `horizon` candles? Compared with any moment. */
export function replayPreBreakout(candles: SwingCandle[], opts: { horizon?: number; step?: number; warmup?: number } = {}): PreBreakReplay {
  const horizon = opts.horizon ?? 24;
  const step = opts.step ?? 2;
  const warmup = opts.warmup ?? 120;
  let alerts = 0;
  let moved = 0;
  let sameSide = 0;
  let base = 0;
  let baseMoved = 0;
  let quietUntil = -1;
  const movedAfter = (t: number) => {
    const a = atr(candles.slice(0, t + 1));
    const c0 = candles[t].close;
    let up = 0;
    let down = 0;
    for (let k = t + 1; k <= Math.min(candles.length - 1, t + horizon); k += 1) {
      up = Math.max(up, candles[k].high - c0);
      down = Math.max(down, c0 - candles[k].low);
    }
    return { any: Math.max(up, down) >= 2 * a, up: up >= 2 * a && up >= down, down: down >= 2 * a && down > up };
  };
  for (let t = warmup; t < candles.length - horizon; t += step) {
    const m = movedAfter(t);
    base += 1;
    if (m.any) baseMoved += 1;
    if (t <= quietUntil) continue;
    const r = readPreBreak(candles.slice(0, t + 1));
    if (!r || r.state !== "A PUNTO") continue;
    alerts += 1;
    quietUntil = t + horizon; // one alert per coiling, not one per candle
    if (m.any) moved += 1;
    if ((r.side === "ALCISTA" && m.up) || (r.side === "BAJISTA" && m.down)) sameSide += 1;
  }
  return {
    alerts, moved, sameSide,
    rate: alerts ? moved / alerts : null,
    baseRate: base ? baseMoved / base : null,
    confidence: alerts === 0 ? "SIN MUESTRA" : alerts < 15 ? "MUESTRA MÍNIMA" : "MUESTRA RAZONABLE",
  };
}

export const preBreakKey = (symbol: string, tf: string, r: PreBreak) => `pre:${symbol}:${tf}:${r.side}:${r.level === null ? "x" : r.level.toPrecision(5)}`;

export type PreBreakAlert = { symbol: string; timeframe: string; side: PreBreakSide; score: number; level: number | null; touches: number; distanceAtr: number | null; price: number; reasons: string[] };
const FRAMES = ["5m", "15m", "30m", "1h", "2h", "4h", "1d"];

/** What the browser sends is checked before anything goes to Telegram. */
export function validatePreBreakAlert(raw: unknown): PreBreakAlert | null {
  const x = (raw ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
  const symbol = typeof x.symbol === "string" && /^[A-Z0-9]{2,20}USDT$/.test(x.symbol) ? x.symbol : null;
  const timeframe = typeof x.timeframe === "string" && FRAMES.includes(x.timeframe) ? x.timeframe : null;
  const side = x.side === "ALCISTA" || x.side === "BAJISTA" || x.side === "SIN DIRECCIÓN" ? x.side : null;
  const score = n(x.score);
  const price = n(x.price);
  if (!symbol || !timeframe || !side || !(score >= 70 && score <= 100) || !(price > 0)) return null;
  const level = x.level === null ? null : n(x.level) > 0 ? n(x.level) : null;
  const reasons = Array.isArray(x.reasons) ? x.reasons.filter((r): r is string => typeof r === "string").slice(0, 5).map((r) => r.slice(0, 60)) : [];
  const d = n(x.distanceAtr);
  return { symbol, timeframe, side, score: Math.round(score), level, touches: Math.max(0, Math.floor(n(x.touches) || 0)), distanceAtr: Number.isFinite(d) ? d : null, price, reasons };
}

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: v >= 100 ? 2 : v >= 1 ? 4 : 6 });

export function preBreakText(a: PreBreakAlert): string {
  const dir = a.side === "ALCISTA" ? "🟢 hacia arriba" : a.side === "BAJISTA" ? "🔴 hacia abajo" : "⚪ sin dirección clara";
  return [
    `⚡ <b>A PUNTO DE ROMPER · ${escHtml(a.symbol.replace(/USDT$/, ""))}</b> · ${a.timeframe}`,
    `Presión ${a.score}/100 · ${dir}`,
    a.level !== null ? `Presionando ${fmt(a.level)} (${a.touches} toques)${a.distanceAtr !== null ? ` · a ${a.distanceAtr.toFixed(1).replace(".", ",")} ATR` : ""} · precio ${fmt(a.price)}` : `Precio ${fmt(a.price)}`,
    a.reasons.length ? escHtml(a.reasons.join(" · ")) : "",
    "<i>Alerta de compresión: puede romper fuerte, pero la dirección no está garantizada. No es una orden ni asesoramiento financiero.</i>",
  ].filter(Boolean).join("\n");
}
