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
