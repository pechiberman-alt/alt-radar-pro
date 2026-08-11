import { env } from "cloudflare:workers";
import { ensureSignalSchema } from "@/lib/automation";

export const dynamic = "force-dynamic";

type AggregateRow = Record<string, number | null>;

function horizon(row: AggregateRow | null, key: string) {
  const evaluated = Number(row?.[`evaluated_${key}`] ?? 0);
  const wins = Number(row?.[`wins_${key}`] ?? 0);
  const grossProfit = Number(row?.[`gross_profit_${key}`] ?? 0);
  const grossLoss = Number(row?.[`gross_loss_${key}`] ?? 0);
  return {
    evaluated,
    wins,
    winRate: evaluated ? (wins / evaluated) * 100 : null,
    grossProfit,
    grossLoss,
    profitFactor: evaluated && grossLoss > 0 ? grossProfit / grossLoss : null,
    profitFactorInfinite: evaluated > 0 && grossProfit > 0 && grossLoss === 0,
    averageReturn: row?.[`average_return_${key}`] ?? null,
    falseSignalRate: evaluated ? ((evaluated - wins) / evaluated) * 100 : null,
    sampleQuality: evaluated === 0 ? "DATA INSUFICIENTE" : evaluated < 10 ? "MUESTRA BAJA" : "MUESTRA AUDITABLE",
  };
}

export async function GET() {
  try {
    if (!env.DB) throw new Error("D1_UNAVAILABLE");
    await ensureSignalSchema(env.DB);
    const row = await env.DB.prepare(
      `SELECT
        COUNT(return_5m) AS evaluated_5m,
        SUM(CASE WHEN return_5m > 0 THEN 1 ELSE 0 END) AS wins_5m,
        SUM(CASE WHEN return_5m > 0 THEN return_5m ELSE 0 END) AS gross_profit_5m,
        ABS(SUM(CASE WHEN return_5m < 0 THEN return_5m ELSE 0 END)) AS gross_loss_5m,
        AVG(return_5m) AS average_return_5m,
        COUNT(return_15m) AS evaluated_15m,
        SUM(CASE WHEN return_15m > 0 THEN 1 ELSE 0 END) AS wins_15m,
        SUM(CASE WHEN return_15m > 0 THEN return_15m ELSE 0 END) AS gross_profit_15m,
        ABS(SUM(CASE WHEN return_15m < 0 THEN return_15m ELSE 0 END)) AS gross_loss_15m,
        AVG(return_15m) AS average_return_15m,
        COUNT(return_1h) AS evaluated_1h,
        SUM(CASE WHEN return_1h > 0 THEN 1 ELSE 0 END) AS wins_1h,
        SUM(CASE WHEN return_1h > 0 THEN return_1h ELSE 0 END) AS gross_profit_1h,
        ABS(SUM(CASE WHEN return_1h < 0 THEN return_1h ELSE 0 END)) AS gross_loss_1h,
        AVG(return_1h) AS average_return_1h,
        COUNT(return_4h) AS evaluated_4h,
        SUM(CASE WHEN return_4h > 0 THEN 1 ELSE 0 END) AS wins_4h,
        SUM(CASE WHEN return_4h > 0 THEN return_4h ELSE 0 END) AS gross_profit_4h,
        ABS(SUM(CASE WHEN return_4h < 0 THEN return_4h ELSE 0 END)) AS gross_loss_4h,
        AVG(return_4h) AS average_return_4h,
        COUNT(return_24h) AS evaluated_1d,
        SUM(CASE WHEN return_24h > 0 THEN 1 ELSE 0 END) AS wins_1d,
        SUM(CASE WHEN return_24h > 0 THEN return_24h ELSE 0 END) AS gross_profit_1d,
        ABS(SUM(CASE WHEN return_24h < 0 THEN return_24h ELSE 0 END)) AS gross_loss_1d,
        AVG(return_24h) AS average_return_1d
      FROM signal_records`,
    ).first<AggregateRow>();

    return Response.json(
      {
        generatedAt: new Date().toISOString(),
        source: "ALT RADAR Signal Ledger · Cloudflare D1",
        methodology: "Retorno direccional observado después de la señal; sin look-ahead y sin operaciones simuladas.",
        horizons: {
          "5m": horizon(row, "5m"),
          "15m": horizon(row, "15m"),
          "1h": horizon(row, "1h"),
          "4h": horizon(row, "4h"),
          "1d": horizon(row, "1d"),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[ALT_RADAR_PERFORMANCE]", error);
    return Response.json(
      { error: "RENDIMIENTO REAL TEMPORALMENTE NO DISPONIBLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
