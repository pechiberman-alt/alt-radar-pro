import type { SwingCandle } from "./swing-entries.ts";

/**
 * Pre-pump pressure: which assets are coiled, not which are running.
 *
 * The existing pump radar reads a move already underway — ignition, climax,
 * distribution. This measures the state BEFORE that: the conditions that tend
 * to precede a violent move, ranked across assets so they can be compared at
 * a glance.
 *
 * THE HONEST LIMIT, AND WHY IT SHAPES THE OUTPUT
 *
 * Compression does not have a direction. A market that has coiled for days
 * will move hard — that part is well founded, because volatility clusters and
 * mean-reverts. Which WAY it breaks is a separate question, and anything
 * claiming to know is selling something. So this reports two numbers instead
 * of one:
 *
 *   - PRESIÓN: how loaded the spring is. Direction-free, and the part that
 *     rests on the firmer ground.
 *   - SESGO: whether positioning leans long or short, from open interest and
 *     funding. Weaker evidence, reported separately, never folded into the
 *     pressure score to make it look more decisive than it is.
 *
 * Merging them would produce one confident-looking number built half from
 * something solid and half from something speculative, and the reader would
 * have no way to tell which half was doing the work.
 */

export type PressureFactors = {
  /** Recent range against its own baseline. Below 1 means coiled. */
  compression: number;
  /** Volume relative to its baseline while price goes nowhere. */
  quietAccumulation: number;
  /** Candles spent inside the current range. */
  baseLength: number;
  /** Change in open interest over the window, as a share. Null when unknown. */
  oiChange: number | null;
  /** Latest funding rate. Null when unknown. */
  funding: number | null;
};

export type PressureReading = {
  symbol: string;
  /** 0–100. Higher means more coiled. Direction-free. */
  pressure: number;
  /** −100..100. Positive leans long. Separate from pressure on purpose. */
  bias: number;
  biasLabel: "SESGO LARGO" | "SESGO CORTO" | "SIN SESGO";
  factors: PressureFactors;
  /** What is actually driving the score, strongest first. */
  drivers: string[];
  note: string;
};

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function trueRanges(candles: SwingCandle[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const previousClose = candles[i - 1].close;
    out.push(
      Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - previousClose),
        Math.abs(candles[i].low - previousClose),
      ),
    );
  }
  return out;
}

export type PressureInput = {
  symbol: string;
  candles: SwingCandle[];
  /** Share change in open interest over the recent window, if known. */
  oiChange?: number | null;
  /** Latest funding rate, if known. */
  funding?: number | null;
};

export function readPressure(input: PressureInput): PressureReading | null {
  const { candles } = input;
  if (candles.length < 60) return null;

  const ranges = trueRanges(candles);
  const recent = ranges.slice(-14);
  const baseline = ranges.slice(-60, -14);
  const recentAtr = average(recent);
  const baseAtr = average(baseline);
  if (!(recentAtr > 0) || !(baseAtr > 0)) return null;

  // Below 1 means the recent range is tighter than its own history.
  const compression = recentAtr / baseAtr;

  const recentVolume = average(candles.slice(-14).map((candle) => candle.volume));
  const baseVolume = average(candles.slice(-60, -14).map((candle) => candle.volume));
  const volumeRatio = baseVolume > 0 ? recentVolume / baseVolume : 1;

  // Price going nowhere while volume holds up is the shape of accumulation:
  // someone is trading size without moving the tape.
  const windowHigh = Math.max(...candles.slice(-14).map((candle) => candle.high));
  const windowLow = Math.min(...candles.slice(-14).map((candle) => candle.low));
  const rangeSpan = windowHigh > 0 ? (windowHigh - windowLow) / windowHigh : 1;
  const quietAccumulation = rangeSpan > 0 ? volumeRatio / (1 + rangeSpan * 20) : volumeRatio;

  // How long price has held inside the current band.
  let baseLength = 0;
  for (let i = candles.length - 1; i >= 0; i -= 1) {
    if (candles[i].high <= windowHigh * 1.003 && candles[i].low >= windowLow * 0.997) {
      baseLength += 1;
    } else break;
  }

  const oiChange = input.oiChange ?? null;
  const funding = input.funding ?? null;

  // Pressure: compression carries most of it, because volatility clustering
  // is the best-supported part of this. The rest adds context.
  const compressionScore = Math.max(0, Math.min(1, (1.2 - compression) / 0.9)) * 55;
  const accumulationScore = Math.max(0, Math.min(1, (quietAccumulation - 0.6) / 1.2)) * 25;
  const baseScore = Math.min(1, baseLength / 30) * 20;
  const pressure = Math.round(compressionScore + accumulationScore + baseScore);

  const drivers: string[] = [];
  if (compressionScore > 30) drivers.push(`rango ${((1 - compression) * 100).toFixed(0)}% más angosto que su media`);
  if (accumulationScore > 12) drivers.push("volumen sostenido sin que el precio avance");
  if (baseScore > 12) drivers.push(`${baseLength} velas dentro del mismo rango`);

  // Bias, kept apart. Open interest rising while price is flat means
  // positions are being built; funding says who is paying to hold them.
  let bias = 0;
  if (oiChange !== null) bias += Math.max(-50, Math.min(50, oiChange * 500));
  if (funding !== null) {
    // Negative funding means shorts pay longs — crowded shorts are fuel for
    // an upward squeeze, so it leans the bias long.
    bias += Math.max(-50, Math.min(50, -funding * 50_000));
  }
  bias = Math.round(Math.max(-100, Math.min(100, bias)));

  const biasLabel: PressureReading["biasLabel"] =
    bias >= 25 ? "SESGO LARGO" : bias <= -25 ? "SESGO CORTO" : "SIN SESGO";

  const note =
    pressure >= 65
      ? "Muy comprimido. Un rango así de angosto rara vez dura: lo probable es un movimiento fuerte, no que siga quieto. Hacia dónde es otra pregunta."
      : pressure >= 40
        ? "Algo comprimido. Vale tenerlo en el radar, pero todavía no es un resorte cargado."
        : "Sin compresión relevante. El precio se está moviendo con su rango habitual.";

  return {
    symbol: input.symbol,
    pressure,
    bias,
    biasLabel,
    factors: { compression, quietAccumulation, baseLength, oiChange, funding },
    drivers,
    note,
  };
}

/** Ranks a set of assets, most coiled first. */
export function rankPressure(inputs: PressureInput[]): PressureReading[] {
  return inputs
    .map(readPressure)
    .filter((reading): reading is PressureReading => reading !== null)
    .sort((a, b) => b.pressure - a.pressure);
}
