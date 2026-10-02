import { findPivots, type SwingCandle } from "./swing-entries.ts";

/**
 * Key support and resistance: prices where the market turned several times.
 *
 * Every confirmed swing high and low is a turn. Turns within half an ATR of
 * each other are the same level (price never respects a line to the cent), so
 * they are grouped and counted: one turn is an event, two is a level, four is
 * a level everyone is watching. A level with both highs and lows in it has
 * changed role — old resistance acting as support, or the reverse — which is
 * the classic sign that a level matters.
 *
 * Above the last close it is resistance; below, support. Only the closest
 * meaningful levels on each side are returned, because a beginner needs the
 * next floor and the next ceiling, not every line in the chart.
 *
 * A level is a place to watch, not a promise that price will turn there.
 */

export type KeyLevel = {
  price: number;
  low: number;
  high: number;
  kind: "SOPORTE" | "RESISTENCIA";
  touches: number;
  /** Index of the most recent turn at this level. */
  lastTouch: number;
  strength: "FUERTE" | "MEDIA" | "DÉBIL";
  /** Turned both from above and from below: changed role at least once. */
  flipped: boolean;
  /** Distance from the last close, in percent (positive above). */
  distancePct: number;
};

export type KeyLevelOptions = { span?: number; tolerance?: number; perSide?: number; minTouches?: number };

function atr(c: SwingCandle[], n = 14): number {
  if (c.length < 2) return 0;
  let sum = 0;
  let count = 0;
  for (let k = Math.max(1, c.length - n); k < c.length; k += 1) {
    sum += Math.max(c[k].high - c[k].low, Math.abs(c[k].high - c[k - 1].close), Math.abs(c[k].low - c[k - 1].close));
    count += 1;
  }
  return count ? sum / count : 0;
}

export function keyLevels(candles: SwingCandle[], options: KeyLevelOptions = {}): KeyLevel[] {
  const span = options.span ?? 3;
  const tolMult = options.tolerance ?? 0.5;
  const perSide = options.perSide ?? 3;
  const minTouches = options.minTouches ?? 2;
  if (candles.length < span * 2 + 5) return [];
  const a = atr(candles);
  if (!(a > 0)) return [];
  const tol = a * tolMult;
  const { highs, lows } = findPivots(candles, span);
  const turns = [...highs.map((p) => ({ ...p, from: "high" as const })), ...lows.map((p) => ({ ...p, from: "low" as const }))].sort((x, y) => x.price - y.price);

  // Group neighbouring turns: a turn joins the group if it is within tolerance of the group's average.
  const groups: (typeof turns)[] = [];
  for (const t of turns) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(t.price - g.reduce((s, x) => s + x.price, 0) / g.length) <= tol) g.push(t);
    else groups.push([t]);
  }

  const close = candles[candles.length - 1].close;
  const recentFrom = candles.length * 0.75;
  const levels: KeyLevel[] = [];
  const scoreOf = new Map<KeyLevel, number>();
  for (const g of groups) {
    if (g.length < minTouches) continue;
    const price = g.reduce((s, x) => s + x.price, 0) / g.length;
    const lastTouch = Math.max(...g.map((x) => x.index));
    const flipped = g.some((x) => x.from === "high") && g.some((x) => x.from === "low");
    const recent = lastTouch >= recentFrom;
    const strength: KeyLevel["strength"] = g.length >= 4 || (g.length >= 3 && (recent || flipped)) ? "FUERTE" : g.length >= 3 ? "MEDIA" : "DÉBIL";
    const half = Math.max(tol * 0.3, (Math.max(...g.map((x) => x.price)) - Math.min(...g.map((x) => x.price))) / 2);
    const level: KeyLevel = {
      price, low: price - half, high: price + half, kind: price > close ? "RESISTENCIA" : "SOPORTE", touches: g.length, lastTouch, strength, flipped,
      distancePct: ((price - close) / close) * 100,
    };
    levels.push(level);
    scoreOf.set(level, g.length + (recent ? 1 : 0) + (flipped ? 1 : 0));
  }
  const pick = (kind: KeyLevel["kind"]) =>
    levels
      .filter((l) => l.kind === kind)
      .sort((x, y) => (scoreOf.get(y) ?? 0) - (scoreOf.get(x) ?? 0) || Math.abs(x.distancePct) - Math.abs(y.distancePct))
      .slice(0, perSide)
      .sort((x, y) => Math.abs(x.distancePct) - Math.abs(y.distancePct));
  return [...pick("RESISTENCIA"), ...pick("SOPORTE")];
}
