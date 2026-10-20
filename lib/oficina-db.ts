/**
 * La oficina del servidor (los agentes 24/7, lib/agentes-servidor.ts) leída una vez cada 5 minutos para todos: la pantalla,
 * Telegram y JARVIS usan la misma lectura. Las filas, por fecha y con tope (LIMITE_OFICINA), y el estado de la última corrida
 * de cada moneda. Así una visita o una pregunta no cuesta otra lectura de la base.
 */
import { estadoServidor, filasServidor, type EstadoServidor } from "./agentes-servidor-db.ts";
import { armarOficina, LIMITE_OFICINA, type FilaOficina, type Oficina } from "./oficina.ts";
import { sharedJson } from "./shared-cache.ts";

export type LecturaServidor = { filas: FilaOficina[]; estado: EstadoServidor[] };

export function lecturaServidor(db: D1Database): Promise<LecturaServidor> {
  return sharedJson("oficina-servidor-v1", 300, async () => ({ filas: await filasServidor(db, LIMITE_OFICINA), estado: await estadoServidor(db) }));
}

/** La oficina del servidor armada; si no se puede leer, la oficina sin datos (no ceros). */
export async function oficinaServidor(db: D1Database, ahora = Date.now()): Promise<{ oficina: Oficina; estado: EstadoServidor[] }> {
  try {
    const l = await lecturaServidor(db);
    return { oficina: armarOficina(l.filas, ahora, "SERVIDOR"), estado: l.estado };
  } catch {
    return { oficina: armarOficina(null, ahora, "SERVIDOR"), estado: [] };
  }
}
