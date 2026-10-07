/**
 * The conversation with JARVIS in the app, kept for each signed-in person, so
 * a reload does not lose the thread. It holds the words said and nothing else:
 * never the market data. Like the thread on Telegram (lib/telegram-ai-server.ts),
 * it only counts for the last hours; after that the conversation starts fresh.
 * Read through an index on (user_id, at) with a LIMIT, pruned on every write.
 */

export const CHAT_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS jarvis_chat (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, at INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS jarvis_chat_user ON jarvis_chat (user_id, at)",
];
/** How far back the thread goes: the same six hours the Telegram thread uses. */
export const CHAT_WINDOW_MS = 6 * 3_600_000;
/** What is kept at all. Older rows are pruned on the next write. */
export const CHAT_KEEP_MS = 2 * 86_400_000;
/** Turns read back when the panel opens. */
export const CHAT_SHOW = 30;
export const CHAT_TURN_MAX = 1500;
/** Turns accepted in one write: a question and its answer, with a little slack. */
export const CHAT_BATCH_MAX = 4;

export type ChatRole = "user" | "assistant";
export type ChatItem = { role: ChatRole; text: string };
export type ThreadTurn = ChatItem & { at: number };

const ready = new WeakSet<object>();
export async function ensureChatSchema(db: D1Database) {
  if (ready.has(db)) return;
  for (const sql of CHAT_SCHEMA) await db.prepare(sql).run();
  ready.add(db);
}

/** What the app sent, cleaned: only question and answer turns, text trimmed and bounded, a few at most. */
export function cleanTurns(raw: unknown): ChatItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatItem[] = [];
  for (const item of raw.slice(0, CHAT_BATCH_MAX)) {
    if (!item || typeof item !== "object") continue;
    const { role, text } = item as { role?: unknown; text?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof text !== "string") continue;
    const clean = text.replace(/\s+/g, " ").trim().slice(0, CHAT_TURN_MAX);
    if (clean) out.push({ role, text: clean });
  }
  return out;
}

/** Keeps the turns of one exchange, then drops what is older than CHAT_KEEP_MS. */
export async function saveTurns(db: D1Database, userId: number, raw: unknown, now = Date.now()): Promise<number> {
  const turns = cleanTurns(raw);
  if (!turns.length) return 0;
  await ensureChatSchema(db);
  await db.batch([
    ...turns.map((t) => db.prepare("INSERT INTO jarvis_chat (user_id, at, role, content) VALUES (?1, ?2, ?3, ?4)").bind(userId, now, t.role, t.text)),
    db.prepare("DELETE FROM jarvis_chat WHERE user_id = ?1 AND at < ?2").bind(userId, now - CHAT_KEEP_MS),
  ]);
  return turns.length;
}

/** The thread as the panel shows it: the last CHAT_SHOW turns of the last CHAT_WINDOW_MS, oldest first. */
export async function readThread(db: D1Database, userId: number, now = Date.now()): Promise<ThreadTurn[]> {
  await ensureChatSchema(db);
  const rows = (
    await db
      .prepare("SELECT role, content, at FROM jarvis_chat WHERE user_id = ?1 AND at >= ?2 ORDER BY at DESC, id DESC LIMIT ?3")
      .bind(userId, now - CHAT_WINDOW_MS, CHAT_SHOW)
      .all<{ role: string; content: string; at: number }>()
  ).results;
  return rows
    .reverse()
    .map((r) => ({ role: r.role === "user" ? "user" : "assistant", text: r.content, at: r.at }));
}

/** "Nueva charla": forgets this person's thread. Their notes (lib/jarvis-memory.ts) stay. */
export async function clearThread(db: D1Database, userId: number) {
  await ensureChatSchema(db);
  await db.prepare("DELETE FROM jarvis_chat WHERE user_id = ?1").bind(userId).run();
}
