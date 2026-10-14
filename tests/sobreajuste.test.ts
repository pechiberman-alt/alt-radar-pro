/**
 * Tests de la auditoría de sobreajuste (lib/sobreajuste.ts): normal y su inversa, momentos, PSR, DSR con el máximo
 * esperado por azar, y Reality Check / SPA: sin ventaja no tienen que inventarla, con ventaja clara la tienen que ver.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { azarFijo, dsr, momentos, normCdf, normInv, pruebaMultiple, psr, sharpeMaximoEsperado } from "../lib/sobreajuste.ts";

const cerca = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test("normal: valores conocidos y la inversa vuelve al punto", () => {
  cerca(normCdf(0), 0.5, 1e-7);
  cerca(normCdf(1.96), 0.975, 1e-4);
  cerca(normInv(0.975), 1.959964, 1e-5);
  for (const p of [0.001, 0.02, 0.3, 0.5, 0.9, 0.999]) cerca(normCdf(normInv(p)), p, 1e-6);
});

test("momentos de una serie simétrica: asimetría cero", () => {
  const m = momentos([-2, -1, 0, 1, 2])!;
  cerca(m.media, 0, 1e-12);
  cerca(m.asimetria, 0, 1e-12);
  assert.equal(momentos([1, 1]), null);
  assert.equal(momentos([3, 3, 3]), null);
});

test("PSR: con Sharpe cero da 0,5 y crece con la muestra", () => {
  const base = { media: 0, desvio: 1, asimetria: 0, curtosis: 3 };
  cerca(psr({ ...base, n: 100, sharpe: 0 }), 0.5, 1e-9);
  const chico = psr({ ...base, n: 30, sharpe: 0.1 });
  const grande = psr({ ...base, n: 300, sharpe: 0.1 });
  assert.ok(grande > chico);
});

test("máximo esperado por azar (Bailey y López de Prado): N=100, V=0,5 ≈ 1,78", () => {
  cerca(sharpeMaximoEsperado(100, 0.5), 1.78, 0.02);
  assert.equal(sharpeMaximoEsperado(1, 0.5), 0);
  assert.ok(sharpeMaximoEsperado(1000, 0.01) > sharpeMaximoEsperado(10, 0.01));
});

test("DSR: más ensayos, menos confianza en el mismo Sharpe", () => {
  const m = { n: 227, media: 0.24, desvio: 1.4, sharpe: 0.17, asimetria: 0.5, curtosis: 3.5 };
  assert.ok(dsr(m, 30, 0.003) > dsr(m, 200, 0.003));
  assert.ok(dsr(m, 1, 0.003) === psr(m, 0));
});

const ruido = (rnd: () => number, T: number, media: number) =>
  Array.from({ length: T }, () => media + (rnd() + rnd() + rnd() + rnd() - 2) * 1.7);

test("Reality Check y SPA: 50 variantes sin ventaja no la inventan", () => {
  const rnd = azarFijo(3);
  const cols = Array.from({ length: 50 }, () => ruido(rnd, 400, 0));
  const r = pruebaMultiple(cols, { remuestreos: 400 })!;
  assert.ok(r.pRealityCheck > 0.1, `RC ${r.pRealityCheck}`);
  assert.ok(r.pSpa > 0.1, `SPA ${r.pSpa}`);
});

test("Reality Check y SPA: una variante con ventaja clara aparece", () => {
  const rnd = azarFijo(5);
  const cols = Array.from({ length: 20 }, (_v, k) => ruido(rnd, 400, k === 0 ? 0.35 : 0));
  const r = pruebaMultiple(cols, { remuestreos: 400 })!;
  assert.ok(r.pSpa < 0.05, `SPA ${r.pSpa}`);
  assert.ok(r.pRealityCheck < 0.05, `RC ${r.pRealityCheck}`);
});

test("pruebaMultiple rechaza matrices vacías o desparejas", () => {
  assert.equal(pruebaMultiple([]), null);
  assert.equal(pruebaMultiple([[1, 2, 3]]), null);
  assert.equal(pruebaMultiple([Array(20).fill(0), Array(19).fill(0)]), null);
});
