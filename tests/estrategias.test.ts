import assert from "node:assert/strict";
import test from "node:test";
import { ema, ESTRATEGIAS, indicadores, medir, MUESTRA_ESTUDIO, operar, rsi, veredicto, type Operacion } from "../lib/estrategias.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const H = 3_600_000;
/** Velas sintéticas reproducibles: una caminata con ondas, sin red. */
function velas(n: number, semilla = 1): SwingCandle[] {
  const out: SwingCandle[] = [];
  let p = 100;
  let s = semilla;
  for (let i = 0; i < n; i += 1) {
    s = (s * 16807) % 2147483647;
    const ruido = (s / 2147483647 - 0.5) * 2;
    const open = p;
    p = Math.max(1, p * (1 + 0.01 * Math.sin(i / 25) + 0.012 * ruido));
    const close = p;
    out.push({ openTime: i * H, open, high: Math.max(open, close) * 1.004, low: Math.min(open, close) * 0.996, close, volume: 1 } as SwingCandle);
  }
  return out;
}

test("indicadores: EMA y RSI conocidos", () => {
  assert.deepEqual(ema([1, 2, 3, 4], 2).map((x) => (Number.isNaN(x) ? null : +x.toFixed(4))), [null, 1.5, 2.5, 3.5]);
  const sube = rsi(Array.from({ length: 20 }, (_, i) => i), 14);
  assert.equal(sube[19], 100, "solo subidas: RSI 100");
});

test("ninguna estrategia mira el futuro: la señal en i no cambia si se borran las velas posteriores", () => {
  const v = velas(600);
  const completos = indicadores(v);
  for (const e of ESTRATEGIAS) {
    for (const i of [250, 330, 420, 510]) {
      const corto = v.slice(0, i + 1);
      const a = e.senal(v, completos, i);
      const b = e.senal(corto, indicadores(corto), i);
      assert.deepEqual(a, b, `${e.id} en la vela ${i}`);
    }
  }
});

test("operar: entra a la apertura siguiente, una operación por vez, con la escalera de la app", () => {
  const v = velas(3000, 7);
  for (const e of ESTRATEGIAS) {
    const ops = operar(e, "TESTUSDT", v, { marcoMs: H, horizonte: 48, feePct: 0.07 });
    for (let k = 0; k < ops.length; k += 1) {
      const o = ops[k];
      assert.ok(o.cerradaA > o.abiertaA, `${e.id}: cierra después de abrir`);
      if (k > 0) assert.ok(o.abiertaA >= ops[k - 1].cerradaA, `${e.id}: nunca dos a la vez`);
      if (o.tp3) assert.ok(o.tp2 && o.tp1, "TP3 implica haber pasado TP1 y TP2");
      if (o.sl) assert.ok(o.r < 0, "el stop siempre pierde (con comisión)");
    }
  }
});

test("medir: winrate, tasas de objetivos, profit factor, expectancia con intervalo y caída", () => {
  const op = (r: number, t: number, tp: number): Operacion => ({
    estrategia: "RSI", symbol: "X", lado: "LONG", abiertaA: t, cerradaA: t + 1, r, tp1: tp >= 1, tp2: tp >= 2, tp3: tp >= 3, sl: r < 0,
  });
  const m = medir([op(2, 1, 3), op(-1, 2, 0), op(-1, 3, 1), op(1.5, 4, 3)]);
  assert.equal(m.operaciones, 4);
  assert.equal(m.winRate, 0.5);
  assert.equal(m.tasaTp1, 0.75);
  assert.equal(m.tasaTp3, 0.5);
  assert.equal(m.profitFactor, 3.5 / 2);
  assert.equal(m.expectancia, 1.5 / 4);
  assert.equal(m.maxCaidaR, 2);
  assert.ok(m.expectanciaIc && m.expectanciaIc.low < m.expectancia! && m.expectanciaIc.high > m.expectancia!);
});

test("veredicto: con muestra chica no se concluye; ventaja solo si el intervalo queda sobre cero y le gana al control", () => {
  const base = medir([]);
  assert.equal(veredicto(base, null), "SIN CONCLUSIÓN");
  const m = (exp: number, low: number, high: number, n = MUESTRA_ESTUDIO) => ({ ...base, operaciones: n, expectancia: exp, expectanciaIc: { low, high } });
  assert.equal(veredicto(m(0.2, 0.05, 0.35), m(-0.1, -0.2, 0)), "VENTAJA");
  assert.equal(veredicto(m(0.2, 0.05, 0.35), m(0.3, 0.1, 0.5)), "SIN CONCLUSIÓN", "no le gana al azar");
  assert.equal(veredicto(m(-0.2, -0.3, -0.1), null), "SIN VENTAJA");
  assert.equal(veredicto(m(0.2, -0.05, 0.45), null), "SIN CONCLUSIÓN");
  assert.equal(veredicto(m(0.5, 0.2, 0.8, 50), null), "SIN CONCLUSIÓN", "menos de 100 operaciones");
});

test("supertrend: en una subida sostenida queda alcista con la línea por debajo del precio, y da vuelta al caer fuerte", async () => {
  const { supertrend } = await import("../lib/estrategias.ts");
  const v: SwingCandle[] = [];
  for (let i = 0; i < 60; i += 1) {
    const p = i < 40 ? 100 + i : 140 - (i - 40) * 4;
    v.push({ openTime: i * H, open: p, high: p + 1, low: p - 1, close: p, volume: 1 } as SwingCandle);
  }
  const st = supertrend(v, 10, 3);
  assert.equal(st.dir[35], 1);
  assert.ok(st.linea[35] < v[35].close);
  assert.equal(st.dir[59], -1, "la caída lo da vuelta");
  assert.ok(st.linea[59] > v[59].close);
});
