/**
 * Pruebas de las listas de MERCADO AR (lib/mercado-ar-ranking.ts: mejores compras Fibonacci, señales con mentes y el guion
 * de la reunión) y del formato compacto de los lotes (lib/mercado-ar-lote.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { compactar, expandir, MAX_LOTE, simbolosDelLote } from "../lib/mercado-ar-lote.ts";
import { guionReunion, intervencion, mejoresComprasFib, senalesConMentes, type PapelLeido } from "../lib/mercado-ar-ranking.ts";
import type { ZonaFibAr } from "../lib/mercado-ar-tecnico.ts";
import type { LecturaMente } from "../lib/mentes-inversoras.ts";
import { ACCIONES_AR, SIMBOLOS_PERMITIDOS } from "../lib/mercado-ar.ts";
import type { AgenteEnPapel } from "../lib/mercado-ar-agentes.ts";

test("lote: compacto ida y vuelta, y solo símbolos permitidos, sin repetir, hasta 12", () => {
  const serie = {
    meta: { simbolo: "GGAL.BA", moneda: "ARS", bolsa: "BYMA", demoraMin: 20, precio: 1.23456789, horaPrecio: 1 },
    velas: [{ openTime: 1000, open: 1.23456789, high: 2, low: 1, close: 1.5, volume: 10.4, quoteVolume: 15.6 }],
    enCurso: null,
  };
  const ida = expandir(compactar(serie))!;
  assert.equal(ida.velas[0].open, 1.23457, "6 cifras significativas");
  assert.equal(ida.velas[0].volume, 10);
  assert.equal(ida.velas[0].quoteVolume, 15, "volumen × cierre, como antes");
  assert.equal(expandir(compactar(null)), null);
  assert.deepEqual(simbolosDelLote("GGAL.BA,GGAL.BA, FAKE ,YPFD.BA", SIMBOLOS_PERMITIDOS), ["GGAL.BA", "YPFD.BA"]);
  assert.equal(simbolosDelLote(ACCIONES_AR.map((p) => p.yahoo).join(","), SIMBOLOS_PERMITIDOS).length, MAX_LOTE);
});

const consenso = (aFavor: number, enContra: number) => ({ aFavor, enContra, neutral: 0, sinDatos: 0, opinan: aFavor + enContra });

function fib(estado: ZonaFibAr["estado"], aguantaron: number, fallaron: number, rr = 3): ZonaFibAr {
  return {
    pierna: { lado: "LONG", origen: 100, extremo: 200, i: 0, conocida: 5 },
    desde: 0,
    niveles: [],
    zona: { alto: 138.2, bajo: 121.4 },
    extensiones: [],
    estado,
    plan: estado === "INVALIDADA" ? null : { entrada: 130, stop: 98, tp1: 200, tp2: 227, tp3: 262, rr },
    historial: { probadas: aguantaron + fallaron, aguantaron, fallaron, abiertas: 0 },
  };
}

const papel = (ticker: string, cierre: number, f: ZonaFibAr | null, extra: Partial<PapelLeido> = {}): PapelLeido => ({
  papel: { ticker, nombre: ticker, tipo: "ACCION", yahoo: `${ticker}.BA` },
  cierre,
  fib: f,
  mentes: [],
  consenso: consenso(0, 0),
  agentes: [],
  ...extra,
});

test("mejores compras Fibonacci: primero en la zona, después cerca; afuera lo lejano y lo invalidado", () => {
  const lista = mejoresComprasFib([
    papel("LEJOS", 160, fib("ARRIBA DE LA ZONA", 5, 0)),
    papel("CERCA", 142, fib("ARRIBA DE LA ZONA", 5, 0)),
    papel("ZONA_POCA", 130, fib("EN LA ZONA", 1, 0, 5)),
    papel("ZONA_BUENA", 130, fib("EN LA ZONA", 4, 1)),
    papel("ROTA", 90, fib("INVALIDADA", 3, 3)),
    papel("SIN", 130, null),
  ]);
  assert.deepEqual(
    lista.map((c) => c.ticker),
    ["ZONA_BUENA", "ZONA_POCA", "CERCA"],
    "con 3 casos o más pesa lo que aguantó; con menos, va después",
  );
  assert.equal(lista[0].tasa, 0.8);
  assert.ok(Math.abs(lista[2].distancia - (142 / 138.2 - 1)) < 1e-12);
});

const mente = (id: LecturaMente["id"], postura: LecturaMente["postura"], cumple: (boolean | null)[]): LecturaMente => ({
  id,
  mente: id,
  idea: "",
  postura,
  nota: "",
  criterios: cumple.map((c, k) => ({ nombre: `Criterio ${k}`, regla: "", valor: c === null ? "sin balances" : `v${k}`, cumple: c })),
});

test("intervención: cada mente dice su postura con el criterio que la decide", () => {
  assert.match(intervencion(mente("BUFFETT", "A FAVOR", [true, true])).texto, /^A favor: criterio 0 \(v0\) y criterio 1 \(v1\)/);
  assert.match(intervencion(mente("GRAHAM", "EN CONTRA", [false, true])).texto, /^En contra: criterio 0 no se cumple \(v0\)/);
  assert.match(intervencion(mente("LYNCH", "SIN DATOS", [null])).texto, /sin balances/);
  assert.match(intervencion(mente("PTJ", "NEUTRAL", [true, false])).texto, /pero criterio 1 no/);
});

test("reunión: abre y cierra JARVIS, hablan primero las mentes que opinan", () => {
  const p = papel("KO", 130, fib("EN LA ZONA", 2, 1), {
    mentes: [mente("LYNCH", "SIN DATOS", [null]), mente("BUFFETT", "A FAVOR", [true]), mente("DALIO", "INFORMA", [true])],
    consenso: consenso(1, 0),
  });
  const g = guionReunion(p);
  assert.equal(g[0].quien, "JARVIS");
  assert.match(g[0].texto, /zona de compra de Fibonacci/);
  assert.deepEqual(g.slice(1, -1).map((x) => x.quien), ["BUFFETT", "DALIO", "LYNCH"]);
  assert.match(g.at(-1)!.texto, /1 a favor.*No es una probabilidad/);
});

test("señales con mentes: primero las que más mentes acompañan", () => {
  const a = (id: string): AgenteEnPapel => ({ id: "RSI", agente: id, nombre: "", regla: "", ops: [], senalHoy: { rueda: 0, referencia: 10, escalera: { stop: 9, tp1: 11, tp2: 12, tp3: 13 }, rr: 3 } });
  const lista = senalesConMentes([papel("A", 1, null, { agentes: [a("x")], consenso: consenso(1, 3) }), papel("B", 1, null, { agentes: [a("y")], consenso: consenso(4, 0) })]);
  assert.deepEqual(lista.map((s) => s.ticker), ["B", "A"]);
});
