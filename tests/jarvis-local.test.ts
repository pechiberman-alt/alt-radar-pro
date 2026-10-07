import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantContext } from "../lib/assistant/index.ts";
import { briefForAi, briefText, coinBrief, localAnswer, pointsAtScreen, withFocus, type Focus } from "../lib/jarvis-local.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";
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

test("a coin's brief never reads the candle still forming (no lookahead)", () => {
  const closed = setupAt(300, 299);
  const lastOpen = closed[closed.length - 1].openTime;
  const now = lastOpen + H + 60_000;
  // The candle that opened an hour after the last closed one is still forming at `now`, and it is wild.
  const forming: SwingCandle = { openTime: lastOpen + H, open: 110, high: 190, low: 40, close: 180, volume: 1e9, quoteVolume: 1e9 };
  const a = coinBrief("BTCUSDT", closed, now)!;
  const b = coinBrief("BTCUSDT", [...closed, forming], now)!;
  assert.deepEqual(b, a, "the forming candle changes nothing");
  assert.equal(a.at, lastOpen);
  assert.equal(a.price, closed[closed.length - 1].close);
  assert.equal(coinBrief("BTCUSDT", closed.slice(0, 40), now), null, "too few candles: no brief rather than a guess");
});

test("the brief in words: price, trend, range, the coil it is in, and what would change the read", () => {
  const candles = setupAt(300, 299);
  const now = candles[299].openTime + H + 1;
  const b = coinBrief("BTCUSDT", candles, now)!;
  assert.equal(b.preBreak?.state, "A PUNTO");
  const t = briefText(b);
  assert.match(t, /^BTC en 109,95/);
  assert.match(t, /Está a punto de romper hacia arriba \(presión \d+\/100/);
  assert.match(t, /Lo que cambiaría la lectura: /);
  assert.match(t, /No es asesoramiento financiero\.$/);
  const ai = briefForAi(b);
  assert.equal(ai.moneda, "BTCUSDT");
  assert.equal(ai.ultimaVelaCerrada, new Date(candles[299].openTime).toISOString());
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

test("with no AI, the local analyst answers: the coin's brief, or the section on screen", () => {
  const candles = setupAt(300, 299);
  const b = coinBrief("ETHUSDT", candles, candles[299].openTime + H + 1)!;
  assert.match(localAnswer("¿Cómo ves ETH?", { screen: "PUMPEO", symbol: "ETHUSDT", timeframe: "1h" }, ctx, b), /^ETH en /);
  assert.match(localAnswer("Analizalo", { screen: "LIQUIDACIONES", symbol: "ETHUSDT", timeframe: "1h" }, ctx, b), /^ETH en /);
  assert.match(localAnswer("Analizalo", { screen: "PUMPEO", symbol: null, timeframe: null }, ctx, null), /radar de pumpeo todavía no completó un ciclo/);
  assert.match(localAnswer("Analizalo", null, null, null), /Todavía no tengo los datos del radar/);
});
