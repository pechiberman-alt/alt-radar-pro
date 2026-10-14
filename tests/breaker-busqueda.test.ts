// Pruebas de la búsqueda del breaker block (lib/breaker-busqueda.ts): el caso armado a mano que lo forma, cada
// confirmación con su caso que la cumple y el que no, la zona que falla antes del retesteo, el riesgo máximo,
// que ninguna señal mira el futuro, la grilla y que el recorrido común la mide con la escalera de la app.
import assert from "node:assert/strict";
import test from "node:test";
import { indicadores, operarSenales } from "../lib/estrategias.ts";
import {
  CONFIGURACION_BASE_BREAKER,
  CONFIRMACIONES_BREAKER,
  breakersCausales,
  grillaBreaker,
  mismaConfiguracionBreaker,
  senalesBreaker,
  type ConfirmacionBreaker,
} from "../lib/breaker-busqueda.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const H = 3_600_000;
const vela = (i: number, open: number, high: number, low: number, close: number, volume = 1): SwingCandle =>
  ({ openTime: i * H, open, high, low, close, volume, quoteVolume: volume * close }) as SwingCandle;

/**
 * 25 velas planas alrededor de 100 (rango de 1), un order block alcista en la 25 (vela bajista de 99,7 a 100,8), un impulso
 * de 4 velas que rompe el máximo previo, una vela que cierra por debajo de la zona (la 30: nace el breaker de CORTO) y el
 * resto, que cada prueba arma a su manera.
 */
function base(): SwingCandle[] {
  const v: SwingCandle[] = [];
  for (let i = 0; i < 25; i += 1) v.push(vela(i, 100, 100.5, 99.5, 100));
  v.push(vela(25, 100.5, 100.8, 99.7, 99.8)); // origen: vela bajista, zona 99,7 a 100,8
  v.push(vela(26, 99.8, 102, 99.8, 101.8));
  v.push(vela(27, 101.8, 104, 101.5, 103.8));
  v.push(vela(28, 103.8, 106, 103.5, 105.8));
  v.push(vela(29, 105.8, 106.5, 104.5, 105)); // el impulso rompió el máximo previo (100,5)
  v.push(vela(30, 105, 105, 98.8, 99)); // cierra por debajo de 99,7: la zona se rompe
  return v;
}

const señal = (v: SwingCandle[], c: ConfirmacionBreaker, i: number) => {
  const ind = indicadores(v);
  return { s: senalesBreaker(v, ind, c, CONFIGURACION_BASE_BREAKER)(i), ind };
};

test("el order block roto por un cierre es un breaker de corto, conocido recién en la vela de la rotura", () => {
  const v = base();
  const b = breakersCausales(v, indicadores(v).atr14, 1.8);
  assert.equal(b.length, 1);
  assert.deepEqual({ lado: b[0].lado, bajo: b[0].bajo, alto: b[0].alto, origen: b[0].origen, rotaEn: b[0].rotaEn }, { lado: "SHORT", bajo: 99.7, alto: 100.8, origen: 25, rotaEn: 30 });
  // Con velas solo hasta la 29 todavía no hay breaker: la rotura no había pasado.
  assert.equal(breakersCausales(v.slice(0, 30), indicadores(v.slice(0, 30)).atr14, 1.8).length, 0);
});

test("RECHAZO: la vela que toca la zona y cierra debajo da un corto con stop más allá del borde lejano y objetivo en R", () => {
  const v = base();
  v.push(vela(31, 99, 99.4, 98.5, 98.8));
  v.push(vela(32, 98.8, 100.1, 98.6, 99.3)); // toca la zona (100,1 ≥ 99,7) y cierra debajo de 99,7
  const { s, ind } = señal(v, "RECHAZO", 32);
  assert.ok(s);
  assert.equal(s.lado, "SHORT");
  assert.ok(Math.abs(s.stop - (100.8 + 0.5 * ind.atr14[32])) < 1e-9);
  const riesgo = s.stop - 99.3;
  assert.ok(Math.abs(99.3 - s.objetivo - 2 * riesgo) < 1e-9);
});

test("TOQUE opera una vela que toca la zona y cierra adentro; RECHAZO no", () => {
  const v = base();
  v.push(vela(31, 99, 99.4, 98.5, 98.8));
  v.push(vela(32, 98.8, 100.3, 98.6, 100)); // toca y cierra dentro de la zona (99,7 a 100,8)
  assert.ok(señal(v, "TOQUE", 32).s);
  assert.equal(señal(v, "RECHAZO", 32).s, null);
});

test("si una vela cierra del otro lado de la zona por completo antes del retesteo, el breaker falló", () => {
  const v = base();
  v.push(vela(31, 99, 101.5, 98.9, 101.2)); // cierra encima de 100,8
  v.push(vela(32, 101.2, 101.4, 99.5, 99.3)); // ya no cuenta: la zona falló
  for (const c of CONFIRMACIONES_BREAKER) assert.equal(señal(v, c, 32).s, null, c);
});

test("MECHA pide que la mecha que entra a la zona sea la mitad del rango; VOLUMEN y RUPTURA_FUERTE miran la vela que rompió", () => {
  const v = base();
  v.push(vela(31, 99, 99.4, 98.5, 98.8));
  v.push(vela(32, 98.8, 100.1, 98.6, 99.3)); // mecha superior 0,8 de un rango de 1,5: más de la mitad
  assert.ok(señal(v, "MECHA", 32).s);
  const w = base();
  w.push(vela(31, 99, 99.4, 98.5, 98.8));
  w.push(vela(32, 99.6, 99.9, 98.6, 99.3)); // mecha de 0,3 sobre 1,3: menos de la mitad
  assert.equal(señal(w, "MECHA", 32).s, null);
  assert.ok(señal(w, "RECHAZO", 32).s); // el rechazo sí se cumple (toca y cierra debajo): lo que falla es la mecha
});

test("VOLUMEN: solo si la vela que rompió tuvo 1,5 veces el volumen promedio", () => {
  const v = base();
  v[30] = vela(30, 105, 105, 98.8, 99, 3);
  v.push(vela(31, 99, 99.4, 98.5, 98.8));
  v.push(vela(32, 98.8, 100.1, 98.6, 99.3));
  assert.ok(señal(v, "VOLUMEN", 32).s);
  const w = base();
  w.push(vela(31, 99, 99.4, 98.5, 98.8));
  w.push(vela(32, 98.8, 100.1, 98.6, 99.3));
  assert.equal(señal(w, "VOLUMEN", 32).s, null);
});

test("el retesteo vence a las 30 velas de la rotura", () => {
  const v = base();
  for (let i = 31; i < 31 + 30; i += 1) v.push(vela(i, 98.5, 99, 98, 98.5));
  v.push(vela(61, 98.8, 100.1, 98.6, 99.3)); // vela 61: 31 después de la rotura
  assert.equal(señal(v, "RECHAZO", 61).s, null);
  const w = base();
  for (let i = 31; i < 30 + 30; i += 1) w.push(vela(i, 98.5, 99, 98, 98.5));
  w.push(vela(60, 98.8, 100.1, 98.6, 99.3)); // vela 60: la 30.ª
  assert.ok(señal(w, "RECHAZO", 60).s);
});

test("una zona que obliga a un stop a más de 4 ATR del cierre no se opera", () => {
  const v = base();
  v[25] = vela(25, 100.5, 108, 99.7, 99.8); // zona enorme: el stop queda lejísimos del cierre
  v.push(vela(31, 99, 99.4, 98.5, 98.8));
  v.push(vela(32, 98.8, 100.1, 98.6, 99.3));
  const ind = indicadores(v);
  assert.ok(breakersCausales(v, ind.atr14, 1.8).length <= 1);
  assert.equal(senalesBreaker(v, ind, "RECHAZO", CONFIGURACION_BASE_BREAKER)(32), null);
});

test("ninguna señal mira el futuro: con la serie cortada en la vela i da lo mismo que con la serie entera", () => {
  const v: SwingCandle[] = [];
  let p = 100;
  let s = 7;
  for (let i = 0; i < 700; i += 1) {
    s = (s * 16807) % 2147483647;
    const ruido = (s / 2147483647 - 0.5) * 2;
    const open = p;
    p = Math.max(1, p * (1 + 0.012 * Math.sin(i / 20) + 0.02 * ruido));
    v.push(vela(i, open, Math.max(open, p) * 1.006, Math.min(open, p) * 0.994, p, 1 + ((i * 7) % 5)));
  }
  const indTodo = indicadores(v);
  let con = 0;
  for (const c of CONFIRMACIONES_BREAKER) {
    const entera = senalesBreaker(v, indTodo, c, CONFIGURACION_BASE_BREAKER);
    for (let i = 60; i < v.length; i += 1) {
      const e = entera(i);
      if (e) con += 1;
      // Cortar en cada vela es caro: se comprueba en todas las que tienen señal y en una de cada diez.
      if (!e && i % 10 !== 0) continue;
      const corta = v.slice(0, i + 1);
      assert.deepEqual(senalesBreaker(corta, indicadores(corta), c, CONFIGURACION_BASE_BREAKER)(i), e, `${c} en ${i}`);
    }
  }
  assert.ok(con > 0, "la serie de prueba tiene que producir señales");
});

test("la grilla tiene 27 configuraciones distintas y la base está entre ellas", () => {
  const g = grillaBreaker();
  assert.equal(g.length, 27);
  assert.equal(new Set(g.map((c) => `${c.desplazamiento}|${c.margenAtr}|${c.rr}`)).size, 27);
  assert.equal(g.filter((c) => mismaConfiguracionBreaker(c, CONFIGURACION_BASE_BREAKER)).length, 1);
});

test("el recorrido común mide la señal con la escalera de la app: entra a la apertura siguiente y el stop cuenta primero", () => {
  const v = base();
  v.push(vela(31, 99, 99.4, 98.5, 98.8));
  v.push(vela(32, 98.8, 100.1, 98.6, 99.3));
  v.push(vela(33, 99.3, 106, 90, 99)); // toca el stop (arriba) y también el objetivo (abajo): cuenta el stop
  for (let i = 34; i < 60; i += 1) v.push(vela(i, 99, 99.5, 98.5, 99));
  const ind = indicadores(v);
  const ops = operarSenales("BREAKER_BLOCK", "TEST", v, senalesBreaker(v, ind, "RECHAZO", CONFIGURACION_BASE_BREAKER), { marcoMs: H, horizonte: 48, feePct: 0.07 });
  assert.ok(ops.length >= 1);
  assert.equal(ops[0].estrategia, "BREAKER_BLOCK");
  assert.equal(ops[0].lado, "SHORT");
  assert.equal(ops[0].abiertaA, 33 * H);
  assert.equal(ops[0].sl, true);
  assert.ok(ops[0].r < 0);
});
