import assert from "node:assert/strict";
import test from "node:test";
import { ask, extractSymbol, type AssistantContext } from "../lib/assistant/index.ts";
import { findConcepts, normalize } from "../lib/assistant/knowledge.ts";
import type { MarketAsset, ScoredAsset } from "../lib/radar.ts";

const market: MarketAsset[] = [
  {
    symbol: "BTCUSDT", price: 77_000, change1h: 0.2, change4h: -0.4, change24h: 1.1,
    volume: 1_000, quoteVolume: 30_000_000_000, high: 78_000, low: 76_000,
  },
  {
    symbol: "SOLUSDT", price: 94.2, change1h: 0.6, change4h: 1.2, change24h: 3.4,
    volume: 5_000, quoteVolume: 700_000_000, high: 96, low: 91,
  },
  {
    symbol: "WLDUSDT", price: 0.388, change1h: -0.5, change4h: -2.1, change24h: -2.9,
    volume: 9_000, quoteVolume: 56_000_000, high: 0.41, low: 0.38,
  },
];

const scored: ScoredAsset[] = [
  {
    ...market[1], score: 74, technicalScore: 84, signal: "SETUP", side: "LONG",
    relVolume: 2.8, momentum: 1.9, liquidity: "HIGH", extended: false,
    confirmationCount: 5, dataQuality: "FULL",
    reasons: [{ label: "Momentum alineado", points: 16 }, { label: "Liquidez", points: 15 }],
    penalties: [{ label: "Riesgo geopolítico", points: -10 }],
    riskAdvisory: true,
  },
  {
    ...market[2], score: 31, technicalScore: 41, signal: "NO SIGNAL", side: "NEUTRAL",
    relVolume: 0.2, momentum: -1.2, liquidity: "LOW", extended: false,
    confirmationCount: 2, dataQuality: "FULL",
    reasons: [{ label: "Liquidez", points: 4 }],
    penalties: [{ label: "Liquidez insuficiente", points: -14 }],
    riskAdvisory: true,
  },
];

const context: AssistantContext = {
  timestamp: new Date().toISOString(),
  market,
  scored,
  altseason: { final: 38, raw: 60, state: "NEUTRAL", adjustment: -22 },
  risk: { score: 85, level: "EXTREMO", killSwitch: true },
  structure: {
    totalMarketCap: 2.63e12, total2: 1.08e12, total3: 7.91e11,
    totalVolume24h: 1.45e11, marketCapChange24h: -2.1,
    dominance: { btc: 58.8, eth: 11.1, usdt: 6.95, usdc: 2.79, stablecoins: 9.74, altcoins: 30.1 },
    source: "CoinGecko Global", timestamp: new Date().toISOString(),
  },
  pumps: [
    {
      symbol: "NEIROUSDT", stage: "IGNICIÓN", score: 94,
      metrics: {
        relativeVolume: 5.9, volumeAcceleration: 3.3, rangeExpansion: 3.4,
        tradeIntensity: 3.0, bodyDominance: 0.8, upperWickRatio: 0.04,
        consecutiveUp: 3, velocity5m: 2.44, runFromBase: 4.9, drawdownFromHigh: 0.1,
      },
      reasons: ["Volumen 5.9× su mediana de 2H"], warnings: [],
      price: 0.00009, quoteVolume: 12_500_000, sampleSize: 59,
    },
  ],
  correlations: {
    interval: "1H · 7D", averagePair: 0.61,
    tightestPair: { label: "SOL · AVAX", value: 0.79 },
    loosestPair: { label: "BTC · BABY", value: 0.39 },
    goldVsBtc: 0.18,
    rotation: [{ label: "SOL", value: 2.1 }, { label: "WLD", value: -3.4 }],
  },
  ledger: { total: 62, evaluated4h: 59, winRate4h: 42.4, profitFactor4h: 1.14, averageReturn4h: 0.12 },
  profile: { name: "Trading Pro", horizon: "CORTO", market: "FUTUROS + SPOT" },
};

const withFlow: AssistantContext = {
  ...context,
  orderFlow: {
    symbol: "BTCUSDT",
    venue: "futures",
    mid: 77_060,
    deltaPct: -4.4,
    cvd: -19_050,
    bookImbalancePct: 55.6,
    winner: "COMPRADORES",
    institutional: [
      {
        kind: "ABSORCIÓN", side: "VENTA", price: 77_063.5, notional: 13_500,
        confidence: 75,
        detail: "Agresión compra de 34.0× absorbida sin que el precio atraviese el nivel: alguien está sosteniendo el otro lado.",
      },
      {
        kind: "BLOQUE", side: "COMPRA", price: 77_060.3, notional: 23_300,
        confidence: 55, detail: "Ejecución individual en el percentil 97 de la ventana.",
      },
    ],
    squeeze: {
      type: "SHORT SQUEEZE", score: 62, bias: "ALCISTA",
      factors: [
        { label: "Funding negativo -0.0400%: los shorts pagan", points: 28 },
        { label: "Liquidaciones dominadas por shorts (88%)", points: 23 },
        { label: "Cuentas cargadas en short (0.70×)", points: 18 },
      ],
      missing: [],
      detail: "Posicionamiento corto cargado con presión compradora.",
    },
    levels: [
      {
        price: 77_057.5, kind: "PISO", strength: 88, distancePct: -0.01,
        sources: ["Punto de control (mayor volumen)", "Pared BID persistente (48%)"],
      },
      {
        price: 77_240, kind: "TECHO", strength: 44, distancePct: 0.23,
        sources: ["Cúmulo de liquidaciones"],
      },
    ],
  },
};

test("reports institutional patterns from the live order flow", () => {
  const answer = ask("hay absorcion?", withFlow);
  assert.equal(answer.intent, "order-flow");
  assert.ok(answer.text.includes("ABSORCIÓN"));
  assert.ok(answer.text.includes("BTC"));
  assert.ok(
    answer.text.includes("no una identidad"),
    "debe aclarar que institucional no identifica a nadie",
  );
});

test("answers where the strongest floor is, with its confluence", () => {
  const answer = ask("donde esta el piso mas fuerte?", withFlow);
  assert.equal(answer.intent, "estructura");
  assert.ok(answer.text.includes("77057.5") || answer.text.includes("77,057") || answer.text.includes("77057"));
  assert.ok(answer.text.includes("Punto de control"), "debe citar en qué se apoya");
  assert.ok(answer.text.includes("88/100"));
});

test("answers the side that was asked about first", () => {
  const floorFirst = ask("donde esta el piso?", withFlow);
  assert.ok(
    floorFirst.text.indexOf("Piso más fuerte") < floorFirst.text.indexOf("Techo más fuerte"),
    "preguntando por el piso, el piso va primero",
  );
  const ceilingFirst = ask("cual es la resistencia?", withFlow);
  assert.ok(
    ceilingFirst.text.indexOf("Techo más fuerte") < ceilingFirst.text.indexOf("Piso más fuerte"),
    "preguntando por la resistencia, el techo va primero",
  );
});

test("reports a squeeze with its aligned factors", () => {
  const answer = ask("hay squeeze?", withFlow);
  assert.equal(answer.intent, "squeeze");
  assert.ok(answer.text.includes("SHORT SQUEEZE"));
  assert.ok(answer.text.includes("62/100"));
  assert.ok(answer.text.includes("Funding negativo"));
});

test("without order flow it says so instead of guessing", () => {
  for (const question of ["hay absorcion?", "donde esta el piso?", "hay squeeze?"]) {
    const answer = ask(question, context);
    assert.equal(answer.confidence, "BAJA", `"${question}" no debe sonar seguro sin datos`);
    assert.ok(
      /no está transmitiendo|no puedo calcular|Necesito el panel/.test(answer.text),
      `"${question}" debe declarar la falta de feed: ${answer.text}`,
    );
    assert.ok(!/\d+\/100/.test(answer.text), "no debe inventar puntajes");
  }
});

test("a quiet order flow reports no patterns rather than inventing them", () => {
  const quiet: AssistantContext = {
    ...withFlow,
    orderFlow: { ...withFlow.orderFlow!, institutional: [], levels: [] },
  };
  const flow = ask("hay ordenes institucionales?", quiet);
  assert.ok(flow.text.includes("no hay patrones"));
  const levels = ask("donde estan los pisos?", quiet);
  assert.ok(levels.text.includes("evidencia suficiente"));
});

test("explains the new microstructure concepts", () => {
  for (const [question, expected] of [
    ["que es un iceberg", "Iceberg"],
    ["que es la absorcion", "Absorción"],
    ["que es un barrido", "Barrido"],
    ["que es un short squeeze", "Squeeze"],
  ] as const) {
    const answer = ask(question, context);
    assert.ok(
      answer.concepts.some((concept) => concept.title.includes(expected)),
      `"${question}" debía explicar ${expected}`,
    );
  }
});

test("recognises a ticker from the live universe", () => {
  assert.equal(extractSymbol("como esta SOL", market)?.symbol, "SOLUSDT");
  assert.equal(extractSymbol("precio de wld", market)?.symbol, "WLDUSDT");
  assert.equal(extractSymbol("y BTCUSDT?", market)?.symbol, "BTCUSDT");
  assert.equal(extractSymbol("dame un resumen", market), null);
});

/**
 * Regression: Binance lists tickers that are ordinary Spanish words — LA, ME,
 * ID, A, S, T — so "¿cómo está la dominancia?" used to resolve to the LA token
 * and answer about the wrong asset entirely.
 */
test("function words are not mistaken for tickers", () => {
  const withCollisions: MarketAsset[] = [
    ...market,
    { symbol: "LAUSDT", price: 0.0575, change1h: null, change4h: null, change24h: -7.7, volume: 1, quoteVolume: 2_800_000, high: 0.06, low: 0.05 },
    { symbol: "MEUSDT", price: 0.5, change1h: null, change4h: null, change24h: 1, volume: 1, quoteVolume: 3_000_000, high: 0.6, low: 0.4 },
    { symbol: "AUSDT", price: 0.3, change1h: null, change4h: null, change24h: 1, volume: 1, quoteVolume: 3_000_000, high: 0.4, low: 0.2 },
  ];

  assert.equal(extractSymbol("como esta la dominancia?", withCollisions), null);
  assert.equal(extractSymbol("dame el resumen de hoy", withCollisions), null);
  assert.equal(extractSymbol("cual es la mejor senal", withCollisions), null);
  // A genuinely named collision ticker must still resolve.
  assert.equal(extractSymbol("precio de LAUSDT", withCollisions)?.symbol, "LAUSDT");
  assert.equal(extractSymbol("como viene SOL", withCollisions)?.symbol, "SOLUSDT");
});

test("a dominance question reaches the dominance intent, not a ticker", () => {
  const withCollisions = {
    ...context,
    market: [
      ...market,
      { symbol: "LAUSDT", price: 0.0575, change1h: null, change4h: null, change24h: -7.7, volume: 1, quoteVolume: 2_800_000, high: 0.06, low: 0.05 },
    ],
  };
  const answer = ask("como esta la dominancia?", withCollisions);
  assert.equal(answer.intent, "dominancia");
  assert.ok(answer.text.includes("6.95"), "debe responder con USDT.D real");
});

test("answers about a named asset with its real figures", () => {
  const answer = ask("como viene SOL?", context);
  assert.equal(answer.intent, "activo");
  assert.ok(answer.text.includes("SOL/USDT"));
  assert.ok(answer.text.includes("$94.200"), `faltó el precio real: ${answer.text}`);
  assert.ok(answer.text.includes("SETUP"));
  assert.ok(answer.text.includes("Momentum alineado"), "debe citar la razón principal");
});

test("reports an asset without a qualified signal honestly", () => {
  const answer = ask("que onda WLD", context);
  assert.ok(answer.text.includes("Sin señal calificada"));
  assert.ok(answer.text.includes("Liquidez insuficiente"));
});

test("summarises the market from the snapshot", () => {
  const answer = ask("dame un resumen del mercado", context);
  assert.equal(answer.intent, "resumen");
  assert.ok(answer.text.includes("38/100"));
  assert.ok(answer.text.includes("EXTREMO"));
  assert.ok(answer.text.includes("$2.63T"));
});

test("reports dominance including USDT.D and what it means", () => {
  const answer = ask("como esta la dominancia?", context);
  assert.equal(answer.intent, "dominancia");
  assert.ok(answer.text.includes("6.95"), "debe incluir USDT.D");
  assert.ok(answer.text.includes("$2.63T"));
  assert.ok(/media-alta|alta|habitual|baja/.test(answer.text), "debe interpretar la banda");
});

test("reports the pump radar with its stages", () => {
  const answer = ask("hay pumpeo ahora?", context);
  assert.equal(answer.intent, "pumpeo");
  assert.ok(answer.text.includes("NEIRO"));
  assert.ok(answer.text.includes("IGNICIÓN"));
  assert.ok(answer.text.includes("5.9"), "debe citar el volumen relativo real");
});

test("explains that macro risk annotates rather than blocks", () => {
  const answer = ask("como afectan las noticias?", context);
  assert.equal(answer.intent, "riesgo-macro");
  assert.ok(answer.text.includes("no las bloquea"));
});

test("reports recorded performance without overstating it", () => {
  const answer = ask("como viene el rendimiento?", context);
  assert.equal(answer.intent, "rendimiento");
  assert.ok(answer.text.includes("42.4%"));
  assert.ok(
    answer.text.includes("No son operaciones ejecutadas"),
    "debe aclarar que no incluye comisiones ni deslizamiento",
  );
});

test("explains a concept when asked directly", () => {
  const answer = ask("que es el CVD?", context);
  assert.equal(answer.intent, "concepto");
  assert.ok(answer.text.toLowerCase().includes("compras agresivas"));
  assert.ok(answer.concepts.some((concept) => concept.title.includes("CVD")));
});

test("a conceptual question about a ticker is not hijacked by the ticker", () => {
  const answer = ask("que es la dominancia de usdt", context);
  assert.notEqual(answer.intent, "activo");
  assert.ok(answer.concepts.length > 0);
});

test("attaches the caveat when the concept has one", () => {
  const answer = ask("que es el cvd", context);
  const cvd = answer.concepts.find((concept) => concept.title.includes("CVD"));
  assert.ok(cvd?.caveat, "el CVD tiene una advertencia que no debe perderse");
});

test("describes its own capabilities and its limits", () => {
  const answer = ask("que puedes hacer?", context);
  assert.equal(answer.intent, "capacidades");
  assert.ok(answer.text.includes("no invento cifras") || answer.text.includes("no invento"));
  assert.ok(answer.text.includes("modelo de lenguaje"));
});

test("an unrecognised question falls back to state, flagged as low confidence", () => {
  const answer = ask("cual es la capital de francia", context);
  assert.equal(answer.intent, "no-reconocido");
  assert.equal(answer.confidence, "BAJA");
  assert.ok(answer.text.includes("No entendí"));
});

test("an empty question asks for input instead of answering", () => {
  const answer = ask("   ", context);
  assert.equal(answer.intent, "vacio");
  assert.equal(answer.confidence, "BAJA");
});

/** The core promise: no invented numbers when the data is not there. */
test("missing data is reported as unavailable, never filled in", () => {
  const bare: AssistantContext = {
    ...context,
    structure: null,
    correlations: null,
    ledger: null,
    pumps: [],
    scored: [],
    altseason: { final: null, raw: null, state: "DATOS NO DISPONIBLES", adjustment: 0 },
    risk: { score: null, level: "DATOS NO DISPONIBLES", killSwitch: false },
  };

  const dominance = ask("dominancia", bare);
  assert.ok(dominance.text.includes("no está disponible"));
  assert.equal(dominance.confidence, "BAJA");

  const correlation = ask("correlaciones", bare);
  assert.equal(correlation.confidence, "BAJA");

  const performance = ask("rendimiento", bare);
  assert.ok(performance.text.includes("Todavía no hay registros"));

  const pumps = ask("hay pump?", bare);
  assert.equal(pumps.confidence, "BAJA");

  for (const answer of [dominance, correlation, performance, pumps]) {
    assert.ok(!/\$\d/.test(answer.text), `inventó una cifra: ${answer.text}`);
  }
});

test("every answer carries confidence, sources and follow-ups", () => {
  const questions = [
    "resumen", "dominancia", "hay pumpeo", "correlaciones", "altseason",
    "noticias", "rendimiento", "cuanto arriesgo", "mejor senal", "que es el footprint",
  ];
  for (const question of questions) {
    const answer = ask(question, context);
    assert.ok(answer.text.length > 40, `respuesta demasiado corta para "${question}"`);
    assert.ok(["ALTA", "MEDIA", "BAJA"].includes(answer.confidence));
    assert.ok(Array.isArray(answer.sources));
    assert.ok(answer.followUps.length > 0, `sin sugerencias para "${question}"`);
  }
});

test("normalize strips accents and punctuation", () => {
  assert.equal(normalize("¿Cómo está la DOMINANCIA?"), "como esta la dominancia");
});

test("knowledge lookup ignores unrelated questions", () => {
  assert.deepEqual(findConcepts("hola que tal"), []);
});
