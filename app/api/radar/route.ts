import { NextResponse } from "next/server";
import type { MarketAsset, NewsEvent, RadarPayload } from "@/lib/radar";

export const dynamic = "force-dynamic";

const WATCH = ["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT","ADAUSDT","DOGEUSDT","AVAXUSDT","LINKUSDT","SUIUSDT","DOTUSDT","NEARUSDT","ARBUSDT","OPUSDT","APTUSDT","INJUSDT","SEIUSDT","LTCUSDT","UNIUSDT","ATOMUSDT"];
const stable = /^(USDC|USDP|FDUSD|TUSD|DAI|BUSD|EUR|USD1)/;
const keywords = /(war|missile|drone|attack|ceasefire|sanction|tariff|iran|israel|ukraine|russia|taiwan|china|nato|oil|opec|hormuz|suez|fed |federal reserve|ecb|boj|pboc|sec |crypto regulation|bank crisis|cyberattack)/i;

function classify(title: string, source: string, publishedAt: string): NewsEvent {
  const t = title.toLowerCase();
  const critical = /(missile|attack|war |invasion|hormuz|nuclear|bank crisis|emergency)/.test(t);
  const high = critical || /(sanction|tariff|ceasefire|opec|fed |sec |regulation|taiwan)/.test(t);
  const region = /iran|israel|hormuz|gaza|middle east/.test(t) ? "MIDDLE EAST" : /russia|ukraine/.test(t) ? "EUROPE" : /china|taiwan/.test(t) ? "ASIA" : /fed |sec |united states|u\.s\./.test(t) ? "UNITED STATES" : "GLOBAL";
  const category = /oil|opec|hormuz|gas/.test(t) ? "ENERGY" : /fed |ecb|boj|pboc|bank/.test(t) ? "CENTRAL BANKS" : /sec |crypto|bitcoin|ethereum/.test(t) ? "CRYPTO POLICY" : /tariff|sanction|trade/.test(t) ? "TRADE" : "GEOPOLITICS";
  const tier1 = /(reuters|bloomberg|associated press|ap news|financial times|bbc|wall street journal)/i.test(source);
  const risk = Math.min(92, (critical ? 72 : high ? 55 : 38) + (tier1 ? 10 : 2));
  const bearish = critical || /(sanction|tariff|hawkish|attack|invasion)/.test(t);
  return { id: `${title}-${publishedAt}`.slice(0, 180), title, url: "", source, publishedAt, region, category, tier: tier1 ? 1 : 2, risk, btcImpact: bearish ? -45 : 5, altImpact: bearish ? -68 : 4, goldImpact: critical ? 55 : 5, oilImpact: /oil|hormuz|middle east|iran/.test(t) ? 72 : 0, status: tier1 && high ? "CONFIRMED" : critical ? "BREAKING" : "MONITORING" };
}

export async function GET() {
  const errors: string[] = []; const sources: string[] = []; let market: MarketAsset[] = []; let btcDom: number | null = null; let domChange: number | null = null; let news: NewsEvent[] = [];
  try {
    const [tickersRes, klines] = await Promise.all([
      fetch("https://api.binance.com/api/v3/ticker/24hr", { next: { revalidate: 20 } }),
      Promise.all(WATCH.map(async symbol => { try { const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=5`, { next: { revalidate: 55 } }); return [symbol, r.ok ? await r.json() : null] as const; } catch { return [symbol, null] as const; } }))
    ]);
    if (!tickersRes.ok) throw new Error("Binance HTTP error");
    const rows = await tickersRes.json() as Record<string,string>[]; const km = new Map(klines);
    market = rows.filter(r => WATCH.includes(r.symbol) && !stable.test(r.symbol)).map(r => {
      const ks = km.get(r.symbol); const price = Number(r.lastPrice); const h1 = Array.isArray(ks) && ks.length > 1 ? ((price / Number(ks[ks.length - 2][4])) - 1) * 100 : null; const h4 = Array.isArray(ks) && ks.length > 4 ? ((price / Number(ks[0][1])) - 1) * 100 : null;
      return { symbol: r.symbol, price, change1h: h1, change4h: h4, change24h: Number(r.priceChangePercent), volume: Number(r.volume), quoteVolume: Number(r.quoteVolume), high: Number(r.highPrice), low: Number(r.lowPrice) };
    }); sources.push("Binance Spot");
  } catch { errors.push("Binance market data unavailable"); }
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/global", { next: { revalidate: 120 } }); if (!r.ok) throw new Error(); const j = await r.json(); btcDom = Number(j.data.market_cap_percentage.btc); domChange = Number(j.data.market_cap_change_percentage_24h_usd); sources.push("CoinGecko Global");
  } catch { errors.push("BTC dominance unavailable"); }
  try {
    const q = encodeURIComponent("(war OR sanctions OR tariffs OR missile OR Iran OR Israel OR Ukraine OR Taiwan OR OPEC OR Federal Reserve OR crypto regulation)");
    const r = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=artlist&maxrecords=40&format=json&sort=datedesc`, { next: { revalidate: 120 } }); if (!r.ok) throw new Error(); const j = await r.json() as { articles?: { title: string; url: string; domain: string; seendate: string }[] };
    const seen = new Set<string>(); news = (j.articles ?? []).filter(a => keywords.test(a.title)).map(a => ({ ...classify(a.title, a.domain, a.seendate), url: a.url })).filter(e => { const k = e.title.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").slice(0, 7).join(" "); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 12); sources.push("GDELT News Index");
  } catch { errors.push("Global news feed unavailable"); }
  const payload: RadarPayload = { timestamp: new Date().toISOString(), sources, market, dominance: { btc: btcDom, change24h: domChange }, news, errors };
  return NextResponse.json(payload, { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=60" } });
}
