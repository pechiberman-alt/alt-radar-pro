/**
 * El contexto común de JARVIS (lib/jarvis-todo.ts) leído del servidor, una sola vez para la app y para Telegram: HOY (lo que ya
 * guardó la base, con su caché de 5 minutos) y, de cada papel de BYMA que la persona nombró, el resumen que el servidor
 * guardó en su última rueda (pizarra, zonas de compra y de venta, niveles): una fila por papel, sin recalcular nada pesado en
 * la respuesta. Si todavía no hay lectura guardada, se arma la rápida con las ruedas en caché (sin pizarra) y se dice. Cada
 * parte que falla queda dicha, sin tumbar las demás. Solo lectura: no escribe nada ni manda órdenes.
 */
import { leerLecturaAr } from "./ar-senales-db.ts";
import { leerHoy } from "./hoy-db.ts";
import { armarTodo, papelesDeLaConversacion, resumenRapido, type PapelGuardado, type PapelParaIa, type TodoParaIa } from "./jarvis-todo.ts";
import { serieArCacheada } from "./mercado-ar-fuente.ts";
import type { PapelAr } from "./mercado-ar.ts";
import { sharedJson } from "./shared-cache.ts";

/** Más de 4 días sin lectura (feriado largo o falla del cron): se usa igual pero se dice que es vieja. */
const VIDA_LECTURA_MS = 4 * 86_400_000;

async function papelParaIa(db: D1Database, papel: PapelAr, ahora: number): Promise<PapelParaIa> {
  const guardada = await sharedJson(`jarvis-papel-v2:${papel.ticker}`, 600, async () => leerLecturaAr(db, papel.ticker), ahora);
  if (guardada) {
    try {
      const r = JSON.parse(guardada.json) as PapelGuardado;
      return ahora - guardada.at > VIDA_LECTURA_MS ? { ...r, pizarraNota: `la lectura es vieja (del ${r.lecturaDel?.slice(0, 10) ?? "s/d"}): el servidor no la actualizó` } : r;
    } catch {
      // Una fila ilegible no es un dato: se sigue con la lectura rápida.
    }
  }
  const s = await serieArCacheada(papel.yahoo);
  const serie = s.resultado?.serie;
  if (!serie || !serie.velas.length) return { ticker: papel.ticker, nombre: papel.nombre, noSePudoLeer: `sin ruedas de ${papel.yahoo}: ${s.error ?? "la fuente no respondió"}` };
  return resumenRapido(papel, serie.velas, serie.meta.moneda);
}

/** `anteriores`: lo último que dijo la persona (para un seguimiento sin nombre de papel). */
export async function contextoTodo(db: D1Database, pregunta: string, anteriores: string[] = [], ahora = Date.now()): Promise<TodoParaIa> {
  const pedidos = papelesDeLaConversacion(pregunta, anteriores);
  const [hoy, papeles] = await Promise.all([
    leerHoy(db, ahora).catch(() => null),
    Promise.all(pedidos.map((p) => papelParaIa(db, p, ahora).catch((): PapelParaIa => ({ ticker: p.ticker, nombre: p.nombre, noSePudoLeer: "falló la lectura" })))),
  ]);
  return armarTodo({ hoy, papeles });
}
