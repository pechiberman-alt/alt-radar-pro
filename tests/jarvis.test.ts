import assert from "node:assert/strict";
import test from "node:test";
import { briefingText, findCoins, findTimeframe, greeting, normalize, parseCommand, priceLine } from "../lib/jarvis.ts";

const KNOWN = new Set(["BTC", "ETH", "SOL", "PEPE", "WIF", "ORDI"]);

test("normalize strips accents, punctuation and the case", () => {
  assert.equal(normalize("¿Cómo está el MERCADO, Jarvis?"), "como esta el mercado jarvis");
});

test("coins by name, ticker or alias; ambiguous Spanish words need a cue", () => {
  assert.deepEqual(findCoins("precio de bitcoin y ethereum"), ["BTC", "ETH"]);
  assert.deepEqual(findCoins("abrí wif", KNOWN), ["WIF"]);
  assert.deepEqual(findCoins("cuánto está el oro"), ["XAU"]);
  assert.deepEqual(findCoins("hace mucho sol hoy en la ciudad"), [], "the sun is not Solana");
  assert.deepEqual(findCoins("precio de sol"), ["SOL"]);
});

test("timeframes in words or short form", () => {
  assert.equal(findTimeframe("en 15 minutos"), "15m");
  assert.equal(findTimeframe("en cuatro horas"), "4h");
  assert.equal(findTimeframe("grafico 1h"), "1h");
  assert.equal(findTimeframe("en diario"), "1d");
  assert.equal(findTimeframe("nada"), null);
});

test("commands", () => {
  assert.deepEqual(parseCommand("Jarvis, informe del mercado"), { kind: "BRIEFING" });
  assert.deepEqual(parseCommand("buenas noches jarvis"), { kind: "BRIEFING" });
  assert.deepEqual(parseCommand("¿Cuánto está Bitcoin?"), { kind: "PRICE", symbols: ["BTC"] });
  assert.deepEqual(parseCommand("abrí el mapa de solana en 15 minutos"), { kind: "MAP", symbol: "SOL", timeframe: "15m" });
  assert.deepEqual(parseCommand("mostrame pepe", KNOWN), { kind: "MAP", symbol: "PEPE", timeframe: null });
  assert.deepEqual(parseCommand("¿Qué está por romper en 4 horas?"), { kind: "BREAKOUTS", timeframe: "4h" });
  assert.deepEqual(parseCommand("qué está subiendo"), { kind: "MOVERS" });
  assert.deepEqual(parseCommand("abrí las señales"), { kind: "SECTION", section: "inteligencia", label: "SEÑALES · ROBOT MM" });
  assert.deepEqual(parseCommand("diario"), { kind: "SECTION", section: "diario", label: "DIARIO" });
  assert.deepEqual(parseCommand("llamame Uri"), { kind: "NAME", name: "Uri" });
  assert.deepEqual(parseCommand("silencio"), { kind: "STOP" });
  assert.deepEqual(parseCommand("Jarvis, ¿cómo vienen tus señales?"), { kind: "STATS" });
  assert.deepEqual(parseCommand("decime tu win rate y profit factor"), { kind: "STATS" });
  assert.deepEqual(parseCommand("Jarvis, ¿qué aprendiste?"), { kind: "LEARN" });
  assert.deepEqual(parseCommand("mostrame el aprendizaje"), { kind: "LEARN" });
  assert.deepEqual(parseCommand("estado del núcleo"), { kind: "CORE" });
  assert.deepEqual(parseCommand("¿qué hiciste mientras no estaba?"), { kind: "CORE" });
  assert.deepEqual(parseCommand("¿qué podés hacer?"), { kind: "HELP" });
  assert.deepEqual(parseCommand("Jarvis, ¿conviene entrar en largo si el funding está alto?"), { kind: "AI", question: "¿conviene entrar en largo si el funding está alto?" });
});

test("greeting by the hour", () => {
  assert.equal(greeting(8, "Uri"), "Buenos días, Uri.");
  assert.equal(greeting(15, "señor"), "Buenas tardes, señor.");
  assert.equal(greeting(23, "Uri"), "Buenas noches, Uri.");
  assert.equal(greeting(3, "Uri"), "Buenas noches, Uri.");
});

test("price line and briefing read like speech", () => {
  assert.equal(priceLine({ symbol: "BTCUSDT", price: 84321.5, change: -1.24, quoteVolume: 1e9 }), "BTC está en 84.322 dólares, baja 1,2 por ciento en 24 horas.");
  const alts = Array.from({ length: 12 }, (_, i) => ({ symbol: `A${i}USDT`, price: 1, change: i < 9 ? 2 + i : -1, quoteVolume: 5e7 }));
  const text = briefingText({
    hour: 21, name: "Uri",
    tickers: [{ symbol: "BTCUSDT", price: 84000, change: 1, quoteVolume: 1e9 }, { symbol: "ETHUSDT", price: 2700, change: 2, quoteVolume: 1e9 }, ...alts],
    breakouts: [{ symbol: "NEARUSDT", side: "ALCISTA", score: 78 }],
  });
  assert.match(text, /^Buenas noches, Uri\./);
  assert.match(text, /BTC está en 84\.000 dólares, sube 1,0 por ciento/);
  assert.match(text, /El mercado está fuerte: 75 por ciento/);
  assert.match(text, /Las que más suben: A8 10,0 por ciento/);
  assert.match(text, /A punto de romper: NEAR hacia arriba/);
  assert.match(text, /uno por ciento por operación/);
  assert.match(briefingText({ hour: 9, name: "señor", tickers: [], breakouts: [] }), /Ninguna de las principales/);
});
