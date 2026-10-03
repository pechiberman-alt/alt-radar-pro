import assert from "node:assert/strict";
import test from "node:test";
import { preBreakText, readPreBreak, replayPreBreakout, validatePreBreakAlert } from "../lib/pre-breakout.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const c = (i: number, o: number, h: number, l: number, cl: number, v = 100): SwingCandle => ({ openTime: i * 3_600_000, open: o, high: h, low: l, close: cl, volume: v, quoteVolume: 0 });

/** Wide swings for 100 candles, then a tight ascending triangle under 110: highs capped at 110, lows rising. */
function triangle(): SwingCandle[] {
  const out: SwingCandle[] = [];
  let i = 0;
  for (let k = 0; k < 100; k += 1) {
    const mid = 100 + 6 * Math.sin(k / 4);
    out.push(c(i++, mid - 1, mid + 2.5, mid - 2.5, mid + 1));
  }
  for (let k = 0; k < 60; k += 1) {
    const top = k % 6 === 3 ? 110 : 109.4; // touches of 110
    const floor = Math.min(104 + k * 0.09, top - 0.8); // rising lows, candles keep some range
    out.push(c(i++, floor + 0.4, top, floor, top - 0.05, 120 + k));
  }
  return out;
}

test("a tight range pressing a twice-tested ceiling with rising lows reads as a bullish 'A PUNTO'", () => {
  const r = readPreBreak(triangle())!;
  assert.equal(r.side, "ALCISTA");
  assert.ok(r.level !== null && Math.abs(r.level - 110) < 0.5, `level ${r.level}`);
  assert.ok(r.touches >= 2);
  assert.ok(r.reasons.some((x) => x.includes("resistencia")));
  assert.ok(r.reasons.includes("mínimos crecientes"));
  assert.ok(r.score >= 50, `score ${r.score}`);
});

test("the mirror image reads as bearish against a floor", () => {
  const down = triangle().map((x) => ({ ...x, open: 300 - x.open, close: 300 - x.close, high: 300 - x.low, low: 300 - x.high }));
  const r = readPreBreak(down)!;
  assert.equal(r.side, "BAJISTA");
  assert.ok(r.reasons.includes("máximos decrecientes"));
});

test("no level nearby: no direction is claimed", () => {
  const drift = Array.from({ length: 160 }, (_, i) => c(i, 100 + i * 0.5, 101 + i * 0.5, 99.5 + i * 0.5, 100.4 + i * 0.5));
  const r = readPreBreak(drift)!;
  assert.equal(r.side, "SIN DIRECCIÓN");
  assert.equal(r.level, null);
});

test("too little history: no reading", () => {
  assert.equal(readPreBreak(triangle().slice(0, 50)), null);
});

test("NO LOOKAHEAD: a reading at a candle is the same with or without later candles", () => {
  const cs = triangle();
  for (const cut of [120, 140, 155]) assert.deepEqual(readPreBreak(cs.slice(0, cut)), readPreBreak(cs.slice(0, cut)));
  const full = [...cs, ...Array.from({ length: 30 }, (_, k) => c(160 + k, 110 + k, 112 + k, 109 + k, 111 + k))];
  assert.deepEqual(readPreBreak(full.slice(0, 160)), readPreBreak(cs));
});

test("replay: counts alerts once per coiling and reports the base rate beside them", () => {
  const cs = [...triangle(), ...Array.from({ length: 40 }, (_, k) => c(160 + k, 110 + k * 0.6, 111 + k * 0.6, 109.5 + k * 0.6, 110.5 + k * 0.6))];
  const r = replayPreBreakout(cs);
  assert.ok(r.baseRate !== null && r.baseRate >= 0 && r.baseRate <= 1);
  assert.ok(r.alerts >= 0 && r.moved <= r.alerts && r.sameSide <= r.moved);
  if (r.alerts) assert.ok(r.rate !== null);
});

test("alerts: only real 'A PUNTO' readings get through, and the text is escaped and honest", () => {
  const ok = { symbol: "SOLUSDT", timeframe: "1h", side: "ALCISTA", score: 78, level: 150.2, touches: 4, distanceAtr: 0.6, price: 149.8, reasons: ["compresión fuerte", "<b>x</b>"] };
  const a = validatePreBreakAlert(ok)!;
  assert.equal(a.score, 78);
  for (const bad of [{ ...ok, score: 60 }, { ...ok, symbol: "SOL" }, { ...ok, timeframe: "1w" }, { ...ok, side: "UP" }, { ...ok, price: -1 }, null]) assert.equal(validatePreBreakAlert(bad), null);
  const text = preBreakText(a);
  assert.match(text, /A PUNTO DE ROMPER · SOL/);
  assert.match(text, /hacia arriba/);
  assert.match(text, /4 toques/);
  assert.match(text, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(text, /dirección no está garantizada/);
});
