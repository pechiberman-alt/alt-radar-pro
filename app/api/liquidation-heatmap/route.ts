import { NextRequest, NextResponse } from "next/server";
import { fetchHistoricalCandles } from "@/lib/klines-history";
import { buildLiquidationHeatmap } from "@/lib/liquidation-heatmap";

export const dynamic = "force-dynamic";

const SYMBOLS = new Set(["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"]);

/** interval for the volume-profile lookback + how many of those candles to pull. */
const PROFILES: Record<string, { interval: string; limit: number }> = {
  "15m": { interval: "15m", limit: 700 }, // ~7 days
  "1h": { interval: "1h", limit: 720 }, // ~30 days
  "4h": { interval: "4h", limit: 540 }, // ~90 days
  "1d": { interval: "1d", limit: 365 }, // ~1 year
};

export async function GET(request: NextRequest) {
  // Every other route in this project reads its query string via
  // `request.nextUrl.searchParams`, never via `new URL(request.url)` — the
  // one route that did (this one) came back "NO DISPONIBLE" for every real
  // request once deployed. Matching the established, already-proven pattern
  // here rather than guessing further at why the other one failed only in
  // production, where it can't be reproduced directly.
  const params = request.nextUrl.searchParams;
  const symbol = (params.get("symbol") || "BTCUSDT").toUpperCase();
  const timeframe = params.get("timeframe") || "1h";

  if (!SYMBOLS.has(symbol)) {
    return NextResponse.json({ error: "SÍMBOLO NO SOPORTADO" }, { status: 400 });
  }
  const profile = PROFILES[timeframe];
  if (!profile) {
    return NextResponse.json({ error: "TIMEFRAME NO SOPORTADO" }, { status: 400 });
  }

  const candles = await fetchHistoricalCandles(symbol, profile.interval, profile.limit);
  if (!candles || candles.length < 20) {
    return NextResponse.json({ error: "SIN DATOS SUFICIENTES" }, { status: 503 });
  }

  const currentPrice = candles.at(-1)!.close;
  const heatmap = buildLiquidationHeatmap(symbol, candles, currentPrice);
  if (!heatmap) {
    return NextResponse.json({ error: "NO SE PUDO CONSTRUIR EL MAPA" }, { status: 503 });
  }

  // The chart also needs a recent, tighter candle window to draw — reusing
  // the same lookback for both would either starve the volume profile or
  // hand the chart hundreds of candles no screen can render legibly.
  const displayCandles = candles.slice(-90).map((candle) => ({
    time: candle.openTime,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));

  return NextResponse.json(
    { heatmap, candles: displayCandles, timeframe },
    { headers: { "Cache-Control": "no-store" } },
  );
}
