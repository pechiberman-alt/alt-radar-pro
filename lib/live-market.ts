/**
 * Live feed for the liquidation map: the forming candle and REAL liquidations.
 *
 * The heatmap is an estimate built on assumed leverage. The forceOrder stream
 * is the opposite: each event is a position Binance actually closed by force.
 * Drawing both on one chart is the point — the estimate says where fuel should
 * be, the prints show where it was actually burned.
 *
 * WHAT THE STREAM DOES NOT GIVE
 *
 * Binance pushes at most one liquidation per symbol per second (the latest in
 * that window), so during a cascade it undercounts; and it is Binance only.
 * The panel states both rather than presenting the tape as complete.
 */

export type LiveLiquidation = {
  symbol: string;
  time: number;
  price: number;
  qty: number;
  notionalUsd: number;
  /** Which side was forced out. A forced SELL closes a long. */
  side: "LARGOS" | "CORTOS";
};

export type LiveKline = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Aggressive buying in the candle (kline field V), when provided. */
  takerBuy?: number;
  closed: boolean;
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

export function parseForceOrder(payload: unknown): LiveLiquidation | null {
  const o = (payload as { o?: Record<string, unknown> } | null)?.o;
  if (!o || typeof o.s !== "string" || (o.S !== "SELL" && o.S !== "BUY")) return null;
  // Average fill and filled quantity are what actually traded; the order's
  // limit price and size are the fallback when the fill fields are empty.
  const avg = num(o.ap);
  const price = avg > 0 ? avg : num(o.p);
  const filled = num(o.z);
  const qty = filled > 0 ? filled : num(o.q);
  const time = num(o.T);
  if (!(price > 0) || !(qty > 0) || !(time > 0)) return null;
  return {
    symbol: o.s,
    time,
    price,
    qty,
    notionalUsd: price * qty,
    side: o.S === "SELL" ? "LARGOS" : "CORTOS",
  };
}

export function parseKline(payload: unknown): LiveKline | null {
  const k = (payload as { k?: Record<string, unknown> } | null)?.k;
  if (!k) return null;
  const candle = {
    time: num(k.t),
    open: num(k.o),
    high: num(k.h),
    low: num(k.l),
    close: num(k.c),
    volume: num(k.v),
    takerBuy: Number.isFinite(num(k.V)) ? num(k.V) : undefined,
    closed: k.x === true,
  };
  return [candle.time, candle.open, candle.high, candle.low, candle.close].every((v) => v > 0)
    ? candle
    : null;
}

type CandleLike = { time: number; open: number; high: number; low: number; close: number; volume: number; takerBuy?: number };

/**
 * Folds the live candle into a loaded series: same open time replaces the
 * last candle, a newer one is appended (the window keeps its length), an
 * older one is ignored — a late message must never rewrite history.
 */
export function mergeLiveCandle<T extends CandleLike>(candles: T[], live: LiveKline | null): T[] {
  if (!live || !candles.length) return candles;
  const last = candles[candles.length - 1];
  const next = {
    ...last,
    time: live.time,
    open: live.open,
    high: live.high,
    low: live.low,
    close: live.close,
    volume: live.volume,
    ...(live.takerBuy !== undefined ? { takerBuy: live.takerBuy } : {}),
  };
  if (live.time === last.time) return [...candles.slice(0, -1), next];
  if (live.time > last.time) return [...candles.slice(1), next];
  return candles;
}

export type LiquidationTotals = {
  count: number;
  longsUsd: number;
  shortsUsd: number;
  largest: LiveLiquidation | null;
  /** Which side took more damage, when the gap is meaningful. */
  dominant: "LARGOS" | "CORTOS" | "PAREJO";
};

export function liquidationTotals(list: LiveLiquidation[]): LiquidationTotals {
  let longsUsd = 0;
  let shortsUsd = 0;
  let largest: LiveLiquidation | null = null;
  for (const l of list) {
    if (l.side === "LARGOS") longsUsd += l.notionalUsd;
    else shortsUsd += l.notionalUsd;
    if (!largest || l.notionalUsd > largest.notionalUsd) largest = l;
  }
  const total = longsUsd + shortsUsd;
  const dominant =
    total === 0 || Math.abs(longsUsd - shortsUsd) / total < 0.2
      ? "PAREJO"
      : longsUsd > shortsUsd
        ? "LARGOS"
        : "CORTOS";
  return { count: list.length, longsUsd, shortsUsd, largest, dominant };
}

/** A resting-order level is taken the instant price trades at it — a wick is
 *  enough (see lib/liquidity-pools.ts). Buy-side sits above, sell-side below. */
export function isPoolTaken(
  pool: { side: "COMPRA" | "VENTA"; price: number },
  candle: { high: number; low: number } | null,
): boolean {
  if (!candle) return false;
  return pool.side === "COMPRA" ? candle.high >= pool.price : candle.low <= pool.price;
}
