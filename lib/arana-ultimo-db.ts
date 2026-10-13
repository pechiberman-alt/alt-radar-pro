/**
 * La tabla del último escaneo de la araña: una fila por cuenta, leída y escrita por clave primaria (una lectura de
 * D1 al entrar, una escritura por escaneo completo). Se crea sola al primer uso. Acá no se decide nada: solo se guarda
 * y se lee lo que ya pasó por lib/arana-ultimo.ts.
 */
import { aceptarUltimo } from "./arana-ultimo.ts";
import type { ScanResult } from "./jarvis-scan.ts";

const ready = new WeakSet<D1Database>();

export async function ensureUltimoSchema(db: D1Database) {
  if (ready.has(db)) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS arana_ultimo (
      user_id INTEGER PRIMARY KEY,
      at INTEGER NOT NULL,
      json TEXT NOT NULL
    )`,
  ).run();
  ready.add(db);
}

/** El último escaneo completo de esta cuenta, o null si nunca hubo uno (o el guardado ya no tiene forma de escaneo). */
export async function leerUltimo(db: D1Database, userId: number): Promise<ScanResult | null> {
  const row = await db.prepare("SELECT json FROM arana_ultimo WHERE user_id = ? LIMIT 1").bind(userId).first<{ json: string }>();
  if (!row) return null;
  try {
    return aceptarUltimo(JSON.parse(row.json));
  } catch {
    return null;
  }
}

/** Reemplaza el guardado de la cuenta. `json` ya viene validado y con tope (lib/arana-ultimo.ts). */
export async function guardarUltimo(db: D1Database, userId: number, r: ScanResult, json: string) {
  await db
    .prepare("INSERT INTO arana_ultimo (user_id, at, json) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET at = excluded.at, json = excluded.json")
    .bind(userId, r.at, json)
    .run();
}
