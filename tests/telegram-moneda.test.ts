import assert from "node:assert/strict";
import test from "node:test";
import { candidatosMoneda, lecturaMoneda } from "../lib/telegram-moneda.ts";
import { resumenEstudio } from "../lib/estudio-resumen.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const F = 4 * 3_600_000;

test("candidatos: la palabra suelta, la que está en mayúsculas y la que sigue a «de» o «sobre»; no las comunes ni las que ya vigila", () => {
  assert.deepEqual(candidatosMoneda("Ondo"), ["ONDO"]);
  assert.deepEqual(candidatosMoneda("analizá ONDO por favor"), ["ONDO"]);
  assert.deepEqual(candidatosMoneda("qué opinás de pepe y de ondo"), ["PEPE", "ONDO"]);
  assert.deepEqual(candidatosMoneda("hola"), [], "una palabra común no es una moneda");
  assert.deepEqual(candidatosMoneda("btc"), [], "las que ya trae el bot no se piden");
  assert.deepEqual(candidatosMoneda("cómo viene el mercado hoy"), []);
  assert.ok(candidatosMoneda("de a de b de c de d de e").length <= 3, "como mucho tres consultas por mensaje");
});

/** Velas reproducibles: una suba larga y pareja. */
function suba(n: number): SwingCandle[] {
  let p = 10;
  return Array.from({ length: n }, (_, i) => {
    const open = p;
    p *= 1.004;
    return { openTime: i * F, open, high: p * 1.002, low: open * 0.998, close: p, volume: 1 } as SwingCandle;
  });
}

test("lectura: usa solo velas cerradas y no inventa lo que falta", () => {
  const v = suba(400);
  const ahora = v[399].openTime + F + 60_000; // la última ya cerró
  const l = lecturaMoneda("ONDOUSDT", v, 20, 1.5, ahora)!;
  assert.equal(l.supertrend4h, "ALCISTA");
  assert.equal(l.sobreEma200, true);
  assert.equal(l.velas, 400);
  const formandose = lecturaMoneda("ONDOUSDT", v, 20, 1.5, v[399].openTime + 60_000)!;
  assert.equal(formandose.velas, 399, "la vela que se está formando se descarta");
  assert.equal(lecturaMoneda("ONDOUSDT", suba(10), 20, null, ahora), null, "con pocas velas no hay lectura");
  assert.equal(lecturaMoneda("ONDOUSDT", v, 0, null, ahora), null, "sin precio no hay lectura");
  assert.equal(lecturaMoneda("ONDOUSDT", suba(100), 20, null, 100 * F + 1)!.sobreEma200, null, "sin 200 velas no hay EMA 200: dice sin dato");
});

test("resumen del estudio: dice quién dio positivo, si sobrevive a la auditoría y que es el pasado", () => {
  const t = resumenEstudio();
  assert.match(t, /con resultado positivo en evaluación: .*Supertrend/);
  assert.match(t, /candidata: no sobrevive a la auditoría/);
  assert.match(t, /SPA p=/);
  assert.match(t, /no es asesoramiento financiero/);
  assert.match(t, /pasado/);
});
