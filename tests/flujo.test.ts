import assert from "node:assert/strict";
import test from "node:test";
import { resultadoR } from "../lib/escalera.ts";
import { abiertasFlujo, ensureFlujo, evaluarFlujo, registrarLecturaFlujo } from "../lib/flujo-db.ts";
import {
  claveFlujo, COMISION_FLUJO_PCT, HORIZONTE_FLUJO, PLAN_FLUJO, planDeFlujo, PUNTAJE_MINIMO_FLUJO, validarLectura, validarRecorridoFlujo,
  velaDe, VENTANA_FLUJO_MS, type LecturaFlujo,
} from "../lib/flujo.ts";
import type { SqueezeReading, StructureLevel } from "../lib/order-flow-brain.ts";
import { leerRegistroUnificado } from "../lib/registro-db.ts";
import { makeDb } from "./helpers/fake-d1.ts";

/**
 * Las lecturas del flujo de órdenes como operaciones: el plan sale de los niveles que ya calcula el libro, con una regla
 * fijada antes de medir; lo que llega del navegador se revisa y la escalera la calcula el servidor; una operación se
 * cierra una sola vez y nunca con horas en el futuro.
 */

const lectura = (bias: SqueezeReading["bias"], score = 70, type: SqueezeReading["type"] = "LONG SQUEEZE"): SqueezeReading => ({
  type, score, bias, factors: [], missing: [], detail: "",
});
const piso = (price: number): StructureLevel => ({ price, kind: "PISO", strength: 60, distancePct: 1, sources: [] });
const techo = (price: number): StructureLevel => ({ price, kind: "TECHO", strength: 60, distancePct: 1, sources: [] });
const niveles = [piso(95), piso(98), techo(110), techo(103)];

test("plan: long to the nearest floor below and the nearest ceiling above, ladder from the book's own levels", () => {
  const p = planDeFlujo(lectura("ALCISTA"), 100, niveles);
  assert.ok(p);
  assert.equal(p.lado, "LONG");
  assert.equal(p.stop, 98, "the floor just below the price");
  assert.equal(p.objetivo, 103, "the ceiling just above the price");
  assert.deepEqual(p.escalera, { stop: 98, tp1: 101, tp2: 102, tp3: 103 });
});

test("plan: short mirrors it — stop at the ceiling above, target at the floor below", () => {
  const p = planDeFlujo(lectura("BAJISTA", 80, "SHORT SQUEEZE"), 100, niveles);
  assert.ok(p);
  assert.equal(p.lado, "SHORT");
  assert.equal(p.stop, 103);
  assert.equal(p.objetivo, 98);
});

test("no plan without direction, score, or both levels: a reading that cannot be measured is not an operation", () => {
  assert.equal(planDeFlujo(lectura("ALCISTA", PUNTAJE_MINIMO_FLUJO - 1), 100, niveles), null, "score below the rule");
  assert.equal(planDeFlujo(lectura("NEUTRAL"), 100, niveles), null, "no direction");
  assert.equal(planDeFlujo(lectura("ALCISTA", 90, "SIN PRESIÓN"), 100, niveles), null, "no pressure");
  assert.equal(planDeFlujo(lectura("ALCISTA"), 100, [piso(98)]), null, "no ceiling to aim at");
  assert.equal(planDeFlujo(lectura("ALCISTA"), 100, [piso(100), techo(100), techo(103)]), null, "a level exactly on the price is not a level");
  assert.equal(planDeFlujo(lectura("ALCISTA"), 0, niveles), null);
});

test("the key: the same symbol, side and half hour is one reading; another half hour or side is another", () => {
  const t = Date.UTC(2026, 9, 13, 12, 5);
  assert.equal(claveFlujo("BTCUSDT", "LONG", t), claveFlujo("BTCUSDT", "LONG", t + 60_000));
  assert.notEqual(claveFlujo("BTCUSDT", "LONG", t), claveFlujo("BTCUSDT", "LONG", t + VENTANA_FLUJO_MS));
  assert.notEqual(claveFlujo("BTCUSDT", "LONG", t), claveFlujo("BTCUSDT", "SHORT", t));
  assert.equal(velaDe(Date.UTC(2026, 9, 13, 12, 7, 30)), Date.UTC(2026, 9, 13, 12, 5));
});

test("lectura from the browser: the ladder is recomputed here, and an incoherent or stale one is refused", () => {
  const now = Date.UTC(2026, 9, 13, 12, 0);
  const ok = { symbol: "BTCUSDT", lado: "LONG", entrada: 100, stop: 98, objetivo: 103, detectada: now, lectura: "LONG SQUEEZE", puntaje: 70 };
  const v = validarLectura(ok, now);
  assert.ok(v);
  assert.deepEqual([v.tp1, v.tp2, v.tp3], [101, 102, 103], "the server computes the thirds itself");
  assert.equal(validarLectura({ ...ok, symbol: "btc/usdt" }, now), null);
  assert.equal(validarLectura({ ...ok, lado: "CALL" }, now), null);
  assert.equal(validarLectura({ ...ok, stop: 101 }, now), null, "stop above a long entry");
  assert.equal(validarLectura({ ...ok, puntaje: PUNTAJE_MINIMO_FLUJO - 1 }, now), null);
  assert.equal(validarLectura({ ...ok, detectada: now - 10 * 60_000 }, now), null, "a reading older than two minutes is stale");
  assert.equal(validarLectura(null, now), null);
});

const LEC: LecturaFlujo = {
  clave: "flujo:BTCUSDT:5m:LONG:1", symbol: "BTCUSDT", lado: "LONG", vela: 1_000_000, detectada: 1_000_100,
  entrada: 100, stop: 98, tp1: 101, tp2: 102, tp3: 103, lectura: "LONG SQUEEZE", puntaje: 70,
};
const OP = { lado: "LONG" as const, vela: 1_000_000, entrada: 100, stop: 98, tp3: 103 };

test("recorrido: a stop closes at the stop's price, a target at the TP3's; open ones carry no R", () => {
  const ahora = 2_000_000;
  const abierta = validarRecorridoFlujo(OP, { slAt: null, tp1At: 1_100_000, tp2At: null, tp3At: null, desenlace: "ABIERTA", cerradaA: null, salida: null, r: null }, ahora);
  assert.ok(abierta.ok);
  assert.equal(abierta.recorrido.r, null);
  const sl = validarRecorridoFlujo(OP, { slAt: 1_200_000, tp1At: null, tp2At: null, tp3At: null, desenlace: "SL", cerradaA: 1_200_000, salida: 98, r: 999 }, ahora);
  assert.ok(sl.ok);
  assert.equal(sl.recorrido.r, resultadoR("LONG", 100, 98, 98, COMISION_FLUJO_PCT), "R is computed here, not taken from the browser");
  assert.ok(sl.recorrido.r! < -1, "a stop costs one R plus the fee");
  assert.equal(validarRecorridoFlujo(OP, { slAt: 1_200_000, desenlace: "SL", cerradaA: 1_200_000, salida: 97, tp1At: null, tp2At: null, tp3At: null }, ahora).ok, false, "a stop at another price is refused");
  assert.equal(validarRecorridoFlujo(OP, { slAt: null, tp1At: 1_100_000, tp2At: 1_300_000, tp3At: 1_200_000, desenlace: "TP3", cerradaA: 1_200_000, salida: 103 }, ahora).ok, false, "TP2 after TP3 is refused");
});

test("no look at the future: an hour after now, or not after the candle, is refused", () => {
  const ahora = 2_000_000;
  const futuro = { slAt: null, tp1At: 2_000_001, tp2At: null, tp3At: null, desenlace: "ABIERTA", cerradaA: null, salida: null, r: null };
  assert.equal(validarRecorridoFlujo(OP, futuro, ahora).ok, false);
  const antes = { slAt: null, tp1At: 1_000_000, tp2At: null, tp3At: null, desenlace: "ABIERTA", cerradaA: null, salida: null, r: null };
  assert.equal(validarRecorridoFlujo(OP, antes, ahora).ok, false, "a candle at the signal's own open is not after it");
});

test("db: a reading is written once, a measurement closes it once, and the registry counts it", async () => {
  const db = makeDb();
  await ensureFlujo(db);
  const now = Date.now();
  const l: LecturaFlujo = { ...LEC, vela: velaDe(now - 3_600_000), detectada: now - 3_600_000 + 60_000 };
  assert.equal(await registrarLecturaFlujo(db, 5, l), true);
  assert.equal(await registrarLecturaFlujo(db, 5, l), false, "the same key is not written twice");
  const abiertas = await abiertasFlujo(db, 5);
  assert.equal(abiertas.length, 1);
  assert.equal(abiertas[0].tp3, 103, "the stored ladder is the one the server computed");
  const salida = await evaluarFlujo(db, 5, [{ clave: l.clave, recorrido: { slAt: null, tp1At: l.vela + 300_000, tp2At: l.vela + 600_000, tp3At: l.vela + 900_000, desenlace: "TP3", cerradaA: l.vela + 900_000, salida: 103, r: null } }]);
  assert.equal(salida[0].ok, true);
  const again = await evaluarFlujo(db, 5, [{ clave: l.clave, recorrido: { slAt: l.vela + 300_000, tp1At: null, tp2At: null, tp3At: null, desenlace: "SL", cerradaA: l.vela + 300_000, salida: 98, r: null } }]);
  assert.equal(again[0].ok, false, "a closed operation is not measured again");
  const reg = await leerRegistroUnificado(db, 5, now);
  const flujo = reg.fuentes.find((f) => f.id === "FLUJO")!;
  assert.equal(flujo.cerradas, 1);
  assert.equal(flujo.ganadas, 1);
  assert.equal(flujo.abiertas, 0);
  assert.equal(reg.fuentes.find((f) => f.id === "FLUJO")!.disponible, true);
  assert.equal(await abiertasFlujo(db, 6).then((x) => x.length), 0, "another account does not see it");
  assert.ok(HORIZONTE_FLUJO === 48 && PLAN_FLUJO === "PLAN_FLUJO_1");
});
