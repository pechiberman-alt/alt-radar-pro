/**
 * Pruebas del tutorial de la plataforma (lib/tutorial.ts): cada paso lleva a una sección que existe, cada capítulo tiene
 * pasos, y se abre solo la primera vez o con ?tutorial=1 (el QR impreso).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAPITULOS, debeAbrirse, inicioCapitulo, PASOS_TUTORIAL } from "../lib/tutorial.ts";

test("cada botón del tutorial lleva a una sección o pestaña que existe", () => {
  const app = readFileSync(new URL("../app/radar-app.tsx", import.meta.url), "utf8");
  const secciones = new Set([...app.matchAll(/<Collapsible id="([^"]+)"/g)].map((m) => m[1]));
  for (const p of PASOS_TUTORIAL) {
    const a = p.accion;
    if (a?.tipo === "seccion") assert.ok(secciones.has(a.destino), `${p.id}: la sección ${a.destino} no existe`);
    if (a?.tipo === "ar") assert.ok(["ACCIONES", "CEDEARS", "FIBONACCI", "ESCANER", "SALA"].includes(a.destino), `${p.id}: pestaña ${a.destino}`);
  }
});

test("los capítulos van en orden y cada uno tiene pasos", () => {
  for (const c of CAPITULOS) assert.ok(inicioCapitulo(c) >= 0, `${c} sin pasos`);
  const orden = PASOS_TUTORIAL.map((p) => CAPITULOS.indexOf(p.capitulo as (typeof CAPITULOS)[number]));
  assert.ok(orden.every((x) => x >= 0));
  assert.deepEqual(orden, [...orden].sort((a, b) => a - b), "los pasos siguen el orden de los capítulos");
  assert.equal(new Set(PASOS_TUTORIAL.map((p) => p.id)).size, PASOS_TUTORIAL.length);
  assert.ok(PASOS_TUTORIAL.some((p) => /es asesoramiento financiero/i.test(p.texto)));
});

test("se abre solo la primera vez o cuando el enlace lo pide", () => {
  assert.equal(debeAbrirse("", false), true);
  assert.equal(debeAbrirse("", true), false);
  assert.equal(debeAbrirse("?tutorial=1", true), true, "el QR impreso lo abre siempre");
  assert.equal(debeAbrirse("?tutorial=0", false), false);
});
