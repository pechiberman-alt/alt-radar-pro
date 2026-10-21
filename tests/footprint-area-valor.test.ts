// Pruebas del footprint verificado (lib/footprint.ts y lib/order-flow.ts) con datos conocidos: el área de valor es la
// banda CONTIGUA alrededor del POC (método CBOT, 70 %), el POC no depende del orden de llegada, una vela con huecos en los
// ids de aggTrade es parcial, una operación repetida cuenta una vez y lo que llega después no cambia las velas anteriores.
import assert from "node:assert/strict";
import test from "node:test";
import { buildFootprints, valueArea, type Trade } from "../lib/footprint.ts";
import { footprintRows, type OrderFlowTrade } from "../lib/order-flow.ts";

const niveles = (xs: [number, number][]) => xs.map(([price, volume]) => ({ price, volume }));

test("área de valor: desde el POC suma el par de niveles con más volumen hasta llegar al 70 %", () => {
  // Total 120, objetivo 84. POC 100 (50). Arriba 101+102 = 35 contra abajo 99+98 = 30: sube y llega a 85.
  const va = valueArea(niveles([[98, 10], [99, 20], [100, 50], [101, 30], [102, 5], [103, 5]]), 1);
  assert.deepEqual(va, { poc: 100, val: 100, vah: 102, total: 120, inside: 85 });
});

test("área de valor contigua: un nivel grande pero alejado del POC no entra salteando los del medio", () => {
  // Por volumen solo (el método anterior del bookmap), 95 entraba con 100 y 99, dejando un hueco en 96–98.
  const va = valueArea(niveles([[95, 30], [99, 20], [100, 40], [101, 20]]), 1)!;
  assert.equal(va.poc, 100);
  assert.deepEqual([va.val, va.vah], [98, 101]);
  assert.ok(va.inside >= va.total * 0.7);
});

test("POC: en empate gana el más cercano al medio del rango y después el más bajo, sin importar el orden de llegada", () => {
  assert.equal(valueArea(niveles([[99, 10], [101, 10]]), 1)!.poc, 99);
  assert.equal(valueArea(niveles([[101, 10], [99, 10]]), 1)!.poc, 99);
  assert.equal(valueArea(niveles([[98, 10], [100, 10], [104, 10]]), 1)!.poc, 100);
  assert.equal(valueArea([], 1), null);
  assert.equal(valueArea(niveles([[100, 0]]), 1), null, "sin volumen no hay POC");
  assert.equal(valueArea(niveles([[100, 5]]), 0), null);
});

const t = (id: number, price: number, qty: number, time: number, buyerIsMaker = false): Trade => ({ id, price, qty, time, buyerIsMaker });
const M = 60_000;

test("vela completa: operaciones desde la apertura y sin ids faltantes; con POC y área de valor", () => {
  const fps = buildFootprints([t(1, 100, 5, 0), t(2, 101, 1, 10), t(3, 100, 2, 20, true), t(4, 102, 1, M), t(5, 102, 1, M + 1)], [0, M], M, 1, 0);
  const a = fps.get(0)!;
  assert.equal(a.gaps, 0);
  assert.equal(a.complete, true);
  assert.equal(a.poc, 100);
  assert.deepEqual([a.val, a.vah], [100, 100], "100 tiene 7 de 8: alcanza solo");
  assert.equal(fps.get(M)!.complete, true);
});

test("huecos en los ids de aggTrade: dentro de una vela, la vela es parcial", () => {
  const fps = buildFootprints([t(1, 100, 1, 0), t(2, 100, 1, 10), t(4, 100, 1, 20)], [0], M, 1, 0);
  assert.equal(fps.get(0)!.gaps, 1);
  assert.equal(fps.get(0)!.complete, false);
});

test("huecos entre dos velas: las dos quedan parciales, porque lo que falta puede ser de cualquiera", () => {
  const fps = buildFootprints([t(1, 100, 1, 0), t(2, 100, 1, 10), t(5, 100, 1, M), t(6, 100, 1, M + 1)], [0, M], M, 1, 0);
  assert.equal(fps.get(0)!.gaps, 2);
  assert.equal(fps.get(M)!.gaps, 2);
  assert.equal(fps.get(0)!.complete, false);
  assert.equal(fps.get(M)!.complete, false);
});

test("sin ids que se puedan comprobar, la vela no se da por completa; una operación repetida cuenta una sola vez", () => {
  const sinIds = buildFootprints([t(0, 100, 1, 0), t(0, 100, 1, 10)], [0], M, 1, 0);
  assert.equal(sinIds.get(0)!.gaps, null);
  assert.equal(sinIds.get(0)!.complete, false);
  const repetida = buildFootprints([t(1, 100, 2, 0), t(1, 100, 2, 0), t(2, 100, 1, 5)], [0], M, 1, 0);
  assert.equal(repetida.get(0)!.buy, 3, "la misma operación por REST y por el stream no se suma dos veces");
});

test("no mira el futuro: las operaciones de velas posteriores no cambian el footprint de las anteriores", () => {
  const antes = [t(1, 100, 3, 0), t(2, 101, 1, 10, true), t(3, 100, 2, M), t(4, 99, 1, M + 5)];
  const despues = [...antes, t(5, 103, 9, 2 * M), t(6, 104, 9, 2 * M + 1)];
  const a = buildFootprints(antes, [0, M, 2 * M], M, 1, 0);
  const b = buildFootprints(despues, [0, M, 2 * M], M, 1, 0);
  for (const time of [0, M]) {
    const x = a.get(time)!;
    const y = b.get(time)!;
    assert.deepEqual([...y.cells], [...x.cells]);
    assert.deepEqual([y.buy, y.sell, y.poc, y.val, y.vah, y.gaps, y.complete], [x.buy, x.sell, x.poc, x.val, x.vah, x.gaps, x.complete]);
  }
});

test("bookmap: el área de valor es contigua y sale de todos los niveles operados", () => {
  const op = (price: number, notional: number): OrderFlowTrade => ({ price, qty: notional / price, notional, buyerMaker: false, time: 0 });
  const rows = footprintRows([op(95, 30), op(99, 20), op(100, 40), op(101, 20)], 100, 1);
  const dentro = rows.filter((r) => r.inValueArea).map((r) => r.price).sort((x, y) => x - y);
  assert.deepEqual(dentro, [99, 100, 101]);
  assert.equal(rows.find((r) => r.price === 95)!.inValueArea, false);
});
