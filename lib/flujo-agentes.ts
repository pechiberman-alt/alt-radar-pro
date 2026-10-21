/**
 * Los agentes de flujo de órdenes (PLAN_FLUJO_AGENTES_1): cinco lecturas clásicas del orderflow, con números fijados antes
 * de medir y una sola idea por agente. Tres se leen con velas y volumen (se pueden medir en el historial); dos necesitan el
 * volumen agresor comprador de cada vela (taker buy de Binance, campo 9 de la vela) y se miden solo hacia adelante: el
 * historial del estudio no lo trae, y Kraken tampoco (en el servidor esos dos no disparan).
 *
 * - ABSORCION: la vela hace el extremo de 20 velas con volumen doble y cierra lejos de ese extremo: alguien absorbió.
 * - ESFUERZO: después de un tramo de 2 ATR, una vela con volumen 2,5 veces mayor apenas se mueve: esfuerzo sin resultado.
 * - BARRIDA_VOL: la vela pasa el mínimo (o máximo) de las 20 velas anteriores con volumen y cierra de vuelta adentro.
 * - DELTA_DIV: nuevo extremo de precio con el delta acumulado (CVD) sin acompañar: la agresión se agota.
 * - DELTA_ABSORBIDO: venta (o compra) agresiva fuerte en la vela, y aun así el precio cierra para el otro lado.
 * Stop a 0,25 ATR del extremo de la vela (de las velas del tramo, en ESFUERZO), objetivo 2 R, como el resto del estudio.
 * Pura y causal: cada señal usa solo velas hasta la suya.
 */
import type { Lado } from "./escalera.ts";
import type { SwingCandle } from "./swing-entries.ts";

export const PLAN_FLUJO_AGENTES = "PLAN_FLUJO_AGENTES_1";
export const VENTANA_EXTREMO = 20;
export const VOL_ABSORCION = 2;
/** En ABSORCION, dónde tiene que cerrar dentro de su rango (desde el extremo): más allá del 60 %. */
export const CIERRE_ABSORCION = 0.6;
export const TRAMO_ESFUERZO = 5;
export const TRAMO_ESFUERZO_ATR = 2;
export const VOL_ESFUERZO = 2.5;
export const RANGO_ESFUERZO_ATR = 0.7;
export const VOL_BARRIDA = 1.5;
export const VENTANA_CVD = 30;
/** En DELTA_ABSORBIDO: delta de la vela sobre su volumen, en contra (−0,25 = 62,5 % del volumen fue venta agresiva). */
export const DELTA_FUERTE = 0.25;
export const VOL_DELTA = 1.8;
export const MARGEN_FLUJO_ATR = 0.25;
export const RR_FLUJO = 2;

export type SenalFlujo = { lado: Lado; stop: number; objetivo: number };

const ok = (...xs: number[]) => xs.every((x) => Number.isFinite(x));
const conRR = (lado: Lado, entrada: number, stop: number): SenalFlujo | null => {
  const riesgo = Math.abs(entrada - stop);
  if (!(riesgo > 0) || (lado === "LONG" ? stop >= entrada : stop <= entrada)) return null;
  return { lado, stop, objetivo: lado === "LONG" ? entrada + RR_FLUJO * riesgo : entrada - RR_FLUJO * riesgo };
};
/** Dónde cerró la vela dentro de su rango: 0 en el mínimo, 1 en el máximo. */
const posicionCierre = (c: SwingCandle) => (c.high > c.low ? (c.close - c.low) / (c.high - c.low) : 0.5);
const minimo = (v: SwingCandle[], desde: number, hasta: number) => {
  let m = Number.POSITIVE_INFINITY;
  for (let k = desde; k <= hasta; k += 1) m = Math.min(m, v[k].low);
  return m;
};
const maximo = (v: SwingCandle[], desde: number, hasta: number) => {
  let m = Number.NEGATIVE_INFINITY;
  for (let k = desde; k <= hasta; k += 1) m = Math.max(m, v[k].high);
  return m;
};

/** El delta de una vela (compra agresiva − venta agresiva, en unidades del activo), o null si la vela no trae el dato. */
export function deltaDe(c: SwingCandle): number | null {
  const t = c.takerBuy;
  if (typeof t !== "number" || !Number.isFinite(t) || !(c.volume > 0) || t < 0 || t > c.volume * 1.0001) return null;
  return 2 * t - c.volume;
}

/** ABSORCION: extremo de 20 velas con volumen doble y cierre lejos del extremo. */
export function senalAbsorcion(v: SwingCandle[], atr: number[], volRel: number[], i: number): SenalFlujo | null {
  if (i < VENTANA_EXTREMO || !ok(atr[i], volRel[i]) || volRel[i] < VOL_ABSORCION) return null;
  const c = v[i];
  const p = posicionCierre(c);
  if (c.low < minimo(v, i - VENTANA_EXTREMO, i - 1) && p >= CIERRE_ABSORCION) return conRR("LONG", c.close, c.low - MARGEN_FLUJO_ATR * atr[i]);
  if (c.high > maximo(v, i - VENTANA_EXTREMO, i - 1) && p <= 1 - CIERRE_ABSORCION) return conRR("SHORT", c.close, c.high + MARGEN_FLUJO_ATR * atr[i]);
  return null;
}

/** ESFUERZO: tras un tramo de 2 ATR en 5 velas, una vela de volumen 2,5 veces mayor y rango chico que cierra en contra. */
export function senalEsfuerzo(v: SwingCandle[], atr: number[], volRel: number[], i: number): SenalFlujo | null {
  if (i < TRAMO_ESFUERZO + 1 || !ok(atr[i], volRel[i]) || volRel[i] < VOL_ESFUERZO) return null;
  const c = v[i];
  if (c.high - c.low > RANGO_ESFUERZO_ATR * atr[i]) return null;
  const tramo = c.close - v[i - TRAMO_ESFUERZO].close;
  const p = posicionCierre(c);
  if (tramo >= TRAMO_ESFUERZO_ATR * atr[i] && p <= 0.5) return conRR("SHORT", c.close, maximo(v, i - 2, i) + MARGEN_FLUJO_ATR * atr[i]);
  if (tramo <= -TRAMO_ESFUERZO_ATR * atr[i] && p >= 0.5) return conRR("LONG", c.close, minimo(v, i - 2, i) - MARGEN_FLUJO_ATR * atr[i]);
  return null;
}

/** BARRIDA_VOL: pasa el extremo de las 20 velas anteriores con volumen y cierra de vuelta adentro, del lado de la vuelta. */
export function senalBarridaVol(v: SwingCandle[], atr: number[], volRel: number[], i: number): SenalFlujo | null {
  if (i < VENTANA_EXTREMO + 1 || !ok(atr[i], volRel[i]) || volRel[i] < VOL_BARRIDA) return null;
  const c = v[i];
  const bajo = minimo(v, i - VENTANA_EXTREMO, i - 1);
  const alto = maximo(v, i - VENTANA_EXTREMO, i - 1);
  if (c.low < bajo && c.close > bajo && posicionCierre(c) >= 0.5) return conRR("LONG", c.close, c.low - MARGEN_FLUJO_ATR * atr[i]);
  if (c.high > alto && c.close < alto && posicionCierre(c) <= 0.5) return conRR("SHORT", c.close, c.high + MARGEN_FLUJO_ATR * atr[i]);
  return null;
}

/** DELTA_DIV: nuevo extremo de 20 velas sin que el delta acumulado (CVD de las últimas 30) lo acompañe. Necesita taker buy. */
export function senalDeltaDiv(v: SwingCandle[], atr: number[], i: number): SenalFlujo | null {
  if (i < VENTANA_CVD || !ok(atr[i])) return null;
  const cvd = new Map<number, number>();
  let acum = 0;
  for (let k = i - VENTANA_CVD + 1; k <= i; k += 1) {
    const d = deltaDe(v[k]);
    if (d === null) return null;
    acum += d;
    cvd.set(k, acum);
  }
  const c = v[i];
  const desde = i - VENTANA_EXTREMO;
  let jBajo = desde;
  let jAlto = desde;
  for (let k = desde; k < i; k += 1) {
    if (v[k].low < v[jBajo].low) jBajo = k;
    if (v[k].high > v[jAlto].high) jAlto = k;
  }
  const cvdI = cvd.get(i) as number;
  const cvdBajo = cvd.get(jBajo);
  const cvdAlto = cvd.get(jAlto);
  if (c.low < v[jBajo].low && cvdBajo !== undefined && cvdI > cvdBajo && c.close > c.open) return conRR("LONG", c.close, c.low - MARGEN_FLUJO_ATR * atr[i]);
  if (c.high > v[jAlto].high && cvdAlto !== undefined && cvdI < cvdAlto && c.close < c.open) return conRR("SHORT", c.close, c.high + MARGEN_FLUJO_ATR * atr[i]);
  return null;
}

/** DELTA_ABSORBIDO: venta agresiva fuerte con volumen, y el precio cierra arriba (o al revés). Necesita taker buy. */
export function senalDeltaAbsorbido(v: SwingCandle[], atr: number[], volRel: number[], i: number): SenalFlujo | null {
  if (!ok(atr[i], volRel[i]) || volRel[i] < VOL_DELTA) return null;
  const c = v[i];
  const d = deltaDe(c);
  if (d === null) return null;
  const rel = d / c.volume;
  const p = posicionCierre(c);
  if (rel <= -DELTA_FUERTE && c.close >= c.open && p >= 0.5) return conRR("LONG", c.close, c.low - MARGEN_FLUJO_ATR * atr[i]);
  if (rel >= DELTA_FUERTE && c.close <= c.open && p <= 0.5) return conRR("SHORT", c.close, c.high + MARGEN_FLUJO_ATR * atr[i]);
  return null;
}
