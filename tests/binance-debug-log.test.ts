import assert from "node:assert/strict";
import test from "node:test";
import { BinanceApiError } from "../lib/binance-account.ts";
import { logBinanceFailure } from "../lib/binance-debug-log.ts";

/** Same minimal in-memory fake used elsewhere: enough SQL support for one
 *  CREATE TABLE IF NOT EXISTS and one INSERT. */
function fakeD1() {
  const rows: Record<string, unknown>[] = [];
  let created = false;
  return {
    rows,
    prepare(sql: string) {
      let bound: unknown[] = [];
      const api = {
        bind(...args: unknown[]) {
          bound = args;
          return api;
        },
        async run() {
          if (sql.startsWith("CREATE TABLE")) {
            created = true;
            return;
          }
          if (sql.startsWith("INSERT INTO binance_debug_log")) {
            if (!created) throw new Error("table not created yet");
            const [context, user_id, error_name, error_message, status] = bound;
            rows.push({ context, user_id, error_name, error_message, status });
            return;
          }
          throw new Error(`fakeD1: unhandled run() for: ${sql}`);
        },
      };
      return api;
    },
  } as unknown as D1Database & { rows: Record<string, unknown>[] };
}

test("logs a BinanceApiError with its status and message", async () => {
  const db = fakeD1();
  await logBinanceFailure(db, "link", 1, new BinanceApiError("NON_JSON_RESPONSE_451:<html>blocked</html>", 451));
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].context, "link");
  assert.equal(db.rows[0].user_id, 1);
  assert.equal(db.rows[0].status, 451);
  assert.match(db.rows[0].error_message as string, /NON_JSON_RESPONSE_451/);
});

test("logs a plain Error with a null status", async () => {
  const db = fakeD1();
  await logBinanceFailure(db, "futures", 7, new Error("D1_UNAVAILABLE"));
  assert.equal(db.rows[0].status, null);
  assert.equal(db.rows[0].error_name, "Error");
});

test("a very long message is truncated so the row stays bounded", async () => {
  const db = fakeD1();
  await logBinanceFailure(db, "risk", 1, new Error("x".repeat(2000)));
  assert.equal((db.rows[0].error_message as string).length, 500);
});

test("logging never throws, even when the value thrown isn't an Error at all", async () => {
  const db = fakeD1();
  await assert.doesNotReject(logBinanceFailure(db, "portfolio", 1, "a plain string, not an Error"));
  assert.equal(db.rows[0].error_name, "string");
  assert.equal(db.rows[0].error_message, "a plain string, not an Error");
});

test("a failure in the log write itself never propagates — the real response must never break because of this", async () => {
  const brokenDb = {
    prepare() {
      throw new Error("D1 is down");
    },
  } as unknown as D1Database;
  await assert.doesNotReject(logBinanceFailure(brokenDb, "link", 1, new Error("original failure")));
});
