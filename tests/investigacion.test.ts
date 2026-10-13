import assert from "node:assert/strict";
import test from "node:test";
import { aggregate } from "../lib/asset-read.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";
import { antiguedadDeSenal, DATOS_DEL_MODELO, datosDe, diferenciaConIntervalo, evaluar, haciaAdelante, type Punto } from "../scripts/investigacion/aprendizaje.ts";
import { ventanas } from "../scripts/investigacion/medir.ts";
import { ajustarArboles, ajustarLogistica, ajustarRidge, auc, cuantil, predecirArboles, predecirLineal, predecirLogistica, resolverSPD } from "../scripts/investigacion/modelos.ts";
import { lecturasDe, type Series } from "../scripts/investigacion/precalcular.ts";
import { buildPlan, confluence, decide, expectativa, factorDeGanancia, intervaloPorSemanas, metricas, resolve, V1, V2, type Lectura, type Params, type Plan } from "../scripts/investigacion/simulador.ts";
import { aReal, aVirtual, dia, H, PERFILES, TZ, type PerfilId } from "../scripts/investigacion/util.ts";

const DAY = 24 * H;
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} no está cerca de ${b}`);

/** Números pseudoaleatorios repetibles (los tests no pueden depender del azar). */
const azar = (semilla: number) => {
  let s = semilla >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
};

// ── Modelos ────────────────────────────────────────────────────────────────────────────────────────────────────────

test("auc counts well-ordered pairs, ties count half, and no negatives means nothing to order", () => {
  assert.equal(auc([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1]), 1);
  assert.equal(auc([0.9, 0.8, 0.2, 0.1], [0, 0, 1, 1]), 0);
  assert.equal(auc([1, 1, 1, 1], [0, 1, 0, 1]), 0.5);
  assert.equal(auc([0.1, 0.4, 0.35, 0.8], [0, 0, 1, 1]), 0.75);
  assert.equal(auc([0.3, 0.6], [1, 1]), 0.5);
});

test("resolverSPD solves a small symmetric system and cuantil picks order statistics", () => {
  const x = resolverSPD([[4, 1], [1, 3]], [1, 2]);
  near(x[0], 1 / 11, 1e-12);
  near(x[1], 7 / 11, 1e-12);
  assert.equal(cuantil([4, 1, 3, 2], 0.5), 3);
  assert.equal(cuantil([4, 1, 3, 2], 0), 1);
  assert.equal(cuantil([4, 1, 3, 2], 1), 4);
});

test("ridge recovers a linear relation, a huge penalty falls back to the mean, a constant column is harmless", () => {
  const r = azar(7);
  const X = Array.from({ length: 400 }, () => [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1, 5]);
  const y = X.map(([a, b]) => 3 * a - 2 * b + 1);
  const m = ajustarRidge(X, y, 1e-6);
  for (let i = 0; i < X.length; i += 1) near(predecirLineal(m, X[i]), y[i], 1e-3);
  const media = y.reduce((a, v) => a + v, 0) / y.length;
  const plano = ajustarRidge(X, y, 1e12);
  for (const x of X.slice(0, 50)) near(predecirLineal(plano, x), media, 1e-3);
});

test("logistic regression ranks a noisy rule, and a huge penalty gives back the base rate", () => {
  const r = azar(11);
  const X = Array.from({ length: 600 }, () => [r() * 2 - 1, r() * 2 - 1]);
  const y: number[] = X.map(([a]) => (a + (r() - 0.5) * 0.8 > 0 ? 1 : 0));
  const m = ajustarLogistica(X, y, 1);
  const p = X.map((x) => predecirLogistica(m, x));
  assert.ok(p.every((v) => v > 0 && v < 1));
  assert.ok(auc(p, y) > 0.95, `AUC ${auc(p, y)}`);
  assert.ok(predecirLogistica(m, [1, 0]) > 0.8 && predecirLogistica(m, [-1, 0]) < 0.2);
  const base = y.reduce((a, v) => a + v, 0) / y.length;
  const plano = ajustarLogistica(X, y, 1e9);
  for (const x of X.slice(0, 50)) near(predecirLogistica(plano, x), base, 0.02);
});

test("boosted trees find a threshold, are repeatable with the same seed, and give a constant for a constant target", () => {
  const r = azar(5);
  const X = Array.from({ length: 500 }, () => [r() * 2 - 1, r() * 2 - 1]);
  const y: number[] = X.map(([a]) => (a > 0.3 ? 1 : 0));
  const opciones = { rondas: 60, profundidad: 2, lr: 0.2, minHoja: 10, submuestra: 0.8 };
  const m = ajustarArboles(X, y, opciones);
  const p = X.map((x) => predecirArboles(m, x));
  assert.ok(auc(p, y) > 0.99, `AUC ${auc(p, y)}`);
  assert.deepEqual(p, X.map((x) => predecirArboles(ajustarArboles(X, y, opciones), x)));
  const constante = ajustarArboles(X, y.map(() => 0.5), opciones);
  for (const x of X.slice(0, 20)) assert.equal(predecirArboles(constante, x), 0.5);
});

// ── Aprendizaje hacia adelante ─────────────────────────────────────────────────────────────────────────────────────

const punto = (t: number, fin: number, r: number, x: number[] = [1, 2, 3]): Punto => ({ sym: "X", t, side: "LONG", y: r > 0 ? 1 : 0, r, fin, x, limit: 0 });

test("walk-forward: each quarter learns only from trades already resolved before it starts (purged)", () => {
  const desde = Date.UTC(2023, 0, 1);
  const q2 = Date.UTC(2023, 3, 1);
  const hasta = Date.UTC(2023, 6, 1);
  const puntos: Punto[] = [
    // Historia legítima: resuelta mucho antes de 2023-01-01.
    ...Array.from({ length: 1600 }, (_, i) => punto(Date.UTC(2022, 9, 1) + i * H, Date.UTC(2022, 9, 3) + i * H, 0.1)),
    // Empezaron antes de 2023 pero se resolvieron después: todavía no se sabía su resultado el 1 de enero.
    ...Array.from({ length: 20 }, (_, i) => punto(Date.UTC(2022, 11, 30) + i * H, Date.UTC(2023, 0, 3), 100)),
    // Primer trimestre de 2023, resueltos antes del 1 de abril.
    ...Array.from({ length: 50 }, (_, i) => punto(Date.UTC(2023, 0, 10) + i * DAY, Date.UTC(2023, 0, 11) + i * DAY, 5)),
    // Empezaron en marzo y se resolvieron en abril: no entran al entrenamiento del segundo trimestre.
    ...Array.from({ length: 10 }, (_, i) => punto(Date.UTC(2023, 2, 30) + i * H, Date.UTC(2023, 3, 3), 1000)),
    // Segundo trimestre.
    ...Array.from({ length: 30 }, (_, i) => punto(Date.UTC(2023, 3, 10) + i * DAY, Date.UTC(2023, 3, 11) + i * DAY, 2)),
  ];
  const pred = haciaAdelante(puntos, { tipo: "ridge", objetivo: "r", lambda: 1 }, desde, hasta);
  puntos.forEach((p, i) => {
    if (p.t < desde || p.t >= hasta) assert.ok(Number.isNaN(pred[i]), "fuera del rango no se predice");
    else if (p.t < q2) near(pred[i], 0.1, 1e-9); // solo la historia anterior a enero: media 0,1
    else near(pred[i], (1600 * 0.1 + 20 * 100 + 50 * 5) / 1670, 1e-9); // todo lo resuelto antes de abril, y nada más
  });
});

test("walk-forward: with fewer than 1.500 resolved trades there is no prediction, and a real signal is learned", () => {
  const desde = Date.UTC(2023, 0, 1);
  const hasta = Date.UTC(2023, 3, 1);
  const pocos = [...Array.from({ length: 100 }, (_, i) => punto(Date.UTC(2022, 5, 1) + i * H, Date.UTC(2022, 5, 2) + i * H, 1)), punto(desde + H, desde + 2 * H, 1)];
  assert.ok(haciaAdelante(pocos, { tipo: "ridge", objetivo: "r", lambda: 1 }, desde, hasta).every(Number.isNaN));

  const r = azar(3);
  const senal = (t: number, fin: number) => {
    const x = r() * 2 - 1;
    return punto(t, fin, 2 * x + (r() - 0.5), [x, r()]);
  };
  const puntos = [
    ...Array.from({ length: 3000 }, (_, i) => senal(Date.UTC(2022, 0, 1) + i * H, Date.UTC(2022, 0, 1) + i * H + 2 * H)),
    ...Array.from({ length: 400 }, (_, i) => senal(desde + i * H, desde + i * H + 2 * H)),
  ];
  const pred = haciaAdelante(puntos, { tipo: "ridge", objetivo: "r", lambda: 100 }, desde, hasta);
  const e = evaluar(puntos, pred, [desde, hasta]);
  assert.equal(e.n, 400);
  assert.ok(e.auc > 0.85, `AUC ${e.auc}`);
  assert.ok(e.mitadAlta > e.mitadBaja);
});

test("the 90% interval of «high half minus low half» covers zero for a useless score and excludes it for a useful one", () => {
  const r = azar(21);
  const inicio = Date.UTC(2025, 6, 1);
  const puntos: Punto[] = Array.from({ length: 4000 }, (_, i) => punto(inicio + i * 3 * H, inicio + i * 3 * H + H, r() * 2 - 1, [i]));
  const rango: [number, number] = [inicio, inicio + 4000 * 3 * H];
  const inutil = puntos.map(() => r());
  const a = diferenciaConIntervalo(puntos, inutil, rango);
  assert.ok(a.bajo < 0 && a.alto > 0, `[${a.bajo}, ${a.alto}]`);
  assert.ok(a.semanas > 50);
  const util = puntos.map((p) => p.r + (r() - 0.5) * 0.2);
  const b = diferenciaConIntervalo(puntos, util, rango);
  assert.ok(b.bajo > 0.3 && b.alto >= b.dif && b.dif >= b.bajo, `[${b.bajo}, ${b.alto}]`);
  assert.deepEqual(diferenciaConIntervalo(puntos, util, rango), b, "con la misma semilla da lo mismo");
});

function lectura(over: Partial<Lectura> = {}): Lectura {
  return {
    t: 0, vela: 0, p: 100, atr: 2, sup: [[96, 95.5, 96.5, 2]], res: [[112, 111.5, 112.5, 2]], mu: null, md: null,
    c: [0.35, 0.8, 0.5, 0.1], ses: { tecnico: 0.4, estructura: 0.3, volumen: 0.2 }, reg: "NORMAL", al: "ALCISTA",
    tf: { "1h": "ALCISTA", "4h": "ALCISTA", "1d": "ALCISTA" }, rsi: [55, 58, 60], ema: [99, 97, 90, 85], vr: [1.2, 1.1], ch24: 0.01, lb: null,
    ...over,
  };
}
const corta = (over: Partial<Lectura> = {}) =>
  lectura({
    c: [-0.35, 0.8, 0.1, 0.5], sup: [[88, 87.5, 88.5, 2]], res: [[104, 103.5, 104.5, 2]], ses: { tecnico: -0.4, estructura: -0.3, volumen: -0.2 },
    al: "BAJISTA", tf: { "1h": "BAJISTA", "4h": "BAJISTA", "1d": "BAJISTA" }, ...over,
  });

test("the model's data are all «in favor of the plan's side», and finite", () => {
  const larga = lectura();
  const bajista = corta();
  const a = datosDe(larga, buildPlan("LONG", larga, V2)!, undefined, []);
  const b = datosDe(bajista, buildPlan("SHORT", bajista, V2)!, undefined, []);
  assert.equal(a.length, DATOS_DEL_MODELO.length);
  assert.equal(b.length, DATOS_DEL_MODELO.length);
  assert.ok(a.every(Number.isFinite) && b.every(Number.isFinite));
  const i = (n: (typeof DATOS_DEL_MODELO)[number]) => DATOS_DEL_MODELO.indexOf(n);
  for (const x of [a, b]) {
    near(x[i("cons")], 0.35);
    assert.equal(x[i("t4")], 1);
    assert.equal(x[i("td")], 1);
    assert.ok(x[i("tec")] > 0 && x[i("est")] > 0);
  }
  const contra = lectura({ tf: { "1h": "BAJISTA", "4h": "BAJISTA", "1d": "BAJISTA" } });
  assert.equal(datosDe(contra, buildPlan("LONG", contra, V2)!, undefined, [])[i("t4")], -1);
});

test("signal age counts the consecutive earlier readings that already pointed to the side, up to 24", () => {
  const con = (v: number) => lectura({ c: [v, 0.8, 0.5, 0.1] });
  assert.equal(antiguedadDeSenal(1, []), 1);
  assert.equal(antiguedadDeSenal(1, [con(0.2), con(0.4), con(0.35)]), 3);
  assert.equal(antiguedadDeSenal(-1, [con(0.2), con(-0.4), con(-0.35)]), 3);
  assert.equal(antiguedadDeSenal(1, [con(0.5), con(0.2), con(0.4)]), 2);
  assert.equal(antiguedadDeSenal(1, Array.from({ length: 60 }, () => con(0.5))), 24);
});

// ── Reglas de la mesa ──────────────────────────────────────────────────────────────────────────────────────────────

test("confluence is not a probability: it only combines agreement and strength", () => {
  assert.equal(confluence(lectura({ c: [0.6, 1, 1, 0] }), "LONG"), 100);
  assert.equal(confluence(lectura({ c: [0.3, 0.5, 0.5, 0.2] }), "LONG"), 38);
  assert.equal(confluence(lectura({ c: [-0.3, 0.5, 0.2, 0.5] }), "SHORT"), 38);
});

test("rules v1 and v2 differ where the docs say: minimum consensus and the stop margin", () => {
  const s = lectura();
  const p1 = decide(s, V1)!;
  const p2 = decide(s, V2)!;
  assert.equal(p1.side, "LONG");
  assert.equal(p2.side, "LONG");
  // Soporte en 96 (mínimo 95,5): v1 deja 0,25 ATR de margen, v2 deja 1 ATR.
  assert.equal(p1.stop, 95);
  assert.equal(p2.stop, 93.5);
  assert.deepEqual(p1.tp, [112, 114.5, 117.5]);
  assert.deepEqual(p2.tp, [112, 116.25, 122.75]);
  // Un consenso de 0,2 alcanza para v1 (0,15) y no para v2 (0,30).
  const flojo = lectura({ c: [0.2, 0.8, 0.5, 0.1] });
  assert.equal(decide(flojo, V1)?.side, "LONG");
  assert.equal(decide(flojo, V2), null);
  const bajista = corta({ c: [-0.2, 0.8, 0.1, 0.5] });
  assert.equal(decide(bajista, V1)?.side, "SHORT");
  assert.equal(decide(bajista, V1)?.stop, 105);
  assert.equal(decide(bajista, V2), null);
  assert.equal(decide(bajista, { ...V1, allowShorts: false }), null);
});

test("the risk manager vetoes a stop that is too far, and an order at a level too far away", () => {
  const lejos = lectura({ sup: [[80, 79.5, 80.5, 2]] });
  assert.ok(buildPlan("LONG", lejos, V2)!.stopAtr > 3.5);
  assert.equal(decide(lejos, V2), null);
  assert.equal(decide(lectura({ atr: 0 }), V2), null);
});

test("the limit order is tried only when the market plan does not reach the minimum R:R, as in the real desk", () => {
  // Con el soporte a 2,5 ATR del precio el stop de v2 queda a 3,75 ATR (> 3,5): a mercado se veta. Como su R:R (2,5) sí alcanza el
  // mínimo, la mesa no prueba la orden límite: no hay operación (en una versión anterior del simulador sí la tomaba).
  const s = lectura({ sup: [[95, 94.5, 95.5, 2]] });
  const mercado = buildPlan("LONG", s, V2)!;
  assert.equal(mercado.stopAtr, 3.75);
  assert.ok(mercado.rr >= V2.minRR);
  assert.equal(decide(s, V2), null);
  // Si el mínimo fuera más alto que ese R:R, ahí sí se prueba la orden límite en el soporte.
  const pl = decide(s, { ...V2, minRR: 2.9 })!;
  assert.equal(pl.limit, true);
  assert.equal(pl.entry, 95.5);
  assert.equal(pl.stop, 92.5);
  assert.ok(pl.stopAtr <= 3.5 && pl.rr >= 2.9);
  assert.equal(decide(s, { ...V2, minRR: 2.9, limitAlt: false }), null);
});

// ── Resolución de una operación ────────────────────────────────────────────────────────────────────────────────────

const vela = (i: number, open: number, high: number, low: number, close: number) => ({ openTime: i * H, open, high, low, close });
const planLargo: Plan = { side: "LONG", entry: 100, stop: 95, tp: [105, 110, 115], limit: false, rr: 2, stopAtr: 2.5, stopPct: 5 };
const planCorto: Plan = { side: "SHORT", entry: 100, stop: 105, tp: [95, 90, 85], limit: false, rr: 2, stopAtr: 2.5, stopPct: 5 };
const sinCosto: Params = { ...V2, fee: 0 };

test("worst case first: a candle that touches the stop and the target counts the stop", () => {
  const r = resolve(planLargo, [vela(0, 100, 106, 94, 100)], 0, sinCosto)!;
  assert.equal(r.exits, "STOP");
  near(r.r, -1);
  const c = resolve(planCorto, [vela(0, 100, 106, 94, 100)], 0, sinCosto)!;
  assert.equal(c.exits, "STOP");
  near(c.r, -1);
});

test("the candle that cashes the first target and also comes back to the entry closes the rest at break-even", () => {
  const velas = [vela(0, 100, 101, 99.5, 100.5), vela(1, 100.5, 106, 99, 104), vela(2, 104, 116, 103, 115)];
  const peor = resolve(planLargo, velas, 0, sinCosto)!;
  assert.equal(peor.exits, "TP1,BE");
  near(peor.r, 1 / 3);
  // Sin esa regla, la misma vela dejaba seguir y el resto cobraba TP2 y TP3: 2R en vez de 1/3 R.
  const optimista = resolve(planLargo, velas, 0, { ...sinCosto, beWorst: false })!;
  assert.equal(optimista.exits, "TP1,TP2,TP3");
  near(optimista.r, 2);
});

test("after the first target the stop moves to the entry, from the next candle", () => {
  const r = resolve(planLargo, [vela(0, 100, 106, 101, 105), vela(1, 105, 106, 99, 100)], 0, sinCosto)!;
  assert.equal(r.exits, "TP1,BE");
  near(r.r, 1 / 3);
  const fijo = resolve(planLargo, [vela(0, 100, 106, 101, 105), vela(1, 105, 106, 99, 100), vela(2, 100, 101, 94, 95)], 0, { ...sinCosto, beAfterTp1: false })!;
  assert.equal(fijo.exits, "TP1,TRAIL");
  near(fijo.r, 1 / 3 - 2 / 3);
});

test("fees are charged on the entry and on every exit, per side", () => {
  const r = resolve(planLargo, [vela(0, 100, 101, 94, 95)], 0, { ...V2, fee: 0.001 })!;
  near(r.r, -1 - (0.001 * 100 + 0.001 * 95) / 5);
});

test("a limit order fills when price comes back, is cancelled if the first target is reached first, and expires after 48 candles", () => {
  const limite: Plan = { ...planLargo, limit: true };
  const llena = resolve(limite, [vela(0, 102, 103, 101, 102), vela(1, 102, 102.5, 99.5, 101), vela(2, 101, 106, 100.5, 105), vela(3, 105, 105.5, 99, 100)], 0, sinCosto)!;
  assert.equal(llena.filledAt, H);
  assert.equal(llena.exits, "TP1,BE");
  near(llena.r, 1 / 3);
  const sinLlenar = resolve(limite, [vela(0, 102, 103, 101, 102), vela(1, 102, 106, 101.5, 105)], 0, sinCosto)!;
  assert.equal(sinLlenar.cancelled, true);
  const vence = resolve(limite, Array.from({ length: 60 }, (_, i) => vela(i, 102, 103, 101, 102)), 0, sinCosto)!;
  assert.equal(vence.cancelled, true);
  assert.equal(vence.end, 48 * H);
});

test("the time limit closes at the candle close; an operation still open when the data ends is not counted", () => {
  const plano = Array.from({ length: 10 }, (_, i) => vela(i, 100, 102, 98, 101));
  const t = resolve(planLargo, plano, 0, { ...sinCosto, horizonH: 5 })!;
  assert.equal(t.exits, "TIEMPO");
  assert.equal(t.end, 5 * H);
  near(t.r, 0.2);
  assert.equal(resolve(planLargo, plano.slice(0, 3), 0, sinCosto), null);
});

test("metricas: win rate, profit factor, expectancy and the worst drawdown in time order", () => {
  const m = metricas([{ r: -1, t: 3 }, { r: 3, t: 4 }, { r: 2, t: 1 }, { r: -1, t: 2 }]);
  assert.equal(m.n, 4);
  assert.equal(m.wr, 0.5);
  near(m.pf, 2.5);
  near(m.e, 0.75);
  near(m.tot, 3);
  near(m.dd, 2);
  const vacio = metricas([]);
  assert.equal(vacio.n, 0);
  assert.equal(vacio.pf, 0);
});

// ── Otras velas base: tiempo virtual ───────────────────────────────────────────────────────────────────────────────

test("el intervalo por semanas: es repetible, contiene al valor, no inventa incertidumbre y agrupa por semana real", () => {
  const semanas = (n: number, rs: (w: number) => number[]) => Array.from({ length: n }, (_, w) => rs(w).map((r, i) => ({ r, t: w * 7 * DAY + (i + 1) * H }))).flat();
  const pf = ([a]: number[][]) => factorDeGanancia(a);
  assert.equal(factorDeGanancia([1, 2]), Infinity);
  assert.equal(factorDeGanancia([-1]), 0);
  assert.equal(factorDeGanancia([]), 0);
  near(factorDeGanancia([2, -1, -1, 3]), 2.5);
  near(expectativa([2, -1, -1, 3]), 0.75);
  assert.equal(expectativa([]), 0);
  // Todas las semanas iguales: el remuestreo no puede cambiar nada, el intervalo es un punto
  const iguales = intervaloPorSemanas([{ ts: semanas(40, () => [2, -1, -1]) }], pf);
  assert.deepEqual([iguales.valor, iguales.bajo, iguales.alto, iguales.semanas], [1, 1, 1, 40]);
  // Semanas distintas entre sí: intervalo con ancho, que contiene al valor de toda la muestra
  const alea = azar(11);
  const dispares = semanas(40, () => [alea() * 5 - 2, alea() * 5 - 2, alea() * 5 - 2]);
  const a = intervaloPorSemanas([{ ts: dispares }], pf);
  near(a.valor, factorDeGanancia(dispares.map((o) => o.r)));
  assert.ok(a.bajo < a.valor && a.valor < a.alto, `${a.bajo} < ${a.valor} < ${a.alto}`);
  assert.deepEqual(intervaloPorSemanas([{ ts: dispares }], pf), a, "misma semilla, mismo intervalo");
  assert.notDeepEqual(intervaloPorSemanas([{ ts: dispares }], pf, 500, 99), a, "otra semilla, otro intervalo");
  // Dos series sortean las mismas semanas: una serie contra sí misma da siempre cero
  const consigo = intervaloPorSemanas([{ ts: dispares }, { ts: dispares }], ([x, y]) => factorDeGanancia(x) - factorDeGanancia(y));
  assert.deepEqual([consigo.valor, consigo.bajo, consigo.alto], [0, 0, 0]);
  // La semana se cuenta en tiempo real: si todas las operaciones caen en la misma semana real hay una sola semana
  assert.equal(intervaloPorSemanas([{ ts: dispares, aReal: () => 0 }], pf).semanas, 1);
  // Se agrupa por el cierre de la operación cuando lo hay
  const cierre = dispares.map((o) => ({ ...o, fin: o.t + 14 * DAY }));
  assert.equal(intervaloPorSemanas([{ ts: cierre }], pf).semanas, 40);
});

test("virtual time round-trips and keeps the engine's 4-candle and 24-candle groups on real calendar boundaries", () => {
  for (const id of ["15m", "2h", "4h", "6h", "12h"] as PerfilId[]) {
    const p = PERFILES[id];
    const periodo = Math.round(H / p.escala); // una vela base real = «una hora» del motor
    const n = 24 * 4 + 5;
    const inicio = dia("2025-01-01");
    const reales: SwingCandle[] = Array.from({ length: n }, (_, i) => ({ openTime: inicio + i * periodo, open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 1, quoteVolume: 100 }));
    const virtuales = reales.map((c) => ({ ...c, openTime: aVirtual(p, c.openTime) }));
    virtuales.forEach((c, i) => {
      near(aReal(p, c.openTime), reales[i].openTime, 1e-3);
      near((c.openTime - TZ) % H, 0, 1e-3); // cada vela base cae justo en una «hora» del motor
    });
    for (const [grupo, nombre] of [[4, "media"], [24, "alta"]] as [number, string][]) {
      const agrupadas = aggregate(virtuales, grupo);
      assert.ok(agrupadas.length >= Math.floor(n / grupo) - 1, `${id} ${nombre}`);
      for (const g of agrupadas) {
        const real = Math.round(aReal(p, g.openTime));
        assert.equal((real - TZ) % (grupo * periodo), 0, `${id}: la vela ${nombre} empieza en un límite real`);
      }
    }
  }
  // Con 6 h la vela «de 4 h» del motor es un día real (de 00:00 UTC) y la «de 1 d» son seis días.
  const p6 = PERFILES["6h"];
  const seis = Array.from({ length: 24 }, (_, i) => ({ openTime: aVirtual(p6, dia("2025-01-01") + i * 6 * H), open: i, high: i + 2, low: i - 1, close: i + 1, volume: 1, quoteVolume: 1 }));
  const dias = aggregate(seis, 4);
  assert.equal(dias.length, 6);
  assert.equal(Math.round(aReal(p6, dias[0].openTime)) % DAY, 0);
  assert.equal(dias[0].open, 0);
  assert.equal(dias[0].close, 4);
  assert.equal(dias[0].high, 5);
  assert.equal(dias[0].low, -1);
});

test("the research windows do not overlap and the last 180 days sit inside the last period", () => {
  for (const id of ["1h", "2h", "6h", "15m"] as PerfilId[]) {
    const p = PERFILES[id];
    const w = ventanas(p);
    assert.equal(w.length, id === "15m" ? 3 : 4, id);
    const periodos = w.slice(0, -1);
    for (let i = 1; i < periodos.length; i += 1) assert.ok(periodos[i - 1].hasta < periodos[i].desde, `${id} ${periodos[i].nombre}`);
    const ultimos = w[w.length - 1];
    assert.equal(ultimos.nombre, "últimos 180 días");
    assert.ok(ultimos.desde >= periodos[periodos.length - 1].desde && ultimos.hasta <= periodos[periodos.length - 1].hasta);
    near(aReal(p, ultimos.desde), dia("2026-04-03"), 1);
  }
});

// ── Lecturas precalculadas: sin mirar el futuro ───────────────────────────────────────────────────────────────────

const T0 = Date.UTC(2026, 0, 1);
const camino = (f: (i: number) => number, n: number): SwingCandle[] =>
  Array.from({ length: n }, (_, i) => {
    const o = f(i);
    const c = f(i + 1);
    return { openTime: T0 + i * H, open: o, high: Math.max(o, c) * 1.004, low: Math.min(o, c) * 0.996, close: c, volume: 100 + (i % 9) * 10, quoteVolume: (100 + (i % 9) * 10) * c };
  });
const onda = (i: number) => 100 * 1.0003 ** i + 6 * Math.sin(i / 37) + 2 * Math.sin(i / 5.3);
const ondaBtc = (i: number) => 60_000 * 1.0002 ** i + 500 * Math.sin(i / 29);
const series = (h1: SwingCandle[], btc: SwingCandle[]): Series => ({ h1, h4: aggregate(h1, 4), d1: aggregate(h1, 24), btc, eth: null });
const deformar = (c: SwingCandle[], desde: number) => c.map((x) => (x.openTime >= desde ? { ...x, open: x.open * 3, high: x.high * 3.2, low: x.low * 0.2, close: x.close * 0.4 } : x));

test("precomputed readings use only closed candles, on the 4-candle cadence, and never see what happens after them", () => {
  const N = 1400;
  const base = camino(onda, N);
  const btc = camino(ondaBtc, N);
  const perfil = PERFILES["1h"];
  const desde = T0 + 1000 * H;
  const hasta = T0 + 1300 * H;
  const lecturas = lecturasDe("SYN", perfil, desde, hasta, series(base, btc));
  assert.ok(lecturas.length >= 60, `${lecturas.length} lecturas`);
  for (const l of lecturas) {
    assert.ok(l.vela + H <= l.t, "la última vela usada ya estaba cerrada");
    assert.equal((l.t - 1000) % (4 * H), 0, "una lectura cada 4 velas base");
  }
  // Se deforma todo lo que pasa desde el corte (el activo y BTC): las lecturas hasta el corte tienen que ser idénticas.
  const corte = T0 + 1200 * H;
  const otra = lecturasDe("SYN", perfil, desde, hasta, series(deformar(base, corte), deformar(btc, corte)));
  const antes = (ls: typeof lecturas) => ls.filter((l) => l.t <= corte + 1000);
  const despues = (ls: typeof lecturas) => ls.filter((l) => l.t > corte + 1000);
  assert.ok(antes(lecturas).length >= 40 && despues(lecturas).length >= 10);
  assert.equal(antes(otra).length, antes(lecturas).length);
  assert.deepEqual(antes(otra), antes(lecturas));
  assert.notDeepEqual(despues(otra), despues(lecturas), "la deformación sí cambia lo que viene después");
});
