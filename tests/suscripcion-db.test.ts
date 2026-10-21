// Pruebas del acceso PRO en la base (lib/suscripcion-db.ts) con node:sqlite haciendo de D1: la prueba arranca en el primer uso,
// un aviso de pago se guarda una sola vez y con tope de pendientes, aprobar suma días una sola vez aunque se apriete dos veces,
// rechazar no suma nada, y los envíos de Telegram van solo a quien tiene acceso (al que nunca entró le arranca la prueba).
import assert from "node:assert/strict";
import test from "node:test";
import { DIA_MS } from "../lib/suscripcion.ts";
import { accesoDe, aprobarPago, conAcceso, cuentasConEstado, extenderPro, olvidarTodo, pagosDe, pagosPendientes, rechazarPago, reportarPago } from "../lib/suscripcion-db.ts";

const sqlite = await import("node:sqlite").catch(() => null);

function makeDb() {
  const sql = new sqlite!.DatabaseSync(":memory:");
  const stmt = (q: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(q, a),
    run: async () => {
      const r = sql.prepare(q).run(...(args as never[]));
      return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
    first: async () => sql.prepare(q).get(...(args as never[])) ?? null,
    all: async () => ({ results: sql.prepare(q).all(...(args as never[])) }),
  });
  const db = { prepare: (q: string) => stmt(q), batch: async (list: { run: () => Promise<unknown> }[]) => { const out = []; for (const s of list) out.push(await s.run()); return out; } } as never as D1Database;
  sql.exec("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL DEFAULT '', password_salt TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  for (const e of ["uri@ejemplo.com", "ana@ejemplo.com", "beto@ejemplo.com"]) sql.prepare("INSERT INTO users (email) VALUES (?)").run(e);
  sql.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)");
  sql.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('admin_user_id', '1', '')").run();
  return db;
}

const T = 1_800_000_000_000;

test("la prueba arranca en el primer uso y el administrador entra siempre", { skip: !sqlite }, async () => {
  olvidarTodo();
  const db = makeDb();
  const ana = await accesoDe(db, 2, T);
  assert.deepEqual([ana.estado, ana.diasRestantes], ["PRUEBA", 7]);
  assert.equal((await accesoDe(db, 2, T + 3 * DIA_MS)).diasRestantes, 4, "no se reinicia al volver");
  assert.equal((await accesoDe(db, 2, T + 8 * DIA_MS)).estado, "VENCIDA");
  assert.equal((await accesoDe(db, 1, T + 100 * DIA_MS)).estado, "ADMIN");
  const cuentas = await cuentasConEstado(db, T);
  assert.equal(cuentas.find((c) => c.id === 3)?.estado, "SIN_USO", "quien nunca entró no figura vencido");
});

test("avisos de pago: uno por número de operación y como mucho 3 pendientes", { skip: !sqlite }, async () => {
  olvidarTodo();
  const db = makeDb();
  const r = await reportarPago(db, 2, { monto: 15000, referencia: "OP-1", nota: "" }, T);
  assert.ok(typeof r !== "string" && r.id > 0);
  assert.match(String(await reportarPago(db, 3, { monto: 15000, referencia: "OP-1", nota: "" }, T)), /YA SE AVISÓ/, "otra cuenta no puede reusar el número");
  await reportarPago(db, 2, { monto: 15000, referencia: "OP-2", nota: "" }, T + 1);
  await reportarPago(db, 2, { monto: 15000, referencia: "OP-3", nota: "" }, T + 2);
  assert.match(String(await reportarPago(db, 2, { monto: 15000, referencia: "OP-4", nota: "" }, T + 3)), /PENDIENTES/);
  assert.equal((await pagosPendientes(db)).length, 3);
  assert.equal((await pagosDe(db, 2))[0].referencia, "OP-3", "los suyos, del más nuevo al más viejo");
});

test("aprobar suma los días una sola vez; rechazar no suma nada", { skip: !sqlite }, async () => {
  olvidarTodo();
  const db = makeDb();
  await accesoDe(db, 2, T - 10 * DIA_MS);
  const p = await reportarPago(db, 2, { monto: 15000, referencia: "OP-9", nota: "" }, T);
  const q = await reportarPago(db, 2, { monto: 15000, referencia: "OP-10", nota: "" }, T);
  assert.ok(typeof p !== "string" && typeof q !== "string");
  const ok = await aprobarPago(db, p.id, 30, T);
  assert.deepEqual(ok, { userId: 2, hasta: T + 30 * DIA_MS });
  assert.equal(await aprobarPago(db, p.id, 30, T), null, "apretar dos veces no suma dos veces");
  assert.deepEqual(await rechazarPago(db, q.id, T), { userId: 2 });
  assert.equal(await aprobarPago(db, q.id, 30, T), null, "un rechazado no se aprueba después");
  const a = await accesoDe(db, 2, T + DIA_MS);
  assert.deepEqual([a.estado, a.diasRestantes], ["ACTIVA", 29]);
  assert.equal(await extenderPro(db, 2, 10, T + DIA_MS), T + 40 * DIA_MS, "activar a mano suma a lo que quedaba");
});

test("Telegram: solo quien tiene acceso; al que nunca entró le arranca la prueba", { skip: !sqlite }, async () => {
  olvidarTodo();
  const db = makeDb();
  await accesoDe(db, 2, T - 30 * DIA_MS); // Ana probó hace un mes y no pagó.
  const con = await conAcceso(db, [1, 2, 3, 3, -1], T);
  assert.deepEqual([...con].sort(), [1, 3]);
  assert.equal((await accesoDe(db, 3, T + DIA_MS)).diasRestantes, 6, "a Beto le arrancó la prueba con el envío");
  assert.deepEqual([...(await conAcceso(db, [], T))], []);
});
