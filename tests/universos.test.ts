// Pruebas de los universos de monedas (lib/universos.ts): que no se diga que un universo se puede medir cuando no hay velas
// descargadas, que las monedas con datos sean exactamente las del estudio, y que el comando de descarga nombre lo que falta.
import assert from "node:assert/strict";
import test from "node:test";
import { MONEDAS_PRACTICA } from "../lib/practica-gatillo.ts";
import { MONEDAS_CON_DATOS, UNIVERSOS, comandoDescarga, estadoUniverso, monedasFaltantes, tieneDatos, universoPorId } from "../lib/universos.ts";

test("las monedas con datos son exactamente las 10 del estudio", () => {
  assert.deepEqual([...MONEDAS_CON_DATOS].sort(), [...MONEDAS_PRACTICA].sort());
});

test("los universos tienen id único, nombre, criterio escrito y monedas en mayúsculas terminadas en USDT", () => {
  const ids = UNIVERSOS.map((u) => u.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const u of UNIVERSOS) {
    assert.ok(u.nombre.length > 0 && u.describe.length > 0, u.id);
    assert.ok(u.criterio.length > 20, `${u.id}: el criterio tiene que estar escrito`);
    for (const m of u.monedas) assert.match(m, /^[A-Z0-9]{2,12}USDT$/, `${u.id}: ${m}`);
    assert.equal(new Set(u.monedas).size, u.monedas.length, `${u.id}: monedas repetidas`);
  }
});

test("el universo del estudio es el único medible entero", () => {
  const medibles = UNIVERSOS.filter((u) => estadoUniverso(u).medible).map((u) => u.id);
  assert.deepEqual(medibles, ["ESTUDIO"]);
});

test("un universo sin velas descargadas dice que NO se puede medir en el pasado", () => {
  const e = estadoUniverso(universoPorId("PUMPEO")!);
  assert.equal(e.medible, false);
  assert.equal(e.vigilable, true);
  assert.ok(e.texto.includes("NO medir en el pasado") || e.texto.includes("no existe"), e.texto);
});

test("un universo mezclado nombra cuáles se pueden medir y aclara que el número del conjunto no existe", () => {
  const e = estadoUniverso(universoPorId("INFRA")!);
  assert.equal(e.medible, false);
  assert.deepEqual(e.conDatos, ["SOLUSDT"]);
  assert.ok(e.sinDatos.includes("AVAXUSDT") && e.sinDatos.includes("WLDUSDT"));
  assert.ok(e.texto.includes("no existe"), e.texto);
});

test("gemas queda sin lista y lo dice: armarla hoy mirando para atrás sería sesgo del sobreviviente", () => {
  const g = universoPorId("GEMAS")!;
  assert.deepEqual(g.monedas, []);
  assert.ok(g.criterio.toLowerCase().includes("sobreviviente"));
  const e = estadoUniverso(g);
  assert.equal(e.medible, false);
  assert.equal(e.vigilable, false);
});

test("ningún texto de estado promete ganancias ni habla de acierto sin datos", () => {
  for (const u of UNIVERSOS) {
    const t = estadoUniverso(u).texto.toLowerCase();
    for (const f of ["gana", "rentable", "ganancia asegurada"]) assert.ok(!t.includes(f), `${u.id}: ${t}`);
  }
});

test("tieneDatos distingue las del estudio de las demás", () => {
  assert.equal(tieneDatos("SOLUSDT"), true);
  assert.equal(tieneDatos("AVAXUSDT"), false);
  assert.equal(tieneDatos("sol"), false);
});

test("las faltantes son las de los universos sin datos, ordenadas y sin repetir", () => {
  const f = monedasFaltantes();
  assert.deepEqual(f, [...f].sort());
  assert.equal(new Set(f).size, f.length);
  assert.ok(f.includes("AVAXUSDT") && f.includes("PEPEUSDT"));
  for (const m of f) assert.equal(tieneDatos(m), false);
  // DOGE está en pumpeo pero sí tiene datos: no puede aparecer como faltante.
  assert.ok(!f.includes("DOGEUSDT"));
});

test("el comando de descarga nombra las faltantes, y sin faltantes no hay comando", () => {
  const c = comandoDescarga();
  assert.ok(c && c.includes("datos.py") && c.includes("AVAXUSDT"));
  assert.equal(comandoDescarga([]), null);
});

test("universoPorId devuelve null para uno que no existe", () => {
  assert.equal(universoPorId("NO_EXISTE"), null);
  assert.equal(universoPorId("ESTUDIO")?.monedas.length, MONEDAS_CON_DATOS.length);
});
