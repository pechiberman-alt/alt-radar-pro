/**
 * Las operaciones del flujo de órdenes, por cuenta: una fila por lectura (clave única por símbolo, lado y media hora),
 * con su plan fijado al detectarla y su resultado cuando el navegador la mide con las velas (lib/flujo.ts). La tabla
 * sigue el mismo diseño que la del robot: se escribe una vez, y el resultado solo se graba si la fila sigue abierta.
 */
import type { Lado } from "./escalera.ts";
import { validarRecorridoFlujo, type LecturaFlujo, type RecorridoFlujo, PLAN_FLUJO } from "./flujo.ts";

export const LISTA_FLUJO = 50;

const listo = new WeakSet<object>();

export async function ensureFlujo(db: D1Database) {
  if (listo.has(db)) return;
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS flujo_senales (
        user_id INTEGER NOT NULL, clave TEXT NOT NULL, symbol TEXT NOT NULL, lado TEXT NOT NULL, marco TEXT NOT NULL,
        vela INTEGER NOT NULL, detectada INTEGER NOT NULL, entrada REAL NOT NULL, sl REAL NOT NULL,
        tp1 REAL NOT NULL, tp2 REAL NOT NULL, tp3 REAL NOT NULL, lectura TEXT NOT NULL, puntaje REAL NOT NULL, plan TEXT NOT NULL,
        sl_at INTEGER, tp1_at INTEGER, tp2_at INTEGER, tp3_at INTEGER,
        desenlace TEXT NOT NULL DEFAULT 'ABIERTA', cerrada INTEGER, salida REAL, r REAL,
        PRIMARY KEY (user_id, clave))`,
    ),
    db.prepare("CREATE INDEX IF NOT EXISTS flujo_senales_reciente ON flujo_senales (user_id, detectada)"),
  ]);
  listo.add(db);
}

export type FilaFlujo = { clave: string; symbol: string; lado: Lado; vela: number; entrada: number; sl: number; tp1: number; tp2: number; tp3: number; detectada: number };

/**
 * Guarda una lectura nueva. Una clave que ya existe (la misma media hora, símbolo y lado) no se vuelve a escribir.
 * Devuelve true solo si la fila es nueva.
 */
export async function registrarLecturaFlujo(db: D1Database, userId: number, l: LecturaFlujo): Promise<boolean> {
  await ensureFlujo(db);
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO flujo_senales (user_id, clave, symbol, lado, marco, vela, detectada, entrada, sl, tp1, tp2, tp3, lectura, puntaje, plan)
       VALUES (?1, ?2, ?3, ?4, '5m', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
    )
    .bind(userId, l.clave, l.symbol, l.lado, l.vela, l.detectada, l.entrada, l.stop, l.tp1, l.tp2, l.tp3, l.lectura, l.puntaje, PLAN_FLUJO)
    .run();
  return res.meta.changes === 1;
}

/** Las lecturas que siguen abiertas, para que el navegador las mida. Por índice y con tope. */
export async function abiertasFlujo(db: D1Database, userId: number): Promise<FilaFlujo[]> {
  await ensureFlujo(db);
  const rows = (
    await db
      .prepare(
        `SELECT clave, symbol, lado, vela, entrada, sl, tp1, tp2, tp3, detectada FROM flujo_senales
          WHERE user_id = ?1 AND desenlace = 'ABIERTA' ORDER BY detectada DESC LIMIT ?2`,
      )
      .bind(userId, LISTA_FLUJO)
      .all<FilaFlujo>()
  ).results;
  return rows;
}

export type ResultadoEvaluacion = { clave: string; ok: boolean; error?: string };

/**
 * Graba los recorridos que midió el navegador. Solo cambia filas que siguen abiertas: una medición se escribe una vez.
 */
export async function evaluarFlujo(db: D1Database, userId: number, raw: unknown): Promise<ResultadoEvaluacion[]> {
  await ensureFlujo(db);
  if (!Array.isArray(raw)) return [];
  const out: ResultadoEvaluacion[] = [];
  for (const item of raw.slice(0, LISTA_FLUJO) as { clave?: unknown; recorrido?: unknown }[]) {
    const clave = typeof item?.clave === "string" ? item.clave.slice(0, 120) : "";
    const fila = clave
      ? await db
          .prepare("SELECT vela, lado, entrada, sl, tp3 FROM flujo_senales WHERE user_id = ?1 AND clave = ?2 AND desenlace = 'ABIERTA' LIMIT 1")
          .bind(userId, clave)
          .first<{ vela: number; lado: Lado; entrada: number; sl: number; tp3: number }>()
      : null;
    if (!fila) {
      out.push({ clave, ok: false, error: "No está abierta en tu registro." });
      continue;
    }
    const v = validarRecorridoFlujo({ lado: fila.lado, vela: fila.vela, entrada: fila.entrada, stop: fila.sl, tp3: fila.tp3 }, item.recorrido, Date.now());
    if (!v.ok) {
      out.push({ clave, ok: false, error: v.error });
      continue;
    }
    await escribirRecorrido(db, userId, clave, v.recorrido);
    out.push({ clave, ok: true });
  }
  return out;
}

async function escribirRecorrido(db: D1Database, userId: number, clave: string, n: RecorridoFlujo) {
  await db
    .prepare(
      `UPDATE flujo_senales SET sl_at = ?1, tp1_at = ?2, tp2_at = ?3, tp3_at = ?4, desenlace = ?5, cerrada = ?6, salida = ?7, r = ?8
        WHERE user_id = ?9 AND clave = ?10 AND desenlace = 'ABIERTA'`,
    )
    .bind(n.slAt, n.tp1At, n.tp2At, n.tp3At, n.desenlace, n.cerradaA, n.salida, n.r, userId, clave)
    .run();
}

/** Los resultados de la cuenta para el registro unificado: abiertas y cerradas con su R, por índice y con tope. */
export async function resultadosFlujo(db: D1Database, userId: number, limite: number) {
  await ensureFlujo(db);
  return (
    await db
      .prepare("SELECT r, desenlace, cerrada, detectada FROM flujo_senales WHERE user_id = ?1 ORDER BY detectada DESC LIMIT ?2")
      .bind(userId, limite)
      .all<{ r: number | null; desenlace: string; cerrada: number | null; detectada: number | null }>()
  ).results;
}
