import assert from "node:assert/strict";
import test from "node:test";
import {
  awaySpeech,
  closedOnly,
  CORE_COINS,
  CORE_MAGNETS,
  coreOnline,
  coreStats,
  coreStatusSpeech,
  coreTask,
  countClosed,
  countersToStats,
  countOpened,
  reviveSnapshot,
  scanSignal,
  ZERO,
  type CoreCounters,
} from "../lib/jarvis-core.ts";
import { closeCoreSignals, coreActivitySince, coreSnapshot, openCoreSignals, recordCoreSignals, runCoreTick } from "../lib/jarvis-core-db.ts";
import type { JarvisSignal } from "../lib/jarvis-ledger.ts";
import { lvStats } from "../lib/liq-vol-signals.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";
import { jarvisEvents } from "../lib/telegram-jarvis.ts";

const H = 3_600_000;
const M = 60_000;
const sqlite = await import("node:sqlite").catch(() => null);
function makeDb() {
  const sql = new sqlite!.DatabaseSync(":memory:");
  const stmt = (q: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(q, a),
    run: async () => ({ meta: { changes: Number(sql.prepare(q).run(...(args as never[])).changes) } }),
    first: async () => sql.prepare(q).get(...(args as never[])) ?? null,
    all: async () => ({ results: sql.prepare(q).all(...(args as never[])) }),
  });
  return { prepare: (q: string) => stmt(q), batch: async (l: { run: () => Promise<unknown> }[]) => Promise.all(l.map((s) => s.run())) } as never as D1Database;
}

/** A coil under a ceiling at 110 with rising lows: "a punto de romper" upward on its last closed candle. */
function coil(n = 200, t0 = 0): SwingCandle[] {
  const out: SwingCandle[] = [];
  for (let j = 0; j < n; j++) {
    let o, h, l, c, v;
    if (j < n - 40) {
      const mid = 100 + 3 * Math.sin(j / 4);
      [o, h, l, c, v] = [mid - 1, mid + 2.5, mid - 2.5, mid + 1, 900];
    } else {
      const k = j - (n - 40);
      const top = k % 6 === 3 ? 110 : 109.4;
      const floor = Math.min(104 + k * 0.15, top - 0.8);
      [o, h, l, c, v] = [floor + 0.4, top, floor, top - 0.05, 1200];
    }
    out.push({ openTime: t0 + j * H, open: o, high: h, low: l, close: c, volume: v, quoteVolume: v * c });
  }
  return out;
}

test("the 15-minute cycle covers 20 coins, 3 magnets, one resolution and a rest", () => {
  const scanned = new Set<string>();
  const kinds: string[] = [];
  for (let m = 0; m < 15; m++) {
    const t = coreTask(1_000_000 * 15 + m);
    kinds.push(t.kind);
    if (t.kind === "SCAN") t.symbols.forEach((s) => scanned.add(s));
  }
  assert.equal(scanned.size, CORE_COINS.length);
  assert.deepEqual(kinds.filter((k) => k === "MAGNET").length, CORE_MAGNETS.length);
  assert.equal(kinds.filter((k) => k === "RESOLVE").length, 1);
  assert.equal(kinds[14], "REST");
  assert.deepEqual(coreTask(-1), coreTask(14), "never a negative slot");
});

test("no lookahead: the forming candle is dropped and cannot change the signal", () => {
  const c = coil();
  const frame = H;
  const now = c[c.length - 1].openTime + frame + 5 * M; // last one closed 5 minutes ago
  const forming = { openTime: now - 5 * M, open: 109.9, high: 140, low: 60, close: 135, volume: 1e6, quoteVolume: 1e8 };
  const withForming = closedOnly([...c, forming], frame, now);
  assert.equal(withForming.length, c.length);
  const s = scanSignal("TRIUSDT", withForming);
  assert.ok(s, "a coil under a ceiling gives a signal");
  assert.equal(s!.side, "LONG");
  assert.equal(s!.time, c[c.length - 1].openTime, "dated on the last closed candle");
  assert.deepEqual(s, scanSignal("TRIUSDT", c));
});

test("running counters match lvStats on the same trades, open counted in and out", () => {
  const rs = [1.92, -1.06, -1.06, 0.31, 1.92, -0.4, 0];
  let c: CoreCounters = ZERO;
  for (let i = 0; i < rs.length + 2; i++) c = countOpened(c);
  for (const r of rs) c = countClosed(c, r);
  const want = lvStats([...rs.map((r) => ({ r })), { r: null }, { r: null }]);
  assert.deepEqual(countersToStats(c), want);
  const both = coreStats({ ROMPE: countClosed(countOpened(ZERO), 2), "IMÁN": countClosed(countOpened(ZERO), -1) });
  assert.equal(both.resolved, 2);
  assert.equal(both.profitFactor, 2);
  assert.equal(both.bySource.ROMPE.profitFactor, Infinity);
  const sent = JSON.parse(JSON.stringify({ heartbeat: null, stats: both, open: [], recent: [], generatedAt: 0 }));
  assert.equal(sent.stats.bySource.ROMPE.profitFactor, null, "JSON loses Infinity…");
  assert.equal(reviveSnapshot(sent).stats.bySource.ROMPE.profitFactor, Infinity, "…and the app gets it back");
});

const sig = (o: Partial<JarvisSignal> = {}): JarvisSignal => ({
  id: "ROMPE:SOLUSDT:1h:1:LONG", source: "ROMPE", symbol: "SOLUSDT", timeframe: "1h", side: "LONG", time: 100 * H,
  entry: 180, stop: 177, target: 186, note: "presionando resistencia", result: "ABIERTA", r: null, closedAt: null, ...o,
});

test("what JARVIS says: away summary, online and offline status", () => {
  assert.equal(awaySpeech([sig({ time: 50 * H })], 60 * H), null, "nothing new: nothing to say");
  const away = awaySpeech([sig({ time: 101 * H }), sig({ id: "b", symbol: "ETHUSDT", result: "STOP", r: -1.06, closedAt: 102 * H })], 100 * H)!;
  assert.match(away, /abrió 1 señal: SOL largo/);
  assert.match(away, /cerró 1: ETH en stop, menos 1,1 R/);
  const stats = coreStats({});
  assert.match(coreStatusSpeech({ heartbeat: null, stats, open: [] }, 0), /todavía no arrancó/);
  assert.match(coreStatusSpeech({ heartbeat: { at: 0, task: "SCAN", ok: true, note: "" }, stats, open: [] }, 20 * M), /no da señales de vida desde hace 20 minutos/);
  const on = coreStatusSpeech({ heartbeat: { at: 10 * M, task: "SCAN", ok: true, note: "" }, stats, open: [sig()] }, 11 * M);
  assert.match(on, /Núcleo en línea, último latido hace un minuto\. Vigilo 20 monedas/);
  assert.match(on, /Todavía no cerré ninguna/);
  assert.equal(coreOnline({ at: 0, task: "x", ok: true, note: "" }, 5 * M), false);
});

test("database: a signal is recorded once, closed once, and counted once", { skip: !sqlite }, async () => {
  const db = makeDb();
  assert.equal((await recordCoreSignals(db, [sig(), sig()], 1000)).length, 1);
  assert.equal((await recordCoreSignals(db, [sig()], 2000)).length, 0, "same id later: ignored");
  let snap = await coreSnapshot(db, 3000);
  assert.equal(snap.open.length, 1);
  assert.equal(snap.stats.open, 1);
  const won = { ...sig(), result: "OBJETIVO" as const, r: 1.92, closedAt: 110 * H };
  assert.equal((await closeCoreSignals(db, [won])).length, 1);
  assert.equal((await closeCoreSignals(db, [{ ...won, result: "STOP", r: -1 }])).length, 0, "a result is never rewritten");
  snap = await coreSnapshot(db, 4000);
  assert.equal(snap.open.length, 0);
  assert.equal(snap.stats.resolved, 1);
  assert.equal(snap.stats.open, 0);
  assert.equal(snap.recent[0].r, 1.92);
  assert.equal((await coreActivitySince(db, 500)).length, 1);
  assert.equal((await openCoreSignals(db)).length, 0);
});

test("the minute tick: scan records from closed candles, resolve closes, heartbeat always written", { skip: !sqlite }, async () => {
  const db = makeDb();
  const base = coil(200, 0);
  const frame = H;
  // Minute 0 of a cycle scans BTC and ETH: serve the coil for BTC, nothing for ETH.
  const lastOpen = base[base.length - 1].openTime;
  const minute = Math.ceil((lastOpen + frame + 2 * M) / M / 15) * 15; // slot 0
  const now = minute * M;
  const realFetch = globalThis.fetch;
  let calls = 0;
  const klines = (cs: SwingCandle[]) => cs.map((c) => [c.openTime, String(c.open), String(c.high), String(c.low), String(c.close), String(c.volume), c.openTime + frame - 1, String(c.quoteVolume), 1, "0", "0", "0"]);
  globalThis.fetch = (async (url: string) => {
    calls += 1;
    const u = String(url);
    const shift = (now - 2 * M) - (lastOpen + frame); // re-date the coil so its last candle just closed
    if (u.includes("symbol=BTCUSDT")) return new Response(JSON.stringify(klines(base.map((c) => ({ ...c, openTime: c.openTime + shift })))));
    return new Response("nope", { status: 500 });
  }) as typeof fetch;
  try {
    const hb = await runCoreTick(db, now);
    assert.equal(hb.task, "SCAN");
    assert.equal(hb.ok, true);
    assert.match(hb.note, /BTC\+ETH: 1 señal nueva/);
    const open = await openCoreSignals(db);
    assert.equal(open.length, 1);
    assert.equal(open[0].symbol, "BTCUSDT");
    assert.ok(calls <= 12, `outside requests stay low: ${calls}`);
    const again = await runCoreTick(db, now + 15 * M);
    assert.match(again.note, /sin ruptura|0 señal|señal nueva/);
    assert.equal((await openCoreSignals(db)).length, 1, "the same candle never records twice");
    // Slot 13 resolves. Serve candles after the signal that run to the target.
    const s = open[0];
    const after: SwingCandle[] = Array.from({ length: 3 }, (_, k) => ({ openTime: s.time + (k + 1) * frame, open: s.entry, high: s.target * 1.01, low: s.entry * 0.999, close: s.target, volume: 1, quoteVolume: 1 }));
    globalThis.fetch = (async () => new Response(JSON.stringify(klines(after)))) as typeof fetch;
    let resolveMinute = Math.ceil((after[2].openTime + frame + M) / M);
    while (resolveMinute % 15 !== 13) resolveMinute += 1;
    const hb2 = await runCoreTick(db, resolveMinute * M);
    assert.equal(hb2.task, "RESOLVE");
    assert.match(hb2.note, /1 abiertas, 1 cerradas/);
    const snap = await coreSnapshot(db, now);
    assert.equal(snap.stats.resolved, 1);
    assert.equal(snap.stats.open, 0);
    assert.equal(snap.recent[0].result, "OBJETIVO");
    globalThis.fetch = (async () => { throw new Error("red caída"); }) as typeof fetch;
    const hb3 = await runCoreTick(db, (minute + 10) * M);
    assert.equal(hb3.task, "MAGNET");
    assert.equal(hb3.ok, false, "a failed job is reported, not thrown");
    assert.equal((await coreSnapshot(db, 0)).heartbeat?.at, (minute + 10) * M);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("telegram: new and closed signals, each once, with the running record", () => {
  const st = coreStats({ ROMPE: countClosed(countOpened(countOpened(ZERO)), 1.92) });
  const ev = jarvisEvents([sig({ time: 200 * H }), sig({ id: "x", result: "OBJETIVO", r: 1.92, closedAt: 210 * H })], 150 * H, st);
  assert.deepEqual(ev.map((e) => e.key), ["jarvis:new:ROMPE:SOLUSDT:1h:1:LONG", "jarvis:closed:x"]);
  assert.ok(ev.every((e) => e.category === "JARVIS"));
  assert.match(ev[0].text, /nueva señal · SOL LARGO/);
  assert.match(ev[0].text, /cuenta el stop/);
  assert.match(ev[1].text, /✅[\s\S]*llegó al objetivo: <b>\+1,92R<\/b>/);
  assert.match(ev[1].text, /Registro del núcleo: 1 cerradas · win rate 100% · PF ∞ · \+1,92R · muestra mínima/);
  assert.match(ev[1].text, /No es asesoramiento financiero/);
});
