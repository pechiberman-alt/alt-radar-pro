import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import {
  AI_DAILY_LIMIT,
  AI_MAX_OUTPUT,
  AI_MODEL,
  buildSystemPrompt,
  buildUserMessage,
  extractText,
  quotaState,
  trimHistory,
  type ChatTurn,
} from "@/lib/ai-analyst";
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
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "IA NO CONFIGURADA" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { question?: string; snapshot?: unknown; history?: ChatTurn[] } | null;
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "PREGUNTA VACÍA" }, { status: 400 });

  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS ai_usage (user_id INTEGER NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (user_id, day))",
  ).run();
  const day = new Date().toISOString().slice(0, 10);
  const used = (await env.DB.prepare("SELECT count FROM ai_usage WHERE user_id = ?1 AND day = ?2").bind(user.id, day).first<{ count: number }>())?.count ?? 0;
  const quota = quotaState(used);
  if (!quota.allowed) {
    return NextResponse.json({ error: "LÍMITE DIARIO ALCANZADO", remaining: 0, limit: AI_DAILY_LIMIT }, { status: 429 });
  }

  const messages = [
    ...trimHistory(Array.isArray(body?.history) ? body!.history : []),
    { role: "user" as const, content: buildUserMessage(question, body?.snapshot ?? {}) },
  ];
  // A trimmed history may end on a user turn; merge so turns keep alternating.
  const merged: ChatTurn[] = [];
  for (const m of messages) {
    if (merged.length && merged[merged.length - 1].role === m.role) merged[merged.length - 1].content += `\n\n${m.content}`;
    else merged.push({ ...m });
  }

  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: AI_MAX_OUTPUT,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: merged,
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    return NextResponse.json({ error: "LA IA NO RESPONDIÓ" }, { status: 504 });
  }
  const data = (await response.json().catch(() => null)) as { usage?: Record<string, number>; error?: { message?: string } } | null;
  if (!response.ok) {
    console.error("[ALT_RADAR_AI]", response.status, data?.error?.message);
    return NextResponse.json({ error: response.status === 401 ? "CLAVE DE IA INVÁLIDA" : "ERROR DE LA IA" }, { status: 502 });
  }
  const text = extractText(data);
  if (!text) return NextResponse.json({ error: "RESPUESTA VACÍA" }, { status: 502 });

  // Counted only when an answer was actually produced.
  await env.DB.prepare(
    `INSERT INTO ai_usage (user_id, day, count) VALUES (?1, ?2, 1)
     ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1`,
  )
    .bind(user.id, day)
    .run();
  return NextResponse.json({ text, remaining: quota.remaining - 1, limit: AI_DAILY_LIMIT, model: AI_MODEL, usage: data?.usage ?? null });
}
