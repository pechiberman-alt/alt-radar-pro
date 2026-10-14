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

test("VWAP semanal: promedio ponderado por volumen que se reinicia cada lunes, sin mirar adelante", async () => {
  const { vwapSemanal } = await import("../lib/estrategias.ts");
  const D = 86_400_000;
  const lunes = 4 * D; // 05/01/1970, lunes 00:00 UTC
  const vela = (t: number, precio: number, volume: number) => ({ openTime: t, open: precio, high: precio, low: precio, close: precio, volume }) as SwingCandle;
  const v = [vela(lunes, 10, 1), vela(lunes + D, 20, 3), vela(lunes + 7 * D, 50, 2)];
  const w = vwapSemanal(v);
  assert.equal(w[0], 10);
  assert.equal(w[1], (10 * 1 + 20 * 3) / 4);
  assert.equal(w[2], 50, "el lunes siguiente arranca de nuevo");
  const largo = velas(500, 3);
  const completo = vwapSemanal(largo);
  const corto = vwapSemanal(largo.slice(0, 301));
  assert.equal(completo[300], corto[300], "la vela 300 no cambia si se borran las siguientes");
});

test("perfil de volumen: el POC cae donde se concentró el volumen y no mira adelante", async () => {
  const { pocPerfil } = await import("../lib/estrategias.ts");
  const v: SwingCandle[] = [];
  for (let i = 0; i < 260; i += 1) {
    const p = i % 2 === 0 ? 100 : 120;
    v.push({ openTime: i * H, open: p, high: p + 1, low: p - 1, close: p, volume: p === 100 ? 5 : 1 } as SwingCandle);
  }
  const poc = pocPerfil(v);
  assert.ok(Number.isNaN(poc[100]), "sin 200 velas no hay perfil");
  assert.ok(Math.abs(poc[259] - 100) < 1.5, `el volumen está en 100, no en 120 (POC ${poc[259]})`);
  const largo = velas(500, 5);
  assert.equal(pocPerfil(largo)[400], pocPerfil(largo.slice(0, 401))[400]);
});

test("marco superior (HTF): usa solo el día ya cerrado y no mira adelante", async () => {
  const { direccionHtf, supertrend } = await import("../lib/estrategias.ts");
  const F = 4 * H;
  const D = 24 * H;
  const v: SwingCandle[] = [];
  for (let i = 0; i < 6 * 60; i += 1) {
    const dia = Math.floor(i / 6);
    const p = dia < 30 ? 100 + dia * 2 : 160 - (dia - 30) * 5; // sube 30 días y después cae
    v.push({ openTime: i * F, open: p, high: p + 1, low: p - 1, close: p, volume: 1 } as SwingCandle);
  }
  const h = direccionHtf(v);
  assert.equal(h[6 * 25 + 2], 1, "en la suba, el diario es alcista");
  assert.equal(h[v.length - 1], -1, "tras la caída, bajista");
  // Dentro de un día en curso se usa el día anterior: la vela 0 del día no ve el cierre de su propio día.
  const diario = supertrend(
    Array.from({ length: 60 }, (_, d) => ({ openTime: d * D, open: v[d * 6].open, high: v[d * 6].open + 1, low: v[d * 6].open - 1, close: v[d * 6 + 5].close, volume: 1 }) as SwingCandle),
    10,
    3,
  ).dir;
  assert.equal(h[6 * 40], diario[39], "primera vela del día 40: dirección del día 39");
  assert.equal(h[6 * 40 + 5], diario[40], "la última vela del día 40 cierra el día");
  for (const i of [200, 250, 300]) assert.equal(direccionHtf(v.slice(0, i + 1))[i], h[i], `vela ${i} sin las posteriores`);
});

test("volumen relativo: contra el promedio de las 20 anteriores, sin la vela misma ni las siguientes", async () => {
  const { volumenRelativo } = await import("../lib/estrategias.ts");
  const v = Array.from({ length: 40 }, (_, i) => ({ openTime: i * H, open: 1, high: 1, low: 1, close: 1, volume: i === 30 ? 30 : 10 }) as SwingCandle);
  const x = volumenRelativo(v);
  assert.ok(Number.isNaN(x[19]), "sin 20 velas previas no hay dato");
  assert.equal(x[20], 1);
  assert.equal(x[30], 3, "30 contra un promedio de 10");
  assert.ok(Math.abs(x[31] - 10 / ((19 * 10 + 30) / 20)) < 1e-12, "el pico entra al promedio de la vela siguiente");
  assert.equal(volumenRelativo(v.slice(0, 31))[30], x[30]);
});
