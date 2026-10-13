import assert from "node:assert/strict";
import test from "node:test";
import { MIN_SAMPLE } from "../lib/jarvis-paper.ts";
import {
  caidaMaxima,
  caidaSimulada,
  evaluarEstrategia,
  generadorAzar,
  intervaloBootstrap,
  MIN_MUESTRA,
  momentos,
  normCdf,
  normInv,
  profitFactor,
  psr,
  sharpeDeAzar,
  sharpePorOperacion,
  sortinoPorOperacion,
  sqn,
  wilson,
  wilsonCorregido,
} from "../lib/jarvis-stats.ts";

// Valores de referencia calculados con scipy (scripts en la carpeta de trabajo, no en el repo).
const SERIE = [1, -1, 2, -1, 1.5, -1, -1, 3, 0.5, -1, 1, 2, -1, -1, 1];
const VARIANTES = [0.05, 0.12, -0.03, 0.2, 0.08, 0, 0.15, -0.1];
const cerca = (a: number | null, b: number, tol = 1e-6) => {
  assert.ok(a !== null, `esperaba ${b} y dio null`);
  assert.ok(Math.abs(a - b) <= tol, `${a} no está cerca de ${b}`);
};

test("la normal coincide con scipy en el centro y en las dos colas", () => {
  cerca(normCdf(1.2345), 0.8914916766373298);
  cerca(normInv(0.975), 1.959963984540054);
  cerca(normInv(0.02), -2.053748910631823);
  cerca(normInv(0.5), 0, 1e-9);
  assert.throws(() => normInv(0));
  assert.throws(() => normInv(1));
});

test("Wilson coincide con la fórmula de referencia y se ensancha con la corrección por variantes", () => {
  const w = wilson(9, 15);
  assert.ok(w);
  cerca(w.low, 0.3926063693439541);
  cerca(w.high, 0.7768320897340177);
  assert.equal(wilson(0, 10)!.low, 0);
  assert.equal(wilson(10, 10)!.high, 1);
  assert.equal(wilson(1, 0), null);
  const c = wilsonCorregido(9, 15, 50);
  assert.ok(c && c.low < w.low && c.high > w.high, "con 50 variantes el intervalo tiene que ser más ancho");
});

test("los momentos y los ratios por operación coinciden con scipy", () => {
  const m = momentos(SERIE);
  assert.ok(m);
  cerca(m.media, 1 / 3);
  cerca(m.desvio, 1.409998311380279);
  cerca(m.asimetria, 0.37218512333840914);
  cerca(m.curtosis, 1.753648391839076);
  cerca(sharpePorOperacion(SERIE), 0.2364069025068731);
  cerca(sqn(SERIE), 0.9155999963376);
  cerca(sortinoPorOperacion(SERIE), 0.4879500364742666);
  cerca(profitFactor(SERIE), 12 / 7);
});

test("sin pérdidas el profit factor no se define: null, no infinito", () => {
  assert.equal(profitFactor([1, 2, 0.5]), null);
  assert.equal(profitFactor([]), null);
});

test("la peor caída y su duración salen de la curva de R, con la racha perdedora", () => {
  const c = caidaMaxima(SERIE);
  cerca(c.maxR, 2, 0);
  assert.equal(c.duracion, 3);
  assert.equal(c.rachaPerdedora, 2);
  cerca(c.finalR, 5, 0);
  assert.deepEqual(caidaMaxima([1, 2, 3]), { maxR: 0, duracion: 0, rachaPerdedora: 0, finalR: 6 });
});

test("no se mira el futuro: agregar operaciones nuevas nunca cambia la caída de las anteriores", () => {
  let previa = 0;
  for (let k = 1; k <= SERIE.length; k += 1) {
    const dd = caidaMaxima(SERIE.slice(0, k)).maxR;
    assert.ok(dd >= previa, `la caída bajó al agregar la operación ${k}`);
    previa = dd;
  }
});

test("el PSR y el DSR coinciden con la fórmula de Bailey y López de Prado (scipy)", () => {
  const m = momentos(SERIE)!;
  cerca(psr(m.media / m.desvio, m.n, m.asimetria, m.curtosis, 0), 0.8214588753797731);
  const sr0 = sharpeDeAzar(VARIANTES);
  cerca(sr0, 0.14494732372033003);
  cerca(psr(m.media / m.desvio, m.n, m.asimetria, m.curtosis, sr0!), 0.6391871646725882);
});

test("si se probaron más reglas de las que se ven, el azar sube (con la misma varianza)", () => {
  const vistas = sharpeDeAzar(VARIANTES)!;
  const cientos = sharpeDeAzar(VARIANTES, 300)!;
  assert.ok(cientos > vistas, "300 reglas tienen que subir el umbral");
  assert.equal(sharpeDeAzar(VARIANTES, 3), sharpeDeAzar(VARIANTES), "menos que las vistas no cambia nada");
});

test("con pocas variantes el azar no se puede calcular: null, no cero", () => {
  assert.equal(sharpeDeAzar([0.1]), null);
  assert.equal(psr(0.2, 2, 0, 3), null);
  cerca(sharpeDeAzar([0.1, 0.1, 0.1]), 0, 1e-12);
});

test("el bootstrap es repetible y su intervalo contiene la media de la muestra", () => {
  const a = intervaloBootstrap(SERIE, (s) => s.reduce((p, x) => p + x, 0) / s.length);
  const b = intervaloBootstrap(SERIE, (s) => s.reduce((p, x) => p + x, 0) / s.length);
  assert.deepEqual(a, b);
  assert.ok(a && a.low <= 1 / 3 && 1 / 3 <= a.high, "el IC90 de la media tiene que incluir la media");
  const azar = generadorAzar(42);
  const vals = Array.from({ length: 1000 }, () => azar());
  assert.ok(vals.every((v) => v >= 0 && v < 1));
});

test("la peor caída simulada crece con el tamaño de la muestra y es cero si nunca cae", () => {
  const chica = caidaSimulada(SERIE.slice(0, 5))!;
  const grande = caidaSimulada([...SERIE, ...SERIE, ...SERIE])!;
  assert.ok(chica.p95 >= chica.mediana);
  assert.ok(grande.p95 >= chica.p95);
  assert.deepEqual(caidaSimulada([1, 2, 3, 4]), { mediana: 0, p95: 0 });
});

test("evaluarEstrategia marca la muestra, descuenta el azar y dice cuándo no puede", () => {
  const vacia = evaluarEstrategia([]);
  assert.equal(vacia.muestra, "SIN DATOS");
  assert.equal(vacia.winRate, null);

  const chica = evaluarEstrategia(SERIE.slice(0, 5));
  assert.equal(chica.muestra, "MUESTRA MÍNIMA");
  assert.equal(chica.dsr, null, "sin variantes no hay corrección por azar");

  const e = evaluarEstrategia(SERIE, VARIANTES);
  assert.equal(e.muestra, "MUESTRA RAZONABLE", "15 operaciones: justo en el mínimo (menos de 15 es muestra mínima)");
  assert.ok(e.dsr !== null && e.psr0 !== null && e.dsr < e.psr0, "elegir la mejor de 8 reglas tiene que bajar la probabilidad");
  assert.ok(e.winRateCorregido && e.winRateCorregido.low < e.winRate!.low);
  assert.equal(e.variantes, VARIANTES.length);
});

test("el mínimo de muestra es el mismo que usa el papel", () => {
  assert.equal(MIN_MUESTRA, MIN_SAMPLE);
});
