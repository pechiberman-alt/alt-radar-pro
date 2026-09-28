/**
 * Macro calendar (Forex Factory) and the trading blackouts built from it.
 *
 * Scheduled high-impact releases — FOMC, CPI, NFP — move crypto by several
 * percent within minutes, in either direction, with spreads and slippage
 * blowing out at the same moment. A technical setup carries no information
 * about that, so the honest rule is not to hold a position through one. This
 * module turns the calendar into time windows a bot can obey: no new entries
 * around the event, and open positions closed before it.
 *
 * Source: Forex Factory's public weekly JSON (nfs.faireconomy.media). It is
 * a rolling current-week feed, has no key, and rate-limits hard — so callers
 * cache it for an hour and treat any failure as "calendar unknown", which a
 * bot must handle by NOT trading, never by assuming the week is quiet.
 */

export type MacroImpact = "high" | "medium" | "low";

export type MacroEvent = {
  id: string;
  title: string;
  /** Currency / region code as Forex Factory reports it: USD, EUR, ... */
  currency: string;
  /** UTC milliseconds. */
  time: number;
  impact: MacroImpact;
  forecast: string | null;
  previous: string | null;
};

const IMPACTS: Record<string, MacroImpact | undefined> = { high: "high", medium: "medium", low: "low" };

const text = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

/** Forex Factory rows → events. Anything malformed, holidays, and rows
 *  without a usable time are dropped rather than guessed at. */
export function parseFfCalendar(raw: unknown): MacroEvent[] {
  if (!Array.isArray(raw)) return [];
  const events: MacroEvent[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const title = text(r.title);
    const currency = text(r.country)?.toUpperCase();
    const impact = IMPACTS[String(r.impact ?? "").toLowerCase()];
    const time = typeof r.date === "string" ? Date.parse(r.date) : NaN; // ISO-8601 with its own offset
    if (!title || !currency || !impact || !Number.isFinite(time)) continue;
    events.push({
      id: `${currency}-${time}-${title}`,
      title,
      currency,
      time,
      impact,
      forecast: text(r.forecast),
      previous: text(r.previous),
    });
  }
  return events.sort((a, b) => a.time - b.time);
}

export type NewsGuardConfig = {
  /** Which currencies' releases count. USD by default: it drives crypto. */
  currencies: string[];
  impacts: ("high" | "medium")[];
  /** No new entries this long before the release... */
  blockBeforeMin: number;
  /** ...and this long after it. */
  blockAfterMin: number;
  /** Open positions are closed this long before the release. */
  closeBeforeMin: number;
};

export const DEFAULT_NEWS_GUARD: NewsGuardConfig = {
  currencies: ["USD"],
  impacts: ["high"],
  blockBeforeMin: 30,
  blockAfterMin: 20,
  closeBeforeMin: 10,
};

export type Blackout = {
  /** No new entries from here... */
  start: number;
  /** ...until here. */
  end: number;
  /** Close open positions from here. Null: headlines can't be closed ahead of. */
  closeAt: number | null;
  label: string;
  kind: "calendar" | "headline";
};

const MIN = 60_000;

/** The windows around scheduled releases. The no-entry window always starts at
 *  least as early as the close time, so a trade is never opened only to be
 *  shut a moment later. */
export function calendarBlackouts(events: MacroEvent[], guard: NewsGuardConfig): Blackout[] {
  return events
    .filter((e) => guard.currencies.includes(e.currency) && (guard.impacts as string[]).includes(e.impact))
    .map((e) => {
      const lead = Math.max(guard.blockBeforeMin, guard.closeBeforeMin);
      return {
        start: e.time - lead * MIN,
        end: e.time + guard.blockAfterMin * MIN,
        closeAt: e.time - guard.closeBeforeMin * MIN,
        label: `${e.currency} · ${e.title}`,
        kind: "calendar" as const,
      };
    });
}

export type HeadlineLike = { title: string; publishedAt: string; status: string; risk: number };

/** A breaking, high-risk headline pauses new entries for a while. It can't
 *  close positions "before" it — it has already happened. */
export function headlineBlackouts(
  news: HeadlineLike[],
  options: { windowMin?: number; minRisk?: number } = {},
): Blackout[] {
  const windowMin = options.windowMin ?? 30;
  const minRisk = options.minRisk ?? 70;
  const out: Blackout[] = [];
  for (const n of news) {
    if (n.status !== "BREAKING" || n.risk < minRisk) continue;
    const at = Date.parse(n.publishedAt);
    if (!Number.isFinite(at)) continue;
    out.push({ start: at, end: at + windowMin * MIN, closeAt: null, label: n.title.slice(0, 80), kind: "headline" });
  }
  return out;
}

/** The blackout covering instant `t` for new entries, if any. */
export function activeBlackout(blackouts: Blackout[], t: number): Blackout | null {
  return blackouts.find((b) => t >= b.start && t < b.end) ?? null;
}

/** Whether a position held over [from, to) must already have been closed:
 *  the span reaches a scheduled release's close time. */
export function mustCloseBy(blackouts: Blackout[], from: number, to: number): Blackout | null {
  return blackouts.find((b) => b.closeAt !== null && to > b.closeAt && from < b.end) ?? null;
}

export function upcomingEvents(
  events: MacroEvent[],
  now: number,
  options: { hours?: number; impacts?: MacroImpact[]; currencies?: string[]; limit?: number } = {},
): MacroEvent[] {
  const horizon = now + (options.hours ?? 24 * 7) * 60 * MIN;
  return events
    .filter(
      (e) =>
        e.time >= now - 30 * MIN && // a release from the last half hour is still news
        e.time <= horizon &&
        (!options.impacts || options.impacts.includes(e.impact)) &&
        (!options.currencies || options.currencies.includes(e.currency)),
    )
    .slice(0, options.limit ?? 50);
}

export type CalendarLoad = { events: MacroEvent[]; source: string; stale: boolean } | null;

const DIRECT_FEED = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

/**
 * The calendar for a client: the Worker's cached copy first, then the feed
 * directly from the browser (a person's own connection is not the one Forex
 * Factory rate-limits), and null if neither answers — never an empty list
 * pretending the week is quiet.
 */
export async function loadCalendar(fetcher: typeof fetch = fetch): Promise<CalendarLoad> {
  try {
    const r = await fetcher("/api/calendar", { cache: "no-store" });
    if (r.ok) {
      const body = (await r.json()) as { events?: MacroEvent[]; source?: string; stale?: boolean };
      if (Array.isArray(body.events) && body.events.length) {
        return { events: body.events, source: body.source ?? "Forex Factory", stale: Boolean(body.stale) };
      }
    }
  } catch {
    // fall through to the direct attempt
  }
  try {
    const r = await fetcher(DIRECT_FEED);
    if (r.ok) {
      const raw = await r.text();
      if (raw.trimStart().startsWith("[")) {
        const events = parseFfCalendar(JSON.parse(raw));
        if (events.length) return { events, source: "Forex Factory (directo)", stale: false };
      }
    }
  } catch {
    // unavailable
  }
  return null;
}
