import assert from "node:assert/strict";
import test from "node:test";
import { comisionEnR, escaleraHacia, recorrer, type Desenlace } from "../lib/escalera.ts";
import { generadorAzar } from "../lib/jarvis-stats.ts";
import { MM_FEE_PCT, MM_HORIZON, runMm, type MmEvent } from "../lib/mm-robot.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const M = 900_000;
const T = Date.UTC(2026, 9, 1);
const opts = { horizonte: MM_HORIZON, feePct: MM_FEE_PCT };
/** Velas posteriores a la señal (la señal es la vela que abre en T): [máximo, mínimo, cierre]. */
const despues = (pasos: [number, number, number][]): SwingCandle[] =>
  pasos.map(([high, low, close], i) => ({ openTime: T + (i + 1) * M, open: close, high, low, close, volume: 1, quoteVolume: 0 }));
const cerca = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test("escalera hacia un objetivo: TP3 es ese objetivo, TP1 y TP2 a un tercio y a dos tercios del camino", () => {
  assert.deepEqual(escaleraHacia("LONG", 100, 97, 106), { stop: 97, tp1: 102, tp2: 104, tp3: 106 });
  assert.deepEqual(escaleraHacia("SHORT", 100, 103, 94), { stop: 103, tp1: 98, tp2: 96, tp3: 94 });
  assert.equal(escaleraHacia("LONG", 100, 97, 99), null, "objetivo del lado perdedor");
  assert.equal(escaleraHacia("LONG", 100, 101, 106), null, "SL del lado ganador");
  assert.equal(escaleraHacia("SHORT", 100, 103, Number.NaN), null);
  assert.equal(escaleraHacia("LONG", 100, 100, 106), null, "sin riesgo no hay escalera");
});

test("recorre: cada objetivo queda con su hora, al TP3 termina, y el R es neto de comisión", () => {
  const e = escaleraHacia("LONG", 100, 97, 106)!;
  const r = recorrer("LONG", 100, e, T, despues([[102.5, 99.5, 102], [104.2, 101, 104], [106.5, 103, 106]]), M, T + 10 * M, opts);
  assert.equal(r.tp1At, T + 2 * M, "la hora es el cierre de la vela que lo tocó");
  assert.equal(r.tp2At, T + 3 * M);
  assert.equal(r.tp3At, T + 4 * M);
  assert.equal(r.desenlace, "TP3");
  assert.equal(r.salida, 106);
  cerca(r.r, 2 - comisionEnR(100, 97, MM_FEE_PCT));
  assert.equal(r.slAt, null);
});

test("si una vela toca el SL y un objetivo, cuenta el SL y ese objetivo no queda registrado", () => {
  const e = escaleraHacia("LONG", 100, 97, 106)!;
  const r = recorrer("LONG", 100, e, T, despues([[102.5, 99, 102], [104.5, 96.5, 98]]), M, T + 10 * M, opts);
  assert.equal(r.tp1At, T + 2 * M, "el TP1 de antes queda");
  assert.equal(r.tp2At, null, "el TP2 de la vela del SL no cuenta");
  assert.equal(r.desenlace, "SL");
  assert.equal(r.slAt, T + 3 * M);
  assert.equal(r.salida, 97);
  cerca(r.r, -1 - comisionEnR(100, 97, MM_FEE_PCT));
});

test("sin SL ni TP3 en el horizonte sale por tiempo al cierre de la última vela; antes, sigue abierta", () => {
  const e = escaleraHacia("SHORT", 100, 103, 94)!;
  // Ni el SL (103) ni el TP2 (96): toca el TP1 (98) y se queda en el rango hasta que se acaba el tiempo.
  const planas = despues(Array.from({ length: MM_HORIZON + 5 }, (): [number, number, number] => [101, 97.5, 99]));
  const r = recorrer("SHORT", 100, e, T, planas, M, T + 200 * M, opts);
  assert.equal(r.desenlace, "TIEMPO");
  assert.equal(r.cerradaA, T + (MM_HORIZON + 1) * M);
  assert.equal(r.salida, 99);
  cerca(r.r, 1 / 3 - comisionEnR(100, 103, MM_FEE_PCT));
  assert.equal(r.tp1At, T + 2 * M, "el TP1 (98) se tocó en la primera vela");
  const pocas = recorrer("SHORT", 100, e, T, planas.slice(0, 10), M, T + 200 * M, opts);
  assert.equal(pocas.desenlace, "ABIERTA");
  assert.equal(pocas.r, null);
  assert.equal(pocas.tp1At, T + 2 * M, "lo alcanzado queda aunque siga abierta");
});

test("no mira el futuro: una vela sin cerrar o anterior a la señal no cuenta", () => {
  const e = escaleraHacia("LONG", 100, 97, 106)!;
  const sinCerrar = despues([[120, 99, 110]]);
  assert.equal(recorrer("LONG", 100, e, T, sinCerrar, M, T + M + M / 2, opts).desenlace, "ABIERTA", "la vela todavía no cerró");
  const antes: SwingCandle = { openTime: T, open: 100, high: 101, low: 90, close: 100, volume: 1, quoteVolume: 0 };
  assert.equal(recorrer("LONG", 100, e, T, [antes], M, T + 10 * M, opts).desenlace, "ABIERTA", "la vela de la señal no cuenta");
  const base = despues([[102.5, 99.5, 102], [103, 100, 101]]);
  const conFuturo = [...base, ...despues(Array.from({ length: 8 }, (): [number, number, number] => [130, 60, 100])).slice(2)];
  assert.deepEqual(recorrer("LONG", 100, e, T, conFuturo, M, T + 3 * M, opts), recorrer("LONG", 100, e, T, base, M, T + 3 * M, opts), "lo que pasa después de ahora no cambia nada");
});

test("mide exactamente lo mismo que el robot (runMm): mismo desenlace y mismo R, operación por operación", () => {
  const az = generadorAzar(20261013);
  const normal = () => Math.sqrt(-2 * Math.log(Math.max(az(), 1e-12))) * Math.cos(2 * Math.PI * az());
  const como: Record<string, Desenlace> = { STOP: "SL", OBJETIVO: "TP3", TIEMPO: "TIEMPO", ABIERTA: "ABIERTA" };
  const vistos = new Set<Desenlace>();
  for (let n = 0; n < 300; n += 1) {
    const sigma = 0.001 + az() * 0.007;
    const velas: SwingCandle[] = [];
    let p = 100;
    for (let i = 0; i < 160; i += 1) {
      const open = p;
      const close = open * (1 + normal() * sigma);
      const high = Math.max(open, close) * (1 + Math.abs(normal()) * sigma * 0.5);
      const low = Math.min(open, close) * (1 - Math.abs(normal()) * sigma * 0.5);
      velas.push({ openTime: T + i * M, open, high, low, close, volume: 1, quoteVolume: 0 });
      p = close;
    }
    const k = 5 + Math.floor(az() * 150);
    const side = az() < 0.5 ? "LONG" : "SHORT";
    const entry = velas[k].close;
    const risk = entry * (0.003 + az() * 0.02);
    const stop = side === "LONG" ? entry - risk : entry + risk;
    const lejos = (0.5 + az() * 4.5) * risk;
    const pool = az() < 0.5 ? null : side === "LONG" ? entry + lejos : entry - lejos;
    const ev: MmEvent = { index: k, time: velas[k].openTime, side, entry, stop, risk, rvol: 2, flushRatio: null, above: 0, below: 0, imbalance: null, pool, withTrend: true };
    const [trade] = runMm(velas, [ev], { vol: false, flush: false, imbalance: false, trend: false });
    const e = escaleraHacia(side, entry, stop, trade.target)!;
    const rec = recorrer(side, entry, e, ev.time, velas, M, T + 160 * M, opts);
    assert.equal(rec.desenlace, como[trade.result], `operación ${n}`);
    if (trade.r === null) assert.equal(rec.r, null);
    else cerca(rec.r, trade.r);
    vistos.add(rec.desenlace);
  }
  assert.deepEqual([...vistos].sort(), ["ABIERTA", "SL", "TIEMPO", "TP3"], "la prueba pasa por los cuatro desenlaces");
});
