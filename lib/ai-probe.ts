import { askWorkersAI, WORKERS_MODEL, type AiLike, type Usage } from "./ai-brains.ts";
import { BUILD_ID } from "./build-info.ts";

/**
 * Once per deploy, the minute cron asks the free brain (Cloudflare Workers AI)
 * a one-word question and keeps what happened, so the settings screen — and
 * whoever deployed — can see that the free AI really answers in production.
 * About one neuron per deploy; one row.
 */
export const PROBE_SCHEMA = "CREATE TABLE IF NOT EXISTS ai_probe (key TEXT PRIMARY KEY, value TEXT NOT NULL)";

export type Probe = { build: string; at: number; ok: boolean; model: string; ms: number; text?: string; usage?: Usage | null; error?: string; detail?: string };

let probedBuild = "";

export async function readProbe(db: D1Database): Promise<Probe | null> {
  await db.prepare(PROBE_SCHEMA).run();
  const row = await db.prepare("SELECT value FROM ai_probe WHERE key = 'cloudflare' LIMIT 1").first<{ value: string }>();
  try {
    return row ? (JSON.parse(row.value) as Probe) : null;
  } catch {
    return null;
  }
}

/**
 * Runs the check if this build has not passed it yet (a failed check is
 * repeated every 30 minutes); null when there was nothing to do.
 */
export async function probeFreeBrain(db: D1Database, ai: AiLike | null, now = Date.now(), build = BUILD_ID): Promise<Probe | null> {
  if (!ai || probedBuild === build) return null;
  const prev = await readProbe(db);
  if (prev?.build === build) {
    if (prev.ok) probedBuild = build;
    if (prev.ok || now - prev.at < 30 * 60_000) return null;
  }
  const t0 = Date.now();
  const r = await askWorkersAI(ai, "Sos un asistente. Respondé con una sola palabra en español.", [{ role: "user", content: "¿Estás funcionando? Respondé: listo." }], 60);
  const probe: Probe = r.ok
    ? { build, at: now, ok: true, model: WORKERS_MODEL, ms: Date.now() - t0, text: r.text.slice(0, 80), usage: r.usage }
    : { build, at: now, ok: false, model: WORKERS_MODEL, ms: Date.now() - t0, error: r.error, detail: r.detail };
  await db.prepare("INSERT OR REPLACE INTO ai_probe (key, value) VALUES ('cloudflare', ?1)").bind(JSON.stringify(probe)).run();
  if (probe.ok) probedBuild = build;
  return probe;
}

/** For tests: forget which build was checked in this isolate. */
export function resetProbe() {
  probedBuild = "";
}
