import assert from "node:assert/strict";
import test from "node:test";
import {
  awaySpeech,
  breakoutsFromMind,
  closedOnly,
  coreContext,
  CORE_COINS,
  CORE_MAGNETS,
  coreOnline,
  coreStats,
  coreStatusSpeech,
  coreTask,
  countClosed,
  countersToStats,
  countOpened,
  emptyMind,
  gradeSignal,
  liveMagnets,
  liveRompe,
  reviveSnapshot,
  shadowStats,
  sweepsOf,
  withTick,
  ZERO,
  type CoreCounters,
  type CoreSignal,
  type Mind,
} from "../lib/jarvis-core.ts";
import {
  closeCoreSignals,
  coreActivitySince,
  coreSnapshot,
  ensureCoreSchema,
  isBusy,
  loadModel,
  openCoreSignals,
  readMind,
  recordCoreSignals,
  runCoreTick,
  saveModel,
} from "../lib/jarvis-core-db.ts";
import { addCase, emptyModel, encode, type Features } from "../lib/jarvis-learn.ts";
import type { JarvisSignal } from "../lib/jarvis-ledger.ts";
import { lvStats } from "../lib/liq-vol-signals.ts";
import type { Magnet } from "../lib/magnet-watch.ts";
import { resetKlinesServerState } from "../lib/klines-server.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";
import { collectJarvisEvents, dailyEvent, jarvisEvents } from "../lib/telegram-jarvis.ts";
import { TELEGRAM_SCHEMA } from "../lib/telegram.ts";
import { setupAt } from "./helpers/setups.ts";

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
const klines = (cs: SwingCandle[]) => cs.map((c) => [c.openTime, String(c.open), String(c.high), String(c.low), String(c.close), String(c.volume), c.openTime + H - 1, String(c.quoteVolume), 1, "0", "0", "0"]);

/** A coil "a punto de romper" on the last closed candle (the 200 before it: waves, then the coil). */
const coilEnd = (t0 = 0) => setupAt(200, 199, undefined, t0);
const F = (o: Partial<Features> = {}): Features => ({ side: "LONG", btc: "SUBE", vol: "NORMAL", sess: "EEUU", power: "MEDIA", coin: "ALT", ...o });

test("the 15-minute cycle covers 20 coins, 3 magnets, one resolution and a study minute", () => {
  const scanned = new Set<string>();
  const kinds: string[] = [];
  for (let m = 0; m < 15; m++) {
    const t = coreTask(1_000_000 * 15 + m);
    kinds.push(t.kind);
    if (t.kind === "SCAN") t.symbols.forEach((s) => scanned.add(s));
  }
  assert.equal(scanned.size, CORE_COINS.length);
  assert.equal(kinds.filter((k) => k === "MAGNET").length, CORE_MAGNETS.length);
  assert.equal(kinds.filter((k) => k === "RESOLVE").length, 1);
  assert.equal(kinds[14], "STUDY");
  assert.deepEqual(coreTask(-1), coreTask(14), "never a negative slot");
});

test("live reading: no lookahead, the same 200-candle window as the history walk, graded", () => {
  const c = coilEnd();
  const now = c[c.length - 1].openTime + H + 5 * M;
  const forming = { openTime: now - 5 * M, open: 109.9, high: 140, low: 60, close: 135, volume: 1e6, quoteVolume: 1e8 };
  const model = emptyModel();
  const a = liveRompe("TRIUSDT", closedOnly([...c, forming], H, now), model, now);
  const b = liveRompe("TRIUSDT", c, model, now);
  assert.equal(a.reading?.state, "A PUNTO");
  assert.equal(a.reading?.seen, now);
  assert.ok(a.signal);
  assert.deepEqual(a.signal, b.signal, "the forming candle changes nothing");
  assert.equal(a.signal!.grade, "APRENDIENDO", "no cases yet: no opinion");
  assert.equal(a.signal!.taken, true);
  assert.equal(a.signal!.features!.btc, "LATERAL", "BTC unknown: neutral, never invented");

  // A model that learned these breakouts lose: the signal is kept in shadow.
  const bad = emptyModel();
  for (let i = 0; i < 300; i++) addCase(bad.ridge.ROMPE, encode(a.signal!.features as Features), -1.05);
  const g = gradeSignal(a.signal!, a.signal!.features as Features, bad.ridge.ROMPE, "ROMPE");
  assert.equal(g.grade, "DESFAVORABLE");
  assert.equal(g.taken, false);
  assert.ok((g.expectR as number) < -0.5);
});

const mag = (side: Magnet["side"], price: number, intensity = 90): Magnet => ({ side, price, intensity, distancePct: 2, notionalUsd: null, density: 1 });

test("magnet sweeps from the stored previous map: swept and closed back = reversal signal", () => {
  const c = setupAt(260, 100, (j) => 100 + Math.sin(j) * 0.5);
  const last = { ...c[c.length - 1], high: c[c.length - 1].close + 5, close: c[c.length - 1].close - 0.2 };
  const closed = [...c.slice(0, -1), last];
  const above = mag("CORTOS", last.close + 3);
  assert.deepEqual(sweepsOf(last, { above, below: null }).map((e) => e.kind), ["BARRIDA"]);
  assert.equal(sweepsOf(last, { above: mag("CORTOS", last.close + 3, 50), below: null }).length, 0, "weak zones are ignored");
  const sigs = liveMagnets("BTCUSDT", closed, { above, below: null }, { above: null, below: mag("LARGOS", last.close - 6) }, emptyModel());
  assert.equal(sigs.length, 1);
  assert.equal(sigs[0].side, "SHORT", "shorts swept above and rejected: back down");
  assert.equal(sigs[0].source, "IMÁN");
  assert.equal(sigs[0].features?.coin, "BTC");
});

test("records: running counters match lvStats; taken and shadow apart", () => {
  const rs = [1.92, -1.06, -1.06, 0.31, 1.92, -0.4, 0];
  let c: CoreCounters = ZERO;
  for (let i = 0; i < rs.length + 2; i++) c = countOpened(c);
  for (const r of rs) c = countClosed(c, r);
  assert.deepEqual(countersToStats(c), lvStats([...rs.map((r) => ({ r })), { r: null }, { r: null }]));
  const byKey = { ROMPE: countClosed(countOpened(ZERO), 2), "IMÁN": countClosed(countOpened(ZERO), -1), "ROMPE~SOMBRA": countClosed(countOpened(ZERO), -1.05) };
  const st = coreStats(byKey);
  assert.equal(st.resolved, 2);
  assert.equal(st.profitFactor, 2);
  assert.equal(shadowStats(byKey).resolved, 1);
  assert.equal(shadowStats(byKey).totalR, -1.05);
  const sent = JSON.parse(JSON.stringify({ heartbeat: null, stats: coreStats({ ROMPE: countClosed(countOpened(ZERO), 2) }), shadow: shadowStats({}), open: [], recent: [], learning: null, mind: null, generatedAt: 0 }));
  assert.equal(reviveSnapshot(sent).stats.profitFactor, Infinity, "JSON loses Infinity; the app gets it back");
});

const sig = (o: Partial<CoreSignal> = {}): CoreSignal => ({
  id: "ROMPE:SOLUSDT:1h:1:LONG", source: "ROMPE", symbol: "SOLUSDT", timeframe: "1h", side: "LONG", time: 100 * H,
  entry: 180, stop: 177, target: 186, note: "a punto de romper · presión 84/100", result: "ABIERTA", r: null, closedAt: null,
  taken: true, grade: "FAVORABLE", expectR: 0.21, expectSe: 0.08, features: F(), why: "Con BTC a favor (+0,25R)", ...o,
});

test("what JARVIS says: away summary without shadow signals, status with health and learning, breakouts from its mind", () => {
  assert.equal(awaySpeech([sig({ time: 50 * H })], 60 * H), null);
  const away = awaySpeech([sig({ time: 101 * H }), sig({ id: "s", time: 101 * H, taken: false }), sig({ id: "b", symbol: "ETHUSDT", result: "STOP", r: -1.06, closedAt: 102 * H })], 100 * H)!;
  assert.match(away, /abrió 1 señal: SOL largo/, "the shadow one is not announced");
  assert.match(away, /cerró 1: ETH en stop, menos 1,1 R/);

  const stats = coreStats({});
  assert.match(coreStatusSpeech({ heartbeat: null, stats, open: [], learning: null }, 0), /todavía no arrancó/);
  const ring = [{ at: 0, task: "SCAN", ok: true, note: "" }, { at: M, task: "MAGNET", ok: false, note: "x" }];
  const hb = withTick({ at: 0, task: "SCAN", ok: true, note: "", ring }, { at: 10 * M, task: "SCAN", ok: true, note: "" });
  assert.equal(hb.ring!.length, 3);
  const learning = { historyCases: 1234, liveCases: 0, backlog: 560, coins: 20, updatedAt: 0, sources: { ROMPE: { n: 1234, base: null, lessons: [] }, "IMÁN": { n: 0, base: null, lessons: [] } } };
  const on = coreStatusSpeech({ heartbeat: hb, stats, open: [sig(), sig({ id: "z", taken: false })], learning }, 11 * M);
  assert.match(on, /último latido hace un minuto, con 1 falla en los últimos 3 minutos\. Vigilo 20 monedas/);
  assert.match(on, /Tengo 1 señal abierta\./, "shadow signals are not counted as open trades");
  assert.match(on, /Aprendí de 1\.234 situaciones de la historia y me quedan 560 velas por estudiar\./);
  assert.equal(coreOnline({ at: 0, task: "x", ok: true, note: "" }, 5 * M), false);

  const now = 1_000 * H;
  const mind: Mind = { ...emptyMind(), readings: Object.fromEntries(CORE_COINS.map((s, i) => [s, { at: now - 2 * H, seen: now - 3 * M, price: 1, state: i === 3 ? ("A PUNTO" as const) : i === 5 ? ("ARMÁNDOSE" as const) : ("QUIETO" as const), side: "ALCISTA" as const, score: 80 + i, change24: 0 }])) };
  const b = breakoutsFromMind(mind, now)!;
  assert.match(b.text, /A punto de romper en una hora: XRP hacia arriba, presión 83\. Armándose: DOGE\. Lectura del núcleo de hace menos de 3 minutos/);
  assert.deepEqual(b.coins, ["XRPUSDT"]);
  assert.equal(breakoutsFromMind(mind, now + 40 * M), null, "stale readings: the app scans by itself");
});

test("database: old table upgraded; taken and shadow recorded once, closed once, counted apart", { skip: !sqlite }, async () => {
  const db = makeDb();
  // The first version of the table, without the learning columns.
  await db.prepare("CREATE TABLE jarvis_core_signals (id TEXT PRIMARY KEY, source TEXT NOT NULL, symbol TEXT NOT NULL, timeframe TEXT NOT NULL, side TEXT NOT NULL, time INTEGER NOT NULL, entry REAL NOT NULL, stop REAL NOT NULL, target REAL NOT NULL, note TEXT NOT NULL, result TEXT NOT NULL, r REAL, closed_at INTEGER, created_at INTEGER NOT NULL)").run();
  await db.prepare("INSERT INTO jarvis_core_signals VALUES ('old', 'ROMPE', 'BTCUSDT', '1h', 'LONG', 1, 1, 0.9, 1.2, 'x', 'ABIERTA', NULL, NULL, 1)").run();
  await ensureCoreSchema(db);
  assert.equal((await openCoreSignals(db))[0].taken, true, "old rows read as taken");
  const shadow = sig({ id: "sh", symbol: "ETHUSDT", taken: false, grade: "DESFAVORABLE", expectR: -0.3 });
  assert.equal((await recordCoreSignals(db, [sig(), sig(), shadow], 1000)).length, 2);
  assert.equal(await isBusy(db, "SOLUSDT", "ROMPE"), true);
  assert.equal(await isBusy(db, "SOLUSDT", "IMÁN"), false);
  const back = (await openCoreSignals(db)).find((s) => s.id === sig().id)!;
  assert.deepEqual(back.features, F());
  assert.equal(back.why, "Con BTC a favor (+0,25R)");
  const won = { ...sig(), result: "OBJETIVO" as const, r: 1.92, closedAt: 110 * H };
  const lostShadow = { ...shadow, result: "STOP" as const, r: -1.05, closedAt: 111 * H };
  assert.equal((await closeCoreSignals(db, [won, lostShadow])).length, 2);
  assert.equal((await closeCoreSignals(db, [{ ...won, result: "STOP", r: -1 }])).length, 0, "a result is never rewritten");
  const snap = await coreSnapshot(db, 4000);
  assert.equal(snap.stats.resolved, 1);
  assert.equal(snap.stats.totalR, 1.92);
  assert.equal(snap.shadow.resolved, 1);
  assert.equal(snap.shadow.totalR, -1.05);
  assert.equal(snap.learning, null, "nothing learned yet");
  assert.equal((await coreActivitySince(db, 500)).length, 2, "created or closed after 500: the two new ones (the old row is from before)");
});

test("database: the model is saved only over the revision it was read from; the mind merges field by field", { skip: !sqlite }, async () => {
  const db = makeDb();
  await ensureCoreSchema(db);
  const a = await loadModel(db);
  const b = await loadModel(db);
  a.model.historyCases = 5;
  b.model.historyCases = 7;
  assert.equal(await saveModel(db, a.model, { rev: a.model.rev, exists: a.exists }, 1), true);
  assert.equal(await saveModel(db, b.model, { rev: b.model.rev, exists: b.exists }, 2), false, "the second writer loses and redoes its work");
  const c = await loadModel(db);
  assert.equal(c.model.historyCases, 5);
  assert.equal(c.model.rev, 1);
  c.model.historyCases = 9;
  assert.equal(await saveModel(db, c.model, { rev: c.model.rev, exists: c.exists }, 3), true);
  assert.equal((await loadModel(db)).model.historyCases, 9);
});

test("the minute tick: reads, grades, studies history, resolves, and always leaves a heartbeat", { skip: !sqlite }, async () => {
  const db = makeDb();
  resetKlinesServerState();
  // 520 closed candles: a setup with its outcome in the past, then a coil on the last candle.
  const past = setupAt(320, 250);
  const tail = setupAt(200, 199).map((c) => ({ ...c, openTime: c.openTime + 320 * H }));
  const all = [...past, ...tail];
  const lastOpen = all[all.length - 1].openTime;
  let minute = Math.ceil((lastOpen + H + 2 * M) / M);
  while (minute % 15 !== 0) minute += 1;
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (url: string) => {
    calls += 1;
    const u = String(url);
    if (u.includes("/klines")) return new Response(JSON.stringify(klines(all)));
    return new Response("[]");
  }) as typeof fetch;
  try {
    const hb = await runCoreTick(db, minute * M);
    assert.equal(hb.task, "SCAN");
    assert.equal(hb.ok, true, hb.note);
    assert.match(hb.note, /BTC: a punto → señal aprendiendo, estudió 30 velas/);
    assert.ok(calls <= 4, `outside requests stay low: ${calls}`);
    const mind = await readMind(db);
    assert.equal(mind.readings.BTCUSDT.state, "A PUNTO");
    assert.ok(mind.btc, "BTC regime known");
    const open = await openCoreSignals(db);
    assert.deepEqual(open.map((s) => s.symbol).sort(), ["BTCUSDT", "ETHUSDT"]);
    assert.ok(open.every((s) => s.grade === "APRENDIENDO" && s.taken));

    // More scans: no duplicate signal (one per coin), and the history walk keeps going.
    let learned = 0;
    for (let k = 1; k <= 6 && !learned; k++) {
      await runCoreTick(db, (minute + 15 * k) * M);
      learned = (await loadModel(db)).model.historyCases;
    }
    assert.equal((await openCoreSignals(db)).length, 2, "the same setup never opens twice");
    assert.ok(learned >= 1, "the past setup was studied");
    const model = (await loadModel(db)).model;
    assert.equal(model.ridge.ROMPE.n, model.historyCases);
    assert.ok(model.cursors.BTCUSDT.last > 0);

    // Resolution: candles after the signals that run to the targets.
    const s = (await openCoreSignals(db))[0];
    const after: SwingCandle[] = Array.from({ length: 3 }, (_, k) => ({ openTime: s.time + (k + 1) * H, open: s.entry, high: s.target * 1.01, low: s.entry * 0.999, close: s.target, volume: 1, quoteVolume: 1 }));
    globalThis.fetch = (async () => new Response(JSON.stringify(klines(after)))) as typeof fetch;
    let rm = Math.ceil((after[2].openTime + H + M) / M);
    while (rm % 15 !== 13) rm += 1;
    const hb2 = await runCoreTick(db, rm * M);
    assert.equal(hb2.task, "RESOLVE");
    assert.match(hb2.note, /2 abiertas, 2 cerradas ahora/);
    const snap = await coreSnapshot(db, rm * M);
    assert.equal(snap.stats.resolved, 2);
    assert.ok(snap.learning && snap.learning.historyCases >= 1);
    assert.ok(snap.heartbeat!.ring!.length >= 3, "the last ticks are kept");

    // A failing job is reported, not thrown.
    globalThis.fetch = (async () => {
      throw new Error("red caída");
    }) as typeof fetch;
    const hb3 = await runCoreTick(db, (rm + 12) * M);
    assert.equal(hb3.task, "MAGNET");
    assert.equal(hb3.ok, false);
    assert.equal((await coreSnapshot(db, 0)).heartbeat?.at, (rm + 12) * M);
  } finally {
    globalThis.fetch = realFetch;
    resetKlinesServerState();
  }
});

test("magnet job: one map per run — the first is stored, the next hour judges that candle's sweeps", { skip: !sqlite }, async () => {
  const db = makeDb();
  resetKlinesServerState();
  let candles = setupAt(500, 300, (j) => 100 + Math.sin(j / 3));
  let minute = Math.ceil((candles[499].openTime + H + M) / M);
  while (minute % 15 !== 10) minute += 1;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => new Response(String(url).includes("/klines") ? JSON.stringify(klines(candles)) : "[]")) as typeof fetch;
  try {
    const first = await runCoreTick(db, minute * M);
    assert.equal(first.task, "MAGNET");
    assert.match(first.note, /imanes BTC: mapa guardado/);
    const m = (await readMind(db)).magnets.BTCUSDT;
    assert.equal(m.lastTime, candles[499].openTime);
    assert.ok((m.nearPct ?? 0) >= 0.4);
    assert.match((await runCoreTick(db, (minute + 15) * M)).note, /sin vela nueva/, "same candle: no work");
    const next = candles[499].openTime + H;
    candles = [...candles.slice(1), { openTime: next, open: 100, high: 100.6, low: 99.5, close: 100.2, volume: 1, quoteVolume: 1 }];
    const later = await runCoreTick(db, (minute + 60) * M);
    assert.doesNotMatch(later.note, /mapa guardado/, "the stored map judges the new candle");
    assert.equal((await readMind(db)).magnets.BTCUSDT.lastTime, next);
  } finally {
    globalThis.fetch = realFetch;
    resetKlinesServerState();
  }
});

/** Kraken's OHLC answer for these candles (seconds, strings, vwap = close), plus the candle still forming. */
const krakenOf = (cs: SwingCandle[], forming?: SwingCandle) =>
  JSON.stringify({
    error: [],
    result: { XXBTZUSD: [...cs, ...(forming ? [forming] : [])].map((c) => [c.openTime / 1000, String(c.open), String(c.high), String(c.low), String(c.close), String(c.close), String(c.volume), 3]), last: 0 },
  });

test("Binance refuses the cron: the core reads Kraken without looking ahead, and says so in its mind, signals and lessons", { skip: !sqlite }, async () => {
  const db = makeDb();
  resetKlinesServerState();
  const past = setupAt(320, 250);
  const tail = setupAt(200, 199).map((c) => ({ ...c, openTime: c.openTime + 320 * H }));
  const all = [...past, ...tail];
  const lastOpen = all[all.length - 1].openTime;
  // Kraken always sends the candle still forming last; reading it would be reading the future.
  const forming: SwingCandle = { openTime: lastOpen + H, open: all[all.length - 1].close, high: all[all.length - 1].close * 1.5, low: all[all.length - 1].close * 0.6, close: all[all.length - 1].close * 1.4, volume: 99, quoteVolume: 99 };
  let minute = Math.ceil((lastOpen + H + 2 * M) / M);
  while (minute % 15 !== 0) minute += 1;
  assert.ok(minute * M < forming.openTime + H, "the forming candle is still open at the tick");
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("binance")) return new Response("blocked", { status: 403 });
    if (u.includes("api.kraken.com")) return new Response(krakenOf(all, forming));
    return new Response("[]");
  }) as typeof fetch;
  try {
    const hb = await runCoreTick(db, minute * M);
    assert.equal(hb.task, "SCAN");
    assert.equal(hb.ok, true, hb.note);
    assert.equal(hb.feed, "KRAKEN");
    assert.ok(calls.length <= 6, `3 refusals, then one Kraken request per coin: ${calls.length}`);
    const mind = await readMind(db);
    assert.equal(mind.readings.BTCUSDT.at, lastOpen, "the reading ends at the last closed candle");
    assert.deepEqual({ venue: mind.feed?.venue, binance: mind.feed?.binance }, { venue: "KRAKEN", binance: "BLOQUEADO" });
    const open = await openCoreSignals(db);
    assert.equal(open.length, 2);
    assert.ok(open.every((s) => s.note.endsWith(" · precios de Kraken (USD)")), open.map((s) => s.note).join(" | "));
    const snap = await coreSnapshot(db, minute * M);
    assert.match(coreStatusSpeech(snap, minute * M), /Leo las velas de Kraken, en dólares, porque Binance bloquea al servidor\. El precio es prácticamente el mismo; el volumen es el de Kraken\./);
    assert.equal(coreContext(snap, minute * M).nucleo.datos?.velasDe, "Kraken");
    let learned = 0;
    for (let k = 1; k <= 6 && !learned; k++) {
      await runCoreTick(db, (minute + 15 * k) * M);
      learned = (await loadModel(db)).model.historyCases;
    }
    const model = (await loadModel(db)).model;
    assert.ok(learned >= 1);
    assert.deepEqual(model.venues, { KRAKEN: model.historyCases }, "every lesson knows where its candles came from");
  } finally {
    globalThis.fetch = realFetch;
    resetKlinesServerState();
  }
});

test("a scan that could read nothing writes nothing and says what each exchange answered", { skip: !sqlite }, async () => {
  const db = makeDb();
  resetKlinesServerState();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => (String(url).includes("binance") ? new Response("blocked", { status: 403 }) : new Response("down", { status: 503 }))) as typeof fetch;
  try {
    const hb = await runCoreTick(db, 1_000_000 * 15 * M);
    assert.equal(hb.task, "SCAN");
    assert.equal(hb.ok, false);
    assert.match(hb.note, /BTC sin datos \(Binance futuros HTTP 403 · Binance HTTP 403 · Kraken HTTP 503 · Coinbase HTTP 503\)/);
    assert.equal(hb.feed, undefined);
    assert.equal((await loadModel(db)).exists, false, "no empty model saved");
    assert.deepEqual((await readMind(db)).readings, {});
  } finally {
    globalThis.fetch = realFetch;
    resetKlinesServerState();
  }
});

test("magnet job on Kraken's candles: no open-interest request (Binance futures' own series), the map says its source", { skip: !sqlite }, async () => {
  const db = makeDb();
  resetKlinesServerState();
  const candles = setupAt(500, 300, (j) => 100 + Math.sin(j / 3));
  let minute = Math.ceil((candles[499].openTime + H + M) / M);
  while (minute % 15 !== 10) minute += 1;
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return String(url).includes("binance") ? new Response("blocked", { status: 403 }) : new Response(krakenOf(candles));
  }) as typeof fetch;
  try {
    const hb = await runCoreTick(db, minute * M);
    assert.equal(hb.task, "MAGNET");
    assert.equal(hb.feed, "KRAKEN");
    assert.match(hb.note, /imanes BTC: mapa guardado/);
    assert.ok(!calls.some((c) => c.includes("openInterest")), calls.join("\n"));
    const mind = await readMind(db);
    assert.equal(mind.magnets.BTCUSDT.venue, "KRAKEN");
    assert.equal(mind.feed?.venue, "KRAKEN");
  } finally {
    globalThis.fetch = realFetch;
    resetKlinesServerState();
  }
});

test("magnets learn from live results, taken or not", { skip: !sqlite }, async () => {
  const db = makeDb();
  resetKlinesServerState();
  const m: CoreSignal = sig({ id: "IMÁN:BTCUSDT:1h:1:SHORT", source: "IMÁN", symbol: "BTCUSDT", side: "SHORT", entry: 100, stop: 103, target: 94, taken: false, grade: "DESFAVORABLE", features: F({ side: "SHORT", coin: "BTC" }) });
  await recordCoreSignals(db, [m], 1);
  const after = Array.from({ length: 2 }, (_, k) => ({ openTime: m.time + (k + 1) * H, open: 100, high: 100.5, low: 93, close: 94, volume: 1, quoteVolume: 1 }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(klines(after)))) as typeof fetch;
  try {
    let rm = Math.ceil((after[1].openTime + H + M) / M);
    while (rm % 15 !== 13) rm += 1;
    const hb = await runCoreTick(db, rm * M);
    assert.match(hb.note, /1 cerradas ahora, aprendió de 1 barrida/);
    const model = (await loadModel(db)).model;
    assert.equal(model.ridge["IMÁN"].n, 1);
    assert.equal(model.liveCases, 1);
    assert.equal((await coreSnapshot(db, 0)).shadow.resolved, 1, "a shadow win is measured, not counted in the record");
  } finally {
    globalThis.fetch = realFetch;
    resetKlinesServerState();
  }
});

test("telegram: taken signals only, with what it learned; closes with the record; a daily log", () => {
  const st = coreStats({ ROMPE: countClosed(countOpened(countOpened(ZERO)), 1.92) });
  const learn = { historyCases: 640, liveCases: 2, backlog: 0, coins: 20, updatedAt: 0, sources: { ROMPE: { n: 640, base: null, lessons: ["Rupturas en general: +0,05R por señal en 640 casos.", "Con BTC a favor: +0,21R por señal en 210 casos, contra −0,03R del resto."] }, "IMÁN": { n: 2, base: null, lessons: ["Barridas de imán: llevo 2 casos, todavía pocos para sacar conclusiones."] } } };
  const ev = jarvisEvents([sig({ time: 200 * H }), sig({ id: "sh", taken: false, time: 200 * H }), sig({ id: "x", result: "OBJETIVO", r: 1.92, closedAt: 210 * H })], 150 * H, st, learn);
  assert.deepEqual(ev.map((e) => e.key), ["jarvis:new:ROMPE:SOLUSDT:1h:1:LONG", "jarvis:closed:x"], "the shadow signal is not sent");
  assert.ok(ev.every((e) => e.category === "JARVIS"));
  assert.match(ev[0].text, /Aprendizaje: favorable · esperado \+0,21R ± 0,08 \(640 casos\)\nPesa: Con BTC a favor \(\+0,25R\)/);
  assert.match(ev[1].text, /✅[\s\S]*llegó al objetivo: <b>\+1,92R<\/b>/);
  assert.match(ev[1].text, /Registro del núcleo: 1 cerradas · win rate 100% · PF ∞ · \+1,92R · muestra mínima/);
  const d = dailyEvent("2026-10-07", st, learn);
  assert.equal(d.key, "jarvis:daily:2026-10-07");
  assert.match(d.text, /bitácora del 07\/10\/2026[\s\S]*Estudié 640 situaciones de la historia de 20 monedas y 2 señales en vivo\.[\s\S]*• Con BTC a favor/);
  assert.match(d.text, /llevo 2 casos, todavía pocos/, "says plainly it is still early for magnets");
  const none = dailyEvent("2026-10-07", st, { ...learn, sources: { ...learn.sources, "IMÁN": { n: 0, base: null, lessons: ["Barridas de imán: llevo 0 casos, todavía pocos para sacar conclusiones."] } } });
  assert.doesNotMatch(none.text, /llevo 0 casos/, "nothing at all yet: not mentioned");
});

test("telegram collection: the first run only sets the starting point", { skip: !sqlite }, async () => {
  const db = makeDb();
  for (const s of TELEGRAM_SCHEMA) await db.prepare(s).run();
  const morning = Date.UTC(2026, 9, 7, 8);
  assert.deepEqual(await collectJarvisEvents(db, morning), []);
  await recordCoreSignals(db, [sig()], morning + M);
  const ev = await collectJarvisEvents(db, morning + 2 * M);
  assert.deepEqual(ev.map((e) => e.key), ["jarvis:new:ROMPE:SOLUSDT:1h:1:LONG"]);
  const noon = await collectJarvisEvents(db, Date.UTC(2026, 9, 7, 12, 5));
  assert.deepEqual(noon.map((e) => e.key), [], "no record and nothing studied yet: no daily log");
});

// Keep the type import used.
export type _Unused = JarvisSignal;
