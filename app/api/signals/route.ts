import { env } from "cloudflare:workers";
import {
  captureBrowserSignals,
  ensureSignalSchema,
  runSignalAutomation,
  type BrowserMarketSnapshot,
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

function statsFrom(records: SignalRecord[], total: number): LedgerStats {
  const returns = records
    .map((record) => record.outcomes.h4.returnPct)
    .filter((value): value is number => value !== null);
  const wins = returns.filter((value) => value > 0).length;
  return {
    total,
    evaluated4h: returns.length,
    wins4h: wins,
    winRate4h: returns.length ? (wins / returns.length) * 100 : null,
    falseSignalRate4h: returns.length
      ? ((returns.length - wins) / returns.length) * 100
      : null,
    averageReturn4h: returns.length
      ? returns.reduce((sum, value) => sum + value, 0) / returns.length
      : null,
    bestReturn4h: returns.length ? Math.max(...returns) : null,
    worstReturn4h: returns.length ? Math.min(...returns) : null,
  };
}

async function readLedger(): Promise<LedgerPayload> {
  if (!env.DB) throw new Error("D1_UNAVAILABLE");
  await ensureSignalSchema(env.DB);
  const [rowsResult, countRow, lastRun, lastSummary] = await Promise.all([
    env.DB.prepare(
      `SELECT * FROM signal_records ORDER BY detected_at DESC LIMIT 250`,
    ).all<SignalRow>(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM signal_records").first<{
      total: number;
    }>(),
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
    stats: statsFrom(records, Number(countRow?.total ?? 0)),
    automation: {
      lastRun: lastRun?.value ?? null,
      lastSummary: summary,
      schedule: "Cada 15 minutos",
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
    let browserSnapshot: BrowserMarketSnapshot | null = null;
    if (request.headers.get("content-type")?.includes("application/json")) {
      const payload = (await request.json()) as {
        mode?: unknown;
        snapshot?: BrowserMarketSnapshot;
      };
      if (payload.mode === "browser" && payload.snapshot) {
        const requestOrigin = request.headers.get("origin");
        const expectedOrigin = new URL(request.url).origin;
        if (requestOrigin && requestOrigin !== expectedOrigin) {
          return Response.json({ error: "ORIGEN NO AUTORIZADO" }, { status: 403 });
        }
        browserSnapshot = payload.snapshot;
      }
    }
    const automation = browserSnapshot
      ? await captureBrowserSignals(env.DB, browserSnapshot)
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
