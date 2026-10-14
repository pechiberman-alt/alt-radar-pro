// Pruebas del agente de liquidez + IFVG + breaker (lib/smc-liquidez.ts): las zonas altas (FVG y OB) con casos armados a mano,
// su vencimiento, la toma de liquidez, el IFVG, la grilla, las invariantes de cada señal y que ninguna señal mira el futuro.
import assert from "node:assert/strict";
import test from "node:test";
import {
  CONFIGURACION_BASE_SMC,
  DISPAROS_SMC,
  FILTROS_SMC,
  emaSmc,
  atrSmc,
  barridas,
  cubosAltos,
  grillaSmc,
  inversionesFvg,
  mismaConfiguracionSmc,
  senalesSmc,
  zonasAltas,
} from "../lib/smc-liquidez.ts";
import { indicadores } from "../lib/estrategias.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const H = 3_600_000;
const vela = (i: number, open: number, high: number, low: number, close: number, paso = H): SwingCandle =>
  ({ openTime: i * paso, open, high, low, close, volume: 1, quoteVolume: close }) as SwingCandle;
const planas = (n: number, paso = H): SwingCandle[] => Array.from({ length: n }, (_, i) => vela(i, 100, 100.5, 99.5, 100, paso));
const unos = (n: number) => new Array<number>(n).fill(1);

test("FVG alcista: la tercera vela no toca a la primera, de 0,5 ATR o más; conocida al cerrar la tercera", () => {
  const sup = [vela(0, 99, 100, 98, 99.5), vela(1, 99.5, 103, 99, 102.5), vela(2, 102.5, 104, 101, 103.5)];
  const z = zonasAltas(sup, unos(3)).filter((x) => x.tipo === "FVG");
  assert.equal(z.length, 1);
  assert.deepEqual([z[0].lado, z[0].bajo, z[0].alto, z[0].conocida], ["LONG", 100, 101, 2]);
});

test("FVG: un hueco menor a 0,5 ATR no cuenta; el bajista es CORTO", () => {
  const chico = [vela(0, 99, 100, 98, 99.5), vela(1, 99.5, 103, 99, 102.5), vela(2, 102.5, 104, 100.3, 103.5)];
  assert.equal(zonasAltas(chico, unos(3)).length, 0);
  const baja = [vela(0, 101, 102, 100, 100.5), vela(1, 100.5, 100.8, 97, 97.5), vela(2, 97.5, 99, 96, 96.5)];
  const z = zonasAltas(baja, unos(3));
  assert.deepEqual([z[0].lado, z[0].bajo, z[0].alto], ["SHORT", 99, 100]);
});

test("una zona vence cuando una vela alta cierra del otro lado de su borde lejano, o a las 40 velas", () => {
  const rompe = [vela(0, 99, 100, 98, 99.5), vela(1, 99.5, 103, 99, 102.5), vela(2, 102.5, 104, 101, 103.5), vela(3, 103, 103, 98, 99.5)];
  assert.equal(zonasAltas(rompe, unos(4))[0].vence, 3);
  const larga = [...rompe.slice(0, 3)];
  for (let i = 3; i < 60; i += 1) larga.push(vela(i, 103, 104, 102, 103));
  assert.equal(zonasAltas(larga, unos(60))[0].vence, 2 + 40 + 1);
});

test("OB alcista: última vela bajista antes de un impulso que rompe el máximo previo; conocida al cierre del impulso", () => {
  const sup = planas(20);
  sup.push(vela(20, 100.5, 100.8, 99.7, 99.8)); // origen bajista
  sup.push(vela(21, 99.8, 102, 99.8, 101.8), vela(22, 101.8, 104, 101.5, 103.8), vela(23, 103.8, 106, 103.5, 105.8));
  sup.push(vela(24, 105.8, 106, 105, 105.5));
  const z = zonasAltas(sup, unos(sup.length)).filter((x) => x.tipo === "OB");
  assert.equal(z.length, 1);
  assert.deepEqual([z[0].lado, z[0].bajo, z[0].alto, z[0].conocida], ["LONG", 99.7, 100.8, 23]);
});

test("OB: sin ruptura del máximo previo, o con un impulso corto, no hay zona", () => {
  const sup = planas(20);
  sup.push(vela(20, 100.5, 100.8, 99.7, 99.8));
  sup.push(vela(21, 99.8, 100.4, 99.8, 100.2), vela(22, 100.2, 100.4, 100, 100.3), vela(23, 100.3, 100.4, 100, 100.2), vela(24, 100, 100.2, 99.9, 100));
  assert.equal(zonasAltas(sup, unos(sup.length)).filter((x) => x.tipo === "OB").length, 0);
});

test("cubosAltos: 1 h arma velas de 4 h; el cubo en curso no figura como cerrado", () => {
  const v = planas(10);
  const { sup, cerrado } = cubosAltos(v);
  assert.equal(sup.length, 3); // horas 0-3, 4-7 y 8-9 (este último sin cerrar)
  assert.equal(cerrado[3], 0);
  assert.equal(cerrado[4], 0);
  assert.equal(cerrado[7], 1);
  assert.equal(cerrado[8], 1);
  assert.equal(cerrado[9], 1); // el cubo 2 sigue abierto: la última cerrada es la 1
});

test("toma de liquidez: la mecha pasa un mínimo de pivote ya confirmado y cierra de vuelta adentro", () => {
  const v = planas(10);
  v.push(vela(10, 100, 100, 95, 99)); // pivote: mínimo de 95
  for (let i = 11; i < 16; i += 1) v.push(vela(i, 100, 100.6, 99.6, 100.2));
  v.push(vela(16, 100, 100.2, 94, 98)); // barre 95 y cierra arriba
  const b = barridas(v).filter((x) => x.lado === "LONG");
  assert.equal(b.length, 1);
  assert.deepEqual([b[0].s, b[0].nivel, b[0].extremo], [16, 95, 94]);
});

test("toma de liquidez: si la vela cierra por debajo del nivel es una ruptura, no una toma", () => {
  const v = planas(10);
  v.push(vela(10, 100, 100, 95, 99));
  for (let i = 11; i < 16; i += 1) v.push(vela(i, 100, 100.6, 99.6, 100.2));
  v.push(vela(16, 100, 100.2, 94, 94.5));
  assert.equal(barridas(v).filter((x) => x.lado === "LONG").length, 0);
});

test("IFVG: un hueco bajista que una vela cierra por arriba es un IFVG de LARGO, conocido en esa vela", () => {
  const v = planas(20);
  v.push(vela(20, 100, 100, 98, 98.5), vela(21, 98.5, 98.8, 95, 95.5), vela(22, 95.5, 96.5, 95, 96)); // hueco 96,5 a 98
  v.push(vela(23, 96, 97, 95.8, 96.8), vela(24, 96.8, 99, 96.5, 98.6)); // la 24 cierra sobre 98
  const iv = inversionesFvg(v, atrSmc(v));
  const largo = iv.filter((x) => x.lado === "LONG");
  assert.ok(largo.some((x) => x.c === 24 && x.bajo === 96.5 && x.alto === 98));
});

test("la grilla tiene 27 configuraciones distintas y la base está adentro", () => {
  const g = grillaSmc();
  assert.equal(g.length, 27);
  assert.equal(new Set(g.map((c) => `${c.zonas}|${c.margenAtr}|${c.rr}`)).size, 27);
  assert.ok(g.some((c) => mismaConfiguracionSmc(c, CONFIGURACION_BASE_SMC)));
});

function aleatoria(n: number, semilla: number): SwingCandle[] {
  let s = semilla;
  const r = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const v: SwingCandle[] = [];
  let p = 100;
  for (let i = 0; i < n; i += 1) {
    const o = p;
    const c = o * (1 + (r() - 0.5) * 0.03);
    const h = Math.max(o, c) * (1 + r() * 0.012);
    const l = Math.min(o, c) * (1 - r() * 0.012);
    v.push(vela(i, o, h, l, c));
    p = c;
  }
  return v;
}

test("cada señal cumple las invariantes: stop del lado correcto, riesgo ≤ 4 ATR y objetivo a rr veces el riesgo", () => {
  const v = aleatoria(1500, 11);
  const atr = atrSmc(v);
  let total = 0;
  for (const d of DISPAROS_SMC) {
    const f = senalesSmc(v, atr, d, CONFIGURACION_BASE_SMC);
    for (let i = 0; i < v.length; i += 1) {
      const s = f(i);
      if (!s) continue;
      total += 1;
      const c = v[i].close;
      const riesgo = Math.abs(c - s.stop);
      assert.ok(s.lado === "LONG" ? s.stop < c : s.stop > c);
      assert.ok(riesgo <= 4 * atr[i] + 1e-9);
      assert.ok(Math.abs(Math.abs(s.objetivo - c) - CONFIGURACION_BASE_SMC.rr * riesgo) < 1e-9);
    }
  }
  assert.ok(total > 0, "la serie al azar debe dar alguna señal para que la prueba valga");
});

test("ninguna señal mira el futuro: con la serie cortada en L, las señales de las velas anteriores son las mismas", () => {
  const v = aleatoria(1200, 5);
  for (const d of DISPAROS_SMC) {
    const atr = atrSmc(v);
    const completa = senalesSmc(v, atr, d, CONFIGURACION_BASE_SMC);
    for (const largo of [400, 777, 1013]) {
      const corte = v.slice(0, largo);
      const parcial = senalesSmc(corte, atrSmc(corte), d, CONFIGURACION_BASE_SMC);
      for (let i = 0; i < largo; i += 1) assert.deepEqual(parcial(i), completa(i), `${d} en la vela ${i} con corte ${largo}`);
    }
  }
});

test("emaSmc: NaN hasta tener n velas y valores conocidos", () => {
  const e = emaSmc([1, 2, 3, 4], 2);
  assert.ok(Number.isNaN(e[0]));
  assert.deepEqual(e.slice(1).map((x) => +x.toFixed(4)), [1.6667, 2.5556, 3.5185]);
});

test("los filtros solo sacan señales: las de cada filtro son un subconjunto de las del disparo sin filtro, y TODO de cada uno", () => {
  const v = aleatoria(2500, 21);
  const ind = indicadores(v);
  const por = (filtro: (typeof FILTROS_SMC)[number]) => {
    const f = senalesSmc(v, ind.atr14, "BARRIDA", CONFIGURACION_BASE_SMC, { filtro, stDir: ind.stDir, poc: ind.poc });
    return new Set(v.map((_, i) => (f(i) ? i : -1)).filter((i) => i >= 0));
  };
  const base = por("NINGUNO");
  assert.ok(base.size > 5, `base ${base.size}`);
  for (const f of FILTROS_SMC) for (const i of por(f)) assert.ok(base.has(i), `${f}: la señal ${i} no está en el disparo sin filtro`);
  const todo = por("TODO");
  for (const f of ["PERFIL", "SUPERTREND", "EMAS"] as const) for (const i of todo) assert.ok(por(f).has(i), `TODO ⊂ ${f}`);
  assert.ok(por("EMAS").size < base.size, `EMAS ${por("EMAS").size} base ${base.size}`);
});

test("con filtros tampoco se mira el futuro", () => {
  const v = aleatoria(1500, 8);
  const ctx = (w: SwingCandle[]) => {
    const ind = indicadores(w);
    return { f: senalesSmc(w, ind.atr14, "BARRIDA_IFVG", CONFIGURACION_BASE_SMC, { filtro: "TODO", stDir: ind.stDir, poc: ind.poc }) };
  };
  const completa = ctx(v).f;
  for (const largo of [600, 1000]) {
    const parcial = ctx(v.slice(0, largo)).f;
    for (let i = 0; i < largo; i += 1) assert.deepEqual(parcial(i), completa(i), `vela ${i} con corte ${largo}`);
  }
});
