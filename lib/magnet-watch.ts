import { buildLiquidationHeatmap, type LiquidationHeatmap } from "./liquidation-heatmap.ts";
import type { SwingCandle } from "./swing-entries.ts";

/**
 * Liquidation magnets: the heaviest estimated liquidation zone above price
 * (shorts) and below it (longs), alerts when price gets close to one or a
 * candle sweeps it, and a measurement of whether price actually goes there.
 *
 * Why a measurement: "price is drawn to liquidity like a magnet" is the
 * vendors' claim, with little rigorous evidence behind it. replayMagnets
 * rebuilds the map in the past with only the candles available then and
 * checks, when there is a magnet on each side, whether price reached the
 * stronger one first — next to how often it simply reached the nearer one
 * first, which is what distance alone predicts. If the two rates are close,
 * the strength of the zone is not telling you where price goes on that coin.
 */

export type Magnet = {
  side: "CORTOS" | "LARGOS";
  price: number;
  /** Relative to the busiest zone in the map, 0–100. */
  intensity: number;
  /** Signed distance from price, in percent. */
  distancePct: number;
  /** Estimated notional, only when the map was scaled by open interest. */
  notionalUsd: number | null;
  density: number;
};

export type MagnetPair = { above: Magnet | null; below: Magnet | null };

/** The heaviest short zone above and long zone below, within `maxDistancePct`. */
export function strongestMagnets(heatmap: LiquidationHeatmap, price: number, maxDistancePct = 8): MagnetPair {
  let above: Magnet | null = null;
  let below: Magnet | null = null;
  for (const b of heatmap.buckets) {
    const distancePct = ((b.price - price) / price) * 100;
    if (Math.abs(distancePct) > maxDistancePct) continue;
    if (b.price > price && b.shortDensity > 0 && (!above || b.shortDensity > above.density)) {
      above = { side: "CORTOS", price: b.price, intensity: b.intensity, distancePct, notionalUsd: b.notionalUsd, density: b.shortDensity };
    }
    if (b.price < price && b.longDensity > 0 && (!below || b.longDensity > below.density)) {
      below = { side: "LARGOS", price: b.price, intensity: b.intensity, distancePct, notionalUsd: b.notionalUsd, density: b.longDensity };
    }
  }
  return { above, below };
}

export function atrPct(candles: SwingCandle[], n = 14): number {
  const c = candles;
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

export type MagnetEvent =
  | { kind: "CERCA"; magnet: Magnet; price: number; nearPct: number }
  | { kind: "BARRIDA"; magnet: Magnet; candleOpenTime: number; closedBack: boolean };

export type MagnetEventOptions = { minIntensity?: number; maxDistancePct?: number };

/**
 * Events on the last closed candle.
 *   CERCA    a strong magnet within max(0,4%, half an ATR) of the close.
 *   BARRIDA  a strong magnet, as the map stood before that candle, that the
 *            candle traded through. `closedBack` = it closed on the original
 *            side: the swept-and-rejected shape.
 * `before` is the map built from candles[0..n-2]; `now` from all of them.
 */
export function magnetEvents(candles: SwingCandle[], before: LiquidationHeatmap | null, now: LiquidationHeatmap | null, opts: MagnetEventOptions = {}): MagnetEvent[] {
  const minIntensity = opts.minIntensity ?? 60;
  const maxDistancePct = opts.maxDistancePct ?? 8;
  if (candles.length < 20) return [];
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const out: MagnetEvent[] = [];
  if (before) {
    const m = strongestMagnets(before, prev.close, maxDistancePct);
    for (const g of [m.above, m.below]) {
      if (!g || g.intensity < minIntensity) continue;
      if (last.low <= g.price && last.high >= g.price) {
        out.push({ kind: "BARRIDA", magnet: g, candleOpenTime: last.openTime, closedBack: g.side === "CORTOS" ? last.close < g.price : last.close > g.price });
      }
    }
  }
  if (now) {
    const nearPct = Math.max(0.4, atrPct(candles) / 2);
    const m = strongestMagnets(now, last.close, maxDistancePct);
    for (const g of [m.above, m.below]) {
      if (g && g.intensity >= minIntensity && Math.abs(g.distancePct) <= nearPct) out.push({ kind: "CERCA", magnet: g, price: last.close, nearPct });
    }
  }
  return out;
}

export type MagnetReplay = {
  /** Moments with a magnet on both sides. */
  cases: number;
  /** Of those, how many reached either one within the horizon. */
  resolved: number;
  strongerFirst: number;
  nearerFirst: number;
  /** After touching the first magnet: moved one ATR back the other way before closing one ATR beyond. */
  reversed: number;
  confidence: "SIN MUESTRA" | "MUESTRA MÍNIMA" | "MUESTRA RAZONABLE";
};

/**
 * Rebuilds the map every `step` candles with only the data available then
 * (the last `lookback` candles) and follows the next `horizon` candles.
 * Cases where both magnets sit at the same distance count for neither rate's
 * edge: they are left out.
 */
export function replayMagnets(
  symbol: string,
  candles: SwingCandle[],
  opts: { lookback?: number; step?: number; horizon?: number; priceRangePct?: number; halfLifeCandles?: number; maxDistancePct?: number } = {},
): MagnetReplay {
  const lookback = opts.lookback ?? 300;
  const step = opts.step ?? 8;
  const horizon = opts.horizon ?? 48;
  const r: MagnetReplay = { cases: 0, resolved: 0, strongerFirst: 0, nearerFirst: 0, reversed: 0, confidence: "SIN MUESTRA" };
  let busyUntil = -1;
  for (let t = Math.min(lookback, 120); t < candles.length - 2; t += step) {
    if (t <= busyUntil) continue;
    const slice = candles.slice(Math.max(0, t + 1 - lookback), t + 1);
    const price = slice[slice.length - 1].close;
    const map = buildLiquidationHeatmap(symbol, slice, price, { priceRangePct: opts.priceRangePct ?? 0.14, halfLifeCandles: opts.halfLifeCandles ?? 96 });
    if (!map) continue;
    const { above, below } = strongestMagnets(map, price, opts.maxDistancePct ?? 8);
    if (!above || !below) continue;
    const da = Math.abs(above.distancePct);
    const db = Math.abs(below.distancePct);
    if (Math.abs(da - db) < 1e-9) continue;
    r.cases += 1;
    const stronger = above.density >= below.density ? "UP" : "DOWN";
    const nearer = da < db ? "UP" : "DOWN";
    const a = (atrPct(slice) / 100) * price;
    for (let k = t + 1; k < Math.min(candles.length, t + 1 + horizon); k += 1) {
      const c = candles[k];
      const hitUp = c.high >= above.price;
      const hitDown = c.low <= below.price;
      if (!hitUp && !hitDown) continue;
      // Both in one candle: we can't know the order, so it resolves nothing.
      if (hitUp && hitDown) break;
      const first = hitUp ? "UP" : "DOWN";
      r.resolved += 1;
      if (first === stronger) r.strongerFirst += 1;
      if (first === nearer) r.nearerFirst += 1;
      const level = first === "UP" ? above.price : below.price;
      for (let j = k; j < Math.min(candles.length, k + 12); j += 1) {
        const cj = candles[j];
        const back = first === "UP" ? cj.low <= level - a : cj.high >= level + a;
        const beyond = first === "UP" ? cj.close >= level + a : cj.close <= level - a;
        if (beyond) break;
        if (back) {
          r.reversed += 1;
          break;
        }
      }
      busyUntil = k;
      break;
    }
  }
  r.confidence = r.resolved === 0 ? "SIN MUESTRA" : r.resolved < 15 ? "MUESTRA MÍNIMA" : "MUESTRA RAZONABLE";
  return r;
}

const fmt = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: v >= 1000 ? 0 : v >= 1 ? 2 : 6 });
const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2).replace(".", ",")}%`;
const usd = (v: number | null) => (v === null ? "" : v >= 1e9 ? ` · ~US$${(v / 1e9).toFixed(1).replace(".", ",")}B estimados` : ` · ~US$${Math.round(v / 1e6)}M estimados`);

/** Plain text (no HTML): the caller escapes for its channel. */
export function magnetEventText(symbol: string, timeframe: string, e: MagnetEvent): { title: string; body: string } {
  const coin = symbol.replace(/USDT$/, "");
  const who = e.magnet.side === "CORTOS" ? "cortos (arriba)" : "largos (abajo)";
  if (e.kind === "CERCA") {
    return {
      title: `🧲 ${coin} · cerca de un imán de liquidaciones · ${timeframe}`,
      body: `Precio ${fmt(e.price)} a ${pct(e.magnet.distancePct)} de la zona de ${who} en ${fmt(e.magnet.price)} (intensidad ${Math.round(e.magnet.intensity)}/100${usd(e.magnet.notionalUsd)}). Si la barre, suele haber un movimiento brusco; puede seguir de largo o rebotar.`,
    };
  }
  return {
    title: `💥 ${coin} · barrió la zona de ${who} · ${timeframe}`,
    body: `La vela tocó ${fmt(e.magnet.price)} (intensidad ${Math.round(e.magnet.intensity)}/100${usd(e.magnet.notionalUsd)}) y ${e.closedBack ? "cerró de vuelta del otro lado: rechazo, la forma de «barrida y vuelta»" : "cerró más allá: el precio siguió de largo"}. Esa zona ya se consumió.`,
  };
}
