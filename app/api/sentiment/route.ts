import { NextResponse } from "next/server";
import { loadCryptoNews, type CryptoNewsResult } from "@/lib/crypto-news";
import { parseFearGreed, type FearGreed } from "@/lib/fear-greed";
import { cached } from "@/lib/upstream-cache";

export const dynamic = "force-dynamic";

/**
 * Crypto news and the Fear & Greed index, cached so the outlets are not hit on
 * every visit. The index updates once a day; news every few minutes. Each
 * part fails on its own: a dead feed or index never blanks the other.
 */
export async function GET() {
  const [fg, news] = await Promise.all([
    cached<FearGreed>(
      "fear-greed",
      30 * 60_000,
      async () => {
        const r = await fetch("https://api.alternative.me/fng/?limit=31&format=json", {
          signal: AbortSignal.timeout(6000),
        });
        return r.ok ? parseFearGreed(await r.json()) : null;
      },
      24 * 3_600_000,
    ),
    cached<CryptoNewsResult>(
      "crypto-news",
      10 * 60_000,
      async () => {
        const result = await loadCryptoNews();
        return result.items.length ? result : null;
      },
      6 * 3_600_000,
    ),
  ]);

  return NextResponse.json(
    {
      fearGreed: fg.value,
      news: news.value?.items ?? [],
      sources: news.value?.sources ?? [],
      failed: news.value?.failed ?? [],
      newsAgeSec: Math.round(news.ageMs / 1000),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
