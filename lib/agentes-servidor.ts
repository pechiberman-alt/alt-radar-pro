/**
 * Los agentes de papel corriendo las 24 horas en el servidor (PLAN_SERVIDOR_1), con la app cerrada. Son los mismos agentes del
 * estudio (lib/agentes-papel.ts, leerSenalesPapel), con sus reglas sin cambiar, en velas de 4 h. Binance responde 403 a los
 * crons del Worker, así que las velas salen de Kraken (en dólares, no USDT; Coinbase no tiene velas de 4 h): es OTRA serie que
 * la del navegador, y por eso es otro plan que arranca de cero y nunca se suma al de tu cuenta. El oro y la plata solo están
 * en Binance: no corren acá. Costo: el del estudio (0,07 % por lado), porque Kraken es solo la fuente de precios.
 *
 * El plan gratis de Cloudflare da pocos milisegundos de CPU por corrida: una moneda por corrida, en los minutos 1, 3, …, 19
 * de cada hora múltiplo de 4 (UTC), justo después de que cierra la vela. Cada corrida registra las entradas nuevas de esa moneda
 * (si la vela de entrada abrió hace menos de media hora) y recorre sus abiertas con velas ya cerradas. Pura: sin red ni base.
 */
import { consensoDe, fotoConsenso } from "./consenso.ts";
import { recorrer, type Lado, type Recorrido } from "./escalera.ts";
import { COMISION_AGENTES_PCT, HORIZONTE_AGENTES, leerSenalesPapel, MARCO_AGENTES_MS, MONEDAS_AGENTES } from "./agentes-papel.ts";
import type { SwingCandle } from "./swing-entries.ts";

export const PLAN_SERVIDOR = "PLAN_SERVIDOR_1";
export const MONEDAS_SERVIDOR = MONEDAS_AGENTES;
/** Kraken guarda las últimas 720 velas de cada intervalo: alcanzan para la EMA 200 y los marcos superiores. */
export const VELAS_SERVIDOR = 720;
export const MIN_VELAS_SERVIDOR = 300;
/** El cron del Worker (wrangler.production.jsonc). Tiene que coincidir con el que dispara la corrida. */
export const CRON_SERVIDOR = "1-19/2 0,4,8,12,16,20 * * *";

export const claveServidor = (estrategia: string, symbol: string, lado: Lado, vela: number) => `sv:${estrategia}:${symbol}:4h:${lado}:${vela}`;

/** Lee la clave de vuelta; null si no tiene la forma esperada. */
export function leerClaveServidor(clave: string): { estrategia: string; symbol: string; lado: Lado; vela: number } | null {
  const p = clave.split(":");
  if (p.length !== 6 || p[0] !== "sv" || p[3] !== "4h") return null;
  const vela = Number(p[5]);
  if (!Number.isInteger(vela) || vela <= 0 || (p[4] !== "LONG" && p[4] !== "SHORT")) return null;
  return { estrategia: p[1], symbol: p[2], lado: p[4], vela };
}

/** Qué moneda le toca a la corrida de esta hora: minuto 1 → la primera, minuto 3 → la segunda… Fuera de turno, null. */
export function monedaDeTurno(t: number): string | null {
  const d = new Date(t);
  if (d.getUTCHours() % 4 !== 0) return null;
  const m = d.getUTCMinutes();
  if (m < 1 || m % 2 === 0) return null;
  return MONEDAS_SERVIDOR[(m - 1) / 2] ?? null;
}

export type EntradaServidor = {
  clave: string;
  estrategia: string;
  symbol: string;
  lado: Lado;
  vela: number;
  detectada: number;
  entrada: number;
  stop: number;
  tp1: number;
  tp2: number;
  tp3: number;
  venue: string;
  consenso: { acuerdo: number; contra: number; con: string[] };
};

/**
 * Las entradas nuevas de una moneda. `velas` trae las cerradas y, al final, la vela de entrada que acaba de abrir (Kraken la
 * manda). Sin vela de entrada reciente no hay entradas: entrar tarde ya no sería la entrada que se mide.
 */
export function entradasServidor(symbol: string, velas: SwingCandle[], ahora: number, venue: string): EntradaServidor[] {
  const planes = leerSenalesPapel(symbol, velas, ahora);
  const acuerdos = consensoDe(planes.map((p) => ({ estrategia: p.estrategia, symbol, vela: p.vela, lado: p.lado })));
  return planes.map((p) => ({
    clave: claveServidor(p.estrategia, symbol, p.lado, p.vela),
    estrategia: p.estrategia,
    symbol,
    lado: p.lado,
    vela: p.vela,
    detectada: ahora,
    entrada: p.entrada,
    stop: p.escalera.stop,
    tp1: p.escalera.tp1,
    tp2: p.escalera.tp2,
    tp3: p.escalera.tp3,
    venue,
    consenso: fotoConsenso(acuerdos.get(`${p.estrategia}|${symbol}|${p.vela}`) ?? { acuerdo: 0, contra: 0, con: [] }),
  }));
}

export type AbiertaServidor = { clave: string; lado: Lado; vela: number; entrada: number; sl: number; tp1: number; tp2: number; tp3: number; tp1_at: number | null; tp2_at: number | null };

/**
 * Recorre las abiertas con las velas ya cerradas (la misma escalera y las mismas reglas que el resto de los agentes: si una
 * vela toca stop y objetivo, cuenta el stop). Devuelve solo las que cambiaron: cerraron o tocaron un objetivo nuevo.
 */
export function avancesServidor(abiertas: AbiertaServidor[], velas: SwingCandle[], ahora: number): { clave: string; recorrido: Recorrido }[] {
  const out: { clave: string; recorrido: Recorrido }[] = [];
  for (const a of abiertas) {
    const rec = recorrer(a.lado, a.entrada, { stop: a.sl, tp1: a.tp1, tp2: a.tp2, tp3: a.tp3 }, a.vela, velas, MARCO_AGENTES_MS, ahora, { horizonte: HORIZONTE_AGENTES, feePct: COMISION_AGENTES_PCT });
    const cambio = rec.desenlace !== "ABIERTA" || (rec.tp1At !== null && a.tp1_at === null) || (rec.tp2At !== null && a.tp2_at === null);
    if (cambio) out.push({ clave: a.clave, recorrido: rec });
  }
  return out;
}
