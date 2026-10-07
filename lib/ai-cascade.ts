import type { ChatTurn } from "./ai-analyst.ts";
import { askClaude, consumeQuota, quotaFor } from "./ai-analyst-server.ts";
import {
  addFreeUsage,
  askOpenAICompatible,
  askWorkersAI,
  firstAnswer,
  FREE_USER_DAILY,
  freeAllowance,
  freeUsage,
  GROQ_BASE,
  GROQ_MODEL,
  neuronsFor,
  roughTokens,
  type AiLike,
  type Brain,
  type BrainCall,
} from "./ai-brains.ts";

export type CascadeOk = { ok: true; brain: Brain; text: string; claudeLeft: number; freeLeft: number };
export type CascadeFail = { ok: false; error: "SIN IA POR HOY" | "LA IA NO RESPONDIÓ"; tried: { brain: Brain; error: string }[] };

/**
 * One question through the brains in order (lib/ai-brains.ts): Claude while
 * this person has quota and a key exists, then Groq if its free key is saved,
 * then Cloudflare's free model. Only the brain that answered is counted.
 * When none can answer, the app's local analyst takes over (jarvis-local.ts).
 */
export async function answerWithBrains(
  db: D1Database,
  userId: number,
  keys: { claude: string | null; groq: string | null },
  ai: AiLike | null,
  system: string,
  messages: ChatTurn[],
  now = Date.now(),
  claude: typeof askClaude = askClaude,
): Promise<CascadeOk | CascadeFail> {
  const day = new Date(now).toISOString().slice(0, 10);
  const [quota, free] = await Promise.all([quotaFor(db, userId), freeUsage(db, day, userId)]);
  const allow = freeAllowance(free);
  const calls: BrainCall[] = [];
  if (keys.claude && quota.allowed) {
    const key = keys.claude;
    calls.push({
      brain: "claude",
      run: async () => {
        const r = await claude(key, system, messages);
        return r.ok ? { ok: true, text: r.text, usage: null } : { ok: false, error: r.error };
      },
    });
  }
  if (keys.groq && allow.groq) {
    const key = keys.groq;
    calls.push({ brain: "groq", run: () => askOpenAICompatible(GROQ_BASE, key, GROQ_MODEL, system, messages) });
  }
  if (ai && allow.cloudflare) calls.push({ brain: "cloudflare", run: () => askWorkersAI(ai, system, messages) });
  if (!calls.length) return { ok: false, error: "SIN IA POR HOY", tried: [] };

  const got = await firstAnswer(calls);
  if (got.brain === null) {
    // Every brain tried said its allowance was used: that is "none left today", not an outage.
    const spent = got.tried.every((t) => t.error === "CUPO GRATIS AGOTADO");
    return { ok: false, error: spent ? "SIN IA POR HOY" : "LA IA NO RESPONDIÓ", tried: got.tried };
  }
  if (got.brain === "claude") {
    await consumeQuota(db, userId, quota.day);
  } else {
    const usage = got.usage ?? { input: roughTokens(system + messages.map((m) => m.content).join("\n")), output: roughTokens(got.text) };
    // Groq's tokens are free and counted by Groq; Cloudflare's come out of the account's neurons.
    await addFreeUsage(db, day, userId, got.brain === "cloudflare" ? neuronsFor(usage) : 0);
  }
  return {
    ok: true,
    brain: got.brain,
    text: got.text,
    claudeLeft: Math.max(0, quota.remaining - (got.brain === "claude" ? 1 : 0)),
    freeLeft: Math.max(0, FREE_USER_DAILY - free.answers - (got.brain === "claude" ? 0 : 1)),
  };
}
