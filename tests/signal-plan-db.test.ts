import assert from "node:assert/strict";
import test from "node:test";
import type { SwingCandle } from "../lib/swing-entries.ts";
import { attachPlan, ensureSignalPlanColumns, evaluateSignalPlans, getPlanStatsCached, loadPlanStats, PLAN_COLUMNS, resetPlanColumnsCache } from "../lib/signal-plan-db.ts";
import { kindKey, type SignalPlan } from "../lib/signal-plan.ts";

const sqlite = await import("node:sqlite").catch(() => null);

function makeDb() {
  const sql = new sqlite!.DatabaseSync(":memory:");
  const seen: string[] = [];
  const stmt = (q: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(q, a),
    run: async () => { seen.push(q); return { meta: { changes: Number(sql.prepare(q).run(...(args as never[])).changes) } }; },
    first: async () => { seen.push(q); return sql.prepare(q).get(...(args as never[])) ?? null; },
    all: async () => { seen.push(q); return { results: sql.prepare(q).all(...(args as never[])) }; },
  });
  const db = { prepare: (q: string) => stmt(q) } as never as D1Database;
  sql.exec(`CREATE TABLE signal_records (id TEXT PRIMARY KEY, symbol TEXT, side TEXT, signal TEXT, score INTEGER, entry_price REAL, timeframe TEXT, detected_at TEXT, status TEXT);
            CREATE INDEX signal_records_detected_idx ON signal_records(detected_at);
            CREATE TABLE automation_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);`);
  const insert = (id: string, o: { symbol?: string; side?: string; signal?: string; timeframe?: string; detected: string }) =>
    sql.prepare("INSERT INTO signal_records (id, symbol, side, signal, score, entry_price, timeframe, detected_at, status) VALUES (?,?,?,?,?,?,?,?, 'MONITORING')")
      .run(id, o.symbol ?? "XRPUSDT", o.side ?? "LONG", o.signal ?? "TRIGGER", 80, 100, o.timeframe ?? "15m / 1H / 4H", o.detected);
  const row = (id: string) => sql.prepare("SELECT * FROM signal_records WHERE id = ?").get(id) as Record<string, unknown>;
  return { db, sql, seen, insert, row };
}

const NOW = Date.UTC(2026, 8, 29, 12, 0, 0);
const F = 300_000;
const plan: SignalPlan = { stop: 98, tp1: 102, tp2: 104, tp3: 106, atr: 2, version: "atr-v1" };
const cndl = (openTime: number, high: number, low: number): SwingCandle => ({ openTime, open: 100, high, low, close: 100, volume: 1, quoteVolume: 1 });
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

test("the plan columns are added once, only the missing ones, and never to a table that isn't there", { skip: !sqlite }, async () => {
  resetPlanColumnsCache();
  const empty = new sqlite!.DatabaseSync(":memory:");
  const noTable = { prepare: (q: string) => ({ all: async () => ({ results: empty.prepare(q).all() }), run: async () => ({}) }) } as never as D1Database;
  await ensureSignalPlanColumns(noTable);
  const t = makeDb();
  t.sql.exec("ALTER TABLE signal_records ADD COLUMN stop_price REAL");
  await ensureSignalPlanColumns(t.db);
  const names = (t.sql.prepare("PRAGMA table_info(signal_records)").all() as { name: string }[]).map((r) => r.name);
  for (const [name] of PLAN_COLUMNS) assert.ok(names.includes(name), name);
  assert.equal(names.filter((n) => n === "stop_price").length, 1);
  const before = t.seen.length;
  await ensureSignalPlanColumns(t.db);
  assert.equal(t.seen.length, before, "second call is free");
});

test("a plan is written next to its signal and the evaluator settles it from the candles that followed", { skip: !sqlite }, async () => {
  resetPlanColumnsCache();
  const t = makeDb();
  await ensureSignalPlanColumns(t.db);
  const detected = new Date(Math.ceil((NOW - 2 * 3_600_000) / F) * F).toISOString();
  t.insert("a", { detected });
  await attachPlan(t.db, "a", plan);
  assert.deepEqual([t.row("a").stop_price, t.row("a").tp3_price, t.row("a").plan_version], [98, 106, "atr-v1"]);
  const d = Date.parse(detected);
  const out = await evaluateSignalPlans(t.db, NOW, async () => ({ candles: [cndl(d, 101, 99), cndl(d + F, 102.5, 100), cndl(d + 2 * F, 103, 97.5)] }));
  assert.deepEqual(out, { checked: 1, updated: 1, resolved: 1, failed: 0 });
  const r = t.row("a");
  assert.equal(r.plan_outcome, "TP1");
  assert.equal(r.tp1_at, new Date(d + 2 * F).toISOString());
  assert.equal(r.sl_at, new Date(d + 3 * F).toISOString());
  assert.equal(r.plan_closed_at, r.sl_at);
  const again = await evaluateSignalPlans(t.db, NOW, async () => { throw new Error("a settled signal must not be fetched again"); });
  assert.deepEqual(again, { checked: 0, updated: 0, resolved: 0, failed: 0 });
});

test("an open signal keeps its partial hits and is re-read next time; an unchanged one is not rewritten", { skip: !sqlite }, async () => {
  resetPlanColumnsCache();
  const t = makeDb();
  await ensureSignalPlanColumns(t.db);
  const detected = new Date(Math.ceil((NOW - 2 * 3_600_000) / F) * F).toISOString();
  t.insert("a", { detected });
  await attachPlan(t.db, "a", plan);
  const d = Date.parse(detected);
  const candles = [cndl(d, 102.5, 100)];
  const first = await evaluateSignalPlans(t.db, NOW, async () => ({ candles }));
  assert.equal(first.updated, 1);
  assert.equal(first.resolved, 0);
  assert.equal(t.row("a").plan_outcome, null);
  assert.equal(t.row("a").tp1_at, new Date(d + F).toISOString());
  assert.equal((await evaluateSignalPlans(t.db, NOW, async () => ({ candles }))).updated, 0, "nothing changed, nothing written");
  candles.push(cndl(d + F, 106.5, 100));
  assert.equal(t.row("a").plan_outcome, null);
  assert.equal((await evaluateSignalPlans(t.db, NOW, async () => ({ candles }))).resolved, 1);
  assert.equal(t.row("a").plan_outcome, "TP3");
});

test("candles are fetched once per symbol from the earliest detection; one symbol failing doesn't stop the rest; old and plan-less rows are left alone", { skip: !sqlite }, async () => {
  resetPlanColumnsCache();
  const t = makeDb();
  await ensureSignalPlanColumns(t.db);
  const d1 = new Date(Math.ceil((NOW - 5 * 3_600_000) / F) * F).toISOString();
  const d2 = new Date(Math.ceil((NOW - 2 * 3_600_000) / F) * F).toISOString();
  t.insert("x1", { symbol: "XRPUSDT", detected: d1 });
  t.insert("x2", { symbol: "XRPUSDT", detected: d2 });
  t.insert("s1", { symbol: "SOLUSDT", detected: d2 });
  t.insert("old", { symbol: "XRPUSDT", detected: hoursAgo(60) });
  t.insert("noplan", { symbol: "ETHUSDT", detected: d2 });
  for (const id of ["x1", "x2", "s1", "old"]) await attachPlan(t.db, id, plan);
  const calls: [string, number | undefined][] = [];
  const out = await evaluateSignalPlans(t.db, NOW, async (symbol, _i, opts) => {
    calls.push([symbol, opts.startTime]);
    if (symbol === "SOLUSDT") throw new Error("no data");
    return { candles: [cndl(Date.parse(d2), 101, 97)] };
  });
  assert.deepEqual(calls.sort(), [["SOLUSDT", Date.parse(d2)], ["XRPUSDT", Date.parse(d1)]].sort());
  assert.equal(out.failed, 1);
  assert.equal(t.row("x2").plan_outcome, "SL");
  assert.equal(t.row("s1").plan_outcome, null, "retried on the next run");
  assert.equal(t.row("old").plan_outcome, null, "older than two days: not this job's business");
});

test("statistics are grouped by family, type and side; scalp signals are told apart; the answer is cached for an hour", { skip: !sqlite }, async () => {
  resetPlanColumnsCache();
  const t = makeDb();
  await ensureSignalPlanColumns(t.db);
  const give = (id: string, o: Parameters<typeof t.insert>[1], outcome: string | null) => {
    t.insert(id, o);
    t.sql.prepare("UPDATE signal_records SET plan_outcome = ? WHERE id = ?").run(outcome, id);
  };
  give("1", { detected: hoursAgo(5) }, "TP2");
  give("2", { detected: hoursAgo(6) }, "SL");
  give("3", { detected: hoursAgo(7), timeframe: "SCALP 5M / 15M", side: "SHORT", signal: "SETUP" }, "TP1");
  give("4", { detected: hoursAgo(8) }, null);
  give("5", { detected: hoursAgo(24 * 100) }, "SL");
  const stats = await loadPlanStats(t.db, NOW);
  assert.deepEqual(stats.map((s) => [s.kind, s.n, s.reachedTp1, s.sl]).sort(), [[kindKey("CONFLUENCIA", "TRIGGER", "LONG"), 2, 1, 1], [kindKey("SCALP", "SETUP", "SHORT"), 1, 1, 0]].sort());
  const scans = () => t.seen.filter((q) => q.includes("GROUP BY")).length;
  const before = scans();
  assert.equal((await getPlanStatsCached(t.db, NOW)).length, 2);
  assert.equal(scans(), before + 1);
  assert.equal((await getPlanStatsCached(t.db, NOW + 1_800_000)).length, 2);
  assert.equal(scans(), before + 1, "within the hour: served from the cache");
  await getPlanStatsCached(t.db, NOW + 3_700_000);
  assert.equal(scans(), before + 2, "after the hour it is recomputed");
});
