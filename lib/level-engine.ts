import { keyLevels } from "./key-levels.ts";
import type { SwingCandle } from "./swing-entries.ts";

/**
 * The level engine: one list of the levels that matter, ranked by how many
 * independent reasons agree on them — and measured.
 *
 * SOURCES (each a reason a price is watched)
 *   Structure     price turned there several times (this frame, and the larger
 *                 frames, which count more: more traders saw them)
 *   Day / week    previous day's and week's high and low, today's and this
 *                 week's open — the references every desk marks
 *   Volume        the volume profile of the loaded range: POC (most traded
 *                 price), VAH and VAL (edges of the 70% value area)
 *   Round         psychological numbers near price
 *   Liquidity     whatever the caller adds: liquidation magnets, equal
 *                 highs/lows of the larger frames
 *
 * Reasons within a third of an ATR are the same level. A level's score adds
 * one weight per distinct kind of reason (two structure hits on the same frame
 * count once), and the stars come from the score.
 *
 * MEASUREMENT
 * Stars are a claim; `replayLevels` checks it on this coin's own history.
 * Every few candles the engine is rebuilt with only the data available then
 * (larger frames and days included only once closed), and each nearby level's
 * first later touch is followed: did price turn away an ATR before closing
 * clearly through it? Results by stars: if three-star levels don't hold more
 * often than one-star ones here, the stars are not telling you anything here.
 */

export type LevelSource = { kind: string; label: string; price: number; weight: number };
export type Level = {
  price: number;
  low: number;
  high: number;
  kind: "SOPORTE" | "RESISTENCIA";
  score: number;
  stars: 1 | 2 | 3;
  sources: LevelSource[];
  distancePct: number;
};

export function atrOf(c: SwingCandle[], n = 14): number {
  if (c.length < 2) return 0;
  let sum = 0;
  let count = 0;
  for (let k = Math.max(1, c.length - n); k < c.length; k += 1) {
    sum += Math.max(c[k].high - c[k].low, Math.abs(c[k].high - c[k - 1].close), Math.abs(c[k].low - c[k - 1].close));
    count += 1;
  }
  return count ? sum / count : 0;
}

/** Structure: clusters of turns on a frame. Larger frames pass a larger weight. */
export function structureSources(candles: SwingCandle[], frame: string, weight: number, span = 3): LevelSource[] {
  return keyLevels(candles, { perSide: 12, span }).map((l) => ({
    kind: `S/R ${frame}`,
    label: `S/R ${frame} (${l.touches} toques${l.flipped ? ", cambió de rol" : ""})`,
    price: l.price,
    weight: weight * (1 + 0.25 * Math.min(4, l.touches - 2)) + (l.flipped ? 0.5 : 0),
  }));
}

const DAY = 86_400_000;
/** Monday 00:00 UTC of the week containing t (Binance's weekly candles start there). */
const weekStart = (t: number) => {
  const d = new Date(t);
  const monday = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - monday * DAY;
};

/**
 * Previous day and week high/low, today's and this week's open, from daily
 * candles. `now` decides which day is "today": only days closed before it
 * count as previous.
 */
export function referenceSources(daily: SwingCandle[], now: number): LevelSource[] {
  const days = daily.filter((d) => d.openTime <= now).sort((a, b) => a.openTime - b.openTime);
  if (days.length < 2) return [];
  const today = days[days.length - 1];
  const todayStarted = today.openTime <= now && now < today.openTime + DAY;
  const closed = todayStarted ? days.slice(0, -1) : days;
  const out: LevelSource[] = [];
  const prev = closed[closed.length - 1];
  if (prev) {
    out.push({ kind: "PDH", label: "máximo de ayer", price: prev.high, weight: 2 });
    out.push({ kind: "PDL", label: "mínimo de ayer", price: prev.low, weight: 2 });
  }
  if (todayStarted) out.push({ kind: "DO", label: "apertura de hoy", price: today.open, weight: 1.25 });
  const thisWeek = weekStart(now);
  const lastWeek = closed.filter((d) => d.openTime >= thisWeek - 7 * DAY && d.openTime < thisWeek);
  if (lastWeek.length >= 5) {
    out.push({ kind: "PWH", label: "máximo de la semana pasada", price: Math.max(...lastWeek.map((d) => d.high)), weight: 3 });
    out.push({ kind: "PWL", label: "mínimo de la semana pasada", price: Math.min(...lastWeek.map((d) => d.low)), weight: 3 });
  }
  const monday = days.find((d) => d.openTime === thisWeek);
  if (monday) out.push({ kind: "WO", label: "apertura de la semana", price: monday.open, weight: 1.5 });
  return out;
}

/** Volume profile of the candles: each candle's volume spread evenly over its range. */
export function volumeProfile(candles: SwingCandle[], bins = 80): { poc: number; vah: number; val: number } | null {
  if (candles.length < 20) return null;
  const lo = Math.min(...candles.map((c) => c.low));
  const hi = Math.max(...candles.map((c) => c.high));
  if (!(hi > lo)) return null;
  const size = (hi - lo) / bins;
  const vol = new Array<number>(bins).fill(0);
  for (const c of candles) {
    const a = Math.max(0, Math.min(bins - 1, Math.floor((c.low - lo) / size)));
    const b = Math.max(0, Math.min(bins - 1, Math.floor((c.high - lo) / size)));
    for (let k = a; k <= b; k += 1) vol[k] += c.volume / (b - a + 1);
  }
  const total = vol.reduce((s, v) => s + v, 0);
  if (!(total > 0)) return null;
  // Ties are common (volume is spread evenly over each candle's range): take the
  // middle of the tied bins, not the lowest one.
  const max = Math.max(...vol);
  const tied = vol.map((v, k) => (v >= max * (1 - 1e-9) ? k : -1)).filter((k) => k >= 0);
  const poc = tied[Math.floor(tied.length / 2)];
  let down = poc;
  let up = poc;
  let inside = vol[poc];
  while (inside < total * 0.7 && (down > 0 || up < bins - 1)) {
    const below = down > 0 ? vol[down - 1] : -1;
    const above = up < bins - 1 ? vol[up + 1] : -1;
    if (above >= below) inside += vol[++up];
    else inside += vol[--down];
  }
  return { poc: lo + (poc + 0.5) * size, vah: lo + (up + 1) * size, val: lo + down * size };
}

export function profileSources(candles: SwingCandle[]): LevelSource[] {
  const p = volumeProfile(candles);
  if (!p) return [];
  return [
    { kind: "POC", label: "POC (precio más operado)", price: p.poc, weight: 2 },
    { kind: "VAH", label: "VAH (techo del área de valor)", price: p.vah, weight: 1.25 },
    { kind: "VAL", label: "VAL (piso del área de valor)", price: p.val, weight: 1.25 },
  ];
}

/** Psychological round numbers within ±6% of price. */
export function roundSources(price: number): LevelSource[] {
  if (!(price > 0)) return [];
  const m = 10 ** Math.floor(Math.log10(price));
  const out: LevelSource[] = [];
  const seen = new Set<number>();
  for (const [step, weight] of [[m, 1.5], [m / 2, 1], [m / 10, 0.5]] as const) {
    const from = Math.ceil((price * 0.94) / step);
    const to = Math.floor((price * 1.06) / step);
    for (let k = from; k <= to; k += 1) {
      const v = Number((k * step).toPrecision(12));
      if (seen.has(v)) continue;
      seen.add(v);
      out.push({ kind: "REDONDO", label: "número redondo", price: v, weight });
    }
  }
  return out;
}

const starsOf = (score: number): 1 | 2 | 3 => (score >= 6 ? 3 : score >= 3.5 ? 2 : 1);

/** Groups the reasons into levels around `price`; `perSide` strongest within `range`, nearest first. */
export function buildLevels(sources: LevelSource[], price: number, atr: number, opts: { perSide?: number; range?: number; tolAtr?: number } = {}): Level[] {
  const perSide = opts.perSide ?? 4;
  const range = opts.range ?? 0.08;
  const tol = Math.max(atr * (opts.tolAtr ?? 0.35), price * 0.0005);
  const near = sources.filter((s) => s.price > 0 && Math.abs(s.price / price - 1) <= range).sort((a, b) => a.price - b.price);
  const groups: LevelSource[][] = [];
  for (const s of near) {
    const g = groups[groups.length - 1];
    if (g && s.price - g[0].price <= tol * 2 && Math.abs(s.price - g.reduce((a, x) => a + x.price * x.weight, 0) / g.reduce((a, x) => a + x.weight, 0)) <= tol) g.push(s);
    else groups.push([s]);
  }
  const levels: Level[] = groups.map((g) => {
    const best = new Map<string, LevelSource>();
    for (const s of g) if (!best.has(s.kind) || best.get(s.kind)!.weight < s.weight) best.set(s.kind, s);
    const distinct = [...best.values()].sort((a, b) => b.weight - a.weight);
    const score = distinct.reduce((a, s) => a + s.weight, 0);
    const center = g.reduce((a, x) => a + x.price * x.weight, 0) / g.reduce((a, x) => a + x.weight, 0);
    return {
      price: center, low: Math.min(...g.map((x) => x.price), center - tol / 2), high: Math.max(...g.map((x) => x.price), center + tol / 2),
      kind: center > price ? "RESISTENCIA" : "SOPORTE", score, stars: starsOf(score), sources: distinct, distancePct: (center / price - 1) * 100,
    };
  });
  // A lone round number is not a level; it only adds weight to a real one.
  const meaningful = levels.filter((l) => !(l.sources.length === 1 && l.sources[0].kind === "REDONDO"));
  const pick = (kind: Level["kind"]) =>
    meaningful
      .filter((l) => l.kind === kind)
      // Equal scores: the nearer level matters more to whoever is trading now.
      .sort((a, b) => b.score - a.score || Math.abs(a.distancePct) - Math.abs(b.distancePct))
      .slice(0, perSide).sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct));
  return [...pick("RESISTENCIA"), ...pick("SOPORTE")];
}

export type FrameData = { frame: string; candles: SwingCandle[]; frameMs: number; weight: number };

/** Every source the engine can compute from candles, as of time `now` (only candles closed by then). */
export function sourcesAt(input: { current: FrameData; higher: FrameData[]; daily: SwingCandle[] | null; now: number; span?: number }): LevelSource[] {
  const closedBy = (f: FrameData) => f.candles.filter((c) => c.openTime + f.frameMs <= input.now);
  const cur = closedBy(input.current);
  const last = cur[cur.length - 1];
  if (!last) return [];
  return [
    ...structureSources(cur, input.current.frame, input.current.weight, input.span ?? 3),
    ...input.higher.flatMap((f) => structureSources(closedBy(f), f.frame, f.weight, 3)),
    ...(input.daily ? referenceSources(input.daily, input.now) : []),
    ...profileSources(cur),
    ...roundSources(last.close),
  ];
}

export type ReplayBucket = { stars: 1 | 2 | 3; touched: number; held: number; broke: number; rate: number | null };

/**
 * Rebuilds the levels every `step` candles with only the data available then,
 * and follows each level's first touch within `horizon` candles.
 */
export function replayLevels(input: { current: FrameData; higher: FrameData[]; daily: SwingCandle[] | null; span?: number }, opts: { step?: number; warmup?: number; horizon?: number } = {}): ReplayBucket[] {
  const step = opts.step ?? 8;
  const warmup = opts.warmup ?? 120;
  const horizon = opts.horizon ?? 60;
  const c = input.current.candles;
  const buckets: ReplayBucket[] = [1, 2, 3].map((s) => ({ stars: s as 1 | 2 | 3, touched: 0, held: 0, broke: 0, rate: null }));
  const counted = new Set<string>();
  for (let t = warmup; t < c.length - 5; t += step) {
    const now = c[t].openTime + input.current.frameMs;
    const slice = c.slice(0, t + 1);
    const atr = atrOf(slice);
    if (!(atr > 0)) continue;
    const levels = buildLevels(
      sourcesAt({ current: { ...input.current, candles: slice }, higher: input.higher, daily: input.daily, now, span: input.span }),
      c[t].close, atr, { perSide: 4, range: 0.05 },
    );
    for (const l of levels) {
      const res = l.kind === "RESISTENCIA";
      for (let k = t + 1; k < Math.min(c.length, t + horizon); k += 1) {
        const touched = res ? c[k].high >= l.low : c[k].low <= l.high;
        if (!touched) continue;
        const key = `${Math.round(l.price / atr)}|${k}`;
        if (counted.has(key)) break;
        counted.add(key);
        const b = buckets[l.stars - 1];
        b.touched += 1;
        for (let j = k; j < Math.min(c.length, k + horizon); j += 1) {
          const away = res ? l.price - c[j].low >= atr : c[j].high - l.price >= atr;
          const through = res ? c[j].close > l.high + 0.3 * atr : c[j].close < l.low - 0.3 * atr;
          if (through) {
            b.broke += 1;
            break;
          }
          if (away) {
            b.held += 1;
            break;
          }
        }
        break;
      }
    }
  }
  for (const b of buckets) b.rate = b.held + b.broke ? b.held / (b.held + b.broke) : null;
  return buckets;
}
