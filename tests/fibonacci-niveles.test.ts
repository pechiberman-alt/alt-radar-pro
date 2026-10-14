// Pruebas del agente Fibonacci + extensión + niveles clave (lib/fibonacci-niveles.ts): la pierna armada a mano, la señal en la zona
// con su stop y su extensión, que el nivel clave la filtre, los niveles del día y la semana anteriores, que la pierna muera al romper
// su origen, la grilla y que ninguna señal mire el futuro.
import assert from "node:assert/strict";
import test from "node:test";
import {
  CONFIGURACION_AGENTE_FIB,
  grillaFib,
  mismaConfiguracionFib,
  nivelesClave,
  piernas,
  senalesFib,
  type ConfiguracionFib,
} from "../lib/fibonacci-niveles.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const H = 3_600_000;
const mk = (i: number, desfase: number, open: number, high: number, low: number, close: number): SwingCandle =>
  ({ openTime: (i + desfase) * H, open, high, low, close, volume: 1, quoteVolume: close }) as SwingCandle;

/** Pierna alcista de 95 a 106 (11 de largo) con ATR 2; el retroceso llega a la vela 31. `desfase` corre las horas del día. */
function serie(desfase: number, vela31 = [98.8, 99.5, 98.9, 99.3]): SwingCandle[] {
  const v: SwingCandle[] = [];
  for (let i = 0; i < 10; i += 1) v.push(mk(i, desfase, 100, 100.5, 99.5, 100));
  const lows = [99, 98.5, 98, 97, 96, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 104.5];
  lows.forEach((l, k) => v.push(mk(10 + k, desfase, l + 0.5, l + 1.5, l, l + 1.2)));
  v[25] = mk(25, desfase, 104.6, 106, 104.5, 105.8);
  const bajan = [103.5, 103, 102, 101, 100];
  bajan.forEach((l, k) => v.push(mk(26 + k, desfase, l + 1.2, l + 1.5, l, l + 0.3)));
  v.push(mk(31, desfase, vela31[0], vela31[1], vela31[2], vela31[3]));
  for (let i = 32; i < 70; i += 1) v.push(mk(i, desfase, 99.3, 99.6, 99.0, 99.3));
  return v;
}
const atr = (v: SwingCandle[]) => new Array<number>(v.length).fill(2);
const sinNivel: ConfiguracionFib = { zona: "0.618-0.786", extension: 1.272, nivel: false };

test("la pierna alcista: del mínimo de 95 al máximo de 106, conocida cuando se confirma su pivote (5 velas después)", () => {
  const v = serie(0);
  const p = piernas(v, atr(v));
  const l = p.find((x) => x.lado === "LONG");
  assert.ok(l);
  assert.deepEqual([l.origen, l.extremo, l.i, l.conocida], [95, 106, 25, 30]);
});

test("la señal: toca la zona 0,618–0,786 y cierra alcista; stop a 0,25 ATR del origen y objetivo en la extensión 1,272", () => {
  const v = serie(0);
  const f = senalesFib(v, atr(v), sinNivel);
  const s = f(31);
  assert.ok(s);
  assert.equal(s.lado, "LONG");
  assert.ok(Math.abs(s.stop - 94.5) < 1e-9);
  assert.ok(Math.abs(s.objetivo - (106 + 0.272 * 11)) < 1e-9);
  assert.equal(v.map((_, i) => f(i)).filter(Boolean).length, 1, "una sola señal por pierna");
});

test("escalera propia: TP1 en la extensión 1 (el extremo, 106), TP2 en 1,272 y TP3 en 1,618", () => {
  const v = serie(0);
  const s = senalesFib(v, atr(v), { ...sinNivel, extension: 1.618, escalonada: true })(31);
  assert.ok(s);
  assert.ok(Math.abs((s.tp1 ?? 0) - 106) < 1e-9);
  assert.ok(Math.abs((s.tp2 ?? 0) - (106 + 0.272 * 11)) < 1e-9);
  assert.ok(Math.abs(s.objetivo - (106 + 0.618 * 11)) < 1e-9);
  assert.ok(CONFIGURACION_AGENTE_FIB.escalonada);
  // Sin escalonada no trae objetivos propios: TP1 y TP2 quedan a un tercio y dos tercios del camino.
  const u = senalesFib(v, atr(v), sinNivel)(31);
  assert.equal(u?.tp1, undefined);
});

test("operar con la escalera propia: TP1, TP2 y TP3 quedan en los niveles de Fibonacci y el TP3 se mide", async () => {
  const { operarSenales } = await import("../lib/estrategias.ts");
  const v = serie(0);
  // Después de la señal el precio sube hasta pasar la extensión 1,618 (112,8): cada nivel se toca en orden.
  for (let i = 32; i < v.length; i += 1) v[i] = mk(i, 0, 100 + (i - 32) * 0.9, 100.6 + (i - 32) * 0.9, 99.8 + (i - 32) * 0.9, 100.4 + (i - 32) * 0.9);
  const f = senalesFib(v, atr(v), { ...sinNivel, extension: 1.618, escalonada: true });
  const ops = operarSenales("FIB_NIVELES", "X", v, f, { marcoMs: H, horizonte: 48, feePct: 0 });
  assert.equal(ops.length, 1);
  assert.ok(ops[0].tp1 && ops[0].tp2 && ops[0].tp3);
  assert.ok(ops[0].r > 0);
});

test("la vela que cierra bajista dentro de la zona no es señal", () => {
  const v = serie(0, [99.4, 99.5, 98.9, 99.0]);
  const f = senalesFib(v, atr(v), sinNivel);
  assert.equal(f(31), null);
});

test("la pierna muere si una vela cierra por debajo de su origen: no hay señal después", () => {
  const v = serie(0);
  v[31] = mk(31, 0, 96, 96.5, 93, 94);
  const f = senalesFib(v, atr(v), sinNivel);
  for (let i = 31; i < v.length; i += 1) assert.equal(f(i), null);
});

test("con nivel clave: el mínimo del día anterior (98,5) dentro de la zona deja pasar la señal; sin él, no", () => {
  const con = serie(12); // el día 0 son las velas 0 a 11: su mínimo es 98,5
  assert.ok(senalesFib(con, atr(con), { ...sinNivel, nivel: true })(31));
  const sin = serie(0); // el mínimo del día anterior es 95: fuera de la zona
  assert.equal(senalesFib(sin, atr(sin), { ...sinNivel, nivel: true })(31), null);
});

test("niveles clave: el máximo y el mínimo del día y de la semana ANTERIORES; sin historia, NaN", () => {
  const DIA = 24;
  const v: SwingCandle[] = [];
  // El 5/1/1970 es lunes (día 4 desde la época): dos semanas de velas de 1 h desde ahí.
  for (let i = 0; i < DIA * 14; i += 1) {
    const dia = Math.floor(i / DIA);
    v.push(mk(i + 4 * DIA, 0, 100, 100 + dia, 100 - dia, 100));
  }
  const n = nivelesClave(v);
  assert.ok(n[0].every(Number.isNaN), "el primer día no tiene día anterior");
  assert.deepEqual(n[DIA + 5].slice(0, 2), [100, 100]); // el día 1 mira el día 0 (máximo 100, mínimo 100)
  assert.deepEqual(n[2 * DIA].slice(0, 2), [101, 99]); // el día 2 mira el día 1
  assert.ok(Number.isNaN(n[3 * DIA][2]), "en la primera semana no hay semana anterior");
  assert.deepEqual(n[7 * DIA + 1].slice(2), [106, 94]); // la semana 1 mira la 0: días 0 a 6, máximo 106, mínimo 94
});

test("la grilla tiene 18 configuraciones distintas, y 9 con nivel clave con nivel clave", () => {
  const g = grillaFib();
  assert.equal(g.length, 18);
  assert.equal(new Set(g.map((c) => `${c.zona}|${c.extension}|${c.nivel}`)).size, 18);
  assert.ok(g.some((c) => mismaConfiguracionFib(c, { ...CONFIGURACION_AGENTE_FIB, escalonada: false })), "la del agente sin su escalera propia está en la grilla");
  assert.ok(!g.some((c) => mismaConfiguracionFib(c, CONFIGURACION_AGENTE_FIB)), "con su escalera propia es la variante 19: no está en la grilla");
  assert.equal(g.filter((c) => c.nivel).length, 9);
});

function aleatoria(n: number, semilla: number): SwingCandle[] {
  let s = semilla;
  const r = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const v: SwingCandle[] = [];
  let p = 100;
  for (let i = 0; i < n; i += 1) {
    const o = p;
    const c = o * (1 + (r() - 0.5) * 0.03);
    v.push(mk(i, 0, o, Math.max(o, c) * (1 + r() * 0.012), Math.min(o, c) * (1 - r() * 0.012), c));
    p = c;
  }
  return v;
}

test("cada señal: stop del lado correcto, riesgo ≤ 4 ATR y objetivo del lado correcto", () => {
  const v = aleatoria(4000, 4);
  const a = v.map(() => 1.2);
  let total = 0;
  for (const cfg of grillaFib()) {
    const f = senalesFib(v, a, cfg);
    for (let i = 0; i < v.length; i += 1) {
      const s = f(i);
      if (!s) continue;
      total += 1;
      const c = v[i].close;
      assert.ok(s.lado === "LONG" ? s.stop < c && s.objetivo > c : s.stop > c && s.objetivo < c);
      assert.ok(Math.abs(c - s.stop) <= 4 * a[i] + 1e-9);
    }
  }
  assert.ok(total > 0, "la serie al azar debe dar alguna señal para que la prueba valga");
});

test("ninguna señal mira el futuro: con la serie cortada, las señales anteriores son las mismas", () => {
  const v = aleatoria(3000, 17);
  const a = (w: SwingCandle[]) => w.map((x) => Math.max(0.5, (x.high - x.low) * 1.3));
  for (const cfg of [CONFIGURACION_AGENTE_FIB, sinNivel, { zona: "0.5-0.786" as const, extension: 1.618 as const, nivel: false }]) {
    // ATR por vela con solo datos de esa vela: así el corte no cambia nada que no sea la lógica de la señal.
    const completa = senalesFib(v, a(v), cfg);
    for (const largo of [800, 1500, 2222]) {
      const corte = v.slice(0, largo);
      const parcial = senalesFib(corte, a(corte), cfg);
      for (let i = 0; i < largo; i += 1) assert.deepEqual(parcial(i), completa(i), `vela ${i} con corte ${largo}`);
    }
  }
});
