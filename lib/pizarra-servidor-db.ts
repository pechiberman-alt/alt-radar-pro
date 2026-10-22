/**
 * La base de la pizarra de cripto del servidor (lib/pizarra-servidor.ts): una tabla global de decisiones registradas, con
 * índice por moneda y estado (las abiertas) y por fecha (registro), y el estado de la última discusión de cada moneda (para
 * HOY y para decir si Kraken no respondió). Todo con tope.
 */
import type { Recorrido } from "./escalera.ts";
import { PLAN_PIZARRA, type AbiertaPizarra, type EntradaPizarra } from "./pizarra-servidor.ts";

const listo = new WeakSet<D1Database>();

export async function ensurePizarraCripto(db: D1Database) {
  if (listo.has(db)) return;
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS pizarra_cripto (
        clave TEXT PRIMARY KEY, symbol TEXT NOT NULL, lado TEXT NOT NULL, vela INTEGER NOT NULL, detectada INTEGER NOT NULL,
        entrada REAL NOT NULL, sl REAL NOT NULL, tp1 REAL NOT NULL, tp2 REAL NOT NULL, tp3 REAL NOT NULL,
        huella TEXT NOT NULL, detalle TEXT NOT NULL, plan TEXT NOT NULL, venue TEXT NOT NULL,
        sl_at INTEGER, tp1_at INTEGER, tp2_at INTEGER, tp3_at INTEGER,
        desenlace TEXT NOT NULL DEFAULT 'ABIERTA', cerrada INTEGER, salida REAL, r REAL)`,
    ),
    db.prepare("CREATE INDEX IF NOT EXISTS pizarra_cripto_abiertas ON pizarra_cripto (symbol, desenlace)"),
    db.prepare("CREATE INDEX IF NOT EXISTS pizarra_cripto_reciente ON pizarra_cripto (detectada)"),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS pizarra_cripto_estado (
        symbol TEXT PRIMARY KEY, at INTEGER NOT NULL, veredicto TEXT, razon TEXT, lado TEXT, huella TEXT, registrada INTEGER NOT NULL, avanzadas INTEGER NOT NULL, venue TEXT, error TEXT)`,
    ),
  ]);
  listo.add(db);
}

/** Guarda la decisión si es nueva (la misma vela y lado no se reescriben). Devuelve si se guardó. */
export async function registrarPizarra(db: D1Database, e: EntradaPizarra, venue: string): Promise<boolean> {
  await ensurePizarraCripto(db);
  const r = await db
    .prepare(
      `INSERT OR IGNORE INTO pizarra_cripto (clave, symbol, lado, vela, detectada, entrada, sl, tp1, tp2, tp3, huella, detalle, plan, venue)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
    )
    .bind(e.clave, e.symbol, e.lado, e.vela, e.detectada, e.entrada, e.escalera.stop, e.escalera.tp1, e.escalera.tp2, e.escalera.tp3, e.huella, e.detalle, PLAN_PIZARRA, venue)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

export async function abiertasPizarra(db: D1Database, symbol: string, limite = 50): Promise<AbiertaPizarra[]> {
  await ensurePizarraCripto(db);
  return (
    await db
      .prepare("SELECT clave, lado, vela, entrada, sl, tp1, tp2, tp3, tp1_at, tp2_at FROM pizarra_cripto WHERE symbol = ?1 AND desenlace = 'ABIERTA' LIMIT ?2")
      .bind(symbol, limite)
      .all<AbiertaPizarra>()
  ).results;
}

export async function avanzarPizarra(db: D1Database, avances: { clave: string; recorrido: Recorrido }[]): Promise<number> {
  if (!avances.length) return 0;
  await ensurePizarraCripto(db);
  const res = await db.batch(
    avances.map(({ clave, recorrido: x }) =>
      db
        .prepare(
          `UPDATE pizarra_cripto SET sl_at = ?2, tp1_at = COALESCE(tp1_at, ?3), tp2_at = COALESCE(tp2_at, ?4), tp3_at = ?5,
             desenlace = ?6, cerrada = ?7, salida = ?8, r = ?9 WHERE clave = ?1 AND desenlace = 'ABIERTA'`,
        )
        .bind(clave, x.slAt, x.tp1At, x.tp2At, x.tp3At, x.desenlace, x.cerradaA, x.salida, x.r),
    ),
  );
  return res.reduce((s, r) => s + (r.meta.changes ?? 0), 0);
}

export type EstadoPizarra = { symbol: string; at: number; veredicto: string | null; razon: string | null; lado: string | null; huella: string | null; registrada: number; avanzadas: number; venue: string | null; error: string | null };

export async function guardarEstadoPizarra(db: D1Database, e: EstadoPizarra) {
  await ensurePizarraCripto(db);
  await db
    .prepare(
      `INSERT INTO pizarra_cripto_estado (symbol, at, veredicto, razon, lado, huella, registrada, avanzadas, venue, error) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT(symbol) DO UPDATE SET at = ?2, veredicto = ?3, razon = ?4, lado = ?5, huella = ?6, registrada = ?7, avanzadas = ?8, venue = ?9, error = ?10`,
    )
    .bind(e.symbol, e.at, e.veredicto, e.razon, e.lado, e.huella, e.registrada, e.avanzadas, e.venue, e.error)
    .run();
}

export async function estadosPizarra(db: D1Database): Promise<EstadoPizarra[]> {
  await ensurePizarraCripto(db);
  return (await db.prepare("SELECT symbol, at, veredicto, razon, lado, huella, registrada, avanzadas, venue, error FROM pizarra_cripto_estado LIMIT 30").all<EstadoPizarra>()).results;
}

/** Las últimas decisiones registradas, por fecha y con tope (registro). */
export async function filasPizarra(db: D1Database, limite: number) {
  await ensurePizarraCripto(db);
  return (
    await db
      .prepare("SELECT clave, symbol, lado, r, desenlace, cerrada, detectada FROM pizarra_cripto ORDER BY detectada DESC LIMIT ?1")
      .bind(limite)
      .all<{ clave: string; symbol: string; lado: string; r: number | null; desenlace: string; cerrada: number | null; detectada: number }>()
  ).results;
}
