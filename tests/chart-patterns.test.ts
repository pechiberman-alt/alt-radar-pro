import assert from "node:assert/strict";
import test from "node:test";
import { findFlags, readWyckoff } from "../lib/chart-patterns.ts";
import { findReversalZones } from "../lib/reversal-zones.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const c = (i: number, o: number, cl: number, h: number, l: number, v = 100): SwingCandle => ({
  openTime: i * 3_600_000, open: o, close: cl, high: h, low: l, volume: v, quoteVolume: 0,
});
/** Gently alternating candles: real range, no direction. */
const chop = (n: number, p: number, from: number, amp = 1) =>
  Array.from({ length: n }, (_, i) => {
    const up = i % 2 === 0;
    return c(from + i, p, p + (up ? amp : -amp), p + amp * 1.5, p - amp * 1.5);
  });

function bullFlag(breakout: "none" | "up" | "down") {
  const out = chop(30, 100, 0);
  let p = 100;
  for (let k = 0; k < 5; k += 1) {
    out.push(c(30 + k, p, p + 4, p + 4.5, p - 0.5, 400));
    p += 4;
  }
  // Flag: small drift down, tight.
  for (let k = 0; k < 7; k += 1) {
    const m = p - 0.4 * k;
    out.push(c(35 + k, m, m - 0.3, m + 0.8, m - 1.2, 120));
  }
  const i = 42;
  if (breakout === "up") out.push(c(i, 118, 122, 122.5, 117.5, 300));
  if (breakout === "down") out.push(c(i, 116, 112, 116.5, 111.5, 300));
  if (breakout === "none") out.push(c(i, 117, 117.2, 118, 116.5, 110));
  return out;
}

test("a pole and a tight pause form a bull flag, forming until it breaks", () => {
  const f = findFlags(bullFlag("none")).find((x) => x.kind === "BULL FLAG");
  assert.ok(f, "debe detectar la bandera");
  assert.equal(f.status, "FORMANDO");
  assert.ok(f.retracePct < 50);
  assert.ok(Math.abs(f.target - (f.breakout + f.poleHeight)) < 1e-9, "movimiento medido");
  assert.ok(f.invalidation < f.breakout);
});

test("a close above the flag confirms it, one below fails it", () => {
  assert.equal(findFlags(bullFlag("up")).find((x) => x.kind === "BULL FLAG")?.status, "CONFIRMADA");
  assert.equal(findFlags(bullFlag("down")).find((x) => x.kind === "BULL FLAG")?.status, "FALLIDA");
});

test("the mirror image is a bear flag", () => {
  const mirrored = bullFlag("none").map((x) => ({
    ...x, open: 200 - x.open, close: 200 - x.close, high: 200 - x.low, low: 200 - x.high,
  }));
  const f = findFlags(mirrored).find((x) => x.kind === "BEAR FLAG");
  assert.ok(f);
  assert.ok(f.target < f.breakout);
});

test("a range with no pole is not a flag", () => {
  assert.deepEqual(findFlags(chop(60, 100, 0)), []);
});

function accumulation(spring: boolean, sos: boolean) {
  const out: SwingCandle[] = [];
  let p = 140;
  for (let i = 0; i < 40; i += 1) {
    out.push(c(i, p, p - 1, p + 0.5, p - 1.5));
    p -= 1;
  }
  // Selling climax: wide candle on heavy volume — the detector now requires a
  // climax that is actually visible, as a real Wyckoff range starts with one.
  out.push(c(40, 100, 97, 100.5, 92, 900));
  // Range between ~96 and ~104.
  for (let i = 1; i < 40; i += 1) {
    const m = 100 + (i % 8 < 4 ? 3 : -3);
    out.push(c(40 + i, m, m + (i % 2 ? 0.5 : -0.5), m + 1.5, m - 1.5));
  }
  // Spring: takes out the climax low and closes back inside.
  if (spring) out.push(c(80, 97, 98, 98.5, 90));
  if (sos) out.push(c(out.length, 103, 108, 108.5, 102.5, 900));
  while (out.length < 90) out.push(c(out.length, 107, 107.3, 108, 106.5));
  return out;
}

test("a range after a decline reads as accumulation, a false break below as a spring", () => {
  const w = readWyckoff(accumulation(true, false));
  assert.ok(w);
  assert.equal(w.kind, "ACUMULACIÓN");
  assert.ok(w.events.some((e) => e.type === "SPRING"));
});

test("without a spring there is no phase C claimed", () => {
  const w = readWyckoff(accumulation(false, false));
  assert.ok(w);
  assert.ok(!w.events.some((e) => e.type === "SPRING"));
  assert.doesNotMatch(w.phase, /Fase C/);
});

test("too little history yields nothing", () => {
  assert.equal(readWyckoff(chop(40, 100, 0)), null);
});

/* reversal zones */

test("independent kinds at one price make a zone; one kind alone does not", () => {
  const zones = findReversalZones(100, [
    { kind: "liquidez", low: 95, high: 95, weight: 1 },
    { kind: "order block", low: 94.8, high: 95.3, weight: 1 },
    { kind: "fibonacci", low: 94.9, high: 95.1, weight: 1 },
    { kind: "order block", low: 110, high: 110.4, weight: 1 },
  ]);
  assert.equal(zones.length, 1);
  assert.equal(zones[0].side, "SOPORTE");
  assert.equal(zones[0].kinds.length, 3);
  assert.equal(zones[0].stars, 3);
});

test("repeating one kind does not inflate the score", () => {
  const [z] = findReversalZones(100, [
    { kind: "order block", low: 95, high: 95.2, weight: 1 },
    { kind: "order block", low: 95.1, high: 95.3, weight: 1 },
    { kind: "order block", low: 95.2, high: 95.4, weight: 1 },
    { kind: "fibonacci", low: 95, high: 95.1, weight: 1 },
  ]);
  assert.equal(z.score, 2);
});

test("a zone price sits inside is skipped; resistance and support are split", () => {
  const zones = findReversalZones(100, [
    { kind: "a", low: 99.8, high: 100.2, weight: 1 },
    { kind: "b", low: 99.9, high: 100.1, weight: 1 },
    { kind: "a", low: 104, high: 104.2, weight: 1 },
    { kind: "b", low: 104.1, high: 104.3, weight: 1 },
  ]);
  assert.equal(zones.length, 1);
  assert.equal(zones[0].side, "RESISTENCIA");
});
