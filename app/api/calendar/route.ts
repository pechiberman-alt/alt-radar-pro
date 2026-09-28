import { parseFfCalendar, type MacroEvent } from "@/lib/econ-calendar";
import { cached } from "@/lib/upstream-cache";

export const dynamic = "force-dynamic";

const FEEDS = [
  "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
  "https://cdn-nfs.faireconomy.media/ff_calendar_thisweek.json",
];

/**
 * This week's macro calendar, from Forex Factory's public feed.
 *
 * The feed rate-limits aggressively and answers with an HTML page rather than
 * an error status when it does, so the body is checked before it is parsed.
 * It is cached for an hour (the calendar changes rarely, and polling would get
 * this server blocked) and a stale copy is kept for a week: an old calendar
 * still knows when last week's FOMC was, and more to the point, next Tuesday's
 * CPI date rarely moves. When nothing is available the answer is an error,
 * never an empty list — a bot reading "no events" would think the week quiet.
 */
export async function GET() {
  const { value, state, ageMs } = await cached<MacroEvent[]>(
    "ff-calendar",
    60 * 60_000,
    async () => {
      for (const url of FEEDS) {
        try {
          const response = await fetch(url, {
            headers: { Accept: "application/json", "User-Agent": "ALT-RADAR-PRO/1.0" },
            signal: AbortSignal.timeout(6000),
          });
          if (!response.ok) continue;
          const body = await response.text();
          if (!body.trimStart().startsWith("[")) continue; // rate-limit HTML
          const events = parseFfCalendar(JSON.parse(body));
          if (events.length) return events;
        } catch {
          // next mirror
        }
      }
      return null;
    },
    7 * 24 * 60 * 60_000,
  );

  if (!value) {
    return Response.json({ error: "CALENDARIO NO DISPONIBLE", events: [] }, { status: 502 });
  }
  return Response.json(
    { events: value, source: "Forex Factory", cache: state, ageMs, stale: state === "STALE" },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
