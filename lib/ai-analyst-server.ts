import { AI_DAILY_LIMIT, AI_MAX_OUTPUT, AI_MODEL, extractText, quotaState, type ChatTurn } from "./ai-analyst.ts";

/**
 * The Anthropic call and the daily quota, shared by the app's ANALISTA and
 * the Telegram bot. One quota per user across both, so answering in Telegram
 * does not quietly double what a user can spend.
 */

const USAGE_SCHEMA =
  "CREATE TABLE IF NOT EXISTS ai_usage (user_id INTEGER NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (user_id, day))";

/**
 * Tope de respuestas de Claude por día entre TODOS los usuarios (se paga por respuesta). Con la registración abierta, el tope
 * por persona solo no alcanza: alguien podía crear muchas cuentas y gastar 25 por cada una. Se cuenta en la fila user_id = 0.
 * Pasado el tope, la cascada sigue con los cerebros gratis.
 */
export const CLAUDE_GLOBAL_DAILY = 150;
const GLOBAL_ID = 0;

export async function quotaFor(db: D1Database, userId: number) {
  await db.prepare(USAGE_SCHEMA).run();
  const day = new Date().toISOString().slice(0, 10);
  const rows = (
    await db.prepare("SELECT user_id, count FROM ai_usage WHERE day = ?2 AND user_id IN (?1, ?3) LIMIT 2").bind(userId, day, GLOBAL_ID).all<{ user_id: number; count: number }>()
  ).results;
  const used = rows.find((r) => r.user_id === userId)?.count ?? 0;
  const global = rows.find((r) => r.user_id === GLOBAL_ID)?.count ?? 0;
  const own = quotaState(used);
  const globalOk = global < CLAUDE_GLOBAL_DAILY;
  return { allowed: own.allowed && globalOk, remaining: globalOk ? own.remaining : 0, day, limit: AI_DAILY_LIMIT };
}

export async function consumeQuota(db: D1Database, userId: number, day: string) {
  const sumar = (id: number) =>
    db
      .prepare(
        `INSERT INTO ai_usage (user_id, day, count) VALUES (?1, ?2, 1)
         ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1`,
      )
      .bind(id, day);
  await db.batch([sumar(userId), sumar(GLOBAL_ID)]);
}

/** Consecutive same-role turns are merged: the API requires alternation. */
export function alternate(turns: ChatTurn[]): ChatTurn[] {
  const merged: ChatTurn[] = [];
  for (const t of turns) {
    if (merged.length && merged[merged.length - 1].role === t.role) merged[merged.length - 1].content += `\n\n${t.content}`;
    else merged.push({ ...t });
  }
  while (merged.length && merged[0].role !== "user") merged.shift();
  return merged;
}

export async function askClaude(key: string, system: string, messages: ChatTurn[]) {
  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: AI_MAX_OUTPUT,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: alternate(messages),
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    return { ok: false as const, error: "LA IA NO RESPONDIÓ", status: 504 };
  }
  const data = (await response.json().catch(() => null)) as { usage?: Record<string, number>; error?: { message?: string } } | null;
  if (!response.ok) {
    console.error("[ALT_RADAR_AI]", response.status, data?.error?.message);
    return { ok: false as const, error: response.status === 401 ? "CLAVE DE IA INVÁLIDA" : "ERROR DE LA IA", status: 502 };
  }
  const text = extractText(data);
  if (!text) return { ok: false as const, error: "RESPUESTA VACÍA", status: 502 };
  return { ok: true as const, text, usage: data?.usage ?? null };
}
