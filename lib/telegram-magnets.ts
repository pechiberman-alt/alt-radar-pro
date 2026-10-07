import { CORE_MAGNETS, type Mind } from "./jarvis-core.ts";
import { ensureCoreSchema, readMind } from "./jarvis-core-db.ts";
import { isOutside, VENUE_LABEL, type Venue } from "./klines-server.ts";
import { magnetEventText, type MagnetEvent } from "./magnet-watch.ts";
import type { TelegramEvent } from "./telegram.ts";

/**
 * Liquidation-magnet alerts from the server, so they reach the phone with the
 * app closed: BTC, ETH and SOL on 1h. The map is built by JARVIS CORE once per
 * closed candle (lib/jarvis-core-db.ts) and kept in its "mind"; this only reads
 * it. Building six maps here every five minutes cost far more CPU than the
 * free plan gives a run.
 */
export const MAGNET_WATCH = CORE_MAGNETS;
const TF = "1h";
const H = 3_600_000;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function event(symbol: string, e: MagnetEvent, day: string, venue?: Venue): TelegramEvent {
  const t = magnetEventText(symbol, TF, e);
  // The map was built from another exchange's candles when Binance refused the server: its volume, its dollar prices.
  const from = isOutside(venue) ? ` Mapa hecho con velas de ${VENUE_LABEL[venue as Venue]} en dólares: Binance no deja leer al servidor.` : "";
  return {
    // Near: once per zone per day. Swept: once per candle.
    key: e.kind === "CERCA" ? `magnet:near:${symbol}:${TF}:${e.magnet.price}:${day}` : `magnet:swept:${symbol}:${TF}:${e.candleOpenTime}:${e.magnet.side}`,
    category: "IMANES",
    priority: e.kind === "BARRIDA" ? 72 : 66,
    text: `<b>${esc(t.title)}</b>\n${esc(t.body)}\n<i>Zonas estimadas por modelo, no posiciones reales.${esc(from)} No es asesoramiento financiero.</i>`,
  };
}

/** Events from the core's latest map of each coin; a map older than two hours says nothing. */
export function magnetEventsFromMind(mind: Mind, now: number, minIntensity = 70): TelegramEvent[] {
  const day = new Date(now).toISOString().slice(0, 10);
  const out: TelegramEvent[] = [];
  for (const symbol of MAGNET_WATCH) {
    const m = mind.magnets[symbol];
    if (!m || now - (m.lastTime + H) > 2 * H) continue;
    for (const e of m.sweeps ?? []) if (e.kind === "BARRIDA") out.push(event(symbol, e, day, m.venue));
    const near = m.nearPct ?? 0.4;
    for (const g of [m.above, m.below]) {
      if (g && g.intensity >= minIntensity && Math.abs(g.distancePct) <= near) out.push(event(symbol, { kind: "CERCA", magnet: g, price: m.price, nearPct: near }, day, m.venue));
    }
  }
  return out;
}

export async function collectMagnetEvents(db: D1Database, now: number): Promise<TelegramEvent[]> {
  await ensureCoreSchema(db);
  return magnetEventsFromMind(await readMind(db), now);
}
