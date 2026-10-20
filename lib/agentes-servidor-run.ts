/**
 * La corrida del cron de los agentes del servidor (lib/agentes-servidor.ts): a la moneda de turno le trae las velas de 4 h de
 * Kraken (nunca de Binance, para que la serie no cambie), registra sus entradas nuevas, recorre sus abiertas y anota cómo salió.
 * Si Kraken no responde, queda escrito el motivo: desconocido no es cero. Solo papel: no manda órdenes.
 */
import { fetchKlinesServer } from "./klines-server.ts";
import { avancesServidor, entradasServidor, MIN_VELAS_SERVIDOR, monedaDeTurno, VELAS_SERVIDOR } from "./agentes-servidor.ts";
import { abiertasServidor, avanzarServidor, guardarEstadoServidor, registrarServidor } from "./agentes-servidor-db.ts";

export async function runAgentesServidor(db: D1Database, scheduledTime: number, ahora = Date.now()): Promise<void> {
  const symbol = monedaDeTurno(scheduledTime);
  if (!symbol) return;
  try {
    const k = await fetchKlinesServer(symbol, "4h", { limit: VELAS_SERVIDOR, soloAfuera: true, minCandles: MIN_VELAS_SERVIDOR });
    const registradas = await registrarServidor(db, entradasServidor(symbol, k.candles, ahora, k.venue));
    const avanzadas = await avanzarServidor(db, avancesServidor(await abiertasServidor(db, symbol), k.candles, ahora));
    await guardarEstadoServidor(db, { symbol, at: ahora, venue: k.venue, registradas, avanzadas, error: null });
  } catch (error) {
    const motivo = error instanceof Error ? error.message.slice(0, 200) : "error";
    await guardarEstadoServidor(db, { symbol, at: ahora, venue: null, registradas: 0, avanzadas: 0, error: motivo }).catch(() => undefined);
  }
}
