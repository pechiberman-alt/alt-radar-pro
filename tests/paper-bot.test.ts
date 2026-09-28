import assert from "node:assert/strict";
import test from "node:test";
import type { Blackout } from "../lib/econ-calendar.ts";
import {
  botStats, DEFAULT_BOT_CONFIG, newBotState, parseBotKlines, resumeBot, stepBot,
  type BotCandle, type BotConfig, type BotContext, type BotState, type PaperTrade,
} from "../lib/paper-bot.ts";
import type { ScalpSignal } from "../lib/scalp-signals.ts";

const F = 300_000; // 5m
const T0 = Date.UTC(2026, 5, 10, 12, 0, 0);

const cfg: BotConfig = {
  ...DEFAULT_BOT_CONFIG, enabled: true, timeframe: "5m", leverage: 10, riskPct: 1, slipPct: 0,
  feePct: 0.05, rr: 1.5, startingEquity: 1000, requireCalendar: false, maxOpen: 3, dailyLossPct: 50,
};
const candle = (i: number, o = 100, h = 100.2, l = 99.8, c = 100, taker?: number, base = T0): BotCandle => ({
  openTime: base + i * F, open: o, high: h, low: l, close: c, volume: 100, quoteVolume: 0, takerBuy: taker,
});
const flat = (n: number, base = T0) => Array.from({ length: n }, (_, i) => candle(i, 100, 100.2, 99.8, 100, undefined, base));

type Spec = Partial<ScalpSignal> & { side?: "COMPRA" | "VENTA" };
/** Signals at chosen candle indexes; entry is that candle's close. */
const stub = (specs: Record<number, Spec>): BotContext["findSignals"] => (candles) =>
  Object.entries(specs).map(([key, spec]) => {
    const i = Number(key);
    const side = spec.side ?? "COMPRA";
    const entry = spec.entry ?? candles[i].close;
    const stop = spec.stop ?? (side === "COMPRA" ? entry - 1 : entry + 1);
    return {
      index: i, time: candles[i].openTime, side, entry, stop,
      target: spec.target ?? (side === "COMPRA" ? entry + 1.5 * (entry - stop) : entry - 1.5 * (stop - entry)),
      rr: 1.5, atr: 1, reason: "test",
    };
  });
const ctxWith = (specs: Record<number, Spec>, extra: Partial<BotContext> = {}): BotContext => ({
  blackouts: [], calendarKnown: true, findSignals: stub(specs), ...extra,
});
const live = (config = cfg, at = T0 - 1) => newBotState(config, at);
const run = (candles: BotCandle[], specs: Record<number, Spec>, extra: Partial<BotContext> = {}, config = cfg, state: BotState = live(config)) =>
  stepBot(state, config, "BTCUSDT", candles, ctxWith(specs, extra));
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

// ─── sizing and mechanics ─────────────────────────────────────────────────

test("sizing: the stop loses exactly riskPct of the account; margin is notional over leverage; liquidation is set", () => {
  const s = run(flat(4), { 3: {} });
  const t = s.trades[0];
  close(t.riskUsd, 10); // 1% of 1000
  close(t.qty, 10); // 10 USDT risk / 1 USDT stop distance
  close(t.notional, 1000);
  close(t.margin, 100);
  close(t.liqPrice, 90.5); // 100 × (1 − 1/10 + 0.5%)
  assert.equal(t.status, "open");
});

test("margin cap: a tight stop can't size past the margin the leverage leaves free", () => {
  const s = run(flat(4), { 3: { stop: 99.9 } }, {}, { ...cfg, leverage: 2 });
  const t = s.trades[0];
  close(t.qty, 20); // free 1000 × 2 / 100, not the 100 the risk rule asked for
  close(t.margin, 1000);
  close(t.riskUsd, 2); // the risk actually taken is smaller than asked
});

test("target hit is a win, paying fees on both sides", () => {
  const candles = [...flat(4), candle(4, 100, 101.6, 99.9, 101)];
  const s = run(candles, { 3: {} });
  const t = s.trades[0];
  assert.equal(t.status, "win");
  close(t.pnl!, 15 - (100 + 101.5) * 10 * 0.0005);
  close(s.equity, 1000 + t.pnl!);
});

test("stop hit is a loss", () => {
  const s = run([...flat(4), candle(4, 100, 100.4, 98.9, 99.5)], { 3: {} });
  assert.equal(s.trades[0].status, "loss");
  close(s.trades[0].pnl!, -10 - (100 + 99) * 10 * 0.0005);
});

test("a candle spanning both stop and target counts as the stop", () => {
  const s = run([...flat(4), candle(4, 100, 102, 98, 100)], { 3: {} });
  assert.equal(s.trades[0].status, "loss");
});

test("a gap through the stop fills at the open, not at the stop", () => {
  const s = run([...flat(4), candle(4, 98, 98.5, 97.5, 98)], { 3: {} });
  close(s.trades[0].exit!, 98);
  close(s.trades[0].pnl!, -20 - (100 + 98) * 10 * 0.0005);
});

test("slippage works against you on entry and on a stop", () => {
  const withSlip = { ...cfg, slipPct: 0.1 };
  const s = run([...flat(4), candle(4, 100, 100.3, 98.9, 99.5)], { 3: {} }, {}, withSlip);
  const t = s.trades[0];
  close(t.entry, 100.1); // bought a tick worse
  close(t.exit!, 99 * 0.999); // stopped a tick worse
});

test("shorts mirror longs", () => {
  const s = run([...flat(4), candle(4, 100, 100.1, 98.4, 99)], { 3: { side: "VENTA" } });
  assert.equal(s.trades[0].status, "win");
  close(s.trades[0].liqPrice, 109.5);
});

test("no exit inside 10 bars closes at the close: timeout", () => {
  const s = run(flat(4 + 10), { 3: {} });
  assert.equal(s.trades[0].status, "timeout");
  assert.equal(s.trades[0].barsHeld, 10);
});

test("liquidation safety: a stop too close to liquidation is refused, not taken", () => {
  const s = run(flat(4), { 3: { stop: 99 } }, {}, { ...cfg, leverage: 50 });
  assert.equal(s.trades.length, 0);
  assert.equal(s.skipped.liquidation, 1);
});

test("an isolated position can lose its margin and no more", () => {
  const s = run([...flat(4), candle(4, 80, 81, 79, 80)], { 3: {} }, {}, { ...cfg, leverage: 10 });
  assert.ok(s.trades[0].pnl! >= -s.trades[0].margin - 1e-9);
});

// ─── news ─────────────────────────────────────────────────────────────────

const blackout = (start: number, closeAt: number | null, end: number, kind: Blackout["kind"] = "calendar"): Blackout => ({ start, end, closeAt, label: "USD · CPI", kind });

test("NEWS: an open trade is closed at the open of the candle that reaches the run-up, before it can hit anything", () => {
  const candles = [...flat(4), candle(4), candle(5, 100.3, 102, 100.2, 101.8)]; // candle 5 would have hit the target
  const s = run(candles, { 3: {} }, { blackouts: [blackout(T0 + 5.5 * F, T0 + 5.5 * F, T0 + 8 * F)] });
  const t = s.trades[0];
  assert.equal(t.status, "news");
  close(t.exit!, 100.3);
  assert.match(t.note!, /Cerrada antes de: USD · CPI/);
});

test("NEWS: no entry while a blackout is active", () => {
  const s = run(flat(4), { 3: {} }, { blackouts: [blackout(T0 + 3 * F, T0 + 3.5 * F, T0 + 6 * F)] });
  assert.equal(s.trades.length, 0);
  assert.equal(s.skipped.news, 1);
});

test("NEWS: no entry that the very next candle would force shut", () => {
  const s = run(flat(4), { 3: {} }, { blackouts: [blackout(T0 + 4.5 * F, T0 + 4.5 * F, T0 + 7 * F)] });
  assert.equal(s.trades.length, 0);
  assert.equal(s.skipped.news, 1);
});

test("NEWS: a headline blackout blocks entries but never force-closes (it already happened)", () => {
  const s = run([...flat(4), candle(4), candle(5)], { 3: {} }, { blackouts: [blackout(T0 + 4.2 * F, null, T0 + 9 * F, "headline")] });
  assert.equal(s.trades[0].status, "open");
  const blocked = run(flat(4), { 3: {} }, { blackouts: [blackout(T0 + 3 * F, null, T0 + 9 * F, "headline")] });
  assert.equal(blocked.trades.length, 0);
});

test("CALENDAR UNKNOWN: opens nothing when required — unknown is not quiet — and trades normally when not", () => {
  const off = run(flat(4), { 3: {} }, { calendarKnown: false }, { ...cfg, requireCalendar: true });
  assert.equal(off.trades.length, 0);
  assert.equal(off.skipped.calendar, 1);
  assert.equal(run(flat(4), { 3: {} }, { calendarKnown: false }, { ...cfg, requireCalendar: false }).trades.length, 1);
});

// ─── gates ────────────────────────────────────────────────────────────────

const flowCandles = (buyShare: number) => Array.from({ length: 6 }, (_, i) => candle(i, 100, 100.2, 99.8, 100, 100 * buyShare));

test("FLOW GATE: a long needs buyers winning, a short needs sellers", () => {
  const cf = { ...cfg, requireFlow: true };
  assert.equal(run(flowCandles(0.65), { 5: {} }, {}, cf).trades.length, 1);
  const against = run(flowCandles(0.65), { 5: { side: "VENTA" } }, {}, cf);
  assert.equal(against.trades.length, 0);
  assert.equal(against.skipped.flow, 1);
  assert.equal(run(flowCandles(0.35), { 5: { side: "VENTA" } }, {}, cf).trades.length, 1);
});

test("FLOW GATE: no taker data means no confirmation, so no trade", () => {
  assert.equal(run(flat(6), { 5: {} }, {}, { ...cfg, requireFlow: true }).trades.length, 0);
});

test("one position per symbol, and never more than maxOpen across symbols", () => {
  const twice = run(flat(6), { 3: {}, 4: {} });
  assert.equal(twice.trades.length, 1);
  assert.equal(twice.skipped.capacity, 1);

  const one = { ...cfg, maxOpen: 1 };
  const a = stepBot(live(one), one, "BTCUSDT", flat(4), ctxWith({ 3: {} }));
  const b = stepBot(a, one, "ETHUSDT", flat(4), ctxWith({ 3: {} }));
  assert.equal(b.trades.length, 1);
  assert.equal(b.skipped.capacity, 1);
});

test("DAILY LOSS: after losing the day's allowance it stops opening, and resumes the next UTC day", () => {
  const base = Date.UTC(2026, 5, 10, 23, 0, 0); // 23:00; index 12 is 00:00 the next day
  const candles = [
    ...flat(4, base), candle(4, 100, 100.3, 98.9, 99.5, undefined, base), // trade opened at 3, stopped at 4: −1.1%
    ...Array.from({ length: 10 }, (_, k) => candle(5 + k, 100, 100.2, 99.8, 100, undefined, base)),
  ];
  const s = run(candles, { 3: {}, 8: {}, 14: {} }, {}, { ...cfg, dailyLossPct: 1 }, live({ ...cfg, dailyLossPct: 1 }, base - 1));
  assert.equal(s.skipped.halted, 1, "idx 8 is the same day: halted");
  assert.deepEqual(s.trades.map((t) => t.id.split("-")[1]), [String(base + 3 * F), String(base + 14 * F)], "idx 14 is the next day: allowed again");
});

test("HISTORY IS NEVER TRADED: candles that closed before the bot went live only advance the cursor", () => {
  const s = run(flat(6), { 3: {} }, {}, cfg, live(cfg, T0 + 10 * F));
  assert.equal(s.trades.length, 0);
  assert.equal(s.cursor[`BTCUSDT:5m`], T0 + 5 * F);
  const resumed = resumeBot(live(cfg, T0 - 1), T0 + 10 * F);
  assert.equal(run(flat(6), { 3: {} }, {}, cfg, resumed).trades.length, 0);
});

test("switched off: opens nothing new, but still manages what is open", () => {
  const opened = run(flat(4), { 3: {} });
  const off = stepBot(opened, { ...cfg, enabled: false }, "BTCUSDT", [...flat(4), candle(4, 100, 101.6, 99.9, 101)], ctxWith({ 3: {} }));
  assert.equal(off.trades.length, 1);
  assert.equal(off.trades[0].status, "win");
});

test("idempotent: stepping the same candles again changes nothing", () => {
  const candles = [...flat(4), candle(4, 100, 101.6, 99.9, 101)];
  const once = run(candles, { 3: {} });
  assert.deepEqual(stepBot(once, cfg, "BTCUSDT", candles, ctxWith({ 3: {} })), once);
});

// ─── the real engine, over random walks ───────────────────────────────────

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
function walk(seed: number, n = 800): BotCandle[] {
  const rnd = mulberry32(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  let price = 100;
  return Array.from({ length: n }, (_, i) => {
    const open = price;
    const close = open * (1 + gauss() * 0.004);
    price = close;
    return {
      openTime: T0 + i * F, open, close,
      high: Math.max(open, close) * (1 + Math.abs(gauss()) * 0.0016),
      low: Math.min(open, close) * (1 - Math.abs(gauss()) * 0.0016),
      volume: 100, quoteVolume: 0, takerBuy: 50 + gauss() * 8,
    };
  });
}
const real: BotContext = { blackouts: [], calendarKnown: true };

test("NO LOOKAHEAD: feeding candles in chunks gives exactly the trades of feeding them all at once", () => {
  for (const seed of [2, 9, 31]) {
    const candles = walk(seed * 613);
    const oneShot = stepBot(live(), cfg, "BTCUSDT", candles, real);
    let chunked = live();
    for (let k = 70; k < candles.length + 7; k += 7) chunked = stepBot(chunked, cfg, "BTCUSDT", candles.slice(0, Math.min(k, candles.length)), real);
    chunked = stepBot(chunked, cfg, "BTCUSDT", candles, real);
    assert.ok(oneShot.trades.length > 3, `seed ${seed}: should have traded (${oneShot.trades.length})`);
    assert.deepEqual(chunked.trades, oneShot.trades, `seed ${seed}`);
    close(chunked.equity, oneShot.equity);
  }
});

test("the books balance: equity is the start plus every closed trade's P&L, and never negative", () => {
  for (const seed of [4, 11]) {
    const s = stepBot(live(), cfg, "BTCUSDT", walk(seed * 977), real);
    const total = s.trades.filter((t) => t.status !== "open").reduce((sum, t) => sum + t.pnl!, 0);
    close(s.equity, 1000 + total);
    assert.ok(s.equity > 0);
  }
});

test("at most one open trade per symbol at any moment", () => {
  const s = stepBot(live(), cfg, "BTCUSDT", walk(5 * 31), real);
  const spans = s.trades.map((t) => [t.entryTime, t.exitTime ?? Infinity]);
  for (let i = 0; i < spans.length; i += 1) for (let j = i + 1; j < spans.length; j += 1) {
    assert.ok(spans[i][1] <= spans[j][0] || spans[j][1] <= spans[i][0], "overlapping positions");
  }
});

// ─── the record ───────────────────────────────────────────────────────────

const mk = (pnl: number, r: number, exitTime: number, status: PaperTrade["status"] = pnl > 0 ? "win" : "loss"): PaperTrade => ({
  id: String(exitTime), symbol: "X", side: "COMPRA", entryTime: 0, entry: 1, stop: 1, target: 1, qty: 1, notional: 1,
  leverage: 1, margin: 1, liqPrice: 0, riskUsd: 1, status, barsHeld: 1, exitTime, exit: 1, pnl, r,
});
const withTrades = (trades: PaperTrade[]): BotState => ({ ...live(), trades, equity: 1000 + trades.reduce((s, t) => s + (t.pnl ?? 0), 0) });

test("stats: win rate, profit factor, expectancy and drawdown", () => {
  const stats = botStats(withTrades([mk(10, 1, 1), mk(-5, -0.5, 2), mk(10, 1, 3), mk(-20, -2, 4)]), 1000);
  assert.equal(stats.closed, 4);
  assert.equal(stats.winRate, 0.5);
  close(stats.profitFactor!, 20 / 25);
  close(stats.expectancyR!, -0.125);
  close(stats.maxDrawdownPct, ((1015 - 995) / 1015) * 100);
  close(stats.returnPct, -0.5);
  assert.equal(stats.confidence, "MUESTRA MÍNIMA");
});

test("stats: no losing trade is an infinite profit factor; no trades is nothing at all, not zero", () => {
  assert.equal(botStats(withTrades([mk(10, 1, 1)]), 1000).profitFactor, Infinity);
  const empty = botStats(withTrades([]), 1000);
  assert.equal(empty.profitFactor, null);
  assert.equal(empty.winRate, null);
  assert.equal(empty.confidence, "SIN MUESTRA");
});

test("stats: news and timeout closes count in the record, and are reported separately", () => {
  const stats = botStats(withTrades([mk(3, 0.3, 1, "news"), mk(-2, -0.2, 2, "timeout"), mk(10, 1, 3)]), 1000);
  assert.equal(stats.other, 2);
  assert.equal(stats.closed, 3);
});

test("parseBotKlines keeps the aggressive-buy volume and drops malformed rows", () => {
  const rows = [[1, "1", "2", "0.5", "1.5", "10", 9, "15", 3, "6", "9", "0"], [2, "x"], "junk", [3, "1", "2", "0.5", "1.5", "10", 9, "15", 3, undefined]];
  const parsed = parseBotKlines(rows);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].takerBuy, 6);
  assert.equal(parsed[1].takerBuy, undefined);
});
