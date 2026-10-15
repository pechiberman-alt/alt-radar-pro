// Pruebas del diario de Axi (lib/axi-diario.ts): que cada ejecución del conector se valide o se rechace con su motivo, que un dato
// faltante no se complete con cero, que el neto sea profit + swap + comisión en USC, que la muestra se cuente por cierres y que
// el resumen no calcule acierto (eso sale solo del registro unificado).
import assert from "node:assert/strict";
import test from "node:test";
import { CENTAVOS_POR_USD, MAX_DEALS_AXI, MONEDA_AXI, normalizarDeal, normalizarDeals, resumirDeals, type DealAxi } from "../lib/axi-diario.ts";

/** Los montos son decimales: se comparan con un margen, no con igualdad exacta. */
const cerca = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 1e-9, msg ?? `${a} no es ${b}`);

const compra = {
  dealId: 1001, orderId: 900, symbol: "XAUUSD.c", action: "buy", entry: "in", volumeLots: 0.1, price: 4100.25,
  profit: 0, swap: -1.2, commission: -0.5, time: "2026-10-01T09:30:00.000000Z", comment: "",
};
const cierre = {
  dealId: 1002, orderId: 901, symbol: "XAUUSD.c", action: "sell", entry: "out", volumeLots: 0.1, price: 4125.25,
  profit: 250.5, swap: 0, commission: -0.7, time: "2026-10-01T14:00:00Z", comment: "[tp]",
};
const saldo = { dealId: 1, action: "balance", entry: "in", profit: 5000, swap: 0, commission: 0, time: "2026-09-30T12:00:00Z", comment: "Depósito" };

test("una compra válida se normaliza: neto = profit + swap + comisión, en USC", () => {
  const r = normalizarDeal(compra);
  assert.ok(r.ok);
  assert.equal(r.deal.tipo, "operacion");
  assert.equal(r.deal.simbolo, "XAUUSD.c");
  assert.equal(r.deal.entrada, "in");
  assert.equal(r.deal.id, "1001");
  assert.equal(r.deal.orden, "900");
  cerca(r.deal.neto, -1.7);
  assert.equal(r.deal.tiempo, Date.parse("2026-10-01T09:30:00Z"));
});

test("un cierre cuenta como cierre y su neto incluye la comisión", () => {
  const r = normalizarDeals([compra, cierre]);
  assert.equal(r.rechazados.length, 0);
  const res = resumirDeals(r.deals);
  assert.equal(res.operaciones, 2);
  assert.equal(res.cierres, 1);
  cerca(res.netoOperaciones, -1.7 + (250.5 - 0.7));
});

test("un movimiento de saldo (depósito) no es una operación y no se mezcla con el neto de operaciones", () => {
  const r = normalizarDeal(saldo);
  assert.ok(r.ok);
  assert.equal(r.deal.tipo, "movimiento");
  assert.equal(r.deal.simbolo, "");
  const res = resumirDeals([r.deal, ...normalizarDeals([cierre]).deals]);
  assert.equal(res.movimientos, 1);
  assert.equal(res.netoMovimientos, 5000);
  assert.equal(res.operaciones, 1);
  cerca(res.netoOperaciones, 249.8);
});

test("un dato que hace falta se rechaza con su motivo: nunca se completa con cero", () => {
  const casos: [string, unknown, string][] = [
    ["sin resultado", { ...compra, profit: undefined }, "falta el resultado (profit)"],
    ["sin swap", { ...compra, swap: undefined }, "falta el swap"],
    ["sin comisión", { ...compra, commission: "" }, "falta la comisión"],
    ["volumen cero", { ...compra, volumeLots: 0 }, "volumen inválido"],
    ["precio texto", { ...compra, price: "abc" }, "precio inválido"],
    ["símbolo con espacio", { ...compra, symbol: "XAU USD" }, "símbolo inválido"],
    ["entrada rara", { ...compra, entry: "xyz" }, "entrada inválida"],
    ["hora rota", { ...compra, time: "ayer a la tarde" }, "hora inválida"],
    ["sin id", { ...compra, dealId: undefined }, "falta el id de la ejecución"],
    ["sin acción", { ...compra, action: "" }, "falta la acción"],
    ["no es un objeto", "1001", "no es una ejecución"],
    ["lista como ejecución", [compra], "no es una ejecución"],
  ];
  for (const [nombre, raw, motivo] of casos) {
    const r = normalizarDeal(raw);
    assert.equal(r.ok, false, nombre);
    if (!r.ok) assert.equal(r.motivo, motivo, nombre);
  }
});

test("el rechazo dice en qué posición venía la ejecución mala y no frena a las buenas", () => {
  const r = normalizarDeals([compra, { ...compra, dealId: 1009, price: 0 }, cierre]);
  assert.deepEqual(r.rechazados, [{ posicion: 2, motivo: "precio inválido" }]);
  assert.deepEqual(r.deals.map((d) => d.id), ["1001", "1002"]);
});

test("la hora sin zona se toma como UTC, la fracción de segundo se recorta y un número se acepta en milisegundos", () => {
  const sinZona = normalizarDeal({ ...compra, time: "2026-10-01 09:30:00" });
  assert.ok(sinZona.ok);
  assert.equal(sinZona.deal.tiempo, Date.UTC(2026, 9, 1, 9, 30, 0));
  const ms = normalizarDeal({ ...compra, time: Date.UTC(2026, 9, 1, 9, 30) });
  assert.ok(ms.ok);
  assert.equal(ms.deal.tiempo, Date.UTC(2026, 9, 1, 9, 30));
  const viejo = normalizarDeal({ ...compra, time: 1000 });
  assert.equal(viejo.ok, false, "1970 no es una hora de operación");
});

test("un id numérico se guarda como texto, para que no cambie de tipo entre importaciones", () => {
  const r = normalizarDeal({ ...compra, dealId: 42 });
  assert.ok(r.ok);
  assert.equal(r.deal.id, "42");
});

test("la muestra se cuenta por cierres: sin cierres no hay muestra, menos de 15 es mínima, 15 o más es razonable", () => {
  const cierres = (n: number) =>
    Array.from({ length: n }, (_, i) => normalizarDeal({ ...cierre, dealId: 5000 + i }))
      .flatMap((r) => (r.ok ? [r.deal] : []));
  assert.equal(resumirDeals([]).muestra, "SIN DATOS");
  assert.equal(resumirDeals(cierres(14)).muestra, "MINIMA");
  assert.equal(resumirDeals(cierres(15)).muestra, "RAZONABLE");
  assert.equal(resumirDeals(cierres(15)).cierres, 15);
});

test("el resumen agrupa por mes (el más reciente primero) y por símbolo (el de más operaciones primero)", () => {
  const ops: DealAxi[] = [
    normalizarDeal({ ...compra, dealId: 1, time: "2026-08-03T10:00:00Z" }),
    normalizarDeal({ ...cierre, dealId: 2, time: "2026-10-02T10:00:00Z" }),
    normalizarDeal({ ...cierre, dealId: 3, time: "2026-10-03T10:00:00Z", symbol: "USTECH" }),
    normalizarDeal({ ...cierre, dealId: 4, time: "2026-10-04T10:00:00Z", symbol: "USTECH" }),
  ].flatMap((r) => (r.ok ? [r.deal] : []));
  const res = resumirDeals(ops);
  assert.deepEqual(res.meses.map((m) => m.mes), ["2026-10", "2026-08"]);
  assert.equal(res.meses[0].operaciones, 3);
  assert.equal(res.meses[0].cierres, 3);
  assert.deepEqual(res.simbolos.map((s) => s.simbolo), ["USTECH", "XAUUSD.c"]);
  assert.equal(res.primero, Date.parse("2026-08-03T10:00:00Z"));
  assert.equal(res.ultimo, Date.parse("2026-10-04T10:00:00Z"));
});

test("el resumen va en USC y no trae acierto, profit factor ni expectancia: eso sale solo del registro unificado", () => {
  const res = resumirDeals(normalizarDeals([compra, cierre]).deals);
  assert.equal(res.moneda, MONEDA_AXI);
  assert.equal(MONEDA_AXI, "USC");
  assert.equal(CENTAVOS_POR_USD, 100);
  for (const prohibido of ["winRate", "profitFactor", "expectancia", "intervalo", "ganadas", "perdidas"]) {
    assert.equal(prohibido in res, false, prohibido);
  }
});

test("el tope por persona es de 500 ejecuciones", () => {
  assert.equal(MAX_DEALS_AXI, 500);
});
