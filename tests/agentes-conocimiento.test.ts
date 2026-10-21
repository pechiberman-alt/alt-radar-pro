// Pruebas del conocimiento profesional de cada agente de la oficina (lib/agentes-conocimiento.ts): todos tienen conceptos
// revisados que explican su regla, los de flujo los de flujo, y sin IA el motor local contesta conceptos con el texto
// revisado (no inventa) o devuelve null para que el agente hable de sí mismo.
import assert from "node:assert/strict";
import test from "node:test";
import { conocimientoDe, conocimientoParaIa, respuestaConcepto } from "../lib/agentes-conocimiento.ts";
import { AGENTES_PAPEL } from "../lib/agentes-papel.ts";
import { ID_ST, mesaDe } from "../lib/oficina.ts";

test("cada agente tiene entre 2 y 4 conceptos revisados, sin repetir", () => {
  for (const id of [...AGENTES_PAPEL, ID_ST]) {
    const ks = conocimientoDe(id, mesaDe(id));
    assert.ok(ks.length >= 2 && ks.length <= 4, `${id}: ${ks.length}`);
    assert.equal(new Set(ks.map((k) => k.id)).size, ks.length, id);
  }
  assert.deepEqual(conocimientoDe("DELTA_DIV", "FLUJO").map((k) => k.id).slice(0, 2), ["divergencia-delta", "cvd"]);
  assert.ok(conocimientoDe("ESFUERZO", "FLUJO").some((k) => k.id === "esfuerzo-resultado"));
  const ia = conocimientoParaIa(conocimientoDe("ABSORCION", "FLUJO"));
  assert.ok(ia.every((x) => x.tema && x.idea), "va a la IA con tema e idea");
});

test("sin IA, una pregunta por un concepto se contesta con el texto revisado; otra cosa, null", () => {
  const r = respuestaConcepto("¿qué es la divergencia de delta?");
  assert.ok(r && r.startsWith("Divergencia de delta:") && r.includes("Ojo:"));
  assert.ok(respuestaConcepto("explicame el esfuerzo sin resultado")?.startsWith("Esfuerzo contra resultado"));
  assert.equal(respuestaConcepto("hola, ¿cómo andás?"), null);
});
