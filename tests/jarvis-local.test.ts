import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantContext } from "../lib/assistant/index.ts";
import { analysisText, analyzeAsset } from "../lib/jarvis-analyst.ts";
import { localAnswer, pointsAtScreen, withFocus, type Focus } from "../lib/jarvis-local.ts";
import { setupAt } from "./helpers/setups.ts";

const H = 3_600_000;

test("'analizalo' and friends point at the screen; a full question does not", () => {
  for (const q of ["Analizalo", "analizá esto", "¿Qué ves?", "qué opinás de esto", "Explicame lo que veo", "resumime"]) assert.ok(pointsAtScreen(q), q);
  for (const q of ["¿Cómo está la dominancia de BTC?", "¿Qué es el funding?", "Dame un resumen del mercado de hoy con todas las monedas que subieron"]) assert.ok(!pointsAtScreen(q), q);
});

test("the screen made explicit: the PUMP tab, the map of the coin in focus, or nothing to add", () => {
  const pump: Focus = { screen: "PUMPEO", symbol: "BTCUSDT", timeframe: "1h" };
  assert.deepEqual(withFocus("Analizalo", pump), {
    question: "Analizalo — se refiere a el radar de pumpeo (monedas con volumen y rango anormales y su etapa).",
    about: "el radar de pumpeo (monedas con volumen y rango anormales y su etapa)",
  });
  const map: Focus = { screen: "LIQUIDACIONES", symbol: "SOLUSDT", timeframe: "15m" };
  assert.equal(withFocus("¿Qué ves?", map).about, "SOL en 15m (su mapa de liquidaciones está en pantalla)");
  assert.equal(withFocus("¿Qué es el funding?", pump).about, null, "a real question is left as asked");
  assert.equal(withFocus("Analizalo", null).about, null);
});

const ctx = {
  timestamp: new Date(0).toISOString(),
  market: [],
  scored: [],
  altseason: { final: null, raw: null, state: "NEUTRAL", adjustment: 0 },
  risk: { score: null, level: "BAJO", killSwitch: false },
  structure: null,
  pumps: [],
} as unknown as AssistantContext;

test("with no AI, the local analyst answers: the asset's full report, or the section on screen", () => {
  const candles = setupAt(1000, 999);
  const report = analysisText(analyzeAsset("ETHUSDT", { h1: candles }, candles[999].openTime + H + 1)!);
  assert.match(localAnswer("¿Cómo ves ETH?", { screen: "PUMPEO", symbol: "ETHUSDT", timeframe: "1h" }, ctx, report), /^ETH · /);
  assert.match(localAnswer("Analizalo", { screen: "LIQUIDACIONES", symbol: "ETHUSDT", timeframe: "1h" }, ctx, report), /^ETH · /);
  assert.match(localAnswer("Analizalo", { screen: "PUMPEO", symbol: null, timeframe: null }, ctx, null), /radar de pumpeo todavía no completó un ciclo/);
  assert.match(localAnswer("Analizalo", null, null, null), /Todavía no tengo los datos del radar/);
});
