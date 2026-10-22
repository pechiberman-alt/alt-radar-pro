/**
 * Pruebas de la pizarra (lib/pizarra.ts): las voces de cada fuente y las reglas de la deliberación: el veto de riesgo gana,
 * una abstención no es un voto en contra, sin plan completo no hay operación y hacen falta dos familias distintas.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_RR } from "../lib/jarvis-desk.ts";
import {
  MIN_OPINAN,
  RR_MINIMO,
  deliberar,
  huellaDe,
  planCompleto,
  rrDelPlan,
  vocesDeAgentes,
  vocesDeConsejo,
  vocesDeMentes,
  vozEstructura,
  vozFib,
  vozRiesgo,
  type Voz,
  type PlanComun,
} from "../lib/pizarra.ts";
import type { Razonamiento } from "../lib/mentes-metodo.ts";

const voz = (id: string, familia: Voz["familia"], lado: Voz["lado"], extra: Partial<Voz> = {}): Voz => ({ id, nombre: id, familia, lado, motivo: `motivo de ${id}`, veto: false, muestra: null, falta: null, cambiaria: `cambia ${id}`, ...extra });
const plan: PlanComun = { entrada: 100, stop: 95, tp1: 105, tp2: 110, tp3: 120, fuente: "test" };

test("el mínimo de riesgo/beneficio es el mismo que el de la mesa de JARVIS", () => {
  assert.equal(RR_MINIMO, MIN_RR);
});

test("un plan es completo solo con entrada, SL y tres objetivos en orden", () => {
  assert.equal(planCompleto(plan, "LARGO"), true);
  assert.equal(planCompleto({ ...plan, tp2: 104 }, "LARGO"), false, "TP2 antes que TP1");
  assert.equal(planCompleto({ ...plan, stop: 101 }, "LARGO"), false, "stop sobre la entrada");
  assert.equal(planCompleto(null, "LARGO"), false);
  assert.equal(planCompleto({ entrada: 100, stop: 105, tp1: 95, tp2: 90, tp3: 80, fuente: "t" }, "CORTO"), true);
  assert.equal(rrDelPlan(plan, "LARGO"), 4);
});

test("el veto del gestor de riesgo gana a cualquier cantidad de votos a favor", () => {
  const d = deliberar({
    activo: "BTC",
    voces: [voz("a", "MESA", "LARGO"), voz("b", "ZONA", "LARGO"), voz("c", "MOMENTUM", "LARGO"), voz("d", "VALOR", "LARGO"), voz("r", "RIESGO_MESA", "AFUERA", { veto: true, motivo: "R:R 1:1" })],
    plan,
  });
  assert.equal(d.veredicto, "NO OPERAR");
  assert.match(d.razon, /veta/);
  assert.equal(d.vetos.length, 1);
});

test("el riesgo veta si la relación no llega al mínimo y aprueba si llega", () => {
  const malo = vozRiesgo({ entrada: 100, stop: 95, tp1: 101, tp2: 102, tp3: 105, fuente: "t" }, "LARGO");
  assert.equal(malo.veto, true);
  assert.equal(malo.lado, "AFUERA");
  const bueno = vozRiesgo(plan, "LARGO");
  assert.equal(bueno.veto, false);
  assert.equal(bueno.lado, "LARGO");
  assert.match(bueno.motivo, /1 % de la cuenta/);
  assert.equal(vozRiesgo(null, "LARGO").lado, "ABSTIENE");
});

test("una abstención no es un voto en contra: con pocas voces que opinan no hay decisión", () => {
  const d = deliberar({ activo: "GGAL", voces: [voz("a", "VALOR", "LARGO"), voz("b", "MOMENTUM", "LARGO"), voz("c", "VALOR", "ABSTIENE", { falta: "balances" }), voz("d", "CRECIMIENTO", "ABSTIENE")], plan });
  assert.equal(d.veredicto, "SIN DATOS SUFICIENTES");
  assert.equal(d.enContra.length, 0, "las abstenciones no cuentan en contra");
  assert.ok(MIN_OPINAN >= 3);
  assert.match(d.debate.at(-2)!.texto, /Se abstienen/);
  assert.ok(d.destraba.some((t) => /necesita: balances/.test(t)));
});

test("sin plan completo no hay operación aunque todos estén a favor", () => {
  const d = deliberar({ activo: "ETH", voces: [voz("a", "ZONA", "LARGO"), voz("b", "MOMENTUM", "LARGO"), voz("c", "VALOR", "LARGO")], plan: null });
  assert.equal(d.veredicto, "ESPERAR");
  assert.match(d.razon, /sin plan no hay operación/);
});

test("HAY PLAN pide dos familias distintas, dos votos más a favor que en contra y plan completo", () => {
  const dos = deliberar({ activo: "YPFD", voces: [voz("a", "ZONA", "LARGO"), voz("b", "MOMENTUM", "LARGO"), voz("c", "VALOR", "ESPERA")], plan });
  assert.equal(dos.veredicto, "HAY PLAN");
  assert.match(dos.huella, /^[0-9a-f]{8}$/);

  const mismaFamilia = deliberar({ activo: "YPFD", voces: [voz("a", "MOMENTUM", "LARGO"), voz("b", "MOMENTUM", "LARGO"), voz("c", "VALOR", "ESPERA")], plan });
  assert.equal(mismaFamilia.veredicto, "ESPERAR");
  assert.match(mismaFamilia.razon, /misma familia/);

  const estrecha = deliberar({ activo: "YPFD", voces: [voz("a", "ZONA", "LARGO"), voz("b", "MOMENTUM", "LARGO"), voz("c", "VALOR", "AFUERA"), voz("d", "AGENTE", "ESPERA")], plan });
  assert.equal(estrecha.veredicto, "ESPERAR", "2 a favor y 1 en contra es una ventaja estrecha");
  assert.match(estrecha.razon, /ventaja es estrecha/);

  const mayoriaEnContra = deliberar({ activo: "YPFD", voces: [voz("a", "ZONA", "LARGO"), voz("b", "MOMENTUM", "LARGO"), voz("c", "VALOR", "AFUERA"), voz("d", "CONTRARIA", "AFUERA")], plan });
  assert.equal(mayoriaEnContra.veredicto, "NO OPERAR");
  assert.ok(mayoriaEnContra.discrepancias.length >= 1, "ZONA contra VALOR es una discrepancia entre familias");
  assert.notEqual(mayoriaEnContra.discrepancias[0].favor.familia, mayoriaEnContra.discrepancias[0].contra.familia);
});

test("en corto, a favor es el lado corto", () => {
  const corto: PlanComun = { entrada: 100, stop: 105, tp1: 95, tp2: 90, tp3: 80, fuente: "t" };
  const d = deliberar({ activo: "SOL", direccion: "CORTO", voces: [voz("a", "MESA", "CORTO"), voz("b", "ZONA", "CORTO"), voz("c", "VALOR", "ESPERA")], plan: corto });
  assert.equal(d.veredicto, "HAY PLAN");
  assert.equal(d.aFavor.length, 2);
});

test("la huella es estable y cambia si cambia una voz o el plan", () => {
  const voces = [voz("a", "ZONA", "LARGO"), voz("b", "MOMENTUM", "LARGO"), voz("c", "VALOR", "ESPERA")];
  const h1 = deliberar({ activo: "X", voces, plan }).huella;
  assert.equal(deliberar({ activo: "X", voces: [...voces].reverse(), plan }).huella, h1, "no depende del orden");
  assert.notEqual(deliberar({ activo: "X", voces, plan: { ...plan, tp3: 121 } }).huella, h1);
  assert.notEqual(deliberar({ activo: "X", voces: [voz("a", "ZONA", "AFUERA"), ...voces.slice(1)], plan }).huella, h1);
  assert.equal(huellaDe("abc"), huellaDe("abc"));
});

test("las mentes pasan a voces: fuera de su método y sin datos se abstienen", () => {
  const r = (veredicto: Razonamiento["veredicto"], id: Razonamiento["id"]): Razonamiento => ({ id, mente: "Warren Buffett (x)", familia: "VALOR", clase: null, pasos: [], veredicto, porQue: "porque sí", plan: null, cambiaria: ["si baja"], noSabe: ["el foso"] });
  const v = vocesDeMentes([r("COMPRARÍA", "BUFFETT"), r("NO LO TOCARÍA", "GRAHAM"), r("FUERA DE MI MÉTODO", "LYNCH"), r("SIN DATOS", "MUSK"), r("INFORMA", "DALIO")]);
  assert.deepEqual(v.map((x) => x.lado), ["LARGO", "AFUERA", "ABSTIENE", "ABSTIENE", "ABSTIENE"]);
  assert.equal(v[0].nombre, "Warren Buffett");
  assert.equal(v[2].falta, "el foso");
  assert.match(v[2].motivo, /Fuera de mi método/);
});

test("los agentes: solo opinan los que disparan hoy y con muestra mínima se dice", () => {
  const v = vocesDeAgentes([
    { id: "RSI", nombre: "Agente RSI", ops: [{ r: 1 }, { r: -1 }, { r: 2 }], senalHoy: { rr: 2.5 } },
    { id: "SNR", nombre: "Agente SNR", ops: [], senalHoy: null },
  ]);
  assert.equal(v.length, 1);
  assert.match(v[0].motivo, /2 de 3 cerradas ganaron \(muestra mínima\)/);
  assert.match(v[0].motivo, /1:2,5/);
  assert.equal(v[0].muestra, 3);
});

test("Fibonacci y estructura como voces", () => {
  const h = { aguantaron: 4, fallaron: 1 };
  assert.equal(vozFib({ estado: "EN LA ZONA", historial: h }).lado, "LARGO");
  assert.equal(vozFib({ estado: "ARRIBA DE LA ZONA", historial: h }).lado, "ESPERA");
  assert.equal(vozFib({ estado: "INVALIDADA", historial: h }).lado, "AFUERA");
  assert.equal(vozFib(null).lado, "ABSTIENE");
  assert.match(vozFib({ estado: "EN LA ZONA", historial: h }).motivo, /muestra mínima/);
  assert.equal(vozEstructura({ tendencia: "ALCISTA", detalle: "x" }).lado, "LARGO");
  assert.equal(vozEstructura({ tendencia: "BAJISTA", detalle: "x" }).lado, "AFUERA");
  assert.equal(vozEstructura({ tendencia: "BAJISTA", detalle: "x" }, "CORTO").lado, "CORTO");
  assert.equal(vozEstructura({ tendencia: "SIN DATOS", detalle: "poco" }).lado, "ABSTIENE");
});

test("la mesa de JARVIS como voces: votos, sin datos y compuerta de riesgo que veta", () => {
  const v = vocesDeConsejo({
    votos: [
      { id: "tendencia", nombre: "Tendencia", estado: "VOTA", postura: "ALCISTA", hallazgo: "sobre la EMA 200", falta: [] },
      { id: "derivados", nombre: "Derivados", estado: "SIN DATOS", postura: null, hallazgo: null, falta: ["funding"] },
      { id: "vol", nombre: "Volatilidad", estado: "CONTEXTO", postura: null, hallazgo: "x", falta: [] },
    ],
    compuertas: [
      { id: "riesgo", estado: "FALLA", detalle: "Veto: R:R bajo." },
      { id: "momento", estado: "FALLA", detalle: "Esperar: evento cerca." },
    ],
  });
  assert.deepEqual(v.map((x) => x.lado), ["LARGO", "ABSTIENE", "AFUERA", "ESPERA"]);
  assert.equal(v[2].veto, true);
  assert.equal(v[1].falta, "funding");
  const d = deliberar({ activo: "BTC", voces: v, plan });
  assert.equal(d.veredicto, "NO OPERAR");
});

test("las mentes son lentes de compra: en una discusión de cortos, las que no compran se abstienen", () => {
  const r = (veredicto: Razonamiento["veredicto"], id: Razonamiento["id"]): Razonamiento => ({ id, mente: "Mente", familia: "VALOR", clase: null, pasos: [], veredicto, porQue: "porque sí", plan: null, cambiaria: [], noSabe: ["algo"] });
  const v = vocesDeMentes([r("COMPRARÍA", "BUFFETT"), r("ESPERARÍA", "GRAHAM"), r("NO LO TOCARÍA", "LYNCH"), r("AFUERA", "PTJ")], "CORTO");
  assert.deepEqual(v.map((x) => x.lado), ["LARGO", "ESPERA", "ABSTIENE", "ABSTIENE"]);
  assert.match(v[2].motivo, /no opina sobre cortos/);
  const d = deliberar({ activo: "X", direccion: "CORTO", voces: v });
  assert.equal(d.enContra.length, 1, "el que compraría está en contra de un corto");
  assert.equal(d.abstienen.length, 2);
});
