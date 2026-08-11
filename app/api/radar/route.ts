import { NextResponse } from "next/server";
import type { MarketAsset, NewsEvent, RadarPayload } from "@/lib/radar";
import { loadGlobalNews } from "@/lib/news-intelligence";

export const dynamic = "force-dynamic";

const WATCH = ["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT","ADAUSDT","DOGEUSDT","AVAXUSDT","LINKUSDT","SUIUSDT","DOTUSDT","NEARUSDT","ARBUSDT","OPUSDT","APTUSDT","INJUSDT","SEIUSDT","LTCUSDT","UNIUSDT","ATOMUSDT"];
const stable = /^(USDC|USDP|FDUSD|TUSD|DAI|BUSD|EUR|USD1)/;
const BINANCE_ENDPOINTS = ["https://data-api.binance.vision", "https://api.binance.com"];

async function firstAvailable(path: string, revalidate: number) {
  let lastStatus = 0;
  for (const base of BINANCE_ENDPOINTS) {
    try {
      const response = await fetch(`${base}${path}`, { next: { revalidate }, signal: AbortSignal.timeout(3200), headers: { "User-Agent": "ALT-RADAR-PRO/1.0", Accept: "application/json" } });
      lastStatus = response.status;
      if (response.ok) return { response, source: base.includes("vision") ? "Binance Data API" : "Binance Spot" };
    } catch { /* try the next public endpoint */ }
  }
  throw new Error(`Binance unavailable (${lastStatus})`);
}

export async function GET() {
  const errors: string[] = []; const sources: string[] = []; let market: MarketAsset[] = []; let btcDom: number | null = null; let domChange: number | null = null; let news: NewsEvent[] = [];
  try {
    const [tickersResult, klines] = await Promise.all([
      firstAvailable("/api/v3/ticker/24hr", 20),
      Promise.all(WATCH.map(async symbol => { try { const { response } = await firstAvailable(`/api/v3/klines?symbol=${symbol}&interval=1h&limit=5`, 55); return [symbol, await response.json()] as const; } catch { return [symbol, null] as const; } }))
    ]);
    const tickersRes = tickersResult.response;
    if (!tickersRes.ok) throw new Error("Binance HTTP error");
    const rows = await tickersRes.json() as Record<string,string>[]; const km = new Map(klines);
    market = rows.filter(r => WATCH.includes(r.symbol) && !stable.test(r.symbol)).map(r => {
      const ks = km.get(r.symbol); const price = Number(r.lastPrice); const h1 = Array.isArray(ks) && ks.length > 1 ? ((price / Number(ks[ks.length - 2][4])) - 1) * 100 : null; const h4 = Array.isArray(ks) && ks.length > 4 ? ((price / Number(ks[0][1])) - 1) * 100 : null;
      return { symbol: r.symbol, price, change1h: h1, change4h: h4, change24h: Number(r.priceChangePercent), volume: Number(r.volume), quoteVolume: Number(r.quoteVolume), high: Number(r.highPrice), low: Number(r.lowPrice) };
    }); sources.push(tickersResult.source);
  } catch {
    try {
      const r = await fetch("https://api.coinlore.net/api/tickers/?start=0&limit=100", { next: { revalidate: 45 }, signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error();
      const j = await r.json() as { data?: { symbol: string; price_usd: string; percent_change_1h: string; percent_change_24h: string; volume24: number; volume24_native?: number }[] };
      const wanted = new Set(WATCH.map(symbol => symbol.replace("USDT", "")));
      market = (j.data ?? []).filter(row => wanted.has(row.symbol)).map(row => ({ symbol: `${row.symbol}USDT`, price: Number(row.price_usd), change1h: Number(row.percent_change_1h), change4h: null, change24h: Number(row.percent_change_24h), volume: Number(row.volume24_native ?? 0), quoteVolume: Number(row.volume24), high: null, low: null }));
      if (!market.length) throw new Error();
      sources.push("CoinLore Market");
      errors.push("Binance no disponible; usando respaldo CoinLore");
    } catch { errors.push("Datos de mercado no disponibles"); }
  }
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/global", { next: { revalidate: 120 }, signal: AbortSignal.timeout(4000), headers: { "User-Agent": "ALT-RADAR-PRO/1.0", Accept: "application/json" } });
    if (!r.ok) throw new Error(); const j = await r.json(); btcDom = Number(j.data.market_cap_percentage.btc); domChange = Number(j.data.market_cap_change_percentage_24h_usd); sources.push("CoinGecko Global");
  } catch {
    try {
      const r = await fetch("https://api.coinlore.net/api/global/", { next: { revalidate: 120 }, signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(); const [j] = await r.json() as [{ btc_d?: string; mcap_change?: string }]; btcDom = Number(j.btc_d); domChange = Number(j.mcap_change); sources.push("CoinLore Global");
    } catch { errors.push("BTC dominance unavailable"); }
  }
  try {
    const intelligence = await loadGlobalNews();
    news = intelligence.events;
    sources.push(...intelligence.sources);
    errors.push(...intelligence.errors);
    if (!news.length) errors.push("No hay eventos globales HIGH o CRITICAL verificados");
  } catch {
    errors.push("Global news feed unavailable");
  }
  const payload: RadarPayload = { timestamp: new Date().toISOString(), sources, market, dominance: { btc: btcDom, change24h: domChange }, news, errors };
  return NextResponse.json(payload, { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=60" } });
}
