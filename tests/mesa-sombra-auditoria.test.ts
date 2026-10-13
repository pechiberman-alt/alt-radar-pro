import assert from "node:assert/strict";
import test from "node:test";
import { canonico, GENESIS, hashEvento, verificarCadena, type EventoAuditado } from "../lib/mesa-sombra-auditoria.ts";

async function cadena(n: number): Promise<EventoAuditado[]> {
  const out: EventoAuditado[] = [];
  let prev = GENESIS;
  for (let seq = 1; seq <= n; seq += 1) {
    const datos = { variante: `V-${seq}`, n: seq, anidado: { b: 2, a: 1 } };
    const hash = await hashEvento(prev, seq, 1000 + seq, "EVOLUCION", datos);
    out.push({ seq, at: 1000 + seq, tipo: "EVOLUCION", datos, prev, hash });
    prev = hash;
  }
  return out;
}

test("el JSON canónico no depende del orden de las claves", () => {
  assert.equal(canonico({ b: 1, a: [2, { d: 1, c: null }] }), canonico({ a: [2, { c: null, d: 1 }], b: 1 }));
});

test("una cadena intacta se verifica, en cualquier orden", async () => {
  const c = await cadena(5);
  const v = await verificarCadena([...c].reverse());
  assert.ok(v.ok);
  assert.equal(v.revisados, 5);
});

test("editar, borrar o reordenar un evento rompe la cadena y dice dónde", async () => {
  const c = await cadena(5);
  const editada = c.map((e) => (e.seq === 3 ? { ...e, datos: { ...e.datos, n: 99 } } : e));
  assert.deepEqual([(await verificarCadena(editada)).ok, (await verificarCadena(editada)).rotaEn], [false, 3]);
  const borrada = c.filter((e) => e.seq !== 2);
  assert.equal((await verificarCadena(borrada)).rotaEn, 3);
  const reencadenada = c.map((e) => (e.seq === 4 ? { ...e, prev: GENESIS } : e));
  assert.equal((await verificarCadena(reencadenada)).ok, false);
  const otroGenesis = c.map((e) => (e.seq === 1 ? { ...e, prev: "f".repeat(64) } : e));
  assert.equal((await verificarCadena(otroGenesis)).ok, false);
});

test("una tirada parcial (los últimos eventos) se verifica sin el principio", async () => {
  const c = await cadena(8);
  assert.ok((await verificarCadena(c.slice(4))).ok);
});
