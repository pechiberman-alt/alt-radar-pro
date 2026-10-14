/**
 * Tests del preregistro del flujo (lib/preregistro-flujo.ts): cada filtro usa solo datos conocidos al cierre de la vela
 * de la señal (no mira el futuro) y un dato faltante no aprueba ni rechaza: queda como desconocido.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FILTROS, ultimoHasta, type Flujo } from "../lib/preregistro-flujo.ts";

const M = 4 * 3_600_000;
const vacio = (): Flujo => ({ taker: new Map(), funding: [], oi: [] });

test("ultimoHasta: el último valor con hora menor o igual", () => {
  const s: [number, number][] = [[10, 1], [20, 2], [30, 3]];
  assert.equal(ultimoHasta(s, 5), null);
  assert.equal(ultimoHasta(s, 20), 2);
  assert.equal(ultimoHasta(s, 29), 2);
  assert.equal(ultimoHasta(s, 99), 3);
});

test("F1 y F2: compradores agresivos; sin dato, desconocido", () => {
  const f = vacio();
  for (let k = 0; k < 6; k += 1) f.taker.set(10 * M - k * M, [100, k === 0 ? 70 : 45]);
  assert.equal(FILTROS.F1_TAKER_VELA.pasa(f, 10 * M, M), true);
  assert.equal(FILTROS.F2_DELTA_24H.pasa(f, 10 * M, M), false, "40 - 5×10 = -10");
  assert.equal(FILTROS.F1_TAKER_VELA.pasa(f, 99 * M, M), null);
  assert.equal(FILTROS.F2_DELTA_24H.pasa(f, 11 * M, M), null, "falta la vela 11");
});

test("F3 y F4 no miran el futuro: un dato posterior al cierre de la vela no cuenta", () => {
  const f = vacio();
  const abre = 100 * M;
  f.funding = [[abre - 1, 0.00005], [abre + M, 0.01]]; // el segundo llega después del cierre
  assert.equal(FILTROS.F3_FUNDING.pasa(f, abre, M), true);
  f.oi = [[abre + M - 1 - 24 * 3_600_000, 100], [abre + M - 1, 101], [abre + M, 50]];
  assert.equal(FILTROS.F4_OI_24H.pasa(f, abre, M), true);
  f.oi = [[abre + M - 1, 101]];
  assert.equal(FILTROS.F4_OI_24H.pasa(f, abre, M), null, "sin el dato de 24 h antes");
});
