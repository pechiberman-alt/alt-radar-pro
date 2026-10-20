/**
 * La base de los agentes de papel del servidor (PLAN_SERVIDOR_1, lib/agentes-servidor.ts): una tabla global (no es de ninguna
 * cuenta), con índice por moneda y estado para leer las abiertas, y por fecha para la oficina y el registro. Todo con tope.
 * También guarda cómo salió la última corrida de cada moneda, para decir si Kraken no respondió en vez de mostrar un cero.
 */
import type { Recorrido } from "./escalera.ts";
import { PLAN_SERVIDOR, type AbiertaServidor, type EntradaServidor } from "./agentes-servidor.ts";

const listo = new WeakSet<D1Database>();

export async function ensureAgentesServidor(db: D1Database) {
  if (listo.has(db)) return;
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS agentes_servidor (
        clave TEXT PRIMARY KEY, estrategia TEXT NOT NULL, symbol TEXT NOT NULL, lado TEXT NOT NULL, vela INTEGER NOT NULL,
        detectada INTEGER NOT NULL, entrada REAL NOT NULL, sl REAL NOT NULL, tp1 REAL NOT NULL, tp2 REAL NOT NULL, tp3 REAL NOT NULL,
        venue TEXT NOT NULL, foto TEXT NOT NULL, plan TEXT NOT NULL,
        sl_at INTEGER, tp1_at INTEGER, tp2_at INTEGER, tp3_at INTEGER,
        desenlace TEXT NOT NULL DEFAULT 'ABIERTA', cerrada INTEGER, salida REAL, r REAL)`,
    ),
    db.prepare("CREATE INDEX IF NOT EXISTS agentes_servidor_abiertas ON agentes_servidor (symbol, desenlace)"),
    db.prepare("CREATE INDEX IF NOT EXISTS agentes_servidor_reciente ON agentes_servidor (detectada)"),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS agentes_servidor_estado (
        symbol TEXT PRIMARY KEY, at INTEGER NOT NULL, venue TEXT, registradas INTEGER NOT NULL, avanzadas INTEGER NOT NULL, error TEXT)`,
    ),
  ]);
  listo.add(db);
}

/** Guarda las entradas nuevas; una clave que ya existe no se reescribe. Devuelve cuántas eran nuevas. */
export async function registrarServidor(db: D1Database, entradas: EntradaServidor[]): Promise<number> {
  if (!entradas.length) return 0;
  await ensureAgentesServidor(db);
  const res = await db.batch(
    entradas.map((e) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO agentes_servidor (clave, estrategia, symbol, lado, vela, detectada, entrada, sl, tp1, tp2, tp3, venue, foto, plan)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
        )
        .bind(e.clave, e.estrategia, e.symbol, e.lado, e.vela, e.detectada, e.entrada, e.stop, e.tp1, e.tp2, e.tp3, e.venue, JSON.stringify(e.consenso), PLAN_SERVIDOR),
    ),
  );
  return res.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
}

export async function abiertasServidor(db: D1Database, symbol: string, limite = 200): Promise<AbiertaServidor[]> {
  await ensureAgentesServidor(db);
  return (
    await db
      .prepare("SELECT clave, lado, vela, entrada, sl, tp1, tp2, tp3, tp1_at, tp2_at FROM agentes_servidor WHERE symbol = ?1 AND desenlace = 'ABIERTA' LIMIT ?2")
      .bind(symbol, limite)
      .all<AbiertaServidor>()
  ).results;
}

/** Graba los avances. Solo toca filas abiertas: lo cerrado no se reescribe. */
export async function avanzarServidor(db: D1Database, avances: { clave: string; recorrido: Recorrido }[]): Promise<number> {
  if (!avances.length) return 0;
  await ensureAgentesServidor(db);
  const res = await db.batch(
    avances.map(({ clave, recorrido: x }) =>
      db
        .prepare(
          `UPDATE agentes_servidor SET sl_at = ?2, tp1_at = COALESCE(tp1_at, ?3), tp2_at = COALESCE(tp2_at, ?4), tp3_at = ?5,
             desenlace = ?6, cerrada = ?7, salida = ?8, r = ?9 WHERE clave = ?1 AND desenlace = 'ABIERTA'`,
        )
        .bind(clave, x.slAt, x.tp1At, x.tp2At, x.tp3At, x.desenlace, x.cerradaA, x.salida, x.r),
    ),
  );
  return res.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
}

export async function guardarEstadoServidor(db: D1Database, e: { symbol: string; at: number; venue: string | null; registradas: number; avanzadas: number; error: string | null }) {
  await ensureAgentesServidor(db);
  await db
    .prepare(
      `INSERT INTO agentes_servidor_estado (symbol, at, venue, registradas, avanzadas, error) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(symbol) DO UPDATE SET at = ?2, venue = ?3, registradas = ?4, avanzadas = ?5, error = ?6`,
    )
    .bind(e.symbol, e.at, e.venue, e.registradas, e.avanzadas, e.error)
    .run();
}

export type EstadoServidor = { symbol: string; at: number; venue: string | null; registradas: number; avanzadas: number; error: string | null };

export async function estadoServidor(db: D1Database): Promise<EstadoServidor[]> {
  await ensureAgentesServidor(db);
  return (await db.prepare("SELECT symbol, at, venue, registradas, avanzadas, error FROM agentes_servidor_estado LIMIT 20").all<EstadoServidor>()).results;
}

/** Las últimas entradas de todos los agentes del servidor, por fecha y con tope (oficina y registro). */
export async function filasServidor(db: D1Database, limite: number) {
  await ensureAgentesServidor(db);
  return (
    await db
      .prepare("SELECT clave, symbol, lado, r, desenlace, cerrada, detectada, foto FROM agentes_servidor ORDER BY detectada DESC LIMIT ?1")
      .bind(limite)
      .all<{ clave: string; symbol: string; lado: string; r: number | null; desenlace: string; cerrada: number | null; detectada: number; foto: string | null }>()
  ).results;
}
