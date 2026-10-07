import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { AI_DAILY_LIMIT, AI_MODEL, buildSystemPrompt, buildUserMessage, trimHistory, type ChatTurn } from "@/lib/ai-analyst";
import { BRAIN_LABEL, GROQ_MODEL, WORKERS_MODEL, type AiLike } from "@/lib/ai-brains";
import { answerWithBrains } from "@/lib/ai-cascade";
import { getSecret } from "@/lib/app-settings";
import { KNOWLEDGE } from "@/lib/assistant/knowledge";
import { getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { listMemory, memoryBlock } from "@/lib/jarvis-memory";

export const dynamic = "force-dynamic";

const SYSTEM = buildSystemPrompt(KNOWLEDGE);
const MODEL = { claude: AI_MODEL, groq: GROQ_MODEL, cloudflare: WORKERS_MODEL } as const;

/**
 * Free questions to the AI (ANALISTA and JARVIS). Signed-in users only. The
 * question goes through the brains in order — Claude within each person's
 * daily quota (paid per answer), then the free ones (lib/ai-brains.ts) — with
 * the person's memory. When none can answer, the app answers with its local
 * analyst, which has no limit. The keys never leave the Worker.
 */
export async function POST(request: NextRequest) {
  const session = getCookie(request, SESSION_COOKIE);
  if (!session || !env.DB) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });
  const user = await getSessionUser(env.DB, session);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { question?: string; snapshot?: unknown; history?: ChatTurn[] } | null;
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "PREGUNTA VACÍA" }, { status: 400 });

  const [claude, groq, notes] = await Promise.all([
    getSecret(env.DB, env, "anthropic_api_key"),
    getSecret(env.DB, env, "groq_api_key"),
    listMemory(env.DB, user.id).catch(() => []),
  ]);
  const messages: ChatTurn[] = [
    ...trimHistory(Array.isArray(body?.history) ? body!.history : []),
    { role: "user", content: buildUserMessage(question, body?.snapshot ?? {}, memoryBlock(notes)) },
  ];
  const ai = (env as unknown as { AI?: AiLike }).AI ?? null;
  const r = await answerWithBrains(env.DB, user.id, { claude: claude.value, groq: groq.value }, ai, SYSTEM, messages);
  if (!r.ok) {
    console.error("[ALT_RADAR_AI]", r.error, r.tried.map((t) => `${t.brain}: ${t.error}`).join(" · "));
    return NextResponse.json({ error: r.error, local: true }, { status: r.error === "SIN IA POR HOY" ? 429 : 502 });
  }
  return NextResponse.json({
    text: r.text,
    brain: r.brain,
    label: BRAIN_LABEL[r.brain],
    model: MODEL[r.brain],
    remaining: r.claudeLeft,
    limit: AI_DAILY_LIMIT,
    freeLeft: r.freeLeft,
  });
}
