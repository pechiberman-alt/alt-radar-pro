// Pruebas de la mente de los agentes (lib/agentes-mente.ts): las lecciones salen de sus cierres con su muestra y solo son
// firmes con 15 casos de cada lado; la autoevaluación dice que no sabe cuando no tiene muestra; las conversaciones salen de
// los datos; y el ranking de la oficina premia la muestra, no la suerte.
import assert from "node:assert/strict";
import test from "node:test";
import { concienciaDe, conversaciones, leccionesDe, type FilaAgente } from "../lib/agentes-mente.ts";
import { armarOficina, type FilaOficina } from "../lib/oficina.ts";
import { contar, estadistica } from "../lib/registro.ts";

const cierre = (symbol: string, lado: string, r: number, k: number, acuerdo?: number): FilaAgente => ({
  symbol, lado, r, desenlace: r > 0 ? "TP3" : "SL", cerrada: 1_700_000_000_000 + k, foto: acuerdo === undefined ? null : JSON.stringify({ acuerdo }),
});

test("sin cierres o con pocos, la lección es que todavía no sabe; nada es firme", () => {
  assert.match(leccionesDe([])[0].texto, /no sé nada de mí/);
  const pocas = leccionesDe([cierre("BTCUSDT", "LONG", 2, 1), cierre("BTCUSDT", "SHORT", -1, 2)]);
  assert.ok(pocas.some((l) => l.tema === "MUESTRA" && /me faltan 13/.test(l.texto)));
  assert.ok(pocas.every((l) => !l.firme));
  const lado = pocas.find((l) => l.tema === "LADO")!;
  assert.match(lado.texto, /n=1, muestra mínima/);
});

test("con 15 de cada lado, la lección de largos contra cortos es firme, y los números son los del registro", () => {
  const fs = [
    ...Array.from({ length: 15 }, (_, k) => cierre("SOLUSDT", "LONG", k % 3 ? 2 : -1, k, 1)),
    ...Array.from({ length: 15 }, (_, k) => cierre("BTCUSDT", "SHORT", k % 3 ? -1 : 2, 100 + k, 0)),
  ];
  const ls = leccionesDe(fs);
  const lado = ls.find((l) => l.tema === "LADO")!;
  assert.equal(lado.firme, true);
  const e = estadistica(contar(fs.filter((f) => f.lado === "LONG").map((f) => ({ r: f.r, abierta: false }))));
  assert.ok(lado.texto.includes(`${Math.round((e.winRate ?? 0) * 100)} %`), lado.texto);
  assert.equal(ls.find((l) => l.tema === "COMPANIA")!.firme, true);
  assert.match(ls.find((l) => l.tema === "ACTIVO")!.texto, /Donde mejor me fue: SOL/);
  assert.ok(!ls.some((l) => l.tema === "MUESTRA"));
  assert.ok(ls.some((l) => l.tema === "RACHA" && /puede ser ruido/.test(l.texto)));
});

test("la autoevaluación es honesta: sin muestra dice que no sabe, y nunca promete cambiar su regla", () => {
  const vacia = estadistica(contar([]));
  assert.match(concienciaDe("Agente X", "TENDENCIA", vacia, []), /no sé si mi regla sirve/);
  const poca = estadistica(contar([{ r: 2, abierta: false }, { r: 2, abierta: false }]));
  const txt = concienciaDe("Agente X", "REVERSION", poca, []);
  assert.match(txt, /puede ser suerte/);
  assert.match(txt, /no la cambio yo/);
  const perdedora = estadistica(contar(Array.from({ length: 20 }, () => ({ r: -1, abierta: false }))));
  assert.match(concienciaDe("Agente X", "ESTRUCTURA", perdedora, []), /no me respaldan/);
});

test("conversaciones: comparan dentro de la mesa y discuten cuando apuestan al revés en el mismo activo", () => {
  const e = (id: string, mesa: "TENDENCIA" | "REVERSION" | "ESTRUCTURA", rs: number[], abiertas: { symbol: string; lado: string }[] = []) => ({
    id, agente: `Agente ${id}`, mesa, total: estadistica(contar(rs.map((r) => ({ r, abierta: false })))), lecciones: [], abiertas,
  });
  const ds = conversaciones([
    e("A", "TENDENCIA", [2, 2, -1], [{ symbol: "TRXUSDT", lado: "LONG" }]),
    e("B", "TENDENCIA", [-1, -1], [{ symbol: "TRXUSDT", lado: "SHORT" }]),
    e("C", "REVERSION", []),
  ]);
  const mesa = ds.find((d) => d.tema === "Mesa de tendencia")!;
  assert.equal(mesa.lineas[0].quien, "A");
  assert.match(mesa.lineas[2].texto, /puede ser suerte/);
  assert.ok(ds.some((d) => d.tema === "Debate en TRX"));
  assert.ok(!ds.some((d) => d.tema === "Mesa de reversión"), "sin cierres no hay de qué hablar");
});

test("el ranking premia la muestra: 30 de 50 va antes que 2 de 2", () => {
  const AHORA = 1_800_000_000_000;
  const f = (est: string, r: number, k: number): FilaOficina => ({ clave: `sv:${est}:BTCUSDT:4h:LONG:${k}`, symbol: "BTCUSDT", lado: "LONG", r, desenlace: r > 0 ? "TP3" : "SL", cerrada: AHORA - 1000, detectada: AHORA - 5000 - k });
  const filas = [
    ...[1, 2].map((k) => f("RSI", 2, k)),
    ...Array.from({ length: 50 }, (_, k) => f("MACD", k < 30 ? 2 : -1, 10 + k)),
  ];
  const o = armarOficina(filas, AHORA, "SERVIDOR");
  assert.deepEqual(o.ranking.map((e) => e.id), ["MACD", "RSI"]);
  const rsi = o.escritorios.find((e) => e.id === "RSI")!;
  assert.equal(rsi.total.winRate, 1);
  assert.equal(rsi.total.muestra, "MINIMA");
  assert.match(rsi.conciencia, /puede ser suerte/);
});
