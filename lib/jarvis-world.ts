import type { CryptoNewsItem } from "./crypto-news.ts";
import type { FearGreed } from "./fear-greed.ts";

/**
 * What the world says, for JARVIS's 24/7 mind: the Fear & Greed index and the
 * headlines that matter. The 5-minute Telegram dispatch already loads both, so
 * it leaves this digest in one row; the mind reads that row instead of parsing
 * news feeds again (the free plan gives each run a few milliseconds of CPU).
 * Written only when it changed.
 */

export type WorldNews = { title: string; impact: string; tone: string; category: string; assets: string[]; source: string; publishedAt: number };
export type World = {
  at: number;
  fearGreed: { value: number; zone: string; yesterday: number | null; weekAgo: number | null } | null;
  news: WorldNews[];
};

const IMPACT_RANK: Record<string, number> = { ALTO: 0, MEDIO: 1, BAJO: 2 };

/** The headlines of the last 12 hours that are not minor, most important and newest first (8 at most). */
export function worldDigest(news: CryptoNewsItem[], fg: FearGreed | null, now: number): World {
  const recent = news
    .filter((n) => n.impact !== "BAJO" && now - n.publishedAt < 12 * 3_600_000 && n.publishedAt <= now)
    .sort((a, b) => (IMPACT_RANK[a.impact] ?? 3) - (IMPACT_RANK[b.impact] ?? 3) || b.publishedAt - a.publishedAt)
    .slice(0, 8)
    .map((n) => ({ title: n.title.slice(0, 160), impact: n.impact, tone: n.tone, category: n.category, assets: n.assets.slice(0, 4), source: n.source, publishedAt: n.publishedAt }));
  return {
    at: now,
    fearGreed: fg ? { value: fg.value, zone: fg.zone, yesterday: fg.yesterday, weekAgo: fg.weekAgo } : null,
    news: recent,
  };
}

const signature = (w: World) => JSON.stringify({ f: w.fearGreed?.value ?? null, n: w.news.map((x) => x.title) });

export async function readWorld(db: D1Database): Promise<World | null> {
  const row = await db.prepare("SELECT value FROM jarvis_core_state WHERE key = 'world' LIMIT 1").first<{ value: string }>();
  try {
    return row ? (JSON.parse(row.value) as World) : null;
  } catch {
    return null;
  }
}

/** Saves the digest when its content changed; returns whether it wrote. */
export async function saveWorld(db: D1Database, w: World): Promise<boolean> {
  const prev = await readWorld(db).catch(() => null);
  if (prev && signature(prev) === signature(w)) return false;
  await db.prepare("INSERT OR REPLACE INTO jarvis_core_state (key, value) VALUES ('world', ?1)").bind(JSON.stringify(w)).run();
  return true;
}
