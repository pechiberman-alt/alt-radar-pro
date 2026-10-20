// Pruebas del Agente Metales (METALES_D55 en lib/estrategias.ts): solo opera oro y plata (en papel y en el estudio), solo
// compra, dispara cuando el cierre supera el máximo de las 55 velas anteriores, y su señal no mira velas posteriores.
import assert from "node:assert/strict";
import test from "node:test";
import { leerSenalesPapel, MARCO_AGENTES_MS } from "../lib/agentes-papel.ts";
import { ESTRATEGIAS, indicadores, operaEn, operar, SIMBOLOS_METALES } from "../lib/estrategias.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const metales = ESTRATEGIAS.find((e) => e.id === "METALES_D55")!;
const M = MARCO_AGENTES_MS;
const T = Date.UTC(2026, 9, 20, 8);

/** 120 velas en un rango de 99 a 101 y, al final, un cierre en 103: la ruptura de 55 velas. Más la vela de entrada que abre. */
function ruptura(): SwingCandle[] {
  const v: SwingCandle[] = [];
  for (let k = 0; k < 120; k += 1) v.push({ openTime: T - (121 - k) * M, open: 100, high: 101, low: 99, close: 100 + (k % 2 ? 0.3 : -0.3), volume: 1, quoteVolume: 0 });
  v.push({ openTime: T - M, open: 100, high: 103.5, low: 99.8, close: 103, volume: 1, quoteVolume: 0 });
  v.push({ openTime: T, open: 103, high: 103, low: 103, close: 103, volume: 0, quoteVolume: 0 });
  return v;
}

test("solo opera metales: oro, plata, PAXG y el oro de Axi del estudio", () => {
  for (const s of SIMBOLOS_METALES) assert.ok(operaEn(metales, s), s);
  assert.equal(operaEn(metales, "BTCUSDT"), false);
  assert.ok(operaEn(ESTRATEGIAS.find((e) => e.id === "RUPTURA")!, "BTCUSDT"), "los demás operan todo");
});

test("en papel entra en el oro y la plata con la ruptura, y nunca en cripto con las mismas velas", () => {
  const v = ruptura();
  const ahora = T + 5 * 60_000;
  for (const s of ["XAUUSDT", "XAGUSDT", "PAXGUSDT"]) {
    const p = leerSenalesPapel(s, v, ahora).find((x) => x.estrategia === "METALES_D55");
    assert.ok(p, s);
    assert.equal(p.lado, "LONG");
    assert.ok(p.stop < p.entrada && p.objetivo > p.entrada);
  }
  assert.ok(!leerSenalesPapel("BTCUSDT", v, ahora).some((x) => x.estrategia === "METALES_D55"));
  assert.deepEqual(operar(metales, "BTCUSDT", v.slice(0, -1), { marcoMs: M, horizonte: 48, feePct: 0.07 }), [], "el estudio tampoco lo corre en cripto");
});

test("solo compra: una ruptura del mínimo no da corto", () => {
  const v = ruptura().map((c) => ({ ...c, open: 200 - c.open, high: 200 - c.low, low: 200 - c.high, close: 200 - c.close }));
  const cerradas = v.slice(0, -1);
  assert.equal(metales.senal(cerradas, indicadores(cerradas), cerradas.length - 1), null);
});

test("no mira el futuro: la señal de una vela es la misma con la serie cortada en esa vela", () => {
  const v = ruptura().slice(0, -1);
  const extra = [...v, ...Array.from({ length: 10 }, (_, k) => ({ ...v[v.length - 1], openTime: v[v.length - 1].openTime + (k + 1) * M, close: 90, low: 89 }))];
  const i = v.length - 1;
  assert.deepEqual(metales.senal(extra, indicadores(extra), i), metales.senal(v, indicadores(v), i));
});
