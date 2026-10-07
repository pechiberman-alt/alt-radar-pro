import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSpanish, numberToWords, parseEsNumber, readNumber, roundSpoken, splitForSpeech } from "../lib/speech-text.ts";
import { pickVoice, scoreVoice } from "../lib/browser-voice.ts";

test("numbers in Spanish words, with apocope and the 100/1000 forms", () => {
  assert.equal(numberToWords(0), "cero");
  assert.equal(numberToWords(21), "veintiuno");
  assert.equal(numberToWords(58), "cincuenta y ocho");
  assert.equal(numberToWords(100), "cien");
  assert.equal(numberToWords(115), "ciento quince");
  assert.equal(numberToWords(1000), "mil");
  assert.equal(numberToWords(21000), "veintiún mil");
  assert.equal(numberToWords(112345), "ciento doce mil trescientos cuarenta y cinco");
  assert.equal(numberToWords(1_000_000), "un millón");
  assert.equal(numberToWords(2_500_000), "dos millones quinientos mil");
  assert.equal(numberToWords(-3), "menos tres");
});

test("decimal comma, thousands dot and short decimals as said aloud", () => {
  assert.equal(readNumber("1,76"), "uno coma setenta y seis");
  assert.equal(readNumber("0,05"), "cero coma cero cinco");
  assert.equal(readNumber("115.000"), "ciento quince mil");
  assert.equal(readNumber("4.523,5"), "cuatro mil quinientos veintitrés coma cinco");
  assert.equal(readNumber("0.5"), "cero coma cinco");
  assert.equal(readNumber("1,7634"), "uno coma siete seis tres cuatro");
});

test("JARVIS text becomes speakable words: %, +R, US$, tickers, trading English, emoji", () => {
  const t = normalizeSpanish("🔔 BTC sube 2,4% · total +4,3R, PF 1,76, win rate 58% en SOLUSDT a US$ 187");
  assert.match(t, /bítcoin sube dos coma cuatro por ciento/);
  assert.match(t, /total más cuatro coma tres erre/);
  assert.match(t, /prófit fáctor uno coma setenta y seis/);
  assert.match(t, /uin réit cincuenta y ocho por ciento/);
  assert.match(t, /en sol a ciento ochenta y siete dólares/);
  assert.doesNotMatch(t, /🔔|·/);
  assert.equal(normalizeSpanish("RSI y ALT"), "erre ese i y alt", "no vowel = spelled; a word in caps is read");
});

test("speech chunks: sentence first, each under the limit, nothing lost", () => {
  const long = "Primera frase corta. " + "palabra ".repeat(80).trim() + ", y una cola. ¿Fin?";
  const parts = splitForSpeech(long, 120);
  assert.equal(parts[0], "Primera frase corta.");
  assert.ok(parts.every((p) => p.length <= 120), parts.map((p) => p.length).join(","));
  assert.equal(parts.join(" ").replace(/\s+/g, " "), long.replace(/\s+/g, " "));
  const quick = splitForSpeech("Buenas noches, señor: el mercado está tranquilo y Bitcoin respeta el soporte de la semana. Nada más.", 200, 40);
  assert.deepEqual(quick, ["Buenas noches, señor:", "el mercado está tranquilo y Bitcoin respeta el soporte de la semana.", "Nada más."], "short first piece so the voice starts fast");
});

test("browser voice: natural/neural from Argentina first, then the closest region", () => {
  const voices = [
    { name: "Google español de Estados Unidos", lang: "es-US" },
    { name: "Microsoft Tomas Online (Natural) - Spanish (Argentina)", lang: "es-AR" },
    { name: "Microsoft Elena Online (Natural) - Spanish (Argentina)", lang: "es-AR" },
    { name: "Monica", lang: "es-ES" },
    { name: "Samantha", lang: "en-US" },
  ];
  assert.equal(pickVoice(voices)?.name, "Microsoft Tomas Online (Natural) - Spanish (Argentina)");
  assert.equal(pickVoice(voices, "female")?.name, "Microsoft Elena Online (Natural) - Spanish (Argentina)");
  assert.equal(pickVoice([{ name: "Monica", lang: "es-ES" }, { name: "Google español de Estados Unidos", lang: "es-US" }])?.name, "Google español de Estados Unidos");
  assert.equal(pickVoice([{ name: "Samantha", lang: "en-US" }]), null, "no Spanish voice: none rather than English");
  assert.equal(scoreVoice({ name: "x", lang: "fr-FR" }), -1);
});

test("prices said like a person: rounded by size; timeframes and symbols in words", () => {
  assert.equal(parseEsNumber("84.523,7"), 84523.7);
  assert.equal(parseEsNumber("115.000"), 115000);
  assert.equal(parseEsNumber("0.5"), 0.5);
  assert.equal(roundSpoken("84.523,7"), "84524");
  assert.equal(roundSpoken("181,236"), "181,2");
  assert.equal(roundSpoken("1,76"), "1,76");
  assert.equal(roundSpoken("1,50"), "1,5", "trailing zeros are not said");
  assert.equal(roundSpoken("0,000123456"), "0,0001235");
  const t = normalizeSpanish("TRI largo en 1h, stop 108,121 · objetivo 111,807 → en 15m, ± 2,45%");
  assert.match(t, /en una hora, estóp ciento ocho coma uno, objetivo ciento once coma ocho a en quince minutos, más o menos dos coma cuarenta y cinco por ciento/);
  assert.equal(normalizeSpanish("1d, 3d, 1w, 4h"), "un día, tres días, una semana, cuatro horas");
});

test("what the local engine writes is said as a person says it: capital timeframes, money with a scale, scores, pairs", async () => {
  const { normalizeSpanish } = await import("../lib/speech-text.ts");
  const said = normalizeSpanish("SOL/USDT cotiza $116,13 (-3,90% 24H, 1H +0,20%, 4H). Volumen 24H $500M. Score 47/100. Volumen 2,5×. Total $2,63T, cap $1,2B, $85K. 1D y 15m. USDT.D 6,95%.");
  for (const bad of ["H ", "dólaresM", "dólaresB", "dólaresK", "cuarenta y siete cien", "u ese de te cotiza", "por ,", "mil ciento"]) {
    assert.ok(!said.includes(bad), `no debe decir «${bad}»: ${said}`);
  }
  for (const good of [
    "sol cotiza ciento dieciséis coma uno dólares",
    "veinticuatro horas",
    "una hora",
    "cuatro horas",
    "quinientos millones de dólares",
    "cuarenta y siete de cien",
    "dos coma cinco veces",
    "dos coma sesenta y tres billones de dólares",
    "uno coma dos mil millones de dólares",
    "ochenta y cinco mil dólares",
    "un día y quince minutos",
    "dominancia de u ese de te",
  ]) {
    assert.ok(said.includes(good), `debe decir «${good}»: ${said}`);
  }
});
