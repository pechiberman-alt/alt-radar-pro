// Pruebas del aprendizaje diario (lib/aprendizaje-diario.ts): días de Argentina, lo del día y lo de todo el registro hasta ese
// día, comparaciones con su muestra (firmes solo con 15 de cada lado), novedades, que un cierre posterior no cambia un día ya
// pasado (no mira el futuro), y el texto de Telegram.
import assert from "node:assert/strict";
import test from "node:test";
import { armarDiario, diaAnterior, diaAr, leerDiario, limitesDia, textoDiarioTelegram, ultimosDiarios } from "../lib/aprendizaje-diario.ts";
import { esHoraDelDiario } from "../lib/aprendizaje-diario-db.ts";
import type { FilaOficina } from "../lib/oficina.ts";
import { contar, estadistica } from "../lib/registro.ts";

const H = 3_600_000;
const DIA = "2026-10-20";
const { desde } = limitesDia(DIA);
const foto = (detras: number, liquidezStop: boolean, acuerdo = 0) => JSON.stringify({ acuerdo, contra: 0, con: [], mapa: { v: 1, detras, delante: null, liquidezStop, motivos: [] } });
let n = 0;
const fila = (est: string, r: number | null, cerrada: number | null, f: string | null = null, symbol = "BTCUSDT"): FilaOficina => ({
  clave: `sv:${est}:${symbol}:4h:LONG:${(n += 1)}`,
  symbol,
  lado: "LONG",
  r,
  desenlace: r === null ? "ABIERTA" : r > 0 ? "TP3" : "SL",
  cerrada,
  detectada: (cerrada ?? desde) - 10 * H,
  foto: f,
});

test("los días son de Argentina (UTC−3) y el cron del diario corre a las 00:15 de acá", () => {
  assert.equal(diaAr(Date.parse("2026-10-20T03:00:00Z")), "2026-10-20");
  assert.equal(diaAr(Date.parse("2026-10-20T02:59:00Z")), "2026-10-19");
  assert.equal(desde, Date.parse("2026-10-20T03:00:00Z"));
  assert.equal(diaAnterior(DIA), "2026-10-19");
  assert.equal(esHoraDelDiario(Date.parse("2026-10-21T03:15:00Z")), true);
  assert.equal(esHoraDelDiario(Date.parse("2026-10-21T03:30:00Z")), false);
});

test("el día cuenta lo cerrado ese día; el total, todo hasta el final del día, con las cuentas del registro", () => {
  const filas = [
    fila("RSI", 1.9, desde + 2 * H, foto(2, false)),
    fila("MACD", -1, desde + 5 * H, foto(0, true)),
    fila("RSI", -1, desde - 5 * H, foto(0, true)), // el día anterior
    fila("RSI", null, null), // abierta
  ];
  const d = armarDiario(filas, DIA, "PLAN_SERVIDOR_1");
  assert.equal(d.delDia.cierres, 2);
  assert.equal(d.delDia.ganadoras, 1);
  assert.equal(d.delDia.netoR, 0.9);
  assert.deepEqual(d.delDia.mejor, { agente: "Reversión", symbol: "BTCUSDT", r: 1.9 });
  assert.equal(d.delDia.peor?.r, -1);
  assert.deepEqual(d.total, estadistica(contar([{ r: 1.9, abierta: false }, { r: -1, abierta: false }, { r: -1, abierta: false }])));
  assert.equal(d.conFoto, 3);
  const detras = d.comparaciones.find((c) => c.tema === "DETRAS")!;
  assert.equal(detras.si.est.cerradas, 1);
  assert.equal(detras.no.est.cerradas, 2);
  assert.equal(detras.firme, false);
  assert.match(detras.texto, /muestra mínima/);
  assert.ok(d.novedades.some((x) => /Momento cerró su primera operación/.test(x)), "MACD cerró por primera vez ese día");
  assert.ok(!d.novedades.some((x) => /Reversión cerró su primera/.test(x)), "RSI ya había cerrado antes");
});

test("una comparación es firme solo con 15 cierres de cada lado, y avisa el día que se hace firme", () => {
  const filas: FilaOficina[] = [];
  for (let k = 0; k < 15; k += 1) filas.push(fila("SNR", k % 3 ? -1 : 2, desde - (k + 1) * H, foto(0, true)));
  for (let k = 0; k < 14; k += 1) filas.push(fila("SNR", k % 2 ? -1 : 2, desde - (k + 20) * H, foto(0, false)));
  const antes = armarDiario(filas, DIA, "P");
  assert.equal(antes.comparaciones.find((c) => c.tema === "LIQUIDEZ")!.firme, false);
  filas.push(fila("SNR", 2, desde + H, foto(0, false)));
  const d = armarDiario(filas, DIA, "P");
  const liq = d.comparaciones.find((c) => c.tema === "LIQUIDEZ")!;
  assert.equal(liq.firme, true);
  assert.equal(liq.si.est.cerradas, 15);
  assert.equal(liq.no.est.cerradas, 15);
  assert.ok(d.novedades.some((x) => x.startsWith("Se hizo firme:")));
});

test("no mira el futuro: un cierre de un día posterior no cambia el diario de un día ya pasado", () => {
  const filas = [fila("RSI", 1.9, desde + 2 * H, foto(2, false)), fila("MACD", -1, desde + 5 * H, foto(0, true))];
  const antes = armarDiario(filas, DIA, "P");
  const despues = armarDiario([...filas, fila("RSI", -1, desde + 30 * H, foto(3, true, 2))], DIA, "P");
  assert.deepEqual(despues, antes);
  const semana = ultimosDiarios(filas, "2026-10-22", "P", 3);
  assert.deepEqual(semana.map((x) => x.dia), ["2026-10-22", "2026-10-21", "2026-10-20"]);
  assert.equal(semana[0].delDia.cierres, 0);
  assert.match(semana[0].novedades[0], /no cerró ninguna/);
});

test("sin foto del mapa no se compara por el mapa (desconocido no es cero), y el diario se lee de vuelta con su forma", () => {
  const d = armarDiario([fila("RSI", 1.9, desde + 2 * H, null)], DIA, "P");
  assert.equal(d.conFoto, 0);
  assert.equal(d.comparaciones.find((c) => c.tema === "DETRAS")!.si.est.cerradas + d.comparaciones.find((c) => c.tema === "DETRAS")!.no.est.cerradas, 0);
  assert.deepEqual(leerDiario(JSON.parse(JSON.stringify(d))), d);
  assert.equal(leerDiario({ ...d, v: 2 }), null);
  assert.equal(leerDiario({ ...d, dia: "ayer" }), null);
  const tg = textoDiarioTelegram(d);
  assert.match(tg, /Diario de la oficina · 20\/10/);
  assert.match(tg, /No es asesoramiento financiero/);
  assert.match(textoDiarioTelegram(null), /Todavía no hay diario/);
});
