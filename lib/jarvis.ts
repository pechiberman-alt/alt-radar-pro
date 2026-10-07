/**
 * JARVIS: the app's voice assistant. This file is the pure part — what a
 * spoken (or typed) Spanish phrase asks for, and what JARVIS says back.
 *
 * Commands map to things the app already does (open a section, open a coin on
 * the map, read prices, scan for coins about to break). Anything else goes to
 * the AI analyst with the user's own words.
 */

export type JarvisIntent =
  | { kind: "SECTION"; section: string; label: string }
  | { kind: "MAP"; symbol: string; timeframe: string | null }
  | { kind: "PRICE"; symbols: string[] }
  | { kind: "BRIEFING" }
  | { kind: "BREAKOUTS"; timeframe: string }
  | { kind: "MOVERS" }
  | { kind: "STATS" }
  | { kind: "CORE" }
  | { kind: "LEARN" }
  | { kind: "NAME"; name: string }
  | { kind: "REMEMBER"; text: string }
  | { kind: "FORGET"; text: string }
  | { kind: "MEMORY" }
  | { kind: "STOP" }
  | { kind: "HELP" }
  | { kind: "AI"; question: string };

/** Lowercase, no accents, no punctuation, single spaces. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[¿?¡!.,;:"'()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Names people say for coins; the base ticker is also accepted when the caller knows it trades. */
const COIN_ALIASES: Record<string, string> = {
  bitcoin: "BTC", bitcoins: "BTC", btc: "BTC", bitcon: "BTC",
  ethereum: "ETH", ether: "ETH", eth: "ETH", ethe: "ETH",
  solana: "SOL", sol: "SOL", ripple: "XRP", xrp: "XRP", doge: "DOGE", dogecoin: "DOGE",
  cardano: "ADA", ada: "ADA", chainlink: "LINK", link: "LINK", avalanche: "AVAX", avax: "AVAX",
  binance: "BNB", bnb: "BNB", polkadot: "DOT", tron: "TRX", near: "NEAR", sui: "SUI", pepe: "PEPE",
  litecoin: "LTC", toncoin: "TON", hyperliquid: "HYPE", hype: "HYPE",
  oro: "XAU", gold: "XAU", xau: "XAU", plata: "XAG", xag: "XAG",
};
/** Spanish words that are also tickers; only taken as coins with an explicit cue ("de", "la moneda"). */
const AMBIGUOUS = new Set(["sol", "link", "near", "ada", "hype", "ton", "dot", "one", "op", "arb", "uni", "aave", "sand", "mana", "gala", "pol", "jup", "ar", "me", "a", "s"]);
/** Names of the app's own sections that are also tickers: alone they mean the section (the PUMP tab), not the coin. */
const SECTION_WORDS = new Set(["pump", "pumps"]);
const COIN_CUE = ["de", "del", "moneda", "token", "mapa", "precio", "grafico", "chart"];

export function findCoins(text: string, known: Set<string> = new Set()): string[] {
  const words = normalize(text).split(" ");
  const out: string[] = [];
  words.forEach((w, i) => {
    const prev = words[i - 1] ?? "";
    let sym: string | null = COIN_ALIASES[w] ?? (known.has(w.toUpperCase()) ? w.toUpperCase() : null);
    if (!sym) return;
    if (SECTION_WORDS.has(w) && !COIN_CUE.includes(prev)) return;
    if (AMBIGUOUS.has(w) && !["de", "del", "a", "el", "la", "moneda", "en", "abri", "abrime", "mostrame", "muestra", "mapa", "precio", "esta"].includes(prev) && words.length > 2) {
      // "sol" in "el sol" … only "de sol", "precio sol", or a phrase that is basically the coin.
      sym = null;
    }
    if (sym && !out.includes(sym)) out.push(sym);
  });
  return out;
}

export function findTimeframe(text: string): string | null {
  const t = normalize(text);
  const rules: [RegExp, string][] = [
    [/\b(1 ?m|un minuto|1 minuto)\b/, "1m"], [/\b(5 ?m|cinco minutos|5 minutos)\b/, "5m"],
    [/\b(15 ?m|quince minutos|15 minutos)\b/, "15m"], [/\b(30 ?m|media hora|treinta minutos|30 minutos)\b/, "30m"],
    [/\b(4 ?h|cuatro horas|4 horas)\b/, "4h"], [/\b(1 ?h|una hora|1 hora|horario)\b/, "1h"],
    [/\b(1 ?d|diario|un dia|1 dia)\b/, "1d"], [/\b(semanal|1 ?w|una semana)\b/, "1w"],
  ];
  for (const [re, tf] of rules) if (re.test(t)) return tf;
  return null;
}

const SECTIONS: [RegExp, string, string][] = [
  [/\b(por romper|a punto de romper|por explotar|rupturas?|rompe)\b/, "rompe", "A PUNTO DE ROMPER"],
  [/\b(suben solas|desacople|por su cuenta)\b/, "desacople", "SUBEN SOLAS"],
  [/\b(senales|robot|robot mm)\b/, "inteligencia", "SEÑALES · ROBOT MM"],
  [/\b(mapa|liquidaciones|mapa de calor|heatmap)\b/, "liquidaciones", "MAPA DE LIQUIDACIONES"],
  [/\b(pumps?|pumpeos?|pumpeo)\b/, "pumpeo", "PUMPEO"],
  [/\b(diario|mi cuenta|operaciones)\b/, "diario", "DIARIO"],
  [/\b(alertas|avisos)\b/, "alertas", "ALERTAS"],
  [/\b(noticias)\b/, "noticias", "NOTICIAS"],
  [/\b(cartera|portafolio)\b/, "cartera", "MI CARTERA"],
  [/\b(riesgo|calculadora)\b/, "riesgo", "RIESGO"],
  [/\b(historial)\b/, "historial", "HISTORIAL"],
  [/\b(dca)\b/, "dca", "DCA"],
  [/\b(escaner|scanner)\b/, "scanner", "ESCÁNER"],
  [/\b(configuracion|ajustes)\b/, "configuracion", "CONFIGURACIÓN"],
  [/\b(resumen|inicio)\b/, "resumen", "RESUMEN"],
];

const OPEN_VERB = /\b(abri|abrime|abre|abrir|mostrame|muestrame|muestra|mostra|anda a|ir a|llevame|pone|pasa a|quiero ver|ver)\b/;

export function parseCommand(raw: string, known: Set<string> = new Set()): JarvisIntent {
  // A leading wake word is not part of the command.
  const text = normalize(raw).replace(/^(oye |hey |ok )?jarvis\b ?/, "");
  if (!text) return { kind: "HELP" };
  if (/^(silencio|callate|basta|para|stop|cancelar)\b/.test(text)) return { kind: "STOP" };
  if (/\b(ayuda|que podes hacer|que puedes hacer|comandos)\b/.test(text)) return { kind: "HELP" };
  // Memory: "recordá que…", "olvidá lo de…", "¿qué recordás?" (lib/jarvis-memory.ts).
  if (/\b(que (te )?(recordas|acordas)( de mi)?|que sabes de mi|(que hay|que tenes|mostrame|abri) (en )?tu memoria|que tenes (anotado|guardado)|que te pedi que (recuerdes|anotes))\b/.test(text)) return { kind: "MEMORY" };
  const forget = text.match(/^(?:olvida(?:te)?|borra (?:de tu memoria|el recuerdo|lo que te dije|todo lo que sabes))\b\s*(?:de |que |lo de |el recuerdo de |sobre )?(.*)$/);
  if (forget) return { kind: "FORGET", text: /^(todo|toda tu memoria|todo lo que sabes( de mi)?|lo que sabes de mi)?$/.test(forget[1].trim()) ? "todo" : forget[1].trim() };
  const remember = raw
    .trim()
    .replace(/^(?:(?:oye|hey|ok)\s+)?jarvis[,:]?\s*/i, "")
    .match(/^(?:record[aá](?:me)?|acord[aá]te|anot[aá]|memoriz[aá]|guard[aá] en (?:tu )?memoria|aprend[eé])\s*(?:que|esto|lo siguiente)?\s*:?\s+(.{3,})$/i);
  if (remember) return { kind: "REMEMBER", text: remember[1].trim() };
  if (/\b(que aprendiste|que (has )?aprendido|aprendizaje|que descubriste|lecciones|que estudiaste|que sabes del mercado)\b/.test(text)) return { kind: "LEARN" };
  if (/\b(nucleo|estado del nucleo|que hiciste|mientras no estaba|que paso mientras|que estuviste haciendo|estas activo|estas despierto)\b/.test(text)) return { kind: "CORE" };
  if (/\b(rendimiento|estadisticas|tus senales|tu registro|registro de senales|win ?rate|profit factor|como (te )?(va|fue|vienen?)( con)? (las|tus) senales|cuanto acertaste|aciertos)\b/.test(text)) return { kind: "STATS" };
  const name = text.match(/\b(?:llamame|decime|dime|mi nombre es|me llamo)\s+([a-zñ]{2,20})\b/);
  if (name) return { kind: "NAME", name: name[1][0].toUpperCase() + name[1].slice(1) };
  if (/\b(informe|briefing|reporte|como esta el mercado|como viene el mercado|estado del mercado|buen dia|buenos dias|buenas tardes|buenas noches|ponme al dia|poneme al dia)\b/.test(text))
    return { kind: "BRIEFING" };
  if (/\b(que (esta|estan|hay) (a punto de |por )?(romper|explotar)|algo por (romper|explotar))\b/.test(text))
    return { kind: "BREAKOUTS", timeframe: findTimeframe(text) ?? "1h" };
  if (/\b(que (sube|suben|esta subiendo|esta pumpeando)|mayores subas|ganadoras|lo que mas sube|top)\b/.test(text)) return { kind: "MOVERS" };

  const coins = findCoins(text, known);
  if (coins.length && /\b(precio|cuanto (esta|vale|cotiza)|a cuanto|cotizacion|como esta|como va)\b/.test(text)) return { kind: "PRICE", symbols: coins.slice(0, 4) };
  if (coins.length && (OPEN_VERB.test(text) || /\b(mapa|grafico|chart)\b/.test(text) || text.split(" ").length <= 2))
    return { kind: "MAP", symbol: coins[0], timeframe: findTimeframe(text) };
  if (OPEN_VERB.test(text) || text.split(" ").length <= 3) {
    for (const [re, section, label] of SECTIONS) if (re.test(text)) return { kind: "SECTION", section, label };
  }
  return { kind: "AI", question: raw.trim().replace(/^(oye |hey |ok )?jarvis[,:]?\s*/i, "") };
}

export function greeting(hour: number, name: string): string {
  const part = hour >= 5 && hour < 12 ? "Buenos días" : hour >= 12 && hour < 20 ? "Buenas tardes" : "Buenas noches";
  return `${part}, ${name}.`;
}

export type Ticker = { symbol: string; price: number; change: number; quoteVolume: number };

const say = (v: number) => {
  const d = v >= 1000 ? 0 : v >= 10 ? 2 : v >= 1 ? 3 : 5;
  return v.toLocaleString("es-AR", { maximumFractionDigits: d });
};
const pct = (v: number) => `${v >= 0 ? "sube" : "baja"} ${Math.abs(v).toFixed(1).replace(".", ",")} por ciento`;

/** What JARVIS says for a price question. */
export function priceLine(t: Ticker): string {
  return `${t.symbol.replace(/USDT$/, "")} está en ${say(t.price)} dólares, ${pct(t.change)} en 24 horas.`;
}

/** The market briefing: majors, mood of the market, top movers, coins about to break. */
export function briefingText(input: {
  hour: number;
  name: string;
  tickers: Ticker[];
  breakouts?: { symbol: string; side: string; score: number }[];
}): string {
  const by = new Map(input.tickers.map((t) => [t.symbol, t]));
  const parts = [greeting(input.hour, input.name)];
  const majors = ["BTCUSDT", "ETHUSDT", "SOLUSDT"].map((s) => by.get(s)).filter((t): t is Ticker => Boolean(t));
  if (majors.length) parts.push(majors.map(priceLine).join(" "));
  const alts = input.tickers.filter((t) => t.symbol.endsWith("USDT") && !["BTCUSDT", "ETHUSDT"].includes(t.symbol) && t.quoteVolume > 20_000_000);
  if (alts.length >= 10) {
    const up = alts.filter((t) => t.change > 0).length / alts.length;
    parts.push(
      up >= 0.65 ? `El mercado está fuerte: ${Math.round(up * 100)} por ciento de las altcoins líquidas en verde.`
        : up <= 0.35 ? `El mercado está débil: solo ${Math.round(up * 100)} por ciento de las altcoins líquidas en verde.`
          : `El mercado está mixto: ${Math.round(up * 100)} por ciento de las altcoins líquidas en verde.`,
    );
    const top = [...alts].sort((a, b) => b.change - a.change).slice(0, 3);
    parts.push(`Las que más suben: ${top.map((t) => `${t.symbol.replace(/USDT$/, "")} ${t.change.toFixed(1).replace(".", ",")} por ciento`).join(", ")}.`);
  }
  if (input.breakouts) {
    const hot = input.breakouts.slice(0, 3);
    parts.push(
      hot.length
        ? `A punto de romper: ${hot.map((b) => `${b.symbol.replace(/USDT$/, "")} ${b.side === "ALCISTA" ? "hacia arriba" : b.side === "BAJISTA" ? "hacia abajo" : "sin dirección clara"}`).join(", ")}.`
        : "Ninguna de las principales está comprimida contra un nivel ahora.",
    );
  }
  parts.push("Recordá: arriesgá como máximo uno por ciento por operación.");
  return parts.join(" ");
}

export const HELP_TEXT =
  "Podés decirme: informe del mercado. Precio de Bitcoin. Abrí el mapa de Solana en 15 minutos. ¿Qué está por romper? ¿Qué está subiendo? " +
  "Abrí señales, diario o alertas. ¿Cómo vienen tus señales? ¿Qué aprendiste? Estado del núcleo. Llamame por tu nombre. " +
  "Recordá que… y lo tengo en cuenta en cada respuesta; ¿qué recordás?; olvidá lo de… Analizalo, para lo que tenés en pantalla. O preguntame lo que quieras sobre el mercado.";
