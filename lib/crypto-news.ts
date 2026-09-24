import { parseRss, type RawNewsItem } from "./news-intelligence.ts";

/**
 * Crypto news, classified by what kind of fundamental it is.
 *
 * The existing news module watches world events for geopolitical risk. This
 * one watches the crypto press for the things that move the asset class on
 * their own: regulation, macro, institutional flows, security incidents,
 * exchanges, stablecoins and token supply events.
 *
 * Classification is by keywords in the headline. It is fast and transparent,
 * and it is also blunt: the TONE it reports is the tone of the headline, not
 * a forecast of the price reaction — markets routinely sell good news and buy
 * bad news. The panel labels it that way.
 */

export const CRYPTO_FEEDS = [
  { url: "https://www.coindesk.com/arc/outboundfeeds/rss/", source: "CoinDesk" },
  { url: "https://cointelegraph.com/rss", source: "Cointelegraph" },
  { url: "https://decrypt.co/feed", source: "Decrypt" },
  { url: "https://www.theblock.co/rss.xml", source: "The Block" },
  { url: "https://bitcoinmagazine.com/feed", source: "Bitcoin Magazine" },
];

export type NewsCategory =
  | "REGULACIÓN"
  | "MACRO"
  | "INSTITUCIONAL"
  | "SEGURIDAD"
  | "EXCHANGES"
  | "STABLECOINS"
  | "TOKENS"
  | "MERCADO";

export type CryptoNewsItem = {
  title: string;
  url: string;
  source: string;
  publishedAt: number;
  category: NewsCategory;
  impact: "ALTO" | "MEDIO" | "BAJO";
  tone: "POSITIVO" | "NEGATIVO" | "NEUTRO";
  assets: string[];
};

const RULES: [NewsCategory, RegExp][] = [
  ["SEGURIDAD", /\b(hack|hacked|exploit|stolen|breach|drain(ed)?|attack|phishing|scam|rug ?pull)\b/i],
  ["REGULACIÓN", /\b(sec|cftc|regulat\w*|lawsuit|court|judge|bill|law|congress|senate|ban|sanction\w*|clarity act|genius act|mica|compliance|indict\w*)\b/i],
  ["MACRO", /\b(fed|fomc|powell|rate (hike|cut)|interest rate|inflation|cpi|pce|jobs report|payrolls|treasury|tariff\w*|recession|dollar|dxy|yields?)\b/i],
  ["INSTITUCIONAL", /\b(etf|etfs|blackrock|fidelity|grayscale|inflows?|outflows?|strategy|microstrategy|saylor|treasury company|institutional|adoption|bank)\b/i],
  ["STABLECOINS", /\b(stablecoins?|usdt|usdc|tether|circle|depeg\w*)\b/i],
  ["TOKENS", /\b(unlock\w*|airdrop\w*|token launch|tge|burn|listing|delist\w*|halving|upgrade|hard fork|mainnet)\b/i],
  ["EXCHANGES", /\b(binance|coinbase|kraken|okx|bybit|exchange|bitget)\b/i],
];

const HIGH_IMPACT = /\b(approv\w*|reject\w*|den(y|ies|ied)|rate (hike|cut)|hack\w*|exploit\w*|ban|bankrupt\w*|insolven\w*|record|all-time high|ath|emergency|halt\w*|lawsuit|charges?)\b/i;
const POSITIVE = /\b(surge\w*|rall(y|ies)|soar\w*|jump\w*|approv\w*|inflows?|record|gains?|bull\w*|adopt\w*|partnership|launch\w*|all-time high|rebound\w*)\b/i;
const NEGATIVE = /\b(plunge\w*|crash\w*|drop\w*|slump\w*|fall\w*|outflows?|hack\w*|exploit\w*|lawsuit|reject\w*|ban|bear\w*|liquidat\w*|sell-?off|fraud|charges?|stolen)\b/i;

const ASSETS: [string, RegExp][] = [
  ["BTC", /\b(bitcoin|btc)\b/i],
  ["ETH", /\b(ethereum|ether|eth)\b/i],
  ["SOL", /\b(solana|sol)\b/i],
  ["XRP", /\b(xrp|ripple)\b/i],
  ["BNB", /\b(bnb)\b/i],
  ["DOGE", /\b(dogecoin|doge)\b/i],
  ["ADA", /\b(cardano|ada)\b/i],
  ["AVAX", /\b(avalanche|avax)\b/i],
  ["LINK", /\b(chainlink)\b/i],
  ["SUI", /\b(sui)\b/i],
  ["TON", /\b(toncoin|ton)\b/i],
  ["HYPE", /\b(hyperliquid|hype)\b/i],
];

export function classifyCryptoNews(item: RawNewsItem): CryptoNewsItem | null {
  const publishedAt = Date.parse(item.publishedAt);
  if (!item.title || !item.url || !Number.isFinite(publishedAt)) return null;
  const title = item.title;
  const category = RULES.find(([, re]) => re.test(title))?.[0] ?? "MERCADO";
  const strong = HIGH_IMPACT.test(title);
  const impact: CryptoNewsItem["impact"] =
    strong && ["REGULACIÓN", "MACRO", "SEGURIDAD", "INSTITUCIONAL"].includes(category)
      ? "ALTO"
      : strong || category !== "MERCADO"
        ? "MEDIO"
        : "BAJO";
  const pos = POSITIVE.test(title);
  const neg = NEGATIVE.test(title);
  const tone: CryptoNewsItem["tone"] = pos && !neg ? "POSITIVO" : neg && !pos ? "NEGATIVO" : "NEUTRO";
  return {
    title,
    url: item.url,
    source: item.source,
    publishedAt,
    category,
    impact,
    tone,
    assets: ASSETS.filter(([, re]) => re.test(title)).map(([a]) => a),
  };
}

const words = (t: string) =>
  new Set(t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3));

/** The same story from several outlets is one item: first outlet wins, the
 *  rest are dropped, so a big event does not fill the whole list. */
export function dedupeNews(items: CryptoNewsItem[], threshold = 0.5): CryptoNewsItem[] {
  const kept: { item: CryptoNewsItem; w: Set<string> }[] = [];
  for (const item of [...items].sort((a, b) => b.publishedAt - a.publishedAt)) {
    const w = words(item.title);
    const dup = kept.some((k) => {
      const inter = [...w].filter((x) => k.w.has(x)).length;
      const union = new Set([...w, ...k.w]).size;
      return union > 0 && inter / union >= threshold;
    });
    if (!dup) kept.push({ item, w });
  }
  return kept.map((k) => k.item);
}

export type CryptoNewsResult = { items: CryptoNewsItem[]; sources: string[]; failed: string[] };

export async function loadCryptoNews(now = Date.now()): Promise<CryptoNewsResult> {
  const results = await Promise.allSettled(
    CRYPTO_FEEDS.map(async (feed) => {
      const r = await fetch(feed.url, {
        headers: { Accept: "application/rss+xml, application/xml, text/xml", "User-Agent": "ALT-RADAR-PRO/2.1" },
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return parseRss(await r.text(), feed.source).map((i) => ({ ...i, source: feed.source }));
    }),
  );
  const sources: string[] = [];
  const failed: string[] = [];
  const raw: RawNewsItem[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value.length) {
      sources.push(CRYPTO_FEEDS[i].source);
      raw.push(...r.value);
    } else failed.push(CRYPTO_FEEDS[i].source);
  });
  const recent = raw
    .map(classifyCryptoNews)
    .filter((x): x is CryptoNewsItem => x !== null && now - x.publishedAt < 48 * 3_600_000 && x.publishedAt <= now + 3_600_000);
  return { items: dedupeNews(recent).slice(0, 40), sources, failed };
}
