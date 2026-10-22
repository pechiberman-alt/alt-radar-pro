/**
 * La base de las señales de BYMA del servidor (lib/ar-senales.ts): una tabla global con índice por papel y estado (las
 * abiertas) y por fuente y fecha (el registro), el estado de cada papel en su última lectura (para saber si «entró» a la zona
 * de Fibonacci y para decir si Yahoo no respondió) y los avisos para Telegram. Todo con tope.
 */
import type { Recorrido } from "./escalera.ts";
import { PLAN_AR, type AbiertaAr, type AvisoAr, type EntradaAr, type FuenteAr } from "./ar-senales.ts";

const listo = new WeakSet<D1Database>();

export async function ensureArSenales(db: D1Database) {
  if (listo.has(db)) return;
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS ar_senales (
        clave TEXT PRIMARY KEY, fuente TEXT NOT NULL, estrategia TEXT NOT NULL, ticker TEXT NOT NULL, vela INTEGER NOT NULL,
        detectada INTEGER NOT NULL, entrada REAL NOT NULL, sl REAL NOT NULL, tp1 REAL NOT NULL, tp2 REAL NOT NULL, tp3 REAL NOT NULL,
        huella TEXT, detalle TEXT NOT NULL, plan TEXT NOT NULL,
        sl_at INTEGER, tp1_at INTEGER, tp2_at INTEGER, tp3_at INTEGER,
        desenlace TEXT NOT NULL DEFAULT 'ABIERTA', cerrada INTEGER, salida REAL, r REAL)`,
    ),
    db.prepare("CREATE INDEX IF NOT EXISTS ar_senales_abiertas ON ar_senales (ticker, desenlace)"),
    db.prepare("CREATE INDEX IF NOT EXISTS ar_senales_fuente ON ar_senales (fuente, detectada)"),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS ar_estado (
        ticker TEXT PRIMARY KEY, at INTEGER NOT NULL, vela INTEGER, fib TEXT, veredicto TEXT, huella TEXT, registradas INTEGER NOT NULL, avanzadas INTEGER NOT NULL, error TEXT)`,
    ),
    db.prepare("CREATE TABLE IF NOT EXISTS ar_lectura (ticker TEXT PRIMARY KEY, at INTEGER NOT NULL, json TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS ar_avisos (clave TEXT PRIMARY KEY, ticker TEXT NOT NULL, at INTEGER NOT NULL, texto TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS ar_avisos_at ON ar_avisos (at)"),
  ]);
  listo.add(db);
}

/** Guarda las entradas nuevas; una clave que ya existe no se reescribe. Devuelve cuántas eran nuevas (para avisar solo esas). */
export async function registrarAr(db: D1Database, entradas: EntradaAr[]): Promise<EntradaAr[]> {
  if (!entradas.length) return [];
  await ensureArSenales(db);
  const res = await db.batch(
    entradas.map((e) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO ar_senales (clave, fuente, estrategia, ticker, vela, detectada, entrada, sl, tp1, tp2, tp3, huella, detalle, plan)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
        )
        .bind(e.clave, e.fuente, e.estrategia, e.ticker, e.vela, e.detectada, e.entrada, e.escalera.stop, e.escalera.tp1, e.escalera.tp2, e.escalera.tp3, e.huella, e.detalle.slice(0, 400), PLAN_AR),
    ),
  );
  return entradas.filter((_, k) => (res[k]?.meta.changes ?? 0) > 0);
}

export async function abiertasAr(db: D1Database, ticker: string, limite = 100): Promise<AbiertaAr[]> {
  await ensureArSenales(db);
  return (
    await db
      .prepare("SELECT clave, vela, entrada, sl, tp1, tp2, tp3, tp1_at, tp2_at FROM ar_senales WHERE ticker = ?1 AND desenlace = 'ABIERTA' LIMIT ?2")
      .bind(ticker, limite)
      .all<AbiertaAr>()
  ).results;
}

/** Graba los avances. Solo toca filas abiertas: lo cerrado no se reescribe. */
export async function avanzarAr(db: D1Database, avances: { clave: string; recorrido: Recorrido }[]): Promise<number> {
  if (!avances.length) return 0;
  await ensureArSenales(db);
  const res = await db.batch(
    avances.map(({ clave, recorrido: x }) =>
      db
        .prepare(
          `UPDATE ar_senales SET sl_at = ?2, tp1_at = COALESCE(tp1_at, ?3), tp2_at = COALESCE(tp2_at, ?4), tp3_at = ?5,
             desenlace = ?6, cerrada = ?7, salida = ?8, r = ?9 WHERE clave = ?1 AND desenlace = 'ABIERTA'`,
        )
        .bind(clave, x.slAt, x.tp1At, x.tp2At, x.tp3At, x.desenlace, x.cerradaA, x.salida, x.r),
    ),
  );
  return res.reduce((s, r) => s + (r.meta.changes ?? 0), 0);
}

export type EstadoAr = { ticker: string; at: number; vela: number | null; fib: string | null; veredicto: string | null; huella: string | null; registradas: number; avanzadas: number; error: string | null };

export async function estadoArDe(db: D1Database, ticker: string): Promise<EstadoAr | null> {
  await ensureArSenales(db);
  return db.prepare("SELECT ticker, at, vela, fib, veredicto, huella, registradas, avanzadas, error FROM ar_estado WHERE ticker = ?1").bind(ticker).first<EstadoAr>();
}

/** Guarda la lectura de hoy. Si Yahoo no respondió, guarda el motivo y conserva el estado de Fibonacci anterior. */
export async function guardarEstadoAr(db: D1Database, e: EstadoAr) {
  await ensureArSenales(db);
  await db
    .prepare(
      `INSERT INTO ar_estado (ticker, at, vela, fib, veredicto, huella, registradas, avanzadas, error) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT(ticker) DO UPDATE SET at = ?2, vela = COALESCE(?3, vela), fib = COALESCE(?4, fib), veredicto = COALESCE(?5, veredicto),
         huella = COALESCE(?6, huella), registradas = ?7, avanzadas = ?8, error = ?9`,
    )
    .bind(e.ticker, e.at, e.vela, e.fib, e.veredicto, e.huella, e.registradas, e.avanzadas, e.error)
    .run();
}

/** La lectura resumida de un papel (la que le llega a JARVIS): una fila por papel, se reescribe en cada rueda. */
export async function guardarLecturaAr(db: D1Database, ticker: string, at: number, json: string) {
  await ensureArSenales(db);
  await db.prepare("INSERT INTO ar_lectura (ticker, at, json) VALUES (?1, ?2, ?3) ON CONFLICT(ticker) DO UPDATE SET at = ?2, json = ?3").bind(ticker, at, json).run();
}

export async function leerLecturaAr(db: D1Database, ticker: string): Promise<{ at: number; json: string } | null> {
  await ensureArSenales(db);
  return db.prepare("SELECT at, json FROM ar_lectura WHERE ticker = ?1").bind(ticker).first<{ at: number; json: string }>();
}

export async function estadosAr(db: D1Database): Promise<EstadoAr[]> {
  await ensureArSenales(db);
  return (await db.prepare("SELECT ticker, at, vela, fib, veredicto, huella, registradas, avanzadas, error FROM ar_estado LIMIT 60").all<EstadoAr>()).results;
}

export async function guardarAvisosAr(db: D1Database, avisos: AvisoAr[], ahora: number) {
  if (!avisos.length) return;
  await ensureArSenales(db);
  await db.batch([
    ...avisos.map((a) => db.prepare("INSERT OR IGNORE INTO ar_avisos (clave, ticker, at, texto) VALUES (?1, ?2, ?3, ?4)").bind(a.clave, a.ticker, ahora, a.texto.slice(0, 1500))),
    db.prepare("DELETE FROM ar_avisos WHERE at < ?1").bind(ahora - 30 * 86_400_000),
  ]);
}

/** Los avisos de las últimas 24 horas (para el despacho de Telegram). */
export async function avisosRecientesAr(db: D1Database, ahora: number): Promise<AvisoAr[]> {
  await ensureArSenales(db);
  return (await db.prepare("SELECT clave, ticker, texto FROM ar_avisos WHERE at > ?1 ORDER BY at DESC LIMIT 20").bind(ahora - 86_400_000).all<AvisoAr>()).results;
}

/** Las últimas entradas de una fuente, por fecha y con tope (registro y oficina). */
export async function filasAr(db: D1Database, fuente: FuenteAr, limite: number) {
  await ensureArSenales(db);
  return (
    await db
      .prepare("SELECT clave, ticker, estrategia, r, desenlace, cerrada, detectada FROM ar_senales WHERE fuente = ?1 ORDER BY detectada DESC LIMIT ?2")
      .bind(fuente, limite)
      .all<{ clave: string; ticker: string; estrategia: string; r: number | null; desenlace: string; cerrada: number | null; detectada: number }>()
  ).results;
}
