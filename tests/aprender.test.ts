// Pruebas del contenido de APRENDER (lib/aprender.ts): cada lección tiene texto y preguntas, cada respuesta correcta existe
// dentro de sus opciones, los ids no se repiten, el glosario no repite términos y ningún texto promete ganancias.
import assert from "node:assert/strict";
import test from "node:test";
import { GLOSARIO, LECCIONES, esCorrecta } from "../lib/aprender.ts";

test("cada lección tiene título, párrafos y al menos una pregunta", () => {
  for (const l of LECCIONES) {
    assert.ok(l.titulo.length > 0, `${l.id}: sin título`);
    assert.ok(l.parrafos.length > 0, `${l.id}: sin párrafos`);
    assert.ok(l.preguntas.length > 0, `${l.id}: sin preguntas`);
  }
});

test("la respuesta correcta de cada pregunta existe dentro de sus opciones", () => {
  for (const l of LECCIONES) {
    for (const p of l.preguntas) {
      assert.ok(p.opciones.length >= 2, `${p.id}: menos de dos opciones`);
      assert.ok(Number.isInteger(p.correcta) && p.correcta >= 0 && p.correcta < p.opciones.length, `${p.id}: respuesta correcta fuera de rango`);
      assert.ok(p.explicacion.length > 0, `${p.id}: sin explicación`);
    }
  }
});

test("esCorrecta acepta solo el índice correcto", () => {
  const p = LECCIONES[0].preguntas[0];
  assert.equal(esCorrecta(p, p.correcta), true);
  for (let k = 0; k < p.opciones.length; k += 1) {
    if (k !== p.correcta) assert.equal(esCorrecta(p, k), false);
  }
  assert.equal(esCorrecta(p, 99), false);
});

test("los ids de lecciones y preguntas no se repiten", () => {
  const lecciones = LECCIONES.map((l) => l.id);
  assert.equal(new Set(lecciones).size, lecciones.length);
  const preguntas = LECCIONES.flatMap((l) => l.preguntas.map((p) => p.id));
  assert.equal(new Set(preguntas).size, preguntas.length);
});

test("el glosario no repite términos y cada definición tiene texto", () => {
  const terminos = GLOSARIO.map((g) => g.termino.toLowerCase());
  assert.equal(new Set(terminos).size, terminos.length);
  for (const g of GLOSARIO) assert.ok(g.definicion.length > 0, `${g.termino}: sin definición`);
});

test("ningún texto promete ganancias ni habla de resultados garantizados", () => {
  const textos = [
    ...LECCIONES.flatMap((l) => [l.titulo, ...l.parrafos, ...l.preguntas.flatMap((p) => [p.pregunta, p.explicacion, ...p.opciones])]),
    ...GLOSARIO.map((g) => g.definicion),
  ].join("\n").toLowerCase();
  for (const frase of ["ganancia garantizada", "gana seguro", "dinero fácil", "te hace rico", "ganás siempre"]) {
    assert.ok(!textos.includes(frase), `aparece «${frase}»`);
  }
});
