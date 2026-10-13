import assert from "node:assert/strict";
import test from "node:test";
import { armarRegistro, CAPITAL_INICIAL_USD, contar, lineaCapital, RIESGO_POR_OPERACION_PCT, simularCapital, type Cierre } from "../lib/registro.ts";
import { cierresDeFilas, cierresDeNucleo, operacionesDePapel } from "../lib/registro-db.ts";

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 1);
const cierres = (...rs: number[]): Cierre[] => rs.map((r, i) => ({ r, cerradaA: T0 + (i + 1) * H, abiertaA: T0 + i * H }));
const conteoDe = (cs: Cierre[]) => contar(cs.map((c) => ({ r: c.r, abierta: false })));

test("capital: USD 1.000 con 1 % fijo por operación; el final sale del neto en R", () => {
  const cs = cierres(2, -1, 3);
  const c = simularCapital(conteoDe(cs), cs, null);
  assert.equal(CAPITAL_INICIAL_USD, 1000);
  assert.equal(RIESGO_POR_OPERACION_PCT, 1);
  assert.equal(c.riesgoUsd, 10);
  assert.equal(c.actualUsd, 1040);
  assert.equal(c.netoUsd, 40);
  assert.equal(c.retornoPct, 4);
  assert.deepEqual(c.curva, [1000, 1020, 1010, 1040]);
  assert.equal(c.picoUsd, 1040);
  assert.equal(c.maxCaidaUsd, 10);
  assert.equal(c.desde, T0);
  assert.equal(c.serieCompleta, true);
});

test("capital: la curva sigue el orden en que cerraron, no el orden en que llegan", () => {
  const cs = cierres(-2, 1, -3);
  const desordenadas = [cs[2], cs[0], cs[1]];
  const c = simularCapital(conteoDe(cs), desordenadas, null);
  assert.deepEqual(c.curva, [1000, 980, 990, 960]);
  assert.equal(c.maxCaidaUsd, 40, "pico 1.000, piso 960");
});

test("capital: no mira el futuro; cada punto de la curva usa solo los cierres anteriores", () => {
  const cs = cierres(1, -1, 2, -2, 3);
  const completa = simularCapital(conteoDe(cs), cs, null).curva;
  for (let k = 1; k <= cs.length; k += 1) {
    const hasta = cs.slice(0, k);
    const parcial = simularCapital(conteoDe(hasta), hasta, null).curva;
    assert.deepEqual(parcial, completa.slice(0, k + 1), `con ${k} cierres la curva no cambia por lo que viene después`);
  }
});

test("capital: con la serie recortada, el final sigue exacto y se avisa que la caída es parcial", () => {
  const todas = cierres(5, -1, -1, 2);
  const c = simularCapital(conteoDe(todas), todas.slice(2), null);
  assert.equal(c.actualUsd, 1050);
  assert.equal(c.serieCompleta, false);
  assert.equal(c.curva[c.curva.length - 1], 1050, "la curva parcial termina en el capital exacto");
  assert.match(lineaCapital(c), /de las últimas leídas/);
});

test("capital: sin serie no hay caída inventada; sin cerradas sigue en el capital inicial", () => {
  const c = simularCapital(contar([{ r: 1, abierta: false }]), null, null);
  assert.equal(c.actualUsd, 1010);
  assert.equal(c.maxCaidaUsd, null);
  assert.equal(c.picoUsd, null);
  const cero = simularCapital(contar([{ r: null, abierta: true }]), [], T0);
  assert.equal(cero.actualUsd, 1000);
  assert.equal(cero.desde, T0);
});

test("capital: si pierde más de 100 R, dice que se habría quedado sin capital", () => {
  const cs = cierres(...Array.from({ length: 101 }, () => -1));
  const c = simularCapital(conteoDe(cs), cs, null);
  assert.equal(c.quebrado, true);
  assert.match(lineaCapital(c), /sin capital/);
  assert.equal(c.curva.length, 40, "la curva viaja recortada");
});

test("registro: cada fuente lleva su capital; una fuente sin leer no tiene capital", () => {
  const cs = cierres(1, 1);
  const g = armarRegistro([{ id: "PAPEL", conteo: conteoDe(cs), cierres: cs, desde: T0 }, { id: "ROBOT", conteo: null }], T0);
  assert.equal(g.fuentes[0].capital?.actualUsd, 1020);
  assert.equal(g.fuentes[1].capital, null);
  assert.match(lineaCapital(g.fuentes[0].capital), /USD 1\.020 \(\+2,0 %\).*desde el 01\/10\/2026/);
});

test("papel, robot, flujo y núcleo: de las filas a cierres con fecha (canceladas y abiertas no cierran)", () => {
  const papel = operacionesDePapel([
    { data: JSON.stringify({ estado: "CERRADA", resultadoR: 1.5, abiertaA: T0, cerradaA: T0 + H }) },
    { data: JSON.stringify({ estado: "ABIERTA", resultadoR: null, abiertaA: T0 - H, cerradaA: null }) },
    { data: JSON.stringify({ estado: "CANCELADA", resultadoR: null, abiertaA: T0 - 9 * H, cerradaA: null }) },
  ]);
  assert.deepEqual(papel.cierres, [{ r: 1.5, cerradaA: T0 + H, abiertaA: T0 }]);
  assert.equal(papel.desde, T0 - H, "una cancelada no cuenta como inicio");
  const robot = cierresDeFilas([
    { r: -1, desenlace: "SL", cerrada: T0 + 2 * H, detectada: T0 },
    { r: null, desenlace: "ABIERTA", cerrada: null, detectada: T0 - H },
  ]);
  assert.deepEqual(robot.cierres, [{ r: -1, cerradaA: T0 + 2 * H, abiertaA: T0 }]);
  assert.equal(robot.desde, T0 - H);
  const nucleo = cierresDeNucleo([
    { source: "ROMPE", taken: 1, r: 2, closed_at: T0 + H, created_at: T0 },
    { source: "ROMPE", taken: 0, r: -1, closed_at: T0 + H, created_at: T0 },
  ]);
  assert.equal(nucleo.ROMPE.cierres.length, 1);
  assert.equal(nucleo["ROMPE~SOMBRA"].cierres[0].r, -1);
});
