/**
 * Baja las velas diarias del mercado argentino (lib/mercado-ar.ts) desde Yahoo Finance, en el Worker: el navegador no
 * puede (Yahoo no manda permisos CORS). Solo pide símbolos de la lista fija, prueba los dos hosts de Yahoo y dice cuál
 * respondió; si ninguno, devuelve el error real en vez de una serie vacía que parezca calma.
 *
 * El diagnóstico (`probarMercadoAr`) corre una vez por hora en el cron de 15 minutos: pide un solo símbolo, rotando, y
 * guarda el resultado en un ajuste de D1 (una fila), para saber si la fuente responde en producción sin que nadie abra la
 * pantalla. Recibe `fetchImpl` para que las pruebas corran sin red.
 */
import { guardarAjuste, leerAjuste } from "./app-settings.ts";
import { estadoSerie, leerYahooChart, SIMBOLOS_PERMITIDOS, type SerieAr } from "./mercado-ar.ts";
import { cached } from "./upstream-cache.ts";

export const HOSTS_YAHOO = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
export const FUENTE_AR = "Yahoo Finance";

export type ResultadoAr = { serie: SerieAr | null; fuente: string | null; http: number | null; error: string | null };

/**
 * La serie de un símbolo con la caché compartida (15 minutos; si Yahoo no responde, lo último hasta 3 días, con su edad): la
 * usan la ruta /api/mercado-ar y las señales del servidor (lib/ar-senales-run.ts), así leen lo mismo.
 */
export async function serieArCacheada(simbolo: string): Promise<{ resultado: ResultadoAr | null; edadMs: number; error: string | null }> {
  let ultimoError: string | null = null;
  const r = await cached<ResultadoAr>(
    `mercado-ar:${simbolo}`,
    15 * 60_000,
    async () => {
      const x = await bajarSerieAr(simbolo);
      ultimoError = x.error;
      return x.serie ? x : null;
    },
    3 * 86_400_000,
  );
  return { resultado: r.value ?? null, edadMs: r.ageMs, error: r.value ? null : (ultimoError ?? "la fuente no respondió") };
}

export async function bajarSerieAr(
  simbolo: string,
  opts: { fetchImpl?: typeof fetch; ahora?: number; rango?: "1y" | "2y" | "5y"; timeoutMs?: number } = {},
): Promise<ResultadoAr> {
  if (!SIMBOLOS_PERMITIDOS.has(simbolo)) return { serie: null, fuente: null, http: null, error: "símbolo fuera de la lista" };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ahora = opts.ahora ?? Date.now();
  let http: number | null = null;
  let error: string | null = null;
  for (const host of HOSTS_YAHOO) {
    try {
      const r = await fetchImpl(`${host}/v8/finance/chart/${encodeURIComponent(simbolo)}?range=${opts.rango ?? "2y"}&interval=1d&includePrePost=false`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ALT-RADAR-PRO)", Accept: "application/json" },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
      });
      http = r.status;
      if (!r.ok) {
        error = `HTTP ${r.status}`;
        continue;
      }
      const serie = leerYahooChart(await r.json(), ahora);
      if (!serie) {
        error = "respuesta con otra forma";
        continue;
      }
      return { serie, fuente: `${FUENTE_AR} (${new URL(host).host})`, http, error: null };
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  return { serie: null, fuente: null, http, error };
}

export type PruebaAr = {
  ts: number;
  simbolo: string;
  estado: string;
  motivo: string;
  ruedas: number;
  ultimaRueda: number | null;
  demoraMin: number | null;
  fuente: string | null;
  http: number | null;
  error: string | null;
};

const SIMBOLOS = [...SIMBOLOS_PERMITIDOS];
/** Cuántas pruebas se guardan (las últimas). */
export const PRUEBAS_GUARDADAS = 12;

/** Si en esta corrida del cron de 15 minutos toca la prueba: la primera de cada hora. */
export const tocaPruebaAr = (scheduledTime: number) => new Date(scheduledTime).getUTCMinutes() < 15;

/** Una prueba de la fuente con un símbolo (rota por hora), guardada junto a las anteriores en el ajuste `mercado_ar_estado`. */
export async function probarMercadoAr(db: D1Database, scheduledTime: number, opts: { fetchImpl?: typeof fetch; anteriores?: PruebaAr[] } = {}): Promise<PruebaAr> {
  const simbolo = SIMBOLOS[Math.floor(scheduledTime / 3_600_000) % SIMBOLOS.length];
  const r = await bajarSerieAr(simbolo, { fetchImpl: opts.fetchImpl, ahora: scheduledTime, rango: "1y" });
  const e = estadoSerie(r.serie, scheduledTime);
  const prueba: PruebaAr = {
    ts: scheduledTime,
    simbolo,
    estado: e.estado,
    motivo: r.error ?? e.motivo,
    ruedas: r.serie?.velas.length ?? 0,
    ultimaRueda: r.serie?.velas.at(-1)?.openTime ?? null,
    demoraMin: r.serie?.meta.demoraMin ?? null,
    fuente: r.fuente,
    http: r.http,
    error: r.error,
  };
  const anteriores = opts.anteriores ?? leerPruebas(await leerAjuste(db, "mercado_ar_estado").catch(() => null));
  await guardarAjuste(db, "mercado_ar_estado", JSON.stringify([prueba, ...anteriores].slice(0, PRUEBAS_GUARDADAS)));
  return prueba;
}

/** Las pruebas guardadas; una lista vacía si el ajuste no existe o está roto. */
export function leerPruebas(raw: string | null): PruebaAr[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object" && typeof (x as PruebaAr).simbolo === "string") as PruebaAr[]) : [];
  } catch {
    return [];
  }
}
