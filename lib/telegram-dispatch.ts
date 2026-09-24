import { loadCryptoNews, type CryptoNewsResult } from "./crypto-news.ts";
import { isDueToday, type DcaSchedule } from "./dca-tracker.ts";
import { parseFearGreed, type FearGreed } from "./fear-greed.ts";
import {
  dcaEvent,
  fearGreedEvent,
  newsEvent,
  parsePrefs,
  selectForUser,
  sendMessage,
  signalEvent,
  TELEGRAM_SCHEMA,
  type TelegramEvent,
} from "./telegram.ts";
import { cached } from "./upstream-cache.ts";

/**
 * Runs from the Worker cron every 5 minutes: collects what happened since the
 * last run and sends each linked user what their preferences ask for.
 *
 * Every send is recorded by key before the next run, so an event is sent at
 * most once per user. On the very first run it only records a starting point
 * for signals — it never floods a new user with history.
 */
export async function runTelegramDispatch(db: D1Database, token: string, now = Date.now()) {
  for (const sql of TELEGRAM_SCHEMA) await db.prepare(sql).run();

  const links = (
    await db.prepare("SELECT user_id, chat_id, prefs FROM telegram_links").all<{ user_id: number; chat_id: string; prefs: string }>()
  ).results;
  if (!links.length) return { users: 0, sent: 0 };

  const shared: TelegramEvent[] = [];

  // Signals the 15-minute automation recorded since the last dispatch.
  const since = await db.prepare("SELECT value FROM telegram_state WHERE key = 'signals_since'").first<{ value: string }>();
  const nowIso = new Date(now).toISOString();
  if (!since) {
    await db.prepare("INSERT OR REPLACE INTO telegram_state (key, value) VALUES ('signals_since', ?1)").bind(nowIso).run();
  } else {
    const rows = (
      await db
        .prepare(
          `SELECT id, symbol, side, signal, score, entry_price, timeframe, detected_at
             FROM signal_records WHERE detected_at > ?1 ORDER BY detected_at DESC LIMIT 30`,
        )
        .bind(since.value)
        .all<{ id: string; symbol: string; side: string; signal: string; score: number; entry_price: number; timeframe: string; detected_at: string }>()
        .catch(() => ({ results: [] as never[] }))
    ).results;
    for (const r of rows) {
      shared.push(signalEvent({ id: r.id, symbol: r.symbol, side: r.side, signal: r.signal, score: r.score, entryPrice: r.entry_price, timeframe: r.timeframe }));
    }
    if (rows.length) {
      await db.prepare("UPDATE telegram_state SET value = ?1 WHERE key = 'signals_since'").bind(rows[0].detected_at).run();
    }
  }

  // High-impact news from the last 3 hours (shared cache with the panel).
  try {
    const news = await cached<CryptoNewsResult>("crypto-news", 10 * 60_000, async () => {
      const r = await loadCryptoNews(now);
      return r.items.length ? r : null;
    }, 6 * 3_600_000);
    for (const n of news.value?.items ?? []) {
      if (n.impact === "ALTO" && now - n.publishedAt < 3 * 3_600_000) shared.push(newsEvent(n));
    }
  } catch {
    // News down: the other categories still go out.
  }

  // Fear & Greed, only when it is at an extreme.
  try {
    const fg = await cached<FearGreed>("fear-greed", 30 * 60_000, async () => {
      const r = await fetch("https://api.alternative.me/fng/?limit=31&format=json", { signal: AbortSignal.timeout(6000) });
      return r.ok ? parseFearGreed(await r.json()) : null;
    }, 24 * 3_600_000);
    const e = fg.value ? fearGreedEvent(fg.value.value, fg.value.zone, nowIso.slice(0, 10)) : null;
    if (e) shared.push(e);
  } catch {
    // Index down: skip it this run.
  }

  let sent = 0;
  for (const link of links) {
    const prefs = parsePrefs(safeJson(link.prefs));
    const events = [...shared];

    // DCA reminders in the user's own morning.
    const local = new Date(now - prefs.tzOffsetMin * 60_000);
    if (local.getUTCHours() >= 9) {
      const schedules = (
        await db
          .prepare("SELECT symbol, usd_amount, frequency, weekday, enabled FROM dca_schedules WHERE user_id = ?1")
          .bind(link.user_id)
          .all<{ symbol: string; usd_amount: number; frequency: string; weekday: number; enabled: number }>()
          .catch(() => ({ results: [] as never[] }))
      ).results;
      for (const s of schedules) {
        const schedule: DcaSchedule = {
          symbol: s.symbol,
          usdAmount: s.usd_amount,
          frequency: s.frequency as DcaSchedule["frequency"],
          weekday: s.weekday,
          enabled: s.enabled === 1,
        };
        // `local` is shifted so its UTC fields are the user's wall clock;
        // the Worker runs in UTC, so isDueToday reads the user's day.
        if (isDueToday(schedule, local)) events.push(dcaEvent(s.symbol, s.usd_amount, local.toISOString().slice(0, 10)));
      }
    }
    if (!events.length) continue;

    const prefix = `${link.user_id}|`;
    const keys = events.map((e) => prefix + e.key);
    const already = new Set<string>();
    for (let i = 0; i < keys.length; i += 50) {
      const chunk = keys.slice(i, i + 50);
      const rows = (
        await db
          .prepare(`SELECT key FROM telegram_sent WHERE key IN (${chunk.map((_, j) => `?${j + 1}`).join(",")})`)
          .bind(...chunk)
          .all<{ key: string }>()
      ).results;
      for (const r of rows) already.add(r.key.slice(prefix.length));
    }

    const { send, rest } = selectForUser(events, prefs, already);
    const outgoing = [...send.map((e) => e.text)];
    if (rest.length) outgoing.push(`<i>+${rest.length} alertas más. Abrí ALT RADAR para verlas.</i>`);

    for (const text of outgoing) {
      const r = await sendMessage(token, link.chat_id, text);
      if (!r.ok && /blocked|deactivated|chat not found/i.test(r.description ?? "")) {
        // The user blocked or deleted the bot: stop trying.
        await db.prepare("DELETE FROM telegram_links WHERE user_id = ?1").bind(link.user_id).run();
        break;
      }
      if (r.ok) sent += 1;
    }
    for (const e of [...send, ...rest]) {
      await db.prepare("INSERT OR IGNORE INTO telegram_sent (key, sent_at) VALUES (?1, ?2)").bind(prefix + e.key, now).run();
    }
  }

  await db.prepare("DELETE FROM telegram_sent WHERE sent_at < ?1").bind(now - 8 * 86_400_000).run();
  await db.prepare("DELETE FROM telegram_link_codes WHERE expires_at < ?1").bind(now).run();
  return { users: links.length, sent };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
