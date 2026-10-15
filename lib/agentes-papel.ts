/**
 * Todos los agentes del estudio corriendo hacia adelante en papel (PLAN_AGENTES_1). Hasta ahora solo uno se medía hacia
 * adelante; el resto solo tenía su medición del pasado, que ya se miró al diseñar las reglas. La medición hacia adelante es
 * la única prueba limpia, así que la hacen todos.
 *
 * Dos decisiones fijadas de antemano, para que esta medición valga:
 * 1. TODOS corren en velas de 4 h, no cada uno en la temporalidad donde mejor le fue: elegir la temporalidad mirando el
 *    resultado pasado es el mismo sesgo que el estudio evita. Además todos leen las MISMAS velas, así que sumar agentes no
 *    cuesta ninguna descarga más.
 * 2. Cada agente corre su regla del estudio tal cual (lib/estrategias.ts), sin filtros extra. El agente PLAN_ST_1
 *    (lib/agente-st.ts) sigue aparte con su filtro de régimen de BTC: son dos reglas distintas y se miden por separado.
 *
 * Entra a la apertura de la vela siguiente a la señal y fija SL, TP1, TP2 y TP3 al abrir (lib/escalera.ts). Si una vela toca
 * stop y objetivo, cuenta el stop. La regla no cambia para mejorar los números: solo por un PR revisado. Pura: sin red ni base.
 */
import { escaleraHacia, type Escalera, type Lado } from "./escalera.ts";
import { ESTRATEGIAS, indicadores, type EstrategiaId } from "./estrategias.ts";
import type { SwingCandle } from "./swing-entries.ts";

export const PLAN_AGENTES = "PLAN_AGENTES_1";
export const MARCO_AGENTES = "4h";
export const MARCO_AGENTES_MS = 4 * 3_600_000;
/** Velas hacia adelante que se miran, igual que el estudio: 48 de 4 h, ocho días. */
export const HORIZONTE_AGENTES = 48;
/** Comisión más deslizamiento por lado, igual que el estudio. */
export const COMISION_AGENTES_PCT = 0.07;
/** Solo se registra si la vela de entrada abrió hace menos de media hora: entrar mucho después ya no es esa entrada. */
export const VENTANA_ENTRADA_AGENTES_MS = 30 * 60_000;
export const MONEDAS_AGENTES = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "TRXUSDT", "BCHUSDT", "ZECUSDT"];
/** Velas de 4 h que se piden por moneda: alcanzan para la EMA 200 y el marco superior de cualquier agente. */
export const VELAS_AGENTES = 1500;

/**
 * Los agentes que corren en papel: todas las estrategias del estudio salvo el control al azar, que no tiene sentido correr
 * hacia adelante (entra por sorteo, así que su resultado futuro no dice nada de ninguna regla).
 */
export const AGENTES_PAPEL: EstrategiaId[] = ESTRATEGIAS.map((e) => e.id).filter((id) => id !== "AZAR");

/** La clave de una entrada: una por agente, moneda y vela, así que reintentar no la duplica. */
export const clavePapel = (estrategia: string, symbol: string, lado: Lado, vela: number) => `ag:${estrategia}:${symbol}:${MARCO_AGENTES}:${lado}:${vela}`;

/** Lee la clave de vuelta; null si no tiene la forma esperada. */
export function leerClavePapel(clave: string): { estrategia: string; symbol: string; marco: string; lado: Lado; vela: number } | null {
  const p = clave.split(":");
  if (p.length !== 6 || p[0] !== "ag") return null;
  const vela = Number(p[5]);
  if (!Number.isInteger(vela) || vela <= 0) return null;
  if (p[4] !== "LONG" && p[4] !== "SHORT") return null;
  return { estrategia: p[1], symbol: p[2], marco: p[3], lado: p[4], vela };
}

export type PlanPapel = {
  estrategia: EstrategiaId;
  symbol: string;
  lado: Lado;
  /** Apertura de la vela de la señal (ya cerrada). */
  vela: number;
  /** Apertura de la vela de entrada. */
  velaEntrada: number;
  entrada: number;
  stop: number;
  objetivo: number;
  escalera: Escalera;
};

/**
 * Las entradas de todos los agentes para una moneda, a partir de la última vela cerrada. `velas` trae las cerradas y, al
 * final, la vela de entrada que acaba de abrir. Los indicadores se calculan una sola vez para todos los agentes: cada
 * estrategia usa solo velas hasta la de la señal (lo prueba tests/practica-gatillo.test.ts para todas).
 */
export function leerSenalesPapel(symbol: string, velas: SwingCandle[], ahora: number): PlanPapel[] {
  if (velas.length < 3) return [];
  const entradaVela = velas[velas.length - 1];
  const cerradas = velas.slice(0, -1);
  const senal = cerradas[cerradas.length - 1];
  if (entradaVela.openTime !== senal.openTime + MARCO_AGENTES_MS) return [];
  if (senal.openTime + MARCO_AGENTES_MS > ahora) return [];
  if (ahora - entradaVela.openTime > VENTANA_ENTRADA_AGENTES_MS) return [];

  const i = cerradas.length - 1;
  const ind = indicadores(cerradas);
  const out: PlanPapel[] = [];
  for (const id of AGENTES_PAPEL) {
    const e = ESTRATEGIAS.find((x) => x.id === id);
    if (!e) continue;
    const s = e.senal(cerradas, ind, i);
    if (!s) continue;
    // Igual que el estudio: el riesgo y el objetivo mantienen su distancia en R desde la apertura de entrada.
    const entrada = entradaVela.open;
    const riesgo = Math.abs(senal.close - s.stop);
    const rr = Math.abs(s.objetivo - senal.close) / riesgo;
    if (!(entrada > 0) || !(riesgo > 0) || !Number.isFinite(rr)) continue;
    const signo = s.lado === "LONG" ? 1 : -1;
    const stop = entrada - signo * riesgo;
    const objetivo = entrada + signo * rr * riesgo;
    const escalera = escaleraHacia(s.lado, entrada, stop, objetivo);
    if (!escalera) continue;
    out.push({ estrategia: id, symbol, lado: s.lado, vela: senal.openTime, velaEntrada: entradaVela.openTime, entrada, stop, objetivo, escalera });
  }
  return out;
}

export type SenalPapel = {
  clave: string;
  estrategia: string;
  symbol: string;
  lado: Lado;
  vela: number;
  detectada: number;
  entrada: number;
  stop: number;
  objetivo: number;
  tp1: number;
  tp2: number;
  tp3: number;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** Riesgo máximo por operación como parte de la entrada: más que esto no es un plan, es un error de datos. */
const RIESGO_MAX = 0.25;
const RR_MIN = 0.3;
const RR_MAX = 12;

/**
 * Lo que manda el navegador, revisado en el servidor: agente y moneda de la lista, vela alineada al marco, hora dentro de la
 * ventana de entrada y precios con forma de plan. La escalera se vuelve a calcular acá, así que el navegador no puede
 * inventar TP1 ni TP2.
 *
 * Límite honesto: el servidor no tiene las velas, así que puede comprobar que el plan está bien formado pero NO que la señal
 * realmente disparó. Por eso esto mide una regla fijada de antemano; no es a prueba de alguien que quiera falsear su propio
 * registro.
 */
export function validarSenalPapel(raw: unknown, ahora: number): SenalPapel | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const estrategia = typeof o.estrategia === "string" ? o.estrategia : "";
  const symbol = typeof o.symbol === "string" ? o.symbol : "";
  const lado = o.lado === "LONG" || o.lado === "SHORT" ? o.lado : null;
  const entrada = num(o.entrada);
  const stop = num(o.stop);
  const objetivo = num(o.objetivo);
  const vela = num(o.vela);
  const detectada = num(o.detectada);
  if (!(AGENTES_PAPEL as string[]).includes(estrategia) || !MONEDAS_AGENTES.includes(symbol)) return null;
  if (!lado || entrada === null || stop === null || objetivo === null || vela === null || detectada === null) return null;
  if (Math.abs(detectada - ahora) > 2 * 60_000) return null;
  if (!Number.isInteger(vela) || vela % MARCO_AGENTES_MS !== 0) return null;
  const velaEntrada = vela + MARCO_AGENTES_MS;
  if (ahora < velaEntrada || ahora - velaEntrada > VENTANA_ENTRADA_AGENTES_MS + 2 * 60_000) return null;
  if (!(entrada > 0) || !(stop > 0) || !(objetivo > 0)) return null;
  const riesgo = Math.abs(entrada - stop);
  if (!(riesgo > 0) || riesgo / entrada > RIESGO_MAX) return null;
  const rr = Math.abs(objetivo - entrada) / riesgo;
  if (!(rr >= RR_MIN) || !(rr <= RR_MAX)) return null;
  const e = escaleraHacia(lado, entrada, stop, objetivo);
  if (!e) return null;
  return { clave: clavePapel(estrategia, symbol, lado, vela), estrategia, symbol, lado, vela, detectada, entrada, stop, objetivo, tp1: e.tp1, tp2: e.tp2, tp3: e.tp3 };
}
