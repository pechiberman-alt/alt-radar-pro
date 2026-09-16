import { env } from "cloudflare:workers";
import {
  ensureSignalSchema,
  runSignalAutomation,
  syncOpenSignals,
} from "@/lib/automation";
import type {
  LedgerPayload,
  LedgerStats,
  SignalRecord,
} from "@/lib/signal-ledger";

export const dynamic = "force-dynamic";

type SignalRow = {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  signal: "SETUP" | "TRIGGER";
  score: number;
  technical_score: number;
  altseason_score: number | null;
  geopolitical_risk: number | null;
  entry_price: number;
  source: string;
  timeframe: string;
  detected_at: string;
  status: "MONITORING" | "RESOLVED";
  reasons: string;
  penalties: string;
  price_15m: number | null;
  return_15m: number | null;
  captured_15m: string | null;
  price_1h: number | null;
  return_1h: number | null;
  captured_1h: string | null;
  price_4h: number | null;
  return_4h: number | null;
  captured_4h: string | null;
  price_24h: number | null;
  return_24h: number | null;
  captured_24h: string | null;
  max_move: number;
  min_move: number;
  updated_at: string;
};

function parseReasons(value: string) {
  try {
    const parsed = JSON.parse(value) as { label?: unknown; points?: unknown }[];
    return parsed
      .filter(
        (item) =>
          typeof item?.label === "string" && typeof item?.points === "number",
      )
      .map((item) => ({ label: item.label as string, points: item.points as number }));
  } catch {
    return [];
  }
}

function mapRow(row: SignalRow): SignalRecord {
  return {
    id: row.id,
    symbol: row.symbol,
    side: row.side,
    signal: row.signal,
    score: row.score,
    technicalScore: row.technical_score,
    altseasonScore: row.altseason_score,
    geopoliticalRisk: row.geopolitical_risk,
    entryPrice: row.entry_price,
    source: row.source,
    timeframe: row.timeframe,
    detectedAt: row.detected_at,
    status: row.status,
    reasons: parseReasons(row.reasons),
    penalties: parseReasons(row.penalties),
    outcomes: {
      m15: {
        price: row.price_15m,
        returnPct: row.return_15m,
        capturedAt: row.captured_15m,
      },
      h1: {
        price: row.price_1h,
        returnPct: row.return_1h,
        capturedAt: row.captured_1h,
      },
      h4: {
        price: row.price_4h,
        returnPct: row.return_4h,
        capturedAt: row.captured_4h,
      },
      h24: {
        price: row.price_24h,
        returnPct: row.return_24h,
        capturedAt: row.captured_24h,
      },
    },
    maxMove: row.max_move,
    minMove: row.min_move,
    updatedAt: row.updated_at,
  };
}

type LedgerStatsRow = {
  total: number;
  evaluated_4h: number;
  wins_4h: number;
  gross_profit_4h: number | null;
  gross_loss_4h: number | null;
  average_return_4h: number | null;
  best_return_4h: number | null;
  worst_return_4h: number | null;
};

function statsFrom(row: LedgerStatsRow | null): LedgerStats {
  const total = Number(row?.total ?? 0);
  const evaluated = Number(row?.evaluated_4h ?? 0);
  const wins = Number(row?.wins_4h ?? 0);
  const grossProfit = Number(row?.gross_profit_4h ?? 0);
  const grossLoss = Number(row?.gross_loss_4h ?? 0);
  return {
    total,
    evaluated4h: evaluated,
    wins4h: wins,
    winRate4h: evaluated ? (wins / evaluated) * 100 : null,
    grossProfit4h: grossProfit,
    grossLoss4h: grossLoss,
    profitFactor4h: evaluated && grossLoss > 0 ? grossProfit / grossLoss : null,
    falseSignalRate4h: evaluated ? ((evaluated - wins) / evaluated) * 100 : null,
    averageReturn4h: row?.average_return_4h ?? null,
    bestReturn4h: row?.best_return_4h ?? null,
    worstReturn4h: row?.worst_return_4h ?? null,
  };
}

async function readLedger(): Promise<LedgerPayload> {
  if (!env.DB) throw new Error("D1_UNAVAILABLE");
  await ensureSignalSchema(env.DB);
  const [rowsResult, statsRow, lastRun, lastSummary] = await Promise.all([
    env.DB.prepare(
      `SELECT * FROM signal_records
       WHERE timeframe NOT LIKE 'SCALP%'
       ORDER BY detected_at DESC LIMIT 250`,
    ).all<SignalRow>(),
    env.DB.prepare(
      `SELECT
        COUNT(*) AS total,
        COUNT(return_4h) AS evaluated_4h,
        SUM(CASE WHEN return_4h > 0 THEN 1 ELSE 0 END) AS wins_4h,
        SUM(CASE WHEN return_4h > 0 THEN return_4h ELSE 0 END) AS gross_profit_4h,
        ABS(SUM(CASE WHEN return_4h < 0 THEN return_4h ELSE 0 END)) AS gross_loss_4h,
        AVG(return_4h) AS average_return_4h,
        MAX(return_4h) AS best_return_4h,
        MIN(return_4h) AS worst_return_4h
      FROM signal_records
      WHERE timeframe NOT LIKE 'SCALP%'`,
    ).first<LedgerStatsRow>(),
    env.DB.prepare("SELECT value FROM automation_state WHERE key = ?1")
      .bind("last_run")
      .first<{ value: string }>(),
    env.DB.prepare("SELECT value FROM automation_state WHERE key = ?1")
      .bind("last_summary")
      .first<{ value: string }>(),
  ]);
  const records = rowsResult.results.map(mapRow);
  let summary: LedgerPayload["automation"]["lastSummary"] = null;
  try {
    summary = lastSummary?.value ? JSON.parse(lastSummary.value) : null;
  } catch {
    summary = null;
  }
  return {
    records,
    stats: statsFrom(statsRow),
    automation: {
      lastRun: lastRun?.value ?? null,
      lastSummary: summary,
      schedule: "Scalping cada 5 min · swing cada 15 min",
    },
  };
}

export async function GET() {
  try {
    return Response.json(await readLedger(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[ALT_RADAR_LEDGER_READ]", error);
    const unavailable =
      error instanceof Error && error.message.includes("D1_UNAVAILABLE");
    return Response.json(
      {
        error: unavailable
          ? "HISTORIAL PERSISTENTE NO DISPONIBLE"
          : "NO SE PUDO LEER EL HISTORIAL",
      },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    if (!env.DB) throw new Error("D1_UNAVAILABLE");
    // "sync" only re-grades open signals against prices the server fetches
    // itself. Nothing a caller sends can add a record or change an outcome:
    // every insertion comes from the server-side crons.
    let syncOnly = false;
    if (request.headers.get("content-type")?.includes("application/json")) {
      const payload = (await request.json().catch(() => null)) as {
        mode?: unknown;
      } | null;
      syncOnly = payload?.mode === "sync" || payload?.mode === "browser";
    }
    const automation = syncOnly
      ? await syncOpenSignals(env.DB)
      : await runSignalAutomation(env.DB);
    const ledger = await readLedger();
    return Response.json({ ...ledger, run: automation });
  } catch (error) {
    console.error("[ALT_RADAR_AUTOMATION]", error);
    return Response.json(
      { error: "AUTOMATIZACIÓN TEMPORALMENTE NO DISPONIBLE" },
      { status: 503 },
    );
  }
}
