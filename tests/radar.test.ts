import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SCORE_CONFIG,
  altseasonScore,
  diagnoseSignals,
  globalRisk,
  rotation,
  scoreAssets,
  type MarketAsset,
  type NewsEvent,
} from "../lib/radar.ts";
import {
  deriveTotals,
  parseCoinGeckoGlobal,
  parseCoinLoreGlobal,
  stablecoinRegime,
} from "../lib/market-structure.ts";

const asset = (patch: Partial<MarketAsset> & { symbol: string }): MarketAsset => ({
  price: 100,
  change1h: 1,
  change4h: 2,
  change24h: 3,
  volume: 1_000,
  quoteVolume: 500_000_000,
  high: 104,
  low: 96,
  ...patch,
});

const event = (patch: Partial<NewsEvent> = {}): NewsEvent => ({
  id: "e1",
  title: "Something happened",
  url: "https://example.test",
  source: "Reuters",
  publishedAt: new Date().toISOString(),
  region: "GLOBAL",
  category: "GEOPOLITICS",
  tier: 1,
  risk: 90,
  btcImpact: -30,
  altImpact: -50,
  goldImpact: 40,
  oilImpact: 10,
  status: "CONFIRMED",
  sourceCount: 3,
  ...patch,
});

test("global risk reports unavailable rather than zero without events", () => {
  const result = globalRisk([]);
  assert.equal(result.score, null);
  assert.equal(result.killSwitch, false);
});

test("unconfirmed events are discounted, never actioned", () => {
  const result = globalRisk([event({ status: "UNCONFIRMED", tier: 3, sourceCount: 1 })]);
  assert.ok(result.score !== null && result.score <= 40);
  assert.equal(result.killSwitch, false);
});

test("an extreme confirmed event raises the advisory flag", () => {
  const result = globalRisk([event({ risk: 95 }), event({ id: "e2", risk: 88 })]);
  assert.ok(result.score !== null && result.score > 80);
  assert.equal(result.killSwitch, true);
});

/**
 * The behaviour the dashboard depends on: news is context, not a veto. Before
 * this, an extreme macro reading forced NO SIGNAL across the whole universe.
 */
test("extreme macro risk annotates signals instead of suppressing them", () => {
  const market: MarketAsset[] = [
    asset({ symbol: "BTCUSDT", change24h: 0.5 }),
    asset({ symbol: "ETHUSDT", change24h: 0.6 }),
    asset({ symbol: "SOLUSDT", price: 100, high: 101, low: 90, change24h: 8 }),
  ];

  const calm = scoreAssets(market, 10, false);
  const extreme = scoreAssets(market, 95, true);

  const calmSol = calm.find((row) => row.symbol === "SOLUSDT");
  const extremeSol = extreme.find((row) => row.symbol === "SOLUSDT");
  assert.ok(calmSol && extremeSol);

  assert.equal(extremeSol.riskAdvisory, true, "debe marcar el contexto macro");
  assert.equal(calmSol.riskAdvisory, false);
  assert.ok(
    extremeSol.score < calmSol.score,
    "el riesgo macro debe penalizar el score",
  );
  assert.ok(
    extreme.some((row) => row.signal !== "NO SIGNAL") ||
      calm.every((row) => row.signal === "NO SIGNAL"),
    "el riesgo macro no puede anular por sí solo todas las señales",
  );
});

test("an extended move still voids its own signal", () => {
  const market: MarketAsset[] = [
    asset({ symbol: "BTCUSDT" }),
    asset({ symbol: "ETHUSDT" }),
    asset({ symbol: "PUMPUSDT", change24h: 40, change1h: 12, price: 140, high: 141, low: 100 }),
  ];
  const scored = scoreAssets(market, 10, false);
  const pumped = scored.find((row) => row.symbol === "PUMPUSDT");
  assert.ok(pumped);
  assert.equal(pumped.extended, true);
  assert.equal(pumped.signal, "NO SIGNAL");
  assert.equal(pumped.side, "NEUTRAL");
});

test("illiquid assets are penalised, and BTC/ETH are excluded from scoring", () => {
  const market: MarketAsset[] = [
    asset({ symbol: "BTCUSDT" }),
    asset({ symbol: "ETHUSDT" }),
    asset({ symbol: "TINYUSDT", quoteVolume: 200_000 }),
  ];
  const scored = scoreAssets(market, 10, false);
  assert.equal(scored.length, 1, "BTC y ETH no se puntúan como candidatos");
  assert.ok(
    scored[0].penalties.some((penalty) => penalty.label.includes("Liquidez")),
    "un activo ilíquido debe llevar penalización",
  );
});

test("missing timeframes degrade data quality and score", () => {
  const market: MarketAsset[] = [
    asset({ symbol: "BTCUSDT" }),
    asset({ symbol: "ETHUSDT" }),
    asset({ symbol: "SOLUSDT", change1h: null, change4h: null }),
  ];
  const scored = scoreAssets(market, 10, false);
  const sol = scored.find((row) => row.symbol === "SOLUSDT");
  assert.ok(sol);
  assert.equal(sol.dataQuality, "PARTIAL");
  assert.ok(
    sol.penalties.some((penalty) => penalty.label.includes("multi-timeframe")),
  );
});

test("scores stay inside 0..100 across hostile inputs", () => {
  const market: MarketAsset[] = [
    asset({ symbol: "BTCUSDT" }),
    asset({ symbol: "ETHUSDT" }),
    asset({ symbol: "AUSDT", quoteVolume: 0, change24h: -99, change1h: null, change4h: null, high: null, low: null }),
    asset({ symbol: "BUSDT", quoteVolume: 9e12, change24h: 999 }),
  ];
  for (const row of scoreAssets(market, 95, true)) {
    assert.ok(row.score >= 0 && row.score <= 100, `score fuera de rango: ${row.score}`);
  }
});

test("altseason reports unavailable without a usable market", () => {
  const result = altseasonScore([], null, null);
  assert.equal(result.final, null);
  assert.equal(result.state, "DATOS NO DISPONIBLES");
});

test("altseason applies the macro adjustment", () => {
  const market: MarketAsset[] = [
    asset({ symbol: "BTCUSDT", change24h: 1 }),
    asset({ symbol: "ETHUSDT", change24h: 4 }),
    ...Array.from({ length: 10 }, (_, i) =>
      asset({ symbol: `A${i}USDT`, change24h: 6, quoteVolume: 80_000_000 }),
    ),
  ];
  const calm = altseasonScore(market, 50, 10);
  const stressed = altseasonScore(market, 50, 95);
  assert.ok(calm.final !== null && stressed.final !== null);
  assert.ok(stressed.final < calm.final, "el riesgo alto debe restar");
  assert.equal(calm.raw, stressed.raw, "el score técnico bruto no cambia con macro");
});

test("rotation percentages sum to about 100", () => {
  const market: MarketAsset[] = [
    asset({ symbol: "BTCUSDT", change24h: 2 }),
    asset({ symbol: "ETHUSDT", change24h: 3 }),
    asset({ symbol: "SOLUSDT", change24h: 5 }),
  ];
  const result = rotation(market);
  const total = result.values.reduce((sum, bucket) => sum + bucket.value, 0);
  assert.ok(Math.abs(total - 100) <= 2, `suma ${total}`);
  assert.ok(result.phase >= 1 && result.phase <= 5);
});

test("diagnostic separates a quiet market from a degraded feed", () => {
  const complete: MarketAsset[] = [
    asset({ symbol: "BTCUSDT" }),
    asset({ symbol: "ETHUSDT" }),
    ...Array.from({ length: 10 }, (_, i) =>
      asset({ symbol: `A${i}USDT`, change24h: 0.2 }),
    ),
  ];
  const healthy = diagnoseSignals(scoreAssets(complete, 10, false));
  assert.equal(healthy.partialDataPct, 0, "datos completos no deben reportar carencia");
  assert.ok(healthy.topScore !== null);
  assert.equal(healthy.universe, 10);

  const degraded: MarketAsset[] = [
    asset({ symbol: "BTCUSDT" }),
    asset({ symbol: "ETHUSDT" }),
    ...Array.from({ length: 10 }, (_, i) =>
      asset({ symbol: `A${i}USDT`, change1h: null, change4h: null }),
    ),
  ];
  const broken = diagnoseSignals(scoreAssets(degraded, 10, false));
  assert.equal(broken.partialDataPct, 100, "debe delatar la falta de cobertura");
  assert.ok(
    broken.blockers.some((blocker) => blocker.label.includes("multi-timeframe")),
    "el bloqueante principal debe ser la cobertura incompleta",
  );
});

test("diagnostic reports the distance to the watch threshold", () => {
  const market: MarketAsset[] = [
    asset({ symbol: "BTCUSDT" }),
    asset({ symbol: "ETHUSDT" }),
    asset({ symbol: "SOLUSDT", quoteVolume: 200_000, change24h: 0.1 }),
  ];
  const scored = scoreAssets(market, 10, false);
  const diagnostic = diagnoseSignals(scored, {
    ...DEFAULT_SCORE_CONFIG,
    watch: 70,
  });
  assert.equal(diagnostic.topSymbol, "SOLUSDT");
  assert.equal(diagnostic.pointsToWatch, 70 - (diagnostic.topScore ?? 0));
  assert.ok(diagnostic.pointsToWatch !== null && diagnostic.pointsToWatch >= 0);
});

test("diagnostic on an empty universe reports nothing rather than zeroes", () => {
  const diagnostic = diagnoseSignals([]);
  assert.equal(diagnostic.topScore, null);
  assert.equal(diagnostic.topSymbol, null);
  assert.equal(diagnostic.universe, 0);
  assert.deepEqual(diagnostic.blockers, []);
});

test("default thresholds stay ordered", () => {
  assert.ok(DEFAULT_SCORE_CONFIG.watch < DEFAULT_SCORE_CONFIG.setup);
  assert.ok(DEFAULT_SCORE_CONFIG.setup < DEFAULT_SCORE_CONFIG.trigger);
});

// ---- market structure -----------------------------------------------------

test("TOTAL2 and TOTAL3 follow from total and dominance", () => {
  const { total2, total3 } = deriveTotals(2_000, 50, 10);
  assert.equal(total2, 1_000);
  assert.equal(total3, 800);
  assert.ok(total2 > total3, "TOTAL2 siempre supera a TOTAL3");
});

test("totals are unavailable rather than guessed when dominance is missing", () => {
  assert.deepEqual(deriveTotals(2_000, null, 10), { total2: null, total3: null });
  assert.deepEqual(deriveTotals(null, 50, 10), { total2: null, total3: null });
  assert.equal(deriveTotals(2_000, 50, null).total3, null);
});

test("CoinGecko global parses into structure with stablecoin breakdown", () => {
  const parsed = parseCoinGeckoGlobal({
    data: {
      total_market_cap: { usd: 2_000_000_000_000 },
      total_volume: { usd: 100_000_000_000 },
      market_cap_percentage: { btc: 50, eth: 10, usdt: 7, usdc: 3 },
      market_cap_change_percentage_24h_usd: -1.5,
    },
  });
  assert.ok(parsed);
  assert.equal(parsed.total2, 1_000_000_000_000);
  assert.equal(parsed.total3, 800_000_000_000);
  assert.equal(parsed.dominance.usdt, 7);
  assert.equal(parsed.dominance.stablecoins, 10);
  assert.equal(parsed.dominance.altcoins, 40);
});

test("structure parsers reject unusable payloads", () => {
  assert.equal(parseCoinGeckoGlobal({}), null);
  assert.equal(parseCoinGeckoGlobal({ data: { total_market_cap: { usd: 0 } } }), null);
  assert.equal(parseCoinLoreGlobal([]), null);
});

test("CoinLore fallback leaves stablecoin dominance unavailable", () => {
  const parsed = parseCoinLoreGlobal([
    { total_mcap: 2_000_000_000_000, btc_d: "50", eth_d: "10", mcap_change: "1.2" },
  ]);
  assert.ok(parsed);
  assert.equal(parsed.total2, 1_000_000_000_000);
  assert.equal(parsed.dominance.usdt, null, "CoinLore no publica USDT.D; no debe inventarse");
});

test("stablecoin regime reads sidelined capital by band", () => {
  assert.equal(stablecoinRegime(9).tone, "risk-off");
  assert.equal(stablecoinRegime(3).tone, "risk-on");
  assert.equal(stablecoinRegime(5).tone, "neutral");
  assert.equal(stablecoinRegime(null).tone, "unknown");
  assert.equal(stablecoinRegime(null).label, "DATA UNAVAILABLE");
});

test("stablecoin regime bands are ordered and continuous", () => {
  const labels = [3, 5, 7, 9].map((value) => stablecoinRegime(value).label);
  assert.equal(new Set(labels).size, 4, "cada banda debe tener su propia lectura");
});
