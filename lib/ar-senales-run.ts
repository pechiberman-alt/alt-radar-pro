/**
 * La corrida del cron de las señales de BYMA (lib/ar-senales.ts): al papel de turno le trae sus ruedas (la misma caché que la
 * app), la acción de afuera si es CEDEAR, el índice de referencia y los balances guardados; arma los agentes, Fibonacci y la
 * pizarra; registra las entradas nuevas, recorre las abiertas, deja los avisos para Telegram y anota cómo salió. Si Yahoo no
 * responde, queda escrito el motivo: desconocido no es cero. Solo papel: no manda órdenes.
 */
import { abiertasAr, avanzarAr, estadoArDe, guardarAvisosAr, guardarEstadoAr, registrarAr } from "./ar-senales-db.ts";
import { avancesAr, avisosAr, entradasAr, papelDeTurno, ruedaDeHoy } from "./ar-senales.ts";
import { EMPRESAS_SEC, fundamentalesDe } from "./fundamentales-sec.ts";
import { sma } from "./mentes-inversoras.ts";
import { estudiarPapel } from "./mercado-ar-agentes.ts";
import { serieArCacheada } from "./mercado-ar-fuente.ts";
import { zonaFib } from "./mercado-ar-tecnico.ts";
import { INDICE_EEUU, INDICE_MERVAL } from "./mercado-ar.ts";
import { entradaMentesAr, pizarraAr } from "./pizarra-activos.ts";

export async function runArSenales(db: D1Database, scheduledTime: number, ahora = Date.now()): Promise<void> {
  const papel = papelDeTurno(scheduledTime);
  if (!papel) return;
  try {
    const [propia, afuera, indice, fund] = await Promise.all([
      serieArCacheada(papel.yahoo),
      papel.subyacente ? serieArCacheada(papel.subyacente) : Promise.resolve(null),
      serieArCacheada(papel.tipo === "ACCION" ? INDICE_MERVAL : INDICE_EEUU),
      papel.tipo === "CEDEAR" && EMPRESAS_SEC[papel.ticker] ? fundamentalesDe(db, papel.ticker).catch(() => null) : Promise.resolve(null),
    ]);
    const serie = propia.resultado?.serie;
    if (!serie || !serie.velas.length) throw new Error(`sin ruedas de ${papel.yahoo}: ${propia.error ?? "la fuente no respondió"}`);
    const velas = serie.velas;
    const vIndice = indice.resultado?.serie?.velas ?? [];
    const m200 = sma(vIndice.map((c) => c.close), 200);
    const entradaMentes = entradaMentesAr({
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
    const p = pizarraAr({ ticker: papel.ticker, nombre: papel.nombre, velas, fib: z.fib, fibMotivo: z.motivo, agentes, mentes: entradaMentes });
    const antes = await estadoArDe(db, papel.ticker).catch(() => null);
    const { entradas, descartada } = entradasAr(papel.ticker, velas, agentes, p.deliberacion, ahora);
    const nuevas = await registrarAr(db, entradas);
    const avanzadas = await avanzarAr(db, avancesAr(await abiertasAr(db, papel.ticker), velas, ahora));
    const vela = velas.at(-1)!.openTime;
    if (ruedaDeHoy(velas, ahora) && antes?.vela !== vela) {
      await guardarAvisosAr(db, avisosAr(papel, vela, antes?.fib ?? null, z.fib, nuevas, p.deliberacion), ahora);
    }
    await guardarEstadoAr(db, { ticker: papel.ticker, at: ahora, vela, fib: z.fib?.estado ?? "SIN ZONA", veredicto: p.deliberacion.veredicto, huella: p.deliberacion.huella, registradas: nuevas.length, avanzadas, error: descartada });
  } catch (error) {
    const motivo = error instanceof Error ? error.message.slice(0, 200) : "error";
    await guardarEstadoAr(db, { ticker: papel.ticker, at: ahora, vela: null, fib: null, veredicto: null, huella: null, registradas: 0, avanzadas: 0, error: motivo }).catch(() => undefined);
  }
}
