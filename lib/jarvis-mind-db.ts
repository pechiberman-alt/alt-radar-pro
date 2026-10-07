import {
  addFreeUsage,
  askOpenAICompatible,
  askWorkersAI,
  firstAnswer,
  FREE_DAILY_NEURONS,
  freeUsage,
  GROQ_BASE,
  GROQ_MODEL,
  neuronsFor,
  roughTokens,
  WORKERS_MODEL,
  type AiLike,
  type BrainCall,
} from "./ai-brains.ts";
import { forAi } from "./ai-numbers.ts";
import { getSecret, type SettingsEnv } from "./app-settings.ts";
import { CORE_COINS, type CoreSignal } from "./jarvis-core.ts";
import { coreCandles, ensureCoreSchema, isBusy, latestReading, loadModel, MIND_SCHEMA, openCoreSignals, readCoreStats, readMind, recentClosed, recordCoreSignals } from "./jarvis-core-db.ts";
import { summarizeModel } from "./jarvis-learn.ts";
import {
  checkThesis,
  MIND_MAX_OUTPUT,
  MIND_MAX_THESES,
  MIND_SYSTEM,
  mindDossier,
  parseMindAnswer,
  rawTheses,
  readingText,
  thesisRecord,
  thesisSignal,
  type MindReading,
  type MindThesis,
} from "./jarvis-mind.ts";
import { readWorld } from "./jarvis-world.ts";
import { isOutside, VENUE_LABEL, type Venue } from "./klines-server.ts";

/**
 * Database side of JARVIS MENTE (jarvis-mind.ts): the hourly reading, its
 * storage (one row per hour, the last 72 kept) and the run status. Runs from
 * the minute cron at hh:17 UTC, when every coin has been read again after the
 * hour's candle closed; an atomic claim makes it once per hour whatever the
 * number of isolates.
 */

export const MIND_MINUTE = 17;
const MIND_KEEP = 72;
/** Free neurons always left for people's questions (ai-brains.ts). */
const MIND_RESERVE = 800;
/** ai_free_usage row of the mind itself (not a person). */
const MIND_USER = -1;
const H = 3_600_000;

async function claimHour(db: D1Database, hour: number): Promise<boolean> {
  await db.prepare("INSERT OR IGNORE INTO jarvis_core_state (key, value) VALUES ('mind_hour', '0')").run();
  const r = await db.prepare("UPDATE jarvis_core_state SET value = ?1 WHERE key = 'mind_hour' AND CAST(value AS INTEGER) < ?2").bind(String(hour), hour).run();
  return r.meta.changes > 0;
}

async function setStatus(db: D1Database, status: Record<string, unknown>) {
  await db.prepare("INSERT OR REPLACE INTO jarvis_core_state (key, value) VALUES ('mind_status', ?1)").bind(JSON.stringify(status)).run();
}

type LastCandle = { openTime: number; close: number; venue: Venue };
/** `fetchCandle`: replaces the candle source (tests). */
export type MindDeps = { fetchCandle?: (symbol: string, now: number) => Promise<LastCandle | null> };

/** The last closed 1h candle of a coin, from the same sources as the core. */
async function lastClosed(symbol: string, now: number): Promise<LastCandle | null> {
  const { candles, feed } = await coreCandles(symbol, 3, 1, now);
  const c = candles[candles.length - 1];
  return c ? { openTime: c.openTime, close: c.close, venue: feed.venue } : null;
}

/**
 * One hour of JARVIS MENTE. Returns the reading written, or null when there
 * was nothing to do (not yet hh:17, already done this hour, no brain left).
 */
export async function runMindHour(db: D1Database, env: SettingsEnv & { AI?: AiLike }, now = Date.now(), deps: MindDeps = {}): Promise<MindReading | null> {
  if (new Date(now).getUTCMinutes() < MIND_MINUTE) return null;
  await ensureCoreSchema(db);
  await db.prepare(MIND_SCHEMA).run();
  if (!(await claimHour(db, Math.floor(now / H)))) return null;

  const day = new Date(now).toISOString().slice(0, 10);
  const [groq, free] = await Promise.all([getSecret(db, env, "groq_api_key").catch(() => ({ value: null })), freeUsage(db, day, MIND_USER)]);
  const ai = env.AI ?? null;
  const useWorkers = ai !== null && free.neuronsAll < FREE_DAILY_NEURONS - MIND_RESERVE;
  if (!groq.value && !useWorkers) {
    await setStatus(db, { at: now, ok: false, error: "SIN CUPO DE IA GRATIS" });
    return null;
  }

  const [mind, world, structure, stats, open, recent, model, previous] = await Promise.all([
    readMind(db),
    readWorld(db).catch(() => null),
    db.prepare("SELECT * FROM structure_snapshots ORDER BY captured_at DESC LIMIT 1").first<Record<string, unknown>>().catch(() => null),
    readCoreStats(db),
    openCoreSignals(db, 40),
    recentClosed(db, "IA", 8),
    loadModel(db),
    latestReading(db),
  ]);
  const dossier = mindDossier({
    mind,
    world,
    structure,
    record: thesisRecord(stats.bySource.IA, recent),
    open,
    learning: model.exists ? summarizeModel(model.model) : null,
    previous,
    now,
  });
  if (!dossier.monedas.length) {
    await setStatus(db, { at: now, ok: false, error: "SIN LECTURAS FRESCAS DEL NÚCLEO" });
    return null;
  }
  // Numbers go already written the Argentine way: the model copies them instead of converting them (ai-numbers.ts).
  const messages = [{ role: "user" as const, content: `DATOS:\n${JSON.stringify(forAi(dossier))}` }];
  const calls: BrainCall[] = [];
  if (groq.value) {
    const key = groq.value;
    calls.push({ brain: "groq", run: () => askOpenAICompatible(GROQ_BASE, key, GROQ_MODEL, MIND_SYSTEM, messages, MIND_MAX_OUTPUT) });
  }
  if (useWorkers && ai) calls.push({ brain: "cloudflare", run: () => askWorkersAI(ai, MIND_SYSTEM, messages, MIND_MAX_OUTPUT) });
  const got = await firstAnswer(calls);
  if (got.brain === null) {
    await setStatus(db, { at: now, ok: false, error: "LA IA NO RESPONDIÓ", tried: got.tried });
    return null;
  }
  const usage = got.usage ?? { input: roughTokens(MIND_SYSTEM + messages[0].content), output: roughTokens(got.text) };
  await addFreeUsage(db, day, MIND_USER, got.brain === "cloudflare" ? neuronsFor(usage) : 0);
  const raw = parseMindAnswer(got.text);
  if (!raw) {
    await setStatus(db, { at: now, ok: false, error: "RESPUESTA SIN JSON", brain: got.brain, sample: got.text.slice(0, 300) });
    return null;
  }

  // Theses: checked against the price of the last closed candle, one open per coin, three at most.
  const text = readingText(raw);
  const accepted: CoreSignal[] = [];
  const kept: MindThesis[] = [];
  const dropped: { moneda: string; motivo: string }[] = [];
  const fetchCandle = deps.fetchCandle ?? lastClosed;
  for (const t of rawTheses(raw)) {
    const coinName = String(t.moneda ?? "").toUpperCase().replace(/USDT$/, "").trim();
    const symbol = `${coinName}USDT`;
    if (accepted.length >= MIND_MAX_THESES) break;
    if (!CORE_COINS.includes(symbol)) {
      dropped.push({ moneda: coinName, motivo: "fuera de las 20 monedas que sigue el núcleo" });
      continue;
    }
    if (await isBusy(db, symbol, "IA")) {
      dropped.push({ moneda: coinName, motivo: "ya tiene una tesis abierta" });
      continue;
    }
    const candle = await fetchCandle(symbol, now).catch(() => null);
    if (!candle) {
      dropped.push({ moneda: coinName, motivo: "sin precio actual" });
      continue;
    }
    const c = checkThesis(t, candle.close);
    if (!c.ok) {
      dropped.push({ moneda: coinName, motivo: c.motivo });
      continue;
    }
    const venueNote = isOutside(candle.venue) ? ` · precios de ${VENUE_LABEL[candle.venue]} (USD)` : "";
    const s = thesisSignal(symbol, candle.openTime, candle.close, c, venueNote);
    accepted.push(s);
    kept.push({ id: s.id, moneda: coinName, lado: c.lado, entrada: candle.close, objetivo: c.objetivo, invalidacion: c.invalidacion, confianza: c.confianza, porque: c.porque });
  }
  await recordCoreSignals(db, accepted, now);

  const reading: MindReading = {
    at: now,
    brain: got.brain,
    model: got.brain === "groq" ? GROQ_MODEL : WORKERS_MODEL,
    ...text,
    sesgoAnterior: previous?.sesgo ?? null,
    tesis: kept,
    descartadas: dropped,
  };
  await db.prepare("INSERT INTO jarvis_mind (at, body) VALUES (?1, ?2)").bind(now, JSON.stringify(reading)).run();
  const cut = await db.prepare(`SELECT id FROM jarvis_mind ORDER BY id DESC LIMIT 1 OFFSET ${MIND_KEEP}`).first<{ id: number }>();
  if (cut) await db.prepare("DELETE FROM jarvis_mind WHERE id <= ?1").bind(cut.id).run();
  await setStatus(db, { at: now, ok: true, brain: got.brain, tesis: kept.length, descartadas: dropped.length });
  return reading;
}

export async function mindStatus(db: D1Database): Promise<Record<string, unknown> | null> {
  const row = await db.prepare("SELECT value FROM jarvis_core_state WHERE key = 'mind_status' LIMIT 1").first<{ value: string }>().catch(() => null);
  try {
    return row ? (JSON.parse(row.value) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
