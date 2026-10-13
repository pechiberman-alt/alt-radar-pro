import assert from "node:assert/strict";
import test from "node:test";
import { verificarCadena } from "../lib/mesa-sombra-auditoria.ts";
import { aprobarGuardada, ensureSombraSchema, EVOLUCION_CADA_MS, GUARDAR_CADA_MS, guardarCorrida, leerSombra, listarEventos, revocarGuardada } from "../lib/mesa-sombra-db.ts";
import { estadoInicial, type EstadoSombra } from "../lib/mesa-sombra.ts";
import { makeDb, sqlite } from "./helpers/fake-d1.ts";

const T = Date.parse("2026-10-13T10:00:00Z");
const U = 7;
const evolucion = (g: number) => ({ tipo: "EVOLUCION", datos: { generacion: g, probadas: 10 } });
const candidata = (tipo: "CANDIDATA" | "APTA", indice: number) => ({ tipo, datos: { variante: `V-${indice}`, indice } });
const conApta = (e: EstadoSombra, indice: number): EstadoSombra => ({
  ...e,
  generacion: e.generacion + 6,
  candidatas: [{ indice, descubiertaA: T, estado: "APTA", motivo: "apta", adelante: { n: 20, media: 0.3, mesa: 0.1 }, cambiadaA: T }],
});

test("guarda corridas encadenadas, limita una evolución cada 20 minutos y la cadena se verifica", { skip: !sqlite }, async () => {
  const db = makeDb();
  await ensureSombraSchema(db);
  const e1 = { ...estadoInicial(), generacion: 6 };
  const r1 = await guardarCorrida(db, U, e1, [evolucion(6), candidata("CANDIDATA", 5)], T);
  assert.ok(r1.ok);
  const pronto = await guardarCorrida(db, U, { ...e1, generacion: 12 }, [evolucion(12)], T + 60_000);
  assert.equal(pronto.ok, false);
  assert.equal(!pronto.ok && pronto.status, 429);
  const sinEvolucion = await guardarCorrida(db, U, e1, [candidata("APTA", 5)], T + 60_000);
  assert.ok(sinEvolucion.ok, "lo que no es una evolución no espera");
  assert.ok((await guardarCorrida(db, U, { ...e1, generacion: 12 }, [evolucion(12)], T + EVOLUCION_CADA_MS)).ok);
  const eventos = await listarEventos(db, U);
  assert.deepEqual(eventos.map((e) => e.seq), [4, 3, 2, 1]);
  assert.ok((await verificarCadena(eventos)).ok);
  assert.equal((await leerSombra(db, U)).seq, 4);
});

test("el navegador no puede aprobar, ni registrar aprobaciones, ni volver atrás", { skip: !sqlite }, async () => {
  const db = makeDb();
  await ensureSombraSchema(db);
  const e = { ...estadoInicial(), generacion: 6 };
  assert.ok((await guardarCorrida(db, U, e, [], T)).ok);
  const trampa = await guardarCorrida(db, U, { ...e, aprobada: { indice: 5, aprobadaA: T } }, [], T + 1);
  assert.equal(!trampa.ok && trampa.status, 403);
  const falso = await guardarCorrida(db, U, e, [{ tipo: "APROBACION", datos: { indice: 5 } }], T + 2);
  assert.equal(!falso.ok && falso.status, 400);
  const atras = await guardarCorrida(db, U, { ...e, generacion: 0 }, [], T + 3);
  assert.equal(!atras.ok && atras.status, 409);
  assert.equal((await guardarCorrida(db, U, { foo: 1 }, [], T + 4)).ok, false);
});

test("aprobar exige una APTA guardada y registrada como APTA en la auditoría; revocar queda registrado", { skip: !sqlite }, async () => {
  const db = makeDb();
  await ensureSombraSchema(db);
  const e = conApta(estadoInicial(), 321);
  const P = T + GUARDAR_CADA_MS;
  assert.ok((await guardarCorrida(db, U, e, [], T)).ok);
  const sinRegistro = await aprobarGuardada(db, U, 321, T + 1);
  assert.equal(!sinRegistro.ok && sinRegistro.status, 409, "en el estado dice APTA, pero la auditoría no lo registró");
  assert.ok((await guardarCorrida(db, U, e, [candidata("APTA", 321)], P)).ok);
  assert.equal((await aprobarGuardada(db, U, 999, P + 1)).ok, false);
  const ok = await aprobarGuardada(db, U, 321, P + 2);
  assert.ok(ok.ok);
  assert.deepEqual((await leerSombra(db, U)).estado?.aprobada, { indice: 321, aprobadaA: P + 2 });
  assert.equal((await aprobarGuardada(db, U, 321, P + 3)).ok, false, "de a una");
  assert.ok((await revocarGuardada(db, U, "la reviso", P + 4)).ok);
  assert.equal((await leerSombra(db, U)).estado?.aprobada, null);
  const tipos = (await listarEventos(db, U)).map((x) => x.tipo);
  assert.deepEqual(tipos.slice(0, 2), ["REVOCACION", "APROBACION"]);
  assert.ok((await verificarCadena(await listarEventos(db, U))).ok);
  assert.equal((await listarEventos(db, 8)).length, 0, "cada cuenta ve solo lo suyo");
});

test("guarda una corrida cada 30 segundos como mucho: la cuota de D1 es una sola para toda la app", { skip: !sqlite }, async () => {
  const db = makeDb();
  await ensureSombraSchema(db);
  const e = { ...estadoInicial(), generacion: 6 };
  assert.ok((await guardarCorrida(db, U, e, [], T)).ok);
  const pronto = await guardarCorrida(db, U, e, [candidata("CANDIDATA", 9)], T + GUARDAR_CADA_MS - 1);
  assert.equal(!pronto.ok && pronto.status, 429);
  assert.match(!pronto.ok ? pronto.error : "", /se vuelve a intentar sola/);
  assert.equal((await leerSombra(db, U)).seq, 0, "lo rechazado no se registró");
  assert.ok((await guardarCorrida(db, U, e, [candidata("CANDIDATA", 9)], T + GUARDAR_CADA_MS)).ok);
  assert.equal((await leerSombra(db, U)).seq, 1);
});

test("aprobar mira el último estado registrado: una APTA que volvió a observación no se aprueba", { skip: !sqlite }, async () => {
  const db = makeDb();
  await ensureSombraSchema(db);
  const e = conApta(estadoInicial(), 321);
  assert.ok((await guardarCorrida(db, U, e, [candidata("APTA", 321)], T)).ok);
  const observacion = { tipo: "OBSERVACION", datos: { variante: "V-321", indice: 321 } };
  assert.ok((await guardarCorrida(db, U, e, [observacion], T + GUARDAR_CADA_MS)).ok);
  const r = await aprobarGuardada(db, U, 321, T + GUARDAR_CADA_MS + 1);
  assert.equal(!r.ok && r.status, 409, "fue APTA alguna vez, pero lo último registrado es que volvió a observación");
  assert.match(!r.ok ? r.error : "", /en observación/);
  assert.ok((await guardarCorrida(db, U, e, [candidata("APTA", 321)], T + 2 * GUARDAR_CADA_MS)).ok);
  assert.ok((await aprobarGuardada(db, U, 321, T + 2 * GUARDAR_CADA_MS + 1)).ok, "vuelve a estar APTA: ahora sí");
  assert.ok((await verificarCadena(await listarEventos(db, U))).ok);
});
