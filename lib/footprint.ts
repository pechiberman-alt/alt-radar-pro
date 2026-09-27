/**
 * Order-flow for the map: candle delta, CVD and footprint cells.
 *
 * Two levels, with different data behind each:
 *
 *  - DELTA per candle comes from Binance's own kline field "taker buy base
 *    volume": buy = aggressive buying, sell = volume − buy. Real for every
 *    historical candle, no extra request.
 *  - FOOTPRINT (volume by price inside a candle, split by aggressor) needs the
 *    individual trades. Those exist only for recent candles — the ones covered
 *    by the trades fetched on load plus the live stream — so the footprint is
 *    drawn only there, and a candle whose trades were not all seen is marked
 *    partial instead of being passed off as complete.
 */

export type Trade = { id: number; price: number; qty: number; time: number; buyerIsMaker: boolean };
export type Cell = { buy: number; sell: number };
export type Footprint = {
  time: number;
  bucket: number;
  cells: Map<number, Cell>;
  buy: number;
  sell: number;
  poc: number | null;
  /** True when trades were seen from the candle's open onward. */
  complete: boolean;
};

export function candleDelta(volume: number, takerBuy: number | undefined) {
  if (takerBuy === undefined || !Number.isFinite(takerBuy)) return null;
  const buy = Math.max(0, Math.min(volume, takerBuy));
  return { buy, sell: volume - buy, delta: buy - (volume - buy) };
}

export function cumulativeDelta(deltas: (number | null)[]): (number | null)[] {
  let sum = 0;
  let seen = false;
  return deltas.map((d) => {
    if (d === null) return seen ? sum : null;
    seen = true;
    sum += d;
    return sum;
  });
}

/** A round bucket so a typical candle spans roughly 8–14 rows. */
export function bucketSize(ranges: number[]): number {
  const sorted = ranges.filter((r) => r > 0).sort((a, b) => a - b);
  if (!sorted.length) return 1;
  const median = sorted[Math.floor(sorted.length / 2)];
  const raw = median / 10;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
}

const bucketOf = (price: number, size: number) => Math.floor(price / size + 1e-9) * size;

/**
 * Groups trades into the candles they belong to. `firstTradeTime` is the
 * earliest trade seen: a candle opening before it is partial.
 */
export function buildFootprints(
  trades: Trade[],
  candleTimes: number[],
  frameMs: number,
  size: number,
  firstTradeTime: number,
): Map<number, Footprint> {
  const out = new Map<number, Footprint>();
  if (!trades.length || !candleTimes.length) return out;
  const earliest = candleTimes[0];
  for (const t of trades) {
    if (t.time < earliest) continue;
    const open = Math.floor((t.time - earliest) / frameMs) * frameMs + earliest;
    let fp = out.get(open);
    if (!fp) {
      fp = { time: open, bucket: size, cells: new Map(), buy: 0, sell: 0, poc: null, complete: open >= firstTradeTime };
      out.set(open, fp);
    }
    const key = bucketOf(t.price, size);
    const cell = fp.cells.get(key) ?? { buy: 0, sell: 0 };
    // A trade whose buyer was the maker was an aggressive SELL.
    if (t.buyerIsMaker) {
      cell.sell += t.qty;
      fp.sell += t.qty;
    } else {
      cell.buy += t.qty;
      fp.buy += t.qty;
    }
    fp.cells.set(key, cell);
  }
  for (const fp of out.values()) {
    let best = -1;
    for (const [price, c] of fp.cells) {
      if (c.buy + c.sell > best) {
        best = c.buy + c.sell;
        fp.poc = price;
      }
    }
  }
  return out;
}

/** Diagonal imbalance as footprint tools read it: aggressive buying at a
 *  level against aggressive selling one level below (and the mirror), at 3×. */
export function imbalance(fp: Footprint, price: number, ratio = 3): "COMPRA" | "VENTA" | null {
  const here = fp.cells.get(price);
  if (!here) return null;
  const below = fp.cells.get(Number((price - fp.bucket).toFixed(10)))?.sell ?? 0;
  const above = fp.cells.get(Number((price + fp.bucket).toFixed(10)))?.buy ?? 0;
  const min = (fp.buy + fp.sell) * 0.02;
  if (here.buy >= min && here.buy >= ratio * Math.max(below, 1e-12)) return "COMPRA";
  if (here.sell >= min && here.sell >= ratio * Math.max(above, 1e-12)) return "VENTA";
  return null;
}

export function parseAggTrade(raw: unknown): Trade | null {
  const r = raw as { a?: number; p?: string; q?: string; T?: number; m?: boolean } | null;
  const price = Number(r?.p);
  const qty = Number(r?.q);
  if (!r || !(price > 0) || !(qty > 0) || typeof r.T !== "number" || typeof r.m !== "boolean") return null;
  return { id: Number(r.a ?? 0), price, qty, time: r.T, buyerIsMaker: r.m };
}

/**
 * Stacked imbalance: several consecutive price levels imbalanced the same
 * direction — the footprint pattern traders actually call a signal, as
 * opposed to one isolated imbalanced cell, which is common and not on its
 * own meaningful. Built directly on `imbalance()`, not a second reading of
 * the same cells.
 *
 * `position` says where in the candle's own range the stack sits — TECHO
 * (near the high) or BASE (near the low) reads very differently from MEDIO
 * (mid-candle): a buy stack at the base of a candle that closed near its
 * low is absorption a reader would want to know about; the same stack in
 * the middle of a wide candle is far less informative. This function
 * reports the fact; it doesn't tell you what to do with it.
 */
export type StackedImbalance = {
  side: "COMPRA" | "VENTA";
  /** How many consecutive same-direction imbalanced levels. */
  levels: number;
  low: number;
  high: number;
  position: "TECHO" | "BASE" | "MEDIO";
};

export function findStackedImbalances(
  fp: Footprint,
  candleHigh: number,
  candleLow: number,
  ratio = 3,
  minStack = 3,
): StackedImbalance[] {
  const prices = [...fp.cells.keys()].sort((a, b) => a - b);
  const sides = prices.map((p) => imbalance(fp, p, ratio));
  const range = candleHigh - candleLow;

  const runs: StackedImbalance[] = [];
  let i = 0;
  while (i < sides.length) {
    const side = sides[i];
    if (side === null) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < sides.length && sides[j] === side) j += 1;
    const levels = j - i;
    if (levels >= minStack) {
      const low = prices[i];
      const high = prices[j - 1] + fp.bucket;
      const mid = (low + high) / 2;
      const relPos = range > 0 ? (mid - candleLow) / range : 0.5;
      const position = relPos >= 0.66 ? "TECHO" : relPos <= 0.33 ? "BASE" : "MEDIO";
      runs.push({ side, levels, low, high, position });
    }
    i = j;
  }
  return runs;
}
