import type { MarketAsset, ScoredAsset } from "../radar";
import type { MarketStructure } from "../market-structure";
import type { PumpReading } from "../pump-radar";
// Explicit extension so Node can run this module directly in the unit tests;
// the bundler resolves it the same way.
import { findConcepts, normalize, type KnowledgeEntry } from "./knowledge.ts";

/**
 * Deterministic terminal assistant.
 *
 * Answers are composed from the live snapshot plus a reviewed knowledge base —
 * there is no language model, so nothing is generated and nothing leaves the
 * device. That keeps the panel's "0 tokens, no third parties" promise honest,
 * and more importantly means the assistant cannot invent a price or a level.
 * When the data behind an answer is missing it says so instead of filling the
 * gap.
 */

export type AssistantContext = {
  timestamp: string;
  market: MarketAsset[];
  scored: ScoredAsset[];
  altseason: {
    final: number | null;
    raw: number | null;
    state: string;
    adjustment: number;
  };
  risk: { score: number | null; level: string; killSwitch: boolean };
  structure: MarketStructure | null;
  pumps: PumpReading[];
  correlations?: {
    interval: string;
    averagePair: number | null;
    tightestPair: { label: string; value: number } | null;
    loosestPair: { label: string; value: number } | null;
    goldVsBtc: number | null;
    rotation: { label: string; value: number }[];
  } | null;
  ledger?: {
    total: number;
    evaluated4h: number;
    winRate4h: number | null;
    profitFactor4h: number | null;
    averageReturn4h: number | null;
  } | null;
  profile?: { name: string; horizon: string; market: string } | null;
};

export type AssistantAnswer = {
  intent: string;
  text: string;
  /** How well the snapshot backs this answer. */
  confidence: "ALTA" | "MEDIA" | "BAJA";
  sources: string[];
  followUps: string[];
  concepts: { title: string; summary: string; caveat?: string }[];
};

const UNAVAILABLE = "DATA UNAVAILABLE";

const pct = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? UNAVAILABLE
    : `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;

const plain = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? UNAVAILABLE
    : value.toFixed(digits);

const price = (value: number) =>
  value >= 1000
    ? `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : value >= 1
      ? `$${value.toFixed(3)}`
      : `$${value.toPrecision(4)}`;

const cap = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNAVAILABLE;
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  return `$${(value / 1e6).toFixed(1)}M`;
};

const assetName = (symbol: string) => symbol.replace("USDT", "");

/** Matches whole words so short tickers do not fire inside longer words. */
function hasAny(text: string, terms: string[]) {
  const padded = ` ${text} `;
  return terms.some((term) => padded.includes(` ${term} `));
}

/**
 * Function words that collide with real Binance tickers. Without this,
 * "¿cómo está la dominancia?" resolves to the LA token and answers about the
 * wrong thing entirely — Binance also lists A, ME, ID, AT, S, T and others
 * that are ordinary words in Spanish or English.
 */
const STOPWORDS = new Set([
  "la", "el", "lo", "los", "las", "un", "una", "unos", "unas",
  "de", "del", "al", "a", "en", "con", "por", "para", "sin", "sobre",
  "y", "o", "u", "e", "si", "no", "ni", "que", "qué", "como", "cual",
  "me", "te", "se", "le", "mi", "tu", "su", "es", "son", "esta", "este",
  "hay", "ver", "dame", "ahora", "hoy", "mas", "muy", "todo", "toda",
  "the", "is", "are", "at", "it", "in", "on", "of", "to", "and", "or",
  "do", "so", "up", "id", "me", "we", "my", "be", "an", "as", "by",
]);

/**
 * Pulls a ticker out of the question by checking it against the live universe,
 * so it recognises whatever Binance actually lists rather than a fixed list.
 */
export function extractSymbol(
  question: string,
  market: MarketAsset[],
): MarketAsset | null {
  const words = normalize(question)
    .split(" ")
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word));
  if (!words.length) return null;

  // Longest ticker first, so "BTCDOM" is not shadowed by "BTC".
  const candidates = [...market].sort(
    (left, right) => right.symbol.length - left.symbol.length,
  );

  for (const word of words) {
    const upper = word.toUpperCase();
    const direct = candidates.find(
      (item) => item.symbol === upper || item.symbol === `${upper}USDT`,
    );
    if (direct) return direct;
  }
  return null;
}

type Intent = {
  id: string;
  terms: string[];
  build: (context: AssistantContext, question: string) => Omit<AssistantAnswer, "concepts" | "intent">;
};

function summarize(context: AssistantContext): Omit<AssistantAnswer, "concepts" | "intent"> {
  const active = context.scored.filter((asset) => asset.signal !== "NO SIGNAL");
  const triggers = active.filter((asset) => asset.signal === "TRIGGER").length;
  const setups = active.filter((asset) => asset.signal === "SETUP").length;
  const confirmedPumps = context.pumps.filter((pump) => pump.stage !== "SIN PUMP");
  const structure = context.structure;

  const lines = [
    `Régimen: altseason ${context.altseason.final ?? UNAVAILABLE}/100 (${context.altseason.state}), riesgo macro ${context.risk.score ?? UNAVAILABLE}/100 (${context.risk.level}).`,
    `Universo: ${context.market.length} pares. Señales activas: ${active.length} (${triggers} trigger, ${setups} setup).`,
  ];

  if (structure) {
    lines.push(
      `Capital: TOTAL ${cap(structure.totalMarketCap)}, TOTAL2 ${cap(structure.total2)}. BTC.D ${plain(structure.dominance.btc)}%, USDT.D ${plain(structure.dominance.usdt)}%.`,
    );
  }
  if (confirmedPumps.length) {
    const lead = confirmedPumps[0];
    lines.push(
      `Pumpeo: ${confirmedPumps.length} confirmados, el más intenso ${assetName(lead.symbol)} en ${lead.stage} (${lead.score}/100).`,
    );
  } else {
    lines.push("Pumpeo: ningún activo superó los umbrales de volumen y expansión.");
  }
  if (active.length) {
    lines.push(
      `Mejor candidato: ${assetName(active[0].symbol)} ${active[0].side} ${active[0].score}/100.`,
    );
  }
  if (context.risk.killSwitch) {
    lines.push(
      "El contexto macro está en extremo y penaliza el score de cada señal, pero no las bloquea.",
    );
  }

  return {
    text: lines.join(" "),
    confidence: context.market.length ? "ALTA" : "BAJA",
    sources: ["Binance Spot", structure ? structure.source : "estructura no disponible"],
    followUps: ["¿Hay pumpeo ahora?", "¿Cómo está la dominancia?", "¿Cuál es la mejor señal?"],
  };
}

const INTENTS: Intent[] = [
  {
    id: "capacidades",
    terms: ["que puedes hacer", "que sabes hacer", "ayuda", "que podes hacer", "quien eres", "que eres"],
    build: () => ({
      text: [
        "Soy el analista local de la terminal: leo el snapshot real que la app ya tiene y explico lo que ves. Puedo responder sobre precio y señal de cualquier par listado, estado del radar de pumpeo, dominancia de BTC y USDT, capitalización total, correlaciones entre tus activos, régimen de altseason, contexto de noticias, rendimiento histórico registrado y dimensionamiento de riesgo.",
        "También explico conceptos: CVD, footprint, desequilibrios, área de valor, funding, open interest, liquidaciones, beta, R:R y las fases de un pump.",
        "No uso ningún modelo de lenguaje ni envío tus preguntas a terceros, y por eso mismo no invento cifras: si un dato no está en el snapshot, te digo que no está disponible.",
      ].join(" "),
      confidence: "ALTA",
      sources: ["motor local determinista"],
      followUps: ["Dame un resumen del mercado", "¿Qué es el CVD?", "¿Cómo está USDT.D?"],
    }),
  },
  {
    id: "resumen",
    terms: ["resumen", "panorama", "como esta el mercado", "situacion", "overview", "que pasa"],
    build: summarize,
  },
  {
    id: "pumpeo",
    terms: ["pump", "pumpeo", "bombeo", "esta pumpeando", "hay pump"],
    build: (context) => {
      const confirmed = context.pumps.filter((pump) => pump.stage !== "SIN PUMP");
      if (!context.pumps.length) {
        return {
          text: "El radar de pumpeo todavía no completó un ciclo en esta sesión, así que no tengo lecturas para reportar.",
          confidence: "BAJA",
          sources: ["radar de pumpeo"],
          followUps: ["Dame un resumen del mercado"],
        };
      }
      if (!confirmed.length) {
        return {
          text: `Revisé ${context.pumps.length} candidatos y ninguno superó los umbrales de volumen relativo, expansión de rango e intensidad de ejecuciones. No hay pumpeo confirmado; el sistema no marca uno sin confirmación real.`,
          confidence: "ALTA",
          sources: ["Binance Spot · velas 5m cerradas"],
          followUps: ["¿Qué es un pump?", "¿Cuál es la mejor señal?"],
        };
      }
      const early = confirmed.filter(
        (pump) => pump.stage === "IGNICIÓN" || pump.stage === "ACUMULACIÓN",
      );
      const late = confirmed.filter(
        (pump) => pump.stage === "CLÍMAX" || pump.stage === "DISTRIBUCIÓN",
      );
      const detail = confirmed
        .slice(0, 4)
        .map(
          (pump) =>
            `${assetName(pump.symbol)} en ${pump.stage} (${pump.score}/100, volumen ${pump.metrics.relativeVolume.toFixed(1)}× su mediana, ${pct(pump.metrics.runFromBase, 1)} desde la base)`,
        )
        .join("; ");
      return {
        text: `${confirmed.length} activos con pumpeo confirmado: ${detail}. ${early.length} en fase temprana y ${late.length} en clímax o distribución${late.length ? ", donde el movimiento ya se está vendiendo" : ""}.`,
        confidence: "ALTA",
        sources: ["Binance Spot · velas 5m cerradas, vela en curso excluida"],
        followUps: ["¿Qué significa clímax?", "¿Cómo dimensiono el riesgo?"],
      };
    },
  },
  {
    id: "dominancia",
    terms: [
      "dominancia", "usdt.d", "btc.d", "market cap", "capitalizacion",
      "total2", "total3", "stablecoins", "marketcap",
    ],
    build: (context) => {
      const structure = context.structure;
      if (!structure) {
        return {
          text: "La estructura global no está disponible en este ciclo, así que no puedo darte dominancia ni capitalización.",
          confidence: "BAJA",
          sources: [],
          followUps: ["Dame un resumen del mercado"],
        };
      }
      const usdt = structure.dominance.usdt;
      const parked =
        structure.dominance.stablecoins !== null && structure.totalMarketCap !== null
          ? structure.totalMarketCap * (structure.dominance.stablecoins / 100)
          : null;
      const reading =
        usdt === null
          ? "Sin desglose de stablecoins en esta fuente."
          : usdt >= 8
            ? "USDT.D en zona alta: mucho capital fuera de riesgo, que suele acompañar debilidad en alts y es munición para un rebote."
            : usdt >= 6
              ? "USDT.D en zona media-alta: parte del capital espera afuera, sin rotación clara hacia riesgo."
              : usdt >= 4.5
                ? "USDT.D en rango habitual: ni refugio ni euforia."
                : "USDT.D en zona baja: el capital está desplegado y queda poca munición al margen.";

      return {
        text: `TOTAL ${cap(structure.totalMarketCap)} (${pct(structure.marketCapChange24h)} 24H). TOTAL2 ${cap(structure.total2)} y TOTAL3 ${cap(structure.total3)}. Reparto: BTC ${plain(structure.dominance.btc)}%, ETH ${plain(structure.dominance.eth)}%, USDT ${plain(usdt)}%, USDC ${plain(structure.dominance.usdc)}%. ${reading}${parked ? ` Eso equivale a ${cap(parked)} en stablecoins al margen.` : ""}`,
        confidence: "ALTA",
        sources: [structure.source],
        followUps: ["¿Qué es la dominancia de USDT?", "¿Cómo están las correlaciones?"],
      };
    },
  },
  {
    id: "correlacion",
    terms: ["correlacion", "correlaciones", "acople", "diversifica", "beta", "rotacion"],
    build: (context) => {
      const correlations = context.correlations;
      if (!correlations) {
        return {
          text: "El panel de correlaciones todavía no tiene muestra suficiente en esta sesión.",
          confidence: "BAJA",
          sources: [],
          followUps: ["¿Qué es la correlación?"],
        };
      }
      const gaining = correlations.rotation.filter((item) => item.value > 0);
      const leader = correlations.rotation[0];
      const laggard = correlations.rotation[correlations.rotation.length - 1];
      const concentration =
        correlations.averagePair === null
          ? "Sin acople medio calculable."
          : correlations.averagePair >= 0.7
            ? `Acople medio ${plain(correlations.averagePair)}: el bloque se mueve como un solo activo, así que repartir entre ellos no diversifica.`
            : correlations.averagePair >= 0.4
              ? `Acople medio ${plain(correlations.averagePair)}: correlación moderada.`
              : `Acople medio ${plain(correlations.averagePair)}: hay lecturas relativamente independientes.`;

      return {
        text: `En ventana ${correlations.interval}: ${concentration}${correlations.tightestPair ? ` El par más acoplado es ${correlations.tightestPair.label} (${plain(correlations.tightestPair.value)}).` : ""}${correlations.loosestPair ? ` El más independiente, ${correlations.loosestPair.label} (${plain(correlations.loosestPair.value)}).` : ""}${correlations.goldVsBtc !== null ? ` Oro contra BTC ${plain(correlations.goldVsBtc)}: ${correlations.goldVsBtc < 0.2 ? "desacoplado, sirve como refugio frente a esta cartera" : "acompañando a cripto, no está cubriendo el riesgo"}.` : ""}${leader && laggard ? ` Contra BTC, ${gaining.length} de ${correlations.rotation.length} ganan terreno; lidera ${leader.label} (${pct(leader.value)}) y queda último ${laggard.label} (${pct(laggard.value)}).` : ""}`,
        confidence: "ALTA",
        sources: ["Binance Spot · velas cerradas"],
        followUps: ["¿Qué es la beta?", "¿Cómo está la dominancia?"],
      };
    },
  },
  {
    id: "altseason",
    terms: ["altseason", "temporada de alts", "alt season"],
    build: (context) => ({
      text: `Altseason ${context.altseason.final ?? UNAVAILABLE}/100 · ${context.altseason.state}. El score técnico bruto es ${context.altseason.raw ?? UNAVAILABLE} y el ajuste por contexto macro es ${context.altseason.adjustment}. ${
        (context.altseason.final ?? 0) >= 41
          ? "La amplitud se está expandiendo más allá de BTC, pero la confirmación depende de liquidez y tendencia."
          : "El capital sigue concentrado; no hay confirmación amplia de altcoins."
      }`,
      confidence: context.altseason.final === null ? "BAJA" : "ALTA",
      sources: ["Binance Spot · amplitud del universo"],
      followUps: ["¿Qué es altseason?", "¿Cómo está la dominancia?"],
    }),
  },
  {
    id: "riesgo-macro",
    terms: ["noticias", "riesgo", "macro", "geopolitico", "kill switch"],
    build: (context) => ({
      text: `Riesgo macro ${context.risk.score ?? UNAVAILABLE}/100 (${context.risk.level}). ${
        context.risk.killSwitch
          ? "Está en zona extrema: penaliza el score de cada señal y las marca, pero no las bloquea. La decisión de operar es tuya, no del feed."
          : "No hay bloqueo de contexto; las señales corren con su penalización normal."
      } Las noticias son una capa de contexto separada, en su propio panel.`,
      confidence: context.risk.score === null ? "BAJA" : "ALTA",
      sources: ["RSS global verificado"],
      followUps: ["Dame un resumen del mercado", "¿Cuál es la mejor señal?"],
    }),
  },
  {
    id: "rendimiento",
    terms: [
      "rendimiento", "como aprende", "historial", "win rate", "winrate",
      "profit factor", "estadisticas", "funciona", "resultados", "aprendizaje",
    ],
    build: (context) => {
      const ledger = context.ledger;
      if (!ledger || !ledger.total) {
        return {
          text: "Todavía no hay registros suficientes en el historial. El sistema guarda cada señal con su precio de entrada y recién la evalúa cuando se cumple el horizonte, sin mirar datos futuros, así que las estadísticas aparecen cuando existe muestra real.",
          confidence: "MEDIA",
          sources: ["Signal Ledger"],
          followUps: ["¿Qué es la validación walk-forward?"],
        };
      }
      return {
        text: `Historial registrado: ${ledger.total} señales, ${ledger.evaluated4h} ya evaluadas a 4H. Win rate ${ledger.winRate4h === null ? UNAVAILABLE : `${ledger.winRate4h.toFixed(1)}%`}, profit factor ${plain(ledger.profitFactor4h)}, retorno medio ${pct(ledger.averageReturn4h)}. Cada señal se guarda al detectarse y se mide después con lo que realmente pasó, sin elegir velas hacia atrás. No son operaciones ejecutadas: no incluyen comisiones ni deslizamiento.`,
        confidence: ledger.evaluated4h >= 20 ? "ALTA" : "MEDIA",
        sources: ["Signal Ledger · Cloudflare D1"],
        followUps: ["¿Qué es la validación walk-forward?", "¿Cuál es la mejor señal?"],
      };
    },
  },
  {
    id: "riesgo-posicion",
    terms: [
      "cuanto arriesgo", "tamano de posicion", "cuanto compro", "position size",
      "apalancamiento", "stop", "invalidacion", "dimensionar",
    ],
    build: (context) => ({
      text: `El tamaño sale de la distancia a la invalidación, no del apalancamiento: definís cuánto perdés si la tesis falla y lo dividís por la distancia entre entrada y stop. El apalancamiento sólo limita cuánto nocional soporta la cuenta.${context.profile ? ` Tu perfil actual es ${context.profile.name} (${context.profile.horizon}, ${context.profile.market}), y la mesa de riesgo ya carga sus valores por defecto.` : ""} Cargá entrada y stop en la mesa de riesgo y te calcula unidades, nocional, margen y liquidación aproximada. Lo más importante que revisa: si el apalancamiento pone la liquidación antes del stop, el stop no te protege y perdés el margen completo.`,
      confidence: "ALTA",
      sources: ["mesa de riesgo"],
      followUps: ["¿Qué es R:R?", "¿Qué es una liquidación?"],
    }),
  },
  {
    id: "senal",
    terms: [
      "senal", "senales", "long o short", "compro o vendo", "mejor señal",
      "mejor senal", "que opero", "oportunidad", "setup", "trigger",
    ],
    build: (context) => {
      const active = context.scored.filter((asset) => asset.signal !== "NO SIGNAL");
      if (!active.length) {
        const best = [...context.scored].sort((a, b) => b.score - a.score)[0];
        return {
          text: `No hay señales calificadas ahora.${best ? ` El mejor candidato es ${assetName(best.symbol)} con ${best.score}/100, todavía por debajo del umbral.` : ""} El motor no fabrica una operación sin confirmaciones independientes.`,
          confidence: context.scored.length ? "ALTA" : "BAJA",
          sources: ["Binance Spot"],
          followUps: ["¿Hay pumpeo ahora?", "Dame un resumen del mercado"],
        };
      }
      const detail = active
        .slice(0, 3)
        .map(
          (item) =>
            `${assetName(item.symbol)} ${item.side} ${item.signal} ${item.score}/100 (${pct(item.change24h)} 24H, liquidez ${item.liquidity}${item.riskAdvisory ? ", con contexto macro extremo" : ""})`,
        )
        .join("; ");
      return {
        text: `${active.length} señales activas. Las principales: ${detail}. Cada una tiene su traza de decisión con los puntos que sumaron y las penalizaciones que restaron.`,
        confidence: "ALTA",
        sources: ["Binance Spot · confluencia multi-timeframe"],
        followUps: ["¿Cómo dimensiono el riesgo?", "¿Cómo está el riesgo macro?"],
      };
    },
  },
];

/** Answer about one specific asset, when the question named one. */
function assetAnswer(
  asset: MarketAsset,
  context: AssistantContext,
): Omit<AssistantAnswer, "concepts" | "intent"> {
  const scored = context.scored.find((item) => item.symbol === asset.symbol);
  const pump = context.pumps.find((item) => item.symbol === asset.symbol);
  const name = assetName(asset.symbol);

  const parts = [
    `${name}/USDT cotiza ${price(asset.price)} (${pct(asset.change24h)} 24H, 1H ${pct(asset.change1h)}, 4H ${pct(asset.change4h)}). Volumen 24H ${cap(asset.quoteVolume)}.`,
  ];

  if (scored) {
    parts.push(
      scored.signal === "NO SIGNAL"
        ? `Sin señal calificada: score ${scored.score}/100${scored.extended ? ", el movimiento ya está extendido y el motor no persigue" : ""}.`
        : `Señal ${scored.signal} ${scored.side} con ${scored.score}/100, ${scored.confirmationCount} confirmaciones y liquidez ${scored.liquidity}.`,
    );
    const topReason = [...scored.reasons].sort((a, b) => b.points - a.points)[0];
    const topPenalty = [...scored.penalties].sort((a, b) => a.points - b.points)[0];
    if (topReason) parts.push(`Lo que más suma: ${topReason.label} (+${topReason.points}).`);
    if (topPenalty) parts.push(`Lo que más resta: ${topPenalty.label} (${topPenalty.points}).`);
  } else {
    parts.push("No está entre los activos puntuados en este ciclo.");
  }

  if (pump && pump.stage !== "SIN PUMP") {
    parts.push(
      `El radar de pumpeo lo marca en ${pump.stage} (${pump.score}/100), con volumen ${pump.metrics.relativeVolume.toFixed(1)}× su mediana.`,
    );
  }

  return {
    text: parts.join(" "),
    confidence: scored ? "ALTA" : "MEDIA",
    sources: ["Binance Spot"],
    followUps: [`¿Hay pumpeo ahora?`, "¿Cómo dimensiono el riesgo?"],
  };
}

function conceptOnlyAnswer(
  concepts: KnowledgeEntry[],
): Omit<AssistantAnswer, "concepts" | "intent"> {
  const primary = concepts[0];
  return {
    text: `${primary.summary} ${primary.detail}`,
    confidence: "ALTA",
    sources: ["base de conocimiento local"],
    followUps: ["Dame un resumen del mercado", "¿Qué puedes hacer?"],
  };
}

export function ask(question: string, context: AssistantContext): AssistantAnswer {
  const text = normalize(question);
  const concepts = findConcepts(question);

  if (!text) {
    return {
      intent: "vacio",
      text: "Preguntame algo sobre el mercado, un activo puntual o cualquier concepto del panel.",
      confidence: "BAJA",
      sources: [],
      followUps: ["Dame un resumen del mercado", "¿Qué puedes hacer?"],
      concepts: [],
    };
  }

  // A named asset is the most specific thing a question can be about, so it
  // wins over a generic intent — unless the question is clearly conceptual.
  const askedAsset = extractSymbol(question, context.market);
  const purelyConceptual = hasAny(text, ["que es", "que son", "explicame", "significa", "definicion"]);

  let intentId = "resumen";
  let body: Omit<AssistantAnswer, "concepts" | "intent"> | null = null;

  if (askedAsset && !purelyConceptual) {
    intentId = "activo";
    body = assetAnswer(askedAsset, context);
  } else {
    const matched = INTENTS.find((intent) => hasAny(text, intent.terms));
    if (matched) {
      intentId = matched.id;
      body = matched.build(context, question);
    } else if (concepts.length) {
      intentId = "concepto";
      body = conceptOnlyAnswer(concepts);
    } else if (askedAsset) {
      intentId = "activo";
      body = assetAnswer(askedAsset, context);
    } else {
      // Nothing matched: answer with the snapshot rather than guessing, and
      // say plainly that the question was not understood.
      const fallback = summarize(context);
      return {
        intent: "no-reconocido",
        text: `No entendí exactamente la pregunta, así que te dejo el estado actual y podés precisarla. ${fallback.text}`,
        confidence: "BAJA",
        sources: fallback.sources,
        followUps: ["¿Qué puedes hacer?", "¿Hay pumpeo ahora?", "¿Cómo está la dominancia?"],
        concepts: [],
      };
    }
  }

  return {
    intent: intentId,
    ...body,
    concepts: concepts.map((entry) => ({
      title: entry.title,
      summary: entry.summary,
      caveat: entry.caveat,
    })),
  };
}
