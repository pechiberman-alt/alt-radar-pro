import assert from "node:assert/strict";
import test from "node:test";
import { subscribeToAlerts } from "../lib/alert-bus.ts";
import type { Alert } from "../lib/alerts.ts";
import { DEFAULT_WATCH_PREFS } from "../lib/jarvis-watch.ts";
import { loadWatchPrefs, runWatch, saveWatchPrefs, WATCH_STATE_KEY, watchStatus } from "../lib/jarvis-watch-run.ts";

const H = 3_600_000;
const FRAME: Record<string, number> = { "1h": H, "4h": 4 * H, "1d": 24 * H };

/** A steady advance; the last closed hour trades ten times its normal volume. */
function klines(interval: string, limit: number) {
  const frame = FRAME[interval];
  const forming = Math.floor(Date.now() / frame) * frame;
  return Array.from({ length: limit }, (_, i) => {
    const t = forming - (limit - 1 - i) * frame;
    const o = 3 * Math.exp((0.0004 * (t - forming)) / H);
    const c = o * 1.001;
    const v = interval === "1h" && t === forming - H ? 10_000 : 1000;
    return [t, String(o), String(c * 1.002), String(o * 0.998), String(c), String(v), t + frame - 1, String(v * c), 10, "1", "1", "0"];
  });
}

const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
  dispatchEvent: () => true,
};
let calls = 0;
globalThis.fetch = (async (input: string | URL | Request) => {
  calls += 1;
  const url = String(input);
  const m = url.match(/\/(?:fapi\/v1|api\/v3)\/klines\?symbol=\w+&interval=(\w+)&limit=(\d+)/);
  if (m) return new Response(JSON.stringify(klines(m[1], Number(m[2]))));
  if (url.startsWith("/api/jarvis/paper")) return new Response("", { status: 401 });
  return new Response("", { status: 404 });
}) as typeof fetch;

test("switched off, the watch asks nothing", async () => {
  assert.equal(loadWatchPrefs().enabled, false);
  assert.deepEqual(await runWatch(), []);
  assert.equal(calls, 0);
});

test("switched on: alerts published once, remembered across runs, memory kept on this device", async () => {
  const seen: Alert[] = [];
  const off = subscribeToAlerts((a) => seen.push(a));
  saveWatchPrefs({ ...DEFAULT_WATCH_PREFS, enabled: true, symbols: ["XRPUSDT"] });
  const first = await runWatch();
  const vol = first.find((a) => a.id.startsWith("mesa:volumen:XRPUSDT:"));
  assert.ok(vol, `alerts: ${first.map((a) => a.id).join(", ")}`);
  assert.ok(seen.some((a) => a.id === vol.id), "published on the bus");
  assert.equal(watchStatus().running, false);
  assert.equal(watchStatus().lastAlerts, first.length);
  const second = await runWatch();
  assert.equal(second.filter((a) => a.id === vol.id).length, 0, "the same candle never alerts twice");
  const state = JSON.parse(store.get(WATCH_STATE_KEY)!) as { memory: Record<string, { trends: Record<string, string> }>; fired: string[] };
  assert.ok(state.fired.includes(vol.id));
  assert.ok(state.memory.XRPUSDT.trends["4h"], "the trends to compare next time");
  off();
});
