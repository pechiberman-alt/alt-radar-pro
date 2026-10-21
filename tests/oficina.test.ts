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
  assert.ok(o.escritorios.every((e) => ["TENDENCIA", "REVERSION", "ESTRUCTURA", "FLUJO", "METALES"].includes(mesaDe(e.id))));
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

test("el plan del servidor: lee sus claves, no tiene el agente ST, y habla por Telegram y con la IA con sus datos", async () => {
  const { oficinaParaIa, textoOficinaTelegram, textoAgenteTelegram, buscarAgente } = await import("../lib/oficina.ts");
  const { parseCommand } = await import("../lib/telegram.ts");
  const filas = [
    f("sv:AMD_IFVG:SOLUSDT:4h:LONG:1", "ABIERTA", null, null, "SOLUSDT"),
    f("sv:RSI:BTCUSDT:4h:SHORT:2", "TP3", 1.9, H),
    f("st:BTCUSDT:4h:LONG:3", "TP3", 2, H),
  ];
  const o = armarOficina(filas, AHORA, "SERVIDOR");
  assert.ok(!o.escritorios.some((e) => e.id === ID_ST), "el agente ST no corre en el servidor");
  assert.deepEqual(o.escritorios.find((e) => e.id === "AMD_IFVG")!.abiertas.map((a) => a.symbol), ["SOLUSDT"]);
  assert.equal(o.escritorios.find((e) => e.id === "RSI")!.total.neto, 1.9);
  const ia = oficinaParaIa(o, "SERVIDOR") as { escritorios: { agente: string; netoR: unknown }[]; plan: string };
  assert.match(ia.plan, /Kraken/);
  assert.equal(ia.escritorios.find((e) => e.agente === "Agente Reversión")!.netoR, "1,9", "los números llegan en formato argentino");
  const tg = textoOficinaTelegram(o);
  assert.match(tg, /AMD \+ IFVG · SOL ▲/);
  assert.match(tg, /No es asesoramiento financiero/);
  assert.match(textoAgenteTelegram(o, "amd"), /Agente AMD \+ IFVG/);
  assert.match(textoAgenteTelegram(o, "nadie"), /No encontré ese agente/);
  assert.equal(buscarAgente(o, "REVERSIÓN")?.id, buscarAgente(o, "reversion")?.id, "sin importar acentos ni mayúsculas");
  assert.match(textoOficinaTelegram(armarOficina(null, AHORA, "SERVIDOR")), /sin datos/);
  assert.deepEqual(parseCommand("/oficina"), { cmd: "oficina", arg: "" });
  assert.deepEqual(parseCommand("/agente amd"), { cmd: "agente", arg: "amd" });
});

test("PnL simulado: USD 1.000 por agente y 1 % por operación, como el registro; el fondo suma a todos y su curva va en orden de cierre", async () => {
  const { usdTxt, textoOficinaTelegram } = await import("../lib/oficina.ts");
  const { CAPITAL_INICIAL_USD, RIESGO_POR_OPERACION_PCT } = await import("../lib/registro.ts");
  const uno = (CAPITAL_INICIAL_USD * RIESGO_POR_OPERACION_PCT) / 100;
  const filas = [
    f("sv:RSI:BTCUSDT:4h:LONG:1", "TP3", 2, 3 * H),
    f("sv:MACD:BTCUSDT:4h:LONG:2", "SL", -1, 2 * H),
    f("sv:RSI:ETHUSDT:4h:LONG:3", "SL", -1, H),
    f("sv:RSI:SOLUSDT:4h:LONG:4", "ABIERTA", null, null),
  ];
  const o = armarOficina(filas, AHORA, "SERVIDOR");
  const rsi = o.escritorios.find((e) => e.id === "RSI")!;
  assert.equal(rsi.capital.netoUsd, 1 * uno, "2 − 1 = 1 R");
  assert.equal(rsi.capital.actualUsd, CAPITAL_INICIAL_USD + uno);
  assert.equal(o.fondo.agentes, o.escritorios.length);
  assert.equal(o.fondo.inicialUsd, o.escritorios.length * CAPITAL_INICIAL_USD);
  assert.equal(o.fondo.netoUsd, 0, "RSI +1 R y MACD −1 R");
  assert.equal(o.fondo.cierres, 3, "la abierta no cuenta");
  const i = o.fondo.inicialUsd;
  assert.deepEqual(o.fondo.curva, [i, i + 2 * uno, i + uno, i], "en el orden en que cerraron");
  assert.equal(o.fondo.maxCaidaUsd, 2 * uno);
  assert.match(textoOficinaTelegram(o), /Fondo simulado/);
  assert.equal(usdTxt(1234.5, true), "+USD 1.234,50");
  assert.equal(usdTxt(-10, true), "−USD 10,00");
  const vacia = armarOficina(null, AHORA, "SERVIDOR");
  assert.equal(vacia.fondo.cierres, 0);
  assert.equal(vacia.fondo.maxCaidaPct, null, "sin cierres no hay caída: desconocido, no cero");
});

