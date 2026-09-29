import { journalKey, type JournalRow } from "./bot-journal.ts";

/**
 * The bot record, stored per account. Rows are written once and never
 * rewritten (a closed trade doesn't change), so an insert that finds the key
 * already there is simply skipped — a browser can safely send the same trade
 * twice. The row itself is kept as JSON: the report is computed in the app,
 * and new fields don't need a migration.
 */

const MAX_ROWS_PER_USER = 20_000;

export async function ensureBotJournalSchema(db: D1Database) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS bot_journal (
        user_id INTEGER NOT NULL,
        run_started_at INTEGER NOT NULL,
        trade_id TEXT NOT NULL,
        exit_time INTEGER NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
        PRIMARY KEY (user_id, run_started_at, trade_id)
      )`,
    )
    .run();
  // One row per account with its running total. COUNT(*) over the journal
  // would read every stored trade on every save, and D1's free tier caps rows
  // read per day — this app has already hit that cap more than once.
  await db
    .prepare("CREATE TABLE IF NOT EXISTS bot_journal_counts (user_id INTEGER PRIMARY KEY, n INTEGER NOT NULL)")
    .run();
}

export async function listBotJournal(db: D1Database, userId: number, limit = MAX_ROWS_PER_USER): Promise<JournalRow[]> {
  const result = await db
    .prepare("SELECT data FROM bot_journal WHERE user_id = ? ORDER BY exit_time DESC LIMIT ?")
    .bind(userId, limit)
    .all<{ data: string }>();
  const rows: JournalRow[] = [];
  for (const r of result.results ?? []) {
    try {
      rows.push(JSON.parse(r.data) as JournalRow);
    } catch {
      // a row that can't be read is skipped rather than failing the whole report
    }
  }
  return rows.reverse();
}

export async function countBotJournal(db: D1Database, userId: number): Promise<number> {
  const r = await db.prepare("SELECT n FROM bot_journal_counts WHERE user_id = ?").bind(userId).first<{ n: number }>();
  return r?.n ?? 0;
}

/** Inserts the rows that aren't stored yet; returns how many were new. */
export async function saveBotJournal(db: D1Database, userId: number, rows: JournalRow[]): Promise<number> {
  if (!rows.length) return 0;
  const statements = rows.map((row) =>
    db
      .prepare("INSERT OR IGNORE INTO bot_journal (user_id, run_started_at, trade_id, exit_time, data) VALUES (?, ?, ?, ?, ?)")
      .bind(userId, row.runStartedAt, row.id, row.exitTime, JSON.stringify(row)),
  );
  const results = await db.batch(statements);
  const saved = results.reduce((sum, r) => sum + (r.meta?.changes ?? 0), 0);
  if (saved > 0) {
    await db
      .prepare("INSERT INTO bot_journal_counts (user_id, n) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET n = n + excluded.n")
      .bind(userId, saved)
      .run();
  }
  return saved;
}

export { journalKey, MAX_ROWS_PER_USER };
