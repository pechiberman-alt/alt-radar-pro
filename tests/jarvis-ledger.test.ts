import assert from "node:assert/strict";
import test from "node:test";
import { addSignals, breakoutSignal, escaleraLinea, HORIZON, ledgerCsv, ledgerStats, magnetSignal, resolveSignal, statsSpeech, type JarvisSignal } from "../lib/jarvis-ledger.ts";
import { generadorAzar } from "../lib/jarvis-stats.ts";
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

/** The resolution exactly as it was before the ladder: what the new one has to match, result by result. */
function resolveBefore(s: JarvisSignal, candles: SwingCandle[], frameMs: number): JarvisSignal {
  if (s.result !== "ABIERTA") return s;
  const after = candles.filter((x) => x.openTime > s.time).sort((a, b) => a.openTime - b.openTime);
  const risk = Math.abs(s.entry - s.stop);
  if (!(risk > 0)) return s;
  const fee = ((0.05 / 100) * 2 * s.entry) / risk;
  const long = s.side === "LONG";
  for (let i = 0; i < after.length && i < HORIZON; i += 1) {
    const x = after[i];
    if (long ? x.low <= s.stop : x.high >= s.stop) return { ...s, result: "STOP", r: -1 - fee, closedAt: x.openTime + frameMs };
    if (long ? x.high >= s.target : x.low <= s.target) return { ...s, result: "OBJETIVO", r: Math.abs(s.target - s.entry) / risk - fee, closedAt: x.openTime + frameMs };
    if (i === HORIZON - 1) return { ...s, result: "TIEMPO", r: (long ? x.close - s.entry : s.entry - x.close) / risk - fee, closedAt: x.openTime + frameMs };
  }
  return s;
}

test("the ladder changes no result: same outcome, R and close time as the rules always were (300 random signals)", () => {
  const az = generadorAzar(7);
  const normal = () => Math.sqrt(-2 * Math.log(Math.max(az(), 1e-12))) * Math.cos(2 * Math.PI * az());
  const seen = new Set<string>();
  for (let n = 0; n < 300; n += 1) {
    const sigma = 0.002 + az() * 0.01;
    let p = 100;
    const candles = Array.from({ length: 80 }, (_, k) => {
      const open = p;
      const cl = open * (1 + normal() * sigma);
      p = cl;
      return c(11 + k, open, Math.max(open, cl) * (1 + Math.abs(normal()) * sigma * 0.5), Math.min(open, cl) * (1 - Math.abs(normal()) * sigma * 0.5), cl);
    });
    const side = az() < 0.5 ? "LONG" : "SHORT";
    const risk = 0.5 + az() * 3;
    const reward = risk * (1 + az() * 3);
    const s = sig({ side, stop: side === "LONG" ? 100 - risk : 100 + risk, target: side === "LONG" ? 100 + reward : 100 - reward });
    const now = resolveSignal(s, candles, H);
    const before = resolveBefore(s, candles, H);
    assert.equal(now.result, before.result, `signal ${n}`);
    assert.equal(now.closedAt, before.closedAt);
    if (before.r === null) assert.equal(now.r, null);
    else assert.ok(Math.abs((now.r as number) - before.r) < 1e-9);
    if (now.tp2At) assert.ok(now.tp1At && now.tp1At <= now.tp2At, "TP2 is never reached before TP1");
    if (now.result === "STOP" && now.tp1At) assert.ok(now.tp1At < (now.closedAt as number), "a target of the stop's candle does not count");
    seen.add(now.result);
  }
  assert.deepEqual([...seen].sort(), ["OBJETIVO", "STOP", "TIEMPO"]);
});

test("TP1 and TP2 keep their time; on the stop's candle they don't count; a time already recorded is never lost", () => {
  // Long at 100, stop 98, target 104 → TP1 101,33…, TP2 102,66…
  const a = resolveSignal(sig(), [c(11, 100, 101.5, 99.5, 101)], H);
  assert.equal(a.result, "ABIERTA");
  assert.deepEqual([a.tp1At, a.tp2At], [12 * H, null]);
  const b = resolveSignal(a, [c(11, 100, 101.5, 99.5, 101), c(12, 101, 103, 100, 102.8), c(13, 102, 102.5, 97.5, 98)], H);
  assert.equal(b.result, "STOP");
  assert.deepEqual([b.tp1At, b.tp2At, b.closedAt], [12 * H, 13 * H, 14 * H]);
  const sameCandle = resolveSignal(sig(), [c(11, 100, 103, 97.5, 98)], H);
  assert.equal(sameCandle.result, "STOP");
  assert.equal(sameCandle.tp1At, null, "the stop's candle does not count its targets");
  assert.equal(resolveSignal(sig({ tp1At: 12 * H }), [c(14, 100, 100.5, 99.5, 100)], H).tp1At, 12 * H, "kept even without those candles");
  assert.equal(escaleraLinea(b, (v) => v.toLocaleString("es-AR", { maximumFractionDigits: 2 })), "SL 98 ✗ · TP1 101,33 ✓ · TP2 102,67 ✓ · TP3 104");
  const csv = ledgerCsv([b]);
  assert.ok(csv.startsWith("﻿fecha;fuente;moneda;marco;lado;entrada;stop;tp1;tp2;tp3_objetivo;resultado;R;tp1_alcanzado;tp2_alcanzado;nota"));
  assert.match(csv, /;101,3333333;102,6666667;104;STOP;/);
});
