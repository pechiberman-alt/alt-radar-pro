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
  /** Value area low and high, as level prices (the same keys as `cells`), from `valueArea`. Absent where not computed. */
  val?: number | null;
  vah?: number | null;
  /**
   * Trades missing from the candle, found by the gaps in Binance's aggregate-trade ids, which are consecutive per
   * symbol. 0 = no id is missing between the trades seen; null = the ids can't be checked (missing or not integers).
   * Absent where not computed.
   */
  gaps?: number | null;
  /** True when trades were seen from the candle's open onward and no aggregate-trade id is missing. */
  complete: boolean;
};

/** Share of the volume the value area holds. */
export const VALUE_AREA_FRACTION = 0.7;

export type ValueArea = { poc: number; val: number; vah: number; total: number; inside: number };

/**
 * Point of control and value area of a set of price levels (volume in any unit: base, quote, contracts).
 *
 * POC: the level with the most volume. On a tie, the one nearest the middle of the traded range, then the lower one,
 * so the result never depends on the order the trades arrived in.
 *
 * Value area: the CONTIGUOUS band around the POC that holds `fraction` of the volume (70% by default), built the way
 * Market Profile and volume-profile tools build it (the CBOT method): from the POC, compare the next two levels above
 * with the next two below (a level with no trades counts as zero), add the pair with more volume (on a tie, both) and
 * repeat until the band holds the fraction. It can overshoot slightly, because levels are added two at a time.
 * `val` and `vah` are level prices, like `poc`, not band edges. Null when there is no volume.
 */
export function valueArea(levels: { price: number; volume: number }[], step: number, fraction = VALUE_AREA_FRACTION): ValueArea | null {
  if (!(step > 0) || !(fraction > 0)) return null;
  const vol = new Map<number, number>();
  for (const l of levels) {
    if (!Number.isFinite(l.price) || !(l.volume > 0)) continue;
    const i = Math.round(l.price / step);
    vol.set(i, (vol.get(i) ?? 0) + l.volume);
  }
  if (!vol.size) return null;
  let lowI = Infinity;
  let highI = -Infinity;
  let total = 0;
  for (const [i, v] of vol) {
    lowI = Math.min(lowI, i);
    highI = Math.max(highI, i);
    total += v;
  }
  const mid = (lowI + highI) / 2;
  let poc = lowI;
  for (const [i, v] of vol) {
    const best = vol.get(poc) ?? 0;
    const nearer = Math.abs(i - mid) < Math.abs(poc - mid) || (Math.abs(i - mid) === Math.abs(poc - mid) && i < poc);
    if (v > best || (v === best && nearer)) poc = i;
  }
  const at = (i: number) => (i >= lowI && i <= highI ? (vol.get(i) ?? 0) : 0);
  const target = total * Math.min(1, fraction);
  let lo = poc;
  let hi = poc;
  let inside = at(poc);
  while (inside < target && (lo > lowI || hi < highI)) {
    const up = hi < highI ? at(hi + 1) + at(hi + 2) : -1;
    const down = lo > lowI ? at(lo - 1) + at(lo - 2) : -1;
    if (up >= down) {
      hi = Math.min(hi + 2, highI);
      inside += up;
    }
    if (down >= up) {
      lo = Math.max(lo - 2, lowI);
      inside += down;
    }
  }
  return { poc: poc * step, val: lo * step, vah: hi * step, total, inside };
}

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
 * earliest trade seen: a candle opening before it is partial. So is a candle
 * with a gap in the aggregate-trade ids (a dropped socket, a missing REST
 * page): the trades it shows are real, but not all of them. A gap between two
 * candles marks both, because the missing trades could belong to either. The
 * same trade id counted twice (a REST page and the live stream) counts once.
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
  const seen = new Set<number>();
  const ids = new Map<number, { min: number; max: number; count: number; checkable: boolean }>();
  for (const t of trades) {
    if (t.time < earliest) continue;
    const checkable = Number.isInteger(t.id) && t.id > 0;
    if (checkable) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
    }
    const open = Math.floor((t.time - earliest) / frameMs) * frameMs + earliest;
    let fp = out.get(open);
    if (!fp) {
      fp = { time: open, bucket: size, cells: new Map(), buy: 0, sell: 0, poc: null, val: null, vah: null, gaps: null, complete: false };
      out.set(open, fp);
      ids.set(open, { min: Infinity, max: -Infinity, count: 0, checkable: true });
    }
    const r = ids.get(open)!;
    if (checkable) {
      r.min = Math.min(r.min, t.id);
      r.max = Math.max(r.max, t.id);
      r.count += 1;
    } else {
      r.checkable = false;
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
  const ordered = [...out.values()].sort((a, b) => a.time - b.time);
  const gaps = new Map<number, number | null>();
  for (const fp of ordered) {
    const r = ids.get(fp.time)!;
    gaps.set(fp.time, r.checkable && r.count > 0 ? r.max - r.min + 1 - r.count : null);
  }
  for (let k = 1; k < ordered.length; k += 1) {
    const a = ids.get(ordered[k - 1].time)!;
    const b = ids.get(ordered[k].time)!;
    if (!a.checkable || !b.checkable) continue;
    const between = b.min - a.max - 1;
    for (const time of [ordered[k - 1].time, ordered[k].time]) {
      const g = gaps.get(time);
      // Ids running backwards across candles can't be checked; missing ones count against both candles.
      if (g !== null && g !== undefined) gaps.set(time, between < 0 ? null : g + between);
    }
  }
  for (const fp of ordered) {
    const area = valueArea([...fp.cells].map(([price, c]) => ({ price, volume: c.buy + c.sell })), fp.bucket);
    fp.poc = area?.poc ?? null;
    fp.val = area?.val ?? null;
    fp.vah = area?.vah ?? null;
    fp.gaps = gaps.get(fp.time) ?? null;
    fp.complete = fp.time >= firstTradeTime && fp.gaps === 0;
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

/**
 * Who is winning: aggressive buyers or aggressive sellers.
 *
 * Every trade has one side that crossed the spread to get filled — that side
 * is the aggressor. Binance publishes, on every kline of every timeframe, how
 * much of the candle's volume was bought by aggressors ("taker buy base
 * volume"); the remainder was sold by them. So this reads the same fact the
 * footprint cells do, but from data that exists for the whole loaded history
 * on any timeframe, not only for the recent candles whose individual trades
 * this session happened to capture.
 *
 * It reports a fact about who was more aggressive, with the numbers behind
 * it — not a forecast. Aggression doesn't guarantee direction: when one side
 * is clearly winning the fight but price isn't following, that is itself the
 * reading (the other side is absorbing), and it gets said rather than hidden.
 */
export type FlowCandle = { open: number; close: number; volume: number; takerBuy?: number };
export type FlowWinner = "COMPRADORES" | "VENDEDORES" | "EQUILIBRADO";

export type FlowVerdict = {
  winner: FlowWinner;
  /** Null when balanced. */
  strength: "FUERTE" | "MODERADO" | "LEVE" | null;
  /** Aggressive buying as a share of all volume, 0–100. */
  buyPct: number;
  /** Aggressive buy minus aggressive sell, in the candles' own volume unit. */
  delta: number;
  /** Candles that actually carried taker data. */
  candles: number;
  /** The same reading over just the latest candles, when there are more
   *  candles than that to compare against. */
  recent: { winner: FlowWinner; buyPct: number; candles: number } | null;
  priceChangePct: number | null;
  notes: string[];
};

// Aggressive share hovers around 50% in any ordinary tape, so a couple of
// points either side is noise, not a winner.
const BALANCED_BAND = 2;

function winnerOf(buyPct: number): { winner: FlowWinner; strength: FlowVerdict["strength"] } {
  const gap = buyPct - 50;
  const size = Math.abs(gap);
  if (size < BALANCED_BAND) return { winner: "EQUILIBRADO", strength: null };
  const strength = size >= 10 ? "FUERTE" : size >= 5 ? "MODERADO" : "LEVE";
  return { winner: gap > 0 ? "COMPRADORES" : "VENDEDORES", strength };
}

export function flowVerdict(candles: FlowCandle[], options: { recent?: number } = {}): FlowVerdict | null {
  const recentCount = options.recent ?? 5;
  const used = candles.filter(
    (c) => c.takerBuy !== undefined && Number.isFinite(c.takerBuy) && c.volume > 0,
  );
  if (used.length < 3) return null;

  const share = (list: FlowCandle[]) => {
    let buy = 0;
    let total = 0;
    for (const c of list) {
      buy += Math.max(0, Math.min(c.volume, c.takerBuy as number));
      total += c.volume;
    }
    return { buy, total, pct: total > 0 ? (buy / total) * 100 : 50 };
  };

  const whole = share(used);
  const { winner, strength } = winnerOf(whole.pct);
  const delta = whole.buy - (whole.total - whole.buy);

  let recent: FlowVerdict["recent"] = null;
  if (used.length > recentCount) {
    const r = share(used.slice(-recentCount));
    recent = { winner: winnerOf(r.pct).winner, buyPct: r.pct, candles: recentCount };
  }

  const first = candles[0];
  const last = candles[candles.length - 1];
  const priceChangePct = first.open > 0 ? ((last.close - first.open) / first.open) * 100 : null;

  const notes: string[] = [];
  if (winner !== "EQUILIBRADO" && strength !== "LEVE" && priceChangePct !== null && Math.abs(priceChangePct) >= 0.2) {
    if (winner === "COMPRADORES" && priceChangePct < 0) {
      notes.push("Compran agresivo pero el precio cae: los vendedores parecen estar absorbiendo.");
    } else if (winner === "VENDEDORES" && priceChangePct > 0) {
      notes.push("Venden agresivo pero el precio sube: los compradores parecen estar absorbiendo.");
    }
  }
  if (recent && winner !== "EQUILIBRADO" && recent.winner !== "EQUILIBRADO" && recent.winner !== winner) {
    notes.push(
      `Cambio reciente: en las últimas ${recent.candles} velas ganan ${recent.winner.toLowerCase()} (${recent.buyPct.toFixed(0)}% compra).`,
    );
  }

  return { winner, strength, buyPct: whole.pct, delta, candles: used.length, recent, priceChangePct, notes };
}

/** How many stacked-imbalance runs of each side the given footprints hold. */
export function stackTally(items: { fp: Footprint | null | undefined; high: number; low: number }[]) {
  let compra = 0;
  let venta = 0;
  let candles = 0;
  for (const item of items) {
    if (!item.fp) continue;
    candles += 1;
    for (const run of findStackedImbalances(item.fp, item.high, item.low)) {
      if (run.side === "COMPRA") compra += 1;
      else venta += 1;
    }
  }
  return { compra, venta, candles };
}
