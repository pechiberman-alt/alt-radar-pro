import { BinanceApiError } from "./binance-account.ts";

/**
 * A durable trail for Binance-related failures, written to D1.
 *
 * There is no tool in this environment that can read live Cloudflare Worker
 * logs — the only way to see what actually happened on a failed request is
 * to have the request write it down somewhere queryable. This is that: a
 * small, self-bootstrapping table any of the /api/binance/* routes can log
 * a failure to, so the next attempt is diagnosable from D1 directly instead
 * of guessing from the generic message the person saw.
 *
 * Logging failures never surface to the caller — this must never turn a
 * real response into a 500 just because the log write itself failed.
 */
export async function logBinanceFailure(
  db: D1Database,
  context: string,
  userId: number,
  error: unknown,
): Promise<void> {
  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS binance_debug_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          context TEXT NOT NULL,
          user_id INTEGER NOT NULL,
          error_name TEXT,
          error_message TEXT,
          status INTEGER,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
        )`,
      )
      .run();
    const name = error instanceof Error ? error.name : typeof error;
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    const status = error instanceof BinanceApiError ? error.status : null;
    await db
      .prepare(
        `INSERT INTO binance_debug_log (context, user_id, error_name, error_message, status) VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(context, userId, name, message, status)
      .run();
  } catch {
    // Best-effort only — see the doc comment above.
  }
}
