import type { PumpCandle, PumpStage } from "./pump-radar.ts";

/**
 * A trade plan for each pump stage, from the same 5-minute candles the radar
 * reads. Rules, not predictions — and the rules change with the stage,
 * because a pump is cheapest to join before it starts and most dangerous to
 * join at its top:
 *
 *   ACUMULACIÓN   wait for the break: buy stop just above the range's high,
 *                 stop inside the range.
 *   IGNICIÓN      early entry at the price, stop under the last candles; if
 *                 that stop is more than 3 ATR away, wait for the retest of
 *                 the broken high instead.
 *   PUMP ACTIVO   do not chase: a limit on the pullback to the 20-candle
 *                 average, first target at the recent high.
 *   CLÍMAX / DISTRIBUCIÓN   no entry: this is where pumps give back.
 *
 * Targets are in R (multiples of the risk). The plan has not been measured
 * against history yet; the card says so.
 */

export type PumpAction = "ESPERAR RUPTURA" | "ENTRADA" | "ESPERAR RETROCESO" | "NO ENTRAR";
export type PumpPlan = {
  action: PumpAction;
  /** "stop" = buy stop above price; "limit" = buy limit below price; "market" = at the price. */
  orderType: "stop" | "limit" | "market" | null;
  entry: number | null;
  stop: number | null;
  targets: number[];
  note: string;
};

function atr(c: PumpCandle[], n = 14): number {
  let s = 0;
  let k = 0;
  for (let i = Math.max(1, c.length - n); i < c.length; i += 1) {
    s += Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
    k += 1;
  }
  return k ? s / k : 0;
}

function ema(values: number[], n: number): number {
  const k = 2 / (n + 1);
  return values.reduce((prev, v, i) => (i === 0 ? v : v * k + prev * (1 - k)), values[0] ?? 0);
}

const rTargets = (entry: number, stop: number, rs: number[]) => rs.map((r) => entry + r * (entry - stop));

export function pumpPlan(stage: PumpStage, candles: PumpCandle[]): PumpPlan | null {
  if (candles.length < 30 || stage === "SIN PUMP") return null;
  const a = atr(candles);
  if (!(a > 0)) return null;
  const last = candles[candles.length - 1];
  // The base: the two hours before the last three candles.
  const base = candles.slice(-27, -3);
  const baseHigh = Math.max(...base.map((c) => c.high));
  const baseLow = Math.min(...base.map((c) => c.low));
  const recentHigh = Math.max(...candles.slice(-12).map((c) => c.high));

  if (stage === "CLÍMAX" || stage === "DISTRIBUCIÓN") {
    return { action: "NO ENTRAR", orderType: null, entry: null, stop: null, targets: [], note: "Es la etapa donde los pumps devuelven lo ganado: entrar acá es comprarle a los que salen." };
  }
  if (stage === "ACUMULACIÓN") {
    const entry = baseHigh + 0.1 * a;
    // Inside the range, never further than a tenth of an ATR under its floor.
    const stop = Math.max(baseLow - 0.1 * a, entry - Math.max(1.2 * a, (baseHigh - baseLow) * 0.5));
    return { action: "ESPERAR RUPTURA", orderType: "stop", entry, stop, targets: rTargets(entry, stop, [1.5, 2.5, 4]), note: "Orden de compra stop justo arriba del techo del rango: solo entra si rompe." };
  }
  if (stage === "IGNICIÓN") {
    const stop = Math.min(...candles.slice(-3).map((c) => c.low)) - 0.2 * a;
    if (last.close - stop <= 3 * a) {
      return { action: "ENTRADA", orderType: "market", entry: last.close, stop, targets: rTargets(last.close, stop, [1.5, 2.5, 4]), note: "Fase temprana: entrada al precio con stop debajo de las últimas velas." };
    }
    const entry = baseHigh;
    const s2 = entry - 1.5 * a;
    return { action: "ESPERAR RETROCESO", orderType: "limit", entry, stop: s2, targets: rTargets(entry, s2, [1.5, 2.5, 4]), note: "El stop al precio quedaría muy lejos: mejor esperar que vuelva a probar el techo roto." };
  }
  // PUMP ACTIVO: do not chase.
  const entry = Math.min(last.close, ema(candles.map((c) => c.close), 20));
  const stop = entry - 1.5 * a;
  const r = entry - stop;
  const first = recentHigh - entry >= r ? recentHigh : entry + 1.5 * r;
  return { action: "ESPERAR RETROCESO", orderType: "limit", entry, stop, targets: [first, entry + 2.5 * r, entry + 4 * r], note: "No perseguir: compra límite en el retroceso a la media de 20 velas; primer objetivo en el máximo reciente." };
}
