import assert from "node:assert/strict";
import test from "node:test";
import {
  activeBlackout, calendarBlackouts, DEFAULT_NEWS_GUARD, headlineBlackouts, loadCalendar, mustCloseBy,
  parseFfCalendar, upcomingEvents, type MacroEvent,
} from "../lib/econ-calendar.ts";

const MIN = 60_000;
// The shape Forex Factory's weekly JSON really uses: local ISO time with offset.
const FF = [
  { title: "Core CPI m/m", country: "USD", date: "2026-06-10T08:30:00-04:00", impact: "High", forecast: "0.3%", previous: "0.4%" },
  { title: "Unemployment Claims", country: "USD", date: "2026-06-11T08:30:00-04:00", impact: "Medium", forecast: "", previous: "230K" },
  { title: "BOE Rate Decision", country: "GBP", date: "2026-06-11T07:00:00+01:00", impact: "High", forecast: "4.5%", previous: "4.5%" },
  { title: "Bank Holiday", country: "JPY", date: "2026-06-12T00:00:00+09:00", impact: "Holiday", forecast: "", previous: "" },
  { title: "Speech", country: "USD", date: "not a date", impact: "High" },
  { country: "USD", date: "2026-06-12T10:00:00-04:00", impact: "High" }, // no title
  null,
  "junk",
];

test("parses the feed: offsets become UTC, holidays and malformed rows are dropped", () => {
  const events = parseFfCalendar(FF);
  assert.equal(events.length, 3);
  const cpi = events.find((e) => e.title === "Core CPI m/m")!;
  assert.equal(cpi.time, Date.parse("2026-06-10T12:30:00Z")); // 08:30 at -04:00
  assert.equal(cpi.impact, "high");
  assert.equal(cpi.forecast, "0.3%");
  assert.equal(events.find((e) => e.title === "Unemployment Claims")!.forecast, null, "blank forecast is null, not an empty string");
  assert.deepEqual(events.map((e) => e.time), [...events.map((e) => e.time)].sort((a, b) => a - b), "sorted by time");
});

test("anything that isn't an array yields no events, never a throw", () => {
  for (const bad of [null, undefined, {}, "<html>", 42]) assert.deepEqual(parseFfCalendar(bad), []);
});

const events = parseFfCalendar(FF);
const cpiTime = Date.parse("2026-06-10T12:30:00Z");

test("only the currencies and impacts asked for create blackouts — USD high by default", () => {
  const windows = calendarBlackouts(events, DEFAULT_NEWS_GUARD);
  assert.equal(windows.length, 1);
  assert.match(windows[0].label, /USD · Core CPI/);
  const wider = calendarBlackouts(events, { ...DEFAULT_NEWS_GUARD, impacts: ["high", "medium"], currencies: ["USD", "GBP"] });
  assert.equal(wider.length, 3);
});

test("the window: no entries 30 min before to 20 after, positions closed 10 min before", () => {
  const [w] = calendarBlackouts(events, DEFAULT_NEWS_GUARD);
  assert.equal(w.start, cpiTime - 30 * MIN);
  assert.equal(w.end, cpiTime + 20 * MIN);
  assert.equal(w.closeAt, cpiTime - 10 * MIN);
});

test("the no-entry window never starts later than the close time, so a trade isn't opened only to be shut", () => {
  const [w] = calendarBlackouts(events, { ...DEFAULT_NEWS_GUARD, blockBeforeMin: 5, closeBeforeMin: 20 });
  assert.ok(w.start <= (w.closeAt as number));
});

test("activeBlackout: start inclusive, end exclusive", () => {
  const windows = calendarBlackouts(events, DEFAULT_NEWS_GUARD);
  assert.equal(activeBlackout(windows, cpiTime - 30 * MIN - 1), null);
  assert.ok(activeBlackout(windows, cpiTime - 30 * MIN));
  assert.ok(activeBlackout(windows, cpiTime));
  assert.ok(activeBlackout(windows, cpiTime + 20 * MIN - 1));
  assert.equal(activeBlackout(windows, cpiTime + 20 * MIN), null);
});

test("mustCloseBy: a position whose life reaches the close time has to be shut", () => {
  const windows = calendarBlackouts(events, DEFAULT_NEWS_GUARD);
  assert.equal(mustCloseBy(windows, cpiTime - 60 * MIN, cpiTime - 15 * MIN), null, "ends before the close time");
  assert.ok(mustCloseBy(windows, cpiTime - 60 * MIN, cpiTime - 5 * MIN), "reaches the close time");
});

test("a breaking high-risk headline pauses entries; a routine or low-risk one doesn't", () => {
  const at = "2026-06-10T10:00:00Z";
  const blackouts = headlineBlackouts([
    { title: "Strike on oil facility", publishedAt: at, status: "BREAKING", risk: 82 },
    { title: "Minor item", publishedAt: at, status: "BREAKING", risk: 50 },
    { title: "Confirmed report", publishedAt: at, status: "CONFIRMED", risk: 90 },
    { title: "Bad date", publishedAt: "x", status: "BREAKING", risk: 90 },
  ]);
  assert.equal(blackouts.length, 1);
  assert.equal(blackouts[0].closeAt, null, "can't close ahead of something that already happened");
  assert.equal(blackouts[0].end - blackouts[0].start, 30 * MIN);
});

test("upcomingEvents keeps the window, the filters, and a just-released event", () => {
  const list = upcomingEvents(events, cpiTime + 10 * MIN, { hours: 48, impacts: ["high"], currencies: ["USD"] });
  assert.deepEqual(list.map((e: MacroEvent) => e.title), ["Core CPI m/m"]);
  assert.equal(upcomingEvents(events, cpiTime + 5 * 60 * MIN, { currencies: ["USD"], impacts: ["high"] }).length, 0);
});

// ─── loading ──────────────────────────────────────────────────────────────

const json = (body: unknown, ok = true) => new Response(JSON.stringify(body), { status: ok ? 200 : 502 });

test("loadCalendar: the Worker's copy first", async () => {
  const calls: string[] = [];
  const result = await loadCalendar((async (url: string) => {
    calls.push(url);
    return json({ events, source: "Forex Factory", stale: false });
  }) as unknown as typeof fetch);
  assert.equal(result?.events.length, 3);
  assert.deepEqual(calls, ["/api/calendar"]);
});

test("loadCalendar: when the Worker has nothing, the browser asks the feed itself", async () => {
  const calls: string[] = [];
  const result = await loadCalendar((async (url: string) => {
    calls.push(url);
    return url === "/api/calendar" ? json({ error: "x", events: [] }, false) : new Response(JSON.stringify(FF), { status: 200 });
  }) as unknown as typeof fetch);
  assert.equal(result?.events.length, 3);
  assert.match(result!.source, /directo/);
  assert.equal(calls.length, 2);
});

test("loadCalendar: a rate-limit HTML page is not a calendar, and neither is silence — null, never an empty week", async () => {
  const html = (async (url: string) => (url === "/api/calendar" ? json({}, false) : new Response("<html>slow down</html>", { status: 200 }))) as unknown as typeof fetch;
  assert.equal(await loadCalendar(html), null);
  const down = (async () => {
    throw new Error("offline");
  }) as unknown as typeof fetch;
  assert.equal(await loadCalendar(down), null);
});
