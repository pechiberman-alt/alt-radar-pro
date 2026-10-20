// Pruebas de la oficina del fondo (lib/oficina.ts): un escritorio por agente de papel (sin el control al azar), las cuentas por
// agente salen del registro unificado, la semana son los últimos 7 días, sin datos no es cero, y el tope se dice.
import assert from "node:assert/strict";
import test from "node:test";
import { ESTRATEGIAS } from "../lib/estrategias.ts";
import { agenteDeClave, armarOficina, ID_ST, LIMITE_OFICINA, mesaDe, nombreActivo, SEMANA_MS, type FilaOficina } from "../lib/oficina.ts";
import { contar, estadistica } from "../lib/registro.ts";

const AHORA = Date.UTC(2026, 9, 20, 12);
const H = 3_600_000;
const f = (clave: string, desenlace: string, r: number | null, cerradaHace: number | null, symbol = "BTCUSDT"): FilaOficina => ({
  clave, symbol, lado: "LONG", r, desenlace, cerrada: cerradaHace === null ? null : AHORA - cerradaHace, detectada: AHORA - 10 * SEMANA_MS,
});

test("hay un escritorio por agente del estudio (sin el azar) más el agente ST, y todos tienen mesa", () => {
  const o = armarOficina([], AHORA);
  const ids = o.escritorios.map((e) => e.id);
  for (const e of ESTRATEGIAS) assert.equal(ids.includes(e.id), e.id !== "AZAR", e.id);
  assert.ok(ids.includes(ID_ST));
  assert.ok(ids.includes("AMD_IFVG"));
  assert.ok(o.escritorios.every((e) => ["TENDENCIA", "REVERSION", "ESTRUCTURA"].includes(mesaDe(e.id))));
});

test("las claves se leen al agente correcto; una clave desconocida no se cuenta", () => {
  assert.equal(agenteDeClave("ag:AMD_IFVG:XAGUSDT:4h:SHORT:1700000000000"), "AMD_IFVG");
  assert.equal(agenteDeClave("st:BTCUSDT:4h:LONG:1700000000000"), ID_ST);
  assert.equal(agenteDeClave("otra:cosa"), null);
});

test("las cuentas de cada escritorio son las del registro unificado, y la semana solo lo cerrado en 7 días", () => {
  const filas = [
    f("ag:AMD_IFVG:BTCUSDT:4h:LONG:1", "TP3", 2, H),
    f("ag:AMD_IFVG:ETHUSDT:4h:LONG:2", "SL", -1, 2 * SEMANA_MS),
    f("ag:AMD_IFVG:XAGUSDT:4h:LONG:3", "ABIERTA", null, null, "XAGUSDT"),
    f("x:basura", "TP3", 5, H),
  ];
  const o = armarOficina(filas, AHORA);
  const amd = o.escritorios.find((e) => e.id === "AMD_IFVG")!;
  assert.deepEqual(amd.total, estadistica(contar([{ r: 2, abierta: false }, { r: -1, abierta: false }, { r: null, abierta: true }])));
  assert.equal(amd.semana.cerradas, 1);
  assert.equal(amd.semana.neto, 2);
  assert.equal(amd.total.muestra, "MINIMA");
  assert.deepEqual(amd.abiertas.map((a) => a.symbol), ["XAGUSDT"]);
  assert.deepEqual(o.reunion.map((e) => e.id), ["AMD_IFVG"]);
  assert.equal(o.sinMovimiento, o.escritorios.length - 1);
});

test("sin poder leer, los escritorios están pero sin datos; al tope de lectura se avisa", () => {
  const sin = armarOficina(null, AHORA);
  assert.equal(sin.sinDatos, true);
  assert.ok(sin.escritorios.every((e) => e.total.cerradas === 0 && e.total.winRate === null));
  const muchas = Array.from({ length: LIMITE_OFICINA }, (_, k) => f(`ag:RSI:BTCUSDT:4h:LONG:${k + 1}`, "SL", -1, H));
  assert.equal(armarOficina(muchas, AHORA).incompleta, true);
});

test("los metales se nombran por su nombre", () => {
  assert.equal(nombreActivo("XAUUSDT"), "Oro");
  assert.equal(nombreActivo("XAGUSDT"), "Plata");
  assert.equal(nombreActivo("SOLUSDT"), "SOL");
});

test("la charla sale de los datos: coincidencias, desacuerdos y resultados con su muestra; nadie inventa", async () => {
  const { charla, propuestas, acuerdoDe, tituloSemana } = await import("../lib/oficina.ts");
  const ab = (est: string, symbol: string, lado: string, n: number): FilaOficina => ({ clave: `ag:${est}:${symbol}:4h:${lado}:${n}`, symbol, lado, r: null, desenlace: "ABIERTA", cerrada: null, detectada: AHORA - n });
  const filas = [
    ab("MACD", "TRXUSDT", "SHORT", 1), ab("RETROCESO", "TRXUSDT", "SHORT", 2),
    ab("RSI", "BCHUSDT", "LONG", 3), ab("SNR", "BCHUSDT", "SHORT", 4),
    ...Array.from({ length: 15 }, (_, k) => ({ ...f(`ag:BOLLINGER:BTCUSDT:4h:LONG:${10 + k}`, "SL", -1, H), foto: JSON.stringify({ acuerdo: k % 2, contra: 0, con: [] }) })),
  ];
  const o = armarOficina(filas, AHORA);
  const frases = charla(o);
  assert.ok(frases.some((x) => x.tipo === "acuerdo" && x.texto.includes("TRX corto")));
  assert.ok(frases.some((x) => x.tipo === "debate" && x.texto.includes("BCH")));
  assert.ok(frases.some((x) => x.quien === "BOLLINGER" && x.texto.includes("15 cierres") && x.texto.includes("Que me revisen")));
  assert.ok(frases.some((x) => x.quien === "JARVIS" && x.tipo === "aprendizaje"));
  // Con 15 cierres perdedores hay propuesta para la persona; nunca se aplica sola (es solo texto).
  assert.deepEqual(propuestas(o).map((p) => p.quien), ["BOLLINGER"]);
  // El consenso: 8 solitarias y 7 acompañadas no alcanzan la muestra mínima de cada lado.
  assert.equal(o.aprendizaje.muestraMinima, true);
  assert.equal(acuerdoDe('{"acuerdo":2}'), 2);
  assert.equal(acuerdoDe("{}"), null);
  assert.equal(acuerdoDe("no es json"), null);
  const perdedor = o.escritorios.find((e) => e.id === "BOLLINGER")!;
  assert.match(tituloSemana(perdedor), /menos perdió/);
});
