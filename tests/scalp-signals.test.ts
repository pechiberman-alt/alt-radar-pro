import assert from "node:assert/strict";
import test from "node:test";
import { findScalpSignals, scalpStats, type ScalpSignal } from "../lib/scalp-signals.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random walk with realistic-looking candles — no edge exists in it by
 *  construction, which is exactly what makes it a fair calibration series. */
function walk(seed: number, n = 700, vol = 0.004): SwingCandle[] {
  const rnd = mulberry32(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  let price = 100;
  const out: SwingCandle[] = [];
  for (let i = 0; i < n; i += 1) {
    const open = price;
    const close = open * (1 + gauss() * vol);
    out.push({
      openTime: i * 60_000,
      open,
      high: Math.max(open, close) * (1 + Math.abs(gauss()) * vol * 0.4),
      low: Math.min(open, close) * (1 - Math.abs(gauss()) * vol * 0.4),
      close,
      volume: 100,
      quoteVolume: 0,
    });
    price = close;
  }
  return out;
}

const candle = (i: number, o: number, h: number, l: number, c: number): SwingCandle => ({
  openTime: i * 60_000, open: o, high: h, low: l, close: c, volume: 100, quoteVolume: 0,
});

test("every signal obeys the setup's own invariants", () => {
  for (let seed = 1; seed <= 12; seed += 1) {
    const candles = walk(seed * 101);
    for (const s of findScalpSignals(candles)) {
      assert.ok(s.index >= 55, "no signals inside the indicator warm-up");
      assert.equal(s.entry, candles[s.index].close, "entry is the signal candle's close");
      assert.equal(s.time, candles[s.index].openTime);
      const risk = Math.abs(s.entry - s.stop);
      assert.ok(risk >= s.atr * 0.5 - 1e-9 && risk <= s.atr * 2.2 + 1e-9, "stop distance within 0.5–2.2 ATR");
      assert.ok(Math.abs(Math.abs(s.target - s.entry) - risk * s.rr) < 1e-9, "target is exactly rr × risk away");
      if (s.side === "COMPRA") assert.ok(s.stop < s.entry && s.entry < s.target);
      else assert.ok(s.stop > s.entry && s.entry > s.target);
    }
  }
});

test("NO LOOKAHEAD: adding later candles never changes or removes an earlier signal", () => {
  // The single most important property of a signal that gets replayed over
  // history — if it holds, a backtest on this series means something.
  for (const seed of [3, 17, 91, 204]) {
    const candles = walk(seed * 977);
    const full = findScalpSignals(candles);
    for (const cut of [120, 250, 400, 600]) {
      const prefix = findScalpSignals(candles.slice(0, cut));
      const expected = full.filter((s) => s.index < cut);
      assert.deepEqual(prefix, expected, `seed ${seed}, cut ${cut}`);
    }
  }
});

test("deterministic: the same series always yields the same signals", () => {
  const candles = walk(42);
  assert.deepEqual(findScalpSignals(candles), findScalpSignals(candles));
});

test("too little history and flat markets produce nothing", () => {
  assert.deepEqual(findScalpSignals(walk(1, 40)), []);
  const flat = Array.from({ length: 200 }, (_, i) => candle(i, 100, 100.2, 99.8, 100));
  assert.deepEqual(findScalpSignals(flat), [], "sin tendencia no hay pullback que operar");
});

test("the same side never fires again inside the cooldown", () => {
  const candles = walk(7);
  const signals = findScalpSignals(candles, { cooldown: 6 });
  for (const side of ["COMPRA", "VENTA"] as const) {
    const idx = signals.filter((s) => s.side === side).map((s) => s.index);
    for (let i = 1; i < idx.length; i += 1) assert.ok(idx[i] - idx[i - 1] > 6);
  }
});

test("both directions occur, in roughly even numbers, on a market with no trend bias", () => {
  let longs = 0;
  let shorts = 0;
  for (let seed = 1; seed <= 30; seed += 1) {
    for (const s of findScalpSignals(walk(seed * 31))) {
      if (s.side === "COMPRA") longs += 1;
      else shorts += 1;
    }
  }
  assert.ok(longs > 0 && shorts > 0);
  const share = longs / (longs + shorts);
  assert.ok(share > 0.35 && share < 0.65, `reparto ${share.toFixed(2)}`);
});

test("CALIBRATION: on random walks — where no edge exists — the win rate sits at or below break-even, never above it", () => {
  // A backtest that finds an edge in noise is broken. Measured at time of
  // writing: ~37% wins against a 40% break-even at 1.5:1, expectancy ≈ -0.07R
  // (slightly negative because a candle spanning both stop and target counts
  // as a loss). The bounds are loose enough for seed noise and tight enough
  // to catch a lookahead bug, which would push the rate far above them.
  let wins = 0;
  let resolved = 0;
  let signals = 0;
  const series = 40;
  for (let seed = 1; seed <= series; seed += 1) {
    const candles = walk(seed * 7919);
    const s = findScalpSignals(candles);
    const st = scalpStats(candles, s);
    wins += st.wins;
    resolved += st.resolved;
    signals += st.signals;
  }
  const rate = wins / resolved;
  const expectancy = (wins * 1.5 - (resolved - wins)) / resolved;
  assert.ok(signals / series > 8 && signals / series < 60, `${(signals / series).toFixed(1)} señales por serie`);
  assert.ok(rate > 0.3 && rate < 0.44, `win rate ${rate.toFixed(3)}`);
  assert.ok(expectancy > -0.3 && expectancy < 0.05, `expectativa ${expectancy.toFixed(3)}R`);
});

// ─── scalpStats, on hand-built outcomes ───────────────────────────────────

const sig = (index: number, side: "COMPRA" | "VENTA", entry = 100, stop = 99, rr = 1.5): ScalpSignal => ({
  index, time: index * 60_000, side, entry, stop, target: side === "COMPRA" ? entry + (entry - stop) * rr : entry - (stop - entry) * rr,
  rr, atr: 1, reason: "test",
});

function series(afterSignal: [number, number][]): SwingCandle[] {
  // 3 quiet candles, then the candles that decide the trade: [high, low] pairs.
  const quiet = Array.from({ length: 3 }, (_, i) => candle(i, 100, 100.2, 99.8, 100));
  const decide = afterSignal.map(([h, l], k) => candle(3 + k, 100, h, l, 100));
  return [...quiet, ...decide];
}

test("stats: a target reached first is a win, a stop reached first is a loss", () => {
  const win = scalpStats(series([[101.6, 99.9]]), [sig(2, "COMPRA")], { horizon: 5 });
  assert.equal(win.wins, 1);
  const loss = scalpStats(series([[100.5, 98.9]]), [sig(2, "COMPRA")], { horizon: 5 });
  assert.equal(loss.losses, 1);
});

test("stats: a candle spanning BOTH stop and target counts as the stop — the honest way to be wrong", () => {
  const st = scalpStats(series([[102, 98]]), [sig(2, "COMPRA")], { horizon: 5 });
  assert.equal(st.losses, 1);
  assert.equal(st.wins, 0);
});

test("stats: shorts are the mirror image", () => {
  const win = scalpStats(series([[100.1, 98.4]]), [sig(2, "VENTA", 100, 101)], { horizon: 5 });
  assert.equal(win.wins, 1);
  const loss = scalpStats(series([[101.1, 99.5]]), [sig(2, "VENTA", 100, 101)], { horizon: 5 });
  assert.equal(loss.losses, 1);
});

test("stats: neither level reached inside the horizon is a timeout, and doesn't count toward the rate", () => {
  const candles = series([[100.3, 99.7], [100.3, 99.7], [100.3, 99.7], [100.3, 99.7], [100.3, 99.7], [100.3, 99.7]]);
  const st = scalpStats(candles, [sig(2, "COMPRA")], { horizon: 3 });
  assert.equal(st.timeouts, 1);
  assert.equal(st.resolved, 0);
  assert.equal(st.winRate, null);
  assert.equal(st.confidence, "SIN MUESTRA");
});

test("stats: a signal too recent to have had its full horizon is pending, not a timeout", () => {
  const st = scalpStats(series([[100.3, 99.7]]), [sig(2, "COMPRA")], { horizon: 10 });
  assert.equal(st.pending, 1);
  assert.equal(st.timeouts, 0);
});

test("stats: break-even rate and expectancy follow from the reward:risk", () => {
  const candles = series([[101.6, 99.9], [100.5, 98.9]]);
  const st = scalpStats(candles, [sig(2, "COMPRA"), sig(3, "COMPRA")], { horizon: 1 });
  assert.equal(st.breakevenRate, 1 / 2.5);
  assert.equal(st.wins, 1);
  assert.equal(st.losses, 1);
  assert.equal(st.winRate, 0.5);
  assert.equal(st.expectancyR, (1 * 1.5 - 1) / 2); // +0.25R
  assert.equal(st.profitFactor, 1.5); // 1 win of 1.5R over 1 loss of 1R
});

test("stats: profit factor with no losses is infinite, and with nothing resolved it is nothing — not zero", () => {
  const allWins = scalpStats(series([[101.6, 99.9]]), [sig(2, "COMPRA")], { horizon: 5 });
  assert.equal(allWins.profitFactor, Infinity);
  const none = scalpStats(series([[100.3, 99.7]]), [sig(2, "COMPRA")], { horizon: 10 });
  assert.equal(none.profitFactor, null);
});

test("CALIBRATION: on random walks the profit factor sits below 1 — no edge means no profit", () => {
  let wins = 0;
  let losses = 0;
  for (let seed = 1; seed <= 40; seed += 1) {
    const candles = walk(seed * 7919);
    const st = scalpStats(candles, findScalpSignals(candles));
    wins += st.wins;
    losses += st.losses;
  }
  const pf = (wins * 1.5) / losses;
  assert.ok(pf > 0.6 && pf < 1.05, `profit factor ${pf.toFixed(2)}`); // measured ~0.88
});

test("stats: confidence needs 15 resolved trades, stricter than the 8 zone stats use", () => {
  const many = (n: number) => {
    const candles: SwingCandle[] = [];
    const signals: ScalpSignal[] = [];
    for (let k = 0; k < n; k += 1) {
      const base = candles.length;
      candles.push(candle(base, 100, 100.2, 99.8, 100), candle(base + 1, 100, 101.6, 99.9, 100));
      signals.push(sig(base, "COMPRA"));
    }
    return scalpStats(candles, signals, { horizon: 1 });
  };
  assert.equal(many(14).confidence, "MUESTRA MÍNIMA");
  assert.equal(many(15).confidence, "MUESTRA RAZONABLE");
});
