/**
 * Pruebas de las señales de BYMA del servidor (lib/ar-senales.ts): el turno (un papel por minuto, días hábiles, 21 UTC), que
 * solo entra la rueda del día, las entradas de agentes y de la pizarra, la resolución (si una rueda toca stop y objetivo
 * cuenta el stop, y nada mira el futuro) y los avisos de Telegram.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SwingCandle } from "../lib/swing-entries.ts";
import type { AgenteEnPapel } from "../lib/mercado-ar-agentes.ts";
import type { ZonaFibAr } from "../lib/mercado-ar-tecnico.ts";
import type { Deliberacion } from "../lib/pizarra.ts";
import { PAPELES_AR } from "../lib/mercado-ar.ts";
import { avancesAr, avisosAr, claveAr, entradasAr, papelDeTurno, ruedaDeHoy } from "../lib/ar-senales.ts";

const DIA = 86_400_000;
const LUNES = Date.UTC(2026, 9, 19); // lunes 19/10/2026
const rueda = (dia: number, o: number, h: number, l: number, c: number): SwingCandle => ({ openTime: dia + 13.5 * 3_600_000, open: o, high: h, low: l, close: c, volume: 1000, quoteVolume: 1000 * c });

test("turno: un papel por minuto a las 21 UTC, de lunes a viernes", () => {
  assert.equal(papelDeTurno(LUNES + 21 * 3_600_000)?.ticker, PAPELES_AR[0].ticker);
  assert.equal(papelDeTurno(LUNES + 21 * 3_600_000 + 5 * 60_000)?.ticker, PAPELES_AR[5].ticker);
  assert.equal(papelDeTurno(LUNES + 20 * 3_600_000), null, "a las 20 UTC BYMA recién cierra");
  assert.equal(papelDeTurno(LUNES - DIA + 21 * 3_600_000), null, "domingo");
  assert.equal(papelDeTurno(LUNES + 21 * 3_600_000 + 59 * 60_000), null, "después del último papel");
  assert.ok(PAPELES_AR.length <= 60);
});

const pizarra = (veredicto: Deliberacion["veredicto"], plan: Deliberacion["plan"]): Deliberacion =>
  ({ veredicto, plan, razon: "3 a favor de 2 familias distintas.", huella: "abcd1234" }) as unknown as Deliberacion;
const agente = (rueda0: number, ref: number): AgenteEnPapel =>
  ({ id: "RSI", agente: "Agente RSI", nombre: "RSI", regla: "x", ops: [], senalHoy: { rueda: rueda0, referencia: ref, escalera: { stop: ref * 0.95, tp1: ref * 1.05, tp2: ref * 1.1, tp3: ref * 1.2 }, rr: 4 } }) as unknown as AgenteEnPapel;

test("solo entra la rueda del día: con feriado o fuente vieja no hay entradas", () => {
  const velas = [rueda(LUNES - 3 * DIA, 100, 101, 99, 100), rueda(LUNES, 100, 102, 99, 101)];
  const ahora = LUNES + 21 * 3_600_000;
  assert.equal(ruedaDeHoy(velas, ahora), true);
  assert.equal(ruedaDeHoy(velas, ahora + DIA), false);
  const plan = { entrada: 100, stop: 95, tp1: 105, tp2: 110, tp3: 120, fuente: "Fibonacci" };
  const hoy = entradasAr("GGAL", velas, [agente(velas[1].openTime, 101)], pizarra("HAY PLAN", plan), ahora);
  assert.deepEqual(hoy.entradas.map((e) => e.fuente), ["AGENTE", "PIZARRA"]);
  assert.equal(hoy.entradas[1].entrada, 101, "la pizarra entra al cierre de la rueda");
  assert.equal(hoy.entradas[1].huella, "abcd1234");
  assert.equal(hoy.entradas[0].clave, claveAr("AGENTE", "RSI", "GGAL", velas[1].openTime));
  assert.equal(entradasAr("GGAL", velas, [agente(velas[1].openTime, 101)], pizarra("HAY PLAN", plan), ahora + DIA).entradas.length, 0);
});

test("la pizarra sin «hay plan» no entra; con una escalera que no queda en orden al cierre, se dice por qué", () => {
  const velas = [rueda(LUNES, 100, 102, 99, 101)];
  const ahora = LUNES + 21 * 3_600_000;
  assert.equal(entradasAr("GGAL", velas, [], pizarra("ESPERAR", null), ahora).entradas.length, 0);
  const limite = { entrada: 90, stop: 85, tp1: 100, tp2: 110, tp3: 120, fuente: "Fibonacci" }; // TP1 bajo el cierre de 101
  const r = entradasAr("GGAL", velas, [], pizarra("HAY PLAN", limite), ahora);
  assert.equal(r.entradas.length, 0);
  assert.match(r.descartada!, /no queda en orden/);
});

test("resolución: si una rueda toca stop y objetivo cuenta el stop, y nada mira el futuro", () => {
  const senal = LUNES + 13.5 * 3_600_000;
  const a = { clave: "x", vela: senal, entrada: 100, sl: 95, tp1: 105, tp2: 110, tp3: 120, tp1_at: null, tp2_at: null };
  const ambos = [rueda(LUNES, 100, 101, 99, 100), rueda(LUNES + DIA, 100, 125, 90, 110)];
  const r = avancesAr([a], ambos, LUNES + 2 * DIA);
  assert.equal(r[0].recorrido.desenlace, "SL");
  assert.ok(r[0].recorrido.r! < -1, "pierde algo más de 1 R por la comisión");
  // La rueda de mañana todavía no cerró: no cuenta.
  assert.equal(avancesAr([a], ambos, LUNES + DIA + 3_600_000).length, 0);
  const sube = [rueda(LUNES, 100, 101, 99, 100), rueda(LUNES + DIA, 100, 106, 99, 105)];
  const t = avancesAr([a], sube, LUNES + 2 * DIA);
  assert.equal(t[0].recorrido.desenlace, "ABIERTA");
  assert.notEqual(t[0].recorrido.tp1At, null, "toca TP1 y queda registrado con su hora");
});

const papel = PAPELES_AR[0];
const fib = (estado: ZonaFibAr["estado"]): ZonaFibAr =>
  ({ estado, plan: { entrada: 95, stop: 90, tp1: 100, tp2: 105, tp3: 115, rr: 4 }, historial: { aguantaron: 2, fallaron: 1 } }) as unknown as ZonaFibAr;

test("avisos: entrar a la zona de Fibonacci (no en la primera lectura) y el plan de la pizarra", () => {
  const pz = pizarra("ESPERAR", null);
  assert.equal(avisosAr(papel, 1, null, fib("EN LA ZONA"), [], pz).length, 0, "sin lectura anterior no se sabe si entró");
  assert.equal(avisosAr(papel, 1, "EN LA ZONA", fib("EN LA ZONA"), [], pz).length, 0, "ya estaba adentro");
  const entra = avisosAr(papel, 1, "ARRIBA DE LA ZONA", fib("EN LA ZONA"), [], pz);
  assert.equal(entra.length, 1);
  assert.match(entra[0].texto, /zona de compra de Fibonacci/);
  assert.match(entra[0].texto, /muestra mínima/);
  assert.match(entra[0].texto, /No es asesoramiento financiero/);
  const plan = { clave: "c", fuente: "PIZARRA" as const, estrategia: "PIZARRA", ticker: papel.ticker, vela: 1, detectada: 1, entrada: 101, escalera: { stop: 95, tp1: 105, tp2: 110, tp3: 120 }, huella: "abcd1234", detalle: "x" };
  const conPlan = avisosAr(papel, 1, "EN LA ZONA", fib("EN LA ZONA"), [plan], pizarra("HAY PLAN", null));
  assert.equal(conPlan.length, 1);
  assert.match(conPlan[0].texto, /la pizarra da plan/);
  assert.match(conPlan[0].texto, /abcd1234/);
});
