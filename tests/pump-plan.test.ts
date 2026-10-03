import assert from "node:assert/strict";
import test from "node:test";
import { pumpPlan } from "../lib/pump-plan.ts";
import type { PumpCandle } from "../lib/pump-radar.ts";

const k = (i: number, o: number, h: number, l: number, c: number): PumpCandle => ({ openTime: i, open: o, high: h, low: l, close: c, volume: 100, quoteVolume: 0, trades: 10 });
/** 50 quiet candles ranging 99–101, then the last three as given. */
const series = (tail: PumpCandle[]) => [...Array.from({ length: 50 }, (_, i) => k(i, 100, 101, 99, 100)), ...tail];

test("accumulation: buy stop above the range, stop inside it, targets in R", () => {
  const p = pumpPlan("ACUMULACIÓN", series([k(50, 100, 101, 99, 100.5), k(51, 100.5, 101, 99.5, 100.8), k(52, 100.8, 101, 100, 100.9)]))!;
  assert.equal(p.action, "ESPERAR RUPTURA");
  assert.equal(p.orderType, "stop");
  assert.ok((p.entry as number) > 101 && (p.entry as number) < 101.5);
  assert.ok((p.stop as number) < 101 && (p.stop as number) >= 99 - 0.25, `stop ${p.stop}: inside the range or just under its floor`);
  const r = (p.entry as number) - (p.stop as number);
  assert.ok(Math.abs(p.targets[0] - ((p.entry as number) + 1.5 * r)) < 1e-9);
  assert.equal(p.targets.length, 3);
});

test("ignition: entry at the price with the stop under the last candles", () => {
  const p = pumpPlan("IGNICIÓN", series([k(50, 100, 102, 99.8, 101.8), k(51, 101.8, 103, 101.5, 102.8), k(52, 102.8, 103.5, 102.4, 103.2)]))!;
  assert.equal(p.action, "ENTRADA");
  assert.equal(p.entry, 103.2);
  assert.ok((p.stop as number) < 99.8);
});

test("ignition too stretched: wait for the retest of the broken high", () => {
  const p = pumpPlan("IGNICIÓN", series([k(50, 100, 110, 99.9, 109), k(51, 109, 118, 108, 117), k(52, 117, 125, 116, 124)]))!;
  assert.equal(p.action, "ESPERAR RETROCESO");
  assert.equal(p.orderType, "limit");
  assert.equal(p.entry, 101, "the range's high");
});

test("active pump: limit below the price, first target at the recent high", () => {
  const tail = [k(50, 100, 104, 100, 104), k(51, 104, 108, 103.5, 107.5), k(52, 107.5, 110, 107, 109.5)];
  const p = pumpPlan("PUMP ACTIVO", series(tail))!;
  assert.equal(p.action, "ESPERAR RETROCESO");
  assert.ok((p.entry as number) < 109.5);
  assert.ok(p.targets[0] >= 110 || p.targets[0] > (p.entry as number));
});

test("climax and distribution: no entry; no pump or too few candles: no plan", () => {
  for (const stage of ["CLÍMAX", "DISTRIBUCIÓN"] as const) {
    const p = pumpPlan(stage, series([k(50, 100, 101, 99, 100), k(51, 100, 101, 99, 100), k(52, 100, 101, 99, 100)]))!;
    assert.equal(p.action, "NO ENTRAR");
    assert.equal(p.entry, null);
  }
  assert.equal(pumpPlan("SIN PUMP", series([])), null);
  assert.equal(pumpPlan("IGNICIÓN", series([]).slice(0, 10)), null);
});
