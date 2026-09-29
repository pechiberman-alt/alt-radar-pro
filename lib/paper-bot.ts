import { activeBlackout, type Blackout } from "./econ-calendar.ts";
import { flowVerdict } from "./footprint.ts";
import { timeframeConfig } from "./market-fetch.ts";
import { findScalpSignals, type ScalpSignal } from "./scalp-signals.ts";
import type { SwingCandle } from "./swing-entries.ts";

/**
 * A paper-trading futures bot: the same decisions a live one would make, with
 * fictional money, so its record can be read before anything real depends on it.
 *
 * WHAT IT DOES
 *
 * Reads closed candles, takes the scalping signals (lib/scalp-signals.ts),
 * and opens simulated USDⓈ-M futures positions with isolated margin: sized so
 * the stop loses a fixed share of the account, capped by the margin
 * the leverage leaves free, and refused if the stop sits too close to the
 * liquidation price to be safe. It pays taker fees and slippage, closes on
 * stop / target / timeout, and stops for the day after a set loss.
 *
 * NEWS: it does not open a trade around a scheduled release (or a breaking
 * headline), and it closes an open one before the release rather than
 * holding through it. If the calendar could not be loaded it opens nothing —
 * unknown is not the same as quiet.
 *
 * HOW IT STAYS HONEST
 *
 * The whole thing is a function of (state, closed candles): it walks candles
 * in order and never looks past the one it is on, so feeding it candles one at
 * a time or all at once gives identical trades (a test proves it). A candle
 * that closed before the bot went live is history and is never traded, so a
 * backfill can't fabricate a record. When one candle could have touched both
 * the stop and the target, the stop is assumed first. Stops fill at the open
 * if the candle gaps through them.
 *
 * NOT MODELLED: funding payments, partial fills, order-book depth, and the
 * exchange's tiered maintenance margins (a flat 0.5% is used). These make live
 * results somewhat worse than paper, not better.
 */

export type BotCandle = SwingCandle & { takerBuy?: number };

export type BotConfig = {
  enabled: boolean;
  symbols: string[];
  timeframe: string;
  startingEquity: number;
  /** Share of the account the stop loses, percent. */
  riskPct: number;
  leverage: number;
  rr: number;
  maxOpen: number;
  /** Stop opening new trades for the day after losing this share, percent. */
  dailyLossPct: number;
  requireFlow: boolean;
  /** Open nothing while the calendar is unavailable. */
  requireCalendar: boolean;
  /** Per side, percent of notional. */
  feePct: number;
  /** Adverse, percent of price, on market fills. */
  slipPct: number;
};

export const DEFAULT_BOT_CONFIG: BotConfig = {
  enabled: false,
  symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
  timeframe: "5m",
  startingEquity: 1000,
  riskPct: 1,
  leverage: 10,
  rr: 1.5,
  maxOpen: 3,
  dailyLossPct: 5,
  requireFlow: false,
  requireCalendar: true,
  feePct: 0.05,
  slipPct: 0.02,
};

export type TradeStatus = "open" | "win" | "loss" | "timeout" | "news";

export type PaperTrade = {
  id: string;
  symbol: string;
  side: "COMPRA" | "VENTA";
  entryTime: number;
  entry: number;
  stop: number;
  target: number;
  qty: number;
  notional: number;
  leverage: number;
  margin: number;
  liqPrice: number;
  /** What the stop would lose, in USDT. */
  riskUsd: number;
  status: TradeStatus;
  barsHeld: number;
  exitTime?: number;
  exit?: number;
  pnl?: number;
  r?: number;
  fees?: number;
  note?: string;
  /** Timeframe the signal came from, so the record stays right if the setting changes later. */
  timeframe?: string;
};

export type Skips = { flow: number; news: number; calendar: number; capacity: number; halted: number; liquidation: number };

export type BotState = {
  version: 1;
  startedAt: number;
  /** When the bot last went live; candles that closed before it are history. */
  resumedAt: number;
  equity: number;
  trades: PaperTrade[];
  /** Open time of the last candle processed, per symbol and timeframe. */
  cursor: Record<string, number>;
  day: { key: string; startEquity: number };
  skipped: Skips;
};

export type BotContext = {
  blackouts: Blackout[];
  /** False when the calendar couldn't be loaded. */
  calendarKnown: boolean;
  /** Tests substitute the signal source. */
  findSignals?: (candles: SwingCandle[], options: { rr: number }) => ScalpSignal[];
};

const MAINT_MARGIN = 0.005;
const HORIZON = 10; // bars, same as the historical stats the signals are measured with
const MIN_NOTIONAL = 5;
const FLOW_LOOKBACK = 12;
/** The stop must lie inside this share of the distance to liquidation. */
const LIQ_BUFFER = 0.6;

export function newBotState(config: BotConfig, now: number): BotState {
  return {
    version: 1,
    startedAt: now,
    resumedAt: now,
    equity: config.startingEquity,
    trades: [],
    cursor: {},
    day: { key: new Date(now).toISOString().slice(0, 10), startEquity: config.startingEquity },
    skipped: { flow: 0, news: 0, calendar: 0, capacity: 0, halted: 0, liquidation: 0 },
  };
}

/** Going live again after being off: whatever closed in the meantime is history. */
export function resumeBot(state: BotState, now: number): BotState {
  return { ...state, resumedAt: now };
}

const dir = (side: PaperTrade["side"]) => (side === "COMPRA" ? 1 : -1);

function lockedMargin(state: BotState) {
  return state.trades.filter((t) => t.status === "open").reduce((sum, t) => sum + t.margin, 0);
}

function closeTrade(
  state: BotState,
  trade: PaperTrade,
  status: Exclude<TradeStatus, "open">,
  exit: number,
  exitTime: number,
  feePct: number,
  note?: string,
) {
  const gross = (exit - trade.entry) * trade.qty * dir(trade.side);
  const fees = ((trade.entry + exit) * trade.qty * feePct) / 100;
  // An isolated position can lose its margin, never more.
  const pnl = Math.max(gross - fees, -trade.margin);
  trade.status = status;
  trade.exit = exit;
  trade.exitTime = exitTime;
  trade.fees = fees;
  trade.pnl = pnl;
  trade.r = trade.riskUsd > 0 ? pnl / trade.riskUsd : 0;
  if (note) trade.note = note;
  state.equity += pnl;
}

function manage(state: BotState, trade: PaperTrade, c: BotCandle, frameMs: number, ctx: BotContext, config: BotConfig) {
  trade.barsHeld += 1;
  const slip = config.slipPct / 100;
  const long = trade.side === "COMPRA";
  const closedAt = c.openTime + frameMs;

  // A candle that touches the run-up to a release: get out at its open, before
  // it can do anything.
  const danger = ctx.blackouts.find((b) => b.closeAt !== null && closedAt > b.closeAt && c.openTime < b.end);
  if (danger) {
    closeTrade(state, trade, "news", c.open * (long ? 1 - slip : 1 + slip), c.openTime, config.feePct, `Cerrada antes de: ${danger.label}`);
    return;
  }

  const stopHit = long ? c.low <= trade.stop : c.high >= trade.stop;
  const targetHit = long ? c.high >= trade.target : c.low <= trade.target;
  if (stopHit) {
    // Both in one candle: the stop. A gap through it fills at the open.
    const raw = long ? Math.min(trade.stop, c.open) : Math.max(trade.stop, c.open);
    let exit = raw * (long ? 1 - slip : 1 + slip);
    exit = long ? Math.max(exit, trade.liqPrice) : Math.min(exit, trade.liqPrice);
    closeTrade(state, trade, "loss", exit, closedAt, config.feePct);
  } else if (targetHit) {
    closeTrade(state, trade, "win", trade.target, closedAt, config.feePct);
  } else if (trade.barsHeld >= HORIZON) {
    closeTrade(state, trade, "timeout", c.close * (long ? 1 - slip : 1 + slip), closedAt, config.feePct, "Sin llegar a objetivo ni stop");
  }
}

function tryOpen(
  state: BotState,
  config: BotConfig,
  symbol: string,
  sig: ScalpSignal,
  candles: BotCandle[],
  j: number,
  frameMs: number,
  ctx: BotContext,
) {
  const entryTime = candles[j].openTime + frameMs;

  if (state.equity <= state.day.startEquity * (1 - config.dailyLossPct / 100)) {
    state.skipped.halted += 1;
    return;
  }
  if (activeBlackout(ctx.blackouts, entryTime)) {
    state.skipped.news += 1;
    return;
  }
  // Would the very next candle already be inside the run-up to a release?
  if (ctx.blackouts.some((b) => b.closeAt !== null && entryTime + frameMs > b.closeAt && entryTime < b.end)) {
    state.skipped.news += 1;
    return;
  }
  if (config.requireCalendar && !ctx.calendarKnown) {
    state.skipped.calendar += 1;
    return;
  }
  if (config.requireFlow) {
    const window = candles.slice(Math.max(0, j - FLOW_LOOKBACK + 1), j + 1);
    const verdict = flowVerdict(window.map((c) => ({ open: c.open, close: c.close, volume: c.volume, takerBuy: c.takerBuy })));
    const aligned = verdict && verdict.winner === (sig.side === "COMPRA" ? "COMPRADORES" : "VENDEDORES");
    if (!aligned) {
      state.skipped.flow += 1;
      return;
    }
  }
  const open = state.trades.filter((t) => t.status === "open");
  if (open.length >= config.maxOpen || open.some((t) => t.symbol === symbol)) {
    state.skipped.capacity += 1;
    return;
  }

  const slip = config.slipPct / 100;
  const long = sig.side === "COMPRA";
  const fill = sig.entry * (long ? 1 + slip : 1 - slip);
  const riskPerUnit = Math.abs(fill - sig.stop);
  if (!(riskPerUnit > 0) || (long ? fill <= sig.stop : fill >= sig.stop)) return;

  let qty = (state.equity * config.riskPct) / 100 / riskPerUnit;
  const free = state.equity - lockedMargin(state);
  qty = Math.min(qty, (free * config.leverage) / fill);
  if (!(qty * fill >= MIN_NOTIONAL)) {
    state.skipped.capacity += 1;
    return;
  }

  const liqPrice = long
    ? fill * (1 - 1 / config.leverage + MAINT_MARGIN)
    : fill * (1 + 1 / config.leverage - MAINT_MARGIN);
  if (riskPerUnit > LIQ_BUFFER * Math.abs(fill - liqPrice)) {
    state.skipped.liquidation += 1;
    return;
  }

  const id = `${symbol}-${candles[j].openTime}-${sig.side}`;
  if (state.trades.some((t) => t.id === id)) return;
  state.trades.push({
    id,
    symbol,
    side: sig.side,
    entryTime,
    entry: fill,
    stop: sig.stop,
    target: sig.target,
    qty,
    notional: qty * fill,
    leverage: config.leverage,
    margin: (qty * fill) / config.leverage,
    liqPrice,
    riskUsd: qty * riskPerUnit,
    status: "open",
    barsHeld: 0,
    timeframe: config.timeframe,
  });
}

/**
 * Advances the bot over the closed candles of one symbol. `candles` must be
 * closed candles only, oldest first.
 */
export function stepBot(prev: BotState, config: BotConfig, symbol: string, candles: BotCandle[], ctx: BotContext): BotState {
  const state = structuredClone(prev);
  const frameMs = timeframeConfig(config.timeframe).frameMs;
  const key = `${symbol}:${config.timeframe}`;
  const cursor = state.cursor[key] ?? -Infinity;
  const live = Math.max(state.startedAt, state.resumedAt);
  const finder = ctx.findSignals ?? findScalpSignals;
  const signals = new Map((config.enabled ? finder(candles, { rr: config.rr }) : []).map((s) => [s.index, s]));

  for (let j = 0; j < candles.length; j += 1) {
    const c = candles[j];
    if (c.openTime <= cursor) continue;
    const closedAt = c.openTime + frameMs;
    if (closedAt <= live) {
      state.cursor[key] = c.openTime; // history: seen, never traded
      continue;
    }

    const dayKey = new Date(closedAt).toISOString().slice(0, 10);
    if (state.day.key !== dayKey) state.day = { key: dayKey, startEquity: state.equity };

    for (const trade of state.trades) {
      if (trade.status === "open" && trade.symbol === symbol && trade.entryTime <= c.openTime) {
        manage(state, trade, c, frameMs, ctx, config);
      }
    }
    const sig = signals.get(j);
    if (sig && config.enabled) tryOpen(state, config, symbol, sig, candles, j, frameMs, ctx);
    state.cursor[key] = c.openTime;
  }
  return state;
}

// ─── the record ───────────────────────────────────────────────────────────

export type BotStats = {
  closed: number;
  open: number;
  wins: number;
  losses: number;
  /** Closed by the news rule or the timeout. */
  other: number;
  winRate: number | null;
  /** Gross profit over gross loss; Infinity with no losing trade, null with no trades. */
  profitFactor: number | null;
  expectancyR: number | null;
  maxDrawdownPct: number;
  returnPct: number;
  equity: number;
  confidence: "SIN MUESTRA" | "MUESTRA MÍNIMA" | "MUESTRA RAZONABLE";
};

export function botStats(state: BotState, startingEquity: number): BotStats {
  const closed = state.trades.filter((t) => t.status !== "open");
  const profitable = closed.filter((t) => (t.pnl ?? 0) > 0);
  const grossProfit = profitable.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const grossLoss = closed.filter((t) => (t.pnl ?? 0) < 0).reduce((s, t) => s - (t.pnl ?? 0), 0);

  let peak = startingEquity;
  let equity = startingEquity;
  let maxDd = 0;
  for (const t of [...closed].sort((a, b) => (a.exitTime ?? 0) - (b.exitTime ?? 0))) {
    equity += t.pnl ?? 0;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
  }

  return {
    closed: closed.length,
    open: state.trades.length - closed.length,
    wins: closed.filter((t) => t.status === "win").length,
    losses: closed.filter((t) => t.status === "loss").length,
    other: closed.filter((t) => t.status === "news" || t.status === "timeout").length,
    winRate: closed.length ? profitable.length / closed.length : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null,
    expectancyR: closed.length ? closed.reduce((s, t) => s + (t.r ?? 0), 0) / closed.length : null,
    maxDrawdownPct: maxDd,
    returnPct: startingEquity > 0 ? (state.equity / startingEquity - 1) * 100 : 0,
    equity: state.equity,
    confidence: closed.length === 0 ? "SIN MUESTRA" : closed.length < 15 ? "MUESTRA MÍNIMA" : "MUESTRA RAZONABLE",
  };
}

/** Binance kline rows → candles that carry the aggressive-buy volume. */
export function parseBotKlines(rows: unknown): BotCandle[] {
  if (!Array.isArray(rows)) return [];
  const out: BotCandle[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [openTime, open, high, low, close, volume] = [Number(row[0]), Number(row[1]), Number(row[2]), Number(row[3]), Number(row[4]), Number(row[5])];
    if (![openTime, open, high, low, close, volume].every(Number.isFinite)) continue;
    const taker = Number(row[9]);
    out.push({
      openTime, open, high, low, close, volume,
      quoteVolume: Number(row[7]) || 0,
      takerBuy: Number.isFinite(taker) ? taker : undefined,
    });
  }
  return out;
}
