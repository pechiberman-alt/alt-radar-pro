/**
 * El contexto común de JARVIS (lib/jarvis-todo.ts) leído del servidor, una sola vez para la app y para Telegram: HOY (lo que ya
 * guardó la base, con su caché de 5 minutos) y la lectura completa de los papeles de BYMA que la persona nombró (la misma
 * de las señales del servidor, con caché de 15 minutos por papel). Cada parte que falla queda dicha, sin tumbar las demás.
 * Solo lectura: no escribe nada ni manda órdenes.
 */
import { leerPapelAr } from "./ar-lectura.ts";
import { leerHoy } from "./hoy-db.ts";
import { armarTodo, papelesDeLaConversacion, resumenPapel, type PapelParaIa, type TodoParaIa } from "./jarvis-todo.ts";
import type { PapelAr } from "./mercado-ar.ts";
import { sharedJson } from "./shared-cache.ts";

async function papelParaIa(db: D1Database, papel: PapelAr): Promise<PapelParaIa> {
  return sharedJson(`jarvis-papel-v1:${papel.ticker}`, 900, async () => {
    const r = await leerPapelAr(db, papel);
    return r.ok ? resumenPapel(r.lectura) : { ticker: papel.ticker, nombre: papel.nombre, noSePudoLeer: r.error };
  });
}

/** `anteriores`: lo último que dijo la persona (para un seguimiento sin nombre de papel). */
export async function contextoTodo(db: D1Database, pregunta: string, anteriores: string[] = [], ahora = Date.now()): Promise<TodoParaIa> {
  const pedidos = papelesDeLaConversacion(pregunta, anteriores);
  const [hoy, papeles] = await Promise.all([leerHoy(db, ahora).catch(() => null), Promise.all(pedidos.map((p) => papelParaIa(db, p).catch((): PapelParaIa => ({ ticker: p.ticker, nombre: p.nombre, noSePudoLeer: "falló la lectura" }))))]);
  return armarTodo({ hoy, papeles });
}
