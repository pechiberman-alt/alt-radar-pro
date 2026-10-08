import { cursorOf, nextMinute, validatePaper, type PaperState, type PaperTrade } from "./jarvis-paper.ts";

/**
 * Las operaciones de papel de JARVIS TRADING, por cuenta. El plan de cada una
 * (lado, entrada, stop, objetivos, el análisis y la decisión) no se toca
 * nunca después de abrirla: lo único que avanza es su progreso (salidas,
 * estado, máximo a favor y en contra), y siempre hacia adelante. El resultado
 * en R lo recalcula el servidor con las salidas, a los precios del plan.
 *
 * Presupuesto de D1: un contador por persona (nada de COUNT(*)) y lecturas
 * por índice con LIMIT.
 */

export const MAX_OPEN_PER_USER = 20;
export const MAX_TOTAL_PER_USER = 3000;
export const LIST_LIMIT = 300;

const ready = new WeakSet<D1Database>();

export async function ensurePaperSchema(db: D1Database) {
  if (ready.has(db)) return;
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS jarvis_paper (
        user_id INTEGER NOT NULL,
        id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        estado TEXT NOT NULL,
        abierta_a INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (user_id, id)
      )`,
    ),
    db.prepare("CREATE INDEX IF NOT EXISTS jarvis_paper_recent ON jarvis_paper (user_id, abierta_a)"),
    db.prepare("CREATE TABLE IF NOT EXISTS jarvis_paper_counts (user_id INTEGER PRIMARY KEY, total INTEGER NOT NULL, abiertas INTEGER NOT NULL)"),
  ]);
  ready.add(db);
}

const LIVE: PaperState[] = ["PENDIENTE", "ABIERTA"];
const isLive = (s: PaperState) => LIVE.includes(s);

export async function listPaper(db: D1Database, userId: number, limit = LIST_LIMIT): Promise<PaperTrade[]> {
  const r = await db.prepare("SELECT data FROM jarvis_paper WHERE user_id = ? ORDER BY abierta_a DESC LIMIT ?").bind(userId, limit).all<{ data: string }>();
  const out: PaperTrade[] = [];
  for (const row of r.results ?? []) {
    try {
      out.push(JSON.parse(row.data) as PaperTrade);
    } catch {
      // An unreadable row is skipped, not the whole record.
    }
  }
  return out;
}

export async function paperCounts(db: D1Database, userId: number): Promise<{ total: number; abiertas: number }> {
  const r = await db.prepare("SELECT total, abiertas FROM jarvis_paper_counts WHERE user_id = ?").bind(userId).first<{ total: number; abiertas: number }>();
  return { total: r?.total ?? 0, abiertas: r?.abiertas ?? 0 };
}

export type OpenResult = { ok: true; trade: PaperTrade } | { ok: false; status: number; error: string };

/** Abre una operación nueva. Repetir la misma (mismo id) no la duplica. */
export async function openPaper(db: D1Database, userId: number, raw: unknown, now: number): Promise<OpenResult> {
  const t = validatePaper(raw, now);
  if (!t || !isLive(t.estado) || t.salidas.length) return { ok: false, status: 400, error: "La operación no tiene un plan válido." };
  // Only a fresh plan: the desk read a candle closed in the last two hours.
  if (now - t.vela > 3 * 3_600_000) return { ok: false, status: 409, error: "Ese plan ya es viejo: volvé a analizar el activo." };
  const counts = await paperCounts(db, userId);
  if (counts.abiertas >= MAX_OPEN_PER_USER) return { ok: false, status: 409, error: `Ya tenés ${MAX_OPEN_PER_USER} operaciones de papel abiertas: cerrá alguna primero.` };
  if (counts.total >= MAX_TOTAL_PER_USER) return { ok: false, status: 409, error: `El registro llegó al máximo de ${MAX_TOTAL_PER_USER} operaciones.` };
  // The server's clock says when it was opened, and prices count only from the next whole minute:
  // a browser cannot backdate a trade into a move it already saw.
  const inicio = Math.max(t.vela + 3_600_000, nextMinute(now));
  const trade: PaperTrade = { ...t, abiertaA: now, inicio, cursor: inicio, revisadaHasta: null, mfeR: t.estado === "ABIERTA" ? 0 : null, maeR: t.estado === "ABIERTA" ? 0 : null };
  // A market trade fills at its first price after opening (lib/jarvis-paper.ts): it starts pending.
  if (trade.tipoEntrada === "MERCADO" && trade.estado === "ABIERTA") Object.assign(trade, { estado: "PENDIENTE", llenadaA: null, entradaReal: null, mfeR: null, maeR: null });
  const ins = await db
    .prepare("INSERT OR IGNORE INTO jarvis_paper (user_id, id, symbol, estado, abierta_a, data) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(userId, trade.id, trade.symbol, trade.estado, trade.abiertaA, JSON.stringify(trade))
    .run();
  if ((ins.meta?.changes ?? 0) === 0) return { ok: false, status: 409, error: "Ya estás siguiendo este plan en papel." };
  await db
    .prepare("INSERT INTO jarvis_paper_counts (user_id, total, abiertas) VALUES (?, 1, 1) ON CONFLICT(user_id) DO UPDATE SET total = total + 1, abiertas = abiertas + 1")
    .bind(userId)
    .run();
  return { ok: true, trade };
}

const FROZEN = ["id", "symbol", "lado", "abiertaA", "vela", "tipoEntrada", "entrada", "stop", "tp", "rrPlan", "confianza", "analisis", "decision", "inicio"] as const;
const ORDER: Record<PaperState, number> = { PENDIENTE: 0, ABIERTA: 1, CERRADA: 2, CANCELADA: 2 };

/**
 * El progreso de una operación ya guardada, si es un avance legítimo: el
 * plan igual, el estado hacia adelante, las salidas anteriores intactas.
 */
export function mergeProgress(stored: PaperTrade, incoming: PaperTrade, now: number): PaperTrade | null {
  if (!isLive(stored.estado)) return null;
  // The plan is frozen: a different one is a rejected update, not one quietly ignored.
  for (const k of FROZEN) if (JSON.stringify(incoming[k]) !== JSON.stringify(stored[k])) return null;
  if (ORDER[incoming.estado] < ORDER[stored.estado]) return null;
  if (stored.estado === "ABIERTA" && incoming.estado === "CANCELADA") return null;
  if (incoming.salidas.length < stored.salidas.length) return null;
  for (let i = 0; i < stored.salidas.length; i += 1) {
    const a = stored.salidas[i];
    const b = incoming.salidas[i];
    if (a.kind !== b.kind || a.price !== b.price || a.at !== b.at || Math.abs(a.fraction - b.fraction) > 1e-9) return null;
  }
  // The real entry is set once, when it fills, and never changes after.
  const storedReal = typeof stored.entradaReal === "number" ? stored.entradaReal : null;
  const incomingReal = typeof incoming.entradaReal === "number" ? incoming.entradaReal : null;
  if (storedReal !== null && incomingReal !== storedReal) return null;
  // What was already checked stays checked.
  if (cursorOf(incoming) < cursorOf(stored)) return null;
  const merged: PaperTrade = {
    ...stored,
    estado: incoming.estado,
    salidas: incoming.salidas,
    llenadaA: incoming.llenadaA,
    cerradaA: incoming.cerradaA,
    mfeR: incoming.mfeR,
    maeR: incoming.maeR,
    revisadaHasta: incoming.revisadaHasta,
    fuenteVelas: incoming.fuenteVelas,
    motivoCierre: incoming.motivoCierre,
    ...(incoming.cursor !== undefined ? { cursor: incoming.cursor } : {}),
    ...(incomingReal !== null ? { entradaReal: incomingReal } : {}),
  };
  const at = [merged.llenadaA, merged.cerradaA, merged.revisadaHasta, ...merged.salidas.map((e) => e.at)].filter((v): v is number => v !== null);
  if (at.some((v) => v > now + 60_000 || v < stored.vela)) return null;
  // Re-validated as a whole: the exits at the plan's prices, the result recomputed here.
  return validatePaper(merged, now);
}

export type UpdateResult = { saved: PaperTrade[]; rejected: string[] };

/** Guarda el avance de varias operaciones; las que no son un avance legítimo se rechazan. */
export async function updatePaper(db: D1Database, userId: number, incoming: unknown[], now: number): Promise<UpdateResult> {
  const saved: PaperTrade[] = [];
  const rejected: string[] = [];
  let closedNow = 0;
  for (const raw of incoming) {
    const t = validatePaper(raw, now);
    const id = typeof (raw as { id?: unknown })?.id === "string" ? (raw as { id: string }).id : "?";
    if (!t) {
      rejected.push(id);
      continue;
    }
    const row = await db.prepare("SELECT data FROM jarvis_paper WHERE user_id = ? AND id = ?").bind(userId, t.id).first<{ data: string }>();
    let stored: PaperTrade | null = null;
    try {
      stored = row ? (JSON.parse(row.data) as PaperTrade) : null;
    } catch {
      stored = null;
    }
    const merged = stored ? mergeProgress(stored, t, now) : null;
    if (!stored || !merged) {
      rejected.push(t.id);
      continue;
    }
    await db.prepare("UPDATE jarvis_paper SET estado = ?, data = ? WHERE user_id = ? AND id = ?").bind(merged.estado, JSON.stringify(merged), userId, t.id).run();
    if (isLive(stored.estado) && !isLive(merged.estado)) closedNow += 1;
    saved.push(merged);
  }
  if (closedNow) {
    await db.prepare("UPDATE jarvis_paper_counts SET abiertas = MAX(0, abiertas - ?) WHERE user_id = ?").bind(closedNow, userId).run();
  }
  return { saved, rejected };
}
