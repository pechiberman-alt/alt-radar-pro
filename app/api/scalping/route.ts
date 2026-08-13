import { env } from "cloudflare:workers";
import {
  appendBrainAuditEvent,
  ensureBrainSecuritySchema,
  registerBrainManifest,
} from "@/lib/brain-security";
import { parseBinanceKlines, type Candle } from "@/lib/market-brain";
import type { MarketAsset } from "@/lib/radar";
import { buildScalpSignal, type ScalpSignal } from "@/lib/scalping-engine";

export const dynamic = "force-dynamic";

const BASES = [
  "https://data-api.binance.vision",
  "https://api.binance.us",
  "https://api.binance.com",
];
const MAX_ASSETS = 12;

type Snapshot = { "5m"?: unknown; "15m"?: unknown };

function finite(value: unknown, fallback: number | null = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function validAsset(value: unknown): MarketAsset | null {
  const row = value as Partial<MarketAsset>;
  if (typeof row?.symbol !== "string" || !/^[A-Z0-9]{2,24}USDT$/.test(row.symbol)) return null;
  const price = finite(row.price);
  const quoteVolume = finite(row.quoteVolume);
  if (!price || price <= 0 || quoteVolume === null || quoteVolume < 0) return null;
  const bidPrice = finite(row.bidPrice);
  const askPrice = finite(row.askPrice);
  const suppliedSpread = finite(row.spreadPct);
  const spreadPct = suppliedSpread ?? (
    bidPrice && askPrice && askPrice >= bidPrice
      ? ((askPrice - bidPrice) / ((askPrice + bidPrice) / 2)) * 100
      : null
  );
  return {
    symbol: row.symbol,
    price,
    change5m: finite(row.change5m),
    change15m: finite(row.change15m),
    change1h: finite(row.change1h),
    change4h: finite(row.change4h),
    change24h: finite(row.change24h, 0)!,
    volume: finite(row.volume, 0)!,
    quoteVolume,
    high: finite(row.high),
    low: finite(row.low),
    bidPrice,
    askPrice,
    spreadPct,
  };
}

function validatedCandles(value: unknown): Candle[] {
  const rows = parseBinanceKlines(value).slice(-120);
  if (rows.length < 55) return [];
  return rows.every((candle, index) =>
    candle.closeTime > candle.openTime &&
    candle.high >= Math.max(candle.open, candle.close) &&
    candle.low <= Math.min(candle.open, candle.close) &&
    candle.volume >= 0 &&
    (index === 0 || candle.openTime > rows[index - 1].openTime),
  ) ? rows : [];
}

async function fetchKlines(symbol: string, interval: "5m" | "15m") {
  let lastError: unknown;
  for (const base of BASES) {
    try {
      const response = await fetch(
        `${base}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=120`,
        { cache: "no-store", signal: AbortSignal.timeout(6_000), headers: { Accept: "application/json" } },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const candles = validatedCandles(await response.json());
      if (candles.length) return candles;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("DATA UNAVAILABLE");
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      assets?: unknown[];
      snapshots?: Record<string, Snapshot>;
      context?: {
        riskScore?: unknown;
        killSwitch?: unknown;
        altseasonScore?: unknown;
        minimumQuoteVolume?: unknown;
      };
    };
    const requestOrigin = request.headers.get("origin");
    const expectedOrigin = new URL(request.url).origin;
    if (requestOrigin && requestOrigin !== expectedOrigin) {
      return Response.json({ ok: false, error: "ORIGEN NO AUTORIZADO" }, { status: 403 });
    }
    const assets = (Array.isArray(body.assets) ? body.assets : [])
      .map(validAsset)
      .filter((asset): asset is MarketAsset => asset !== null)
      .sort((left, right) => right.quoteVolume - left.quoteVolume)
      .slice(0, MAX_ASSETS);
    if (!assets.length) {
      return Response.json({ ok: false, error: "UNIVERSO SCALPING VACÍO" }, { status: 400 });
    }
    const btc = assets.find((asset) => asset.symbol === "BTCUSDT");
    const eth = assets.find((asset) => asset.symbol === "ETHUSDT");
    const riskScore = finite(body.context?.riskScore);
    const altseasonScore = finite(body.context?.altseasonScore);
    const minimumQuoteVolume = Math.max(5_000_000, finite(body.context?.minimumQuoteVolume, 10_000_000)!);
    const generatedAt = new Date().toISOString();
    const results = await Promise.allSettled(assets.map(async (asset) => {
      const snapshot = body.snapshots?.[asset.symbol];
      const directFive = validatedCandles(snapshot?.["5m"]);
      const directFifteen = validatedCandles(snapshot?.["15m"]);
      const [five, fifteen] = directFive.length && directFifteen.length
        ? [directFive, directFifteen]
        : await Promise.all([fetchKlines(asset.symbol, "5m"), fetchKlines(asset.symbol, "15m")]);
      return buildScalpSignal(asset, five, fifteen, {
        riskScore,
        killSwitch: Boolean(body.context?.killSwitch),
        altseasonScore,
        btcChange15m: btc?.change15m ?? null,
        ethChange15m: eth?.change15m ?? null,
        minimumQuoteVolume,
      }, generatedAt);
    }));
    const signals = results
      .flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : [])
      .sort((left, right) => right.score - left.score);
    const errors = results.filter((result) => result.status === "rejected").length;

    if (env.DB && signals.length) {
      try {
        await ensureBrainSecuritySchema(env.DB);
        await registerBrainManifest(env.DB, generatedAt);
        for (const signal of signals.filter((item) => item.status !== "NO SIGNAL").slice(0, 6)) {
          const bucket = Math.floor(Date.parse(generatedAt) / (5 * 60_000));
          await appendBrainAuditEvent(env.DB, {
            eventKey: `scalp:${signal.symbol}:${bucket}`,
            eventType: "SCALP_OBSERVATION",
            symbol: signal.symbol,
            timeframe: "5m/15m",
            source: signal.source,
            observedAt: generatedAt,
            payload: {
              side: signal.side,
              status: signal.status,
              score: signal.score,
              entryLow: signal.entryLow,
              entryHigh: signal.entryHigh,
              stop: signal.stop,
              target3: signal.target3,
              reasons: signal.reasons,
              penalties: signal.penalties,
            },
          });
        }
      } catch (error) {
        console.error("[ALT_RADAR_SCALP_AUDIT]", error);
      }
    }

    return Response.json({
      ok: signals.length > 0,
      generatedAt,
      mode: "SCALPING 5M / 15M",
      engine: "Determinístico local · 0 tokens",
      sources: ["Binance / Binance.US Spot public APIs · velas cerradas 5M/15M", "Ticker 24H · bid/ask real"],
      scanned: signals.length,
      unavailable: errors,
      signals: signals satisfies ScalpSignal[],
      warnings: [
        "No se emite TRIGGER sin alineación, volumen, estructura, liquidez y stop válido.",
        "Las señales son escenarios probabilísticos; no son órdenes ni asesoramiento financiero.",
      ],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[ALT_RADAR_SCALPING]", error);
    return Response.json(
      { ok: false, error: "SCALPING DATA UNAVAILABLE", signals: [] },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
