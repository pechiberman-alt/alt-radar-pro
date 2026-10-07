import { buildLiquidationHeatmap } from "./liquidation-heatmap.ts";
import { resolveSignal, type JarvisSignal, type JarvisSource } from "./jarvis-ledger.ts";
import {
  CORE_TF,
  closedOnly,
  coreStats,
  coreTask,
  countClosed,
  countOpened,
  magnetSignals,
  scanSignal,
  ZERO,
  type CoreCounters,
  type CoreHeartbeat,
  type CoreSnapshot,
} from "./jarvis-core.ts";
import { fetchKlinesServer } from "./klines-server.ts";
import { loadOiDelta, timeframeConfig } from "./market-fetch.ts";

/**
 * Database side of JARVIS CORE (see jarvis-core.ts). Built for D1's free
 * tier, which counts rows read: every query goes through an index with a
 * LIMIT, and the totals are running counters (one row per source) instead of
 * COUNT(*) over a table that only grows.
 */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS jarvis_core_signals (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, symbol TEXT NOT NULL, timeframe TEXT NOT NULL, side TEXT NOT NULL,
    time INTEGER NOT NULL, entry REAL NOT NULL, stop REAL NOT NULL, target REAL NOT NULL, note TEXT NOT NULL,
    result TEXT NOT NULL, r REAL, closed_at INTEGER, created_at INTEGER NOT NULL)`,
  "CREATE INDEX IF NOT EXISTS jarvis_core_open ON jarvis_core_signals (result, time)",
  "CREATE INDEX IF NOT EXISTS jarvis_core_created ON jarvis_core_signals (created_at)",
  "CREATE INDEX IF NOT EXISTS jarvis_core_closed ON jarvis_core_signals (closed_at)",
  `CREATE TABLE IF NOT EXISTS jarvis_core_stats (
    source TEXT PRIMARY KEY, resolved INTEGER NOT NULL, wins INTEGER NOT NULL, losses INTEGER NOT NULL,
    gain REAL NOT NULL, loss REAL NOT NULL, total REAL NOT NULL, open INTEGER NOT NULL)`,
  "CREATE TABLE IF NOT EXISTS jarvis_core_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
];

// Once per database per isolate: the cron runs every minute and these never change.
const ready = new WeakSet<object>();
export async function ensureCoreSchema(db: D1Database) {
  if (ready.has(db)) return;
  for (const sql of SCHEMA) await db.prepare(sql).run();
  ready.add(db);
}

type Row = {
  id: string; source: string; symbol: string; timeframe: string; side: string; time: number; entry: number; stop: number; target: number;
  note: string; result: string; r: number | null; closed_at: number | null; created_at: number;
};
const COLS = "id, source, symbol, timeframe, side, time, entry, stop, target, note, result, r, closed_at, created_at";

export function rowToSignal(r: Row): JarvisSignal {
  return {
    id: r.id,
    source: r.source as JarvisSource,
    symbol: r.symbol,
    timeframe: r.timeframe,
    side: r.side as JarvisSignal["side"],
    time: r.time,
    entry: r.entry,
    stop: r.stop,
    target: r.target,
    note: r.note,
    result: r.result as JarvisSignal["result"],
    r: r.r,
    closedAt: r.closed_at,
  };
}

async function readCounters(db: D1Database): Promise<Partial<Record<JarvisSource, CoreCounters>>> {
  const rows = (await db.prepare("SELECT source, resolved, wins, losses, gain, loss, total, open FROM jarvis_core_stats LIMIT 10").all<CoreCounters & { source: string }>()).results;
  const out: Partial<Record<JarvisSource, CoreCounters>> = {};
  for (const r of rows) out[r.source as JarvisSource] = { resolved: r.resolved, wins: r.wins, losses: r.losses, gain: r.gain, loss: r.loss, total: r.total, open: r.open };
  return out;
}

async function writeCounters(db: D1Database, source: JarvisSource, c: CoreCounters) {
  await db
    .prepare("INSERT OR REPLACE INTO jarvis_core_stats (source, resolved, wins, losses, gain, loss, total, open) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
    .bind(source, c.resolved, c.wins, c.losses, c.gain, c.loss, c.total, c.open)
    .run();
}

/** Records new signals (an id seen before is ignored) and counts them as open. */
export async function recordCoreSignals(db: D1Database, signals: JarvisSignal[], now: number): Promise<JarvisSignal[]> {
  await ensureCoreSchema(db);
  const added: JarvisSignal[] = [];
  for (const s of signals) {
    const res = await db
      .prepare(`INSERT OR IGNORE INTO jarvis_core_signals (${COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL, NULL, ?12)`)
      .bind(s.id, s.source, s.symbol, s.timeframe, s.side, s.time, s.entry, s.stop, s.target, s.note, "ABIERTA", now)
      .run();
    if (res.meta.changes) added.push(s);
  }
  if (added.length) {
    const counters = await readCounters(db);
    for (const src of new Set(added.map((s) => s.source))) {
      let c = counters[src] ?? ZERO;
      for (const s of added) if (s.source === src) c = countOpened(c);
      await writeCounters(db, src, c);
    }
  }
  return added;
}

export async function readCoreStats(db: D1Database) {
  await ensureCoreSchema(db);
  return coreStats(await readCounters(db));
}

export async function openCoreSignals(db: D1Database, limit = 40): Promise<JarvisSignal[]> {
  await ensureCoreSchema(db);
  return (await db.prepare(`SELECT ${COLS} FROM jarvis_core_signals WHERE result = 'ABIERTA' ORDER BY time DESC LIMIT ?1`).bind(limit).all<Row>()).results.map(rowToSignal);
}

/** Closes what the candles settled. Only an open row is updated, so a result is written once and counted once. */
export async function closeCoreSignals(db: D1Database, updated: JarvisSignal[]): Promise<JarvisSignal[]> {
  await ensureCoreSchema(db);
  const closed: JarvisSignal[] = [];
  for (const s of updated) {
    if (s.result === "ABIERTA" || s.r === null) continue;
    const res = await db
      .prepare("UPDATE jarvis_core_signals SET result = ?2, r = ?3, closed_at = ?4 WHERE id = ?1 AND result = 'ABIERTA'")
      .bind(s.id, s.result, s.r, s.closedAt)
      .run();
    if (res.meta.changes) closed.push(s);
  }
  if (closed.length) {
    const counters = await readCounters(db);
    for (const src of new Set(closed.map((s) => s.source))) {
      let c = counters[src] ?? ZERO;
      for (const s of closed) if (s.source === src) c = countClosed(c, s.r as number);
      await writeCounters(db, src, c);
    }
  }
  return closed;
}

export async function readHeartbeat(db: D1Database): Promise<CoreHeartbeat | null> {
  const row = await db.prepare("SELECT value FROM jarvis_core_state WHERE key = 'heartbeat'").first<{ value: string }>();
  try {
    return row ? (JSON.parse(row.value) as CoreHeartbeat) : null;
  } catch {
    return null;
  }
}

async function writeHeartbeat(db: D1Database, hb: CoreHeartbeat) {
  await db.prepare("INSERT OR REPLACE INTO jarvis_core_state (key, value) VALUES ('heartbeat', ?1)").bind(JSON.stringify(hb)).run();
}

/** Signals created or closed after `since` (newest first, at most `limit` of each). */
export async function coreActivitySince(db: D1Database, since: number, limit = 30): Promise<JarvisSignal[]> {
  await ensureCoreSchema(db);
  const created = (await db.prepare(`SELECT ${COLS} FROM jarvis_core_signals WHERE created_at > ?1 ORDER BY created_at DESC LIMIT ?2`).bind(since, limit).all<Row>()).results;
  const closed = (await db.prepare(`SELECT ${COLS} FROM jarvis_core_signals WHERE closed_at > ?1 ORDER BY closed_at DESC LIMIT ?2`).bind(since, limit).all<Row>()).results;
  const map = new Map<string, Row>();
  for (const r of [...created, ...closed]) map.set(r.id, r);
  return [...map.values()].map(rowToSignal);
}

export async function coreSnapshot(db: D1Database, now: number): Promise<CoreSnapshot> {
  await ensureCoreSchema(db);
  const [heartbeat, counters, open, recentRows] = await Promise.all([
    readHeartbeat(db),
    readCounters(db),
    openCoreSignals(db, 20),
    db.prepare(`SELECT ${COLS} FROM jarvis_core_signals WHERE closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 20`).all<Row>(),
  ]);
  return { heartbeat, stats: coreStats(counters), open, recent: recentRows.results.map(rowToSignal), generatedAt: now };
}

/**
 * Candles for the core: USDT-M futures first (the same market the app's map
 * reads, and reachable from the Worker), spot as fallback. From the cron's
 * data centre the spot hosts answered 403.
 */
async function coreCandles(symbol: string, limit: number, minCandles = Math.min(limit, 120)) {
  try {
    return (await fetchKlinesServer(symbol, CORE_TF, { limit, minCandles, market: "futures" })).candles;
  } catch {
    return (await fetchKlinesServer(symbol, CORE_TF, { limit, minCandles })).candles;
  }
}

/**
 * One minute of the core. Never throws: a failed job is noted in the
 * heartbeat and the next minute's job runs anyway.
 */
export async function runCoreTick(db: D1Database, now = Date.now()): Promise<CoreHeartbeat> {
  await ensureCoreSchema(db);
  const task = coreTask(Math.floor(now / 60_000));
  const frameMs = timeframeConfig(CORE_TF).frameMs;
  let note = "";
  let ok = true;
  try {
    if (task.kind === "SCAN") {
      const found: JarvisSignal[] = [];
      const failed: string[] = [];
      for (const symbol of task.symbols) {
        try {
          const closed = closedOnly(await coreCandles(symbol, 200), frameMs, now);
          const s = scanSignal(symbol, closed);
          if (s) found.push(s);
        } catch (error) {
          // This coin's data is down this minute; it comes round again in 15.
          failed.push(`${symbol.replace(/USDT$/, "")} sin datos (${error instanceof Error ? error.message : "error"})`);
        }
      }
      const added = await recordCoreSignals(db, found, now);
      ok = failed.length < task.symbols.length;
      note = `${task.symbols.map((s) => s.replace(/USDT$/, "")).join("+")}: ${added.length ? `${added.length} señal nueva` : "sin ruptura"}${failed.length ? ` · ${failed.join(", ")}` : ""}`;
    } else if (task.kind === "MAGNET") {
      const cfg = timeframeConfig(CORE_TF);
      const closed = closedOnly(await coreCandles(task.symbol, 500), frameMs, now);
      if (closed.length >= 200) {
        const oi = await loadOiDelta(task.symbol, CORE_TF, closed.map((c) => c.openTime), AbortSignal.timeout(6000)).catch(() => null);
        const opts = { halfLifeCandles: cfg.halfLife, priceRangePct: cfg.priceRange };
        const prev = closed.slice(0, -1);
        const before = buildLiquidationHeatmap(task.symbol, prev, prev[prev.length - 1].close, { ...opts, oiDeltaByIndex: oi?.slice(0, -1) ?? undefined });
        const nowMap = buildLiquidationHeatmap(task.symbol, closed, closed[closed.length - 1].close, { ...opts, oiDeltaByIndex: oi ?? undefined });
        const added = await recordCoreSignals(db, magnetSignals(task.symbol, closed, before, nowMap), now);
        note = `imanes ${task.symbol.replace(/USDT$/, "")}: ${added.length ? "barrida con rechazo" : "sin barrida"}`;
      } else note = `imanes ${task.symbol.replace(/USDT$/, "")}: pocas velas`;
    } else if (task.kind === "RESOLVE") {
      const open = await openCoreSignals(db, 40);
      const bySymbol = new Map<string, JarvisSignal[]>();
      for (const s of open) bySymbol.set(s.symbol, [...(bySymbol.get(s.symbol) ?? []), s]);
      const updated: JarvisSignal[] = [];
      // At most 12 coins per minute: the free plan allows 50 outside requests per run.
      for (const [symbol, list] of [...bySymbol].slice(0, 12)) {
        try {
          const closed = closedOnly(await coreCandles(symbol, 200, 1), frameMs, now);
          for (const s of list) updated.push(resolveSignal(s, closed, frameMs));
        } catch {
          // Try again next cycle.
        }
      }
      const closedNow = await closeCoreSignals(db, updated);
      note = `${open.length} abiertas, ${closedNow.length} cerradas ahora`;
    } else note = "descanso";
  } catch (error) {
    ok = false;
    note = `error: ${error instanceof Error ? error.message : String(error)}`.slice(0, 160);
  }
  const hb: CoreHeartbeat = { at: now, task: task.kind, ok, note };
  await writeHeartbeat(db, hb).catch(() => undefined);
  return hb;
}
