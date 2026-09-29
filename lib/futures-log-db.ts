import type { FuturesLogRow } from "./futures-log.ts";

/**
 * The real-account futures record, per account. Rows never change once
 * written, so a duplicate (two open tabs record the same execution) is simply
 * skipped. Stored as JSON; the report is computed in the app.
 */

export const MAX_FUTURES_LOG_ROWS = 50_000;

export async function ensureFuturesLogSchema(db: D1Database) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS binance_futures_log (
        user_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        event_id TEXT NOT NULL,
        time INTEGER NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
        PRIMARY KEY (user_id, kind, event_id)
      )`,
    )
    .run();
  // Running total per account: COUNT(*) would read the whole record on every
  // save, against D1's daily read cap.
  await db
    .prepare("CREATE TABLE IF NOT EXISTS binance_futures_log_counts (user_id INTEGER PRIMARY KEY, n INTEGER NOT NULL)")
    .run();
}

export async function listFuturesLog(db: D1Database, userId: number, limit = MAX_FUTURES_LOG_ROWS): Promise<FuturesLogRow[]> {
  const result = await db
    .prepare("SELECT data FROM binance_futures_log WHERE user_id = ? ORDER BY time DESC LIMIT ?")
    .bind(userId, limit)
    .all<{ data: string }>();
  const rows: FuturesLogRow[] = [];
  for (const r of result.results ?? []) {
    try {
      rows.push(JSON.parse(r.data) as FuturesLogRow);
    } catch {
      // skip an unreadable row rather than fail the report
    }
  }
  return rows.reverse();
}

export async function countFuturesLog(db: D1Database, userId: number): Promise<number> {
  const r = await db.prepare("SELECT n FROM binance_futures_log_counts WHERE user_id = ?").bind(userId).first<{ n: number }>();
  return r?.n ?? 0;
}

export async function saveFuturesLog(db: D1Database, userId: number, rows: FuturesLogRow[]): Promise<number> {
  if (!rows.length) return 0;
  const results = await db.batch(
    rows.map((row) =>
      db
        .prepare("INSERT OR IGNORE INTO binance_futures_log (user_id, kind, event_id, time, data) VALUES (?, ?, ?, ?, ?)")
        .bind(userId, row.kind, row.id, row.time, JSON.stringify(row)),
    ),
  );
  const saved = results.reduce((sum, r) => sum + (r.meta?.changes ?? 0), 0);
  if (saved > 0) {
    await db
      .prepare("INSERT INTO binance_futures_log_counts (user_id, n) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET n = n + excluded.n")
      .bind(userId, saved)
      .run();
  }
  return saved;
}
