import type { ChatTurn } from "./ai-analyst.ts";

/**
 * JARVIS's brains, in the order they answer a free question:
 *
 *   1. Claude (Anthropic): the best one. Each answer is paid from the owner's
 *      credit, so each person gets AI_DAILY_LIMIT a day.
 *   2. Groq, when the owner saves a free Groq key: gpt-oss-120b, about 200.000
 *      tokens a day at no cost (roughly 50 answers), for the whole app.
 *   3. Cloudflare Workers AI, with no key at all: Qwen3 30B on the account's
 *      free daily neurons, which it shares with the neural voice.
 *   4. The app's own analyst, in the browser (jarvis-local.ts): no limit, it
 *      reads the same live data with fixed rules.
 *
 * Every brain gets the same instructions, the same live data and the same
 * memory, and the answer says which one spoke. Nothing here is "infinite" for
 * free: what never runs out is the last step, and the steps before it are
 * there so that it is rarely needed.
 */

export type Brain = "claude" | "groq" | "cloudflare";
export const BRAIN_LABEL: Record<Brain | "local", string> = {
  claude: "Claude",
  groq: "IA gratis · Groq",
  cloudflare: "IA gratis · Cloudflare",
  local: "motor local",
};

export type Usage = { input: number; output: number };
/** `detail`: what the API said, for the deploy check (ai-probe.ts); never shown to users. */
export type BrainResult = { ok: true; text: string; usage: Usage | null } | { ok: false; error: string; detail?: string };
export type AiLike = { run: (model: string, input: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown> };

/** Qwen3 30B (a mixture of experts: 3B active): fluent Spanish, cheap enough to give dozens of answers a day. */
export const WORKERS_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";
/** Its price in neurons per million tokens (Cloudflare's table, October 2026). */
const WORKERS_NEURONS = { input: 4625, output: 30475 };
/**
 * Of the 10.000 free neurons a day, the share the free brain may spend; the
 * premium voice keeps about 6.000 (jarvis-voice.ts) and MeloTTS the rest.
 */
export const FREE_DAILY_NEURONS = 3500;
/** Free answers per person per day (Groq and Cloudflare together), so one person can't use up everyone's. */
export const FREE_USER_DAILY = 60;
export const FREE_MAX_OUTPUT = 1400;

export const GROQ_BASE = "https://api.groq.com/openai/v1";
export const GROQ_MODEL = "openai/gpt-oss-120b";
export const isGroqKey = (k: string) => /^gsk_[A-Za-z0-9]{20,}$/.test(k.trim());

export const neuronsFor = (u: Usage) => (u.input * WORKERS_NEURONS.input + u.output * WORKERS_NEURONS.output) / 1e6;

/** Qwen3 and gpt-oss may think out loud first; only the answer is kept. */
export function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*<\/think>/i, "")
    .trim();
}

/**
 * The text of a chat answer in any of the shapes these APIs use: OpenAI chat
 * completions (choices[].message.content), the Responses API (output[] of
 * messages with output_text), or Workers AI's classic `{ response }`.
 */
export function extractChatText(x: unknown): string {
  const o = x as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return typeof x === "string" ? stripThinking(x) : "";
  const choice = (o.choices as { message?: { content?: unknown }; text?: unknown }[] | undefined)?.[0];
  if (typeof choice?.message?.content === "string") return stripThinking(choice.message.content);
  if (typeof choice?.text === "string") return stripThinking(choice.text);
  if (typeof o.output_text === "string") return stripThinking(o.output_text);
  if (Array.isArray(o.output)) {
    const parts: string[] = [];
    for (const item of o.output as { type?: string; content?: { type?: string; text?: unknown }[] }[]) {
      if (item?.type !== "message" || !Array.isArray(item.content)) continue;
      for (const c of item.content) if (typeof c?.text === "string" && c.type !== "reasoning_text") parts.push(c.text);
    }
    if (parts.length) return stripThinking(parts.join("\n"));
  }
  if (typeof o.response === "string") return stripThinking(o.response);
  if (o.result && typeof o.result === "object") return extractChatText(o.result);
  return "";
}

export function usageOf(x: unknown): Usage | null {
  const u = (x as { usage?: Record<string, unknown> } | null)?.usage;
  if (!u) return null;
  const input = Number(u.prompt_tokens ?? u.input_tokens);
  const output = Number(u.completion_tokens ?? u.output_tokens);
  return Number.isFinite(input) && Number.isFinite(output) ? { input, output } : null;
}

/** Same conversation for every brain: the system prompt first, then alternating turns. */
export function chatMessages(system: string, messages: ChatTurn[]) {
  return [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: m.content }))];
}

/** Rough tokens of a text, when an API does not report usage (Spanish runs about 3,5 characters a token). */
export const roughTokens = (text: string) => Math.ceil(text.length / 3.5);

export async function askWorkersAI(ai: AiLike, system: string, messages: ChatTurn[], maxTokens = FREE_MAX_OUTPUT): Promise<BrainResult> {
  try {
    // "/no_think": Qwen3 answers straight away instead of reasoning out loud first —
    // a fraction of the tokens, and no answer cut off by a long reasoning.
    const out = await ai.run(WORKERS_MODEL, { messages: chatMessages(`${system}\n\n/no_think`, messages), max_tokens: maxTokens, temperature: 0.4 });
    const text = extractChatText(out);
    if (text) return { ok: true, text, usage: usageOf(out) };
    return { ok: false, error: "RESPUESTA VACÍA", detail: `forma: ${out && typeof out === "object" ? Object.keys(out).join(",") : typeof out}` };
  } catch (error) {
    // 3036 = the day's free neurons are used up; anything else = the model is busy or down.
    const detail = String(error).slice(0, 200);
    return { ok: false, error: /3036|neuron|limit/i.test(detail) ? "CUPO GRATIS AGOTADO" : "LA IA GRATIS NO RESPONDIÓ", detail };
  }
}

/** Any OpenAI-compatible chat API (Groq). */
export async function askOpenAICompatible(base: string, key: string, model: string, system: string, messages: ChatTurn[], maxTokens = FREE_MAX_OUTPUT): Promise<BrainResult> {
  let r: Response;
  try {
    r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: chatMessages(system, messages), max_tokens: maxTokens, temperature: 0.4 }),
      signal: AbortSignal.timeout(40_000),
    });
  } catch {
    return { ok: false, error: "LA IA GRATIS NO RESPONDIÓ" };
  }
  const data = await r.json().catch(() => null);
  if (!r.ok) return { ok: false, error: r.status === 429 ? "CUPO GRATIS AGOTADO" : r.status === 401 ? "CLAVE GRATIS INVÁLIDA" : "LA IA GRATIS NO RESPONDIÓ" };
  const text = extractChatText(data);
  return text ? { ok: true, text, usage: usageOf(data) } : { ok: false, error: "RESPUESTA VACÍA" };
}

export type BrainCall = { brain: Brain; run: () => Promise<BrainResult> };
export type Answered = { brain: Brain; text: string; usage: Usage | null; tried: { brain: Brain; error: string }[] };

/** The first brain that answers; what the others said, for the log and the app. */
export async function firstAnswer(calls: BrainCall[]): Promise<Answered | { brain: null; tried: { brain: Brain; error: string }[] }> {
  const tried: { brain: Brain; error: string }[] = [];
  for (const c of calls) {
    const r = await c.run();
    if (r.ok) return { brain: c.brain, text: r.text, usage: r.usage, tried };
    tried.push({ brain: c.brain, error: r.error });
  }
  return { brain: null, tried };
}

// ── The free brains' daily allowance (one row per person per day; user 0 = everyone) ──

export const FREE_SCHEMA =
  "CREATE TABLE IF NOT EXISTS ai_free_usage (day TEXT NOT NULL, user_id INTEGER NOT NULL, answers INTEGER NOT NULL, neurons REAL NOT NULL, PRIMARY KEY (day, user_id))";

export type FreeUsage = { answers: number; neuronsAll: number };

export async function freeUsage(db: D1Database, day: string, userId: number): Promise<FreeUsage> {
  await db.prepare(FREE_SCHEMA).run();
  const rows = (
    await db.prepare("SELECT user_id, answers, neurons FROM ai_free_usage WHERE day = ?1 AND user_id IN (?2, 0) LIMIT 2").bind(day, userId).all<{ user_id: number; answers: number; neurons: number }>()
  ).results;
  return { answers: rows.find((r) => r.user_id === userId)?.answers ?? 0, neuronsAll: rows.find((r) => r.user_id === 0)?.neurons ?? 0 };
}

export async function addFreeUsage(db: D1Database, day: string, userId: number, neurons: number) {
  for (const id of [userId, 0]) {
    await db
      .prepare(
        "INSERT INTO ai_free_usage (day, user_id, answers, neurons) VALUES (?1, ?2, 1, ?3) ON CONFLICT(day, user_id) DO UPDATE SET answers = answers + 1, neurons = neurons + ?3",
      )
      .bind(day, id, neurons)
      .run();
  }
  await db.prepare("DELETE FROM ai_free_usage WHERE day < ?1").bind(new Date(Date.parse(day) - 3 * 86_400_000).toISOString().slice(0, 10)).run();
}

/** What the free brains may still do today for this person. */
export function freeAllowance(u: FreeUsage) {
  return { groq: u.answers < FREE_USER_DAILY, cloudflare: u.answers < FREE_USER_DAILY && u.neuronsAll < FREE_DAILY_NEURONS };
}
