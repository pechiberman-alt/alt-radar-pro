import assert from "node:assert/strict";
import test from "node:test";
import { ABIERTA, comisionEnR, escaleraHacia, recorrer, type Recorrido } from "../lib/escalera.ts";
import { MM_FEE_PCT, MM_HORIZON } from "../lib/mm-robot.ts";
import { MARCO_MS, MAX_RECORRIDOS, registroCsv, resumirRegistro, validarRecorrido, type RegistroRobot } from "../lib/robot-ledger.ts";
import { ENVIADA, ensureRobotLedger, guardarRecorridos, leerRegistro, listarRegistro, marcarTelegram, registrarSenal } from "../lib/robot-ledger-db.ts";
import { robotSignalKey, validateRobotSignal } from "../lib/robot-signals.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";
import { makeDb, sqlite } from "./helpers/fake-d1.ts";

const M = MARCO_MS["15m"];
const VELA = Date.UTC(2026, 9, 13, 10);
const AHORA = VELA + 100 * M;
const opts = { horizonte: MM_HORIZON, feePct: MM_FEE_PCT };
const FEE = comisionEnR(150, 147, MM_FEE_PCT);

const reg = (extra: Partial<RegistroRobot> = {}): RegistroRobot => ({
  clave: `mm:SOLUSDT:15m:${VELA}:LONG`, symbol: "SOLUSDT", timeframe: "15m", side: "LONG", vela: VELA, detectada: VELA + M, entrada: 150,
  escalera: escaleraHacia("LONG", 150, 147, 156)!, variante: "volumen", validacion: { trades: 31, profitFactor: 1.4, positive: 7, tested: 11 },
  telegram: null, recorrido: { ...ABIERTA }, fuente: null, ...extra,
});
/** Velas posteriores a la señal: [máximo, mínimo, cierre]. */
const velas = (pasos: [number, number, number][]): SwingCandle[] =>
  pasos.map(([high, low, close], i) => ({ openTime: VELA + (i + 1) * M, open: close, high, low, close, volume: 1, quoteVolume: 0 }));
const hasta = (velasTp: [number, number, number][]) => recorrer("LONG", 150, reg().escalera, VELA, velas(velasTp), M, AHORA, opts);

test("lo que resuelve el navegador pasa la revisión, y el R lo calcula el servidor, no el navegador", () => {
  const rec = hasta([[152.5, 149, 152], [154.5, 151, 154], [156.2, 153, 156]]);
  assert.equal(rec.desenlace, "TP3");
  const v = validarRecorrido(reg(), { ...rec, r: 999 }, AHORA);
  assert.ok(v.ok, v.ok ? "" : v.error);
  if (!v.ok) return;
  assert.ok(Math.abs((v.recorrido.r as number) - (2 - FEE)) < 1e-9, "el R sale de la escalera guardada");
  assert.equal(v.recorrido.salida, 156);
  const sl = hasta([[152.5, 149, 152], [151, 146.5, 147]]);
  const vsl = validarRecorrido(reg(), sl, AHORA);
  assert.ok(vsl.ok && Math.abs((vsl.recorrido.r as number) - (-1 - FEE)) < 1e-9);
});

test("rechaza lo imposible: horas fuera de lugar, objetivos salteados, el SL de la misma vela y salidas por tiempo antes de tiempo", () => {
  const rec = hasta([[152.5, 149, 152], [154.5, 151, 154], [156.2, 153, 156]]);
  const malos: [string, Recorrido][] = [
    ["antes de la primera vela", { ...rec, tp1At: VELA + M }],
    ["en el futuro", { ...rec, tp1At: AHORA + 3_600_000 }],
    ["TP2 sin TP1", { ...ABIERTA, tp2At: VELA + 3 * M }],
    ["TP3 sin TP2", { ...rec, tp2At: null }],
    ["SL con objetivo en la misma vela", { ...ABIERTA, tp1At: VELA + 3 * M, slAt: VELA + 3 * M, desenlace: "SL", cerradaA: VELA + 3 * M }],
    ["SL que cierra a otra hora", { ...ABIERTA, slAt: VELA + 3 * M, desenlace: "SL", cerradaA: VELA + 4 * M }],
    ["por tiempo antes de tiempo", { ...ABIERTA, desenlace: "TIEMPO", cerradaA: VELA + 10 * M, salida: 151 }],
    ["salida imposible", { ...ABIERTA, desenlace: "TIEMPO", cerradaA: VELA + (MM_HORIZON + 1) * M, salida: 0 }],
    ["abierta con SL", { ...ABIERTA, slAt: VELA + 2 * M }],
  ];
  for (const [nombre, r] of malos) assert.equal(validarRecorrido(reg(), r, AHORA).ok, false, nombre);
  assert.equal(validarRecorrido(reg(), { ...rec, desenlace: "GANADA" }, AHORA).ok, false, "desenlace desconocido");
  const tiempo = validarRecorrido(reg(), { ...ABIERTA, desenlace: "TIEMPO", cerradaA: VELA + (MM_HORIZON + 1) * M, salida: 151.5 }, AHORA);
  assert.ok(tiempo.ok && Math.abs((tiempo.recorrido.r as number) - (0.5 - FEE)) < 1e-9, "por tiempo, al cierre de la vela 48");
});

test("lo registrado no se reescribe: una hora ya guardada no cambia y una señal cerrada queda como está", () => {
  const conTp1 = reg({ recorrido: { ...ABIERTA, tp1At: VELA + 2 * M } });
  assert.equal(validarRecorrido(conTp1, { ...ABIERTA, tp1At: VELA + 3 * M }, AHORA).ok, false);
  assert.ok(validarRecorrido(conTp1, { ...ABIERTA, tp1At: VELA + 2 * M, tp2At: VELA + 4 * M }, AHORA).ok, "sumar un nivel nuevo sí");
  const cerrada = reg({ recorrido: { ...ABIERTA, slAt: VELA + 2 * M, desenlace: "SL", cerradaA: VELA + 2 * M, salida: 147, r: -1 } });
  assert.equal(validarRecorrido(cerrada, { ...ABIERTA }, AHORA).ok, false);
});

test("el resumen cuenta cada nivel y con menos de 15 cerradas no da porcentajes", () => {
  const cerr = (r: Partial<Recorrido>): RegistroRobot => reg({ recorrido: { ...ABIERTA, ...r } });
  const tp3 = cerr({ tp1At: 1, tp2At: 2, tp3At: 3, desenlace: "TP3", cerradaA: 3, salida: 156, r: 1.9 });
  const sl = cerr({ tp1At: 1, slAt: 4, desenlace: "SL", cerradaA: 4, salida: 147, r: -1.03 });
  const pocos = resumirRegistro([tp3, sl, reg()]);
  assert.deepEqual([pocos.cerradas, pocos.abiertas, pocos.tp1, pocos.tp2, pocos.tp3, pocos.sl], [2, 1, 2, 1, 1, 1]);
  assert.equal(pocos.tasas, null);
  assert.equal(pocos.muestra, "muestra mínima");
  assert.ok(Math.abs((pocos.rTotal as number) - 0.87) < 1e-9);
  const muchos = resumirRegistro([...Array(10).fill(tp3), ...Array(5).fill(sl)]);
  assert.equal(muchos.muestra, "muestra razonable");
  assert.deepEqual(muchos.tasas, { tp1: 100, tp2: 67, tp3: 67, sl: 33, tiempo: 0 });
  assert.equal(resumirRegistro([]).muestra, "sin datos");
});

test("el CSV trae cada nivel con su hora en UTC, decimales con coma y sin romper columnas", () => {
  const x = reg({ telegram: "enviada; a Telegram", recorrido: { ...ABIERTA, tp1At: VELA + 2 * M, tp2At: VELA + 3 * M, tp3At: VELA + 4 * M, desenlace: "TP3", cerradaA: VELA + 4 * M, salida: 156, r: 1.9667 } });
  const [head, fila] = registroCsv([x]).split("\n");
  assert.equal(head.split(";").length, fila.split(";").length);
  assert.match(fila, /^2026-10-13 10:00;SOL;15m;LONG;150;147;152;154;156;2026-10-13 10:30;2026-10-13 10:45;2026-10-13 11:00;;TP3;2026-10-13 11:00;156;1,9667;volumen;1,4;31;enviada {2}a Telegram;$/);
});

test("la base guarda cada señal con su escalera una vez, por cuenta, y la resuelve sin reescribir lo cerrado", { skip: !sqlite }, async () => {
  const db = makeDb();
  await ensureRobotLedger(db);
  const s = validateRobotSignal({ symbol: "SOLUSDT", timeframe: "15m", side: "LONG", entry: 150, stop: 147, target: 156, time: VELA, variant: "volumen", validation: { trades: 31, profitFactor: 1.4, positive: 7, tested: 11 } }, VELA + M)!;
  const a = await registrarSenal(db, 7, s, VELA + M);
  assert.deepEqual(a?.escalera, { stop: 147, tp1: 152, tp2: 154, tp3: 156 });
  const b = await registrarSenal(db, 7, s, VELA + 5 * M);
  assert.equal(b?.detectada, VELA + M, "la segunda vez no cambia nada");
  assert.equal((await listarRegistro(db, 8)).length, 0, "cada cuenta ve solo lo suyo");

  const rec = hasta([[152.5, 149, 152], [151, 146.5, 147]]);
  const g = await guardarRecorridos(db, 7, [{ clave: robotSignalKey(s), recorrido: { ...rec, r: 50 } }, { clave: "otra", recorrido: rec }], AHORA);
  assert.ok(g.ok);
  if (!g.ok) return;
  assert.equal(g.registros.length, 1);
  assert.equal(g.rechazados[0].error, "No está en tu registro.");
  const guardada = await leerRegistro(db, 7, robotSignalKey(s));
  assert.equal(guardada?.recorrido.desenlace, "SL");
  assert.ok(Math.abs((guardada?.recorrido.r as number) - (-1 - FEE)) < 1e-9, "el R lo calculó el servidor");
  assert.match(guardada?.fuente ?? "", /Binance/);
  const otraVez = await guardarRecorridos(db, 7, [{ clave: robotSignalKey(s), recorrido: { ...ABIERTA } }], AHORA);
  assert.ok(otraVez.ok && otraVez.registros.length === 0 && /no se reescribe/.test(otraVez.rechazados[0].error));
  const exceso = await guardarRecorridos(db, 7, Array(MAX_RECORRIDOS + 1).fill({ clave: "x", recorrido: rec }), AHORA);
  assert.equal(!exceso.ok && exceso.status, 400);
});

test("el aviso a Telegram queda en el registro: una vez enviada sigue «enviada»", { skip: !sqlite }, async () => {
  const db = makeDb();
  await ensureRobotLedger(db);
  const s = validateRobotSignal({ symbol: "ETHUSDT", timeframe: "1h", side: "SHORT", entry: 2500, stop: 2550, target: 2400, time: VELA, variant: "v", validation: {} }, VELA + M)!;
  await registrarSenal(db, 7, s, VELA + M);
  const clave = robotSignalKey(s);
  await marcarTelegram(db, 7, clave, "Telegram no vinculado");
  assert.equal((await leerRegistro(db, 7, clave))?.telegram, "Telegram no vinculado");
  await marcarTelegram(db, 7, clave, ENVIADA);
  await marcarTelegram(db, 7, clave, "Señales apagadas en Telegram");
  assert.equal((await leerRegistro(db, 7, clave))?.telegram, ENVIADA);
});
