import { storeLiquiditySnapshot } from "./liquidity-history";

const CORE_MARKETS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"] as const;

type BinanceDepth = {
  bids?: string[][];
  asks?: string[][];
  b?: string[][];
  a?: string[][];
};

async function archiveMarket(
  db: D1Database,
  symbol: string,
  venue: "spot" | "futures",
) {
  const endpoints = venue === "futures"
    ? [
        { url: `https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=100`, venue: "futures" as const },
        { url: `https://data-api.binance.vision/api/v3/depth?symbol=${symbol}&limit=100`, venue: "spot" as const },
      ]
    : [{ url: `https://data-api.binance.vision/api/v3/depth?symbol=${symbol}&limit=100`, venue: "spot" as const }];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint.url, {
        headers: { Accept: "application/json", "User-Agent": "ALT-RADAR-PRO/1.0" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) continue;
      const payload = await response.json() as BinanceDepth;
      const bids = payload.bids ?? payload.b ?? [];
      const asks = payload.asks ?? payload.a ?? [];
      const bestBid = Number(bids[0]?.[0]);
      const bestAsk = Number(asks[0]?.[0]);
      if (!(bestBid > 0 && bestAsk > bestBid)) continue;
      return storeLiquiditySnapshot(db, {
        symbol,
        venue: endpoint.venue,
        capturedAt: new Date().toISOString(),
        mid: (bestBid + bestAsk) / 2,
        bids,
        asks,
        source: `Binance ${endpoint.venue === "futures" ? "Futures" : "Spot"} REST · archivo automático Cloudflare`,
      });
    } catch {
      // The next public venue is attempted without synthesizing a snapshot.
    }
  }
  throw new Error(`DEPTH_${venue.toUpperCase()}_UNAVAILABLE`);
}

export async function archiveCoreLiquidity(db: D1Database) {
  const jobs = CORE_MARKETS.flatMap((symbol) => [
    archiveMarket(db, symbol, "futures"),
    archiveMarket(db, symbol, "spot"),
  ]);
  const results = await Promise.allSettled(jobs);
  const stored = results.filter(
    (result) => result.status === "fulfilled" && result.value.stored,
  ).length;
  const failed = results.filter((result) => result.status === "rejected").length;
  if (failed) console.warn(`[ALT_RADAR_LIQUIDITY_ARCHIVE] ${failed} fuentes no disponibles`);
  return { stored, failed, markets: jobs.length };
}
