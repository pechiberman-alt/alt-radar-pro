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
  | { kind: "MIND" }
  | { kind: "STOP" }
  | { kind: "HELP" }
  | { kind: "DESK"; symbol: string | null }
  | { kind: "ENTRY"; symbol: string | null }
  | { kind: "WHATIF"; symbol: string | null; level: number }
  | { kind: "COMPARE"; a: string; b: string }
  | { kind: "LIQ_RISK"; symbol: string | null }
  | { kind: "INDICATORS"; symbol: string | null }
  | { kind: "MACRO"; question: string }
  | { kind: "PAPER" }
  | { kind: "BACKTEST"; symbol: string | null; days: number }
  | { kind: "PAPER_OPEN"; symbol: string | null }
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
  [/\b(jarvis trading|trading|mesa de trading|la mesa)\b/, "jarvis-trading", "JARVIS TRADING"],
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

/**
 * A price said or typed the Argentine way: "110.000", "110 mil", "110k",
 * "0,85", "2.462,5". Null when the phrase has no price.
 */
export function spokenLevel(raw: string): number | null {
  // Whole numbers only (never the "3" of "35%"), and never a timeframe or a percentage.
  const m = raw.toLowerCase().match(/(?<![\d.,])(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+\.\d+|\d+(?:,\d+)?)(?![.,]?\d)\s*(k\b|mil\b|lucas\b)?(?!\s*(?:(?:h|hs|horas?|m|min|minutos?|d|dias?|por ?ciento)\b|%))/);
  if (!m) return null;
  const n = m[1];
  let v: number;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(n)) v = Number(n.replace(/\./g, "").replace(",", "."));
  else if (n.includes(",")) v = Number(n.replace(",", "."));
  else v = Number(n);
  if (m[2]) v *= 1000;
  return Number.isFinite(v) && v > 0 ? v : null;
}

const OPEN_VERB = /\b(abri|abrime|abre|abrir|mostrame|muestrame|muestra|mostra|anda a|ir a|llevame|pone|pasa a|quiero ver|ver)\b/;

const COUNT: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, nueve: 9, doce: 12 };

/** The period of a backtest, said in days, months or years (normalized text); 90 days when not said. */
export function backtestDays(text: string): number {
  const clamp = (n: number) => Math.max(14, Math.min(365, Math.round(n)));
  const d = text.match(/\b(\d{1,3})\s*(?:dias|d)\b/);
  if (d) return clamp(Number(d[1]));
  if (/\b(medio ano|semestre)\b/.test(text)) return 180;
  if (/\btrimestre\b/.test(text)) return 90;
  if (/\b(un ano|ultimo ano|el ano|doce meses|12 meses)\b/.test(text)) return 365;
  const m = text.match(/\b(\d{1,2}|un|una|uno|dos|tres|cuatro|cinco|seis|nueve|doce)\s+mes(?:es)?\b/);
  if (m) return clamp((COUNT[m[1]] ?? Number(m[1])) * 30);
  if (/\b(el ultimo mes|un mes)\b/.test(text)) return 30;
  return 90;
}

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
  if (/\b(tu lectura|lectura del mercado|que ves en el mercado|como ves el mercado|que pensas del mercado|tu (vision|opinion) del mercado|tus tesis|tu mente)\b/.test(text)) return { kind: "MIND" };
  if (/\b(que aprendiste|que (has )?aprendido|aprendizaje|que descubriste|lecciones|que estudiaste|que sabes del mercado)\b/.test(text)) return { kind: "LEARN" };
  // Paper trading (lib/jarvis-paper.ts): follow the desk's plan without real money; its measured record.
  if (/\b(simula(la|lo|me)?|abri(la|lo)? en papel|segui(la|lo)? en papel|opera(la|lo)? en papel|pone(la|lo) en papel)\b/.test(text) && !/\b(como (va|van|vienen?|fue)|resultados?|historial|estadisticas)\b/.test(text))
    return { kind: "PAPER_OPEN", symbol: findCoins(text, known)[0] ?? null };
  if (/\b(paper( trading)?|de papel|en papel|simulad[ao]s|simulaciones)\b/.test(text)) return { kind: "PAPER" };
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
  const question = raw.trim().replace(/^(oye |hey |ok )?jarvis[,:]?\s*/i, "");
  // Backtesting (lib/jarvis-backtest.ts): the same desk walked forward over past candles.
  if (/\b(backtest\w*|back test|prueba historica|probala en el pasado|como le (hubiera|habria) ido|como (hubiera|habria) funcionado)\b/.test(text))
    return { kind: "BACKTEST", symbol: coins[0] ?? null, days: backtestDays(text) };
  // JARVIS TRADING (lib/jarvis-desk.ts): the desk of specialists, its plan, its scenarios.
  if (/\b(cpi|ppi|nfp|fomc|inflacion|nominas|dato macro|datos macro|agenda macro|calendario (economico|macro)|eventos? macro|la fed|tasa de (la fed|interes)|tasas de interes|desempleo|pbi|gdp)\b/.test(text))
    return { kind: "MACRO", question };
  if (coins.length >= 2 && /\b(compara(me|las|los)?|comparacion|versus|vs|contra|mas fuerte|mas debil|mejor|conviene mas)\b/.test(text)) return { kind: "COMPARE", a: coins[0], b: coins[1] };
  if (/\b(que pasa si|y si|si (pierde|rompe|cae|baja|sube|supera|perfora|pasa))\b/.test(text)) {
    const level = spokenLevel(raw);
    if (level !== null) return { kind: "WHATIF", symbol: coins[0] ?? null, level };
  }
  if (/\b(riesgo de (liquidacion|liquidaciones|barrida)|hay (riesgo|peligro) de (liquidacion|liquidaciones|barrida)|liquidaciones cerca|(van|pueden) a liquidar)\b/.test(text)) return { kind: "LIQ_RISK", symbol: coins[0] ?? null };
  if (/\b(que (opinan|dicen|marcan|muestran) (los )?indicadores|como (estan|vienen) los indicadores|indicadores de|que dice el (rsi|macd))\b/.test(text)) return { kind: "INDICATORS", symbol: coins[0] ?? null };
  if (/\b(donde (entrarias|entraria|entro|entrar|conviene entrar)|punto de entrada|plan de (trading|operacion)|dame (una |un )?(operacion|entrada|trade|plan)|que operacion|long o short|largo o corto|compro o vendo)\b/.test(text)) return { kind: "ENTRY", symbol: coins[0] ?? null };
  if (/\b(analisis completo|analizame|analizalo|analizala|analiza|analizar|evalua|estudia|operacion en|trade en)\b/.test(text) && (coins.length || /\b(analisis completo)\b/.test(text)))
    return { kind: "DESK", symbol: coins[0] ?? null };
  // "¿Cómo ves SOL?", "¿qué opinás de ETH?": a conversation about the asset, with the desk's reading as context.
  if (coins.length && /\b(analisis|que opinas de|como ves|que ves en)\b/.test(text)) {
    return { kind: "AI", question };
  }
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
  "Recordá que… y lo tengo en cuenta en cada respuesta; ¿qué recordás?; olvidá lo de… Analizá Solana, o analizalo para lo que tenés en pantalla. Tu lectura del mercado. " +
  "Trading: analizame Bitcoin, ¿dónde entrarías?, ¿qué pasa si pierde 110.000?, comparame Bitcoin contra Ethereum, ¿hay riesgo de liquidaciones?, ¿qué pasa si sale un CPI peor de lo esperado? " +
  "Papel, sin plata real: simulá la operación, ¿cómo va mi paper trading? Backtest de Solana de 6 meses. O preguntame lo que quieras sobre el mercado.";
