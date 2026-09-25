import { findPivots, type SwingCandle } from "./swing-entries.ts";

/**
 * RSI, MACD and divergences between them and price.
 *
 * DIVERGENCES, AND WHAT THEY ARE WORTH
 *
 * Regular divergence: price makes a new extreme the oscillator does not
 * confirm (lower low with a higher RSI low) — momentum fading, a warning of
 * reversal. Hidden divergence: the reverse (higher low in price, lower low in
 * RSI) — a pullback inside a trend that momentum over-shot, read as
 * continuation. Both are warnings, not triggers: regular divergences in a
 * strong trend fail repeatedly. So every divergence is found only on
 * CONFIRMED pivots (no repainting beyond the confirmation span) and the panel
 * reports how often they worked on the same chart, with the sample size.
 */

export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = closes.map(() => null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  // Wilder's smoothing, the standard RSI definition.
  for (let i = period + 1; i < closes.length; i += 1) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function ema(values: (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  const k = 2 / (period + 1);
  let prev: number | null = null;
  let seed: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (v === null) continue;
    if (prev === null) {
      seed.push(v);
      if (seed.length === period) {
        prev = seed.reduce((a, b) => a + b, 0) / period;
        out[i] = prev;
        seed = [];
      }
      continue;
    }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export type Macd = { macd: (number | null)[]; signal: (number | null)[]; hist: (number | null)[] };

export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): Macd {
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const line = closes.map((_, i) => (f[i] !== null && s[i] !== null ? f[i]! - s[i]! : null));
  const signal = ema(line, signalPeriod);
  const hist = line.map((v, i) => (v !== null && signal[i] !== null ? v - signal[i]! : null));
  return { macd: line, signal, hist };
}

export type Divergence = {
  kind: "REGULAR" | "OCULTA";
  side: "ALCISTA" | "BAJISTA";
  indicator: "RSI" | "MACD";
  from: number;
  to: number;
  priceFrom: number;
  priceTo: number;
  oscFrom: number;
  oscTo: number;
  /** Candles since the second pivot. */
  age: number;
};

export type DivergenceOptions = { span?: number; minGap?: number; maxGap?: number; lookback?: number; minOscDelta?: number };

/**
 * Divergences between consecutive confirmed price pivots and the oscillator
 * at those same candles. `minOscDelta` filters out differences too small to
 * mean anything (an RSI low of 31.2 vs 31.0 is not a divergence).
 */
export function findDivergences(
  candles: SwingCandle[],
  osc: (number | null)[],
  indicator: Divergence["indicator"],
  options: DivergenceOptions = {},
): Divergence[] {
  const span = options.span ?? 3;
  const minGap = options.minGap ?? 5;
  const maxGap = options.maxGap ?? 60;
  const lookback = options.lookback ?? 150;
  const minOscDelta = options.minOscDelta ?? 0;
  if (candles.length < 30 || osc.length !== candles.length) return [];
  const last = candles.length - 1;
  const { highs, lows } = findPivots(candles, span);
  const out: Divergence[] = [];

  const scan = (points: { index: number; price: number }[], isLow: boolean) => {
    for (let k = 1; k < points.length; k += 1) {
      const a = points[k - 1];
      const b = points[k];
      const gap = b.index - a.index;
      if (gap < minGap || gap > maxGap || last - b.index > lookback) continue;
      const oa = osc[a.index];
      const ob = osc[b.index];
      if (oa === null || ob === null || Math.abs(ob - oa) < minOscDelta) continue;
      const priceUp = b.price > a.price;
      const oscUp = ob > oa;
      if (priceUp === oscUp) continue;
      // Lows: lower price + higher osc = regular bullish; higher price + lower osc = hidden bullish.
      // Highs: higher price + lower osc = regular bearish; lower price + higher osc = hidden bearish.
      const kind: Divergence["kind"] = isLow ? (priceUp ? "OCULTA" : "REGULAR") : priceUp ? "REGULAR" : "OCULTA";
      out.push({
        kind,
        side: isLow ? "ALCISTA" : "BAJISTA",
        indicator,
        from: a.index,
        to: b.index,
        priceFrom: a.price,
        priceTo: b.price,
        oscFrom: oa,
        oscTo: ob,
        age: last - b.index,
      });
    }
  };
  scan(lows, true);
  scan(highs, false);
  return out.sort((x, y) => x.age - y.age);
}

function atrAt(c: SwingCandle[], i: number, period = 14) {
  let sum = 0;
  let n = 0;
  for (let k = Math.max(1, i - period + 1); k <= i; k += 1) {
    sum += Math.max(c[k].high - c[k].low, Math.abs(c[k].high - c[k - 1].close), Math.abs(c[k].low - c[k - 1].close));
    n += 1;
  }
  return n ? sum / n : 0;
}

export type DivergenceStats = { tested: number; worked: number; rate: number | null; confidence: "SIN MUESTRA" | "MUESTRA MÍNIMA" | "MUESTRA RAZONABLE" };

/**
 * How often divergences on this chart were followed by a 1-ATR move in their
 * direction before a 1-ATR move against, within `horizon` candles after
 * confirmation. Divergences still inside the horizon are open, not counted.
 */
export function divergenceStats(candles: SwingCandle[], divs: Divergence[], span = 3, horizon = 12): DivergenceStats {
  let tested = 0;
  let worked = 0;
  for (const d of divs) {
    const start = d.to + span; // the pivot is only known after confirmation
    if (start + horizon > candles.length - 1) continue;
    const a = atrAt(candles, start);
    if (!(a > 0)) continue;
    const entry = candles[start].close;
    const bull = d.side === "ALCISTA";
    let result: boolean | null = null;
    for (let i = start + 1; i <= start + horizon; i += 1) {
      const favor = bull ? candles[i].high - entry : entry - candles[i].low;
      const against = bull ? entry - candles[i].low : candles[i].high - entry;
      if (against >= a) {
        result = false;
        break;
      }
      if (favor >= a) {
        result = true;
        break;
      }
    }
    tested += 1;
    if (result === true) worked += 1;
  }
  return {
    tested,
    worked,
    rate: tested ? worked / tested : null,
    confidence: tested === 0 ? "SIN MUESTRA" : tested < 8 ? "MUESTRA MÍNIMA" : "MUESTRA RAZONABLE",
  };
}

export type OscState = {
  rsi: number | null;
  rsiZone: "SOBRECOMPRA" | "SOBREVENTA" | "NEUTRAL" | null;
  macdCross: "ALCISTA" | "BAJISTA" | null;
  histRising: boolean | null;
  recent: Divergence[];
};

/** Current reading plus divergences from the last `recentCandles`. */
export function oscillatorState(candles: SwingCandle[], recentCandles = 30): OscState {
  const closes = candles.map((c) => c.close);
  const r = rsi(closes);
  const m = macd(closes);
  const last = candles.length - 1;
  const rv = r[last] ?? null;
  const h = m.hist[last];
  const hp = m.hist[last - 1];
  const macdRange = Math.max(1e-12, ...m.macd.slice(-100).filter((v): v is number => v !== null).map(Math.abs));
  const divs = [
    ...findDivergences(candles, r, "RSI", { minOscDelta: 2 }),
    ...findDivergences(candles, m.macd, "MACD", { minOscDelta: macdRange * 0.05 }),
  ].filter((d) => d.age <= recentCandles);
  return {
    rsi: rv,
    rsiZone: rv === null ? null : rv >= 70 ? "SOBRECOMPRA" : rv <= 30 ? "SOBREVENTA" : "NEUTRAL",
    macdCross: m.macd[last] === null || m.signal[last] === null ? null : m.macd[last]! >= m.signal[last]! ? "ALCISTA" : "BAJISTA",
    histRising: h === null || h === undefined || hp === null || hp === undefined ? null : h > hp,
    recent: divs.sort((a, b) => a.age - b.age),
  };
}
