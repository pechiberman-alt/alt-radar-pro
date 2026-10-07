import { PREMIUM_DAILY_CHARS, USER_DAILY_CHARS } from "./jarvis-voice.ts";

/**
 * Server side of JARVIS's neural voice: synthesis with fallbacks, a daily
 * allowance in D1 (two rows per day: the person and everyone), and a shared
 * cache so a phrase said before costs nothing.
 */

export type AiLike = { run: (model: string, input: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown> };
export type VoiceModel = "aura" | "melo";
/** Bytes backed by a plain ArrayBuffer, which is what a Response body accepts. */
export type Bytes = Uint8Array<ArrayBuffer>;
export type Synth = { audio: Bytes; model: VoiceModel };

export const AURA = "@cf/deepgram/aura-2-es";
export const MELO = "@cf/myshell-ai/melotts";

function fromBase64(s: string): Bytes {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** Workers AI answers audio as a Response, a stream, raw bytes or `{ audio: base64 }`, depending on the model. */
export async function audioBytes(x: unknown): Promise<Bytes | null> {
  if (!x) return null;
  if (x instanceof Response) return x.ok ? new Uint8Array(await x.arrayBuffer()) : null;
  if (x instanceof Uint8Array) return new Uint8Array(x);
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (typeof (x as ReadableStream).getReader === "function") return new Uint8Array(await new Response(x as ReadableStream).arrayBuffer());
  const audio = (x as { audio?: unknown }).audio;
  if (typeof audio === "string" && audio.length) return fromBase64(audio);
  return null;
}

/** Premium voice first when allowed, MeloTTS otherwise or if it fails; null when neither answers. */
export async function synthesize(ai: AiLike, text: string, voice: string, premium: boolean): Promise<Synth | null> {
  if (premium) {
    try {
      const bytes = await audioBytes(await ai.run(AURA, { text, speaker: voice, encoding: "mp3" }, { returnRawResponse: true }));
      if (bytes && bytes.length > 64) return { audio: bytes, model: "aura" };
    } catch {
      // Daily allowance used up, capacity, or the model is down: the simpler voice.
    }
  }
  try {
    const bytes = await audioBytes(await ai.run(MELO, { prompt: text, lang: "es" }));
    if (bytes && bytes.length > 64) return { audio: bytes, model: "melo" };
  } catch {
    // Neither: the app uses the phone's voice.
  }
  return null;
}

export const VOICE_SCHEMA =
  "CREATE TABLE IF NOT EXISTS jarvis_voice_usage (day TEXT NOT NULL, user_id INTEGER NOT NULL, chars INTEGER NOT NULL, premium INTEGER NOT NULL, PRIMARY KEY (day, user_id))";

export type Usage = { user: number; premiumAll: number };

/** This person's characters today and the premium characters of everyone today (user_id 0). */
export async function usageToday(db: D1Database, day: string, userId: number): Promise<Usage> {
  await db.prepare(VOICE_SCHEMA).run();
  const rows = (
    await db
      .prepare("SELECT user_id, chars, premium FROM jarvis_voice_usage WHERE day = ?1 AND user_id IN (?2, 0) LIMIT 2")
      .bind(day, userId)
      .all<{ user_id: number; chars: number; premium: number }>()
  ).results;
  return { user: rows.find((r) => r.user_id === userId)?.chars ?? 0, premiumAll: rows.find((r) => r.user_id === 0)?.premium ?? 0 };
}

export async function addUsage(db: D1Database, day: string, userId: number, chars: number, premium: boolean) {
  const p = premium ? chars : 0;
  for (const id of [userId, 0]) {
    await db
      .prepare(
        "INSERT INTO jarvis_voice_usage (day, user_id, chars, premium) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(day, user_id) DO UPDATE SET chars = chars + ?3, premium = premium + ?4",
      )
      .bind(day, id, chars, p)
      .run();
  }
  // Old days are not needed: keep the table at a handful of rows.
  await db.prepare("DELETE FROM jarvis_voice_usage WHERE day < ?1").bind(new Date(Date.parse(day) - 3 * 86_400_000).toISOString().slice(0, 10)).run();
}

export type Allowance = { allowed: boolean; premium: boolean; reason: "OK" | "CUPO PERSONAL" };

export function allowance(u: Usage, chars: number): Allowance {
  if (u.user + chars > USER_DAILY_CHARS) return { allowed: false, premium: false, reason: "CUPO PERSONAL" };
  return { allowed: true, premium: u.premiumAll + chars <= PREMIUM_DAILY_CHARS, reason: "OK" };
}

export async function cacheKey(model: VoiceModel, voice: string, text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${model}|${model === "aura" ? voice : "es"}|${text}`));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `https://alt-radar-voice.internal/v1/${model}/${hex}`;
}

function edgeCache(): Cache | null {
  const c = (globalThis as { caches?: { default?: Cache } }).caches;
  return c?.default ?? null;
}

export async function cachedAudio(key: string): Promise<Bytes | null> {
  const hit = await edgeCache()
    ?.match(key)
    .catch(() => undefined);
  return hit ? new Uint8Array(await hit.arrayBuffer()) : null;
}

export async function storeAudio(key: string, audio: Bytes) {
  await edgeCache()
    ?.put(key, new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=2592000" } }))
    .catch(() => undefined);
}
