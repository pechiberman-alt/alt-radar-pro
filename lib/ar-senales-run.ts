/**
 * La corrida del cron de las señales de BYMA (lib/ar-senales.ts): al papel de turno le lee sus ruedas, los agentes, Fibonacci
 * y la pizarra (lib/ar-lectura.ts, la misma lectura que usa JARVIS); registra las entradas nuevas, recorre las abiertas, deja
 * los avisos para Telegram y anota cómo salió. Si Yahoo no responde, queda escrito el motivo: desconocido no es cero. Solo
 * papel: no manda órdenes.
 */
import { abiertasAr, avanzarAr, estadoArDe, guardarAvisosAr, guardarEstadoAr, registrarAr } from "./ar-senales-db.ts";
import { avancesAr, avisosAr, entradasAr, papelDeTurno, ruedaDeHoy } from "./ar-senales.ts";
import { leerPapelAr } from "./ar-lectura.ts";

export async function runArSenales(db: D1Database, scheduledTime: number, ahora = Date.now()): Promise<void> {
  const papel = papelDeTurno(scheduledTime);
  if (!papel) return;
  try {
    const leida = await leerPapelAr(db, papel);
    if (!leida.ok) throw new Error(leida.error);
    const { velas, agentes, fib, pizarra: p } = leida.lectura;
    const antes = await estadoArDe(db, papel.ticker).catch(() => null);
    const { entradas, descartada } = entradasAr(papel.ticker, velas, agentes, p.deliberacion, ahora);
    const nuevas = await registrarAr(db, entradas);
    const avanzadas = await avanzarAr(db, avancesAr(await abiertasAr(db, papel.ticker), velas, ahora));
    const vela = velas.at(-1)!.openTime;
    if (ruedaDeHoy(velas, ahora) && antes?.vela !== vela) {
      await guardarAvisosAr(db, avisosAr(papel, vela, antes?.fib ?? null, fib, nuevas, p.deliberacion), ahora);
    }
    await guardarEstadoAr(db, { ticker: papel.ticker, at: ahora, vela, fib: fib?.estado ?? "SIN ZONA", veredicto: p.deliberacion.veredicto, huella: p.deliberacion.huella, registradas: nuevas.length, avanzadas, error: descartada });
  } catch (error) {
    const motivo = error instanceof Error ? error.message.slice(0, 200) : "error";
    await guardarEstadoAr(db, { ticker: papel.ticker, at: ahora, vela: null, fib: null, veredicto: null, huella: null, registradas: 0, avanzadas: 0, error: motivo }).catch(() => undefined);
  }
}
