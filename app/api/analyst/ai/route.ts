import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { AI_MODEL, buildSystemPrompt, buildUserMessage, trimHistory, type ChatTurn } from "@/lib/ai-analyst";
import { askClaude, consumeQuota, quotaFor } from "@/lib/ai-analyst-server";
import { getSecret } from "@/lib/app-settings";
import { KNOWLEDGE } from "@/lib/assistant/knowledge";
import { getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

const SYSTEM = buildSystemPrompt(KNOWLEDGE);

/**
 * AI mode of the ANALISTA. The API key never leaves the Worker; only signed-in
 * users can spend it, each within a daily quota, because every answer is paid
 * per token. The system prompt is sent with prompt caching, so its cost is
 * mostly paid once per few minutes instead of on every question.
 */
export async function POST(request: NextRequest) {
  const session = getCookie(request, SESSION_COOKIE);
  if (!session || !env.DB) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });
  const user = await getSessionUser(env.DB, session);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });
  const key = (await getSecret(env.DB, env, "anthropic_api_key")).value;
  if (!key) return NextResponse.json({ error: "IA NO CONFIGURADA" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { question?: string; snapshot?: unknown; history?: ChatTurn[] } | null;
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "PREGUNTA VACÍA" }, { status: 400 });

  const quota = await quotaFor(env.DB, user.id);
  if (!quota.allowed) {
    return NextResponse.json({ error: "LÍMITE DIARIO ALCANZADO", remaining: 0, limit: quota.limit }, { status: 429 });
  }

  const messages: ChatTurn[] = [
    ...trimHistory(Array.isArray(body?.history) ? body!.history : []),
    { role: "user", content: buildUserMessage(question, body?.snapshot ?? {}) },
  ];
  const answer = await askClaude(key, SYSTEM, messages);
  if (!answer.ok) return NextResponse.json({ error: answer.error }, { status: answer.status });

  // Counted only when an answer was actually produced.
  await consumeQuota(env.DB, user.id, quota.day);
  return NextResponse.json({ text: answer.text, remaining: quota.remaining - 1, limit: quota.limit, model: AI_MODEL, usage: answer.usage });
}
