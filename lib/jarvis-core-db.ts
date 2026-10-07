import { resolveSignal, type JarvisSource } from "./jarvis-ledger.ts";
import {
  CORE_COINS,
  CORE_FRAME,
  CORE_TF,
  closedOnly,
  coreStats,
  coreTask,
  counterKey,
  countClosed,
  countOpened,
  liveMagnets,
  liveRompe,
  parseMind,
  sweepsOf,
  shadowStats,
  withTick,
  ZERO,
  type CoreCounters,
  type CoreHeartbeat,
  type CoreSignal,
  type CoreSnapshot,
  type Feed,
  type MagnetPairLite,
  type MindMagnet,
} from "./jarvis-core.ts";
import { addCase, btcSeries, compactModel, encode, parseModel, replayRompe, summarizeModel, type Features, type Grade, type LearnModel } from "./jarvis-learn.ts";
import { fetchKlinesServer, isOutside, VENUE_LABEL, type Venue } from "./klines-server.ts";
import { buildLiquidationHeatmap } from "./liquidation-heatmap.ts";
import { atrPct, strongestMagnets } from "./magnet-watch.ts";
import type { SwingCandle } from "./swing-entries.ts";
import { compactRead, readAsset } from "./asset-read.ts";
import type { MindReading } from "./jarvis-mind.ts";
import { loadOiDelta, timeframeConfig } from "./market-fetch.ts";

/**
 * Database side of JARVIS CORE (see jarvis-core.ts and jarvis-learn.ts).
 * Built for D1's free tier, which counts rows read and written and since
 * September 2026 stops answering when a daily limit is passed:
 *   - every query goes through an index with a LIMIT;
 *   - totals are running counters (one row per source), never COUNT(*);
 *   - the learned model is one row (a few KB of sums), read and written once
 *     per job, guarded by a revision number so two overlapping jobs can't
 *     both write it (the loser's work is simply redone next time);
 *   - the core's view of the market is one row updated field by field.
 */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS jarvis_core_signals (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, symbol TEXT NOT NULL, timeframe TEXT NOT NULL, side TEXT NOT NULL,
    time INTEGER NOT NULL, entry REAL NOT NULL, stop REAL NOT NULL, target REAL NOT NULL, note TEXT NOT NULL,
    result TEXT NOT NULL, r REAL, closed_at INTEGER, created_at INTEGER NOT NULL,
    taken INTEGER NOT NULL DEFAULT 1, grade TEXT, expect_r REAL, expect_se REAL, features TEXT, why TEXT)`,
  "CREATE INDEX IF NOT EXISTS jarvis_core_open ON jarvis_core_signals (result, time)",
  "CREATE INDEX IF NOT EXISTS jarvis_core_created ON jarvis_core_signals (created_at)",
  "CREATE INDEX IF NOT EXISTS jarvis_core_closed ON jarvis_core_signals (closed_at)",
  `CREATE TABLE IF NOT EXISTS jarvis_core_stats (
    source TEXT PRIMARY KEY, resolved INTEGER NOT NULL, wins INTEGER NOT NULL, losses INTEGER NOT NULL,
    gain REAL NOT NULL, loss REAL NOT NULL, total REAL NOT NULL, open INTEGER NOT NULL)`,
  "CREATE TABLE IF NOT EXISTS jarvis_core_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
];
/** Columns added after the first version of the table (kept for databases created then). */
const ADDED = ["taken INTEGER NOT NULL DEFAULT 1", "grade TEXT", "expect_r REAL", "expect_se REAL", "features TEXT", "why TEXT"];

// Once per database per isolate: the cron runs every minute and these never change.
const ready = new WeakSet<object>();
export async function ensureCoreSchema(db: D1Database) {
  if (ready.has(db)) return;
  for (const sql of SCHEMA) await db.prepare(sql).run();
  for (const col of ADDED) {
    await db
      .prepare(`ALTER TABLE jarvis_core_signals ADD COLUMN ${col}`)
      .run()
      .catch(() => undefined); // already there
  }
  await db.prepare("CREATE INDEX IF NOT EXISTS jarvis_core_busy ON jarvis_core_signals (symbol, source, result)").run();
  ready.add(db);
}

type Row = {
  id: string; source: string; symbol: string; timeframe: string; side: string; time: number; entry: number; stop: number; target: number;
  note: string; result: string; r: number | null; closed_at: number | null; created_at: number;
  taken: number | null; grade: string | null; expect_r: number | null; expect_se: number | null; features: string | null; why: string | null;
};
const COLS = "id, source, symbol, timeframe, side, time, entry, stop, target, note, result, r, closed_at, created_at, taken, grade, expect_r, expect_se, features, why";

function parseFeatures(raw: string | null): Features | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Features;
  } catch {
    return null;
  }
}

export function rowToSignal(r: Row): CoreSignal {
  return {
    id: r.id,
    source: r.source as JarvisSource,
    symbol: r.symbol,
    timeframe: r.timeframe,
    side: r.side as CoreSignal["side"],
    time: r.time,
    entry: r.entry,
    stop: r.stop,
    target: r.target,
    note: r.note,
    result: r.result as CoreSignal["result"],
    r: r.r,
    closedAt: r.closed_at,
    taken: r.taken !== 0,
    grade: (r.grade as Grade | null) ?? null,
    expectR: r.expect_r,
    expectSe: r.expect_se,
    features: parseFeatures(r.features),
    why: r.why,
  };
}

async function readCounters(db: D1Database): Promise<Record<string, CoreCounters>> {
  const rows = (await db.prepare("SELECT source, resolved, wins, losses, gain, loss, total, open FROM jarvis_core_stats LIMIT 10").all<CoreCounters & { source: string }>()).results;
  const out: Record<string, CoreCounters> = {};
  for (const r of rows) out[r.source] = { resolved: r.resolved, wins: r.wins, losses: r.losses, gain: r.gain, loss: r.loss, total: r.total, open: r.open };
  return out;
}

async function writeCounters(db: D1Database, key: string, c: CoreCounters) {
  await db
    .prepare("INSERT OR REPLACE INTO jarvis_core_stats (source, resolved, wins, losses, gain, loss, total, open) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
    .bind(key, c.resolved, c.wins, c.losses, c.gain, c.loss, c.total, c.open)
    .run();
}

export async function readCoreStats(db: D1Database) {
  await ensureCoreSchema(db);
  return coreStats(await readCounters(db));
}

/** Records new signals (an id seen before is ignored) and counts them as open, taken or in shadow. */
export async function recordCoreSignals(db: D1Database, signals: CoreSignal[], now: number): Promise<CoreSignal[]> {
  await ensureCoreSchema(db);
  const added: CoreSignal[] = [];
  for (const s of signals) {
    const res = await db
      .prepare(
        `INSERT OR IGNORE INTO jarvis_core_signals (${COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'ABIERTA', NULL, NULL, ?11, ?12, ?13, ?14, ?15, ?16, ?17)`,
      )
      .bind(s.id, s.source, s.symbol, s.timeframe, s.side, s.time, s.entry, s.stop, s.target, s.note, now, s.taken ? 1 : 0, s.grade, s.expectR, s.expectSe, s.features ? JSON.stringify(s.features) : null, s.why)
      .run();
    if (res.meta.changes) added.push(s);
  }
  if (added.length) {
    const counters = await readCounters(db);
    for (const key of new Set(added.map((s) => counterKey(s.source, s.taken)))) {
      let c = counters[key] ?? ZERO;
      for (const s of added) if (counterKey(s.source, s.taken) === key) c = countOpened(c);
      await writeCounters(db, key, c);
    }
  }
  return added;
}

export async function openCoreSignals(db: D1Database, limit = 40): Promise<CoreSignal[]> {
  await ensureCoreSchema(db);
  return (await db.prepare(`SELECT ${COLS} FROM jarvis_core_signals WHERE result = 'ABIERTA' ORDER BY time DESC LIMIT ?1`).bind(limit).all<Row>()).results.map(rowToSignal);
}

/** One open signal per coin and source, as in the history walk. */
export async function isBusy(db: D1Database, symbol: string, source: JarvisSource): Promise<boolean> {
  const row = await db.prepare("SELECT id FROM jarvis_core_signals WHERE symbol = ?1 AND source = ?2 AND result = 'ABIERTA' LIMIT 1").bind(symbol, source).first();
  return row !== null;
}

/** Closes what the candles settled. Only an open row is updated, so a result is written once and counted once. */
export async function closeCoreSignals(db: D1Database, updated: CoreSignal[]): Promise<CoreSignal[]> {
  await ensureCoreSchema(db);
  const closed: CoreSignal[] = [];
  for (const s of updated) {
    if (s.result === "ABIERTA" || s.r === null) continue;
    const res = await db
      .prepare("UPDATE jarvis_core_signals SET result = ?2, r = ?3, closed_at = ?4 WHERE id = ?1 AND result = 'ABIERTA'")
      .bind(s.id, s.result, s.r, s.closedAt)
      .run();
    if (res.meta.changes) closed.push(s);
  }
  if (closed.length) {
    const counters = await readCounters(db);
    for (const key of new Set(closed.map((s) => counterKey(s.source, s.taken)))) {
      let c = counters[key] ?? ZERO;
      for (const s of closed) if (counterKey(s.source, s.taken) === key) c = countClosed(c, s.r as number);
      await writeCounters(db, key, c);
    }
  }
  return closed;
}

// ── State rows: heartbeat, model, mind ─────────────────────────────────────

async function readState(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM jarvis_core_state WHERE key = ?1").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function readHeartbeat(db: D1Database): Promise<CoreHeartbeat | null> {
  const raw = await readState(db, "heartbeat");
  try {
    return raw ? (JSON.parse(raw) as CoreHeartbeat) : null;
  } catch {
    return null;
  }
}

async function writeHeartbeat(db: D1Database, hb: CoreHeartbeat) {
  await db.prepare("INSERT OR REPLACE INTO jarvis_core_state (key, value) VALUES ('heartbeat', ?1)").bind(JSON.stringify(hb)).run();
}

export async function loadModel(db: D1Database): Promise<{ model: LearnModel; exists: boolean }> {
  const raw = await readState(db, "model");
  return { model: parseModel(raw), exists: raw !== null };
}

/** Saves the model if nobody saved a newer one since it was read. */
export async function saveModel(db: D1Database, model: LearnModel, loaded: { rev: number; exists: boolean }, now: number): Promise<boolean> {
  const next = JSON.stringify(compactModel({ ...model, rev: loaded.rev + 1, updatedAt: now }));
  if (!loaded.exists) {
    const res = await db.prepare("INSERT OR IGNORE INTO jarvis_core_state (key, value) VALUES ('model', ?1)").bind(next).run();
    return res.meta.changes > 0;
  }
  const res = await db
    .prepare("UPDATE jarvis_core_state SET value = ?1 WHERE key = 'model' AND json_extract(value, '$.rev') = ?2")
    .bind(next, loaded.rev)
    .run();
  return res.meta.changes > 0;
}

const MIND_EMPTY = '{"readings":{},"btc":null,"magnets":{},"reads":{}}';
/** Sets fields of the mind row one by one (json_set), so jobs touching different coins never overwrite each other. */
async function setMind(db: D1Database, fields: [string, unknown][]) {
  if (!fields.length) return;
  await db.prepare("INSERT OR IGNORE INTO jarvis_core_state (key, value) VALUES ('mind', ?1)").bind(MIND_EMPTY).run();
  const args: unknown[] = [];
  const paths = fields.map(([path, value]) => {
    args.push(JSON.stringify(value));
    return `'${path}', json(?${args.length})`;
  });
  await db.prepare(`UPDATE jarvis_core_state SET value = json_set(value, ${paths.join(", ")}) WHERE key = 'mind'`).bind(...args).run();
}

export async function readMind(db: D1Database) {
  return parseMind(await readState(db, "mind"));
}

/** Signals created or closed after `since` (newest first, at most `limit` of each). */
export async function coreActivitySince(db: D1Database, since: number, limit = 30): Promise<CoreSignal[]> {
  await ensureCoreSchema(db);
  const created = (await db.prepare(`SELECT ${COLS} FROM jarvis_core_signals WHERE created_at > ?1 ORDER BY created_at DESC LIMIT ?2`).bind(since, limit).all<Row>()).results;
  const closed = (await db.prepare(`SELECT ${COLS} FROM jarvis_core_signals WHERE closed_at > ?1 ORDER BY closed_at DESC LIMIT ?2`).bind(since, limit).all<Row>()).results;
  const map = new Map<string, Row>();
  for (const r of [...created, ...closed]) map.set(r.id, r);
  return [...map.values()].map(rowToSignal);
}

/** JARVIS MENTE's hourly readings (jarvis-mind.ts), one row each; the last 72 are kept. */
export const MIND_SCHEMA = "CREATE TABLE IF NOT EXISTS jarvis_mind (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, body TEXT NOT NULL)";

export async function latestReading(db: D1Database): Promise<MindReading | null> {
  await db.prepare(MIND_SCHEMA).run();
  const row = await db.prepare("SELECT body FROM jarvis_mind ORDER BY id DESC LIMIT 1").first<{ body: string }>();
  try {
    return row ? (JSON.parse(row.body) as MindReading) : null;
  } catch {
    return null;
  }
}

/** The last closed signals of one source, newest first (the IA theses for the hourly mind). */
export async function recentClosed(db: D1Database, source: JarvisSource, limit = 8): Promise<CoreSignal[]> {
  await ensureCoreSchema(db);
  const rows = (await db.prepare(`SELECT ${COLS} FROM jarvis_core_signals WHERE closed_at IS NOT NULL AND source = ?1 ORDER BY closed_at DESC LIMIT ?2`).bind(source, limit).all<Row>()).results;
  return rows.map(rowToSignal);
}

export async function coreSnapshot(db: D1Database, now: number): Promise<CoreSnapshot> {
  await ensureCoreSchema(db);
  const [heartbeat, counters, open, recentRows, loaded, mind, reading] = await Promise.all([
    readHeartbeat(db),
    readCounters(db),
    openCoreSignals(db, 20),
    db.prepare(`SELECT ${COLS} FROM jarvis_core_signals WHERE closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 20`).all<Row>(),
    loadModel(db),
    readMind(db),
    latestReading(db).catch(() => null),
  ]);
  return {
    heartbeat,
    stats: coreStats(counters),
    shadow: shadowStats(counters),
    open,
    recent: recentRows.results.map(rowToSignal),
    learning: loaded.exists ? summarizeModel(loaded.model) : null,
    mind,
    reading,
    generatedAt: now,
  };
}

// ── The jobs ────────────────────────────────────────────────────────────────

const coin = (s: string) => s.replace(/USDT$/, "");

/**
 * Candles for the core: Binance's USDT-M futures first (the market the app's
 * map reads), then spot, then — because Binance's firewall refuses the cron's
 * data centres — Kraken and Coinbase in dollars (klines-server.ts). `feed`
 * says which one answered, so every reading, signal and lesson can say it.
 */
export async function coreCandles(symbol: string, limit: number, minCandles: number, now: number): Promise<{ candles: SwingCandle[]; feed: Feed }> {
  const r = await fetchKlinesServer(symbol, CORE_TF, { limit, minCandles, market: "futures", outside: true });
  return { candles: closedOnly(r.candles, CORE_FRAME, now), feed: { venue: r.venue, binance: r.binance, at: now } };
}

/** Signals from another exchange's candles say so: their prices are in dollars, not USDT. */
function withVenue<T extends CoreSignal>(s: T, venue: Venue): T {
  return isOutside(venue) ? { ...s, note: `${s.note} · precios de ${VENUE_LABEL[venue]} (USD)` } : s;
}

type JobResult = { ok: boolean; note: string; feed?: Feed };

/** Studies a step of this coin's history into the model; returns a short note. */
function study(model: LearnModel, symbol: string, closed: SwingCandle[], max: number, venue: Venue): string {
  const rep = replayRompe(symbol, closed, model.cursors[symbol] ?? null, model.btc, CORE_FRAME, max, CORE_TF);
  for (const c of rep.cases) addCase(model.ridge.ROMPE, encode(c.features), c.r);
  model.cursors[symbol] = rep.cursor;
  model.backlog[symbol] = rep.backlog;
  model.historyCases += rep.cases.length;
  if (rep.cases.length) model.venues[venue] = (model.venues[venue] ?? 0) + rep.cases.length;
  if (rep.waitingForBtc) return "espera a BTC para estudiar";
  return rep.studied ? `estudió ${rep.studied} velas (+${rep.cases.length} casos)` : "historia al día";
}

async function scanJob(db: D1Database, symbols: string[], now: number): Promise<JobResult> {
  const loaded = await loadModel(db);
  const model = loaded.model;
  const notes: string[] = [];
  const fresh: CoreSignal[] = [];
  const mindFields: [string, unknown][] = [];
  let failures = 0;
  let feed: Feed | undefined;
  for (const symbol of symbols) {
    let got: { candles: SwingCandle[]; feed: Feed };
    try {
      got = await coreCandles(symbol, 1000, 260, now);
    } catch (error) {
      failures += 1;
      notes.push(`${coin(symbol)} sin datos (${error instanceof Error ? error.message : "error"})`);
      continue;
    }
    const closed = got.candles;
    const venue = got.feed.venue;
    feed = got.feed;
    if (symbol === "BTCUSDT") {
      model.btc = btcSeries(closed, CORE_FRAME);
      const last = closed[closed.length - 1];
      const ch = closed.length > 24 ? last.close / closed[closed.length - 25].close - 1 : null;
      if (model.btc) mindFields.push(["$.btc", { regime: model.btc.last, change24: ch, at: now }]);
    }
    const { reading, signal } = liveRompe(symbol, closed, model, now);
    if (reading) mindFields.push([`$.readings.${symbol}`, reading]);
    // The full technical read (trend by timeframe, levels, volume) for JARVIS's hourly mind and its answers.
    const read = readAsset(symbol, closed, now);
    if (read) mindFields.push([`$.reads.${symbol}`, { ...compactRead(read), at: read.at }]);
    let line = `${coin(symbol)}: ${reading ? reading.state.toLowerCase() : "sin lectura"}`;
    if (signal && !(await isBusy(db, symbol, "ROMPE"))) {
      fresh.push(withVenue(signal, venue));
      line += signal.taken ? ` → señal ${signal.grade?.toLowerCase()}` : " → señal en sombra";
    }
    notes.push(`${line}, ${study(model, symbol, closed, 30, venue)}`);
  }
  // Nothing was read: nothing changed, nothing to write.
  if (failures === symbols.length) return { ok: false, note: notes.join(" · ") };
  await recordCoreSignals(db, fresh, now);
  const saved = await saveModel(db, model, { rev: model.rev, exists: loaded.exists }, now);
  if (feed) mindFields.push(["$.feed", feed]);
  await setMind(db, mindFields);
  return { ok: true, note: `${notes.join(" · ")}${saved ? "" : " · modelo ocupado, se reintenta"}`, feed };
}

async function magnetJob(db: D1Database, symbol: string, now: number): Promise<JobResult> {
  const mind = await readMind(db);
  const { candles: all, feed } = await coreCandles(symbol, 500, 220, now);
  if (all.length < 200) return { ok: true, note: `imanes ${coin(symbol)}: pocas velas`, feed };
  const last = all[all.length - 1];
  const prev = mind.magnets[symbol];
  if (prev && prev.lastTime === last.openTime) return { ok: true, note: `imanes ${coin(symbol)}: sin vela nueva`, feed };
  const cfg = timeframeConfig(CORE_TF);
  const opts = { halfLifeCandles: cfg.halfLife, priceRangePct: cfg.priceRange };
  // Open interest is Binance futures' own series: only with Binance futures candles (it shares their times and their firewall).
  const oi = feed.venue === "BINANCE_FUTURES" ? await loadOiDelta(symbol, CORE_TF, all.map((c) => c.openTime), AbortSignal.timeout(6000)).catch(() => null) : null;
  const nowMap = buildLiquidationHeatmap(symbol, all, last.close, { ...opts, oiDeltaByIndex: oi ?? undefined });
  const nowPair: MagnetPairLite = nowMap ? strongestMagnets(nowMap, last.close) : { above: null, below: null };
  // The map as it stood before the last candle is the one stored an hour ago.
  // One map per run keeps the job inside the free plan's CPU; when there is no
  // stored map (first run, or an hour was missed) this candle's sweeps are not
  // judged and the map is stored for the next one.
  const before: MagnetPairLite | null = prev && prev.lastTime === all[all.length - 2].openTime ? { above: prev.above, below: prev.below } : null;
  const sweeps = before ? sweepsOf(last, before) : [];
  let note = before ? `imanes ${coin(symbol)}: sin barrida` : `imanes ${coin(symbol)}: mapa guardado, las barridas se miden desde la próxima vela`;
  if (before && sweeps.length) {
    const { model } = await loadModel(db);
    const found = liveMagnets(symbol, all, before, nowPair, model);
    const free = found.length && !(await isBusy(db, symbol, "IMÁN")) ? found.slice(0, 1).map((s) => withVenue(s, feed.venue)) : [];
    const added = await recordCoreSignals(db, free, now);
    note = `imanes ${coin(symbol)}: barrida${sweeps.some((e) => e.kind === "BARRIDA" && e.closedBack) ? " con rechazo" : " de largo"}${
      added.length ? ` → señal ${added[0].taken ? added[0].grade?.toLowerCase() : "en sombra"}` : ""
    }`;
  }
  const mm: MindMagnet = { lastTime: last.openTime, at: now, price: last.close, above: nowPair.above, below: nowPair.below, nearPct: Math.max(0.4, atrPct(all) / 2), sweeps, venue: feed.venue };
  await setMind(db, [
    [`$.magnets.${symbol}`, mm],
    ["$.feed", feed],
  ]);
  return { ok: true, note, feed };
}

async function resolveJob(db: D1Database, now: number): Promise<JobResult> {
  const open = await openCoreSignals(db, 40);
  const bySymbol = new Map<string, CoreSignal[]>();
  for (const s of open) bySymbol.set(s.symbol, [...(bySymbol.get(s.symbol) ?? []), s]);
  const updated: CoreSignal[] = [];
  let feed: Feed | undefined;
  // At most 12 coins per minute: the free plan allows 50 outside requests per run.
  for (const [symbol, list] of [...bySymbol].slice(0, 12)) {
    try {
      const got = await coreCandles(symbol, 200, 1, now);
      feed = got.feed;
      for (const s of list) updated.push(resolveSignal(s, got.candles, CORE_FRAME) as CoreSignal);
    } catch {
      // Try again next cycle.
    }
  }
  const closedNow = await closeCoreSignals(db, updated);
  // Magnet sweeps learn from live results (taken and shadow alike: the choice must not bias what it learns).
  const lessons = closedNow.filter((s) => s.source === "IMÁN" && s.features && s.r !== null);
  let learned = "";
  if (lessons.length) {
    const loaded = await loadModel(db);
    for (const s of lessons) addCase(loaded.model.ridge["IMÁN"], encode(s.features as Features), s.r as number);
    loaded.model.liveCases += lessons.length;
    const saved = await saveModel(db, loaded.model, { rev: loaded.model.rev, exists: loaded.exists }, now);
    learned = saved ? `, aprendió de ${lessons.length} ${lessons.length === 1 ? "barrida" : "barridas"}` : ", modelo ocupado";
  }
  return { ok: true, note: `${open.length} abiertas, ${closedNow.length} cerradas ahora${learned}`, feed };
}

/** Extra study for the coin with the most history left (BTC first while its series is missing). */
async function studyJob(db: D1Database, now: number): Promise<JobResult> {
  const loaded = await loadModel(db);
  const model = loaded.model;
  const pending = CORE_COINS.filter((s) => !(s in model.cursors));
  const symbol = !model.btc ? "BTCUSDT" : (pending[0] ?? Object.entries(model.backlog).sort((a, b) => b[1] - a[1]).find(([, n]) => n > 0)?.[0] ?? null);
  if (!symbol) return { ok: true, note: "historia al día: nada pendiente" };
  const { candles: closed, feed } = await coreCandles(symbol, 1000, 260, now);
  if (symbol === "BTCUSDT") model.btc = btcSeries(closed, CORE_FRAME);
  const note = `${coin(symbol)}: ${study(model, symbol, closed, 60, feed.venue)}`;
  const saved = await saveModel(db, model, { rev: model.rev, exists: loaded.exists }, now);
  return { ok: true, note: saved ? note : `${note} · modelo ocupado, se reintenta`, feed };
}

/**
 * One minute of the core. Never throws: a failed job is noted in the
 * heartbeat (which keeps the last 15 ticks) and the next minute's job runs anyway.
 */
export async function runCoreTick(db: D1Database, now = Date.now()): Promise<CoreHeartbeat> {
  await ensureCoreSchema(db);
  const task = coreTask(Math.floor(now / 60_000));
  let result: JobResult;
  try {
    result =
      task.kind === "SCAN"
        ? await scanJob(db, task.symbols, now)
        : task.kind === "MAGNET"
          ? await magnetJob(db, task.symbol, now)
          : task.kind === "RESOLVE"
            ? await resolveJob(db, now)
            : await studyJob(db, now);
  } catch (error) {
    result = { ok: false, note: `error: ${error instanceof Error ? error.message : String(error)}` };
  }
  const prev = await readHeartbeat(db).catch(() => null);
  const hb = withTick(prev, { at: now, task: task.kind, ok: result.ok, note: result.note.slice(0, 300), ...(result.feed ? { feed: result.feed.venue } : {}) });
  await writeHeartbeat(db, hb).catch(() => undefined);
  return hb;
}
