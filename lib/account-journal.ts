import type { FuturesLogRow } from "./futures-log.ts";

/**
 * The account journal: turns the raw executions of a real Binance account
 * (futures and spot) into TRADES — a position from opening to closing — and
 * measures them.
 *
 * WHERE THE EXECUTIONS COME FROM
 *   live   futures fills recorded from the account's private stream
 *   sync   spot fills read from Binance (myTrades)
 *   import rows of a file exported from Binance's website
 *
 * HOW FUTURES FILLS BECOME TRADES
 * Fills are walked in time order per symbol. One-way mode keeps a single net
 * position (a fill against it reduces it, and if it is bigger than the position
 * it closes it and opens the other way, splitting the fill); hedge mode keeps
 * the LONG and SHORT books apart. A trade ends when its position returns to
 * flat. PnL is Binance's own realised figure when the fill carries one, else
 * (entry average − price) × size, which is the same average-entry method
 * Binance uses.
 *
 * HOW SPOT FILLS BECOME TRADES
 * Spot has no positions or realised PnL, so this uses average cost: buys build
 * a cost basis, sells realise against it, and a trade is the stretch from
 * holding nothing to holding nothing. Fees are taken in the received asset on
 * Binance, so a buy fee in the base asset shrinks the units held (and raises
 * the cost per unit), and a sell fee comes out of the proceeds.
 *
 * WHAT IT REFUSES TO GUESS
 * A closing fill with no known opening (the record starts mid-position) becomes
 * an INCOMPLETE trade, marked as such. A spot sale of more than the record
 * shows was bought (deposit, transfer, Earn, convert) is incomplete with an
 * unknown result, and is left out of every statistic. Spot pairs quoted in a
 * coin (ETHBTC) are not analysed — their PnL is in that coin. Fees paid in BNB
 * or any other non-dollar asset are reported apart, never converted at a guess.
 */

export type Market = "futures" | "spot";
export type FillSource = "live" | "sync" | "import";

export type JFill = {
  id: string;
  market: Market;
  source: FillSource;
  time: number;
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  qty: number;
  fee: number;
  feeAsset: string;
  /** Realised PnL as Binance reported it (futures live fills); null when unknown. */
  realizedPnl: number | null;
  positionSide: string;
  liquidation: boolean;
};

export type JFunding = { time: number; symbol: string | null; asset: string; amount: number };

export const DOLLARS = new Set(["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "USDP", "DAI"]);
const QUOTES = [
  "FDUSD", "USDT", "USDC", "BUSD", "TUSD", "USDP", "DAI",
  "BTC", "ETH", "BNB", "EUR", "TRY", "BRL", "ARS", "GBP", "AUD", "RUB", "UAH", "PLN", "RON", "JPY", "ZAR", "IDR", "NGN", "MXN", "COP", "CZK",
];

export function splitSymbol(symbol: string): { base: string; quote: string } | null {
  for (const quote of QUOTES) {
    if (symbol.length > quote.length && symbol.endsWith(quote)) return { base: symbol.slice(0, -quote.length), quote };
  }
  return null;
}

export function fromFuturesLog(rows: FuturesLogRow[]): { fills: JFill[]; fundings: JFunding[] } {
  const fills: JFill[] = [];
  const fundings: JFunding[] = [];
  for (const r of rows) {
    if (r.kind === "funding") fundings.push({ time: r.time, symbol: r.symbol, asset: r.asset, amount: r.amount });
    else {
      fills.push({
        id: r.id, market: "futures", source: "live", time: r.time, symbol: r.symbol, side: r.side, price: r.price, qty: r.qty,
        fee: r.commission, feeAsset: r.commissionAsset, realizedPnl: r.realizedPnl, positionSide: r.positionSide || "BOTH", liquidation: r.liquidation,
      });
    }
  }
  return { fills, fundings };
}

export type SpotApiFill = {
  symbol: string; id: number; price: string; qty: string; commission?: string; commissionAsset?: string; isBuyer: boolean; time: number;
};
export function fromSpotApi(f: SpotApiFill): JFill | null {
  const price = Number(f.price);
  const qty = Number(f.qty);
  if (!(price > 0) || !(qty > 0) || !Number.isFinite(f.time) || !f.symbol) return null;
  return {
    id: `${f.symbol}-${f.id}`, market: "spot", source: "sync", time: f.time, symbol: f.symbol, side: f.isBuyer ? "BUY" : "SELL", price, qty,
    fee: Math.abs(Number(f.commission) || 0), feeAsset: (f.commissionAsset ?? "").toUpperCase(), realizedPnl: null, positionSide: "BOTH", liquidation: false,
  };
}

// ─── trades ───────────────────────────────────────────────────────────────

export type TradeStatus = "cerrada" | "abierta" | "incompleta";

export type JTrade = {
  key: string;
  market: Market;
  symbol: string;
  direction: "LONG" | "SHORT";
  status: TradeStatus;
  reason: string | null;
  openTime: number;
  closeTime: number | null;
  entry: number | null;
  exit: number | null;
  /** Largest size held during the trade, in the base asset / contracts. */
  qty: number;
  /** Result before fees and funding. */
  gross: number | null;
  /** Fees paid in dollar stablecoins. */
  fees: number;
  feesOther: Record<string, number>;
  funding: number;
  /** gross − fees + funding. Null when the result is unknown. */
  net: number | null;
  liquidation: boolean;
  fills: JFill[];
  holdMs: number | null;
};

const byTime = (a: JFill, b: JFill) => a.time - b.time || a.id.localeCompare(b.id);
const epsFor = (peak: number) => Math.max(1e-12, peak * 1e-9);
const tradeKey = (market: Market, symbol: string, openTime: number, dir: 1 | -1) => `${market}:${symbol}:${openTime}:${dir > 0 ? "L" : "S"}`;

type Acc = {
  dir: 1 | -1; qty: number; peak: number; avg: number; openTime: number;
  entryNotional: number; entryQty: number; exitNotional: number; exitQty: number;
  gross: number; fees: number; feesOther: Record<string, number>; liquidation: boolean; fills: JFill[]; symbol: string;
};

function addFee(acc: { fees: number; feesOther: Record<string, number> }, f: JFill, share: number) {
  const amount = f.fee * share;
  if (!amount) return;
  if (DOLLARS.has(f.feeAsset)) acc.fees += amount;
  else acc.feesOther[f.feeAsset || "?"] = (acc.feesOther[f.feeAsset || "?"] ?? 0) + amount;
}

function finishFutures(acc: Acc, closeTime: number | null): JTrade {
  const closed = closeTime !== null;
  return {
    key: tradeKey("futures", acc.symbol, acc.openTime, acc.dir), market: "futures", symbol: acc.symbol, direction: acc.dir > 0 ? "LONG" : "SHORT",
    status: closed ? "cerrada" : "abierta", reason: null, openTime: acc.openTime, closeTime,
    entry: acc.entryQty > 0 ? acc.entryNotional / acc.entryQty : null, exit: acc.exitQty > 0 ? acc.exitNotional / acc.exitQty : null,
    qty: closed ? acc.peak : acc.qty, gross: acc.gross, fees: acc.fees, feesOther: acc.feesOther, funding: 0,
    net: closed ? acc.gross - acc.fees : null, liquidation: acc.liquidation, fills: acc.fills, holdMs: closed ? closeTime - acc.openTime : null,
  };
}

export function futuresTrades(input: JFill[]): JTrade[] {
  const fills = input.filter((f) => f.market === "futures" && f.qty > 0).sort(byTime);
  const books = new Map<string, Acc | null>();
  const out: JTrade[] = [];

  for (const f of fills) {
    const bookKey = `${f.symbol}|${f.positionSide || "BOTH"}`;
    const bookDir: 0 | 1 | -1 = f.positionSide === "LONG" ? 1 : f.positionSide === "SHORT" ? -1 : 0;
    const fd: 1 | -1 = f.side === "BUY" ? 1 : -1;
    let acc = books.get(bookKey) ?? null;
    let remaining = f.qty;
    // Only a fill that meets a flat book can be a closing whose opening we never
    // saw. What is left of a fill after it closed a position is an opening.
    let first = true;

    while (remaining > f.qty * 1e-9) {
      const wasFirst = first;
      first = false;
      if (!acc) {
        const closesUnknown = wasFirst && ((bookDir !== 0 && fd !== bookDir) || (bookDir === 0 && f.realizedPnl !== null && f.realizedPnl !== 0));
        if (closesUnknown) {
          const dir = (bookDir || -fd) as 1 | -1;
          const pnl = f.realizedPnl;
          const share = remaining / f.qty;
          const fees = { fees: 0, feesOther: {} as Record<string, number> };
          addFee(fees, f, share);
          out.push({
            key: tradeKey("futures", f.symbol, f.time, dir), market: "futures", symbol: f.symbol, direction: dir > 0 ? "LONG" : "SHORT",
            status: "incompleta", reason: "La apertura es anterior al registro: entrada estimada a partir del resultado que informó Binance.",
            openTime: f.time, closeTime: f.time, entry: pnl === null ? null : f.price - (dir * pnl) / f.qty, exit: f.price,
            qty: remaining, gross: pnl === null ? null : pnl * share, fees: fees.fees, feesOther: fees.feesOther, funding: 0,
            net: pnl === null ? null : pnl * share - fees.fees, liquidation: f.liquidation, fills: [f], holdMs: null,
          });
          remaining = 0;
          break;
        }
        const dir = (bookDir || fd) as 1 | -1;
        acc = {
          dir, qty: remaining, peak: remaining, avg: f.price, openTime: f.time, entryNotional: f.price * remaining, entryQty: remaining,
          exitNotional: 0, exitQty: 0, gross: 0, fees: 0, feesOther: {}, liquidation: false, fills: [f], symbol: f.symbol,
        };
        addFee(acc, f, remaining / f.qty);
        remaining = 0;
        break;
      }
      if (fd === acc.dir) {
        acc.avg = (acc.avg * acc.qty + f.price * remaining) / (acc.qty + remaining);
        acc.qty += remaining;
        acc.peak = Math.max(acc.peak, acc.qty);
        acc.entryNotional += f.price * remaining;
        acc.entryQty += remaining;
        acc.fills.push(f);
        addFee(acc, f, remaining / f.qty);
        remaining = 0;
        break;
      }
      const closeQty = Math.min(acc.qty, remaining);
      // Binance's realised figure on a fill comes entirely from the part that
      // closes (the part that opens realises nothing), so it is never prorated.
      const pnl = f.realizedPnl !== null ? f.realizedPnl : (f.price - acc.avg) * closeQty * acc.dir;
      acc.gross += pnl;
      acc.exitNotional += f.price * closeQty;
      acc.exitQty += closeQty;
      acc.qty -= closeQty;
      acc.liquidation = acc.liquidation || f.liquidation;
      if (acc.fills[acc.fills.length - 1] !== f) acc.fills.push(f);
      addFee(acc, f, closeQty / f.qty);
      remaining -= closeQty;
      if (acc.qty <= epsFor(acc.peak)) {
        out.push(finishFutures(acc, f.time));
        acc = null;
        // A hedge book never flips; in one-way mode what is left opens the other way.
        if (bookDir !== 0) remaining = 0;
      } else {
        remaining = 0;
      }
    }
    books.set(bookKey, acc);
  }
  for (const acc of books.values()) if (acc) out.push(finishFutures(acc, null));
  return out;
}

/** Puts each funding payment on the trade that was open on that symbol when it
 *  was charged; a payment with no symbol or no open trade is returned apart. */
export function attachFunding(trades: JTrade[], fundings: JFunding[]): { trades: JTrade[]; unattributed: number } {
  const bySymbol = new Map<string, JTrade[]>();
  const copy = trades.map((t) => ({ ...t }));
  for (const t of copy) {
    if (t.market !== "futures") continue;
    (bySymbol.get(t.symbol) ?? bySymbol.set(t.symbol, []).get(t.symbol)!).push(t);
  }
  let unattributed = 0;
  for (const fnd of fundings) {
    if (!DOLLARS.has(fnd.asset)) continue;
    const target = fnd.symbol ? bySymbol.get(fnd.symbol)?.find((t) => fnd.time >= t.openTime && fnd.time <= (t.closeTime ?? Infinity)) : undefined;
    if (target) target.funding += fnd.amount;
    else unattributed += fnd.amount;
  }
  for (const t of copy) if (t.market === "futures" && t.gross !== null && t.status !== "abierta") t.net = t.gross - t.fees + t.funding;
  return { trades: copy, unattributed };
}

type SpotAcc = {
  symbol: string; openTime: number; entryNotional: number; entryQty: number; exitNotional: number; exitQty: number; peak: number;
  net: number; fees: number; feesOther: Record<string, number>; unknownCost: boolean; fills: JFill[]; sold: boolean;
};

export function spotTrades(input: JFill[]): { trades: JTrade[]; excluded: string[] } {
  const bySymbol = new Map<string, JFill[]>();
  for (const f of input) if (f.market === "spot" && f.qty > 0) (bySymbol.get(f.symbol) ?? bySymbol.set(f.symbol, []).get(f.symbol)!).push(f);
  const trades: JTrade[] = [];
  const excluded: string[] = [];

  for (const [symbol, list] of bySymbol) {
    const split = splitSymbol(symbol);
    if (!split || !DOLLARS.has(split.quote)) {
      excluded.push(symbol);
      continue;
    }
    const { base, quote } = split;
    let held = 0;
    let cost = 0;
    let acc: SpotAcc | null = null;
    const start = (f: JFill): SpotAcc => ({
      symbol, openTime: f.time, entryNotional: 0, entryQty: 0, exitNotional: 0, exitQty: 0, peak: 0, net: 0, fees: 0, feesOther: {},
      unknownCost: false, fills: [], sold: false,
    });
    const finish = (a: SpotAcc, closeTime: number | null) => {
      const closed = closeTime !== null;
      const known = !a.unknownCost;
      trades.push({
        key: tradeKey("spot", symbol, a.openTime, 1), market: "spot", symbol, direction: "LONG",
        status: !closed ? "abierta" : known ? "cerrada" : "incompleta",
        reason: a.unknownCost ? "Vendiste más de lo que figura comprado en el registro (depósito, transferencia, Earn o conversión): el resultado no se puede calcular." : null,
        openTime: a.openTime, closeTime, entry: a.entryQty > 0 ? a.entryNotional / a.entryQty : null, exit: a.exitQty > 0 ? a.exitNotional / a.exitQty : null,
        qty: a.peak, gross: known && (closed || a.sold) ? a.net + a.fees : null, fees: a.fees, feesOther: a.feesOther, funding: 0,
        net: known && (closed || a.sold) ? a.net : null, liquidation: false, fills: a.fills, holdMs: closed ? closeTime - a.openTime : null,
      });
    };

    for (const f of list.sort(byTime)) {
      const feeBase = f.feeAsset === base;
      const feeQuote = f.feeAsset === quote;
      const feeDollars = feeQuote ? f.fee : feeBase ? f.fee * f.price : 0;
      if (!acc) acc = start(f);
      acc.fills.push(f);
      if (feeDollars) acc.fees += feeDollars;
      else if (f.fee) acc.feesOther[f.feeAsset || "?"] = (acc.feesOther[f.feeAsset || "?"] ?? 0) + f.fee;

      if (f.side === "BUY") {
        held += f.qty - (feeBase ? f.fee : 0);
        cost += f.price * f.qty + (feeQuote ? f.fee : 0);
        acc.entryNotional += f.price * f.qty;
        acc.entryQty += f.qty;
        acc.peak = Math.max(acc.peak, held);
        continue;
      }
      const tol = Math.max(1e-12, acc.peak * 1e-6);
      const known = held > tol ? Math.min(f.qty, held) : 0;
      if (f.qty - known > Math.max(tol, f.qty * 1e-6)) acc.unknownCost = true;
      if (known > 0) {
        const costRemoved = cost * (known / held);
        acc.net += (f.price * f.qty - (feeQuote ? f.fee : feeBase ? f.fee * f.price : 0)) * (known / f.qty) - costRemoved;
        held -= known;
        cost -= costRemoved;
      }
      acc.exitNotional += f.price * f.qty;
      acc.exitQty += f.qty;
      acc.sold = true;
      // Closed: nothing left, or only dust (under 0.5% of the peak, or under one dollar).
      if (held <= acc.peak * 0.005 || held * f.price < 1) {
        finish(acc, f.time);
        acc = null;
        held = 0;
        cost = 0;
      }
    }
    if (acc) finish(acc, null);
  }
  return { trades, excluded };
}

export type JournalBuild = { trades: JTrade[]; unattributedFunding: number; excludedSpot: string[] };

export function buildJournal(fills: JFill[], fundings: JFunding[]): JournalBuild {
  const fut = attachFunding(futuresTrades(fills), fundings);
  const spot = spotTrades(fills);
  const trades = [...fut.trades, ...spot.trades].sort((a, b) => (b.closeTime ?? b.openTime) - (a.closeTime ?? a.openTime) || a.key.localeCompare(b.key));
  return { trades, unattributedFunding: fut.unattributed, excludedSpot: spot.excluded.sort() };
}

// ─── merging ──────────────────────────────────────────────────────────────

export function mergeJFills(...lists: JFill[][]): JFill[] {
  const seen = new Map<string, JFill>();
  for (const list of lists) for (const f of list) if (!seen.has(`${f.market}:${f.id}`)) seen.set(`${f.market}:${f.id}`, f);
  return [...seen.values()].sort(byTime);
}

/** Incoming fills that don't already exist. Two fills are the same execution if
 *  symbol, side, price and size match and their times are within tolerance; each
 *  existing fill absorbs at most one incoming one, so two genuine identical
 *  fills in the same second both survive. */
export function dropDuplicates(existing: JFill[], incoming: JFill[], toleranceMs = 1500): JFill[] {
  const pool = new Map<string, JFill[]>();
  for (const e of existing) {
    const k = `${e.market}|${e.symbol}|${e.side}`;
    (pool.get(k) ?? pool.set(k, []).get(k)!).push({ ...e });
  }
  const used = new Set<JFill>();
  const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  const out: JFill[] = [];
  const ids = new Set(existing.map((e) => `${e.market}:${e.id}`));
  for (const f of incoming) {
    if (ids.has(`${f.market}:${f.id}`)) continue;
    const candidates = pool.get(`${f.market}|${f.symbol}|${f.side}`) ?? [];
    const match = candidates.find((e) => !used.has(e) && near(e.price, f.price) && near(e.qty, f.qty) && Math.abs(e.time - f.time) <= toleranceMs);
    if (match) {
      used.add(match);
      continue;
    }
    out.push(f);
  }
  return out;
}

// ─── notes ────────────────────────────────────────────────────────────────

export type TradeNote = { stop: number | null; setup: string; emotion: string; rating: number | null; tags: string[]; notes: string };
export const EMPTY_NOTE: TradeNote = { stop: null, setup: "", emotion: "", rating: null, tags: [], notes: "" };

export function cleanNote(raw: unknown): TradeNote | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : v === undefined || v === null ? "" : null);
  const setup = text(r.setup, 60);
  const emotion = text(r.emotion, 60);
  const notes = text(r.notes, 2000);
  if (setup === null || emotion === null || notes === null) return null;
  const stop = r.stop === null || r.stop === undefined ? null : typeof r.stop === "number" && Number.isFinite(r.stop) && r.stop > 0 ? r.stop : undefined;
  const rating = r.rating === null || r.rating === undefined ? null : typeof r.rating === "number" && Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5 ? r.rating : undefined;
  if (stop === undefined || rating === undefined) return null;
  const tags = Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim().slice(0, 24)).filter(Boolean).slice(0, 10) : [];
  return { stop, setup, emotion, rating, tags, notes };
}

// ─── validation of rows sent by a browser ─────────────────────────────────

const SYMBOL = /^[A-Z0-9]{2,24}$/;
const ASSET = /^[A-Z0-9?]{1,12}$/;
const MIN_TIME = Date.UTC(2017, 0, 1);

export function validateJFill(raw: unknown, now = Date.now()): JFill | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const n = (k: string) => (typeof r[k] === "number" && Number.isFinite(r[k]) ? (r[k] as number) : null);
  const id = typeof r.id === "string" && r.id.length > 0 && r.id.length <= 120 ? r.id : null;
  const market = r.market === "futures" || r.market === "spot" ? r.market : null;
  const source = r.source === "live" || r.source === "sync" || r.source === "import" ? r.source : null;
  const symbol = typeof r.symbol === "string" && SYMBOL.test(r.symbol) ? r.symbol : null;
  const side = r.side === "BUY" || r.side === "SELL" ? r.side : null;
  const feeAsset = r.feeAsset === "" ? "" : typeof r.feeAsset === "string" && ASSET.test(r.feeAsset) ? r.feeAsset : null;
  const positionSide = r.positionSide === "BOTH" || r.positionSide === "LONG" || r.positionSide === "SHORT" ? r.positionSide : null;
  const time = n("time");
  const price = n("price");
  const qty = n("qty");
  const fee = n("fee");
  const realizedPnl = r.realizedPnl === null ? null : n("realizedPnl");
  if (!id || !market || !source || !symbol || !side || feeAsset === null || !positionSide) return null;
  if (time === null || time < MIN_TIME || time > now + 86_400_000) return null;
  if (price === null || !(price > 0) || qty === null || !(qty > 0) || fee === null || fee < 0) return null;
  if (r.realizedPnl !== null && realizedPnl === null) return null;
  if (typeof r.liquidation !== "boolean") return null;
  return { id, market, source, time, symbol, side, price, qty, fee, feeAsset, realizedPnl, positionSide, liquidation: r.liquidation };
}

// ─── statistics ───────────────────────────────────────────────────────────

export type EquityPoint = { t: number; cum: number; dd: number; key: string };
export type JournalStats = {
  count: number; wins: number; losses: number; flat: number; winRate: number | null; profitFactor: number | null;
  expectancy: number | null; avgWin: number | null; avgLoss: number | null; payoff: number | null;
  net: number; gross: number; fees: number; funding: number; feesOther: Record<string, number>;
  best: JTrade | null; worst: JTrade | null;
  longestWin: number; longestLoss: number; currentStreak: { count: number; kind: "ganadora" | "perdedora" | "ninguna" };
  maxDrawdown: number; equity: EquityPoint[]; avgHoldMs: number | null;
  avgR: number | null; rCount: number;
  confidence: "SIN MUESTRA" | "MUESTRA MÍNIMA" | "MUESTRA RAZONABLE";
};

/** R multiple: the result over what the stop would have lost. Needs an entry
 *  and a stop on the right side of it; null otherwise. */
export function rMultiple(t: JTrade, stop: number | null | undefined): number | null {
  if (!stop || t.entry === null || t.net === null || !(t.qty > 0)) return null;
  if (t.direction === "LONG" ? stop >= t.entry : stop <= t.entry) return null;
  const risk = Math.abs(t.entry - stop) * t.qty;
  return risk > 0 ? t.net / risk : null;
}

export function countable(trades: JTrade[]): JTrade[] {
  return trades.filter((t) => t.status !== "abierta" && t.net !== null && t.closeTime !== null);
}

export function journalStats(all: JTrade[], stopOf: (key: string) => number | null = () => null): JournalStats {
  const list = countable(all).sort((a, b) => (a.closeTime as number) - (b.closeTime as number) || a.key.localeCompare(b.key));
  const wins = list.filter((t) => (t.net as number) > 0);
  const losses = list.filter((t) => (t.net as number) < 0);
  const gain = wins.reduce((s, t) => s + (t.net as number), 0);
  const loss = losses.reduce((s, t) => s - (t.net as number), 0);
  const feesOther: Record<string, number> = {};
  for (const t of list) for (const [a, v] of Object.entries(t.feesOther)) feesOther[a] = (feesOther[a] ?? 0) + v;

  let cum = 0;
  let peak = 0;
  let maxDd = 0;
  const equity: EquityPoint[] = list.map((t) => {
    cum += t.net as number;
    peak = Math.max(peak, cum);
    const dd = peak - cum;
    maxDd = Math.max(maxDd, dd);
    return { t: t.closeTime as number, cum, dd, key: t.key };
  });

  let longestWin = 0;
  let longestLoss = 0;
  let run = 0;
  let runKind: "w" | "l" | "" = "";
  for (const t of list) {
    const kind = (t.net as number) > 0 ? "w" : (t.net as number) < 0 ? "l" : "";
    run = kind && kind === runKind ? run + 1 : kind ? 1 : 0;
    runKind = kind;
    if (kind === "w") longestWin = Math.max(longestWin, run);
    if (kind === "l") longestLoss = Math.max(longestLoss, run);
  }

  const rs = list.map((t) => rMultiple(t, stopOf(t.key))).filter((r): r is number => r !== null);
  const holds = list.map((t) => t.holdMs).filter((h): h is number => h !== null);
  const net = list.reduce((s, t) => s + (t.net as number), 0);
  return {
    count: list.length, wins: wins.length, losses: losses.length, flat: list.length - wins.length - losses.length,
    winRate: list.length ? wins.length / list.length : null,
    profitFactor: loss > 0 ? gain / loss : gain > 0 ? Infinity : null,
    expectancy: list.length ? net / list.length : null,
    avgWin: wins.length ? gain / wins.length : null, avgLoss: losses.length ? loss / losses.length : null,
    payoff: wins.length && losses.length ? gain / wins.length / (loss / losses.length) : null,
    net, gross: list.reduce((s, t) => s + (t.gross as number), 0), fees: list.reduce((s, t) => s + t.fees, 0),
    funding: list.reduce((s, t) => s + t.funding, 0), feesOther,
    best: list.reduce<JTrade | null>((b, t) => (!b || (t.net as number) > (b.net as number) ? t : b), null),
    worst: list.reduce<JTrade | null>((b, t) => (!b || (t.net as number) < (b.net as number) ? t : b), null),
    longestWin, longestLoss,
    currentStreak: run > 0 ? { count: run, kind: runKind === "w" ? "ganadora" : "perdedora" } : { count: 0, kind: "ninguna" },
    maxDrawdown: maxDd, equity, avgHoldMs: holds.length ? holds.reduce((s, h) => s + h, 0) / holds.length : null,
    avgR: rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : null, rCount: rs.length,
    confidence: list.length === 0 ? "SIN MUESTRA" : list.length < 15 ? "MUESTRA MÍNIMA" : "MUESTRA RAZONABLE",
  };
}

export type TradeGroup = { key: string; count: number; wins: number; net: number; profitFactor: number | null };

export function groupTrades(all: JTrade[], keyOf: (t: JTrade) => string): TradeGroup[] {
  const map = new Map<string, JTrade[]>();
  for (const t of countable(all)) {
    const k = keyOf(t);
    (map.get(k) ?? map.set(k, []).get(k)!).push(t);
  }
  return [...map.entries()].map(([key, list]) => {
    const gain = list.filter((t) => (t.net as number) > 0).reduce((s, t) => s + (t.net as number), 0);
    const loss = list.filter((t) => (t.net as number) < 0).reduce((s, t) => s - (t.net as number), 0);
    return { key, count: list.length, wins: list.filter((t) => (t.net as number) > 0).length, net: gain - loss, profitFactor: loss > 0 ? gain / loss : gain > 0 ? Infinity : null };
  });
}

/** Net result of the trades closed on the given day (as named by `dayOf`). */
export function netOnDay(trades: JTrade[], day: string, dayOf: (t: number) => string): number {
  return countable(trades).filter((t) => dayOf(t.closeTime as number) === day).reduce((s, t) => s + (t.net as number), 0);
}

export function tradesCsv(trades: JTrade[], formatTime: (t: number) => string, notes: (key: string) => TradeNote | undefined): string {
  const n = (v: number | null, d = 8) => (v === null || !Number.isFinite(v) ? "" : String(Number(v.toFixed(d))).replace(".", ","));
  const text = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const header = [
    "Mercado", "Par", "Dirección", "Estado", "Apertura", "Cierre", "Duración (min)", "Entrada", "Salida", "Tamaño", "Resultado bruto", "Comisiones",
    "Funding", "Resultado neto", "R", "Stop planificado", "Setup", "Emoción", "Puntaje", "Etiquetas", "Notas", "Aviso",
  ];
  const lines = trades.map((t) => {
    const note = notes(t.key);
    const r = rMultiple(t, note?.stop ?? null);
    return [
      t.market === "futures" ? "Futuros" : "Spot", text(t.symbol), t.direction, t.status, text(formatTime(t.openTime)), t.closeTime ? text(formatTime(t.closeTime)) : "",
      t.holdMs === null ? "" : n(t.holdMs / 60000, 1), n(t.entry), n(t.exit), n(t.qty), n(t.gross, 2), n(t.fees, 2), n(t.funding, 2), n(t.net, 2), n(r, 2),
      n(note?.stop ?? null), text(note?.setup ?? ""), text(note?.emotion ?? ""), note?.rating ? String(note.rating) : "", text((note?.tags ?? []).join(", ")),
      text(note?.notes ?? ""), text(t.reason ?? ""),
    ].join(";");
  });
  return `\uFEFF${[header.join(";"), ...lines].join("\r\n")}\r\n`;
}
