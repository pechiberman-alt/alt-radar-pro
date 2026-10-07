import { fetchKlinesServer } from "./klines-server.ts";
import { buildLiquidationHeatmap } from "./liquidation-heatmap.ts";
import { magnetEvents, magnetEventText } from "./magnet-watch.ts";
import { loadOiDelta, timeframeConfig } from "./market-fetch.ts";
import type { TelegramEvent } from "./telegram.ts";

/**
 * Liquidation-magnet alerts from the server, so they reach the phone with the
 * app closed. BTC, ETH and SOL on 1h only: each coin costs two subrequests
 * (candles + open-interest history), four if the OI mirrors are down, and a
 * Worker run has a budget of 50 that news, volume and price alerts share.
 */
export const MAGNET_WATCH = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const TF = "1h";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function collectMagnetEvents(now: number): Promise<TelegramEvent[]> {
  const cfg = timeframeConfig(TF);
  const day = new Date(now).toISOString().slice(0, 10);
  const out: TelegramEvent[] = [];
  await Promise.all(
    MAGNET_WATCH.map(async (symbol) => {
      try {
        const all = (await fetchKlinesServer(symbol, TF, { limit: 500, minCandles: 200, allowThin: false })).candles;
        // Only closed candles: the forming one would move the reading every run.
        const candles = all.filter((c) => c.openTime + cfg.frameMs <= now);
        if (candles.length < 200) return;
        const oi = await loadOiDelta(symbol, TF, candles.map((c) => c.openTime), AbortSignal.timeout(6000)).catch(() => null);
        const opts = { halfLifeCandles: cfg.halfLife, priceRangePct: cfg.priceRange };
        const prev = candles.slice(0, -1);
        const before = buildLiquidationHeatmap(symbol, prev, prev[prev.length - 1].close, { ...opts, oiDeltaByIndex: oi?.slice(0, -1) ?? undefined });
        const nowMap = buildLiquidationHeatmap(symbol, candles, candles[candles.length - 1].close, { ...opts, oiDeltaByIndex: oi ?? undefined });
        for (const e of magnetEvents(candles, before, nowMap, { minIntensity: 70 })) {
          const t = magnetEventText(symbol, TF, e);
          out.push({
            // Near: once per zone per day. Swept: once per candle.
            key: e.kind === "CERCA" ? `magnet:near:${symbol}:${TF}:${e.magnet.price}:${day}` : `magnet:swept:${symbol}:${TF}:${e.candleOpenTime}:${e.magnet.side}`,
            category: "IMANES",
            priority: e.kind === "BARRIDA" ? 72 : 66,
            text: `<b>${esc(t.title)}</b>\n${esc(t.body)}\n<i>Zonas estimadas por modelo, no posiciones reales. No es asesoramiento financiero.</i>`,
          });
        }
      } catch {
        // This coin's data is down this run; the others still go out.
      }
    }),
  );
  return out;
}
