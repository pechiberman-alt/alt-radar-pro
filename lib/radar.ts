export type MarketAsset = {
  symbol: string; price: number; change1h: number | null; change4h: number | null;
  change24h: number; volume: number; quoteVolume: number; high: number; low: number;
};

export type NewsEvent = {
  id: string; title: string; url: string; source: string; publishedAt: string;
  region: string; category: string; tier: 1 | 2 | 3; risk: number;
  btcImpact: number; altImpact: number; goldImpact: number; oilImpact: number;
  status: "BREAKING" | "CONFIRMED" | "MONITORING" | "UNCONFIRMED";
};

export type RadarPayload = {
  timestamp: string; sources: string[]; market: MarketAsset[];
  dominance: { btc: number | null; change24h: number | null };
  news: NewsEvent[]; errors: string[];
};

export type ScoredAsset = MarketAsset & {
  score: number; signal: "WATCH" | "SETUP" | "TRIGGER" | "NO SIGNAL";
  relVolume: number; momentum: number; liquidity: "HIGH" | "MEDIUM" | "LOW";
  extended: boolean; reasons: { label: string; points: number }[]; penalties: { label: string; points: number }[];
};

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));

export function globalRisk(events: NewsEvent[]) {
  if (!events.length) return { score: null, level: "DATA UNAVAILABLE", killSwitch: false } as const;
  const sorted = [...events].sort((a, b) => b.risk - a.risk);
  const score = Math.round(clamp(sorted[0].risk * .72 + (sorted[1]?.risk ?? 0) * .18 + Math.min(events.length, 10)));
  return { score, level: score > 80 ? "EXTREME" : score > 60 ? "HIGH" : score > 40 ? "ELEVATED" : score > 20 ? "NORMAL" : "LOW", killSwitch: score > 80 };
}

export function altseasonScore(market: MarketAsset[], btcDominance: number | null, riskScore: number | null) {
  const btc = market.find(a => a.symbol === "BTCUSDT");
  const eth = market.find(a => a.symbol === "ETHUSDT");
  const alts = market.filter(a => !["BTCUSDT", "ETHUSDT"].includes(a.symbol));
  if (!btc || !eth || !alts.length) return { raw: null, adjustment: 0, final: null, state: "DATA UNAVAILABLE", factors: [] };
  const breadth = alts.filter(a => a.change24h > btc.change24h).length / alts.length;
  const positive = alts.filter(a => a.change24h > 0).length / alts.length;
  const ethOut = eth.change24h - btc.change24h;
  const factors = [
    { label: "BTC.D context", points: btcDominance !== null && btcDominance < 55 ? 13 : 5 },
    { label: "ETH outperforming BTC", points: ethOut > 0 ? Math.min(15, 8 + ethOut) : 2 },
    { label: "Altcoin breadth", points: Math.round(breadth * 22) },
    { label: "Positive breadth", points: Math.round(positive * 15) },
    { label: "Alt volume participation", points: alts.filter(a => a.quoteVolume > 50_000_000).length >= 8 ? 15 : 7 },
    { label: "BTC stability", points: Math.abs(btc.change24h) < 4 ? 10 : 3 },
    { label: "Cross-timeframe momentum", points: alts.filter(a => (a.change4h ?? 0) > 0).length / alts.length > .55 ? 10 : 4 },
  ];
  const raw = Math.round(clamp(factors.reduce((s, f) => s + f.points, 0)));
  const adjustment = riskScore === null ? 0 : riskScore > 80 ? -22 : riskScore > 60 ? -12 : riskScore > 40 ? -5 : 0;
  const final = clamp(raw + adjustment);
  const state = final >= 76 ? "ALTSEASON CONFIRMED" : final >= 61 ? "STRONG ROTATION" : final >= 41 ? "PRE-ALTSEASON" : final >= 21 ? "NEUTRAL" : "BITCOIN SEASON";
  return { raw, adjustment, final, state, factors };
}

export function scoreAssets(market: MarketAsset[], riskScore: number | null, killSwitch: boolean): ScoredAsset[] {
  const btc = market.find(a => a.symbol === "BTCUSDT");
  const eth = market.find(a => a.symbol === "ETHUSDT");
  return market.filter(a => !["BTCUSDT", "ETHUSDT"].includes(a.symbol)).map(a => {
    const range = Math.max(a.high - a.low, a.price * .001);
    const position = (a.price - a.low) / range;
    const relVolume = Math.min(5, a.quoteVolume / 250_000_000);
    const momentum = ((a.change1h ?? 0) * .35) + ((a.change4h ?? 0) * .35) + a.change24h * .3;
    const extended = a.change24h > 14 || (a.change1h ?? 0) > 6 || position > .97;
    const reasons = [
      { label: "Liquidity", points: a.quoteVolume > 500_000_000 ? 15 : a.quoteVolume > 100_000_000 ? 10 : 4 },
      { label: "Momentum alignment", points: (a.change1h ?? 0) > 0 && (a.change4h ?? 0) > 0 ? 16 : 5 },
      { label: "Relative strength BTC", points: btc && a.change24h > btc.change24h ? 14 : 2 },
      { label: "Relative strength ETH", points: eth && a.change24h > eth.change24h ? 10 : 2 },
      { label: "Breakout proximity", points: position > .78 && position < .97 ? 15 : 6 },
      { label: "Volume participation", points: relVolume > 1 ? 14 : relVolume > .4 ? 9 : 3 },
      { label: "Multi-TF trend", points: (a.change1h ?? 0) > 0 && (a.change4h ?? 0) > 0 && a.change24h > 0 ? 12 : 4 },
    ];
    const penalties = [
      ...(extended ? [{ label: "Move already extended", points: -18 }] : []),
      ...(riskScore !== null && riskScore > 60 ? [{ label: "Geopolitical risk", points: riskScore > 80 ? -22 : -10 }] : []),
      ...(a.quoteVolume < 50_000_000 ? [{ label: "Insufficient liquidity", points: -14 }] : []),
    ];
    const score = Math.round(clamp(reasons.reduce((s, r) => s + r.points, 0) + penalties.reduce((s, p) => s + p.points, 0)));
    const confirmations = reasons.filter(r => r.points >= 10).length;
    const signal = killSwitch || extended ? "NO SIGNAL" : score >= 80 && confirmations >= 5 ? "TRIGGER" : score >= 70 ? "SETUP" : score >= 60 ? "WATCH" : "NO SIGNAL";
    return { ...a, score, signal, relVolume, momentum, extended, liquidity: a.quoteVolume > 500_000_000 ? "HIGH" : a.quoteVolume > 100_000_000 ? "MEDIUM" : "LOW", reasons, penalties };
  }).sort((a, b) => b.score - a.score);
}

export function rotation(market: MarketAsset[]) {
  const buckets = [
    { label: "BTC", syms: ["BTCUSDT"] }, { label: "ETH", syms: ["ETHUSDT"] },
    { label: "Large", syms: ["BNBUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT"] },
    { label: "Mid", syms: ["AVAXUSDT", "LINKUSDT", "SUIUSDT", "DOTUSDT", "NEARUSDT"] },
    { label: "Small", syms: ["ARBUSDT", "OPUSDT", "APTUSDT", "INJUSDT", "SEIUSDT"] },
  ];
  const raw = buckets.map(b => ({ ...b, value: Math.max(.1, b.syms.map(s => market.find(a => a.symbol === s)?.change24h ?? 0).reduce((x, y) => x + y, 0) / b.syms.length + 5) }));
  const total = raw.reduce((s, b) => s + b.value, 0);
  const values = raw.map(b => ({ label: b.label, value: Math.round(b.value / total * 100) }));
  const leader = values.reduce((a, b) => b.value > a.value ? b : a);
  const phase = leader.label === "BTC" ? 1 : leader.label === "ETH" ? 2 : leader.label === "Large" ? 3 : leader.label === "Mid" ? 4 : 5;
  return { values, phase, leader: leader.label };
}
