/**
 * El registro del ROBOT MM en D1, por cuenta: una fila por señal (user_id +
 * clave) con su escalera fijada al detectarla y su recorrido. Una fila cerrada
 * no se vuelve a escribir. Presupuesto de D1: lecturas por clave o por índice
 * (user_id, vela) con LIMIT, nada de COUNT(*). La tabla se crea al primer uso.
 */
import { ABIERTA, type Desenlace, type Lado } from "./escalera.ts";
import { FUENTE_NAVEGADOR, MAX_RECORRIDOS, mismoRecorrido, validarRecorrido, type RegistroRobot, type Validacion } from "./robot-ledger.ts";
import { robotSignalKey, type RobotSignal } from "./robot-signals.ts";

export const LISTA_REGISTRO = 100;

const listo = new WeakSet<D1Database>();

export async function ensureRobotLedger(db: D1Database) {
  if (listo.has(db)) return;
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS robot_senales (
        user_id INTEGER NOT NULL, clave TEXT NOT NULL, symbol TEXT NOT NULL, timeframe TEXT NOT NULL, side TEXT NOT NULL,
        vela INTEGER NOT NULL, detectada INTEGER NOT NULL, entrada REAL NOT NULL,
        sl REAL NOT NULL, tp1 REAL NOT NULL, tp2 REAL NOT NULL, tp3 REAL NOT NULL,
        variante TEXT NOT NULL, validacion TEXT NOT NULL, telegram TEXT,
        sl_at INTEGER, tp1_at INTEGER, tp2_at INTEGER, tp3_at INTEGER,
        desenlace TEXT NOT NULL DEFAULT 'ABIERTA', cerrada INTEGER, salida REAL, r REAL, fuente TEXT,
        PRIMARY KEY (user_id, clave))`,
    ),
    db.prepare("CREATE INDEX IF NOT EXISTS robot_senales_vela ON robot_senales (user_id, vela)"),
  ]);
  listo.add(db);
}

type Fila = {
  clave: string; symbol: string; timeframe: string; side: string; vela: number; detectada: number; entrada: number;
  sl: number; tp1: number; tp2: number; tp3: number; variante: string; validacion: string; telegram: string | null;
  sl_at: number | null; tp1_at: number | null; tp2_at: number | null; tp3_at: number | null;
  desenlace: string; cerrada: number | null; salida: number | null; r: number | null; fuente: string | null;
};
const COLUMNAS = "clave, symbol, timeframe, side, vela, detectada, entrada, sl, tp1, tp2, tp3, variante, validacion, telegram, sl_at, tp1_at, tp2_at, tp3_at, desenlace, cerrada, salida, r, fuente";

function deFila(f: Fila): RegistroRobot {
  let validacion: Validacion = { trades: 0, profitFactor: null, positive: 0, tested: 0 };
  try {
    validacion = { ...validacion, ...(JSON.parse(f.validacion) as Partial<Validacion>) };
  } catch {
    /* ilegible: queda en cero */
  }
  const desenlace = (["ABIERTA", "SL", "TP3", "TIEMPO"].includes(f.desenlace) ? f.desenlace : "ABIERTA") as Desenlace;
  return {
    clave: f.clave, symbol: f.symbol, timeframe: f.timeframe, side: f.side as Lado, vela: f.vela, detectada: f.detectada, entrada: f.entrada,
    escalera: { stop: f.sl, tp1: f.tp1, tp2: f.tp2, tp3: f.tp3 },
    variante: f.variante, validacion, telegram: f.telegram,
    recorrido: { ...ABIERTA, slAt: f.sl_at, tp1At: f.tp1_at, tp2At: f.tp2_at, tp3At: f.tp3_at, desenlace, cerradaA: f.cerrada, salida: f.salida, r: f.r },
    fuente: f.fuente,
  };
}

export async function leerRegistro(db: D1Database, userId: number, clave: string): Promise<RegistroRobot | null> {
  const f = await db.prepare(`SELECT ${COLUMNAS} FROM robot_senales WHERE user_id = ?1 AND clave = ?2`).bind(userId, clave).first<Fila>();
  return f ? deFila(f) : null;
}

/** Guarda la señal con su escalera la primera vez; si ya estaba, la deja como estaba. */
export async function registrarSenal(db: D1Database, userId: number, s: RobotSignal, ahora: number): Promise<RegistroRobot | null> {
  const clave = robotSignalKey(s);
  await db
    .prepare(
      `INSERT OR IGNORE INTO robot_senales (user_id, clave, symbol, timeframe, side, vela, detectada, entrada, sl, tp1, tp2, tp3, variante, validacion)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
    )
    .bind(userId, clave, s.symbol, s.timeframe, s.side, s.time, ahora, s.entry, s.escalera.stop, s.escalera.tp1, s.escalera.tp2, s.escalera.tp3, s.variant, JSON.stringify(s.validation))
    .run();
  return leerRegistro(db, userId, clave);
}

export const ENVIADA = "enviada a Telegram";

/** Qué pasó con el aviso a Telegram. Una vez enviada queda así; si antes no se pudo, se actualiza. */
export async function marcarTelegram(db: D1Database, userId: number, clave: string, texto: string) {
  await db
    .prepare("UPDATE robot_senales SET telegram = ?1 WHERE user_id = ?2 AND clave = ?3 AND (telegram IS NULL OR telegram != ?4)")
    .bind(texto.slice(0, 120), userId, clave, ENVIADA)
    .run();
}

export async function listarRegistro(db: D1Database, userId: number, limite = LISTA_REGISTRO): Promise<RegistroRobot[]> {
  const r = await db
    .prepare(`SELECT ${COLUMNAS} FROM robot_senales WHERE user_id = ?1 ORDER BY vela DESC LIMIT ?2`)
    .bind(userId, Math.max(1, Math.min(LISTA_REGISTRO, limite)))
    .all<Fila>();
  return (r.results ?? []).map(deFila);
}

export type Guardado = { ok: true; registros: RegistroRobot[]; rechazados: { clave: string; error: string }[] } | { ok: false; status: number; error: string };

/**
 * Los recorridos que resolvió el navegador. Cada uno se revisa contra su fila;
 * solo se escribe una fila todavía abierta y solo si algo cambió.
 */
export async function guardarRecorridos(db: D1Database, userId: number, raw: unknown, ahora: number): Promise<Guardado> {
  if (!Array.isArray(raw) || raw.length > MAX_RECORRIDOS) return { ok: false, status: 400, error: `Hasta ${MAX_RECORRIDOS} recorridos por pedido.` };
  const registros: RegistroRobot[] = [];
  const rechazados: { clave: string; error: string }[] = [];
  for (const item of raw as { clave?: unknown; recorrido?: unknown }[]) {
    const clave = typeof item?.clave === "string" ? item.clave.slice(0, 120) : "";
    const reg = clave ? await leerRegistro(db, userId, clave) : null;
    if (!reg) {
      rechazados.push({ clave, error: "No está en tu registro." });
      continue;
    }
    const v = validarRecorrido(reg, item.recorrido, ahora);
    if (!v.ok) {
      rechazados.push({ clave, error: v.error });
      continue;
    }
    if (mismoRecorrido(v.recorrido, reg.recorrido)) continue;
    const n = v.recorrido;
    await db
      .prepare(
        `UPDATE robot_senales SET sl_at = ?1, tp1_at = ?2, tp2_at = ?3, tp3_at = ?4, desenlace = ?5, cerrada = ?6, salida = ?7, r = ?8, fuente = ?9
          WHERE user_id = ?10 AND clave = ?11 AND desenlace = 'ABIERTA'`,
      )
      .bind(n.slAt, n.tp1At, n.tp2At, n.tp3At, n.desenlace, n.cerradaA, n.salida, n.r, FUENTE_NAVEGADOR, userId, clave)
      .run();
    registros.push({ ...reg, recorrido: n, fuente: FUENTE_NAVEGADOR });
  }
  return { ok: true, registros, rechazados };
}
