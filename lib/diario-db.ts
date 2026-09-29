import type { JFill, TradeNote } from "./account-journal.ts";

/**
 * Storage for the account journal: the spot fills read from Binance and the
 * rows imported from Binance's files (futures fills recorded live stay in
 * binance_futures_log), plus the person's notes on each trade.
 *
 * Fills never change once written, so a resend is skipped. Notes do change,
 * so they are upserted. Per-account totals are kept in a one-row counter:
 * COUNT(*) would read every stored row on each save, against D1's daily read cap.
 */

export const MAX_JOURNAL_FILLS = 50_000;
export const MAX_JOURNAL_NOTES = 5_000;
export const TRADE_KEY = /^(futures|spot):[A-Z0-9]{2,24}:\d{10,14}:[LS]$/;

export async function ensureDiarioSchema(db: D1Database) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS journal_fills (
        user_id INTEGER NOT NULL,
        market TEXT NOT NULL,
        fill_id TEXT NOT NULL,
        time INTEGER NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
        PRIMARY KEY (user_id, market, fill_id)
      )`,
    )
    .run();
  await db.prepare("CREATE TABLE IF NOT EXISTS journal_fills_counts (user_id INTEGER PRIMARY KEY, n INTEGER NOT NULL)").run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS journal_notes (
        user_id INTEGER NOT NULL,
        trade_key TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
        PRIMARY KEY (user_id, trade_key)
      )`,
    )
    .run();
  await db.prepare("CREATE TABLE IF NOT EXISTS journal_notes_counts (user_id INTEGER PRIMARY KEY, n INTEGER NOT NULL)").run();
}

export async function listJournalFills(db: D1Database, userId: number): Promise<JFill[]> {
  const result = await db
    .prepare("SELECT data FROM journal_fills WHERE user_id = ? ORDER BY time ASC LIMIT ?")
    .bind(userId, MAX_JOURNAL_FILLS)
    .all<{ data: string }>();
  const out: JFill[] = [];
  for (const r of result.results ?? []) {
    try {
      out.push(JSON.parse(r.data) as JFill);
    } catch {
      // an unreadable row is skipped rather than failing the whole journal
    }
  }
  return out;
}

export async function countJournalFills(db: D1Database, userId: number): Promise<number> {
  const r = await db.prepare("SELECT n FROM journal_fills_counts WHERE user_id = ?").bind(userId).first<{ n: number }>();
  return r?.n ?? 0;
}

export async function saveJournalFills(db: D1Database, userId: number, fills: JFill[]): Promise<number> {
  if (!fills.length) return 0;
  const results = await db.batch(
    fills.map((f) =>
      db
        .prepare("INSERT OR IGNORE INTO journal_fills (user_id, market, fill_id, time, data) VALUES (?, ?, ?, ?, ?)")
        .bind(userId, f.market, f.id, f.time, JSON.stringify(f)),
    ),
  );
  const saved = results.reduce((sum, r) => sum + (r.meta?.changes ?? 0), 0);
  if (saved > 0) {
    await db
      .prepare("INSERT INTO journal_fills_counts (user_id, n) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET n = n + excluded.n")
      .bind(userId, saved)
      .run();
  }
  return saved;
}

export async function listJournalNotes(db: D1Database, userId: number): Promise<Record<string, TradeNote>> {
  const result = await db.prepare("SELECT trade_key, data FROM journal_notes WHERE user_id = ?").bind(userId).all<{ trade_key: string; data: string }>();
  const out: Record<string, TradeNote> = {};
  for (const r of result.results ?? []) {
    try {
      out[r.trade_key] = JSON.parse(r.data) as TradeNote;
    } catch {
      // skipped
    }
  }
  return out;
}

/** Inserts or replaces a note. Returns false when the account is at the note limit and this would be a new one. */
export async function saveJournalNote(db: D1Database, userId: number, key: string, note: TradeNote): Promise<boolean> {
  const existing = await db.prepare("SELECT 1 AS x FROM journal_notes WHERE user_id = ? AND trade_key = ?").bind(userId, key).first<{ x: number }>();
  if (!existing) {
    const count = await db.prepare("SELECT n FROM journal_notes_counts WHERE user_id = ?").bind(userId).first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_JOURNAL_NOTES) return false;
    await db
      .prepare("INSERT INTO journal_notes_counts (user_id, n) VALUES (?, 1) ON CONFLICT(user_id) DO UPDATE SET n = n + 1")
      .bind(userId)
      .run();
  }
  await db
    .prepare(
      `INSERT INTO journal_notes (user_id, trade_key, data, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, trade_key) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(userId, key, JSON.stringify(note))
    .run();
  return true;
}
