/**
 * El aprendizaje diario del plan del servidor, guardado (lib/aprendizaje-diario.ts arma el diario; esto lo lee y lo guarda).
 * Corre una vez por día, a las 00:15 de Argentina (03:15 UTC, en el cron de cada 15 minutos del Worker): lee el registro de los
 * agentes del servidor por índice y con tope, arma el diario del día que terminó y lo guarda en una fila. Lo leen la oficina,
 * el mapa, Telegram (/diario) y JARVIS: una fila por día, nada de recalcular en cada pedido. Sin IA: no se paga nada.
 */
import { armarDiario, diaAnterior, diaAr, leerDiario, type Diario } from "./aprendizaje-diario.ts";
import { PLAN_SERVIDOR } from "./agentes-servidor.ts";
import { ensureAgentesServidor } from "./agentes-servidor-db.ts";
import type { FilaOficina } from "./oficina.ts";
import { sharedJson } from "./shared-cache.ts";

/** Cuántas entradas lee el diario como mucho (una vez por día): más que la oficina, para que el registro sea completo. */
export const LIMITE_DIARIO = 5000;
/** Cuántos días se guardan. */
export const DIAS_GUARDADOS = 120;
export const HORA_DIARIO_UTC = 3;
export const MINUTO_DIARIO_UTC = 15;

/** Si esta corrida del cron de cada 15 minutos es la del diario. */
export function esHoraDelDiario(t: number): boolean {
  const d = new Date(t);
  return d.getUTCHours() === HORA_DIARIO_UTC && d.getUTCMinutes() === MINUTO_DIARIO_UTC;
}

const listo = new WeakSet<D1Database>();
async function ensureAprendizaje(db: D1Database) {
  if (listo.has(db)) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS aprendizaje_diario (plan TEXT NOT NULL, dia TEXT NOT NULL, at INTEGER NOT NULL, cuerpo TEXT NOT NULL, PRIMARY KEY (plan, dia))").run();
  listo.add(db);
}

/** Arma y guarda el diario del día de Argentina que terminó antes de `t`. Devuelve el diario guardado. */
export async function runAprendizajeDiario(db: D1Database, t: number): Promise<Diario> {
  await Promise.all([ensureAprendizaje(db), ensureAgentesServidor(db)]);
  const dia = diaAnterior(diaAr(t));
  const filas = (
    await db
      .prepare("SELECT clave, symbol, lado, r, desenlace, cerrada, detectada, foto FROM agentes_servidor ORDER BY detectada DESC LIMIT ?1")
      .bind(LIMITE_DIARIO)
      .all<FilaOficina>()
  ).results;
  const diario = armarDiario(filas, dia, PLAN_SERVIDOR);
  const viejo = diaAr(t - DIAS_GUARDADOS * 86_400_000);
  await db.batch([
    db.prepare("INSERT OR REPLACE INTO aprendizaje_diario (plan, dia, at, cuerpo) VALUES (?1, ?2, ?3, ?4)").bind(PLAN_SERVIDOR, dia, t, JSON.stringify(diario)),
    db.prepare("DELETE FROM aprendizaje_diario WHERE plan = ?1 AND dia < ?2").bind(PLAN_SERVIDOR, viejo),
  ]);
  return diario;
}

/** Los últimos diarios guardados del servidor, del más nuevo al más viejo. Por la clave primaria y con tope. */
export async function leerDiariosServidor(db: D1Database, n = 7): Promise<Diario[]> {
  await ensureAprendizaje(db);
  const filas = (
    await db.prepare("SELECT cuerpo FROM aprendizaje_diario WHERE plan = ?1 ORDER BY dia DESC LIMIT ?2").bind(PLAN_SERVIDOR, Math.max(1, Math.min(30, n))).all<{ cuerpo: string }>()
  ).results;
  const out: Diario[] = [];
  for (const f of filas) {
    try {
      const d = leerDiario(JSON.parse(f.cuerpo));
      if (d) out.push(d);
    } catch {
      // Una fila rota no tapa las demás.
    }
  }
  return out;
}

/** La misma lectura para todos, cada 10 minutos como mucho (cambia una vez por día). */
export const diariosServidor = (db: D1Database) => sharedJson("aprendizaje-diario-servidor-v1", 600, () => leerDiariosServidor(db, 7));
