import type { SwingCandle } from "./swing-entries.ts";

/**
 * Unusual volume: the latest candle's volume against the average of the 20
 * candles before it, on the same timeframe.
 *
 * The comparison is "so far" for a candle still forming: volume only grows
 * during a candle, so if a forming candle has already passed the threshold it
 * will finish above it — nothing is being guessed about the future. What it
 * does NOT say is which way price goes next: high volume is activity, and the
 * candle's colour only says who won that candle.
 *
 * Deliberately the previous 20 candles and not a longer window: volume changes
 * regime over weeks, and a baseline that includes a quiet month makes an
 * ordinary day look like a spike.
 */

export const VOLUME_LOOKBACK = 20;
export const VOLUME_THRESHOLD = 3;

export type VolumeSpike = {
  /** Candle volume divided by the average of the previous 20 candles. */
  multiple: number;
  /** Dollars traded in the candle (quote volume; volume × close if the feed lacks it). */
  quoteVolume: number;
  /** Close against open, in percent. */
  changePct: number;
  /** False while the candle is still forming. */
  closed: boolean;
  openTime: number;
};

export function detectVolumeSpike(
  candles: SwingCandle[],
  frameMs: number,
  now: number,
  threshold = VOLUME_THRESHOLD,
): VolumeSpike | null {
  if (candles.length < VOLUME_LOOKBACK + 1) return null;
  const last = candles[candles.length - 1];
  const prior = candles.slice(-VOLUME_LOOKBACK - 1, -1);
  if (!Number.isFinite(last.volume) || last.volume <= 0 || !(last.open > 0)) return null;
  if (prior.some((c) => !Number.isFinite(c.volume) || c.volume < 0)) return null;
  const mean = prior.reduce((sum, c) => sum + c.volume, 0) / VOLUME_LOOKBACK;
  if (!(mean > 0)) return null;
  const multiple = last.volume / mean;
  if (multiple < threshold) return null;
  return {
    multiple,
    quoteVolume: last.quoteVolume > 0 ? last.quoteVolume : last.volume * last.close,
    changePct: ((last.close - last.open) / last.open) * 100,
    closed: last.openTime + frameMs <= now,
    openTime: last.openTime,
  };
}

/** "3,4" — decimal comma without depending on the runtime's locale data. */
export const dec = (value: number, digits = 1) => value.toFixed(digits).replace(".", ",");

export function dollars(value: number): string {
  if (value >= 1e9) return `$${dec(value / 1e9)} mil M`;
  if (value >= 1e6) return `$${dec(value / 1e6)} M`;
  return `$${Math.round(value / 1e3)} mil`;
}

/** The one sentence every channel (banner, system notification, Telegram) uses. */
export function spikeSentence(timeframe: string, spike: VolumeSpike): string {
  const move = Math.abs(spike.changePct) < 0.05 ? "casi sin cambio" : `${spike.changePct > 0 ? "subiendo +" : "bajando −"}${dec(Math.abs(spike.changePct), 2)}%`;
  return (
    `La vela de ${timeframe} ${spike.closed ? "cerró" : "va"} ${move} con ${dollars(spike.quoteVolume)} negociados, ` +
    `${dec(spike.multiple)} veces el promedio de las 20 anteriores.`
  );
}

export const SPIKE_DISCLAIMER = "Es actividad, no dice hacia dónde sigue el precio.";
