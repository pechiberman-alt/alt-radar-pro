/**
 * Lo que lee la pantalla HOY (lib/hoy.ts) de la base: el registro unificado global, el estado de BYMA, los avisos y las
 * señales abiertas del núcleo. Es lo mismo para todos: se arma una vez cada 5 minutos (caché compartida) y cada parte que
 * falla queda en null, dicha, sin tumbar las demás. Todo por índice y con tope.
 */
import { avisosRecientesAr, estadosAr } from "./ar-senales-db.ts";
import { armarHoy, type DatosHoy, type Hoy } from "./hoy.ts";
import { openCoreSignals } from "./jarvis-core-db.ts";
import { leerRegistroUnificado } from "./registro-db.ts";
import { sharedJson } from "./shared-cache.ts";

const seguro = async <T>(f: () => Promise<T>): Promise<T | null> => {
  try {
    return await f();
  } catch {
    return null;
  }
};

export async function leerHoy(db: D1Database, ahora = Date.now()): Promise<Hoy> {
  return sharedJson("hoy-v1", 300, async () => {
    const [registro, estados, avisos, nucleo] = await Promise.all([
      seguro(() => leerRegistroUnificado(db, null, ahora)),
      seguro(() => estadosAr(db)),
      seguro(() => avisosRecientesAr(db, ahora)),
      seguro(() => openCoreSignals(db, 20)),
    ]);
    const datos: DatosHoy = {
      registro,
      estadosAr: estados,
      avisos,
      nucleo: nucleo ? nucleo.map((s) => ({ symbol: s.symbol, source: s.source, side: s.side, entry: s.entry, stop: s.stop, target: s.target, time: s.time, taken: s.taken })) : null,
      pizarraCripto: [],
    };
    return armarHoy(datos, ahora);
  });
}
