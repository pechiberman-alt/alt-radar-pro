import assert from "node:assert/strict";
import test from "node:test";
import { makeDb } from "./helpers/fake-d1.ts";
import { wilson } from "../lib/jarvis-stats.ts";
import { ensureRobotLedger } from "../lib/robot-ledger-db.ts";
import { ensurePaperSchema } from "../lib/jarvis-paper-db.ts";
import { readCoreCounters } from "../lib/jarvis-core-db.ts";
import {
  conteoDeNucleo, leerRegistroUnificado, LIMITE_HISTORIA, operacionesDePapel, operacionesDeRobot,
} from "../lib/registro-db.ts";
import {
  armarRegistro, CONTEO_CERO, contar, estadistica, lineaFuente, MUESTRA_MINIMA, sumarConteos, type Conteo,
} from "../lib/registro.ts";

/**
 * El registro unificado es el único lugar que calcula el acierto, el profit factor y la expectancia. Estas pruebas
 * fijan sus reglas: un resultado cuenta una vez, las abiertas no entran al acierto, lo que no se pudo leer no es cero
 * y todo porcentaje sale con su muestra y su intervalo.
 */

const R = (...rs: (number | null)[]) => rs.map((r) => ({ r, abierta: false }));

test("counting: wins, losses and ties from R; open ones and unknown results do not count", () => {
  const c = contar([...R(2, -1, 0, 0.5), { r: null, abierta: true }, { r: 3, abierta: true }, { r: null, abierta: false }]);
  assert.equal(c.cerradas, 4, "the unknown closed result is not counted");
  assert.equal(c.ganadas, 2);
  assert.equal(c.perdidas, 1);
  assert.equal(c.empatadas, 1, "an exact zero is a tie, not a win");
  assert.equal(c.abiertas, 2, "open ones are counted apart");
  assert.ok(Math.abs(c.ganado - 2.5) < 1e-12 && c.perdido === 1 && Math.abs(c.neto - 1.5) < 1e-12);
});

test("stats: win rate, Wilson interval (same as the araña's), profit factor and expectancy", () => {
  const s = estadistica(contar(R(1, 1, 1, -1)));
  assert.equal(s.winRate, 0.75);
  const w = wilson(3, 4);
  assert.ok(w);
  assert.equal(s.intervalo!.low, w.low);
  assert.equal(s.intervalo!.high, w.high);
  assert.equal(s.profitFactor, 3);
  assert.equal(s.expectancia, 0.5);
});

test("nothing closed means no rate and no factor, never zero pretending to be a result", () => {
  const s = estadistica(CONTEO_CERO);
  assert.equal(s.winRate, null);
  assert.equal(s.intervalo, null);
  assert.equal(s.profitFactor, null);
  assert.equal(s.expectancia, null);
  assert.equal(s.muestra, "SIN DATOS");
});

test("no losses: the profit factor is not divided by zero", () => {
  const s = estadistica(contar(R(1, 2)));
  assert.equal(s.profitFactor, null);
  assert.match(lineaFuente({ ...s, id: "PAPEL", nombre: "x", ambito: "CUENTA", enTotal: true, disponible: true, incompleta: false }), /sin pérdidas/);
});

test("sample: under 15 closed is 'muestra mínima'; from 15 on, 'razonable'", () => {
  const pocas = estadistica(contar(R(...Array.from({ length: MUESTRA_MINIMA - 1 }, () => 1))));
  const justas = estadistica(contar(R(...Array.from({ length: MUESTRA_MINIMA }, () => 1))));
  assert.equal(pocas.muestra, "MINIMA");
  assert.equal(justas.muestra, "RAZONABLE");
});

test("a source that could not be read is 'sin datos', and it is left out of the total", () => {
  const ok = contar(R(1, -1));
  const reg = armarRegistro(
    [
      { id: "NUCLEO_ROMPE", conteo: ok },
      { id: "PAPEL", conteo: null },
      { id: "NUCLEO_SOMBRA", conteo: contar(R(1, 1, 1)) },
    ],
    123,
  );
  const papel = reg.fuentes.find((f) => f.id === "PAPEL")!;
  assert.equal(papel.disponible, false);
  assert.equal(papel.muestra, "SIN DATOS");
  assert.equal(papel.winRate, null);
  assert.match(lineaFuente(papel), /sin datos/);
  assert.equal(reg.total.cerradas, 2, "the shadow ones are shown but do not enter the total");
});

test("summing counters and the JARVIS mapping: resolved minus wins and losses are the ties", () => {
  const a: Conteo = { ...CONTEO_CERO, cerradas: 2, ganadas: 1, perdidas: 1, neto: 0 };
  const b: Conteo = { ...CONTEO_CERO, cerradas: 1, ganadas: 1, ganado: 2, neto: 2, abiertas: 1 };
  const sum = sumarConteos([a, b]);
  assert.equal(sum.cerradas, 3);
  assert.equal(sum.abiertas, 1);
  assert.equal(sum.ganado, 2);
  const m = conteoDeNucleo({ resolved: 5, wins: 2, losses: 2, gain: 3, loss: 2, total: 1, open: 4 });
  assert.equal(m.empatadas, 1);
  assert.equal(m.abiertas, 4);
  assert.equal(m.neto, 1);
  assert.deepEqual(conteoDeNucleo(undefined), CONTEO_CERO, "a source with no row yet is a known zero");
});

test("paper: closed with R counts, pending and open are unclosed, canceled are not operations, unreadable rows are reported", () => {
  const fila = (t: object) => ({ data: JSON.stringify(t) });
  const r = operacionesDePapel([
    fila({ estado: "CERRADA", resultadoR: 1.4 }),
    fila({ estado: "CERRADA", resultadoR: -1 }),
    fila({ estado: "ABIERTA" }),
    fila({ estado: "PENDIENTE" }),
    fila({ estado: "CANCELADA" }),
    { data: "{no es json" },
  ]);
  assert.equal(r.ilegibles, 1);
  const c = contar(r.ops);
  assert.equal(c.cerradas, 2);
  assert.equal(c.abiertas, 2);
});

test("robot: open rows are unclosed; closed rows count with their R", () => {
  const c = contar(operacionesDeRobot([{ r: null, desenlace: "ABIERTA" }, { r: 2, desenlace: "TP3" }, { r: -1, desenlace: "SL" }]));
  assert.equal(c.abiertas, 1);
  assert.equal(c.cerradas, 2);
  assert.equal(c.ganadas, 1);
});

test("the read limit is a single number the app can show", () => {
  assert.equal(LIMITE_HISTORIA, 1000);
});

test("db: JARVIS counters are read as they are; without a session the account sources are 'sin datos'", async () => {
  const db = makeDb();
  await readCoreCounters(db);
  await db.prepare(
    "INSERT INTO jarvis_core_stats (source, resolved, wins, losses, gain, loss, total, open) VALUES ('ROMPE', 4, 3, 1, 3, 1, 2, 1), ('IMÁN~SOMBRA', 2, 1, 1, 1, 1, 0, 0)",
  ).run();
  const reg = await leerRegistroUnificado(db, null, 1);
  const rompe = reg.fuentes.find((f) => f.id === "NUCLEO_ROMPE")!;
  assert.equal(rompe.cerradas, 4);
  assert.equal(rompe.winRate, 0.75);
  assert.equal(rompe.abiertas, 1);
  assert.equal(reg.fuentes.find((f) => f.id === "NUCLEO_SOMBRA")!.cerradas, 2);
  assert.equal(reg.fuentes.find((f) => f.id === "PAPEL")!.disponible, false);
  assert.equal(reg.fuentes.find((f) => f.id === "ROBOT")!.disponible, false);
  assert.equal(reg.total.cerradas, 4, "total is JARVIS taken only, while the account is not logged in");
});

test("db: a user's robot and paper rows are read from their own history, and only theirs", async () => {
  const db = makeDb();
  await ensureRobotLedger(db);
  await ensurePaperSchema(db);
  await db.prepare(
    `INSERT INTO robot_senales (user_id, clave, symbol, timeframe, side, vela, detectada, entrada, sl, tp1, tp2, tp3, variante, validacion, sl_at, tp1_at, tp2_at, tp3_at, desenlace, cerrada, salida, r, fuente)
     VALUES (7, 'a', 'BTCUSDT', '5m', 'LONG', 1, 1, 100, 99, 100.5, 101, 101.5, 'v', '{}', NULL, NULL, NULL, NULL, 'TP3', 2, 101.5, 2, 'x'),
            (7, 'b', 'BTCUSDT', '5m', 'LONG', 2, 1, 100, 99, 100.5, 101, 101.5, 'v', '{}', NULL, NULL, NULL, NULL, 'ABIERTA', NULL, NULL, NULL, NULL),
            (8, 'c', 'BTCUSDT', '5m', 'LONG', 3, 1, 100, 99, 100.5, 101, 101.5, 'v', '{}', NULL, NULL, NULL, NULL, 'SL', 4, 99, -1, 'x')`,
  ).run();
  await db.prepare(
    "INSERT INTO jarvis_paper (user_id, id, symbol, estado, abierta_a, data) VALUES (7, 'p1', 'ETHUSDT', 'CERRADA', 1, ?1), (7, 'p2', 'ETHUSDT', 'ABIERTA', 2, ?2)",
  ).bind(JSON.stringify({ estado: "CERRADA", resultadoR: 0.5 }), JSON.stringify({ estado: "ABIERTA" })).run();
  const reg = await leerRegistroUnificado(db, 7, 1);
  const robot = reg.fuentes.find((f) => f.id === "ROBOT")!;
  assert.equal(robot.cerradas, 1, "the other user's SL is not theirs");
  assert.equal(robot.abiertas, 1);
  assert.equal(robot.winRate, 1);
  const papel = reg.fuentes.find((f) => f.id === "PAPEL")!;
  assert.equal(papel.cerradas, 1);
  assert.equal(papel.abiertas, 1);
  assert.equal(papel.incompleta, false);
});
