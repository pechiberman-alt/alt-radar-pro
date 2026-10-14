/**
 * El agente de papel «Supertrend MTF + Volumen» (PLAN_ST_1): la estrategia que el estudio del laboratorio midió en el
 * pasado (lib/estrategias.ts, id ST_MTF_VOL) corriendo hacia adelante, solo en papel. Mira las 10 monedas del estudio en
 * velas de 4 h ya cerradas; opera solo largos y solo con el régimen alcista de BTC (BTC sobre su media de 200 días y la de
 * 50 días sobre la de 200). Entra a la apertura de la vela que sigue a la señal, y su plan lleva SL, TP1, TP2 y TP3
 * fijados al abrir (lib/escalera.ts): el TP3 está a 2 R y TP1 y TP2 a un tercio y dos tercios del camino. Se mide con las
 * velas que ya cerraron; si una vela toca stop y objetivo, cuenta el stop. La regla se fijó antes de medirla hacia
 * adelante y solo cambia por un PR revisado. Cada entrada guarda una «foto» de condiciones (volumen, marco superior,
 * IDM, compras agresivas) que NO filtra nada: sirve para estudiar después qué separa las ganadoras de las perdedoras.
 * Pura: no lee la base ni la red. No manda órdenes.
 */
import { escaleraHacia, type Lado } from "./escalera.ts";
import { ema, ESTRATEGIAS, indicadores } from "./estrategias.ts";
import { findInducements } from "./inducement.ts";
import type { SwingCandle } from "./swing-entries.ts";

export const PLAN_ST = "PLAN_ST_1";
export const MARCO_ST = "4h";
export const MARCO_ST_MS = 4 * 3_600_000;
/** Velas que se miran hacia adelante: 48 de 4 horas, ocho días, igual que el estudio. */
export const HORIZONTE_ST = 48;
/** Comisión más deslizamiento por lado, igual que el estudio. */
export const COMISION_ST_PCT = 0.07;
/** Solo se registra si la vela de entrada abrió hace menos de media hora: entrar mucho después ya no es esa entrada. */
export const VENTANA_ENTRADA_ST_MS = 30 * 60_000;
export const MONEDAS_ST = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "TRXUSDT", "BCHUSDT", "ZECUSDT"];
/** Velas de 4 h que se piden: 1.500 por moneda alcanza para la EMA 200 y el marco superior; BTC pide el doble para su EMA de 200 días. */
export const VELAS_ST = 1500;
export const VELAS_BTC_ST = 3000;

/** Las condiciones del momento de la señal. Solo se guardan; no deciden nada. */
export type FotoSt = {
  /** Volumen de la vela de señal sobre el promedio de las 20 anteriores. */
  volRel: number;
  /** Dirección del Supertrend del marco superior (1 alcista). */
  htf: number;
  /** 1 si en las últimas 20 velas se barrió un IDM alcista; 0 si no. */
  idm: number;
  /** Parte del volumen de la vela de señal que fue compra agresiva (0 a 1); null si el dato no llegó. */
  compras: number | null;
};

export type PlanSt = {
  symbol: string;
  lado: Lado;
  /** Apertura de la vela de la señal (ya cerrada): desde ahí se miden las siguientes, la de entrada incluida. */
  vela: number;
  /** Apertura de la vela de entrada. */
  velaEntrada: number;
  entrada: number;
  stop: number;
  objetivo: number;
  foto: FotoSt;
};

/** El régimen de BTC en la vela `i`: cierre sobre su media de 200 días y la de 50 días sobre la de 200 (EMA 1200 y 300 de 4 h). */
export function regimenAlcistaBtc(btc: SwingCandle[]): boolean[] {
  const c = btc.map((x) => x.close);
  const larga = ema(c, 1200);
  const media = ema(c, 300);
  return c.map((x, i) => Number.isFinite(larga[i]) && Number.isFinite(media[i]) && x > larga[i] && media[i] > larga[i]);
}

/** La clave de una entrada: una por moneda y vela de señal, así que reintentar no la duplica. */
export const claveSt = (symbol: string, vela: number) => `st:${symbol}:${MARCO_ST}:LONG:${vela}`;

const ESTRATEGIA_ST = ESTRATEGIAS.find((e) => e.id === "ST_MTF_VOL");

/**
 * La entrada que sale de la última vela cerrada, o null. `velas` trae las cerradas y, al final, la vela de entrada que
 * acaba de abrir; `btc` trae las de BTC con el mismo criterio. `compras` es la parte de compra agresiva de la vela de
 * señal, si se la pudo leer. Solo usa velas cerradas hasta la de la señal y la apertura de la vela de entrada.
 */
export function leerSenalSt(symbol: string, velas: SwingCandle[], btc: SwingCandle[], ahora: number, compras: number | null = null): PlanSt | null {
  if (!ESTRATEGIA_ST || velas.length < 3) return null;
  const entradaVela = velas[velas.length - 1];
  const cerradas = velas.slice(0, -1);
  const senal = cerradas[cerradas.length - 1];
  if (entradaVela.openTime !== senal.openTime + MARCO_ST_MS) return null;
  if (senal.openTime + MARCO_ST_MS > ahora) return null;
  if (ahora - entradaVela.openTime > VENTANA_ENTRADA_ST_MS) return null;
  const i = cerradas.length - 1;
  const ind = indicadores(cerradas);
  const s = ESTRATEGIA_ST.senal(cerradas, ind, i);
  if (!s || s.lado !== "LONG") return null;
  // El régimen de BTC se mira en la misma vela de señal (ya cerrada).
  const btcCerradas = btc.filter((x) => x.openTime + MARCO_ST_MS <= ahora);
  const j = btcCerradas.findIndex((x) => x.openTime === senal.openTime);
  if (j < 0 || !regimenAlcistaBtc(btcCerradas)[j]) return null;
  // Igual que en el estudio: el riesgo y el objetivo mantienen su distancia en R desde la apertura de entrada.
  const entrada = entradaVela.open;
  const riesgo = Math.abs(senal.close - s.stop);
  const rr = Math.abs(s.objetivo - senal.close) / riesgo;
  if (!(entrada > 0) || !(riesgo > 0) || !Number.isFinite(rr)) return null;
  const stop = entrada - riesgo;
  const objetivo = entrada + rr * riesgo;
  if (!escaleraHacia("LONG", entrada, stop, objetivo)) return null;
  const idm = findInducements(cerradas).some((x) => x.side === "ALCISTA" && x.sweptIndex !== null && x.sweptIndex <= i && i - x.sweptIndex <= 20);
  return {
    symbol,
    lado: "LONG",
    vela: senal.openTime,
    velaEntrada: entradaVela.openTime,
    entrada,
    stop,
    objetivo,
    foto: { volRel: ind.volRel[i], htf: ind.htfDir[i], idm: idm ? 1 : 0, compras },
  };
}

export type SenalSt = {
  clave: string;
  symbol: string;
  lado: Lado;
  vela: number;
  detectada: number;
  entrada: number;
  stop: number;
  tp1: number;
  tp2: number;
  tp3: number;
  foto: FotoSt;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Lo que manda el navegador, revisado: moneda del estudio, solo largos, hora reciente y dentro de la ventana de la vela de
 * entrada, y precios con la forma de la regla (objetivo a 2 R del stop). La escalera se vuelve a calcular aquí desde
 * entrada, stop y objetivo, así que el navegador no puede inventar TP1 ni TP2. La foto solo guarda números.
 */
export function validarSenalSt(raw: unknown, ahora: number): SenalSt | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const symbol = typeof o.symbol === "string" ? o.symbol : "";
  const entrada = num(o.entrada);
  const stop = num(o.stop);
  const objetivo = num(o.objetivo);
  const vela = num(o.vela);
  const detectada = num(o.detectada);
  if (!MONEDAS_ST.includes(symbol) || o.lado !== "LONG" || entrada === null || stop === null || objetivo === null || vela === null || detectada === null) return null;
  if (Math.abs(detectada - ahora) > 2 * 60_000) return null;
  if (!Number.isInteger(vela) || vela % MARCO_ST_MS !== 0) return null;
  const velaEntrada = vela + MARCO_ST_MS;
  if (ahora < velaEntrada || ahora - velaEntrada > VENTANA_ENTRADA_ST_MS + 2 * 60_000) return null;
  if (!(entrada > 0) || !(stop > 0) || !(objetivo > 0)) return null;
  const riesgo = entrada - stop;
  if (!(riesgo > 0) || riesgo / entrada > 0.25 || Math.abs((objetivo - entrada) / riesgo - 2) > 0.01) return null;
  const e = escaleraHacia("LONG", entrada, stop, objetivo);
  if (!e) return null;
  const f = (o.foto && typeof o.foto === "object" ? o.foto : {}) as Record<string, unknown>;
  const foto: FotoSt = { volRel: num(f.volRel) ?? Number.NaN, htf: num(f.htf) ?? Number.NaN, idm: f.idm === 1 ? 1 : 0, compras: num(f.compras) };
  if (!Number.isFinite(foto.volRel) || foto.volRel < 1.5 || foto.htf !== 1) return null;
  return { clave: claveSt(symbol, vela), symbol, lado: "LONG", vela, detectada, entrada, stop, tp1: e.tp1, tp2: e.tp2, tp3: e.tp3, foto };
}
