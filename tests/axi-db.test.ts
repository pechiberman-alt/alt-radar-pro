// Pruebas del almacenamiento del diario de Axi (lib/axi-db.ts): que importar dos veces no duplique, que cada persona vea solo lo
// suyo, que el tope de 500 se cumpla sin COUNT(*) y que borrar toque solo las filas de esa persona.
import assert from "node:assert/strict";
import test from "node:test";
import { MAX_DEALS_AXI, type DealAxi } from "../lib/axi-diario.ts";
import { borrarDeals, ensureAxiDiario, guardarDeals, listarDeals } from "../lib/axi-db.ts";

// node:sqlite hace de D1 (mismo dialecto SQL). Se omite donde no está disponible, como en tests/diario-db.test.ts.
const sqlite = await import("node:sqlite").catch(() => null);

function makeDb() {
  const sql = new sqlite!.DatabaseSync(":memory:");
  const stmt = (q: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(q, a),
    run: async () => ({ meta: { changes: Number(sql.prepare(q).run(...(args as never[])).changes) } }),
    first: async () => sql.prepare(q).get(...(args as never[])) ?? null,
    all: async () => ({ results: sql.prepare(q).all(...(args as never[])) }),
  });
  return { prepare: (q: string) => stmt(q), batch: async (list: { run: () => Promise<unknown> }[]) => Promise.all(list.map((s) => s.run())) } as never as D1Database;
}

const deal = (id: string, tiempo: number, extra: Partial<DealAxi> = {}): DealAxi => ({
  id, orden: "9", simbolo: "XAUUSD.c", tipo: "operacion", accion: "sell", entrada: "out", lotes: 0.1, precio: 4100, resultado: 10,
  swap: 0, comision: -0.5, neto: 9.5, tiempo, comentario: "", ...extra,
});

const T = Date.UTC(2026, 9, 1, 12);

test("importar dos veces lo mismo no duplica: se cuenta lo nuevo y lo que ya estaba", { skip: !sqlite }, async () => {
  const db = makeDb();
  await ensureAxiDiario(db);
  await ensureAxiDiario(db);
  const primera = await guardarDeals(db, 1, [deal("a", T), deal("b", T + 1000), deal("a", T)], T);
  assert.deepEqual(primera, { ok: true, nuevas: 2, ya: 1 }, "un id repetido dentro del mismo pedido cuenta una sola vez");
  const segunda = await guardarDeals(db, 1, [deal("a", T), deal("b", T + 1000)], T);
  assert.deepEqual(segunda, { ok: true, nuevas: 0, ya: 2 });
  assert.equal((await listarDeals(db, 1)).length, 2);
});

test("cada persona ve y cuenta solo sus ejecuciones", { skip: !sqlite }, async () => {
  const db = makeDb();
  await ensureAxiDiario(db);
  await guardarDeals(db, 1, [deal("a", T)], T);
  assert.deepEqual(await guardarDeals(db, 2, [deal("a", T)], T), { ok: true, nuevas: 1, ya: 0 }, "otra persona puede tener el mismo id");
  assert.equal((await listarDeals(db, 1)).length, 1);
  assert.equal((await listarDeals(db, 2)).length, 1);
  assert.equal((await listarDeals(db, 3)).length, 0);
});

test("la lista sale de la más reciente a la más vieja, con sus campos tal como se guardaron", { skip: !sqlite }, async () => {
  const db = makeDb();
  await ensureAxiDiario(db);
  await guardarDeals(db, 1, [deal("viejo", T), deal("nuevo", T + 86_400_000, { tipo: "operacion", comentario: "[sl]" }), deal("medio", T + 1000)], T);
  const lista = await listarDeals(db, 1);
  assert.deepEqual(lista.map((d) => d.id), ["nuevo", "medio", "viejo"]);
  assert.equal(lista[0].comentario, "[sl]");
  assert.equal(lista[0].neto, 9.5);
  assert.equal(lista[0].orden, "9");
  assert.equal(lista[0].tipo, "operacion");
});

test("el tope de 500 se cumple sin contar filas: un pedido que lo pasa no guarda nada y lo dice", { skip: !sqlite }, async () => {
  const db = makeDb();
  await ensureAxiDiario(db);
  const lleno = Array.from({ length: MAX_DEALS_AXI }, (_, i) => deal(`d${i}`, T + i));
  assert.deepEqual(await guardarDeals(db, 1, lleno, T), { ok: true, nuevas: MAX_DEALS_AXI, ya: 0 });
  const r = await guardarDeals(db, 1, [deal("extra", T + 9_999_999)], T);
  assert.equal(r.ok, false);
  assert.equal((await listarDeals(db, 1, 1000)).length, MAX_DEALS_AXI, "sigue en 500, sin la extra");
  // Reenviar lo que ya estaba no supera el tope: no agrega nada.
  assert.deepEqual(await guardarDeals(db, 1, lleno.slice(0, 10), T), { ok: true, nuevas: 0, ya: 10 });
});

test("borrar el diario quita solo las filas de esa persona", { skip: !sqlite }, async () => {
  const db = makeDb();
  await ensureAxiDiario(db);
  await guardarDeals(db, 1, [deal("a", T)], T);
  await guardarDeals(db, 2, [deal("a", T)], T);
  await borrarDeals(db, 1);
  assert.equal((await listarDeals(db, 1)).length, 0);
  assert.equal((await listarDeals(db, 2)).length, 1);
});
