/**
 * Pruebas de la pizarra por activo (lib/pizarra-activos.ts): BYMA con las nueve mentes, los agentes, Fibonacci y el riesgo;
 * cripto con la mesa de JARVIS (su veto gana) y las lentes de valor abstenidas; y el guion de la reunión de la oficina.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SwingCandle } from "../lib/swing-entries.ts";
import type { AgenteEnPapel } from "../lib/mercado-ar-agentes.ts";
import type { ZonaFibAr } from "../lib/mercado-ar-tecnico.ts";
import type { DeskDecision } from "../lib/jarvis-desk.ts";
import type { DeskSnapshot } from "../lib/jarvis-desk-data.ts";
import { guionDeDeliberacion, planDelPapel, pizarraAr, pizarraCripto } from "../lib/pizarra-activos.ts";
import { agendaReuniones } from "../lib/oficina-reuniones.ts";

const DIA = 86_400_000;

function serie(n: number, tendencia = 0.001, semilla = 7, inicio = 100): SwingCandle[] {
  let s = semilla;
  const azar = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const out: SwingCandle[] = [];
  let p = inicio;
  for (let k = 0; k < n; k += 1) {
    const o = p;
    const c = o * (1 + tendencia + (azar() - 0.5) * 0.01);
    const h = Math.max(o, c) * (1 + azar() * 0.004);
    const l = Math.min(o, c) * (1 - azar() * 0.004);
    const v = 1000 + azar() * 1000;
    out.push({ openTime: Date.UTC(2024, 0, 1) + k * DIA, open: o, high: h, low: l, close: c, volume: v, quoteVolume: v * c });
    p = c;
  }
  return out;
}

const fib = (estado: ZonaFibAr["estado"], plan: ZonaFibAr["plan"]): ZonaFibAr =>
  ({ pierna: {} as ZonaFibAr["pierna"], desde: 0, niveles: [], zona: { alto: 100, bajo: 90 }, extensiones: [], estado, plan, historial: { aguantaron: 3, fallaron: 1 } }) as unknown as ZonaFibAr;
const planFib = { entrada: 95, stop: 90, tp1: 100, tp2: 105, tp3: 115, rr: 4 };
const agente = (senal: boolean): AgenteEnPapel =>
  ({ id: "RSI", agente: "Agente RSI", nombre: "RSI", regla: "x", ops: [{ r: 1 }, { r: -1 }], senalHoy: senal ? { rueda: 0, referencia: 100, escalera: { stop: 95, tp1: 105, tp2: 110, tp3: 120 }, rr: 4 } : null }) as unknown as AgenteEnPapel;

test("el plan del papel: Fibonacci si la pierna vive; si no, el de un agente; si no, ninguno", () => {
  assert.equal(planDelPapel(fib("EN LA ZONA", planFib), [agente(true)])?.fuente, "Fibonacci");
  assert.equal(planDelPapel(fib("INVALIDADA", planFib), [agente(true)])?.fuente, "Agente RSI");
  assert.equal(planDelPapel(null, [agente(false)]), null);
});

const mentesAr = (velas: SwingCandle[]) => ({ simbolo: "KO", velas, moneda: "ARS", precioUsd: null, fund: null, sinFund: "SEC no respondió", fuerzaRelativa: 80, mercadoAlcista: true, mercadoNombre: "el Merval", volMediana: 0.3 });

test("BYMA: las voces de todos juntos y una decisión con huella", () => {
  const velas = serie(300);
  const p = pizarraAr({ ticker: "KO", nombre: "Coca-Cola", velas, fib: fib("EN LA ZONA", planFib), fibMotivo: null, agentes: [agente(true)], mentes: mentesAr(velas) });
  assert.equal(p.razon.length, 9);
  const ids = p.deliberacion.voces.map((v) => v.id);
  for (const esperado of ["MENTE:BUFFETT", "MENTE:PTJ", "AGENTE:RSI", "ZONA:FIB", "MAPA:ESTRUCTURA", "RIESGO:GESTOR"]) assert.ok(ids.includes(esperado), esperado);
  // Sin balances las lentes de valor dicen SIN DATOS: se abstienen y no cuentan en contra.
  const buffett = p.deliberacion.voces.find((v) => v.id === "MENTE:BUFFETT")!;
  assert.equal(buffett.lado, "ABSTIENE");
  assert.match(buffett.motivo, /SEC no respondió/);
  assert.match(p.deliberacion.huella, /^[0-9a-f]{8}$/);
  assert.equal(p.deliberacion.plan?.fuente, "Fibonacci");
});

test("cripto: las lentes de valor se abstienen y el veto de riesgo de JARVIS gana", () => {
  const d1 = serie(220, 0.002);
  const decision = {
    symbol: "BTCUSDT",
    direccion: "LONG",
    plan: { lado: "LONG", entrada: 100, tipoEntrada: "MERCADO", stop: 98, stopRazon: "x", tp: [{ price: 101, label: "TP1" }, { price: 102, label: "TP2" }, { price: 103, label: "TP3" }], obstaculos: [] },
    riesgo: { vetos: ["R:R 1:1,2 bajo el mínimo."], esperas: [], rrPonderado: 1.2, nivel: "ALTO" },
    alcista: { plan: null, riesgo: null, argumentos: [] },
    bajista: { plan: null, riesgo: null, argumentos: [] },
    agentes: [],
    consenso: 0.5,
    cobertura: 1,
  } as unknown as DeskDecision;
  const snapshot = { symbol: "BTCUSDT", candles: { h1: [], h4: null, d1 } } as unknown as DeskSnapshot;
  const p = pizarraCripto({ decision, snapshot });
  for (const id of ["BUFFETT", "GRAHAM", "LYNCH", "MUSK", "ONEIL"]) assert.equal(p.razon.find((r) => r.id === id)!.veredicto, "FUERA DE MI MÉTODO", id);
  assert.equal(p.deliberacion.veredicto, "NO OPERAR");
  assert.match(p.deliberacion.razon, /veta/);
  assert.equal(p.deliberacion.activo, "BTC");

  // Sin la decisión de la mesa, las mentes de precio igual leen las velas diarias.
  const sola = pizarraCripto({ decision: null, snapshot });
  assert.ok(sola.deliberacion.voces.some((v) => v.id === "MENTE:PTJ"));
  assert.notEqual(sola.deliberacion.veredicto, "HAY PLAN", "sin plan no hay operación");
});

test("el guion de la oficina: abre JARVIS, hablan las mentes que discuten y cierra con la decisión", () => {
  const velas = serie(300);
  const p = pizarraAr({ ticker: "KO", nombre: "Coca-Cola", velas, fib: fib("EN LA ZONA", planFib), fibMotivo: null, agentes: [], mentes: { ...mentesAr(velas), fund: null } });
  const guion = guionDeDeliberacion(p.deliberacion);
  assert.equal(guion[0].quien, "JARVIS");
  assert.match(guion.at(-1)!.texto, new RegExp(p.deliberacion.huella));
  assert.match(guion.at(-1)!.texto, /No es asesoramiento financiero/);
  for (const g of guion.filter((x) => x.quien !== "JARVIS")) assert.match(g.quien, /^[A-Z]+$/, "las mentes hablan con su id de escritorio");
  // La agenda de la oficina lo usa tal cual si hay quien está a favor y quien está en contra.
  const agenda = agendaReuniones([], { ticker: "KO", guion: [{ quien: "JARVIS", nombre: "JARVIS", postura: "MODERA", texto: "abre" }, { quien: "PTJ", nombre: "Paul Tudor Jones", postura: "A FAVOR", texto: "a" }, { quien: "DARVAS", nombre: "Nicolas Darvas", postura: "EN CONTRA", texto: "b" }, { quien: "JARVIS", nombre: "JARVIS", postura: "MODERA", texto: "resumen" }, { quien: "JARVIS", nombre: "JARVIS", postura: "MODERA", texto: "cierra" }] });
  assert.deepEqual(agenda[0].lineas.map((l) => l.texto), ["abre", "a", "b", "resumen", "cierra"]);
  assert.deepEqual(agenda[0].participantes, ["PTJ", "DARVAS"]);
});

test("los agentes de la oficina con posición abierta en el activo opinan, con su registro y su muestra", async () => {
  const { vocesDeOficina } = await import("../lib/pizarra-activos.ts");
  const total = { cerradas: 4, ganadas: 2, perdidas: 2, abiertas: 1, winRate: 0.5, expectancia: 0.1, profitFactor: 1.2, intervalo: null, muestra: "MINIMA" } as never;
  const v = vocesDeOficina(
    [
      { id: "SUPERTREND", agente: "Agente Supertrend", abiertas: [{ symbol: "BTCUSDT", lado: "SHORT", detectada: 1 }], total },
      { id: "SNR", agente: "Agente SNR", abiertas: [{ symbol: "ETHUSDT", lado: "LONG", detectada: 1 }], total },
    ],
    "BTCUSDT",
  );
  assert.equal(v.length, 1, "solo el que tiene algo abierto en ese activo");
  assert.equal(v[0].lado, "CORTO");
  assert.equal(v[0].muestra, 4);
  assert.match(v[0].motivo, /Kraken/);
  assert.match(v[0].motivo, /muestra mínima/);
});

test("un agente en pausa no opina en la pizarra aunque tenga algo abierto", async () => {
  const { vocesDeOficina } = await import("../lib/pizarra-activos.ts");
  const total = { cerradas: 4, ganadas: 2, perdidas: 2, abiertas: 1, winRate: 0.5, expectancia: 0.1, profitFactor: 1.2, intervalo: null, muestra: "MINIMA" } as never;
  const v = vocesDeOficina([{ id: "SNR", agente: "Agente SNR", abiertas: [{ symbol: "BTCUSDT", lado: "LONG", detectada: 1 }], total }], "BTCUSDT");
  assert.equal(v.length, 0);
});
