import { fetchKlinesServer } from "./klines-server.ts";
import type { SwingCandle } from "./swing-entries.ts";
import { volumeEvent, type TelegramEvent } from "./telegram.ts";
import { detectVolumeSpike } from "./volume-spike.ts";

/**
 * Unusual volume for Telegram, computed from public candles in the Worker so it
 * works with every browser closed. Needs no database: the only state is the
 * per-candle key that dispatch already records to never send a thing twice.
 */

export const VOLUME_WATCH = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
export const VOLUME_FRAMES: { interval: string; frameMs: number }[] = [
  { interval: "15m", frameMs: 900_000 },
  { interval: "1h", frameMs: 3_600_000 },
  { interval: "4h", frameMs: 14_400_000 },
];

/** Pure part: series in, events out. */
export function volumeEventsFrom(series: { symbol: string; interval: string; frameMs: number; candles: SwingCandle[] }[], now: number): TelegramEvent[] {
  const events: TelegramEvent[] = [];
  for (const s of series) {
    const spike = detectVolumeSpike(s.candles, s.frameMs, now);
    if (spike) events.push(volumeEvent(s.symbol, s.interval, spike));
  }
  return events;
}

/** Volume is read from the main market only: see klines-server.ts on why Binance.US is refused. */
async function fetchCandles(symbol: string, interval: string): Promise<SwingCandle[]> {
  return (await fetchKlinesServer(symbol, interval, { limit: 30, minCandles: 21, allowThin: false })).candles;
}

/** One coin or frame failing must not silence the others. */
export async function collectVolumeEvents(now: number): Promise<TelegramEvent[]> {
  const settled = await Promise.all(
    VOLUME_WATCH.flatMap((symbol) =>
      VOLUME_FRAMES.map(async (f) => {
        try {
          return { symbol, interval: f.interval, frameMs: f.frameMs, candles: await fetchCandles(symbol, f.interval) };
        } catch {
          return null;
        }
      }),
    ),
  );
  return volumeEventsFrom(settled.filter((s): s is NonNullable<typeof s> => s !== null), now);
}
