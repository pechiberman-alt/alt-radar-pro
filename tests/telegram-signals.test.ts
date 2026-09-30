import assert from "node:assert/strict";
import test from "node:test";
import { kindKey, planStats } from "../lib/signal-plan.ts";
import { resetPlanColumnsCache } from "../lib/signal-plan-db.ts";
import { parseCommand, signalEvent } from "../lib/telegram.ts";
import { runTelegramDispatch } from "../lib/telegram-dispatch.ts";

const sqlite = await import("node:sqlite").catch(() => null);
const base = { id: "s1", symbol: "XRPUSDT", side: "SHORT", signal: "TRIGGER", score: 81, entryPrice: 1.495, timeframe: "15m / 1H / 4H" };
const plan = { stop: 1.512, tp1: 1.478, tp2: 1.461, tp3: 1.444 };

test("the message with a plan: entry, stop with its distance, three targets with their R, the history of that kind, and the honest closing line", () => {
  const stats = planStats([{ kind: kindKey("CONFLUENCIA", "TRIGGER", "SHORT"), outcome: "TP1", n: 7 }, { kind: kindKey("CONFLUENCIA", "TRIGGER", "SHORT"), outcome: "SL", n: 3 }])[0];
  const e = signalEvent({ ...base, plan, stats });
  assert.match(e.text, /<b>XRP · 🔴 SHORT<\/b>/);
  assert.match(e.text, /Entrada 1,495/);
  assert.match(e.text, /🛑 SL 1,512 \(\+1,14%\)/);
  assert.match(e.text, /🎯 TP1 1,478 \(1,0R\) · TP2 1,461 \(2,0R\) · TP3 1,444 \(3,0R\)/);
  assert.match(e.text, /📊 Historial de este tipo: TP1 70% · TP2 0% · TP3 0% · SL 30% · 10 señales \(muestra mínima\)/);
  assert.match(e.text, /Plan fijado al detectar la señal\. No es una orden\./);
  assert.doesNotMatch(e.text, /Objetivo y riesgo en ALT RADAR/);
});

test("a big enough sample drops the caveat; no stats means no history line; no plan keeps the old closing line", () => {
  const big = planStats([{ kind: "k", outcome: "TP1", n: 20 }])[0];
  assert.doesNotMatch(signalEvent({ ...base, plan, stats: big }).text, /muestra mínima/);
  assert.doesNotMatch(signalEvent({ ...base, plan }).text, /Historial/);
  const plain = signalEvent(base);
  assert.doesNotMatch(plain.text, /SL|TP1/);
  assert.match(plain.text, /Objetivo y riesgo en ALT RADAR → HISTORIAL\. No es una orden\./);
  assert.equal(plain.key, "signal:s1");
  assert.equal(plain.score, 81);
});

test("/resultados and its aliases are commands; other text is still a question for the analyst", () => {
  for (const t of ["/resultados", "/resultado", "/winrate", "/resultados@altbot"]) assert.equal(parseCommand(t).cmd, "resultados", t);
  assert.equal(parseCommand("/estado").cmd, "estado");
  assert.equal(parseCommand("resultados?").cmd, "texto");
});

// ─── dispatch, end to end ─────────────────────────────────────────────────

const NOW = Date.UTC(2026, 8, 29, 15, 0, 0);
const at = (minutes: number, seconds = 0) => new Date(NOW - minutes * 60_000 - seconds * 1000).toISOString();

function setup(withPlanColumns: boolean) {
  const sql = new sqlite!.DatabaseSync(":memory:");
  sql.exec(`CREATE TABLE signal_records (id TEXT PRIMARY KEY, symbol TEXT, side TEXT, signal TEXT, score INTEGER, entry_price REAL, timeframe TEXT, detected_at TEXT, status TEXT${
    withPlanColumns ? ", stop_price REAL, tp1_price REAL, tp2_price REAL, tp3_price REAL, plan_outcome TEXT" : ""
  });
  CREATE INDEX signal_records_detected_idx ON signal_records(detected_at);
  CREATE TABLE automation_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);`);
  const stmt = (q: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(q, a),
    run: async () => ({ meta: { changes: Number(sql.prepare(q).run(...(args as never[])).changes) } }),
    first: async () => sql.prepare(q).get(...(args as never[])) ?? null,
    all: async () => ({ results: sql.prepare(q).all(...(args as never[])) }),
  });
  const db = { prepare: (q: string) => stmt(q) } as never as D1Database;
  const add = (id: string, detected: string, o: { plan?: boolean; outcome?: string; signal?: string; timeframe?: string; side?: string; score?: number } = {}) => {
    sql.prepare("INSERT INTO signal_records (id, symbol, side, signal, score, entry_price, timeframe, detected_at, status) VALUES (?,?,?,?,?,?,?,?, 'MONITORING')")
      .run(id, "XRPUSDT", o.side ?? "SHORT", o.signal ?? "TRIGGER", o.score ?? 81, 1.495, o.timeframe ?? "15m / 1H / 4H", detected);
    if (withPlanColumns && (o.plan || o.outcome)) {
      sql.prepare("UPDATE signal_records SET stop_price=?, tp1_price=?, tp2_price=?, tp3_price=?, plan_outcome=? WHERE id=?")
        .run(plan.stop, plan.tp1, plan.tp2, plan.tp3, o.outcome ?? null, id);
    }
  };
  return { sql, db, add };
}

async function dispatch(db: D1Database, now: number) {
  const sent: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    if (String(url).includes("api.telegram.org")) {
      sent.push((JSON.parse(init?.body ?? "{}") as { text: string }).text);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response("unavailable", { status: 503 });
  }) as typeof fetch;
  try {
    await runTelegramDispatch(db, "TOKEN", now);
  } finally {
    globalThis.fetch = real;
  }
  return sent;
}

function link(sql: InstanceType<NonNullable<typeof sqlite>["DatabaseSync"]>, since: string) {
  sql.exec(`CREATE TABLE IF NOT EXISTS telegram_links (user_id INTEGER PRIMARY KEY, chat_id TEXT NOT NULL, prefs TEXT NOT NULL DEFAULT '{}', linked_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS telegram_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  sql.prepare("INSERT INTO telegram_links (user_id, chat_id, prefs, linked_at) VALUES (1, '99', '{\"signalMinScore\":60}', '2026-09-24')").run();
  sql.prepare("INSERT INTO telegram_state (key, value) VALUES ('signals_since', ?)").run(since);
}

test("DISPATCH: a signal goes out with its plan and the history of its kind; one detected seconds ago waits a run and then goes", { skip: !sqlite }, async () => {
  resetPlanColumnsCache();
  const t = setup(true);
  link(t.sql, at(120));
  t.add("h1", at(600), { outcome: "TP1" });
  t.add("h2", at(610), { outcome: "TP1" });
  t.add("h3", at(620), { outcome: "SL" });
  t.add("new", at(10), { plan: true });
  t.add("fresh", at(0, 30), { plan: true, side: "LONG" });
  const first = await dispatch(t.db, NOW);
  const signals = first.filter((m) => m.includes("convicción"));
  assert.equal(signals.length, 1, "only the settled signal");
  assert.match(signals[0], /🛑 SL 1,512/);
  assert.match(signals[0], /Historial de este tipo: TP1 67% · TP2 0% · TP3 0% · SL 33% · 3 señales \(muestra mínima\)/);
  const second = await dispatch(t.db, NOW + 3 * 60_000);
  const later = second.filter((m) => m.includes("convicción"));
  assert.equal(later.length, 1, "the one that was still fresh now goes, and the first is not repeated");
  assert.match(later[0], /LONG/);
  assert.equal((await dispatch(t.db, NOW + 6 * 60_000)).filter((m) => m.includes("convicción")).length, 0, "nothing is sent twice");
});

test("DISPATCH: a scalping signal is told apart from a confluence one in the history", { skip: !sqlite }, async () => {
  resetPlanColumnsCache();
  const t = setup(true);
  link(t.sql, at(120));
  for (let i = 0; i < 4; i += 1) t.add(`sc${i}`, at(600 + i), { outcome: i < 3 ? "TP1" : "SL", timeframe: "SCALP 5M / 15M", signal: "SETUP" });
  t.add("c1", at(700), { outcome: "SL" });
  t.add("now", at(10), { plan: true, timeframe: "SCALP 5M / 15M", signal: "SETUP" });
  const m = (await dispatch(t.db, NOW)).find((x) => x.includes("convicción"))!;
  assert.match(m, /TP1 75% · TP2 0% · TP3 0% · SL 25% · 4 señales/, "only the scalp setups, not the confluence stop");
});

test("DISPATCH: if the plan columns can't be added, signals still go out as before", { skip: !sqlite }, async () => {
  resetPlanColumnsCache();
  const t = setup(false);
  link(t.sql, at(120));
  t.add("old", at(10));
  const real = t.db;
  const guarded = { prepare: (q: string) => { if (/ALTER TABLE/.test(q)) throw new Error("read-only"); return real.prepare(q); } } as never as D1Database;
  const sent = await dispatch(guarded, NOW);
  const m = sent.find((x) => x.includes("convicción"))!;
  assert.ok(m, "the signal still reached the chat");
  assert.match(m, /Objetivo y riesgo en ALT RADAR → HISTORIAL/);
  assert.doesNotMatch(m, /SL|TP1/);
});
