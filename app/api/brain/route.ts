import { env } from "cloudflare:workers";
import {
  BRAIN_TIMEFRAMES,
  TIMEFRAME_MINUTES,
  analyzeCandles,
  buildConsensus,
  clamp,
  parseBinanceKlines,
  theoreticalLiquidationZones,
  type BrainLearning,
  type BrainTimeframe,
  type Candle,
  type DerivativesSnapshot,
  type MarketBias,
  type MarketBrainPayload,
  type MarketVenue,
  type TimeframeAnalysis,
} from "@/lib/market-brain";

export const dynamic = "force-dynamic";

const SPOT_BASES = [
  "https://data-api.binance.vision",
  "https://api.binance.com",
];
const FUTURES_BASES = [
  "https://fapi.binance.com",
  "https://fapi1.binance.com",
  "https://fapi2.binance.com",
  "https://fapi3.binance.com",
  "https://fapi4.binance.com",
];
const MINIMUM_CALIBRATION_SAMPLES = 20;

type FetchResult = { data: unknown; source: string };
type KlineResult = { candles: Candle[]; source: string };
type ObservationRow = {
  id: string;
  timeframe: BrainTimeframe;
  direction: "BULLISH" | "BEARISH";
  entry_price: number;
  target_at: string;
};
type CalibrationRow = {
  samples: number;
  wins: number;
  average_return: number | null;
};
type BrowserSnapshot = {
  klines?: Partial<Record<BrainTimeframe, unknown>>;
  derivatives?: {
    premium?: unknown;
    interest?: unknown;
    history?: unknown;
    taker?: unknown;
    accounts?: unknown;
  };
};

const unavailableDerivatives = (note = "Derivados no disponibles para este par"): DerivativesSnapshot => ({
  available: false,
  markPrice: null,
  openInterest: null,
  openInterestUsd: null,
  openInterestChangePct: null,
  fundingRatePct: null,
  nextFundingAt: null,
  takerBuySellRatio: null,
  longShortAccountRatio: null,
  source: "Binance Futures public API",
  note,
});

async function fetchFromBases(bases: string[], path: string): Promise<FetchResult> {
  let lastError: unknown;
  for (const base of bases) {
    try {
      const response = await fetch(`${base}${path}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(7_500),
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        lastError = new Error(`${response.status} ${response.statusText}`);
        continue;
      }
      return { data: await response.json(), source: new URL(base).hostname };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("DATA_UNAVAILABLE");
}

async function fetchKlines(
  symbol: string,
  venue: MarketVenue,
  timeframe: BrainTimeframe,
): Promise<KlineResult> {
  const query = `symbol=${encodeURIComponent(symbol)}&interval=${timeframe}&limit=260`;
  const path = venue === "futures"
    ? `/fapi/v1/klines?${query}`
    : `/api/v3/klines?${query}`;
  const result = await fetchFromBases(venue === "futures" ? FUTURES_BASES : SPOT_BASES, path);
  const candles = parseBinanceKlines(result.data);
  if (!candles.length) throw new Error("KLINES_EMPTY");
  return { candles, source: result.source };
}

async function optionalFutures(path: string) {
  try {
    return await fetchFromBases(FUTURES_BASES, path);
  } catch {
    return null;
  }
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function loadDerivatives(
  symbol: string,
  timeframe: BrainTimeframe,
): Promise<DerivativesSnapshot> {
  const encoded = encodeURIComponent(symbol);
  const period = encodeURIComponent(timeframe);
  const [premium, interest, history, taker, accounts] = await Promise.all([
    optionalFutures(`/fapi/v1/premiumIndex?symbol=${encoded}`),
    optionalFutures(`/fapi/v1/openInterest?symbol=${encoded}`),
    optionalFutures(`/futures/data/openInterestHist?symbol=${encoded}&period=${period}&limit=3`),
    optionalFutures(`/futures/data/takerlongshortRatio?symbol=${encoded}&period=${period}&limit=3`),
    optionalFutures(`/futures/data/globalLongShortAccountRatio?symbol=${encoded}&period=${period}&limit=3`),
  ]);
  if (!premium || !interest) return unavailableDerivatives();
  return derivativesFromRaw(
    premium.data,
    interest.data,
    history?.data,
    taker?.data,
    accounts?.data,
    `Binance Futures public API · ${premium.source}`,
  );
}

function derivativesFromRaw(
  premium: unknown,
  interest: unknown,
  history: unknown,
  taker: unknown,
  accounts: unknown,
  source: string,
): DerivativesSnapshot {
  if (!premium || !interest || typeof premium !== "object" || typeof interest !== "object") {
    return unavailableDerivatives();
  }
  const premiumData = premium as Record<string, unknown>;
  const interestData = interest as Record<string, unknown>;
  const historyRows = Array.isArray(history)
    ? history as Record<string, unknown>[]
    : [];
  const takerRows = Array.isArray(taker)
    ? taker as Record<string, unknown>[]
    : [];
  const accountRows = Array.isArray(accounts)
    ? accounts as Record<string, unknown>[]
    : [];
  const markPrice = finite(premiumData.markPrice);
  const openInterest = finite(interestData.openInterest);
  const firstOi = finite(historyRows[0]?.sumOpenInterest);
  const lastOi = finite(historyRows.at(-1)?.sumOpenInterest);
  const oiChange = firstOi && lastOi
    ? ((lastOi / firstOi) - 1) * 100
    : null;
  const funding = finite(premiumData.lastFundingRate);
  const nextFunding = finite(premiumData.nextFundingTime);

  return {
    available: true,
    markPrice,
    openInterest,
    openInterestUsd: markPrice !== null && openInterest !== null
      ? markPrice * openInterest
      : null,
    openInterestChangePct: oiChange,
    fundingRatePct: funding === null ? null : funding * 100,
    nextFundingAt: nextFunding ? new Date(nextFunding).toISOString() : null,
    takerBuySellRatio: finite(takerRows.at(-1)?.buySellRatio),
    longShortAccountRatio: finite(accountRows.at(-1)?.longShortRatio),
    source,
  };
}

function validatedBrowserCandles(raw: unknown) {
  const candles = parseBinanceKlines(raw).slice(-260);
  if (candles.length < 20) return [];
  const valid = candles.every((candle, index) =>
    candle.closeTime > candle.openTime &&
    candle.high >= Math.max(candle.open, candle.close) &&
    candle.low <= Math.min(candle.open, candle.close) &&
    candle.volume >= 0 &&
    candle.quoteVolume >= 0 &&
    (index === 0 || candle.openTime > candles[index - 1].openTime),
  );
  return valid ? candles : [];
}

export async function ensureBrainSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS brain_observations (
      id TEXT PRIMARY KEY NOT NULL,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      horizon_minutes INTEGER NOT NULL,
      direction TEXT NOT NULL,
      raw_confidence INTEGER NOT NULL,
      calibrated_confidence INTEGER NOT NULL,
      entry_price REAL NOT NULL,
      features TEXT DEFAULT '{}' NOT NULL,
      detected_at TEXT NOT NULL,
      target_at TEXT NOT NULL,
      outcome_price REAL,
      directional_return REAL,
      success INTEGER,
      evaluated_at TEXT
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS brain_observations_symbol_timeframe_idx
      ON brain_observations (symbol, timeframe, detected_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS brain_observations_evaluation_idx
      ON brain_observations (timeframe, evaluated_at)`),
  ]);
}

function outcomeCandle(candles: Candle[], targetMs: number, nowMs: number) {
  return candles.find(
    (candle) => candle.closeTime >= targetMs && candle.closeTime <= nowMs,
  ) ?? null;
}

async function evaluateDueObservations(
  db: D1Database,
  symbol: string,
  candleSets: Record<BrainTimeframe, Candle[]>,
  now: Date,
) {
  const due = await db.prepare(
    `SELECT id, timeframe, direction, entry_price, target_at
     FROM brain_observations
     WHERE symbol = ?1 AND outcome_price IS NULL AND target_at <= ?2
     ORDER BY target_at ASC LIMIT 100`,
  ).bind(symbol, now.toISOString()).all<ObservationRow>();
  const updates = due.results.flatMap((row) => {
    const candles = candleSets[row.timeframe] ?? [];
    const candle = outcomeCandle(candles, Date.parse(row.target_at), now.getTime());
    if (!candle || !row.entry_price) return [];
    const rawReturn = ((candle.close / row.entry_price) - 1) * 100;
    const directionalReturn = row.direction === "BULLISH" ? rawReturn : -rawReturn;
    return [db.prepare(
      `UPDATE brain_observations
       SET outcome_price = ?1, directional_return = ?2, success = ?3, evaluated_at = ?4
       WHERE id = ?5 AND outcome_price IS NULL`,
    ).bind(
      candle.close,
      directionalReturn,
      directionalReturn > 0 ? 1 : 0,
      now.toISOString(),
      row.id,
    )];
  });
  if (updates.length) await db.batch(updates);
}

async function loadCalibration(db: D1Database, timeframe: BrainTimeframe) {
  const row = await db.prepare(
    `SELECT
       COUNT(*) AS samples,
       COALESCE(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END), 0) AS wins,
       AVG(directional_return) AS average_return
     FROM brain_observations
     WHERE timeframe = ?1 AND evaluated_at IS NOT NULL`,
  ).bind(timeframe).first<CalibrationRow>();
  const samples = Number(row?.samples ?? 0);
  const wins = Number(row?.wins ?? 0);
  return {
    samples,
    wins,
    accuracyPct: samples ? (wins / samples) * 100 : null,
    averageDirectionalReturnPct: row?.average_return ?? null,
  };
}

function calibratedConfidence(raw: number, learning: Awaited<ReturnType<typeof loadCalibration>>) {
  if (learning.samples < MINIMUM_CALIBRATION_SAMPLES || learning.accuracyPct === null) {
    return raw;
  }
  return Math.round(clamp(raw + (learning.accuracyPct - 50) * 0.3, 0, 96));
}

async function rememberObservation(
  db: D1Database,
  symbol: string,
  timeframe: BrainTimeframe,
  direction: MarketBias,
  entryPrice: number,
  rawConfidence: number,
  confidence: number,
  features: object,
  now: Date,
) {
  if (direction === "NEUTRAL") return;
  const horizonMinutes = TIMEFRAME_MINUTES[timeframe];
  const bucket = Math.floor(now.getTime() / (horizonMinutes * 60_000));
  const id = `${symbol}:${timeframe}:${bucket}`;
  const targetAt = new Date(now.getTime() + horizonMinutes * 60_000).toISOString();
  await db.prepare(
    `INSERT INTO brain_observations (
       id, symbol, timeframe, horizon_minutes, direction, raw_confidence,
       calibrated_confidence, entry_price, features, detected_at, target_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
     ON CONFLICT(id) DO NOTHING`,
  ).bind(
    id,
    symbol,
    timeframe,
    horizonMinutes,
    direction,
    rawConfidence,
    confidence,
    entryPrice,
    JSON.stringify(features),
    now.toISOString(),
    targetAt,
  ).run();
}

async function learn(
  symbol: string,
  timeframe: BrainTimeframe,
  analysis: TimeframeAnalysis | null,
  rawConfidence: number,
  candleSets: Record<BrainTimeframe, Candle[]>,
  derivatives: DerivativesSnapshot,
  now: Date,
): Promise<{ learning: BrainLearning; confidence: number }> {
  if (!env.DB) {
    return {
      learning: {
        status: "MEMORIA NO DISPONIBLE",
        samples: 0,
        wins: 0,
        accuracyPct: null,
        averageDirectionalReturnPct: null,
        minimumSamples: MINIMUM_CALIBRATION_SAMPLES,
        methodology: "Calibración walk-forward sin usar información futura.",
      },
      confidence: rawConfidence,
    };
  }
  try {
    await ensureBrainSchema(env.DB);
    await evaluateDueObservations(env.DB, symbol, candleSets, now);
    const stats = await loadCalibration(env.DB, timeframe);
    const confidence = calibratedConfidence(rawConfidence, stats);
    if (analysis) {
      await rememberObservation(
        env.DB,
        symbol,
        timeframe,
        analysis.bias,
        analysis.price,
        rawConfidence,
        confidence,
        {
          score: analysis.score,
          rsi14: analysis.rsi14,
          atrPct: analysis.atrPct,
          relativeVolume: analysis.relativeVolume,
          openInterestChangePct: derivatives.openInterestChangePct,
          fundingRatePct: derivatives.fundingRatePct,
        },
        now,
      );
    }
    return {
      learning: {
        status: stats.samples >= MINIMUM_CALIBRATION_SAMPLES ? "CALIBRADO" : "CALIBRANDO",
        samples: stats.samples,
        wins: stats.wins,
        accuracyPct: stats.accuracyPct,
        averageDirectionalReturnPct: stats.averageDirectionalReturnPct,
        minimumSamples: MINIMUM_CALIBRATION_SAMPLES,
        methodology: "Observaciones registradas al cierre y evaluadas walk-forward al cumplirse el horizonte; sin look-ahead.",
      },
      confidence,
    };
  } catch (error) {
    console.error("[ALT_RADAR_BRAIN_MEMORY]", error);
    return {
      learning: {
        status: "MEMORIA NO DISPONIBLE",
        samples: 0,
        wins: 0,
        accuracyPct: null,
        averageDirectionalReturnPct: null,
        minimumSamples: MINIMUM_CALIBRATION_SAMPLES,
        methodology: "La lectura actual continúa, pero no se inventan métricas sin memoria persistente.",
      },
      confidence: rawConfidence,
    };
  }
}

function validInput(body: unknown) {
  const input = body as { symbol?: unknown; venue?: unknown; timeframe?: unknown };
  const symbol = typeof input?.symbol === "string"
    ? input.symbol.toUpperCase().replaceAll("/", "").trim()
    : "";
  const venue = input?.venue === "futures" ? "futures" : "spot";
  const timeframe = BRAIN_TIMEFRAMES.includes(input?.timeframe as BrainTimeframe)
    ? input.timeframe as BrainTimeframe
    : "4h";
  if (!/^[A-Z0-9]{3,24}USDT$/.test(symbol)) return null;
  return { symbol, venue, timeframe };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      symbol?: unknown;
      venue?: unknown;
      timeframe?: unknown;
      snapshot?: BrowserSnapshot;
    };
    const input = validInput(body);
    if (!input) return Response.json({ ok: false, error: "PAR INVÁLIDO" }, { status: 400 });
    const now = new Date();
    const candleSets = Object.fromEntries(BRAIN_TIMEFRAMES.map((timeframe) => [timeframe, []])) as Record<BrainTimeframe, Candle[]>;
    const analyses = Object.fromEntries(BRAIN_TIMEFRAMES.map((timeframe) => [timeframe, null])) as Record<BrainTimeframe, TimeframeAnalysis | null>;
    const sources = new Set<string>();
    const hasBrowserSnapshot = Boolean(body.snapshot?.klines);
    if (hasBrowserSnapshot) {
      const requestOrigin = request.headers.get("origin");
      const expectedOrigin = new URL(request.url).origin;
      if (!requestOrigin || requestOrigin !== expectedOrigin) {
        return Response.json({ ok: false, error: "SNAPSHOT DE ORIGEN NO AUTORIZADO" }, { status: 403 });
      }
      BRAIN_TIMEFRAMES.forEach((timeframe) => {
        const candles = validatedBrowserCandles(body.snapshot?.klines?.[timeframe]);
        candleSets[timeframe] = candles;
        analyses[timeframe] = analyzeCandles(candles, timeframe);
      });
      if (BRAIN_TIMEFRAMES.some((timeframe) => analyses[timeframe] !== null)) {
        sources.add(`${input.venue === "futures" ? "Binance Futures" : "Binance Spot"} · conexión directa verificada del navegador`);
      }
    } else {
      const loaded = await Promise.allSettled(
        BRAIN_TIMEFRAMES.map((timeframe) => fetchKlines(input.symbol, input.venue, timeframe)),
      );
      loaded.forEach((result, index) => {
        const timeframe = BRAIN_TIMEFRAMES[index];
        if (result.status === "fulfilled") {
          candleSets[timeframe] = result.value.candles;
          analyses[timeframe] = analyzeCandles(result.value.candles, timeframe);
          sources.add(`${input.venue === "futures" ? "Binance Futures" : "Binance Spot"} · ${result.value.source}`);
        }
      });
    }
    const derivatives = hasBrowserSnapshot
      ? derivativesFromRaw(
          body.snapshot?.derivatives?.premium,
          body.snapshot?.derivatives?.interest,
          body.snapshot?.derivatives?.history,
          body.snapshot?.derivatives?.taker,
          body.snapshot?.derivatives?.accounts,
          "Binance Futures public API · conexión directa verificada del navegador",
        )
      : await loadDerivatives(input.symbol, input.timeframe);
    if (derivatives.available) sources.add(derivatives.source);
    const consensusBase = buildConsensus(analyses, derivatives);
    const selected = analyses[input.timeframe];
    const learned = await learn(
      input.symbol,
      input.timeframe,
      selected,
      consensusBase.rawConfidence,
      candleSets,
      derivatives,
      now,
    );
    const referencePrice = derivatives.markPrice ?? selected?.price ?? 0;
    const warnings = [
      "Zonas x5–x100 son estimaciones teóricas, no liquidaciones observadas.",
      "El precio exacto depende de entrada, margen, maintenance tier, comisiones y modo de posición.",
      "Análisis probabilístico; no es garantía ni asesoramiento financiero.",
    ];
    if (!selected) warnings.unshift("DATA UNAVAILABLE en la temporalidad seleccionada.");
    if (!derivatives.available) warnings.unshift("Métricas de derivados no disponibles para este par.");

    const payload: MarketBrainPayload = {
      ok: Boolean(selected),
      symbol: input.symbol,
      venue: input.venue,
      selectedTimeframe: input.timeframe,
      generatedAt: now.toISOString(),
      engine: {
        name: "ALT RADAR QUANT BRAIN",
        mode: "Motor estadístico local, explicable y sin LLM",
        tokenCost: 0,
        learning: "Calibración walk-forward con observaciones reales persistidas",
      },
      sources: [...sources],
      analyses,
      selected,
      derivatives,
      liquidationZones: theoreticalLiquidationZones(referencePrice),
      consensus: { ...consensusBase, calibratedConfidence: learned.confidence },
      learning: learned.learning,
      warnings,
    };
    return Response.json(payload, {
      status: selected ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[ALT_RADAR_BRAIN]", error);
    return Response.json(
      { ok: false, error: "CEREBRO TEMPORALMENTE NO DISPONIBLE", detail: "No se muestran datos inventados." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
