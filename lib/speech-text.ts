/**
 * What JARVIS writes, turned into what a Spanish voice should say.
 *
 * Device voices read "+4,3R", "PF 1,76" or "win rate" badly (letters, English
 * words in Spanish phonetics, emoji names). This rewrites them as Spanish
 * words: numbers with decimal comma ("1,76" → "uno coma setenta y seis"),
 * thousands with dot, "%", "+/-", "US$", trading English respelled the way
 * it's said here ("win rate" → "uin réit") and tickers ("BTC" → "bitcoin").
 * Then splits long replies so browsers don't cut them off.
 */

const UNITS = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const TENS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const HUNDREDS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

function below1000(n: number): string {
  if (n < 30) return UNITS[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ` y ${UNITS[n % 10]}` : "");
  if (n === 100) return "cien";
  return HUNDREDS[Math.floor(n / 100)] + (n % 100 ? ` ${below1000(n % 100)}` : "");
}

/** "uno" becomes "un" before mil/millón/millones: "veintiún mil", "un millón". */
const apocope = (s: string) => s.replace(/veintiuno$/, "veintiún").replace(/(^|\s)uno$/, "$1un");

/** Whole numbers up to the trillions, in Spanish words. */
export function numberToWords(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (n < 0) return `menos ${numberToWords(-n)}`;
  n = Math.floor(n);
  if (n < 1000) return below1000(n);
  if (n < 1_000_000) {
    const k = Math.floor(n / 1000);
    const head = k === 1 ? "mil" : `${apocope(below1000(k))} mil`;
    return head + (n % 1000 ? ` ${below1000(n % 1000)}` : "");
  }
  if (n < 1e12) {
    const m = Math.floor(n / 1_000_000);
    const head = m === 1 ? "un millón" : `${apocope(numberToWords(m))} millones`;
    return head + (n % 1_000_000 ? ` ${numberToWords(n % 1_000_000)}` : "");
  }
  const b = Math.floor(n / 1e12);
  const head = b === 1 ? "un billón" : `${apocope(numberToWords(b))} billones`;
  return head + (n % 1e12 ? ` ${numberToWords(n % 1e12)}` : "");
}

/** Decimal part as said aloud: "76" → "setenta y seis", "05" → "cero cinco", longer → digit by digit. */
function decimals(d: string): string {
  if (d.length <= 2 && !d.startsWith("0")) return numberToWords(Number(d));
  return d.split("").map((c) => UNITS[Number(c)]).join(" ");
}

/** "4.523,5" / "1,76" / "112345" / "0.5" → words. Dot + exactly 3 digits = thousands. */
export function readNumber(raw: string): string {
  let s = raw;
  let intPart = s;
  let dec = "";
  if (/,/.test(s)) {
    [intPart, dec] = s.split(",", 2);
    intPart = intPart.replace(/\./g, "");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    intPart = s.replace(/\./g, "");
  } else if (/\./.test(s)) {
    [intPart, dec] = s.split(".", 2);
  }
  s = numberToWords(Number(intPart || "0"));
  return dec ? `${s} coma ${decimals(dec)}` : s;
}

/** Trading English and names as a Spanish speaker says them, written for Spanish rules. */
const LEXICON: [RegExp, string][] = [
  [/\bwin ?rate\b/gi, "uin réit"],
  [/\bprofit factor\b/gi, "prófit fáctor"],
  [/\btake profit\b/gi, "téik prófit"],
  [/\bstop ?loss\b/gi, "estop los"],
  [/\bstop\b/gi, "estóp"],
  [/\bbreakouts?\b/gi, "bréikaut"],
  [/\btrading ?view\b/gi, "tréidin viu"],
  [/\btrading\b/gi, "tréidin"],
  [/\btraders?\b/gi, "tréider"],
  [/\bscalping\b/gi, "escálpin"],
  [/\bmarket makers?\b/gi, "márket méiker"],
  [/\bfootprint\b/gi, "fútprint"],
  [/\bheatmap\b/gi, "jítmap"],
  [/\bshorts?\b/gi, "chort"],
  [/\blongs?\b/gi, "long"],
  [/\bpumps?\b/gi, "pamp"],
  [/\bbitcoin\b/gi, "bítcoin"],
  [/\bethereum\b/gi, "etéreum"],
  [/\bbinance\b/gi, "báinans"],
  [/\btelegram\b/gi, "télegram"],
  [/\bjarvis\b/gi, "yárvis"],
  [/\balt radar pro\b/gi, "alt rádar pro"],
  [/\burl\.fx\b/gi, "u erre ele efe equis"],
  [/\bok\b/gi, "okéi"],
  [/\bcsv\b/gi, "ce ese uve"],
  [/\bPF\b/g, "prófit fáctor"],
  [/\bBTC\b/g, "bítcoin"],
  [/\bETH\b/g, "éter"],
  [/\bSOL\b/g, "sol"],
  [/\bXAU\b/g, "oro"],
  [/\bUSDT\b/g, "u ese de te"],
  [/\bATR\b/g, "a te erre"],
];

const LETTER_NAMES: Record<string, string> = {
  a: "a", b: "be", c: "ce", d: "de", e: "e", f: "efe", g: "ge", h: "hache", i: "i", j: "jota", k: "ka", l: "ele", m: "eme",
  n: "ene", ñ: "eñe", o: "o", p: "pe", q: "cu", r: "erre", s: "ese", t: "te", u: "u", v: "uve", w: "doble uve", x: "equis", y: "ye", z: "zeta",
};

/** A caps word reads as a word if it has a vowel and starts like Spanish can (a vowel, one consonant, or pr/bl/tr…). */
function pronounceable(w: string): boolean {
  if (!/[AEIOU]/.test(w)) return false;
  const onset = w.match(/^[^AEIOU]*/)?.[0] ?? "";
  return onset.length <= 1 || /^(PR|PL|BR|BL|TR|DR|CR|CL|GR|GL|FR|FL|CH|LL)$/.test(onset);
}

/** "84.523,7" / "108,121" / "0.5" → the number (es-AR: dot for thousands, comma for decimals). */
export function parseEsNumber(raw: string): number {
  if (/,/.test(raw)) return Number(raw.replace(/\./g, "").replace(",", "."));
  if (/^\d{1,3}(\.\d{3})+$/.test(raw)) return Number(raw.replace(/\./g, ""));
  return Number(raw);
}

/**
 * A number as a person says it: prices of thousands without decimals, of
 * hundreds with one, units with two, below one with four significant
 * figures. "108,121" is said "ciento ocho coma doce", not to the last digit.
 */
export function roundSpoken(raw: string): string {
  const v = parseEsNumber(raw);
  if (!Number.isFinite(v)) return raw;
  const a = Math.abs(v);
  const digits = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : a === 0 ? 0 : Math.min(8, 3 - Math.floor(Math.log10(a)));
  const fixed = v.toFixed(digits);
  // Trailing zeros are not said ("1,50" → "1,5"), and the separator is a comma again.
  const trimmed = fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
  return trimmed.replace(".", ",");
}

const UNIT_WORDS: Record<string, [string, string, "f" | "m"]> = {
  h: ["hora", "horas", "f"],
  m: ["minuto", "minutos", "m"],
  d: ["día", "días", "m"],
  w: ["semana", "semanas", "f"],
};

/** Everything JARVIS might write, as words a Spanish reader would say. */
export function normalizeSpanish(text: string): string {
  let t = text.normalize("NFC");
  for (const [re, rep] of LEXICON) t = t.replace(re, rep);
  // Symbols the voice would skip or spell.
  t = t.replace(/\s*·\s*/g, ", ").replace(/\s*→\s*/g, " a ").replace(/\s*×\s*/g, " por ").replace(/\s*±\s*/g, " más o menos ").replace(/≈\s*/g, "cerca de ");
  // Timeframes: "1h" → "una hora", "15m" → "quince minutos", "4h" → "cuatro horas".
  t = t.replace(/\b(\d{1,2})([hmdw])\b/g, (_, n: string, u: string) => {
    const [one, many, g] = UNIT_WORDS[u];
    const k = Number(n);
    return k === 1 ? `${g === "f" ? "una" : "un"} ${one}` : `${numberToWords(k)} ${many}`;
  });
  // Ticker pairs and coins: "SOLUSDT" → "sol", "ETHUSDT" → "éter".
  t = t.replace(/\b([A-Z]{2,6})USDT\b/g, (_, c: string) => c);
  t = t.replace(/US\$\s?([\d.,]+)/g, "$1 dólares").replace(/\$\s?([\d.,]+)/g, "$1 dólares");
  t = t.replace(/([\d.,]+)\s?%/g, "$1 por ciento");
  t = t.replace(/(^|[\s(])\+(?=\d)/g, "$1más ").replace(/(^|[\s(])[-−](?=\d)/g, "$1menos ");
  t = t.replace(/(\d)\s?R\b/g, "$1 erre");
  t = t.replace(/(\d{1,2}):(\d{2})\b/g, (_, h: string, m: string) => `${numberToWords(Number(h))}${m === "00" ? "" : ` y ${readNumber(m)}`}`);
  t = t.replace(/\d+(?:[.,]\d+)*/g, (m) => {
    const trimmed = m.replace(/[.,]$/, "");
    return readNumber(roundSpoken(trimmed)) + m.slice(trimmed.length);
  });
  // Unpronounceable acronyms ("PF", "RSI") are spelled; words in caps ("ALT", "PRO", "IMANES") are read.
  t = t.replace(/\b[A-ZÑ]{2,5}\b/g, (w) => (pronounceable(w) ? w.toLowerCase() : w.toLowerCase().split("").map((c) => LETTER_NAMES[c] ?? c).join(" ")));
  t = t.replace(/[“”«»"]/g, "").replace(/[¡¿]/g, "").replace(/([.!?…:;])\s*[\n\r]+\s*/g, "$1 ").replace(/\s*[\n\r]+\s*/g, ". ");
  // Emoji, arrows, bullets and anything else the voice can't say.
  t = t.replace(/[^\p{L}\s.,;:!?…—'()-]/gu, " ").replace(/\s+/g, " ").trim();
  return t;
}

/**
 * Splits text into chunks that each fit the model's 510-token window, at
 * sentence ends first, then commas, then words. Short first chunk so the
 * voice starts quickly.
 */
export function splitForSpeech(text: string, maxChars = 220, firstMax = maxChars): string[] {
  const sentences = text.replace(/\s+/g, " ").match(/[^.!?…\n]+[.!?…]*/g) ?? [];
  const out: string[] = [];
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    const limit = out.length === 0 ? Math.min(firstMax, maxChars) : maxChars;
    if (s.length <= limit) { out.push(s); continue; }
    if (limit < maxChars) {
      // First piece: cut at the first comma that fits, then the rest normally.
      const cut = s.slice(0, limit).search(/[,;:](?=[^,;:]*$)/);
      if (cut > 10) {
        out.push(s.slice(0, cut + 1).trim());
        out.push(...splitForSpeech(s.slice(cut + 1), maxChars));
        continue;
      }
    }
    let cur = "";
    for (const piece of s.split(/(?<=[,;:])\s+/)) {
      if ((cur + " " + piece).trim().length <= maxChars) { cur = (cur + " " + piece).trim(); continue; }
      if (cur) out.push(cur);
      if (piece.length <= maxChars) { cur = piece; continue; }
      cur = "";
      for (const w of piece.split(" ")) {
        if ((cur + " " + w).trim().length > maxChars) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim();
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}
