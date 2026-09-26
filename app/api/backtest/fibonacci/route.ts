import { NextRequest, NextResponse } from "next/server";
import { aggregateFibOutcomes, runFibBacktest } from "@/lib/fib-backtest";
import { BACKTEST_INTERVALS, fetchHistoricalCandles } from "@/lib/klines-history";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const symbol = (params.get("symbol") ?? "").toUpperCase();
  const interval = params.get("interval") ?? "1h";
  const rawLimit = params.get("candles");
  const limit = rawLimit === null ? 1000 : Number(rawLimit);

  if (!/^[A-Z0-9]{2,24}USDT$/.test(symbol)) {
    return NextResponse.json({ error: "SÍMBOLO NO VÁLIDO" }, { status: 400 });
  }
  if (!BACKTEST_INTERVALS.has(interval)) {
    return NextResponse.json(
      { error: "INTERVALO NO VÁLIDO", allowed: [...BACKTEST_INTERVALS] },
      { status: 400 },
    );
  }
  if (!Number.isInteger(limit) || limit < 200 || limit > 1000) {
    return NextResponse.json(
      { error: "CANDLES DEBE SER UN ENTERO ENTRE 200 Y 1000" },
      { status: 400 },
    );
  }

  try {
    const candles = await fetchHistoricalCandles(symbol, interval, limit);
    if (!candles || candles.length < 60) {
      return NextResponse.json(
        { error: "SIN DATOS" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    const outcomes = runFibBacktest(candles);
    const stats = aggregateFibOutcomes(outcomes);

    return NextResponse.json(
      {
        symbol,
        interval,
        candlesAnalyzed: candles.length,
        rangeStart: new Date(candles[0].openTime).toISOString(),
        rangeEnd: new Date(candles[candles.length - 1].openTime).toISOString(),
        methodology:
          "Entrada en el nivel Fibonacci al primer toque tras confirmarse la pierna. Stop en el origen de la pierna, target en su extremo. Sin look-ahead: solo se usan velas posteriores al toque.",
        levels: stats,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[ALT_RADAR_BACKTEST_FIB]", error);
    return NextResponse.json(
      { error: "NO SE PUDO CORRER EL BACKTEST" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
