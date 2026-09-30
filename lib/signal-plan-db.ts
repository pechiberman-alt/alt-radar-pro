import { fetchKlinesServer } from "./klines-server.ts";
import type { SwingCandle } from "./swing-entries.ts";
import { evaluatePlan, familyOf, kindKey, planStats, type KindStats, type PlanOutcome, type PlanSide, type SignalPlan } from "./signal-plan.ts";

/**
 * The ledger side of signal plans: extra columns on signal_records, writing a
 * plan next to a signal, and reading the outcomes back.
 *
 * The columns are added here, at runtime and only when missing, instead of
 * through a migration: the deploy pipeline applies migrations as a gate and a
 * gate that fails blocks every deploy, and this change is purely additive. The
 * plan is written by a separate UPDATE after the signal's own INSERT, so a
 * failure here can never cost the ledger a signal.
 */

export const PLAN_COLUMNS: [string, string][] = [
  ["plan_version", "TEXT"], ["stop_price", "REAL"], ["tp1_price", "REAL"], ["tp2_price", "REAL"], ["tp3_price", "REAL"], ["plan_atr", "REAL"],
  ["sl_at", "TEXT"], ["tp1_at", "TEXT"], ["tp2_at", "TEXT"], ["tp3_at", "TEXT"], ["plan_outcome", "TEXT"], ["plan_closed_at", "TEXT"],
];

let columnsReady = false;
export const resetPlanColumnsCache = () => {
  columnsReady = false;
};

export async function ensureSignalPlanColumns(db: D1Database) {
  if (columnsReady) return;
  const info = await db.prepare("PRAGMA table_info(signal_records)").all<{ name: string }>();
  const have = new Set((info.results ?? []).map((r) => r.name));
  // No table yet: nothing to extend, and it must not be marked done.
  if (!have.size) return;
  for (const [name, type] of PLAN_COLUMNS) {
    if (!have.has(name)) await db.prepare(`ALTER TABLE signal_records ADD COLUMN ${name} ${type}`).run();
  }
  columnsReady = true;
}

export async function attachPlan(db: D1Database, id: string, plan: SignalPlan) {
  await db
    .prepare("UPDATE signal_records SET plan_version = ?1, stop_price = ?2, tp1_price = ?3, tp2_price = ?4, tp3_price = ?5, plan_atr = ?6 WHERE id = ?7")
    .bind(plan.version, plan.stop, plan.tp1, plan.tp2, plan.tp3, plan.atr, id)
    .run();
}

type Fetcher = (symbol: string, interval: string, opts: { limit?: number; startTime?: number; minCandles?: number; allowThin?: boolean }) => Promise<{ candles: SwingCandle[] }>;

type OpenRow = {
  id: string; symbol: string; side: string; detected_at: string;
  stop_price: number; tp1_price: number; tp2_price: number; tp3_price: number; plan_atr: number | null; plan_version: string | null;
  sl_at: string | null; tp1_at: string | null; tp2_at: string | null; tp3_at: string | null;
};

const FRAME_MS = 300_000;
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

/**
 * Reads the outcome of every signal whose plan is still open. Each run starts
 * again from the candles after the detection, so it is stateless and can be
 * repeated; only rows whose result changed are written.
 */
export async function evaluateSignalPlans(db: D1Database, now = Date.now(), fetcher: Fetcher = fetchKlinesServer) {
  await ensureSignalPlanColumns(db);
  // The detected_at index keeps this to the last two days of rows.
  const since = new Date(now - 49 * 3_600_000).toISOString();
  const rows = (
    await db
      .prepare(
        `SELECT id, symbol, side, detected_at, stop_price, tp1_price, tp2_price, tp3_price, plan_atr, plan_version, sl_at, tp1_at, tp2_at, tp3_at
           FROM signal_records
          WHERE detected_at > ?1 AND stop_price IS NOT NULL AND plan_outcome IS NULL`,
      )
      .bind(since)
      .all<OpenRow>()
  ).results ?? [];

  const bySymbol = new Map<string, OpenRow[]>();
  for (const r of rows) (bySymbol.get(r.symbol) ?? bySymbol.set(r.symbol, []).get(r.symbol)!).push(r);

  let updated = 0;
  let resolved = 0;
  let failed = 0;
  for (const [symbol, list] of bySymbol) {
    const earliest = Math.min(...list.map((r) => Date.parse(r.detected_at)).filter(Number.isFinite));
    if (!Number.isFinite(earliest)) continue;
    let candles: SwingCandle[];
    try {
      candles = (await fetcher(symbol, "5m", { limit: 1000, startTime: earliest, allowThin: true })).candles;
    } catch {
      // One symbol's data failing must not stop the others; it is retried next run.
      failed += 1;
      continue;
    }
    for (const r of list) {
      const detectedAt = Date.parse(r.detected_at);
      if (!Number.isFinite(detectedAt) || (r.side !== "LONG" && r.side !== "SHORT")) continue;
      const plan: SignalPlan = { stop: r.stop_price, tp1: r.tp1_price, tp2: r.tp2_price, tp3: r.tp3_price, atr: r.plan_atr, version: r.plan_version === "scalp-v1" ? "scalp-v1" : "atr-v1" };
      const s = evaluatePlan(r.side as PlanSide, plan, detectedAt, candles, FRAME_MS, now);
      const next = [iso(s.slAt), iso(s.tp1At), iso(s.tp2At), iso(s.tp3At)];
      const same = next[0] === r.sl_at && next[1] === r.tp1_at && next[2] === r.tp2_at && next[3] === r.tp3_at && s.outcome === null;
      if (same) continue;
      await db
        .prepare("UPDATE signal_records SET sl_at = ?1, tp1_at = ?2, tp2_at = ?3, tp3_at = ?4, plan_outcome = ?5, plan_closed_at = ?6 WHERE id = ?7")
        .bind(next[0], next[1], next[2], next[3], s.outcome, iso(s.closedAt), r.id)
        .run();
      updated += 1;
      if (s.outcome) resolved += 1;
    }
  }
  return { checked: rows.length, updated, resolved, failed };
}

export const STATS_DAYS = 90;

export async function loadPlanStats(db: D1Database, now = Date.now(), days = STATS_DAYS): Promise<KindStats[]> {
  const since = new Date(now - days * 86_400_000).toISOString();
  const rows = (
    await db
      .prepare(
        `SELECT signal, side, CASE WHEN timeframe LIKE 'SCALP%' THEN 'SCALP' ELSE 'CONFLUENCIA' END AS family, plan_outcome AS outcome, COUNT(*) AS n
           FROM signal_records
          WHERE detected_at > ?1 AND plan_outcome IS NOT NULL
          GROUP BY signal, side, family, plan_outcome`,
      )
      .bind(since)
      .all<{ signal: string; side: string; family: "SCALP" | "CONFLUENCIA"; outcome: PlanOutcome; n: number }>()
  ).results ?? [];
  return planStats(rows.map((r) => ({ kind: kindKey(r.family, r.signal, r.side), outcome: r.outcome, n: r.n })));
}

/** Scanning 90 days of signals on every message would be wasteful: the answer is kept for an hour. */
export async function getPlanStatsCached(db: D1Database, now = Date.now(), ttlMs = 3_600_000): Promise<KindStats[]> {
  try {
    const cached = await db.prepare("SELECT value FROM automation_state WHERE key = 'plan_stats'").first<{ value: string }>();
    if (cached) {
      const parsed = JSON.parse(cached.value) as { at: number; stats: KindStats[] };
      if (now - parsed.at < ttlMs && Array.isArray(parsed.stats)) return parsed.stats;
    }
  } catch {
    // No cache yet or unreadable: compute below.
  }
  const stats = await loadPlanStats(db, now);
  try {
    await db
      .prepare("INSERT INTO automation_state(key, value, updated_at) VALUES ('plan_stats', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .bind(JSON.stringify({ at: now, stats }), new Date(now).toISOString())
      .run();
  } catch {
    // Not cached this time; it still answers.
  }
  return stats;
}

export { familyOf, kindKey };
