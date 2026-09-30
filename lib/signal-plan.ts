import type { SwingCandle } from "./swing-entries.ts";

/**
 * A signal's plan, fixed at the moment it is detected, and how it turned out.
 *
 * WHY THE PLAN IS FIXED AT DETECTION
 * A win rate only means something if what counts as a win was decided before
 * the result was known. So the stop and the three targets are written down with
 * the signal and never recomputed; the outcome is then read off the candles
 * that came AFTER it, candle by candle, with no way to peek ahead.
 *
 * HOW AN OUTCOME IS DECIDED
 * Candles are walked in order, starting with the first one that opens at or
 * after the detection (the candle in progress at detection is skipped: part of
 * its range happened before the signal existed) and only using candles that
 * have closed. A stop touched ends the trade. Targets reached before that are
 * kept. Inside one candle there is no way to know whether the stop or a target
 * came first, so when a candle reaches the stop, the targets it also reached do
 * NOT count: the result is never flattered. A trade ends at the stop, at the
 * third target, or 24 hours after detection.
 *
 * WHAT THE RATES MEAN
 * "TP1 reached" = price got to target 1 before it touched the stop. It does not
 * say the trade was closed there: a signal can reach TP1 and later still be
 * stopped out. Each rate is the share of resolved signals of that kind.
 */

export type PlanSide = "LONG" | "SHORT";
export type SignalPlan = { stop: number; tp1: number; tp2: number; tp3: number; atr: number | null; version: "atr-v1" | "scalp-v1" };
export type PlanOutcome = "SL" | "TP1" | "TP2" | "TP3" | "EXPIRED";

export const PLAN_EXPIRY_MS = 24 * 3_600_000;
export const ATR_PERIOD = 14;
export const SWING_CANDLES = 16;
export const MIN_SAMPLE = 15;

/** Average true range over the last `period` candles of a series of CLOSED candles. */
export function atr(candles: SwingCandle[], period = ATR_PERIOD): number | null {
  if (candles.length < period + 1) return null;
  const slice = candles.slice(-(period + 1));
  let sum = 0;
  for (let i = 1; i < slice.length; i += 1) {
    const c = slice[i];
    const p = slice[i - 1];
    sum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }
  const value = sum / period;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function isValidPlan(side: PlanSide, entry: number, plan: Pick<SignalPlan, "stop" | "tp1" | "tp2" | "tp3">): boolean {
  const ladder = side === "LONG" ? [plan.stop, entry, plan.tp1, plan.tp2, plan.tp3] : [plan.tp3, plan.tp2, plan.tp1, entry, plan.stop];
  return ladder.every((v) => Number.isFinite(v) && v > 0) && ladder.every((v, i) => i === 0 || v > ladder[i - 1]);
}

/**
 * The plan for a signal that has none of its own: the stop goes just beyond the
 * last 4 hours' swing (16 candles of 15m) plus a quarter of an ATR, kept between
 * 1 and 2.5 ATR from the entry so it is neither inside the noise nor absurdly
 * wide; the targets sit at 1, 2 and 3 times that distance.
 */
export function buildSignalPlan(side: PlanSide, entry: number, candles: SwingCandle[], frameMs: number, now: number): SignalPlan | null {
  if (!(entry > 0)) return null;
  const closed = candles.filter((c) => c.openTime + frameMs <= now);
  const a = atr(closed);
  if (a === null || closed.length < SWING_CANDLES) return null;
  const recent = closed.slice(-SWING_CANDLES);
  const beyond = side === "LONG" ? entry - Math.min(...recent.map((c) => c.low)) : Math.max(...recent.map((c) => c.high)) - entry;
  const d = Math.min(2.5 * a, Math.max(a, beyond + 0.25 * a));
  const sign = side === "LONG" ? 1 : -1;
  const plan: SignalPlan = { stop: entry - sign * d, tp1: entry + sign * d, tp2: entry + sign * 2 * d, tp3: entry + sign * 3 * d, atr: a, version: "atr-v1" };
  return isValidPlan(side, entry, plan) ? plan : null;
}

export type PlanState = {
  slAt: number | null;
  tp1At: number | null;
  tp2At: number | null;
  tp3At: number | null;
  outcome: PlanOutcome | null;
  closedAt: number | null;
};

export function evaluatePlan(side: PlanSide, plan: SignalPlan, detectedAt: number, candles: SwingCandle[], frameMs: number, now: number): PlanState {
  const state: PlanState = { slAt: null, tp1At: null, tp2At: null, tp3At: null, outcome: null, closedAt: null };
  const horizon = Math.min(now, detectedAt + PLAN_EXPIRY_MS);
  const long = side === "LONG";
  const usable = candles.filter((c) => c.openTime >= detectedAt && c.openTime + frameMs <= horizon).sort((a, b) => a.openTime - b.openTime);

  for (const c of usable) {
    const at = c.openTime + frameMs;
    if (long ? c.low <= plan.stop : c.high >= plan.stop) {
      state.slAt = at;
      state.closedAt = at;
      break;
    }
    const reached = (price: number) => (long ? c.high >= price : c.low <= price);
    if (state.tp1At === null && reached(plan.tp1)) state.tp1At = at;
    if (state.tp2At === null && reached(plan.tp2)) state.tp2At = at;
    if (state.tp3At === null && reached(plan.tp3)) {
      state.tp3At = at;
      state.closedAt = at;
      break;
    }
  }

  const expired = state.closedAt === null && now >= detectedAt + PLAN_EXPIRY_MS;
  if (expired) state.closedAt = detectedAt + PLAN_EXPIRY_MS;
  if (state.closedAt !== null) {
    state.outcome = state.tp3At !== null ? "TP3" : state.tp2At !== null ? "TP2" : state.tp1At !== null ? "TP1" : state.slAt !== null ? "SL" : "EXPIRED";
  }
  return state;
}

/** Distance in units of the risk (entry to stop). */
export const rOf = (entry: number, plan: Pick<SignalPlan, "stop">, price: number) => Math.abs(price - entry) / Math.abs(entry - plan.stop);

// ─── statistics ───────────────────────────────────────────────────────────

export type SignalFamily = "SCALP" | "CONFLUENCIA";
export const familyOf = (timeframe: string): SignalFamily => (/^SCALP/i.test(timeframe) ? "SCALP" : "CONFLUENCIA");
export const kindKey = (family: SignalFamily, signal: string, side: string) => `${family}|${signal}|${side}`;

export type PlanCount = { kind: string; outcome: PlanOutcome; n: number };
export type KindStats = {
  kind: string;
  /** Resolved signals of this kind. */
  n: number;
  reachedTp1: number;
  reachedTp2: number;
  reachedTp3: number;
  /** Stopped out without reaching any target. */
  sl: number;
  /** 24 hours passed with neither the stop nor any target touched. */
  expired: number;
};

const empty = (kind: string): KindStats => ({ kind, n: 0, reachedTp1: 0, reachedTp2: 0, reachedTp3: 0, sl: 0, expired: 0 });

function add(s: KindStats, outcome: PlanOutcome, n: number) {
  s.n += n;
  if (outcome === "SL") s.sl += n;
  else if (outcome === "EXPIRED") s.expired += n;
  else {
    s.reachedTp1 += n;
    if (outcome === "TP2" || outcome === "TP3") s.reachedTp2 += n;
    if (outcome === "TP3") s.reachedTp3 += n;
  }
}

export function planStats(rows: PlanCount[]): KindStats[] {
  const map = new Map<string, KindStats>();
  for (const r of rows) {
    if (!(r.n > 0)) continue;
    const s = map.get(r.kind) ?? empty(r.kind);
    add(s, r.outcome, r.n);
    map.set(r.kind, s);
  }
  return [...map.values()].sort((a, b) => b.n - a.n || a.kind.localeCompare(b.kind));
}

export function overallStats(list: KindStats[]): KindStats {
  const total = empty("TODAS");
  for (const s of list) {
    total.n += s.n;
    total.reachedTp1 += s.reachedTp1;
    total.reachedTp2 += s.reachedTp2;
    total.reachedTp3 += s.reachedTp3;
    total.sl += s.sl;
    total.expired += s.expired;
  }
  return total;
}

const rate = (part: number, whole: number) => Math.round((part / whole) * 100);
export const sampleLabel = (n: number) => (n < MIN_SAMPLE ? "muestra mínima" : "muestra razonable");

/** "TP1 58% · TP2 34% · TP3 18% · SL 31%", or null without any resolved signal. */
export function ratesText(s: KindStats): string | null {
  if (!(s.n > 0)) return null;
  return `TP1 ${rate(s.reachedTp1, s.n)}% · TP2 ${rate(s.reachedTp2, s.n)}% · TP3 ${rate(s.reachedTp3, s.n)}% · SL ${rate(s.sl, s.n)}%`;
}

const dec = (v: number, d = 2) => v.toFixed(d).replace(".", ",");

/** Report for the /resultados command. `esc` makes text safe for the channel. */
export function resultsMessage(stats: KindStats[], days: number, esc: (s: string) => string = (s) => s): string {
  const total = overallStats(stats);
  if (!total.n) {
    return "<b>Resultados de las señales</b>\nTodavía no hay señales con plan resueltas para medir. Se miden desde que el plan se guarda al detectarlas.";
  }
  const lines = stats.slice(0, 8).map((s) => {
    const [family, signal, side] = s.kind.split("|");
    return `<b>${esc(family)} · ${esc(signal)} ${esc(side)}</b> — ${s.n} señales (${sampleLabel(s.n)})\n${ratesText(s)}`;
  });
  return (
    `<b>Resultados de las señales</b> · últimos ${days} días\n` +
    `<b>Todas</b> — ${total.n} resueltas (${sampleLabel(total.n)})\n${ratesText(total)}\n` +
    `Sin tocar objetivo ni stop en 24 h: ${rate(total.expired, total.n)}%\n\n` +
    `${lines.join("\n\n")}\n\n` +
    `<i>«TP1 alcanzado» = el precio llegó al objetivo 1 antes que al stop; no significa que el trade se cerró ahí. ` +
    `El plan se fija al detectar la señal. Con pocas señales los porcentajes engañan. No es asesoramiento.</i>`
  );
}

/** The plan as lines for a message; percentages are against the entry. */
export function planLines(entry: number, plan: Pick<SignalPlan, "stop" | "tp1" | "tp2" | "tp3">, fmt: (n: number) => string): string[] {
  const stopPct = ((plan.stop - entry) / entry) * 100;
  const r = (p: number) => `${dec(rOf(entry, plan, p), 1)}R`;
  return [
    `🛑 SL ${fmt(plan.stop)} (${stopPct >= 0 ? "+" : "−"}${dec(Math.abs(stopPct))}%)`,
    `🎯 TP1 ${fmt(plan.tp1)} (${r(plan.tp1)}) · TP2 ${fmt(plan.tp2)} (${r(plan.tp2)}) · TP3 ${fmt(plan.tp3)} (${r(plan.tp3)})`,
  ];
}
