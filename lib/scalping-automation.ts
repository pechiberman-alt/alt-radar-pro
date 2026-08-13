import { appendBrainAuditEvent, ensureBrainSecuritySchema, registerBrainManifest } from "./brain-security";
import { evaluateOpenSignals, ensureSignalSchema, loadMarket, loadRiskScore } from "./automation";
import { parseBinanceKlines, type Candle } from "./market-brain";
import { buildScalpSignal } from "./scalping-engine";

const BASES = [
  "https://data-api.binance.vision",
  "https://api.binance.us",
  "https://api.binance.com",
];

export type ScalpingAutomationResult = {
  status: "COMPLETED" | "SKIPPED";
  scanned: number;
  qualified: number;
  inserted: number;
  evaluated: number;
  timestamp: string;
};

async function fetchCandles(symbol: string, interval: "5m" | "15m") {
  let lastError: unknown;
  for (const base of BASES) {
    try {
      const response = await fetch(
        `${base}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=120`,
        { signal: AbortSignal.timeout(6_000), headers: { Accept: "application/json" } },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const candles = parseBinanceKlines(await response.json());
      if (candles.length >= 55) return candles;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("DATA UNAVAILABLE");
}

async function loadPair(symbol: string) {
  const [five, fifteen] = await Promise.all([
    fetchCandles(symbol, "5m"),
    fetchCandles(symbol, "15m"),
  ]);
  return { symbol, five, fifteen } satisfies { symbol: string; five: Candle[]; fifteen: Candle[] };
}

export async function runScalpingAutomation(db: D1Database): Promise<ScalpingAutomationResult> {
  await ensureSignalSchema(db);
  await ensureBrainSecuritySchema(db);
  const now = new Date();
  const timestamp = now.toISOString();
  const last = await db.prepare("SELECT value FROM automation_state WHERE key = ?1")
    .bind("last_scalp_run")
    .first<{ value: string }>();
  if (last?.value && now.getTime() - Date.parse(last.value) < 4 * 60_000) {
    return { status: "SKIPPED", scanned: 0, qualified: 0, inserted: 0, evaluated: 0, timestamp };
  }
  await db.prepare(
    `INSERT INTO automation_state(key, value, updated_at) VALUES (?1, ?2, ?2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind("last_scalp_run", timestamp).run();

  const [marketLoad, risk] = await Promise.all([loadMarket(), loadRiskScore()]);
  const market = marketLoad.market;
  const prices = new Map(market.map((asset) => [asset.symbol, asset.price]));
  const evaluated = await evaluateOpenSignals(db, prices, now);
  if (risk.killSwitch) {
    return { status: "COMPLETED", scanned: 0, qualified: 0, inserted: 0, evaluated, timestamp };
  }
  const core = market.filter((asset) => ["BTCUSDT", "ETHUSDT"].includes(asset.symbol));
  const candidates = market
    .filter((asset) => !["BTCUSDT", "ETHUSDT"].includes(asset.symbol))
    .filter((asset) => asset.quoteVolume >= 25_000_000)
    .sort((left, right) => {
      const leftMomentum = Math.abs(left.change5m ?? 0) * 2 + Math.abs(left.change15m ?? 0);
      const rightMomentum = Math.abs(right.change5m ?? 0) * 2 + Math.abs(right.change15m ?? 0);
      return rightMomentum - leftMomentum;
    })
    .slice(0, 6);
  const universe = [...core, ...candidates];
  const settled = await Promise.allSettled(universe.map((asset) => loadPair(asset.symbol)));
  const pairs = new Map(settled.flatMap((result) =>
    result.status === "fulfilled" ? [[result.value.symbol, result.value] as const] : [],
  ));
  const btc = market.find((asset) => asset.symbol === "BTCUSDT");
  const eth = market.find((asset) => asset.symbol === "ETHUSDT");
  const signals = universe.flatMap((asset) => {
    const pair = pairs.get(asset.symbol);
    if (!pair) return [];
    const signal = buildScalpSignal(asset, pair.five, pair.fifteen, {
      riskScore: risk.score,
      killSwitch: risk.killSwitch,
      altseasonScore: null,
      btcChange15m: btc?.change15m ?? null,
      ethChange15m: eth?.change15m ?? null,
      minimumQuoteVolume: 25_000_000,
    }, timestamp);
    return signal ? [signal] : [];
  });
  const qualified = signals.filter((signal) =>
    signal.status === "SETUP" || signal.status === "TRIGGER",
  ).slice(0, 4);
  let inserted = 0;
  await registerBrainManifest(db, timestamp);

  for (const signal of qualified) {
    const side = signal.side as "LONG" | "SHORT";
    const previous = await db.prepare(
      `SELECT signal, detected_at FROM signal_records
       WHERE symbol = ?1 AND side = ?2 AND timeframe LIKE 'SCALP%'
       ORDER BY detected_at DESC LIMIT 1`,
    ).bind(signal.symbol, side).first<{ signal: "SETUP" | "TRIGGER"; detected_at: string }>();
    const age = previous ? now.getTime() - Date.parse(previous.detected_at) : Infinity;
    const upgrade = previous?.signal === "SETUP" && signal.status === "TRIGGER";
    if (age < 30 * 60_000 && !(upgrade && age >= 5 * 60_000)) continue;
    const eventId = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO signal_records (
        id, symbol, side, signal, score, technical_score, altseason_score,
        geopolitical_risk, entry_price, source, timeframe, detected_at,
        status, reasons, penalties, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8, ?9, ?10, ?11,
        'MONITORING', ?12, ?13, ?11)`,
    ).bind(
      eventId,
      signal.symbol,
      side,
      signal.status,
      signal.score,
      signal.technicalScore,
      risk.score,
      (signal.entryLow + signal.entryHigh) / 2,
      `${signal.source} · automatización Cloudflare`,
      "SCALP 5M / 15M",
      timestamp,
      JSON.stringify(signal.reasons),
      JSON.stringify(signal.penalties),
    ).run();
    await appendBrainAuditEvent(db, {
      eventKey: `scalp-automation:${eventId}`,
      eventType: "SCALP_OBSERVATION",
      symbol: signal.symbol,
      timeframe: "5m/15m",
      source: signal.source,
      observedAt: timestamp,
      payload: {
        side,
        status: signal.status,
        score: signal.score,
        entryLow: signal.entryLow,
        entryHigh: signal.entryHigh,
        stop: signal.stop,
        targets: [signal.target1, signal.target2, signal.target3],
      },
    });
    inserted += 1;
  }

  await db.prepare(
    `INSERT INTO automation_state(key, value, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind("last_scalp_summary", JSON.stringify({ scanned: signals.length, qualified: qualified.length, inserted }), timestamp).run();
  return { status: "COMPLETED", scanned: signals.length, qualified: qualified.length, inserted, evaluated, timestamp };
}
