import type { SwingCandle } from "../../lib/swing-entries.ts";

const H = 3_600_000;

/** Waves, then a coil under 110 with rising lows ending at k ("a punto de romper" up), then a climb. */
export function setupAt(n: number, k: number, after: (j: number) => number = (j) => 109.95 + (j - k) * 0.5, t0 = 0): SwingCandle[] {
  const out: SwingCandle[] = [];
  for (let j = 0; j < n; j++) {
    let o, h, l, c, v;
    if (j <= k - 40) {
      const mid = 100 + 3 * Math.sin(j / 4);
      [o, h, l, c, v] = [mid - 1, mid + 2.5, mid - 2.5, mid + 1, 900];
    } else if (j <= k) {
      const q = j - (k - 39);
      const top = q % 6 === 3 ? 110 : 109.4;
      const floor = Math.min(104 + q * 0.15, top - 0.8);
      [o, h, l, c, v] = [floor + 0.4, top, floor, top - 0.05, 1200];
    } else {
      const base = after(j);
      [o, h, l, c, v] = [base, base + 0.8, base - 0.3, base + 0.5, 1500];
    }
    out.push({ openTime: t0 + j * H, open: o, high: h, low: l, close: c, volume: v, quoteVolume: v * c });
  }
  return out;
}
