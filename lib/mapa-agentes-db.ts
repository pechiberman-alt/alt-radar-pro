/**
 * Las posiciones de los agentes en un par, para el mapa de liquidaciones (lib/mapa-agentes.ts las arma). Una consulta por plan,
 * por índice (par y fecha) y con tope: las de los últimos DIAS_POSICIONES días, abiertas y cerradas. La del servidor es la misma
 * para todos y se guarda 5 minutos; la de tu cuenta, solo con sesión. Solo lectura.
 */
import { ensureAgenteSt } from "./agente-st-db.ts";
import { ensureAgentesServidor } from "./agentes-servidor-db.ts";
import { DIAS_POSICIONES, type FilaPosicion } from "./mapa-agentes.ts";
import { sharedJson } from "./shared-cache.ts";

export const LIMITE_POSICIONES = 120;
const COLUMNAS = "clave, symbol, lado, entrada, sl, tp1, tp2, tp3, tp1_at, tp2_at, detectada, foto, desenlace, r, cerrada";

/** Las del servidor 24/7 en un par (índice agentes_servidor_par). */
export function posicionesServidor(db: D1Database, symbol: string, ahora: number): Promise<FilaPosicion[]> {
  return sharedJson(`mapa-agentes-servidor-v1:${symbol}`, 300, async () => {
    await ensureAgentesServidor(db);
    return (
      await db
        .prepare(`SELECT ${COLUMNAS}, venue FROM agentes_servidor WHERE symbol = ?1 AND detectada >= ?2 ORDER BY detectada DESC LIMIT ?3`)
        .bind(symbol, ahora - DIAS_POSICIONES * 86_400_000, LIMITE_POSICIONES)
        .all<FilaPosicion>()
    ).results;
  });
}

/** Las de tu cuenta en un par (índice agente_st_senales_par). */
export async function posicionesCuenta(db: D1Database, userId: number, symbol: string, ahora: number): Promise<FilaPosicion[]> {
  await ensureAgenteSt(db);
  return (
    await db
      .prepare(`SELECT ${COLUMNAS}, NULL AS venue FROM agente_st_senales WHERE user_id = ?1 AND symbol = ?2 AND detectada >= ?3 ORDER BY detectada DESC LIMIT ?4`)
      .bind(userId, symbol, ahora - DIAS_POSICIONES * 86_400_000, LIMITE_POSICIONES)
      .all<FilaPosicion>()
  ).results;
}
