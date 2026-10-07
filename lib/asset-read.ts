import { readPreBreak, type PreBreak } from "./pre-breakout.ts";
import type { SwingCandle } from "./swing-entries.ts";

/**
 * The technical read of one asset from its closed 1h candles: trend on 1h, 4h
 * and 1d (built from the same candles), the nearest supports and resistances
 * (swing points on 4h), volatility, volume against its week, and the
 * "a punto de romper" reading. Pure and cheap: the server core stores it for
 * 20 coins every 15 minutes and the browser computes it for any coin asked
 * about. Only candles closed by `now` are read.
 */

export type Trend = "ALCISTA" | "BAJISTA" | "LATERAL";
export type TfRead = { tf: "1h" | "4h" | "1d"; bars: number; trend: Trend; ema20: number; ema50: number | null; atrPct: number };
export type Level = { price: number; touches: number; distancePct: number };
export type AssetRead = {
  symbol: string;
  /** Open time of the last closed 1h candle. */
  at: number;
  price: number;
  change24h: number | null;
  change7d: number | null;
  change30d: number | null;
  tfs: TfRead[];
  /** All timeframes the same way, or mixed. */
  alignment: "ALCISTA" | "BAJISTA" | "MIXTA";
  supports: Level[];
  resistances: Level[];
  low48: number;
  high48: number;
  /** Volume of the last 24 hours against the daily average of the 7 days before. */
  volume24: number | null;
  preBreak: Pick<PreBreak, "state" | "side" | "score" | "level"> | null;
};

const H = 3_600_000;

export function ema(values: number[], n: number): number[] {
  const k = 2 / (n + 1);
  const out: number[] = [];
  values.forEach((v, i) => out.push(i === 0 ? v : v * k + out[i - 1] * (1 - k)));
  return out;
}

function atrPctOf(c: SwingCandle[], n = 14): number {
  if (c.length < 2) return 0;
  let s = 0;
  let k = 0;
  for (let i = Math.max(1, c.length - n); i < c.length; i += 1) {
    s += Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
    k += 1;
  }
  const last = c[c.length - 1].close;
  return k && last > 0 ? (s / k / last) * 100 : 0;
}

/** Groups closed 1h candles into `hours`-hour candles aligned to UTC (only complete groups). */
export function aggregate(c: SwingCandle[], hours: number): SwingCandle[] {
  const frame = hours * H;
  const out: SwingCandle[] = [];
  let group: SwingCandle[] = [];
  const flush = () => {
    if (group.length === hours) {
      out.push({
        openTime: group[0].openTime,
        open: group[0].open,
        high: Math.max(...group.map((x) => x.high)),
        low: Math.min(...group.map((x) => x.low)),
        close: group[group.length - 1].close,
        volume: group.reduce((a, x) => a + x.volume, 0),
        quoteVolume: group.reduce((a, x) => a + x.quoteVolume, 0),
      });
    }
    group = [];
  };
  for (const x of c) {
    const start = Math.floor(x.openTime / frame) * frame;
    if (group.length && Math.floor(group[0].openTime / frame) * frame !== start) flush();
    group.push(x);
  }
  flush();
  return out;
}

/** Trend of one timeframe: price and EMA20 on the same side of EMA50, with EMA20 sloping that way. */
export function trendOf(c: SwingCandle[], tf: TfRead["tf"]): TfRead | null {
  if (c.length < 25) return null;
  const closes = c.map((x) => x.close);
  const e20 = ema(closes, 20);
  const e50 = c.length >= 60 ? ema(closes, 50) : null;
  const last = closes[closes.length - 1];
  const now20 = e20[e20.length - 1];
  const slope = now20 / e20[e20.length - 6] - 1;
  const now50 = e50 ? e50[e50.length - 1] : null;
  const up = last > now20 && slope > 0 && (now50 === null || now20 > now50);
  const down = last < now20 && slope < 0 && (now50 === null || now20 < now50);
  return { tf, bars: c.length, trend: up ? "ALCISTA" : down ? "BAJISTA" : "LATERAL", ema20: now20, ema50: now50, atrPct: atrPctOf(c) };
}

/**
 * Supports and resistances from 4h swing points (a high or low that the two
 * candles on each side do not pass), merged when closer than half an ATR;
 * the nearest two on each side of price, with how many swings formed them.
 */
export function swingLevels(c4: SwingCandle[], price: number): { supports: Level[]; resistances: Level[] } {
  const recent = c4.slice(-120);
  const atr = (atrPctOf(recent) / 100) * price;
  const points: number[] = [];
  for (let i = 2; i < recent.length - 2; i += 1) {
    const w = recent.slice(i - 2, i + 3);
    if (recent[i].high === Math.max(...w.map((x) => x.high))) points.push(recent[i].high);
    if (recent[i].low === Math.min(...w.map((x) => x.low))) points.push(recent[i].low);
  }
  const clusters: { price: number; touches: number }[] = [];
  for (const p of points.sort((a, b) => a - b)) {
    const last = clusters[clusters.length - 1];
    if (last && atr > 0 && p - last.price <= atr * 0.5) {
      last.price = (last.price * last.touches + p) / (last.touches + 1);
      last.touches += 1;
    } else clusters.push({ price: p, touches: 1 });
  }
  const lv = (x: { price: number; touches: number }): Level => ({ price: x.price, touches: x.touches, distancePct: ((x.price - price) / price) * 100 });
  return {
    supports: clusters.filter((x) => x.price < price).sort((a, b) => b.price - a.price).slice(0, 2).map(lv),
    resistances: clusters.filter((x) => x.price > price).sort((a, b) => a.price - b.price).slice(0, 2).map(lv),
  };
}

export function readAsset(symbol: string, candles: SwingCandle[], now: number): AssetRead | null {
  const c = candles.filter((x) => x.openTime + H <= now).sort((a, b) => a.openTime - b.openTime);
  if (c.length < 60) return null;
  const last = c[c.length - 1];
  const back = (n: number) => (c.length > n ? last.close / c[c.length - 1 - n].close - 1 : null);
  const c4 = aggregate(c, 4);
  const c1d = aggregate(c, 24);
  const tfs = [trendOf(c, "1h"), trendOf(c4, "4h"), trendOf(c1d, "1d")].filter((x): x is TfRead => x !== null);
  const trends = new Set(tfs.map((t) => t.trend));
  const alignment = trends.size === 1 && !trends.has("LATERAL") ? (tfs[0].trend as "ALCISTA" | "BAJISTA") : "MIXTA";
  const recent = c.slice(-48);
  const vol24 = c.slice(-24).reduce((a, x) => a + x.volume, 0);
  const week = c.slice(-24 * 8, -24);
  const daily = week.length >= 24 * 3 ? (week.reduce((a, x) => a + x.volume, 0) / week.length) * 24 : 0;
  const pre = c.length >= 80 ? readPreBreak(c.slice(-200), symbol) : null;
  return {
    symbol,
    at: last.openTime,
    price: last.close,
    change24h: back(24),
    change7d: back(168),
    change30d: back(720),
    tfs,
    alignment,
    ...swingLevels(c4, last.close),
    low48: Math.min(...recent.map((x) => x.low)),
    high48: Math.max(...recent.map((x) => x.high)),
    volume24: daily > 0 ? vol24 / daily : null,
    preBreak: pre ? { state: pre.state, side: pre.side, score: pre.score, level: pre.level } : null,
  };
}

/** The read in a few numbers, for storage (the core's mind) and for the AIs. */
export function compactRead(r: AssetRead) {
  const n = (v: number | null, d = 4) => (v === null ? null : Number(v.toFixed(d)));
  const px = (v: number) => Number(v.toPrecision(6));
  return {
    precio: px(r.price),
    cambio24h: n(r.change24h),
    cambio7d: n(r.change7d),
    cambio30d: n(r.change30d),
    tendencias: Object.fromEntries(r.tfs.map((t) => [t.tf, t.trend])),
    alineacion: r.alignment,
    atr1hPct: n(r.tfs.find((t) => t.tf === "1h")?.atrPct ?? null, 3),
    soportes: r.supports.map((l) => ({ precio: px(l.price), toques: l.touches, distanciaPct: n(l.distancePct, 2) })),
    resistencias: r.resistances.map((l) => ({ precio: px(l.price), toques: l.touches, distanciaPct: n(l.distancePct, 2) })),
    rango48: [px(r.low48), px(r.high48)],
    volumen24VsSemana: n(r.volume24, 2),
    aPunto: r.preBreak && r.preBreak.state !== "QUIETO" ? r.preBreak : null,
  };
}
export type CompactRead = ReturnType<typeof compactRead>;
