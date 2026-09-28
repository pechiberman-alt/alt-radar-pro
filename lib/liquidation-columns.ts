import { leverageTiersFor, maintenanceMarginRateFor } from "./liquidation-heatmap.ts";
import type { SwingCandle } from "./swing-entries.ts";

/**
 * The liquidation map through time: the stacked columns of a pro heatmap.
 *
 * The main map (liquidation-heatmap.ts) answers "where is liquidation fuel
 * sitting right now". This answers "when did it appear, and when did price
 * take it": every estimated level is followed from the candle whose positions
 * created it to the first later candle that reached it. Drawn per candle, the
 * levels form columns that grow as positions build and end where price ran
 * through them — which is the part of a pro liquidation chart the static
 * profile cannot show.
 *
 * Same assumptions as the main map, applied the same way: activity per candle
 * (positive open-interest change when known, else volume), the same leverage
 * tiers and maintenance margin, the same half-life. The one simplification is
 * that each candle's activity is placed at a few evenly spaced prices inside
 * its range rather than spread over every fine price bin, which is invisible at
 * the row size a chart can draw.
 *
 * It never looks ahead: a column only contains levels formed at or before it,
 * and a level disappears at the candle that swept it, never earlier.
 */

export type LiquidationLife = {
  price: number;
  weight: number;
  side: "long" | "short";
  leverage: number;
  /** Open time of the candle whose positions this level belongs to. */
  formedTime: number;
  /** Open time of the first later candle that reached the price; null while it is still standing. */
  sweptTime: number | null;
};

export type LivesOptions = {
  /** Same meaning as in buildLiquidationHeatmap. */
  oiDeltaByIndex?: (number | null)[];
  priceRangePct?: number;
  /** Prices sampled inside each candle's range. */
  samples?: number;
};

/** Range-minimum / range-maximum tables, so "first later candle that reached
 *  this price" is a logarithmic walk instead of a scan. */
function sparse(values: number[], pick: (a: number, b: number) => number): number[][] {
  const table = [values.slice()];
  for (let k = 1; 1 << k <= values.length; k += 1) {
    const prev = table[k - 1];
    const half = 1 << (k - 1);
    const next: number[] = [];
    for (let i = 0; i + (1 << k) <= values.length; i += 1) next.push(pick(prev[i], prev[i + half]));
    table.push(next);
  }
  return table;
}

/** First index ≥ from whose value passes `hit`, given that `table` holds
 *  mins (for lows) or maxes (for highs) and `blocks(v)` says a whole block
 *  can be skipped. */
function firstReach(table: number[][], length: number, from: number, blocks: (v: number) => boolean): number | null {
  let pos = from;
  for (let k = table.length - 1; k >= 0; k -= 1) {
    const size = 1 << k;
    if (pos + size <= length && blocks(table[k][pos])) pos += size;
  }
  return pos < length ? pos : null;
}

export function buildLiquidationLives(
  symbol: string,
  candles: SwingCandle[],
  options: LivesOptions = {},
): LiquidationLife[] {
  if (!candles.length) return [];
  const samples = Math.max(1, Math.floor(options.samples ?? 4));
  const range = options.priceRangePct ?? 0.22;
  const current = candles[candles.length - 1].close;
  const lowBound = current * (1 - range);
  const highBound = current * (1 + range);
  const tiers = leverageTiersFor(symbol);
  const mmr = maintenanceMarginRateFor(symbol);
  const n = candles.length;
  const mins = sparse(candles.map((c) => c.low), Math.min);
  const maxs = sparse(candles.map((c) => c.high), Math.max);

  const lives: LiquidationLife[] = [];
  for (let j = 0; j < n; j += 1) {
    const c = candles[j];
    const delta = options.oiDeltaByIndex?.[j];
    // Positive OI change when known (contracting OI opened nothing); volume otherwise.
    const weight = delta === undefined || delta === null ? c.volume : Math.max(0, delta);
    if (!(c.high > c.low) || !(weight > 0)) continue;
    for (let s = 0; s < samples; s += 1) {
      const entry = c.low + ((s + 0.5) / samples) * (c.high - c.low);
      for (const tier of tiers) {
        const w = (weight / samples) * tier.weight;
        const longAt = entry * (1 - 1 / tier.leverage + mmr);
        const shortAt = entry * (1 + 1 / tier.leverage - mmr);
        if (longAt >= lowBound && longAt <= highBound) {
          const k = j + 1 < n ? firstReach(mins, n, j + 1, (v) => v > longAt) : null;
          lives.push({ price: longAt, weight: w, side: "long", leverage: tier.leverage, formedTime: c.openTime, sweptTime: k === null ? null : candles[k].openTime });
        }
        if (shortAt >= lowBound && shortAt <= highBound) {
          const k = j + 1 < n ? firstReach(maxs, n, j + 1, (v) => v < shortAt) : null;
          lives.push({ price: shortAt, weight: w, side: "short", leverage: tier.leverage, formedTime: c.openTime, sweptTime: k === null ? null : candles[k].openTime });
        }
      }
    }
  }
  return lives;
}

export type GridOptions = {
  /** Open times of the columns to fill, oldest first. */
  times: number[];
  lo: number;
  hi: number;
  rows: number;
  /** Candles for a level's weight to halve; null for no decay. */
  halfLife: number | null;
  frameMs: number;
  /** Leverage tiers to include; all when omitted. */
  tiers?: number[];
};

export type LiquidationGrid = {
  cols: number;
  rows: number;
  /** cols × rows, column-major: cells[col * rows + row], row 0 at the bottom (lo). */
  cells: Float32Array;
  /** 97th percentile of the non-empty cells — the scale's top, so one extreme
   *  cell can't wash every other one out to the lowest colour. 0 when empty. */
  scale: number;
};

export function liquidationGrid(lives: LiquidationLife[], opts: GridOptions): LiquidationGrid {
  const cols = opts.times.length;
  const rows = Math.max(1, Math.floor(opts.rows));
  const cells = new Float32Array(cols * rows);
  const empty = { cols, rows, cells, scale: 0 };
  if (!cols || !(opts.hi > opts.lo)) return empty;
  const wanted = opts.tiers ? new Set(opts.tiers) : null;
  const span = opts.hi - opts.lo;
  const decayPerCandle = opts.halfLife && opts.halfLife > 0 ? Math.pow(0.5, 1 / opts.halfLife) : 1;
  // Multiplier from one column to the next (normally one candle apart).
  const step = new Float64Array(cols);
  for (let c = 1; c < cols; c += 1) {
    step[c] = Math.pow(decayPerCandle, Math.max(0, (opts.times[c] - opts.times[c - 1]) / opts.frameMs));
  }
  const firstAtOrAfter = (t: number) => {
    let a = 0;
    let b = cols;
    while (a < b) {
      const m = (a + b) >> 1;
      if (opts.times[m] < t) a = m + 1;
      else b = m;
    }
    return a;
  };

  for (const life of lives) {
    if (wanted && !wanted.has(life.leverage)) continue;
    if (life.price < opts.lo || life.price >= opts.hi) continue;
    const row = Math.min(rows - 1, Math.floor(((life.price - opts.lo) / span) * rows));
    const c0 = firstAtOrAfter(life.formedTime);
    if (c0 >= cols) continue;
    // Alive up to and including the candle that swept it.
    const c1 = life.sweptTime === null ? cols - 1 : firstAtOrAfter(life.sweptTime + 1) - 1;
    if (c1 < c0) continue;
    let w = life.weight * Math.pow(decayPerCandle, Math.max(0, (opts.times[c0] - life.formedTime) / opts.frameMs));
    for (let c = c0; c <= c1; c += 1) {
      if (c > c0) w *= step[c];
      cells[c * rows + row] += w;
    }
  }

  const filled: number[] = [];
  for (let i = 0; i < cells.length; i += 1) if (cells[i] > 0) filled.push(cells[i]);
  if (!filled.length) return empty;
  filled.sort((a, b) => a - b);
  return { cols, rows, cells, scale: filled[Math.min(filled.length - 1, Math.floor(filled.length * 0.97))] };
}

/** The reference's four steps: teal, green, yellow, red. Null below the floor. */
export function gridColor(value: number, scale: number): [number, number, number, number] | null {
  if (!(scale > 0)) return null;
  const t = value / scale;
  if (t < 0.15) return null;
  // The lowest step is deliberately dim: it is the bulk of the map, and at
  // full strength it buried the candles under a wall of colour.
  if (t < 0.32) return [30, 122, 138, 105];
  if (t < 0.56) return [36, 196, 82, 185];
  if (t < 0.82) return [238, 222, 28, 205];
  return [255, 48, 48, 225];
}
