import type { Trade } from "./footprint.ts";

/**
 * Trade bubbles: the biggest aggressive orders, drawn where and when they
 * printed, as order-flow tools do.
 *
 * Each Binance aggTrade is one taker order's fills at one price, so a large
 * one is one large market order. Its side is the aggressor's: a trade whose
 * buyer was the maker was an aggressive SELL. Size is measured in dollars
 * (price × quantity), so bubbles compare across coins and price levels.
 *
 * "Large" is relative by default — the top 0.5% of the orders on screen —
 * because $50k is a whale on a small coin and noise on BTC. A fixed minimum
 * can be chosen instead. The count is capped (largest kept) so a busy chart
 * stays readable. A bubble is a fact about one order; it does not say what
 * price does next.
 */

export type Bubble = {
  id: number;
  time: number;
  price: number;
  qty: number;
  notional: number;
  side: "COMPRA" | "VENTA";
};

export type BubbleOptions = {
  from: number;
  to: number;
  /** Fixed minimum in dollars; null for the automatic one. */
  minNotional?: number | null;
  max?: number;
  /** Share of on-screen orders that count as large in automatic mode. */
  topShare?: number;
};

export const DEFAULT_MAX_BUBBLES = 150;
export const DEFAULT_TOP_SHARE = 0.005;

export function pickBubbles(trades: Trade[], options: BubbleOptions): { bubbles: Bubble[]; threshold: number | null; seen: number } {
  const max = options.max ?? DEFAULT_MAX_BUBBLES;
  const inView = trades.filter((t) => t.time >= options.from && t.time < options.to && t.qty > 0 && t.price > 0);
  if (!inView.length) return { bubbles: [], threshold: null, seen: 0 };
  const notionals = inView.map((t) => t.price * t.qty).sort((a, b) => a - b);
  let threshold: number;
  const fixed = Boolean(options.minNotional && options.minNotional > 0);
  if (fixed) {
    threshold = options.minNotional as number;
  } else {
    // Fewer than a few hundred orders can't define a "top 0.5%": show none
    // rather than call the five biggest of a quiet minute whales.
    if (inView.length < 200) return { bubbles: [], threshold: null, seen: inView.length };
    const share = options.topShare ?? DEFAULT_TOP_SHARE;
    threshold = notionals[Math.min(notionals.length - 1, Math.floor(notionals.length * (1 - share)))];
  }
  const big = inView
    .map((t): Bubble => ({ id: t.id, time: t.time, price: t.price, qty: t.qty, notional: t.price * t.qty, side: t.buyerIsMaker ? "VENTA" : "COMPRA" }))
    // Automatic mode demands strictly above the percentile: when hundreds of
    // orders share the same small size, the percentile lands on that size and
    // ">=" would turn all of them into "large" orders.
    .filter((b) => (fixed ? b.notional >= threshold : b.notional > threshold))
    .sort((a, b) => b.notional - a.notional)
    .slice(0, max)
    // Smallest first, so the largest are drawn on top.
    .sort((a, b) => a.notional - b.notional || a.time - b.time);
  return { bubbles: big, threshold, seen: inView.length };
}

/** Radius with area proportional to size, between rMin and rMax. */
export function bubbleRadius(notional: number, largest: number, rMin = 3, rMax = 18): number {
  if (!(largest > 0) || !(notional > 0)) return rMin;
  return Math.max(rMin, Math.min(rMax, rMax * Math.sqrt(notional / largest)));
}

export function dollarsShort(v: number): string {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, "").replace(".", ",")}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}
