/**
 * La lectura completa de un papel de BYMA en el servidor, una sola para todos: sus ruedas (la misma caché que la app), la acción
 * de afuera si es CEDEAR, el índice de referencia y los balances guardados; con eso arma los agentes, Fibonacci y la pizarra
 * (lib/pizarra-activos.ts). La usan el cron de las señales (lib/ar-senales-run.ts) y las respuestas de JARVIS en la app y en
 * Telegram (lib/jarvis-todo-db.ts): así los tres leen lo mismo. Si Yahoo no responde, devuelve el motivo: desconocido no es cero.
 */
import { EMPRESAS_SEC, fundamentalesDe } from "./fundamentales-sec.ts";
import { sma } from "./mentes-inversoras.ts";
import { estudiarPapel, type AgenteEnPapel } from "./mercado-ar-agentes.ts";
import { serieArCacheada } from "./mercado-ar-fuente.ts";
import { zonaFib, type ZonaFibAr } from "./mercado-ar-tecnico.ts";
import { INDICE_EEUU, INDICE_MERVAL, type PapelAr, type SerieAr } from "./mercado-ar.ts";
import { entradaMentesAr, pizarraAr, type PizarraActivo } from "./pizarra-activos.ts";
import type { SwingCandle } from "./swing-entries.ts";

export type LecturaPapelAr = {
  papel: PapelAr;
  serie: SerieAr;
  velas: SwingCandle[];
  agentes: AgenteEnPapel[];
  fib: ZonaFibAr | null;
  fibMotivo: string | null;
  pizarra: PizarraActivo;
};

export async function leerPapelAr(db: D1Database, papel: PapelAr): Promise<{ ok: true; lectura: LecturaPapelAr } | { ok: false; error: string }> {
  try {
    const [propia, afuera, indice, fund] = await Promise.all([
      serieArCacheada(papel.yahoo),
      papel.subyacente ? serieArCacheada(papel.subyacente) : Promise.resolve(null),
      serieArCacheada(papel.tipo === "ACCION" ? INDICE_MERVAL : INDICE_EEUU),
      papel.tipo === "CEDEAR" && EMPRESAS_SEC[papel.ticker] ? fundamentalesDe(db, papel.ticker).catch(() => null) : Promise.resolve(null),
    ]);
    const serie = propia.resultado?.serie;
    if (!serie || !serie.velas.length) return { ok: false, error: `sin ruedas de ${papel.yahoo}: ${propia.error ?? "la fuente no respondió"}` };
    const velas = serie.velas;
    const vIndice = indice.resultado?.serie?.velas ?? [];
    const m200 = sma(vIndice.map((c) => c.close), 200);
    const mentes = entradaMentesAr({
      papel,
      velasPapel: velas,
      monedaPapel: serie.meta.moneda,
      velasAfuera: afuera?.resultado?.serie?.velas ?? null,
      monedaAfuera: afuera?.resultado?.serie?.meta.moneda ?? null,
      fund: fund?.fund ?? null,
      fundError: papel.tipo === "CEDEAR" ? (fund?.error ?? (EMPRESAS_SEC[papel.ticker] ? "SEC no respondió" : "sin balances de SEC para este papel")) : null,
      fuerzaRelativa: null,
      mercadoAlcista: m200 === null ? null : vIndice.at(-1)!.close > m200,
      volMediana: null,
    });
    const agentes = estudiarPapel(papel.ticker, velas);
    const z = zonaFib(velas);
    const pizarra = pizarraAr({ ticker: papel.ticker, nombre: papel.nombre, velas, fib: z.fib, fibMotivo: z.motivo, agentes, mentes });
    return { ok: true, lectura: { papel, serie, velas, agentes, fib: z.fib, fibMotivo: z.motivo, pizarra } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.slice(0, 200) : "error" };
  }
}
