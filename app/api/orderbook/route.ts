import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const allowed = new Set(["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT","ADAUSDT","DOGEUSDT","AVAXUSDT","LINKUSDT","DOTUSDT","LTCUSDT","UNIUSDT","ATOMUSDT"]);
const krakenPairs: Record<string,string> = { BTCUSDT:"XBTUSD", ETHUSDT:"ETHUSD", SOLUSDT:"SOLUSD", XRPUSDT:"XRPUSD", ADAUSDT:"ADAUSD", DOGEUSDT:"DOGEUSD", AVAXUSDT:"AVAXUSD", LINKUSDT:"LINKUSD", DOTUSDT:"DOTUSD", LTCUSDT:"LTCUSD", UNIUSDT:"UNIUSD", ATOMUSDT:"ATOMUSD" };

export async function GET(request: NextRequest) {
  const symbol = (request.nextUrl.searchParams.get("symbol") ?? "BTCUSDT").toUpperCase();
  if (!allowed.has(symbol)) return NextResponse.json({ error: "Activo no permitido" }, { status: 400 });
  for (const base of ["https://data-api.binance.vision", "https://api.binance.com"]) {
    try {
      const r = await fetch(`${base}/api/v3/depth?symbol=${symbol}&limit=100`, { headers: { Accept: "application/json", "User-Agent": "ALT-RADAR-PRO/1.0" }, signal: AbortSignal.timeout(2800), next: { revalidate: 4 } });
      if (r.ok) { const j = await r.json() as { bids: string[][]; asks: string[][] }; return NextResponse.json({ symbol, source: base.includes("vision") ? "Binance Data API" : "Binance Spot", timestamp: new Date().toISOString(), bids: j.bids.slice(0,40), asks: j.asks.slice(0,40) }); }
    } catch { /* fall through */ }
  }
  const pair = krakenPairs[symbol];
  if (pair) try {
    const r = await fetch(`https://api.kraken.com/0/public/Depth?pair=${pair}&count=100`, { headers: { Accept: "application/json", "User-Agent": "ALT-RADAR-PRO/1.0" }, signal: AbortSignal.timeout(4500), next: { revalidate: 4 } });
    if (r.ok) { const j = await r.json() as { result: Record<string,{ bids: (string|number)[][]; asks: (string|number)[][] }> }; const book = Object.values(j.result)[0]; if (book) return NextResponse.json({ symbol, source: "Kraken Order Book", timestamp: new Date().toISOString(), bids: book.bids.slice(0,40).map(x=>[String(x[0]),String(x[1])]), asks: book.asks.slice(0,40).map(x=>[String(x[0]),String(x[1])]) }); }
  } catch { /* explicit unavailable response below */ }
  return NextResponse.json({ symbol, source: null, timestamp: new Date().toISOString(), bids: [], asks: [], error: "Libro de órdenes no disponible para este activo" }, { status: 503 });
}
