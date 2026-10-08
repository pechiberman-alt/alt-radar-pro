import assert from "node:assert/strict";
import test from "node:test";
import { briefingText, findCoins, findTimeframe, greeting, normalize, parseCommand, priceLine, spokenLevel, backtestDays } from "../lib/jarvis.ts";

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

test("JARVIS TRADING: the questions of the desk reach the desk", () => {
  assert.deepEqual(parseCommand("Analizame BTC"), { kind: "DESK", symbol: "BTC" });
  assert.deepEqual(parseCommand("Jarvis, análisis completo"), { kind: "DESK", symbol: null });
  assert.deepEqual(parseCommand("¿Dónde entrarías?"), { kind: "ENTRY", symbol: null });
  assert.deepEqual(parseCommand("dame un plan de trading en sol"), { kind: "ENTRY", symbol: "SOL" });
  assert.deepEqual(parseCommand("¿Qué pasa si pierde 110.000?"), { kind: "WHATIF", symbol: null, level: 110_000 });
  assert.deepEqual(parseCommand("y si BTC rompe los 125 mil"), { kind: "WHATIF", symbol: "BTC", level: 125_000 });
  assert.deepEqual(parseCommand("¿Está más fuerte ETH que BTC?"), { kind: "COMPARE", a: "ETH", b: "BTC" });
  assert.deepEqual(parseCommand("Comparame BTC vs ETH"), { kind: "COMPARE", a: "BTC", b: "ETH" });
  assert.deepEqual(parseCommand("¿Qué opinan los indicadores?"), { kind: "INDICATORS", symbol: null });
  assert.deepEqual(parseCommand("¿Hay riesgo de liquidaciones?"), { kind: "LIQ_RISK", symbol: null });
  assert.deepEqual(parseCommand("¿Qué pasa si sale un CPI peor de lo esperado?"), { kind: "MACRO", question: "¿Qué pasa si sale un CPI peor de lo esperado?" });
  assert.deepEqual(parseCommand("abrí jarvis trading"), { kind: "SECTION", section: "jarvis-trading", label: "JARVIS TRADING" });
  // A conversation about an asset still goes to the AI, with the desk's numbers as context.
  assert.deepEqual(parseCommand("¿cómo ves SOL?"), { kind: "AI", question: "¿cómo ves SOL?" });
  // "What if" without a price is not a scenario.
  assert.equal(parseCommand("y si compro ahora").kind, "AI");
  // Paper trading: follow the plan without real money, and the measured record.
  assert.deepEqual(parseCommand("Jarvis, simulá la operación"), { kind: "PAPER_OPEN", symbol: null });
  assert.deepEqual(parseCommand("ponela en papel a sol"), { kind: "PAPER_OPEN", symbol: "SOL" });
  assert.deepEqual(parseCommand("¿cómo va mi paper trading?"), { kind: "PAPER" });
  assert.deepEqual(parseCommand("¿cómo van las operaciones de papel?"), { kind: "PAPER" });
  assert.deepEqual(parseCommand("resultados de las simulaciones"), { kind: "PAPER" });
  assert.notEqual(parseCommand("¿qué papel juega la Fed?").kind, "PAPER", "a role is not paper trading");
  assert.deepEqual(parseCommand("decime tu win rate y profit factor"), { kind: "STATS" }, "JARVIS's own signals stay where they were");
  // Backtesting: the same desk over past candles.
  assert.deepEqual(parseCommand("hacé un backtest de SOL de 6 meses"), { kind: "BACKTEST", symbol: "SOL", days: 180 });
  assert.deepEqual(parseCommand("backtesteá BTC"), { kind: "BACKTEST", symbol: "BTC", days: 90 });
  assert.deepEqual(parseCommand("¿cómo le hubiera ido a la mesa con ETH el último mes?"), { kind: "BACKTEST", symbol: "ETH", days: 30 });
  // Alerts: a level becomes a Telegram alert; without a level it is not one.
  assert.deepEqual(parseCommand("avisame si BTC pierde 110.000"), { kind: "ALERT", symbol: "BTC", level: 110_000 });
  assert.deepEqual(parseCommand("Jarvis, alertame si rompe 125 mil"), { kind: "ALERT", symbol: null, level: 125_000 });
  assert.deepEqual(parseCommand("poneme una alerta en sol a 200"), { kind: "ALERT", symbol: "SOL", level: 200 });
  assert.notEqual(parseCommand("avisame cuando haya algo").kind, "ALERT");
  assert.deepEqual(parseCommand("¿Qué pasa si pierde 110.000?"), { kind: "WHATIF", symbol: null, level: 110_000 }, "a question stays a scenario");
});

test("backtest periods in days, months or years", () => {
  assert.equal(backtestDays(normalize("backtest de 45 días")), 45);
  assert.equal(backtestDays(normalize("backtest de tres meses")), 90);
  assert.equal(backtestDays(normalize("backtest de un mes")), 30);
  assert.equal(backtestDays(normalize("backtest del último año")), 365);
  assert.equal(backtestDays(normalize("backtest de medio año")), 180);
  assert.equal(backtestDays(normalize("backtest de 2 días")), 14, "at least two weeks");
  assert.equal(backtestDays(normalize("backtest")), 90);
});

test("prices said the Argentine way; timeframes and percentages are not prices", () => {
  assert.equal(spokenLevel("si pierde 110.000"), 110_000);
  assert.equal(spokenLevel("si rompe 110 mil"), 110_000);
  assert.equal(spokenLevel("los 110k"), 110_000);
  assert.equal(spokenLevel("2.462,5"), 2462.5);
  assert.equal(spokenLevel("si pierde 0,85"), 0.85);
  assert.equal(spokenLevel("si pierde 0.85"), 0.85);
  assert.equal(spokenLevel("si cae 1.5k"), 1500);
  assert.equal(spokenLevel("si cae 35%"), null);
  assert.equal(spokenLevel("si cae 3 por ciento"), null);
  assert.equal(spokenLevel("en 4h"), null);
  assert.equal(spokenLevel("si en 4 horas pierde 98.500"), 98_500);
  assert.equal(spokenLevel("si pierde el soporte"), null);
});
