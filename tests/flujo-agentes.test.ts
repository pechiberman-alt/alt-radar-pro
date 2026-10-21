// Pruebas de los agentes de flujo de órdenes (lib/flujo-agentes.ts): cada lectura dispara en su caso de libro y no en el
// contrario, el delta sale del volumen agresor de Binance (sin el dato, null: desconocido no es cero), ninguna mira el
// futuro y los códigos del mapa no se repiten entre agentes.
import assert from "node:assert/strict";
import test from "node:test";
import { AGENTES_PAPEL } from "../lib/agentes-papel.ts";
import { ESTRATEGIAS, indicadores } from "../lib/estrategias.ts";
import { deltaDe, MARGEN_FLUJO_ATR, RR_FLUJO, senalAbsorcion, senalBarridaVol, senalDeltaAbsorbido, senalDeltaDiv, senalEsfuerzo } from "../lib/flujo-agentes.ts";
import { codigoAgente } from "../lib/mapa-agentes.ts";
import { mesaDe } from "../lib/oficina.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const H = 4 * 3_600_000;
const vela = (k: number, open: number, high: number, low: number, close: number, volume = 10, takerBuy?: number): SwingCandle => ({
  openTime: k * H, open, high, low, close, volume, quoteVolume: volume * close, ...(takerBuy === undefined ? {} : { takerBuy }),
});
/** n velas quietas alrededor de 100 (rango 99–101), con volumen 10 y la mitad comprada agresivamente. */
const quietas = (n: number, conTaker = true) => Array.from({ length: n }, (_, k) => vela(k, 100, 101, 99, 100, 10, conTaker ? 5 : undefined));
const atrUno = (n: number) => Array.from({ length: n }, () => 1);
const volCon = (n: number, i: number, x: number) => Array.from({ length: n }, (_, k) => (k === i ? x : 1));

test("delta: compra agresiva menos venta agresiva; sin el dato o con un dato imposible, null", () => {
  assert.equal(deltaDe(vela(0, 1, 1, 1, 1, 10, 7)), 4);
  assert.equal(deltaDe(vela(0, 1, 1, 1, 1, 10, 0)), -10);
  assert.equal(deltaDe(vela(0, 1, 1, 1, 1, 10)), null, "sin volumen agresor no se supone cero");
  assert.equal(deltaDe(vela(0, 1, 1, 1, 1, 10, 11)), null, "más compra agresiva que volumen: dato roto");
  assert.equal(deltaDe(vela(0, 1, 1, 1, 1, 0, 0)), null);
});

test("absorción: extremo de 20 velas con volumen doble y cierre lejos del extremo", () => {
  const v = [...quietas(25), vela(25, 99.5, 100.2, 97, 99.8)];
  const i = 25;
  const s = senalAbsorcion(v, atrUno(26), volCon(26, i, 2.4), i);
  assert.ok(s);
  assert.equal(s.lado, "LONG");
  assert.equal(s.stop, 97 - MARGEN_FLUJO_ATR);
  assert.equal(s.objetivo, 99.8 + RR_FLUJO * (99.8 - s.stop));
  assert.equal(senalAbsorcion(v, atrUno(26), volCon(26, i, 1.5), i), null, "sin volumen no hay absorción");
  const cierraAbajo = [...quietas(25), vela(25, 99.5, 100.2, 97, 97.5)];
  assert.equal(senalAbsorcion(cierraAbajo, atrUno(26), volCon(26, i, 2.4), i), null, "cerró pegado al mínimo: no absorbió nadie");
  const corto = senalAbsorcion([...quietas(25), vela(25, 100.5, 103, 99.8, 100.2)], atrUno(26), volCon(26, i, 3), i);
  assert.equal(corto?.lado, "SHORT");
  assert.equal(corto?.stop, 103 + MARGEN_FLUJO_ATR);
});

test("esfuerzo sin resultado: tras un tramo de 2 ATR, mucho volumen y poco rango, cierre en contra", () => {
  const sube = [100.2, 100.8, 101.4, 102, 102.6, 103];
  const v = [...quietas(10), ...sube.map((p, k) => vela(10 + k, p - 0.4, p + 0.2, p - 0.5, p))];
  const i = v.length;
  v.push(vela(i, 103, 103.1, 102.7, 102.85));
  const n = v.length;
  const s = senalEsfuerzo(v, atrUno(n), volCon(n, i, 3), i);
  assert.equal(s?.lado, "SHORT");
  assert.ok(s && s.stop > 103.1 && s.objetivo < 102.85);
  assert.equal(senalEsfuerzo(v, atrUno(n), volCon(n, i, 2), i), null, "sin esfuerzo (volumen) no cuenta");
  const v2 = v.slice(0, i).concat(vela(i, 102.7, 103.1, 102.65, 103.05));
  assert.equal(senalEsfuerzo(v2, atrUno(n), volCon(n, i, 3), i), null, "cerró arriba: el esfuerzo sí dio resultado");
});

test("barrida con volumen: pasa el mínimo de 20 velas y cierra de vuelta adentro", () => {
  const v = [...quietas(25), vela(25, 99.6, 100, 98.2, 99.7)];
  const i = 25;
  const s = senalBarridaVol(v, atrUno(26), volCon(26, i, 1.6), i);
  assert.equal(s?.lado, "LONG");
  assert.equal(s?.stop, 98.2 - MARGEN_FLUJO_ATR);
  const sigueAfuera = [...quietas(25), vela(25, 99.6, 99.8, 98.2, 98.6)];
  assert.equal(senalBarridaVol(sigueAfuera, atrUno(26), volCon(26, i, 1.6), i), null, "cerró afuera: es ruptura, no barrida");
  assert.equal(senalBarridaVol(v, atrUno(26), volCon(26, i, 1.2), i), null);
});

test("divergencia de delta: nuevo mínimo con el delta acumulado más alto que en el mínimo anterior", () => {
  // 31 velas: el mínimo anterior (vela 20) con venta agresiva fuerte; la última hace un mínimo nuevo con compra agresiva.
  const v = quietas(31);
  v[20] = vela(20, 99.5, 99.8, 98, 98.5, 20, 2);
  v[25] = vela(25, 99, 99.6, 98.6, 99.2, 10, 9);
  const i = 31;
  v.push(vela(i, 97.9, 98.9, 97.8, 98.7, 10, 8));
  const s = senalDeltaDiv(v, atrUno(32), i);
  assert.equal(s?.lado, "LONG");
  assert.equal(s?.stop, 97.8 - MARGEN_FLUJO_ATR);
  const sinDato = v.map((c) => ({ ...c, takerBuy: undefined }));
  assert.equal(senalDeltaDiv(sinDato, atrUno(32), i), null, "sin volumen agresor (Kraken, historial) no dispara");
  const acompana = v.slice(0, i).concat(vela(i, 97.9, 98.9, 97.8, 98.7, 10, 0));
  acompana[25] = vela(25, 99, 99.6, 98.6, 99.2, 10, 1);
  assert.equal(senalDeltaDiv(acompana, atrUno(32), i), null, "el delta acompaña la bajada: no hay divergencia");
});

test("delta absorbido: venta agresiva fuerte y la vela cierra arriba", () => {
  const v = [...quietas(25), vela(25, 99.4, 100.4, 99.2, 100.2, 30, 9)];
  const i = 25;
  const s = senalDeltaAbsorbido(v, atrUno(26), volCon(26, i, 2), i);
  assert.equal(s?.lado, "LONG");
  assert.equal(s?.stop, 99.2 - MARGEN_FLUJO_ATR);
  const sinDato = [...quietas(25, false), vela(25, 99.4, 100.4, 99.2, 100.2, 30)];
  assert.equal(senalDeltaAbsorbido(sinDato, atrUno(26), volCon(26, i, 2), i), null);
  const equilibrada = [...quietas(25), vela(25, 99.4, 100.4, 99.2, 100.2, 30, 14)];
  assert.equal(senalDeltaAbsorbido(equilibrada, atrUno(26), volCon(26, i, 2), i), null, "sin agresión fuerte no hay nada que absorber");
});

test("ningún agente de flujo mira el futuro, con volumen variable y volumen agresor", () => {
  let s = 7;
  const azar = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let p = 100;
  const v: SwingCandle[] = [];
  for (let k = 0; k < 500; k += 1) {
    const open = p;
    p = Math.max(1, p * (1 + 0.006 * Math.sin(k / 17) + 0.02 * (azar() - 0.5)));
    const volume = 5 + 40 * azar() ** 3;
    v.push({ openTime: k * H, open, high: Math.max(open, p) * (1 + 0.01 * azar()), low: Math.min(open, p) * (1 - 0.01 * azar()), close: p, volume, quoteVolume: volume * p, takerBuy: volume * azar() });
  }
  const completos = indicadores(v);
  const flujo = ESTRATEGIAS.filter((e) => mesaDe(e.id) === "FLUJO");
  assert.equal(flujo.length, 5);
  let disparos = 0;
  for (const e of flujo) {
    for (let i = 60; i < v.length; i += 7) {
      const corto = v.slice(0, i + 1);
      const a = e.senal(v, completos, i);
      assert.deepEqual(a, e.senal(corto, indicadores(corto), i), `${e.id} en la vela ${i}`);
      if (a) {
        disparos += 1;
        assert.ok(a.lado === "LONG" ? a.stop < v[i].close && a.objetivo > v[i].close : a.stop > v[i].close && a.objetivo < v[i].close, `${e.id}: stop y objetivo del lado correcto`);
      }
    }
  }
  assert.ok(disparos > 0, "con volumen que varía, alguno dispara");
});

test("los agentes de flujo están en la oficina (mesa de flujo) y cada agente tiene un código propio en el mapa", () => {
  for (const id of ["ABSORCION", "ESFUERZO", "BARRIDA_VOL", "DELTA_DIV", "DELTA_ABSORBIDO"]) {
    assert.equal(mesaDe(id), "FLUJO", id);
    assert.ok(AGENTES_PAPEL.includes(id as (typeof AGENTES_PAPEL)[number]), `${id} opera en papel`);
  }
  const codigos = [...AGENTES_PAPEL, "ST_REGIMEN"].map(codigoAgente);
  assert.equal(new Set(codigos).size, codigos.length, `códigos repetidos: ${codigos.join(" ")}`);
});

test("la mesa de flujo en el gráfico: mismas reglas, sin mirar el futuro, y avisa cuando falta el volumen agresor", async () => {
  const { lecturaFlujo, LECTORES_FLUJO, haceVelas } = await import("../lib/flujo-lectura.ts");
  for (const l of LECTORES_FLUJO) assert.equal(l.codigo, codigoAgente(l.id), `el código de ${l.id} es el del mapa`);
  let s = 11;
  const azar = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let p = 100;
  const v: SwingCandle[] = [];
  for (let k = 0; k < 400; k += 1) {
    const open = p;
    p = Math.max(1, p * (1 + 0.02 * (azar() - 0.5)));
    const volume = 5 + 40 * azar() ** 3;
    v.push({ openTime: k * H, open, high: Math.max(open, p) * (1 + 0.01 * azar()), low: Math.min(open, p) * (1 - 0.01 * azar()), close: p, volume, quoteVolume: volume * p, takerBuy: volume * azar() });
  }
  const todo = lecturaFlujo(v);
  assert.equal(todo.sinDelta, false);
  assert.ok(todo.disparos.length > 0);
  for (let k = 1; k < todo.disparos.length; k += 1) assert.ok(todo.disparos[k - 1].openTime >= todo.disparos[k].openTime, "del más nuevo al más viejo");
  // Cortar la serie después de un disparo no lo cambia: solo usa velas hasta la suya.
  for (const d of todo.disparos.slice(0, 8)) {
    const hasta = v.findIndex((c) => c.openTime === d.openTime);
    const corto = lecturaFlujo(v.slice(0, hasta + 1), 1);
    assert.ok(corto.disparos.some((x) => x.id === d.id && x.lado === d.lado && x.stop === d.stop), `${d.id} en ${hasta}`);
  }
  assert.equal(haceVelas(todo.disparos[0], v).startsWith("hace") || haceVelas(todo.disparos[0], v) === "en la última vela cerrada", true);
  const sinTaker = lecturaFlujo(v.map((c) => ({ ...c, takerBuy: undefined })));
  assert.equal(sinTaker.sinDelta, true);
  assert.ok(sinTaker.disparos.every((d) => d.id !== "DELTA_DIV" && d.id !== "DELTA_ABSORBIDO"));
  assert.deepEqual(lecturaFlujo([]).disparos, []);
});
