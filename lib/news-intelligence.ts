import type { NewsEvent } from "./radar";

type FeedDefinition = {
  name: string;
  url: string;
  defaultSource: string;
};

type RawNewsItem = {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
};

export type NewsIntelligenceResult = {
  events: NewsEvent[];
  sources: string[];
  errors: string[];
};

const FEEDS: FeedDefinition[] = [
  {
    name: "BBC World RSS",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    defaultSource: "BBC",
  },
  {
    name: "BBC Middle East RSS",
    url: "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml",
    defaultSource: "BBC",
  },
  {
    name: "Al Jazeera RSS",
    url: "https://www.aljazeera.com/xml/rss/all.xml",
    defaultSource: "Al Jazeera",
  },
  {
    name: "Guardian World RSS",
    url: "https://www.theguardian.com/world/rss",
    defaultSource: "The Guardian",
  },
  {
    name: "Sky News World RSS",
    url: "https://feeds.skynews.com/feeds/rss/world.xml",
    defaultSource: "Sky News",
  },
  {
    name: "New York Times World RSS",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    defaultSource: "The New York Times",
  },
  {
    name: "CNBC World RSS",
    url: "https://www.cnbc.com/id/100727362/device/rss/rss.html",
    defaultSource: "CNBC",
  },
  {
    name: "United Nations News RSS",
    url: "https://news.un.org/feed/subscribe/en/news/all/rss.xml",
    defaultSource: "United Nations",
  },
  {
    name: "Dow Jones World RSS",
    url: "https://feeds.content.dowjones.io/public/rss/RSSWorldNews",
    defaultSource: "Dow Jones",
  },
];

const MARKET_KEYWORDS =
  /\b(war|conflict|missile|drone|attack|strike|invasion|ceasefire|peace talks?|sanctions?|tariffs?|embargo|iran|israel|gaza|ukraine|russia|taiwan|china|nato|north korea|oil|gas|opec|hormuz|suez|bab el.mandeb|shipping|cyberattack|bank(?:ing)? crisis|bank collapse|political emergency|federal reserve|\bfed\b|ecb|boj|pboc|central bank|sec\b|crypto regulation|bitcoin etf|ethereum etf|trade restrictions?)\b/i;
const CRITICAL_TERMS =
  /\b(nuclear|invasion|war declared|missile (?:attack|strike|launch)|drone (?:attack|strike)|military attack|airstrike|bank collapse|state of emergency|hormuz (?:closed|closure|blocked)|suez (?:closed|closure|blocked)|major cyberattack)\b/i;
const HIGH_TERMS =
  /\b(attack|strike|war|conflict|sanctions?|tariffs?|embargo|ceasefire|opec|hormuz|taiwan|nato|trade restrictions?|bank(?:ing)? crisis|emergency meeting|crypto ban|regulatory crackdown|rate (?:hike|cut))\b/i;
const RUMOR_TERMS = /\b(rumou?r|unconfirmed|alleged|social media claims?|reportedly)\b/i;
const COMMENTARY_TERMS =
  /^(?:opinion|editorial|analysis|commentary|column|review|podcast|video)\s*[|:—-]|\bwhat (?:china|russia|iran|israel|america|europe) might have been\b|\bwasn.t normal\b/i;
const QUESTION_TERMS = /\?\s*$|^(?:will|could|would|can|is|are|should|why|how)\b/i;
const CONCRETE_EVENT_TERMS =
  /\b(missile|drone|attack(?:ed|s|ing)?|strike(?:s|d|ing)?|airstrike|invasion|ceasefire|peace deal|peace talks?|sanctions?|tariffs?|embargo|closed|closure|blocked|shutdown|halted|collapse|default|cyberattack|ransomware|rate (?:hike|cut)|approv(?:al|ed)|ban(?:ned)?|crackdown|lawsuit|launch(?:ed)?|signed|announced|declared|imposed|lifted|voted|election result|oil spill|shipping disruption)\b/i;
const TIER_ONE =
  /\b(reuters|bloomberg|associated press|ap news|financial times|wall street journal|dow jones|bbc|official|white house|federal reserve|european central bank|bank of japan|people.s bank of china|sec|nato|united nations)\b/i;
const TIER_TWO =
  /\b(cnbc|cnn|al jazeera|the guardian|new york times|sky news|nikkei|marketwatch|forbes|economist|dw|france 24|abc news|cbs news|nbc news|fox business|barron.s|coindesk|the block)\b/i;

const ENTITY_TERMS = [
  "iran",
  "israel",
  "gaza",
  "hormuz",
  "ukraine",
  "russia",
  "taiwan",
  "china",
  "nato",
  "north korea",
  "opec",
  "federal reserve",
  "ecb",
  "boj",
  "pboc",
  "sec",
  "bitcoin",
  "ethereum",
  "suez",
];

const EVENT_TERMS = [
  "missile",
  "drone",
  "attack",
  "strike",
  "sanction",
  "tariff",
  "ceasefire",
  "war",
  "invasion",
  "oil",
  "gas",
  "cyberattack",
  "bank",
  "regulation",
  "rate",
  "trade",
];

const clamp = (value: number, min = -100, max = 100) =>
  Math.max(min, Math.min(max, value));

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function readTag(block: string, tagName: string) {
  const match = block.match(
    new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i"),
  );
  return match ? decodeXml(match[1]) : "";
}

function parseRss(xml: string, defaultSource: string): RawNewsItem[] {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)]
    .map((match) => {
      const block = match[1];
      const source = readTag(block, "source") || defaultSource;
      let title = readTag(block, "title");
      const suffix = ` - ${source}`;
      if (title.endsWith(suffix)) title = title.slice(0, -suffix.length).trim();
      const publishedAt =
        readTag(block, "pubDate") ||
        readTag(block, "published") ||
        readTag(block, "dc:date");
      return {
        title,
        url: readTag(block, "link") || readTag(block, "guid"),
        source,
        publishedAt,
      };
    })
    .filter((item) => item.title && item.url && item.publishedAt);
}

function sourceTier(source: string): 1 | 2 | 3 {
  if (TIER_ONE.test(source)) return 1;
  if (TIER_TWO.test(source)) return 2;
  return 3;
}

function normalizeDate(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function regionFor(title: string) {
  const lower = title.toLowerCase();
  if (/iran|israel|gaza|hormuz|middle east|syria|lebanon|yemen/.test(lower)) {
    return "MIDDLE EAST";
  }
  if (/russia|ukraine|nato|european union/.test(lower)) return "EUROPE";
  if (/china|taiwan|north korea|boj|pboc|japan/.test(lower)) return "ASIA";
  if (/fed(?:eral reserve)?|sec\b|united states|u\.s\./.test(lower)) return "UNITED STATES";
  return "GLOBAL";
}

function categoryFor(title: string) {
  const lower = title.toLowerCase();
  if (/oil|opec|hormuz|gas|energy/.test(lower)) return "ENERGY";
  if (/federal reserve|\bfed\b|ecb|boj|pboc|central bank|bank crisis/.test(lower)) {
    return "CENTRAL BANKS";
  }
  if (/sec\b|crypto|bitcoin|ethereum|etf/.test(lower)) return "CRYPTO POLICY";
  if (/tariff|sanction|embargo|trade restriction/.test(lower)) return "TRADE";
  if (/cyberattack|ransomware/.test(lower)) return "CYBER";
  return "GEOPOLITICS";
}

function clusterKey(title: string) {
  const lower = title.toLowerCase();
  const entities = ENTITY_TERMS.filter((term) => lower.includes(term)).slice(0, 2);
  const event = EVENT_TERMS.find((term) => lower.includes(term));
  if (event) return [...entities, event].join("|");
  const words = lower
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((word) =>
      word.length > 3 &&
      !/^(?:about|after|against|amid|been|from|have|into|near|over|says|that|their|this|with|would)$/.test(word) &&
      !entities.some((entity) => entity.split(" ").includes(word)),
    );
  if (entities.length) return [...entities, ...words.slice(0, 5)].join("|");
  return words
    .slice(0, 7)
    .join("|");
}

function classify(item: RawNewsItem, now: number): NewsEvent | null {
  const publishedAt = normalizeDate(item.publishedAt);
  if (!publishedAt || !MARKET_KEYWORDS.test(item.title)) return null;
  const publishedTime = new Date(publishedAt).getTime();
  const ageHours = Math.max(0, (now - publishedTime) / 3_600_000);
  if (ageHours > 72) return null;

  const tier = sourceTier(item.source);
  const commentary = COMMENTARY_TERMS.test(item.title);
  const question = QUESTION_TERMS.test(item.title);
  const concreteEvent = CONCRETE_EVENT_TERMS.test(item.title);
  if (commentary || (question && !concreteEvent)) return null;
  const critical = CRITICAL_TERMS.test(item.title);
  const high = critical || HIGH_TERMS.test(item.title);
  const rumor = RUMOR_TERMS.test(item.title);
  const reliability = tier === 1 ? 9 : tier === 2 ? 4 : -4;
  const recency = ageHours <= 1 ? 6 : ageHours <= 6 ? 3 : 0;
  const contextPenalty = commentary ? 22 : question ? 14 : !concreteEvent ? 9 : 0;
  const risk = Math.round(clamp((critical ? 73 : high ? 57 : 43) + reliability + recency - (rumor ? 20 : 0) - contextPenalty, 18, 94));
  const lower = item.title.toLowerCase();
  const easing = /ceasefire|peace deal|peace talks|de.escalat|rate cut|dovish|etf approv/.test(lower);
  const riskOff = /attack|strike|invasion|sanction|tariff|embargo|hawkish|bank crisis|cyberattack/.test(lower);
  const cryptoPositive = /crypto|bitcoin|ethereum|etf/.test(lower) && /approv|clarity|legal|adopt/.test(lower);
  const cryptoNegative = /crypto|bitcoin|ethereum/.test(lower) && /ban|crackdown|lawsuit|restrict/.test(lower);
  const btcImpact = clamp(cryptoPositive ? 55 : cryptoNegative ? -58 : easing ? 20 : riskOff ? -32 : -5);
  const altImpact = clamp(cryptoPositive ? 62 : cryptoNegative ? -72 : easing ? 28 : riskOff ? -55 : -10);
  const goldImpact = clamp(critical || riskOff ? 48 : easing ? -16 : 5);
  const oilImpact = clamp(/oil|opec|hormuz|middle east|iran/.test(lower) ? (easing ? -28 : 62) : 0);

  return {
    id: `${clusterKey(item.title)}-${publishedAt}`,
    title: item.title,
    url: item.url,
    source: item.source,
    publishedAt,
    region: regionFor(item.title),
    category: categoryFor(item.title),
    tier,
    risk,
    btcImpact,
    altImpact,
    goldImpact,
    oilImpact,
    status: rumor
      ? "UNCONFIRMED"
      : critical && ageHours <= 2 && tier <= 2
        ? "BREAKING"
        : tier === 1 && high
          ? "CONFIRMED"
          : "MONITORING",
    sourceCount: 1,
    sources: [item.source],
  };
}

function clusterEvents(events: NewsEvent[]) {
  const groups = new Map<string, NewsEvent[]>();
  const seenTitles = new Set<string>();
  for (const event of events.sort((left, right) => right.risk - left.risk)) {
    const titleKey = `${event.source.toLowerCase()}|${event.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 120)}`;
    if (seenTitles.has(titleKey)) continue;
    seenTitles.add(titleKey);
    const key = clusterKey(event.title);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }

  return [...groups.values()]
    .map((group) => {
      const sorted = group.sort((left, right) => right.risk - left.risk);
      const primary = sorted[0];
      const sources = [...new Set(group.map((event) => event.source))];
      const reliableSources = new Set(
        group.filter((event) => event.tier <= 2).map((event) => event.source.toLowerCase()),
      ).size;
      const sourceBonus = Math.min(3, Math.max(0, reliableSources - 1)) * 4;
      const risk = Math.min(96, primary.risk + sourceBonus);
      const confirmed = reliableSources >= 2 && primary.status !== "UNCONFIRMED";
      return {
        ...primary,
        id: clusterKey(primary.title),
        risk,
        status: confirmed
          ? "CONFIRMED" as const
          : primary.status === "CONFIRMED"
            ? "MONITORING" as const
            : primary.status,
        sourceCount: sources.length,
        sources,
        source:
          sources.length > 1 ? `${primary.source} + ${sources.length - 1} fuentes` : primary.source,
      };
    })
    .sort((left, right) => {
      if (right.risk !== left.risk) return right.risk - left.risk;
      return new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
    })
    .filter((event) => event.risk >= 50)
    .slice(0, 14);
}

export function classifyNewsItems(items: RawNewsItem[], now = Date.now()) {
  return clusterEvents(
    items
      .map((item) => classify(item, now))
      .filter((event): event is NewsEvent => event !== null),
  );
}

async function loadFeed(feed: FeedDefinition) {
  const response = await fetch(feed.url, {
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml",
      "User-Agent": "ALT-RADAR-PRO/2.1",
    },
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  return parseRss(text, feed.defaultSource);
}

export async function loadGlobalNews(): Promise<NewsIntelligenceResult> {
  const settled = await Promise.allSettled(FEEDS.map((feed) => loadFeed(feed)));
  const sources: string[] = [];
  const errors: string[] = [];
  const rawItems: RawNewsItem[] = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value.length) {
      sources.push(FEEDS[index].name);
      rawItems.push(...result.value);
    } else {
      errors.push(`${FEEDS[index].name} no disponible`);
    }
  });

  return {
    events: classifyNewsItems(rawItems),
    sources,
    errors,
  };
}
