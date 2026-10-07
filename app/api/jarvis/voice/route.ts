import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { neuralVoice, NEURAL_VOICES, PREMIUM_DAILY_CHARS, VOICE_MAX_CHARS } from "@/lib/jarvis-voice";
import { addUsage, allowance, cacheKey, cachedAudio, storeAudio, synthesize, usageToday, type AiLike } from "@/lib/jarvis-voice-server";

export const dynamic = "force-dynamic";

const ai = () => (env as unknown as { AI?: AiLike }).AI ?? null;

/** Whether the neural voice is set up, without spending anything. */
export async function GET() {
  return NextResponse.json({ ready: ai() !== null, voices: NEURAL_VOICES.map((v) => v.id), premiumDailyChars: PREMIUM_DAILY_CHARS }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * One or two sentences of JARVIS's speech as MP3. Signed-in users only, each
 * within a daily allowance, because the voice runs on the account's Workers AI
 * allowance. A phrase said before comes from the shared cache and costs nothing.
 */
export async function POST(request: NextRequest) {
  const model = ai();
  if (!model || !env.DB) return NextResponse.json({ error: "VOZ NO CONFIGURADA" }, { status: 503 });
  const session = getCookie(request, SESSION_COOKIE);
  const user = session ? await getSessionUser(env.DB, session) : null;
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { text?: unknown; voice?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.replace(/\s+/g, " ").trim().slice(0, VOICE_MAX_CHARS) : "";
  if (!text) return NextResponse.json({ error: "TEXTO VACÍO" }, { status: 400 });
  const voice = neuralVoice(typeof body?.voice === "string" ? body.voice : null).id;
  const headers = (m: string, cache: string) => ({ "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400", "X-Voice-Model": m, "X-Voice-Cache": cache });

  // Said before with the premium voice: free, whatever is left of today's allowance.
  const auraKey = await cacheKey("aura", voice, text);
  const hit = await cachedAudio(auraKey);
  if (hit) return new Response(hit, { headers: headers("aura", "HIT") });

  const day = new Date().toISOString().slice(0, 10);
  const allow = allowance(await usageToday(env.DB, day, user.id), text.length);
  if (!allow.allowed) return NextResponse.json({ error: "CUPO DIARIO", reason: allow.reason }, { status: 429 });

  const meloKey = await cacheKey("melo", voice, text);
  if (!allow.premium) {
    const meloHit = await cachedAudio(meloKey);
    if (meloHit) return new Response(meloHit, { headers: headers("melo", "HIT") });
  }
  const out = await synthesize(model, text, voice, allow.premium);
  if (!out) return NextResponse.json({ error: "VOZ NO DISPONIBLE" }, { status: 503 });
  await addUsage(env.DB, day, user.id, text.length, out.model === "aura");
  await storeAudio(out.model === "aura" ? auraKey : meloKey, out.audio);
  return new Response(out.audio, { headers: headers(out.model, "MISS") });
}
