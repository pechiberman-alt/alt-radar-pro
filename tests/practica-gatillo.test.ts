// Pruebas de la práctica del gatillo (lib/practica-gatillo.ts): que la verdad de cada vela no mire el futuro para ninguna
// estrategia del laboratorio, que la tanda salga equilibrada y reproducible, que la corrección sea exacta y que el resumen
// no muestre porcentajes con muestra mínima.
import assert from "node:assert/strict";
import test from "node:test";
import { ESTRATEGIAS, indicadores } from "../lib/estrategias.ts";
import {
  CALENTAMIENTO_PRACTICA,
  COSTO_PRACTICA_PCT,
  HORIZONTE_PRACTICA,
  MUESTRA_MINIMA_PRACTICA,
  corregir,
  generadorSemilla,
  nivelesDeLaOperacion,
  prepararTanda,
  resumenPractica,
  verdadEn,
  type Verdad,
} from "../lib/practica-gatillo.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const OPCIONES = { marcoMs: 3_600_000, horizonte: HORIZONTE_PRACTICA, feePct: COSTO_PRACTICA_PCT };
const HORA = 3_600_000;

/** Serie de precios con tendencia y ruido, reproducible: alcanza para que algunas estrategias disparen. */
function serie(n: number, semilla: number): SwingCandle[] {
  const azar = generadorSemilla(semilla);
  const out: SwingCandle[] = [];
  let precio = 100;
  for (let k = 0; k < n; k += 1) {
    const cambio = (azar() - 0.48) * 2;
    const open = precio;
    const close = Math.max(1, precio + cambio);
    const high = Math.max(open, close) + azar() * 0.8;
    const low = Math.min(open, close) - azar() * 0.8;
    out.push({ openTime: 1_600_000_000_000 + k * HORA, open, high, low, close, volume: 100 + azar() * 50, quoteVolume: 0 });
    precio = close;
  }
  return out;
}

test("el generador con semilla da la misma secuencia y valores entre 0 y 1", () => {
  const a = generadorSemilla(7);
  const b = generadorSemilla(7);
  for (let k = 0; k < 50; k += 1) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
});

test("la verdad de cada vela no cambia si se corta la serie en esa vela: ninguna estrategia mira el futuro", () => {
  const v = serie(420, 11);
  const ind = indicadores(v);
  let disparos = 0;
  for (const e of ESTRATEGIAS) {
    for (let i = CALENTAMIENTO_PRACTICA; i < v.length - HORIZONTE_PRACTICA - 2; i += 37) {
      const completa = e.senal(v, ind, i);
      const cortada = v.slice(0, i + 1);
      const parcial = e.senal(cortada, indicadores(cortada), i);
      assert.deepEqual(parcial, completa, `${e.id} cambia en la vela ${i} si se corta la serie: mira el futuro`);
      if (completa) disparos += 1;
    }
  }
  assert.ok(disparos > 0, "la serie de prueba no disparó nada: la prueba no dice nada");
});

test("la tanda tiene mitad con gatillo y mitad sin gatillo, sin repetidos y dentro del rango permitido", () => {
  const v = serie(900, 5);
  const e = ESTRATEGIAS.find((x) => x.id === "AZAR")!;
  const t = prepararTanda(v, e, "BTCUSDT", OPCIONES, 20, 42);
  assert.equal(new Set(t.preguntas).size, t.preguntas.length, "hay preguntas repetidas");
  const hasta = v.length - HORIZONTE_PRACTICA - 2;
  for (const i of t.preguntas) {
    assert.ok(i >= CALENTAMIENTO_PRACTICA && i <= hasta, `vela ${i} fuera de rango`);
    assert.ok(t.verdades.has(i));
  }
  const conGatillo = t.preguntas.filter((i) => t.verdades.get(i)?.tipo === "GATILLO").length;
  assert.equal(conGatillo, Math.min(10, t.gatillosDisponibles), "la mitad con gatillo no sale equilibrada");
});

test("la misma semilla arma la misma tanda y otra semilla la cambia", () => {
  const v = serie(900, 5);
  const e = ESTRATEGIAS.find((x) => x.id === "AZAR")!;
  const a = prepararTanda(v, e, "BTCUSDT", OPCIONES, 20, 42).preguntas;
  const b = prepararTanda(v, e, "BTCUSDT", OPCIONES, 20, 42).preguntas;
  const c = prepararTanda(v, e, "BTCUSDT", OPCIONES, 20, 43).preguntas;
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test("la corrección acierta solo con la respuesta exacta", () => {
  const conLong: Verdad = { i: 1, tipo: "GATILLO", lado: "LONG", senal: null, operacion: null };
  const conShort: Verdad = { i: 2, tipo: "GATILLO", lado: "SHORT", senal: null, operacion: null };
  const sinNada: Verdad = { i: 3, tipo: "NADA", lado: null, senal: null, operacion: null };
  assert.deepEqual(corregir(conLong, "LONG"), { acierto: true, esperada: "LONG" });
  assert.deepEqual(corregir(conLong, "SHORT"), { acierto: false, esperada: "LONG" });
  assert.deepEqual(corregir(conLong, "NADA"), { acierto: false, esperada: "LONG" });
  assert.deepEqual(corregir(conShort, "SHORT"), { acierto: true, esperada: "SHORT" });
  assert.deepEqual(corregir(sinNada, "NADA"), { acierto: true, esperada: "NADA" });
  assert.deepEqual(corregir(sinNada, "LONG"), { acierto: false, esperada: "NADA" });
});

test("el resumen no da porcentajes con muestra mínima y separa gatillos de no-gatillos", () => {
  const pocos = Array.from({ length: MUESTRA_MINIMA_PRACTICA - 1 }, () => ({ gatillo: true, respuesta: "LONG" as const, acierto: true }));
  const r = resumenPractica(pocos);
  assert.equal(r.conGatillo.muestraMinima, true);
  assert.equal(r.conGatillo.tasa, null);

  const mezcla = [
    ...Array.from({ length: 15 }, (_, k) => ({ gatillo: true, respuesta: "SHORT" as const, acierto: k < 9 })),
    ...Array.from({ length: 15 }, () => ({ gatillo: false, respuesta: "LONG" as const, acierto: false })),
  ];
  const m = resumenPractica(mezcla);
  assert.equal(m.conGatillo.tasa, 9 / 15);
  assert.equal(m.sinGatillo.tasa, 0);
  assert.deepEqual(m.falsosGatillos, { n: 15, sobre: 15 });
  assert.equal(m.deteccion.n, 15);
});

test("verdadEn marca como SIN_OPERACION una señal que la escalera no puede medir, y nunca como gatillo", () => {
  const v = serie(420, 11);
  const ind = indicadores(v);
  for (const e of ESTRATEGIAS) {
    for (let i = CALENTAMIENTO_PRACTICA; i < v.length - HORIZONTE_PRACTICA - 2; i += 53) {
      const vd = verdadEn(e, v, ind, i, "BTCUSDT", OPCIONES);
      if (vd.tipo === "GATILLO") assert.ok(vd.operacion, `${e.id} en ${i}: gatillo sin operación`);
      if (vd.tipo === "NADA") assert.equal(vd.senal, null);
    }
  }
});

test("los niveles de la operación entran a la apertura siguiente y guardan la distancia en R del estudio", () => {
  const v = serie(420, 11);
  const ind = indicadores(v);
  let probados = 0;
  for (const e of ESTRATEGIAS) {
    for (let i = CALENTAMIENTO_PRACTICA; i < v.length - HORIZONTE_PRACTICA - 2; i += 41) {
      const s = e.senal(v, ind, i);
      if (!s) continue;
      const n = nivelesDeLaOperacion(v, i, s);
      assert.ok(n, `${e.id}: sin niveles en ${i}`);
      assert.equal(n.entrada, v[i + 1].open);
      const riesgoSenal = Math.abs(v[i].close - s.stop);
      const riesgoOp = Math.abs(n.entrada - n.stop);
      assert.ok(Math.abs(riesgoOp - riesgoSenal) < 1e-9, `${e.id}: el stop no guarda la distancia en R`);
      const lado = s.lado === "LONG" ? 1 : -1;
      assert.ok((n.objetivo - n.entrada) * lado > 0, `${e.id}: el objetivo quedó del lado equivocado`);
      probados += 1;
    }
  }
  assert.ok(probados > 0);
});
