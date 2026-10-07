import assert from "node:assert/strict";
import test from "node:test";
import { addSignals, breakoutSignal, HORIZON, ledgerCsv, ledgerStats, magnetSignal, resolveSignal, statsSpeech, type JarvisSignal } from "../lib/jarvis-ledger.ts";
import type { PreBreak } from "../lib/pre-breakout.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const H = 3_600_000;
const c = (i: number, o: number, h: number, l: number, cl: number): SwingCandle => ({ openTime: i * H, open: o, high: h, low: l, close: cl, volume: 1, quoteVolume: 0 });
const flat = (n: number) => Array.from({ length: n }, (_, i) => c(i, 100, 101, 99, 100));
const reading = (o: Partial<PreBreak> = {}): PreBreak => ({ score: 78, state: "A PUNTO", side: "ALCISTA", level: 101, touches: 4, distanceAtr: 0.5, pressure: 70, reasons: [], ...o });

test("breakout: long at the close, stop under the recent lows (1–2,5 ATR), target 2R", () => {
  const s = breakoutSignal("SOLUSDT", "1h", flat(30), reading())!;
  assert.equal(s.side, "LONG");
  assert.equal(s.entry, 100);
  assert.equal(s.time, 29 * H);
  assert.ok(s.stop < 100 && 100 - s.stop >= 2 - 1e-9 && 100 - s.stop <= 5 + 1e-9, `stop ${s.stop}`);
  assert.ok(Math.abs(s.target - (100 + 2 * (100 - s.stop))) < 1e-9);
  assert.equal(s.result, "ABIERTA");
  assert.equal(breakoutSignal("SOLUSDT", "1h", flat(30), reading({ side: "SIN DIRECCIÓN" })), null, "no direction, no signal");
  assert.equal(breakoutSignal("SOLUSDT", "1h", flat(30), reading({ state: "ARMÁNDOSE" })), null);
  assert.equal(breakoutSignal("SOLUSDT", "1h", flat(30), reading({ side: "BAJISTA" }))!.side, "SHORT");
});

test("magnet: only a swept-and-rejected zone on the last candle; reversal toward the other magnet", () => {
  const cs = [...flat(29), c(29, 100, 103, 99.5, 100.2)];
  const ev = { kind: "BARRIDA" as const, candleOpenTime: 29 * H, closedBack: true, magnet: { side: "CORTOS" as const, price: 102.5, intensity: 90, distancePct: 2.5, notionalUsd: null, density: 1 } };
  const after = { above: null, below: { side: "LARGOS" as const, price: 94, intensity: 70, distancePct: -6, notionalUsd: null, density: 1 } };
  const s = magnetSignal("BTCUSDT", "1h", cs, ev, after)!;
  assert.equal(s.side, "SHORT");
  assert.ok(s.stop > 103);
  assert.equal(s.target, 94, "the opposite magnet sits within 1–4R");
  assert.equal(magnetSignal("BTCUSDT", "1h", cs, { ...ev, closedBack: false }, after), null, "swept through: no reversal trade");
  assert.equal(magnetSignal("BTCUSDT", "1h", cs, { ...ev, candleOpenTime: 5 * H }, after), null, "not the last candle");
});

const sig = (o: Partial<JarvisSignal> = {}): JarvisSignal => ({ id: "x", source: "ROMPE", symbol: "SOLUSDT", timeframe: "1h", side: "LONG", time: 10 * H, entry: 100, stop: 98, target: 104, note: "", result: "ABIERTA", r: null, closedAt: null, ...o });

test("resolution: target, stop, both in one candle = stop, time exit, untouched stays open — fees included", () => {
  const hit = resolveSignal(sig(), [c(10, 0, 999, 0, 0), c(11, 100, 101, 99, 100), c(12, 100, 104.5, 99.5, 104)], H);
  assert.equal(hit.result, "OBJETIVO");
  assert.ok((hit.r as number) < 2 && (hit.r as number) > 1.9);
  assert.equal(hit.closedAt, 13 * H);
  assert.equal(resolveSignal(sig(), [c(11, 100, 101, 97.5, 98)], H).result, "STOP");
  assert.equal(resolveSignal(sig(), [c(11, 100, 105, 97, 100)], H).result, "STOP", "worst case first");
  const slow = Array.from({ length: HORIZON + 5 }, (_, k) => c(11 + k, 100, 100.5, 99.5, 100.4));
  const t = resolveSignal(sig(), slow, H);
  assert.equal(t.result, "TIEMPO");
  assert.ok(Math.abs((t.r as number) - (0.2 - (0.001 * 100) / 2)) < 1e-9);
  assert.equal(resolveSignal(sig(), [c(11, 100, 101, 99, 100)], H).result, "ABIERTA");
  const done = resolveSignal(sig({ result: "STOP", r: -1 }), [c(11, 100, 105, 99, 104)], H);
  assert.equal(done.result, "STOP", "a closed signal is never rewritten");
});

test("ledger: no duplicates, sorted, capped; stats by source; speech and CSV", () => {
  const a = sig({ id: "a", time: 1, result: "OBJETIVO", r: 1.9 });
  const b = sig({ id: "b", time: 2, result: "STOP", r: -1.05, source: "IMÁN" });
  const open = sig({ id: "c", time: 3 });
  const l = addSignals(addSignals([], [b, a]), [a, open]);
  assert.deepEqual(l.map((s) => s.id), ["a", "b", "c"]);
  assert.equal(addSignals(l, [], 2).length, 2);
  const st = ledgerStats(l);
  assert.equal(st.resolved, 2);
  assert.equal(st.open, 1);
  assert.equal(st.winRate, 0.5);
  assert.ok(Math.abs((st.profitFactor as number) - 1.9 / 1.05) < 1e-9);
  assert.equal(st.bySource.ROMPE.resolved, 1);
  assert.equal(st.bySource["IMÁN"].losses, 1);
  const talk = statsSpeech(st);
  assert.match(talk, /2 señales cerradas: 1 ganadoras y 1 perdedoras, win rate 50 por ciento, profit factor 1,81/);
  assert.match(talk, /muestra mínima/);
  assert.match(statsSpeech(ledgerStats([])), /Todavía no di ninguna señal/);
  const csv = ledgerCsv(l);
  assert.ok(csv.startsWith("﻿fecha;fuente;moneda"));
  assert.equal(csv.trim().split("\r\n").length, 4);
  assert.match(csv, /;OBJETIVO;1,900;/);
});
