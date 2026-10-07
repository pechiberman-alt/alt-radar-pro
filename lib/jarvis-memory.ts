/**
 * What a person asked JARVIS to remember ("Jarvis, recordá que opero solo
 * BTC y SOL"). Every brain gets it with each question, so the answers adapt
 * to that person without retraining any model — the honest kind of learning
 * a language model can do. One small row per note, at most MEMORY_MAX per
 * person (the oldest goes first), read through an index with a LIMIT.
 */

export const MEMORY_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS jarvis_memory (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS jarvis_memory_user ON jarvis_memory (user_id, id)",
];
export const MEMORY_MAX = 40;
export const MEMORY_TEXT_MAX = 300;

export type MemoryNote = { id: number; text: string; at: number };

const ready = new WeakSet<object>();
export async function ensureMemorySchema(db: D1Database) {
  if (ready.has(db)) return;
  for (const sql of MEMORY_SCHEMA) await db.prepare(sql).run();
  ready.add(db);
}

/** A note as it is kept: one line, no leading "que", a capital, at most MEMORY_TEXT_MAX characters. */
export function cleanNote(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim().replace(/^(que|esto|lo siguiente)\s*:?\s+/i, "").replace(/[.\s]+$/, "");
  return t ? (t[0].toUpperCase() + t.slice(1)).slice(0, MEMORY_TEXT_MAX) : "";
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export async function listMemory(db: D1Database, userId: number): Promise<MemoryNote[]> {
  await ensureMemorySchema(db);
  const rows = (
    await db.prepare("SELECT id, text, created_at FROM jarvis_memory WHERE user_id = ?1 ORDER BY id DESC LIMIT ?2").bind(userId, MEMORY_MAX).all<{ id: number; text: string; created_at: number }>()
  ).results;
  return rows.reverse().map((r) => ({ id: r.id, text: r.text, at: r.created_at }));
}

/** Saves a note (the same note twice is kept once); past MEMORY_MAX the oldest is dropped. */
export async function addMemory(db: D1Database, userId: number, raw: string, now = Date.now()): Promise<{ saved: boolean; text: string; total: number }> {
  const text = cleanNote(raw);
  if (text.length < 3) return { saved: false, text, total: (await listMemory(db, userId)).length };
  const notes = await listMemory(db, userId);
  if (notes.some((n) => fold(n.text) === fold(text))) return { saved: false, text, total: notes.length };
  await db.prepare("INSERT INTO jarvis_memory (user_id, text, created_at) VALUES (?1, ?2, ?3)").bind(userId, text, now).run();
  const extra = notes.length + 1 - MEMORY_MAX;
  if (extra > 0) {
    for (const n of notes.slice(0, extra)) await db.prepare("DELETE FROM jarvis_memory WHERE id = ?1 AND user_id = ?2").bind(n.id, userId).run();
  }
  return { saved: true, text, total: Math.min(MEMORY_MAX, notes.length + 1) };
}

/**
 * Forgets the notes that contain every meaningful word of the request
 * ("olvidá lo de SOL" → notes mentioning SOL); "todo" forgets everything.
 * Returns the notes it removed.
 */
export async function forgetMemory(db: D1Database, userId: number, raw: string): Promise<MemoryNote[]> {
  const notes = await listMemory(db, userId);
  const q = fold(raw).replace(/^(lo de|lo que|de|que|el|la|los|las|sobre)\s+/, "");
  const all = /^(todo|toda la memoria|todos|todas|lo que sabes|lo que te dije)$/.test(q);
  const words = q.split(" ").filter((w) => w.length >= 2 && !["de", "la", "el", "lo", "que", "los", "las", "un", "una", "y", "mi", "me"].includes(w));
  const gone = all ? notes : words.length ? notes.filter((n) => words.every((w) => fold(n.text).includes(w))) : [];
  for (const n of gone) await db.prepare("DELETE FROM jarvis_memory WHERE id = ?1 AND user_id = ?2").bind(n.id, userId).run();
  return gone;
}

/** The block every brain receives with the question. */
export function memoryBlock(notes: MemoryNote[]): string {
  if (!notes.length) return "";
  return `MEMORIA DEL USUARIO (te pidió que lo recuerdes; usalo cuando aplique, sin repetirlo de memoria en cada respuesta):\n${notes.map((n) => `- ${n.text}`).join("\n")}`;
}
