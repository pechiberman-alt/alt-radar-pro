import type { SwingCandle } from "./swing-entries.ts";

/**
 * Trendlines and breakouts, found mechanically.
 *
 * TRENDLINES
 * A resistance line joins two swing highs and descends; a support line joins
 * two swing lows and ascends (flat lines are levels, not trendlines). A pair
 * is a line only if the price respected it between the two anchors: no close
 * beyond it, and no wick more than half an ATR past it. More swing points
 * resting on the line (touches) make it stronger.
 *
 * BREAKS
 * A line breaks at the first candle that CLOSES beyond it by at least a tenth
 * of an ATR. A wick through the line is not a break. A line that was already
 * broken before its second anchor could be known is discarded: it could not
 * have been called in real time.
 *
 * RANGE BREAKOUTS
 * After a tight consolidation (the last 20 candles inside 6 ATR), the first
 * close beyond the range's high or low.
 *
 * NO LOOKAHEAD
 * A swing point is only known n candles after it prints. A break at candle k
 * uses only pivots confirmed before k, and only candles up to k, so the break
 * list of a series is the same however many candles come after. The one field
 * that looks forward by definition is `outcome` (did it hold for three
 * candles), and it says RECIÉN until those candles exist.
 *
 * Volume confirmation is reported, not required: a break is "confirmed" when
 * its candle's volume is at least 1,3× the average of the 20 before it.
 */

export type Pivot = { i: number; price: number; kind: "high" | "low"; confirmedAt: number };
export type LineSide = "RESISTENCIA" | "SOPORTE";

export type Trendline = {
  side: LineSide;
  a: number;
  b: number;
  priceA: number;
  priceB: number;
  /** Price change per candle. */
  slope: number;
  /** Swing points resting on the line, anchors included, as known at the time. */
  touches: number;
  score: number;
};

export type Outcome = "SOSTENIDA" | "FALLIDA" | "RECIÉN";

export type TrendBreak = {
  i: number;
  time: number;
  direction: "ALCISTA" | "BAJISTA";
  line: Trendline;
  linePrice: number;
  close: number;
  /** Close beyond the line, in ATR. */
  strength: number;
  volumeMultiple: number | null;
  confirmed: boolean;
  outcome: Outcome;
};

export type RangeBreak = {
  i: number;
  time: number;
  direction: "ALCISTA" | "BAJISTA";
  level: number;
  close: number;
  strength: number;
  volumeMultiple: number | null;
  confirmed: boolean;
  outcome: Outcome;
};

export type TrendAnalysis = { lines: Trendline[]; breaks: TrendBreak[]; ranges: RangeBreak[]; pivots: Pivot[] };
export type TrendOptions = { pivotN?: number; rangeN?: number; maxAge?: number };

export const MIN_SPAN = 5;
const BREAK_ATR = 0.1;
const WICK_ATR = 0.5;
const TOUCH_ATR = 0.35;
const FLAT_ATR = 0.5;
const VOLUME_CONFIRM = 1.3;
const HOLD_CANDLES = 3;
const RANGE_MAX_ATR = 6;

export const lineAt = (l: Pick<Trendline, "priceA" | "a" | "slope">, i: number) => l.priceA + l.slope * (i - l.a);

/** Wilder ATR; the first candles use the average of the true ranges so far. */
export function atrSeries(c: SwingCandle[], period = 14): number[] {
  const out: number[] = [];
  let atr = 0;
  for (let i = 0; i < c.length; i += 1) {
    const tr = i === 0 ? c[i].high - c[i].low : Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
    atr = i < period ? (atr * i + tr) / (i + 1) : (atr * (period - 1) + tr) / period;
    out.push(atr);
  }
  return out;
}

/** Swing highs and lows with n candles on each side. Equal neighbours: the first one counts. */
export function findPivots(c: SwingCandle[], n: number): Pivot[] {
  const out: Pivot[] = [];
  for (let i = n; i < c.length - n; i += 1) {
    let high = true;
    let low = true;
    for (let k = 1; k <= n; k += 1) {
      if (!(c[i].high > c[i - k].high) || !(c[i].high >= c[i + k].high)) high = false;
      if (!(c[i].low < c[i - k].low) || !(c[i].low <= c[i + k].low)) low = false;
    }
    if (high) out.push({ i, price: c[i].high, kind: "high", confirmedAt: i + n });
    if (low) out.push({ i, price: c[i].low, kind: "low", confirmedAt: i + n });
  }
  return out;
}

type Candidate = { side: LineSide; a: Pivot; b: Pivot; slope: number; atrB: number; end: number | null };

function candidates(c: SwingCandle[], atr: number[], pivots: Pivot[], n: number, side: LineSide, minIndex: number): Candidate[] {
  const kind = side === "RESISTENCIA" ? "high" : "low";
  const sign = side === "RESISTENCIA" ? 1 : -1;
  const pts = pivots.filter((p) => p.kind === kind && p.i >= minIndex);
  const out: Candidate[] = [];
  for (let x = 0; x < pts.length; x += 1) {
    for (let y = x + 1; y < pts.length; y += 1) {
      const a = pts[x];
      const b = pts[y];
      if (b.i - a.i < MIN_SPAN) continue;
      const slope = (b.price - a.price) / (b.i - a.i);
      if (side === "RESISTENCIA" ? slope >= 0 : slope <= 0) continue;
      const atrB = atr[b.i];
      if (!(atrB > 0) || Math.abs(b.price - a.price) < FLAT_ATR * atrB) continue;
      const line = (k: number) => a.price + slope * (k - a.i);
      // Respected between the anchors.
      let ok = true;
      for (let k = a.i + 1; k < b.i; k += 1) {
        const closeBeyond = sign * (c[k].close - line(k));
        const wickBeyond = sign * ((side === "RESISTENCIA" ? c[k].high : c[k].low) - line(k));
        if (closeBeyond > BREAK_ATR * atrB || wickBeyond > WICK_ATR * atrB) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      // First close beyond the line after the second anchor.
      let end: number | null = null;
      for (let k = b.i + 1; k < c.length; k += 1) {
        if (sign * (c[k].close - line(k)) > BREAK_ATR * atrB) {
          end = k;
          break;
        }
      }
      // Broken before the line could be known: not a line anyone could have drawn.
      if (end !== null && end <= b.confirmedAt) continue;
      out.push({ side, a, b, slope, atrB, end });
    }
  }
  return out;
}

function lineOf(cand: Candidate, pivots: Pivot[], knownBy: number): Trendline {
  const kind = cand.side === "RESISTENCIA" ? "high" : "low";
  const l = { priceA: cand.a.price, a: cand.a.i, slope: cand.slope };
  let touches = 0;
  for (const p of pivots) {
    if (p.kind !== kind || p.i < cand.a.i || p.confirmedAt > knownBy) continue;
    if (p.i === cand.a.i || p.i === cand.b.i || Math.abs(p.price - lineAt(l, p.i)) <= TOUCH_ATR * cand.atrB) touches += 1;
  }
  const span = cand.b.i - cand.a.i;
  const recent = knownBy - cand.b.i <= 60 ? 1 : 0;
  return {
    side: cand.side, a: cand.a.i, b: cand.b.i, priceA: cand.a.price, priceB: cand.b.price, slope: cand.slope,
    touches, score: touches * 3 + Math.min(span, 120) / 30 + recent,
  };
}

function volumeMultiple(c: SwingCandle[], k: number): number | null {
  if (k < 10) return null;
  const from = Math.max(0, k - 20);
  let sum = 0;
  for (let j = from; j < k; j += 1) sum += c[j].volume;
  const mean = sum / (k - from);
  return mean > 0 && Number.isFinite(c[k].volume) ? c[k].volume / mean : null;
}

function outcomeOf(c: SwingCandle[], k: number, beyondAt: (j: number) => number): Outcome {
  for (let j = k + 1; j <= Math.min(k + HOLD_CANDLES, c.length - 1); j += 1) if (beyondAt(j) <= 0) return "FALLIDA";
  return k + HOLD_CANDLES > c.length - 1 ? "RECIÉN" : "SOSTENIDA";
}

export function analyzeTrend(c: SwingCandle[], options: TrendOptions = {}): TrendAnalysis {
  const n = options.pivotN ?? 3;
  const rangeN = options.rangeN ?? 20;
  const empty: TrendAnalysis = { lines: [], breaks: [], ranges: [], pivots: [] };
  if (c.length < Math.max(30, rangeN + 5, 2 * n + MIN_SPAN + 2)) return empty;
  const clean = c.every((x) => Number.isFinite(x.high) && Number.isFinite(x.low) && Number.isFinite(x.close) && x.high >= x.low);
  if (!clean) return empty;
  const atr = atrSeries(c);
  const pivots = findPivots(c, n);
  const minIndex = Math.max(0, c.length - (options.maxAge ?? 400));
  const last = c.length - 1;

  const lines: Trendline[] = [];
  const breaks: TrendBreak[] = [];
  for (const side of ["RESISTENCIA", "SOPORTE"] as LineSide[]) {
    const sign = side === "RESISTENCIA" ? 1 : -1;
    const all = candidates(c, atr, pivots, n, side, minIndex);

    // Breaks: the best line each candle broke, judged with what was known then.
    const byCandle = new Map<number, Trendline>();
    for (const cand of all) {
      if (cand.end === null) continue;
      const line = lineOf(cand, pivots, cand.end - 1);
      const best = byCandle.get(cand.end);
      if (!best || line.score > best.score) byCandle.set(cand.end, line);
    }
    for (const [k, line] of byCandle) {
      const at = lineAt(line, k);
      const beyondAt = (j: number) => sign * (c[j].close - lineAt(line, j));
      const mult = volumeMultiple(c, k);
      breaks.push({
        i: k, time: c[k].openTime, direction: side === "RESISTENCIA" ? "ALCISTA" : "BAJISTA", line, linePrice: at, close: c[k].close,
        strength: (sign * (c[k].close - at)) / atr[k], volumeMultiple: mult, confirmed: mult !== null && mult >= VOLUME_CONFIRM,
        outcome: outcomeOf(c, k, beyondAt),
      });
    }

    // Lines still standing at the last candle: the strongest two that sit near price.
    const standing = all
      .filter((cand) => cand.end === null)
      .map((cand) => lineOf(cand, pivots, last))
      .filter((l) => Math.abs(c[last].close - lineAt(l, last)) <= 10 * atr[last])
      .sort((x, y) => y.score - x.score || y.b - x.b);
    const kept: Trendline[] = [];
    for (const l of standing) {
      const dup = kept.some((k) => Math.abs(lineAt(k, last) - lineAt(l, last)) < 0.3 * atr[last] && Math.sign(k.slope) === Math.sign(l.slope));
      if (!dup) kept.push(l);
      if (kept.length === 2) break;
    }
    lines.push(...kept);
  }

  const ranges: RangeBreak[] = [];
  const lastRange: Record<string, number> = { ALCISTA: -Infinity, BAJISTA: -Infinity };
  for (let k = rangeN; k < c.length; k += 1) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = k - rangeN; j < k; j += 1) {
      hi = Math.max(hi, c[j].high);
      lo = Math.min(lo, c[j].low);
    }
    const a = atr[k - 1];
    if (!(a > 0) || (hi - lo) / a > RANGE_MAX_ATR) continue;
    const dir = c[k].close > hi + BREAK_ATR * a ? "ALCISTA" : c[k].close < lo - BREAK_ATR * a ? "BAJISTA" : null;
    if (!dir || k - lastRange[dir] < rangeN / 2) continue;
    lastRange[dir] = k;
    const level = dir === "ALCISTA" ? hi : lo;
    const sign = dir === "ALCISTA" ? 1 : -1;
    const mult = volumeMultiple(c, k);
    ranges.push({
      i: k, time: c[k].openTime, direction: dir, level, close: c[k].close, strength: (sign * (c[k].close - level)) / a,
      volumeMultiple: mult, confirmed: mult !== null && mult >= VOLUME_CONFIRM, outcome: outcomeOf(c, k, (j) => sign * (c[j].close - level)),
    });
  }

  return { lines, breaks: breaks.sort((x, y) => x.i - y.i), ranges, pivots };
}

/** The most recent break of either kind, for a one-line summary. */
export function latestBreak(t: TrendAnalysis): { i: number; direction: "ALCISTA" | "BAJISTA"; kind: "LÍNEA" | "RANGO"; volumeMultiple: number | null; confirmed: boolean } | null {
  const all = [
    ...t.breaks.map((b) => ({ i: b.i, direction: b.direction, kind: "LÍNEA" as const, volumeMultiple: b.volumeMultiple, confirmed: b.confirmed })),
    ...t.ranges.map((r) => ({ i: r.i, direction: r.direction, kind: "RANGO" as const, volumeMultiple: r.volumeMultiple, confirmed: r.confirmed })),
  ];
  return all.sort((x, y) => y.i - x.i)[0] ?? null;
}
