// Pruebas de las explicaciones de los agentes (lib/agentes-explicado.ts): que todos los agentes del estudio tengan la suya,
// que estén en castellano simple y que ninguna prometa ganancias ni hable de lo que el agente consigue.
import assert from "node:assert/strict";
import test from "node:test";
import { EXPLICADO, explicadoDe, sinExplicacion } from "../lib/agentes-explicado.ts";
import { ESTRATEGIAS } from "../lib/estrategias.ts";

test("todos los agentes del estudio tienen explicación", () => {
  assert.deepEqual(sinExplicacion(), []);
});

test("no hay explicaciones de agentes que no existen", () => {
  const ids = new Set(ESTRATEGIAS.map((e) => e.id as string));
  for (const id of Object.keys(EXPLICADO)) assert.ok(ids.has(id), `${id} no es una estrategia del estudio`);
});

test("cada explicación tiene qué mira y la idea de fondo, sin tecnicismos vacíos", () => {
  for (const [id, e] of Object.entries(EXPLICADO)) {
    assert.ok(e.mira.length > 15 && e.mira.endsWith("."), `${id}: «mira» mal escrito`);
    assert.ok(e.idea.length > 15 && e.idea.endsWith("."), `${id}: «idea» mal escrita`);
  }
});

test("ninguna explicación promete ganancias", () => {
  const t = Object.values(EXPLICADO).map((e) => `${e.mira} ${e.idea}`).join(" ").toLowerCase();
  for (const f of ["gana seguro", "ganancia asegurada", "siempre funciona", "dinero fácil", "rentable garantizado"]) {
    assert.ok(!t.includes(f), f);
  }
});

test("el control al azar se explica como vara, no como agente", () => {
  const a = explicadoDe("AZAR");
  assert.ok(a);
  assert.ok(a.idea.toLowerCase().includes("vara"));
  assert.equal(explicadoDe("NO_EXISTE"), null);
});
