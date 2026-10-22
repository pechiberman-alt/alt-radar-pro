/**
 * Pruebas del análisis técnico de un papel de BYMA (lib/mercado-ar-tecnico.ts): la zona de compra de Fibonacci, su
 * historial (aguantó, falló, abierta), las semanas armadas con ruedas diarias, la estructura y que nada mira el futuro.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SwingCandle } from "../lib/swing-entries.ts";
import { analisisAr, estructura, historialFib, semanales, zonaFib, zonasConfluencia, zonaVentaFib } from "../lib/mercado-ar-tecnico.ts";
import type { Level } from "../lib/level-engine.ts";

const DIA = 86_400_000;
const T0 = Date.UTC(2025, 0, 6); // un lunes

/** Ruedas a partir de una lista de cierres, con mechas chicas. */
function desdeCierres(cierres: number[]): SwingCandle[] {
  return cierres.map((c, k) => {
    const o = k ? cierres[k - 1] : c;
    return { openTime: T0 + k * DIA, open: o, high: Math.max(o, c) * 1.002, low: Math.min(o, c) * 0.998, close: c, volume: 1000, quoteVolume: 1000 * c };
  });
}

function caminata(n: number, tendencia: number, semilla: number, inicio = 100): SwingCandle[] {
  let s = semilla;
  const az = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const c: number[] = [];
  let p = inicio;
  for (let k = 0; k < n; k += 1) {
    p *= 1 + tendencia + (az() - 0.5) * 0.04;
    c.push(p);
  }
  return desdeCierres(c);
}

test("semanales: una vela por semana con el máximo, el mínimo y el último cierre", () => {
  // De lunes a domingo es una semana; el lunes siguiente abre otra.
  const v = desdeCierres([10, 12, 11, 9, 13, 14, 15, 16]);
  const s = semanales(v);
  assert.equal(s.length, 2);
  assert.equal(s[0].openTime, T0);
  assert.equal(s[0].close, 15, "la última rueda de la semana la cierra");
  assert.ok(Math.abs(s[0].high - 15 * 1.002) < 1e-9);
  assert.equal(s[1].close, 16);
  assert.equal(v[0].high, 10 * 1.002, "no toca las ruedas originales");
});

test("zona de Fibonacci: pierna alcista, zona 0,618–0,786 y plan con la escalera ordenada", () => {
  // Base plana, subida fuerte de 100 a 200, y un retroceso hasta la zona.
  const c = [...Array(40).fill(0).map((_, k) => 130 - k * 0.75), ...Array(25).fill(0).map((_, k) => 100.75 + (k + 1) * 4), ...Array(12).fill(0).map((_, k) => 200.75 - (k + 1) * 6.5)];
  const v = desdeCierres(c);
  const { fib, motivo } = zonaFib(v);
  assert.equal(motivo, null);
  assert.ok(fib);
  assert.equal(fib.pierna.lado, "LONG");
  const rango = fib.pierna.extremo - fib.pierna.origen;
  assert.ok(Math.abs(fib.zona.alto - (fib.pierna.extremo - 0.618 * rango)) < 1e-9);
  assert.equal(fib.estado, "EN LA ZONA");
  const p = fib.plan!;
  assert.ok(p.stop < fib.pierna.origen && p.stop < p.entrada && p.entrada < p.tp1 && p.tp1 < p.tp2 && p.tp2 < p.tp3);
  assert.ok(Math.abs(p.tp3 - (fib.pierna.origen + 1.618 * rango)) < 1e-9);
});

test("zona de Fibonacci: con la última pierna bajista no hay zona de compra, y se dice", () => {
  const c = [...Array(40).fill(0).map((_, k) => 170 + k * 0.75), ...Array(25).fill(0).map((_, k) => 199.25 - (k + 1) * 4), ...Array(12).fill(0).map((_, k) => 99.25 + (k + 1) * 1.5)];
  const r = zonaFib(desdeCierres(c));
  assert.equal(r.fib, null);
  assert.match(r.motivo ?? "", /bajista/);
  assert.match(zonaFib(desdeCierres([1, 2, 3])).motivo ?? "", /60 ruedas/);
});

test("historial de la zona: aguantó, falló (peor caso en la misma rueda) y abierta", () => {
  const base: SwingCandle = { openTime: 0, open: 150, high: 151, low: 149, close: 150, volume: 1, quoteVolume: 1 };
  const mk = (rows: [number, number][]) => rows.map(([lo, hi], k) => ({ ...base, openTime: k * DIA, low: lo, high: hi }));
  const pierna = { lado: "LONG" as const, origen: 100, extremo: 200, i: 0, conocida: 0 };
  // Zona alta = 200 − 0,618 × 100 = 138,2. Toca y vuelve al máximo: aguantó.
  assert.deepEqual(historialFib(mk([[150, 160], [130, 150], [150, 201]]), [pierna]), { probadas: 1, aguantaron: 1, fallaron: 0, abiertas: 0 });
  // Toca y pierde el origen: falló.
  assert.deepEqual(historialFib(mk([[150, 160], [130, 150], [95, 140]]), [pierna]), { probadas: 1, aguantaron: 0, fallaron: 1, abiertas: 0 });
  // En la misma rueda pierde el origen y hace el máximo: cuenta la falla.
  assert.deepEqual(historialFib(mk([[150, 160], [130, 150], [95, 205]]), [pierna]), { probadas: 1, aguantaron: 0, fallaron: 1, abiertas: 0 });
  // Toca y todavía no se resolvió.
  assert.deepEqual(historialFib(mk([[150, 160], [130, 150], [140, 180]]), [pierna]), { probadas: 1, aguantaron: 0, fallaron: 0, abiertas: 1 });
  // Hizo un máximo nuevo sin volver: no se probó.
  assert.deepEqual(historialFib(mk([[150, 160], [160, 210], [130, 150]]), [pierna]), { probadas: 0, aguantaron: 0, fallaron: 0, abiertas: 0 });
});

test("estructura: máximos y mínimos crecientes es alcista; sin pivotes, sin datos", () => {
  const ondas = (pendiente: number) => desdeCierres(Array.from({ length: 200 }, (_, k) => 200 + k * pendiente + 10 * Math.sin(k / 6)));
  assert.equal(estructura(ondas(0.5)).tendencia, "ALCISTA");
  assert.equal(estructura(ondas(-0.5)).tendencia, "BAJISTA");
  assert.equal(estructura(desdeCierres([1, 2, 3])).tendencia, "SIN DATOS");
});

test("no mira el futuro: el análisis de un día no cambia con las ruedas que vienen después", () => {
  const v = caminata(420, 0.001, 21);
  const corte = 330;
  const otroFuturo = [...v.slice(0, corte), ...caminata(90, -0.01, 77, v[corte - 1].close).map((c, k) => ({ ...c, openTime: v[corte + k].openTime }))];
  assert.deepEqual(analisisAr(v.slice(0, corte)), analisisAr(otroFuturo.slice(0, corte)));
  const a = analisisAr(v);
  assert.ok(a.niveles.length > 0, "con 420 ruedas hay niveles");
  assert.ok(a.niveles.every((n) => n.stars >= 1 && n.stars <= 3));
});

const serieBajista = (rebote: number) => [...Array(40).fill(0).map((_, k) => 170 + k * 0.75), ...Array(25).fill(0).map((_, k) => 199.25 - (k + 1) * 4), ...Array(12).fill(0).map((_, k) => 99.25 + (k + 1) * rebote)];

test("zona de venta: el espejo de la compra, con la escalera ordenada hacia abajo", () => {
  const v = desdeCierres(serieBajista(5.5));
  assert.equal(zonaFib(v).fib, null, "no hay zona de compra con la última pierna bajista");
  const z = zonaVentaFib(v);
  assert.ok(z);
  assert.equal(z.pierna.lado, "SHORT");
  const rango = z.pierna.origen - z.pierna.extremo;
  assert.ok(Math.abs(z.zona.bajo - (z.pierna.extremo + 0.618 * rango)) < 1e-9);
  assert.ok(Math.abs(z.zona.alto - (z.pierna.extremo + 0.786 * rango)) < 1e-9);
  assert.equal(z.estado, "EN LA ZONA");
  const p = z.plan!;
  assert.ok(p.stop > z.pierna.origen && p.stop > p.entrada && p.entrada > p.tp1 && p.tp1 > p.tp2 && p.tp2 > p.tp3, "SL arriba y TP1 > TP2 > TP3 hacia abajo");
  assert.ok(Math.abs(p.tp3 - (z.pierna.origen - 1.618 * rango)) < 1e-9);
  // Si todavía no rebotó hasta la zona, está debajo; y con una pierna alcista no hay zona de venta.
  assert.equal(zonaVentaFib(desdeCierres(serieBajista(1.5)))!.estado, "DEBAJO DE LA ZONA");
  assert.equal(zonaVentaFib(desdeCierres([...Array(40).fill(0).map((_, k) => 130 - k * 0.75), ...Array(25).fill(0).map((_, k) => 100.75 + (k + 1) * 4)])), null);
});

test("historial de la zona de venta: aguantó (volvió a caer al mínimo), falló (superó el origen) y no probada", () => {
  const base: SwingCandle = { openTime: 0, open: 150, high: 151, low: 149, close: 150, volume: 1, quoteVolume: 1 };
  const mk = (rows: [number, number][]) => rows.map(([lo, hi], k) => ({ ...base, openTime: k * DIA, low: lo, high: hi }));
  const pierna = { lado: "SHORT" as const, origen: 200, extremo: 100, i: 0, conocida: 0 };
  // Zona baja = 100 + 0,618 × 100 = 161,8: el rebote la toca y después vuelve al mínimo.
  assert.deepEqual(historialFib(mk([[150, 155], [150, 165], [99, 150]]), [pierna], 80, "SHORT"), { probadas: 1, aguantaron: 1, fallaron: 0, abiertas: 0 });
  assert.deepEqual(historialFib(mk([[150, 155], [150, 165], [160, 201]]), [pierna], 80, "SHORT"), { probadas: 1, aguantaron: 0, fallaron: 1, abiertas: 0 });
  // Sigue cayendo sin rebotar: no se probó. Y una pierna alcista no cuenta en el historial de venta.
  assert.deepEqual(historialFib(mk([[150, 155], [90, 150]]), [pierna], 80, "SHORT"), { probadas: 0, aguantaron: 0, fallaron: 0, abiertas: 0 });
  assert.equal(historialFib(mk([[150, 165]]), [{ ...pierna, lado: "LONG" as const, origen: 100, extremo: 200 }], 80, "SHORT").probadas, 0);
});

test("zonas por confluencia: motivos distintos juntos hacen zona; los niveles de Fibonacci cuentan como un solo motivo", () => {
  const lvl = (price: number, kinds: string[]): Level => ({ price, low: price, high: price, kind: price < 100 ? "SOPORTE" : "RESISTENCIA", score: 4, stars: 2, distancePct: Math.abs(price - 100), sources: kinds.map((k) => ({ kind: k, label: k, price, weight: 2 })) });
  // Compra en 90: estructura + POC → dos motivos. Venta en 110: Fibonacci 0,618 y 0,786 juntos → un solo motivo.
  const z = zonasConfluencia(100, 1, [lvl(90, ["S/R 1d", "POC"]), lvl(110, ["FIB 0.618", "FIB 0.786"])], [], null, null);
  const compra = z.find((x) => x.side === "SOPORTE")!;
  const venta = z.find((x) => x.side === "RESISTENCIA")!;
  assert.deepEqual([...compra.kinds].sort(), ["ESTRUCTURA", "POC"]);
  assert.equal(venta.kinds.length, 1);
  assert.equal(venta.stars, 1, "un solo motivo: una estrella, no confluencia");
  assert.deepEqual(zonasConfluencia(0, 1, [], [], null, null), []);
});

test("el análisis trae la zona de venta y zonas ordenadas de mayor a menor precio", () => {
  const a = analisisAr(desdeCierres(serieBajista(5.5)));
  assert.equal(a.fib, null);
  assert.ok(a.fibVenta);
  const precios = a.zonas.map((z) => z.mid);
  assert.deepEqual([...precios].sort((x, y) => y - x), precios);
  for (const z of a.zonas) assert.ok(z.low <= z.high);
});
