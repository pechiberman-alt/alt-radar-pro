/**
 * Lo que se guarda del diario de Axi en D1: una fila por ejecución de tu cuenta, con clave (user_id, deal_id), así que importar
 * dos veces lo mismo no duplica nada. Presupuesto de D1: nada de COUNT(*). El tope de MAX_DEALS_AXI se controla leyendo como
 * mucho MAX_DEALS_AXI + 1 claves con LIMIT, y las lecturas del diario van por índice (user_id, tiempo). La tabla se crea al
 * primer uso (CREATE TABLE IF NOT EXISTS).
 */
import { MAX_DEALS_AXI, type DealAxi } from "./axi-diario.ts";

const listo = new WeakSet<D1Database>();
/** Filas por lote de escritura: queda por debajo del límite de parámetros de D1 por consulta. */
const TANDA = 50;

export async function ensureAxiDiario(db: D1Database) {
  if (listo.has(db)) return;
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS axi_deals (
        user_id INTEGER NOT NULL, deal_id TEXT NOT NULL, orden TEXT, simbolo TEXT NOT NULL, tipo TEXT NOT NULL,
        accion TEXT NOT NULL, entrada TEXT NOT NULL, lotes REAL NOT NULL, precio REAL NOT NULL, resultado REAL NOT NULL,
        swap REAL NOT NULL, comision REAL NOT NULL, neto REAL NOT NULL, tiempo INTEGER NOT NULL, comentario TEXT NOT NULL,
        importada INTEGER NOT NULL, PRIMARY KEY (user_id, deal_id))`,
    ),
    db.prepare("CREATE INDEX IF NOT EXISTS axi_deals_tiempo ON axi_deals (user_id, tiempo)"),
  ]);
  listo.add(db);
}

type Fila = {
  deal_id: string; orden: string | null; simbolo: string; tipo: string; accion: string; entrada: string; lotes: number; precio: number;
  resultado: number; swap: number; comision: number; neto: number; tiempo: number; comentario: string;
};
const COLUMNAS = "deal_id, orden, simbolo, tipo, accion, entrada, lotes, precio, resultado, swap, comision, neto, tiempo, comentario";

function deFila(f: Fila): DealAxi {
  return {
    id: f.deal_id, orden: f.orden, simbolo: f.simbolo, tipo: f.tipo === "movimiento" ? "movimiento" : "operacion", accion: f.accion,
    entrada: f.entrada, lotes: f.lotes, precio: f.precio, resultado: f.resultado, swap: f.swap, comision: f.comision, neto: f.neto,
    tiempo: f.tiempo, comentario: f.comentario,
  };
}

/** Las ejecuciones más recientes primero. Con LIMIT: el llamador pide un lugar más que el tope para saber si se truncó. */
export async function listarDeals(db: D1Database, userId: number, limite = MAX_DEALS_AXI + 1): Promise<DealAxi[]> {
  const r = await db
    .prepare(`SELECT ${COLUMNAS} FROM axi_deals WHERE user_id = ?1 ORDER BY tiempo DESC LIMIT ?2`)
    .bind(userId, Math.max(1, Math.min(MAX_DEALS_AXI + 1, limite)))
    .all<Fila>();
  return (r.results ?? []).map(deFila);
}

async function idsGuardados(db: D1Database, userId: number): Promise<Set<string>> {
  const r = await db.prepare("SELECT deal_id FROM axi_deals WHERE user_id = ?1 LIMIT ?2").bind(userId, MAX_DEALS_AXI + 1).all<{ deal_id: string }>();
  return new Set((r.results ?? []).map((x) => x.deal_id));
}

export type Guardado = { ok: true; nuevas: number; ya: number } | { ok: false; error: string };

/**
 * Guarda las ejecuciones que todavía no estaban. Dentro del mismo pedido, un id repetido cuenta una sola vez. Si pasarían del
 * tope, no guarda nada y lo dice.
 */
export async function guardarDeals(db: D1Database, userId: number, deals: DealAxi[], ahora: number): Promise<Guardado> {
  const porId = new Map<string, DealAxi>();
  for (const d of deals) porId.set(d.id, d);
  const guardados = await idsGuardados(db, userId);
  const nuevas = [...porId.values()].filter((d) => !guardados.has(d.id));
  if (guardados.size + nuevas.length > MAX_DEALS_AXI) {
    return { ok: false, error: `El diario de Axi llegó al máximo de ${MAX_DEALS_AXI} ejecuciones. No se guardó nada de este pedido.` };
  }
  for (let i = 0; i < nuevas.length; i += TANDA) {
    await db.batch(
      nuevas.slice(i, i + TANDA).map((d) =>
        db
          .prepare(
            `INSERT OR IGNORE INTO axi_deals (user_id, ${COLUMNAS}, importada)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`,
          )
          .bind(userId, d.id, d.orden, d.simbolo, d.tipo, d.accion, d.entrada, d.lotes, d.precio, d.resultado, d.swap, d.comision, d.neto, d.tiempo, d.comentario, ahora),
      ),
    );
  }
  return { ok: true, nuevas: nuevas.length, ya: deals.length - nuevas.length };
}

/** Borra todo el diario de Axi de esta persona. Solo sus filas. */
export async function borrarDeals(db: D1Database, userId: number) {
  await db.prepare("DELETE FROM axi_deals WHERE user_id = ?1").bind(userId).run();
}
