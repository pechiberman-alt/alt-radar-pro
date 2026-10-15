/**
 * Las entradas del agente de papel Supertrend MTF + Volumen (lib/agente-st.ts), por cuenta: una fila por moneda y vela de
 * señal (clave única), con su plan fijado al detectarla, su foto de condiciones y su resultado cuando el navegador la mide
 * con las velas. Mismo diseño que la tabla del flujo: se escribe una vez, y el resultado solo se graba si la fila sigue abierta.
 */
import type { Lado } from "./escalera.ts";
import { validarRecorridoFlujo, type RecorridoFlujo } from "./flujo.ts";
import { COMISION_ST_PCT, PLAN_ST, type SenalSt } from "./agente-st.ts";
import { PLAN_AGENTES, type SenalPapel } from "./agentes-papel.ts";

export const LISTA_ST = 50;

const listo = new WeakSet<object>();

export async function ensureAgenteSt(db: D1Database) {
  if (listo.has(db)) return;
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS agente_st_senales (
        user_id INTEGER NOT NULL, clave TEXT NOT NULL, symbol TEXT NOT NULL, lado TEXT NOT NULL, marco TEXT NOT NULL,
        vela INTEGER NOT NULL, detectada INTEGER NOT NULL, entrada REAL NOT NULL, sl REAL NOT NULL,
        tp1 REAL NOT NULL, tp2 REAL NOT NULL, tp3 REAL NOT NULL, foto TEXT NOT NULL, plan TEXT NOT NULL,
        sl_at INTEGER, tp1_at INTEGER, tp2_at INTEGER, tp3_at INTEGER,
        desenlace TEXT NOT NULL DEFAULT 'ABIERTA', cerrada INTEGER, salida REAL, r REAL,
        PRIMARY KEY (user_id, clave))`,
    ),
    db.prepare("CREATE INDEX IF NOT EXISTS agente_st_senales_reciente ON agente_st_senales (user_id, detectada)"),
  ]);
  listo.add(db);
}

export type FilaSt = { clave: string; symbol: string; lado: Lado; vela: number; entrada: number; sl: number; tp1: number; tp2: number; tp3: number; detectada: number };

/** Guarda una entrada nueva. Una clave que ya existe no se vuelve a escribir. Devuelve true solo si la fila es nueva. */
export async function registrarSenalSt(db: D1Database, userId: number, s: SenalSt): Promise<boolean> {
  await ensureAgenteSt(db);
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO agente_st_senales (user_id, clave, symbol, lado, marco, vela, detectada, entrada, sl, tp1, tp2, tp3, foto, plan)
       VALUES (?1, ?2, ?3, ?4, '4h', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    )
    .bind(userId, s.clave, s.symbol, s.lado, s.vela, s.detectada, s.entrada, s.stop, s.tp1, s.tp2, s.tp3, JSON.stringify(s.foto), PLAN_ST)
    .run();
  return res.meta.changes === 1;
}

/**
 * Guarda la entrada de un agente del estudio que corre hacia adelante (PLAN_AGENTES_1). Misma tabla, mismo marco y misma
 * comisión que el agente ST: lo que cambia es la regla, y eso queda en la clave y en el plan. Su foto guarda el consenso
 * (con qué otros agentes coincidió, lib/consenso.ts): no filtra nada, sirve para estudiar después si coincidir separa las
 * ganadoras de las perdedoras.
 */
export async function registrarSenalPapel(db: D1Database, userId: number, s: SenalPapel): Promise<boolean> {
  await ensureAgenteSt(db);
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO agente_st_senales (user_id, clave, symbol, lado, marco, vela, detectada, entrada, sl, tp1, tp2, tp3, foto, plan)
       VALUES (?1, ?2, ?3, ?4, '4h', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    )
    .bind(userId, s.clave, s.symbol, s.lado, s.vela, s.detectada, s.entrada, s.stop, s.tp1, s.tp2, s.tp3, JSON.stringify(s.consenso ?? {}), PLAN_AGENTES)
    .run();
  return res.meta.changes === 1;
}

/** Las entradas que siguen abiertas, para que el navegador las mida. Por índice y con tope. */
export async function abiertasSt(db: D1Database, userId: number): Promise<FilaSt[]> {
  await ensureAgenteSt(db);
  return (
    await db
      .prepare(
        `SELECT clave, symbol, lado, vela, entrada, sl, tp1, tp2, tp3, detectada FROM agente_st_senales
          WHERE user_id = ?1 AND desenlace = 'ABIERTA' ORDER BY detectada DESC LIMIT ?2`,
      )
      .bind(userId, LISTA_ST)
      .all<FilaSt>()
  ).results;
}

export type ResultadoSt = { clave: string; ok: boolean; error?: string };

/** Graba los recorridos que midió el navegador. Solo cambia filas abiertas; el R lo calcula el servidor con la comisión de la regla. */
export async function evaluarSt(db: D1Database, userId: number, raw: unknown): Promise<ResultadoSt[]> {
  await ensureAgenteSt(db);
  if (!Array.isArray(raw)) return [];
  const out: ResultadoSt[] = [];
  for (const item of raw.slice(0, LISTA_ST) as { clave?: unknown; recorrido?: unknown }[]) {
    const clave = typeof item?.clave === "string" ? item.clave.slice(0, 120) : "";
    const fila = clave
      ? await db
          .prepare("SELECT vela, lado, entrada, sl, tp3 FROM agente_st_senales WHERE user_id = ?1 AND clave = ?2 AND desenlace = 'ABIERTA' LIMIT 1")
          .bind(userId, clave)
          .first<{ vela: number; lado: Lado; entrada: number; sl: number; tp3: number }>()
      : null;
    if (!fila) {
      out.push({ clave, ok: false, error: "No está abierta en tu registro." });
      continue;
    }
    const v = validarRecorridoFlujo({ lado: fila.lado, vela: fila.vela, entrada: fila.entrada, stop: fila.sl, tp3: fila.tp3 }, item.recorrido, Date.now(), COMISION_ST_PCT);
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
      `UPDATE agente_st_senales SET sl_at = ?1, tp1_at = ?2, tp2_at = ?3, tp3_at = ?4, desenlace = ?5, cerrada = ?6, salida = ?7, r = ?8
        WHERE user_id = ?9 AND clave = ?10 AND desenlace = 'ABIERTA'`,
    )
    .bind(n.slAt, n.tp1At, n.tp2At, n.tp3At, n.desenlace, n.cerradaA, n.salida, n.r, userId, clave)
    .run();
}

/** Los resultados de la cuenta para el registro unificado: abiertas y cerradas con su R, por índice y con tope. */
export async function resultadosSt(db: D1Database, userId: number, limite: number) {
  await ensureAgenteSt(db);
  return (
    await db
      .prepare("SELECT r, desenlace, cerrada, detectada FROM agente_st_senales WHERE user_id = ?1 ORDER BY detectada DESC LIMIT ?2")
      .bind(userId, limite)
      .all<{ r: number | null; desenlace: string; cerrada: number | null; detectada: number | null }>()
  ).results;
}

export type RecienteSt = FilaSt & {
  foto: string;
  sl_at: number | null;
  tp1_at: number | null;
  tp2_at: number | null;
  tp3_at: number | null;
  desenlace: string;
  cerrada: number | null;
  salida: number | null;
  r: number | null;
};

/** Las últimas entradas de la cuenta (abiertas y cerradas) con sus niveles, sus toques y su foto, para mostrarlas. Por índice y con tope. */
export async function recientesSt(db: D1Database, userId: number, limite = 20): Promise<RecienteSt[]> {
  await ensureAgenteSt(db);
  return (
    await db
      .prepare(
        `SELECT clave, symbol, lado, vela, entrada, sl, tp1, tp2, tp3, detectada, foto, sl_at, tp1_at, tp2_at, tp3_at, desenlace, cerrada, salida, r
           FROM agente_st_senales WHERE user_id = ?1 ORDER BY detectada DESC LIMIT ?2`,
      )
      .bind(userId, Math.min(limite, 50))
      .all<RecienteSt>()
  ).results;
}
