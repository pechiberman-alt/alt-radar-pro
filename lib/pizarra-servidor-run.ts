/**
 * La corrida del cron de la pizarra de cripto (lib/pizarra-servidor.ts): a la moneda de turno le trae las velas de 4 h y
 * diarias de Kraken (o Coinbase; nunca Binance, que responde 403 al servidor), la oficina del servidor, las señales abiertas
 * del núcleo y las posiciones abiertas de los agentes; discute, registra si hay plan, recorre las abiertas y anota cómo salió.
 * Si una fuente no responde, queda escrito el motivo. Solo papel.
 */
import { abiertasServidor } from "./agentes-servidor-db.ts";
import { MIN_VELAS_SERVIDOR, VELAS_SERVIDOR } from "./agentes-servidor.ts";
import { openCoreSignals } from "./jarvis-core-db.ts";
import { fetchKlinesServer } from "./klines-server.ts";
import { oficinaServidor } from "./oficina-db.ts";
import { abiertasPizarra, avanzarPizarra, guardarEstadoPizarra, registrarPizarra } from "./pizarra-servidor-db.ts";
import { avancesPizarra, entradaPizarra, monedaPizarraDeTurno, pizarraServidor } from "./pizarra-servidor.ts";

export async function runPizarraServidor(db: D1Database, scheduledTime: number, ahora = Date.now()): Promise<void> {
  const symbol = monedaPizarraDeTurno(scheduledTime);
  if (!symbol) return;
  try {
    const [h4, d1, oficina, nucleo, agentes] = await Promise.all([
      fetchKlinesServer(symbol, "4h", { limit: VELAS_SERVIDOR, soloAfuera: true, minCandles: MIN_VELAS_SERVIDOR }),
      fetchKlinesServer(symbol, "1d", { limit: 300, soloAfuera: true, minCandles: 30 }).catch(() => null),
      oficinaServidor(db, ahora).catch(() => null),
      openCoreSignals(db, 40).catch(() => []),
      abiertasServidor(db, symbol).catch(() => []),
    ]);
    const d1Cerradas = (d1?.candles ?? []).filter((c) => c.openTime + 86_400_000 <= ahora);
    const p = pizarraServidor({
      symbol,
      d1: d1Cerradas,
      escritorios: oficina?.oficina.escritorios ?? [],
      nucleo: nucleo.filter((s) => s.symbol === symbol).map((s) => ({ id: s.id, source: s.source, side: s.side, entry: s.entry, stop: s.stop, target: s.target, time: s.time, taken: s.taken })),
      agentes,
      ahora,
    });
    const { entrada, motivo } = entradaPizarra(symbol, h4.candles, p.deliberacion, ahora);
    const registrada = entrada ? await registrarPizarra(db, entrada, h4.venue) : false;
    const avanzadas = await avanzarPizarra(db, avancesPizarra(await abiertasPizarra(db, symbol), h4.candles, ahora));
    const d = p.deliberacion;
    await guardarEstadoPizarra(db, { symbol, at: ahora, veredicto: d.veredicto, razon: d.razon.slice(0, 300), lado: d.direccion, huella: d.huella, registrada: registrada ? 1 : 0, avanzadas, venue: h4.venue, error: motivo ?? (d1 ? null : "sin velas diarias: las mentes no opinaron") });
  } catch (error) {
    const motivo = error instanceof Error ? error.message.slice(0, 200) : "error";
    await guardarEstadoPizarra(db, { symbol, at: ahora, veredicto: null, razon: null, lado: null, huella: null, registrada: 0, avanzadas: 0, venue: null, error: motivo }).catch(() => undefined);
  }
}
