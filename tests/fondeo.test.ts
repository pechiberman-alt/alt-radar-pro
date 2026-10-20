// Pruebas de las cuentas de fondeo y el Agente Fondeo (lib/fondeo.ts): instrumentos y prioridad, topes de las reglas, el estado de
// la cuenta, la compuerta (margen diario y total, colchón, riesgo abierto, ajuste a la baja, objetivo cumplido), la elección entre
// propuestas y que Telegram saque primero oro y NASDAQ.
import assert from "node:assert/strict";
import test from "node:test";
import {
  INSTRUMENTOS_FONDEO,
  NASDAQ_SIMBOLO,
  REGLAS_FONDEO_DEFECTO,
  SIMBOLOS_AXI,
  agenteFondeo,
  esDeFondeo,
  estadoFondeo,
  evaluarFondeo,
  normalizarReglasFondeo,
  prioridadFondeo,
  type CuentaFondeo,
  type PropuestaFondeo,
} from "../lib/fondeo.ts";
import { selectForUser, DEFAULT_TELEGRAM_PREFS, type TelegramEvent } from "../lib/telegram.ts";

const R = REGLAS_FONDEO_DEFECTO; // 10.000 USD, 5 % diario, 10 % total, 10 % objetivo, 0,5 % por operación, 1 % de colchón
const cuenta = (o: Partial<CuentaFondeo> = {}): CuentaFondeo => ({ saldo: 10_000, resultadoHoy: 0, riesgoAbiertoPct: 0, ...o });
const oro = (o: Partial<PropuestaFondeo> = {}): PropuestaFondeo => ({ symbol: "XAUUSDT", lado: "LONG", origen: "MESA", entrada: 4000, stop: 3980, rr: 2, ...o });

test("el oro es instrumento de fondeo con la prioridad más alta; el NASDAQ no se lee mientras su símbolo no esté confirmado", () => {
  assert.equal(prioridadFondeo("XAUUSDT"), 1);
  assert.ok(esDeFondeo("xauusdt"));
  assert.ok(!esDeFondeo("BTCUSDT"));
  assert.equal(prioridadFondeo("BTCUSDT"), 99);
  const nas = INSTRUMENTOS_FONDEO.find((i) => i.clave === "NASDAQ");
  assert.ok(nas);
  assert.equal(nas.symbol, NASDAQ_SIMBOLO);
  if (NASDAQ_SIMBOLO === null) assert.ok(!esDeFondeo("NASDAQUSDT"), "no se adivina un símbolo");
});

test("las reglas se llevan a los topes y lo que no es número queda en el valor por defecto", () => {
  const r = normalizarReglasFondeo({ perdidaDiariaPct: 50, perdidaTotalPct: "x", riesgoPorOperacionPct: 0.01, objetivoPct: 8 });
  assert.equal(r.perdidaDiariaPct, 10);
  assert.equal(r.perdidaTotalPct, R.perdidaTotalPct);
  assert.equal(r.riesgoPorOperacionPct, 0.1);
  assert.equal(r.objetivoPct, 8);
  assert.deepEqual(normalizarReglasFondeo(null), R);
});

test("el estado de la cuenta: pérdida de hoy, caída total, margen con colchón y objetivo", () => {
  const e = estadoFondeo(cuenta({ saldo: 9_700, resultadoHoy: -200 }), R);
  assert.equal(e.perdidaHoyPct, 2);
  assert.equal(e.caidaTotalPct, 3);
  assert.equal(e.margenDiarioPct, 2); // 5 − 1 de colchón − 2
  assert.equal(e.margenTotalPct, 6); // 10 − 1 − 3
  assert.ok(!e.objetivoCumplido);
  const g = estadoFondeo(cuenta({ saldo: 11_000, resultadoHoy: 300 }), R);
  assert.equal(g.perdidaHoyPct, 0);
  assert.ok(g.objetivoCumplido);
  assert.equal(g.progresoObjetivo, 1);
});

test("con margen de sobra pasa con el riesgo pedido y calcula el tamaño: 0,5 % de 10.000 = 50 USD a 20 de stop", () => {
  const v = evaluarFondeo(oro(), cuenta(), R);
  assert.ok(v.ok);
  assert.equal(v.riesgoPct, 0.5);
  assert.equal(v.riesgoUsd, 50);
  assert.equal(v.unidades, 2.5);
  assert.ok(!v.ajustado);
});

test("si el margen alcanza para menos que lo pedido, ajusta a la baja y lo dice", () => {
  // Ya perdió 3,6 % hoy: margen = 5 − 1 − 3,6 = 0,4 %.
  const v = evaluarFondeo(oro(), cuenta({ resultadoHoy: -360 }), R);
  assert.ok(v.ok);
  assert.ok(Math.abs(v.riesgoPct - 0.4) < 1e-9);
  assert.ok(v.ajustado);
});

test("sin margen hoy la frena y nombra el límite diario; el riesgo abierto también cuenta", () => {
  const v = evaluarFondeo(oro(), cuenta({ resultadoHoy: -400 }), R);
  assert.ok(!v.ok);
  assert.ok(v.motivos.some((m) => m.includes("hoy")));
  assert.equal(v.riesgoPct, 0);
  assert.equal(v.unidades, null);
  // Con 3,5 % de margen y 3,45 % ya abierto quedan 0,05 %: por debajo del mínimo.
  const w = evaluarFondeo(oro(), cuenta({ riesgoAbiertoPct: 3.95 }), R);
  assert.ok(!w.ok, "con 4 % de margen y 3,95 % abierto queda 0,05 %");
});

test("el límite total manda si está más cerca que el diario", () => {
  const v = evaluarFondeo(oro(), cuenta({ saldo: 9_070 }), R); // caída 9,3 %: margen total = 10 − 1 − 9,3 < 0
  assert.ok(!v.ok);
  assert.ok(v.motivos.some((m) => m.includes("total")));
});

test("el objetivo cumplido, el R:R bajo, el stop mal puesto y los datos faltantes frenan", () => {
  assert.ok(!evaluarFondeo(oro(), cuenta({ saldo: 11_200 }), R).ok);
  assert.ok(!evaluarFondeo(oro({ rr: 1.2 }), cuenta(), R).ok);
  assert.ok(!evaluarFondeo(oro({ rr: null }), cuenta(), R).ok);
  assert.ok(!evaluarFondeo(oro({ stop: 4010 }), cuenta(), R).ok);
  assert.ok(!evaluarFondeo(oro(), cuenta({ saldo: Number.NaN }), R).ok);
  assert.ok(!evaluarFondeo(oro({ symbol: "BTCUSDT" }), cuenta(), R).ok, "no es un instrumento de fondeo");
});

test("el Agente Fondeo ordena por prioridad del instrumento y elige solo la primera que pasa", () => {
  const props = [oro({ origen: "A", rr: 3 }), oro({ origen: "B", rr: 2 }), oro({ symbol: "BTCUSDT", origen: "C", rr: 5 })];
  const d = agenteFondeo(props, cuenta(), R);
  assert.equal(d.elegida?.propuesta.origen, "A", "entre dos de oro gana el mejor R:R");
  assert.deepEqual(d.revisadas.map((x) => x.propuesta.origen), ["A", "B", "C"], "lo que no es de fondeo va último");
  assert.ok(!d.revisadas[2].veredicto.ok);
  // Sin margen no elige ninguna.
  assert.equal(agenteFondeo(props, cuenta({ resultadoHoy: -450 }), R).elegida, null);
});

test("el Agente Fondeo no cambia el plan de la propuesta", () => {
  const p = oro();
  const copia = { ...p };
  agenteFondeo([p], cuenta(), R);
  assert.deepEqual(p, copia);
});

test("Telegram: oro y NASDAQ salen primero aunque su prioridad sea menor, y no quedan en el resto", () => {
  const ev = (key: string, priority: number, symbol?: string): TelegramEvent => ({ key, category: "VOLUMEN", priority, text: key, symbol });
  const eventos = [ev("a", 90, "BTCUSDT"), ev("b", 80, "ETHUSDT"), ev("c", 70, "SOLUSDT"), ev("d", 69, "BNBUSDT"), ev("oro", 10, "XAUUSDT")];
  const { send, rest } = selectForUser(eventos, DEFAULT_TELEGRAM_PREFS, new Set(), 4);
  assert.equal(send[0].key, "oro");
  assert.ok(!rest.some((e) => e.key === "oro"));
  assert.equal(rest.length, 1);
});

test("los símbolos de Axi quedan anotados aparte de los de Binance: son mercados distintos", () => {
  assert.equal(SIMBOLOS_AXI.XAU, "XAUUSD.c");
  assert.equal(SIMBOLOS_AXI.NASDAQ, "USTECH");
  // El de Binance sigue sin confirmar: el de Axi no lo reemplaza.
  assert.equal(NASDAQ_SIMBOLO, null);
  assert.notEqual(SIMBOLOS_AXI.XAU, "XAUUSDT");
});

test("la plata (XAGUSDT) es instrumento de fondeo detrás del oro y corre en papel con su propio plan, sin estudio previo", async () => {
  const { planDe, sinEstudioPrevio, SIMBOLOS_PAPEL, PLAN_FONDEO } = await import("../lib/agentes-papel.ts");
  assert.equal(prioridadFondeo("XAGUSDT"), 2);
  assert.ok(prioridadFondeo("XAUUSDT") < prioridadFondeo("XAGUSDT"));
  assert.ok(SIMBOLOS_PAPEL.includes("XAGUSDT"));
  assert.equal(planDe("XAGUSDT"), PLAN_FONDEO);
  assert.equal(sinEstudioPrevio("XAGUSDT"), true);
});
