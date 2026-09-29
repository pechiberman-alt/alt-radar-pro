import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_NOTE, type JFill } from "../lib/account-journal.ts";
import {
  countJournalFills, ensureDiarioSchema, listJournalFills, listJournalNotes, saveJournalFills, saveJournalNote, TRADE_KEY,
} from "../lib/diario-db.ts";

// node:sqlite stands in for D1 (same SQL dialect). Skipped where it isn't available.
const sqlite = await import("node:sqlite").catch(() => null);

function makeDb() {
  const sql = new sqlite!.DatabaseSync(":memory:");
  const stmt = (q: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(q, a),
    run: async () => ({ meta: { changes: Number(sql.prepare(q).run(...(args as never[])).changes) } }),
    first: async () => sql.prepare(q).get(...(args as never[])) ?? null,
    all: async () => ({ results: sql.prepare(q).all(...(args as never[])) }),
  });
  return { prepare: (q: string) => stmt(q), batch: async (list: { run: () => Promise<unknown> }[]) => Promise.all(list.map((s) => s.run())) } as never as D1Database;
}
const fill = (id: string, time: number, market: "futures" | "spot" = "spot"): JFill => ({
  id, market, source: "sync", time, symbol: "BTCUSDT", side: "BUY", price: 1, qty: 1, fee: 0, feeAsset: "USDT", realizedPnl: null, positionSide: "BOTH", liquidation: false,
});

test("fills are stored once, per user, listed oldest first, and counted without scanning", { skip: !sqlite }, async () => {
  const db = makeDb();
  await ensureDiarioSchema(db);
  await ensureDiarioSchema(db);
  assert.equal(await saveJournalFills(db, 1, [fill("a", 30), fill("b", 10), fill("a", 30, "futures")]), 3, "same id in another market is another fill");
  assert.equal(await saveJournalFills(db, 1, [fill("a", 30)]), 0, "a resend is skipped");
  assert.equal(await saveJournalFills(db, 2, [fill("a", 30)]), 1, "another user is separate");
  assert.equal(await countJournalFills(db, 1), 3);
  assert.equal(await countJournalFills(db, 2), 1);
  assert.deepEqual((await listJournalFills(db, 1)).map((f) => f.id), ["b", "a", "a"]);
  assert.equal(await saveJournalFills(db, 1, []), 0);
});

test("a note is replaced on save, kept per user, and new ones are counted against the limit", { skip: !sqlite }, async () => {
  const db = makeDb();
  await ensureDiarioSchema(db);
  const key = "futures:BTCUSDT:1790000000000:L";
  assert.ok(TRADE_KEY.test(key));
  assert.ok(await saveJournalNote(db, 1, key, { ...EMPTY_NOTE, notes: "uno" }));
  assert.ok(await saveJournalNote(db, 1, key, { ...EMPTY_NOTE, notes: "dos", stop: 90 }));
  await saveJournalNote(db, 2, key, { ...EMPTY_NOTE, notes: "otro usuario" });
  const notes = await listJournalNotes(db, 1);
  assert.deepEqual(Object.keys(notes), [key]);
  assert.equal(notes[key].notes, "dos");
  assert.equal(notes[key].stop, 90);
  assert.equal((await db.prepare("SELECT n FROM journal_notes_counts WHERE user_id = 1").first<{ n: number }>())?.n, 1, "replacing doesn't count twice");
});

test("trade keys are strictly shaped", () => {
  for (const good of ["futures:BTCUSDT:1790000000000:L", "spot:1000SHIBUSDT:1790000000000:S"]) assert.ok(TRADE_KEY.test(good), good);
  for (const bad of ["futures:btc:1:L", "options:BTCUSDT:1790000000000:L", "futures:BTCUSDT:abc:L", "futures:BTCUSDT:1790000000000:X", "futures:BTC USDT:1790000000000:L"]) assert.ok(!TRADE_KEY.test(bad), bad);
});
