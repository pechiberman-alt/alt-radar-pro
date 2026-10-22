/**
 * Pruebas de la pizarra de cripto del servidor (lib/pizarra-servidor.ts): el turno, las voces del núcleo (las de sombra no
 * opinan), la dirección, el plan fresco a favor, la entrada al cierre de la última vela de 4 h cerrada y la resolución (si
 * una vela toca stop y objetivo cuenta el stop, y nada mira el futuro).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SwingCandle } from "../lib/swing-entries.ts";
import { MONEDAS_AGENTES } from "../lib/agentes-papel.ts";
import { avancesPizarra, direccionDe, entradaPizarra, FRESCURA_PLAN_MS, monedaPizarraDeTurno, pizarraServidor, planDeServidor, vocesDeNucleo, type SenalNucleo } from "../lib/pizarra-servidor.ts";
import type { Deliberacion } from "../lib/pizarra.ts";

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 22, 0);
const vela = (t: number, o: number, h: number, l: number, c: number): SwingCandle => ({ openTime: t, open: o, high: h, low: l, close: c, volume: 1, quoteVolume: c });

test("turno: minutos 31 a 40 de cada hora múltiplo de 4, una moneda por minuto", () => {
  assert.equal(monedaPizarraDeTurno(T0 + 31 * 60_000), MONEDAS_AGENTES[0]);
  assert.equal(monedaPizarraDeTurno(T0 + 4 * H + 35 * 60_000), MONEDAS_AGENTES[4]);
  assert.equal(monedaPizarraDeTurno(T0 + 30 * 60_000), null);
  assert.equal(monedaPizarraDeTurno(T0 + H + 31 * 60_000), null, "solo horas múltiplo de 4");
  assert.equal(monedaPizarraDeTurno(T0 + 41 * 60_000), null);
});

const senal = (side: "LONG" | "SHORT", time: number, taken = true): SenalNucleo => ({ id: `s${time}`, source: "ROMPE", side, entry: 100, stop: side === "LONG" ? 95 : 105, target: side === "LONG" ? 115 : 85, time, taken });

test("el núcleo opina solo con señales tomadas, y la dirección es la de la mayoría de señales y agentes", () => {
  const v = vocesDeNucleo([senal("LONG", 1), senal("SHORT", 2, false)]);
  assert.equal(v.length, 1);
  assert.equal(v[0].familia, "NUCLEO");
  assert.equal(direccionDe(vocesDeNucleo([senal("SHORT", 1), senal("SHORT", 2), senal("LONG", 3)])), "CORTO");
  assert.equal(direccionDe([]), "LARGO");
});

test("el plan es la señal a favor más reciente de las últimas 8 horas", () => {
  const ahora = T0 + 10 * H;
  const vieja = senal("LONG", ahora - FRESCURA_PLAN_MS - 1);
  assert.equal(planDeServidor("LARGO", [vieja], [], ahora), null, "más vieja que 8 h no sirve");
  const p = planDeServidor("LARGO", [senal("LONG", ahora - 2 * H)], [{ clave: "sv:RSI:BTCUSDT:4h:LONG:1", lado: "LONG", vela: ahora - H, entrada: 100, sl: 96, tp1: 104, tp2: 108, tp3: 112 }], ahora);
  assert.equal(p?.fuente, "Agente RSI", "la más reciente gana");
  assert.equal(planDeServidor("CORTO", [senal("LONG", ahora - H)], [], ahora), null, "solo a favor de la dirección");
});

test("la entrada va al cierre de la última vela de 4 h cerrada y la escalera tiene que quedar en orden", () => {
  const ahora = T0 + 9 * H;
  const h4 = [vela(T0, 100, 101, 99, 100), vela(T0 + 4 * H, 100, 102, 99, 101), vela(T0 + 8 * H, 101, 101, 101, 101)];
  const d = { veredicto: "HAY PLAN", direccion: "LARGO", plan: { entrada: 100, stop: 95, tp1: 105, tp2: 110, tp3: 120, fuente: "Núcleo · ROMPE" }, razon: "x", huella: "abcd" } as unknown as Deliberacion;
  const r = entradaPizarra("BTCUSDT", h4, d, ahora);
  assert.equal(r.entrada?.entrada, 101, "la vela de las 8 todavía no cerró");
  assert.equal(r.entrada?.vela, T0 + 4 * H);
  assert.equal(r.entrada?.lado, "LONG");
  const malo = { ...d, plan: { ...d.plan!, tp1: 100.5 } } as Deliberacion;
  assert.match(entradaPizarra("BTCUSDT", h4, malo, ahora).motivo!, /no queda en orden/);
  assert.equal(entradaPizarra("BTCUSDT", h4, { ...d, veredicto: "ESPERAR" } as Deliberacion, ahora).entrada, null);
});

test("resolución: stop antes que objetivo en la misma vela, y nada mira el futuro", () => {
  const a = { clave: "x", lado: "LONG" as const, vela: T0, entrada: 100, sl: 95, tp1: 105, tp2: 110, tp3: 120, tp1_at: null, tp2_at: null };
  const h4 = [vela(T0, 100, 101, 99, 100), vela(T0 + 4 * H, 100, 125, 90, 110)];
  assert.equal(avancesPizarra([a], h4, T0 + 8 * H)[0].recorrido.desenlace, "SL");
  assert.equal(avancesPizarra([a], h4, T0 + 7 * H).length, 0, "la vela de las 4 todavía no cerró");
});

test("sin velas diarias las mentes no opinan, pero el núcleo y el riesgo sí", () => {
  const ahora = T0 + 10 * H;
  const p = pizarraServidor({ symbol: "BTCUSDT", d1: [], escritorios: [], nucleo: [senal("LONG", ahora - H)], agentes: [], ahora });
  assert.ok(p.deliberacion.voces.some((v) => v.id.startsWith("NUCLEO:")));
  assert.ok(p.deliberacion.voces.some((v) => v.id === "RIESGO:GESTOR"));
  assert.equal(p.deliberacion.voces.filter((v) => v.id.startsWith("MENTE:") && v.lado !== "ABSTIENE").length, 0);
  assert.notEqual(p.deliberacion.veredicto, "HAY PLAN", "una sola voz que opina no alcanza");
});
