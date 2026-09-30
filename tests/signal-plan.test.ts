import assert from "node:assert/strict";
import test from "node:test";
import type { SwingCandle } from "../lib/swing-entries.ts";
import {
  atr, buildSignalPlan, evaluatePlan, familyOf, isValidPlan, kindKey, overallStats, PLAN_EXPIRY_MS, planLines, planStats, ratesText,
  resultsMessage, sampleLabel, type SignalPlan,
} from "../lib/signal-plan.ts";

const F = 300_000; // 5m
const T0 = 1_000 * 3_600_000; // aligned start
const c = (openTime: number, high: number, low: number, close = (high + low) / 2, open = close): SwingCandle => ({ openTime, open, high, low, close, volume: 1, quoteVolume: 1 });
/** Flat candles: range 2 around 100, true range 2 every time → ATR 2. */
const flat = (n: number, frame = 900_000, end = T0) => Array.from({ length: n }, (_, i) => c(end - (n - i) * frame, 101, 99, 100));
const close = (a: number | null, b: number, eps = 1e-9) => assert.ok(a !== null && Math.abs(a - b) < eps, `${a} ≉ ${b}`);

// ─── plan ─────────────────────────────────────────────────────────────────

test("ATR: the average true range of the last 14 candles, or nothing without enough", () => {
  assert.equal(atr(flat(20)), 2);
  assert.equal(atr(flat(14)), null, "needs 15 (14 ranges plus the close before the first)");
  assert.equal(atr(flat(15)), 2);
  const gap = [...flat(14), c(T0, 111, 109, 110)];
  close(atr(gap), (13 * 2 + 11) / 14, 1e-9);
});

test("LONG plan: stop beyond the swing, kept between 1 and 2.5 ATR, targets at 1, 2 and 3 times that distance", () => {
  const now = T0 + 10 * 3_600_000;
  const build = (candles: SwingCandle[]) => buildSignalPlan("LONG", 100, candles, 900_000, now)!;
  const tight = build(flat(30));
  assert.deepEqual([tight.stop, tight.tp1, tight.tp2, tight.tp3, tight.atr], [98, 102, 104, 106, 2], "swing 1 below + 0.25 ATR is under 1 ATR → the floor");
  // A wick also widens the ATR (one range of 5 among 14: (13×2+5)/14), so the expected numbers use it.
  const mid = flat(30);
  mid[20] = c(mid[20].openTime, 101, 96, 100);
  const aMid = (13 * 2 + 5) / 14;
  close(build(mid).stop, 100 - (4 + 0.25 * aMid));
  const wide = flat(30);
  wide[20] = c(wide[20].openTime, 101, 90, 100);
  const aWide = (13 * 2 + 11) / 14;
  const w = build(wide);
  close(w.stop, 100 - 2.5 * aWide, 1e-9);
  close(w.tp3, 100 + 3 * 2.5 * aWide, 1e-9);
});

test("SHORT plan mirrors it", () => {
  const candles = flat(30);
  candles[22] = c(candles[22].openTime, 104, 99, 100);
  const p = buildSignalPlan("SHORT", 100, candles, 900_000, T0 + 10 * 3_600_000)!;
  const a = (13 * 2 + 5) / 14;
  const d = 4 + 0.25 * a;
  close(p.stop, 100 + d);
  close(p.tp1, 100 - d);
  close(p.tp3, 100 - 3 * d);
  assert.ok(isValidPlan("SHORT", 100, p));
});

test("the candle still forming is not used", () => {
  const candles = flat(30);
  const now = candles[29].openTime + 450_000; // halfway through the last 15m candle
  candles[29] = c(candles[29].openTime, 130, 50, 100);
  const p = buildSignalPlan("LONG", 100, candles, 900_000, now)!;
  assert.equal(p.atr, 2);
  assert.equal(p.stop, 98);
});

test("no plan when it can't be built honestly: too little history, bad entry, or a target below zero", () => {
  const now = T0 + 10 * 3_600_000;
  assert.equal(buildSignalPlan("LONG", 100, flat(12), 900_000, now), null);
  assert.equal(buildSignalPlan("LONG", 0, flat(30), 900_000, now), null);
  assert.equal(buildSignalPlan("SHORT", 1, flat(30), 900_000, now), null, "ATR 2 on a price of 1: TP3 would be below zero");
  assert.equal(buildSignalPlan("LONG", 100, [], 900_000, now), null);
});

test("a plan is valid only with the stop and the targets on the right sides, in order", () => {
  const p = { stop: 98, tp1: 102, tp2: 104, tp3: 106 };
  assert.ok(isValidPlan("LONG", 100, p));
  assert.ok(!isValidPlan("SHORT", 100, p));
  assert.ok(!isValidPlan("LONG", 100, { ...p, tp2: 101 }));
  assert.ok(!isValidPlan("LONG", 100, { ...p, stop: 100 }));
  assert.ok(!isValidPlan("LONG", 100, { ...p, tp3: Number.NaN }));
  assert.ok(isValidPlan("SHORT", 100, { stop: 102, tp1: 98, tp2: 96, tp3: 94 }));
});

// ─── evaluation ───────────────────────────────────────────────────────────

const long: SignalPlan = { stop: 98, tp1: 102, tp2: 104, tp3: 106, atr: 2, version: "atr-v1" };
const short: SignalPlan = { stop: 102, tp1: 98, tp2: 96, tp3: 94, atr: 2, version: "atr-v1" };
const at = (i: number) => T0 + i * F; // open of the i-th candle after detection
const ev = (plan: SignalPlan, side: "LONG" | "SHORT", candles: SwingCandle[], now: number, detectedAt = T0) => evaluatePlan(side, plan, detectedAt, candles, F, now);

test("targets reached in order, then the stop: what was reached before the stop counts, and the stop ends it", () => {
  const s = ev(long, "LONG", [c(at(0), 101, 99), c(at(1), 102.5, 100), c(at(2), 104.2, 101), c(at(3), 103, 97.9), c(at(4), 110, 100)], at(10));
  assert.equal(s.tp1At, at(2));
  assert.equal(s.tp2At, at(3));
  assert.equal(s.tp3At, null, "after the stop nothing counts");
  assert.equal(s.slAt, at(4));
  assert.equal(s.outcome, "TP2");
  assert.equal(s.closedAt, at(4));
});

test("the same candle reaching the stop and a target: the stop wins, the target does not count", () => {
  const s = ev(long, "LONG", [c(at(0), 102.5, 97.9)], at(10));
  assert.equal(s.outcome, "SL");
  assert.equal(s.tp1At, null);
  assert.equal(s.slAt, at(1));
});

test("the third target ends the trade; nothing after it is read", () => {
  const s = ev(long, "LONG", [c(at(0), 106.1, 100), c(at(1), 110, 80)], at(10));
  assert.equal(s.outcome, "TP3");
  assert.equal(s.slAt, null);
  assert.deepEqual([s.tp1At, s.tp2At, s.tp3At], [at(1), at(1), at(1)]);
});

test("candles from before the signal, and the one in progress when it came, are ignored", () => {
  const detected = at(0) + 2 * 60_000;
  const s = ev(long, "LONG", [c(at(-1), 110, 90), c(at(0), 110, 90), c(at(1), 101, 99)], at(10), detected);
  assert.equal(s.outcome, null, "the two earlier candles would have ended it");
});

test("a candle that hasn't closed yet is not read", () => {
  assert.equal(ev(long, "LONG", [c(at(0), 110, 90)], at(0) + F - 1).outcome, null);
  assert.equal(ev(long, "LONG", [c(at(0), 110, 99)], at(1)).outcome, "TP3");
  assert.equal(ev(long, "LONG", [c(at(0), 110, 90)], at(1)).outcome, "SL", "touching the stop and the target in one candle is a stop");
});

test("no event yet: still open", () => {
  const s = ev(long, "LONG", [c(at(0), 101, 99), c(at(1), 101, 99)], at(5));
  assert.equal(s.outcome, null);
  assert.equal(s.closedAt, null);
});

test("24 hours with nothing touched: expired; with a target reached earlier it is that target, not expired; events after the day don't count", () => {
  const day = (i: number) => T0 + PLAN_EXPIRY_MS + i * F;
  const quiet = Array.from({ length: 288 }, (_, i) => c(at(i), 101, 99));
  const e = ev(long, "LONG", [...quiet, c(day(1), 110, 90)], day(5));
  assert.equal(e.outcome, "EXPIRED");
  assert.equal(e.closedAt, T0 + PLAN_EXPIRY_MS);
  const held = ev(long, "LONG", [c(at(3), 102.4, 100), ...quiet.slice(4)], day(5));
  assert.equal(held.outcome, "TP1");
  assert.equal(ev(long, "LONG", quiet, T0 + PLAN_EXPIRY_MS - F).outcome, null, "a minute before the day is over it is still open");
});

test("a SHORT mirrors a LONG", () => {
  assert.equal(ev(short, "SHORT", [c(at(0), 101, 97.5), c(at(1), 100, 95.9), c(at(2), 103, 99)], at(9)).outcome, "TP2");
  assert.equal(ev(short, "SHORT", [c(at(0), 102.1, 97)], at(9)).outcome, "SL");
  assert.equal(ev(short, "SHORT", [c(at(0), 101, 93.5)], at(9)).outcome, "TP3");
});

test("PROPERTY: the verdict only ever firms up as time passes — it never changes once given — and a stop never loses to a target of its own candle", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let round = 0; round < 80; round += 1) {
    const side = rnd() < 0.5 ? "LONG" : "SHORT";
    const plan = side === "LONG" ? long : short;
    let price = 100;
    const candles = Array.from({ length: 300 }, (_, i) => {
      const o = price;
      price = o * (1 + (rnd() - 0.5) * 0.012);
      return c(at(i), Math.max(o, price) * (1 + rnd() * 0.004), Math.min(o, price) * (1 - rnd() * 0.004), price, o);
    });
    let previous = ev(plan, side, candles, at(0));
    for (let k = 1; k <= 320; k += 7) {
      const now = at(k);
      const state = ev(plan, side, candles.slice(0, k), now);
      assert.deepEqual(state, ev(plan, side, candles, now), "candles that haven't happened yet change nothing");
      for (const key of ["slAt", "tp1At", "tp2At", "tp3At"] as const) {
        if (previous[key] !== null) assert.equal(state[key], previous[key], `${key} moved`);
      }
      if (previous.outcome !== null) assert.equal(state.outcome, previous.outcome, "outcome changed after being decided");
      if (state.slAt !== null) for (const t of [state.tp1At, state.tp2At, state.tp3At]) assert.ok(t === null || t < state.slAt, "a target in the stop's own candle was counted");
      previous = state;
    }
  }
});

// ─── statistics and text ──────────────────────────────────────────────────

test("statistics: a target reached counts for the targets below it; the stop and the quiet day stand apart", () => {
  const k = kindKey("CONFLUENCIA", "TRIGGER", "SHORT");
  const stats = planStats([
    { kind: k, outcome: "TP3", n: 2 }, { kind: k, outcome: "TP2", n: 3 }, { kind: k, outcome: "TP1", n: 5 },
    { kind: k, outcome: "SL", n: 6 }, { kind: k, outcome: "EXPIRED", n: 4 },
    { kind: kindKey("SCALP", "SETUP", "LONG"), outcome: "SL", n: 1 }, { kind: "x", outcome: "SL", n: 0 },
  ]);
  assert.equal(stats.length, 2);
  assert.deepEqual(stats[0], { kind: k, n: 20, reachedTp1: 10, reachedTp2: 5, reachedTp3: 2, sl: 6, expired: 4 });
  assert.equal(ratesText(stats[0]), "TP1 50% · TP2 25% · TP3 10% · SL 30%");
  assert.equal(ratesText({ ...stats[0], n: 0 }), null);
  assert.equal(overallStats(stats).n, 21);
  assert.equal(sampleLabel(14), "muestra mínima");
  assert.equal(sampleLabel(15), "muestra razonable");
  assert.equal(familyOf("SCALP 5M / 15M"), "SCALP");
  assert.equal(familyOf("15m / 1H / 4H"), "CONFLUENCIA");
});

test("the results message: totals, each kind with its sample, the caveat; and a clear line when there is nothing", () => {
  const stats = planStats([{ kind: kindKey("CONFLUENCIA", "TRIGGER", "SHORT"), outcome: "TP1", n: 10 }, { kind: kindKey("CONFLUENCIA", "TRIGGER", "SHORT"), outcome: "SL", n: 10 }]);
  const m = resultsMessage(stats, 90);
  assert.match(m, /últimos 90 días/);
  assert.match(m, /<b>Todas<\/b> — 20 resueltas \(muestra razonable\)/);
  assert.match(m, /CONFLUENCIA · TRIGGER SHORT<\/b> — 20 señales/);
  assert.match(m, /TP1 50% · TP2 0% · TP3 0% · SL 50%/);
  assert.match(m, /antes que al stop/);
  assert.match(resultsMessage([], 90), /Todavía no hay señales con plan resueltas/);
});

test("the plan as lines: stop with its distance, the three targets with their R", () => {
  const fmt = (n: number) => String(n);
  assert.deepEqual(planLines(100, long, fmt), ["🛑 SL 98 (−2,00%)", "🎯 TP1 102 (1,0R) · TP2 104 (2,0R) · TP3 106 (3,0R)"]);
  assert.deepEqual(planLines(100, short, fmt), ["🛑 SL 102 (+2,00%)", "🎯 TP1 98 (1,0R) · TP2 96 (2,0R) · TP3 94 (3,0R)"]);
  assert.match(planLines(100, { stop: 98, tp1: 102.8, tp2: 105, tp3: 108 }, fmt)[1], /TP1 102.8 \(1,4R\)/, "a plan from another engine keeps its own distances");
});
