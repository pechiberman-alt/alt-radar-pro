import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSpanish, numberToWords, readNumber, splitForSpeech } from "../lib/speech-text.ts";
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
