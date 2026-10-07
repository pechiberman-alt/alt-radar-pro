import assert from "node:assert/strict";
import test from "node:test";
import { DESK_SETTINGS_KEY, cachedDesk, deskFor, loadDeskSettings, saveDeskSettings, typedNumber } from "../lib/jarvis-desk-run.ts";
import { DEFAULT_DESK_SETTINGS } from "../lib/jarvis-desk.ts";

/** A minimal browser storage, so the settings code runs as it does on the phone. */
function fakeWindow(initial: Record<string, string> = {}, broken = false) {
  const store = new Map(Object.entries(initial));
  const localStorage = {
    getItem: (k: string) => {
      if (broken) throw new Error("private mode");
      return store.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (broken) throw new Error("private mode");
      store.set(k, v);
    },
  };
  (globalThis as unknown as { window: unknown }).window = { localStorage };
  return store;
}

test("risk settings: nonsense falls back to the safe defaults, never to a bigger risk", () => {
  fakeWindow({ [DESK_SETTINGS_KEY]: JSON.stringify({ capital: -50, riesgoPct: 40, apalancamientoMax: 500 }) });
  assert.deepEqual(loadDeskSettings(), { capital: null, riesgoPct: DEFAULT_DESK_SETTINGS.riesgoPct, apalancamientoMax: DEFAULT_DESK_SETTINGS.apalancamientoMax });
  fakeWindow({ [DESK_SETTINGS_KEY]: "{not json" });
  assert.deepEqual(loadDeskSettings(), DEFAULT_DESK_SETTINGS);
  fakeWindow({}, true);
  assert.deepEqual(loadDeskSettings(), DEFAULT_DESK_SETTINGS, "private mode: defaults, no crash");
  assert.doesNotThrow(() => saveDeskSettings({ capital: 1000, riesgoPct: 1, apalancamientoMax: 5 }));
});

test("risk settings round-trip; leverage is a whole number", () => {
  const store = fakeWindow();
  saveDeskSettings({ capital: 2500, riesgoPct: 0.5, apalancamientoMax: 7 });
  assert.ok(store.has(DESK_SETTINGS_KEY));
  assert.deepEqual(loadDeskSettings(), { capital: 2500, riesgoPct: 0.5, apalancamientoMax: 7 });
  fakeWindow({ [DESK_SETTINGS_KEY]: JSON.stringify({ capital: 100, riesgoPct: 2, apalancamientoMax: 7.6 }) });
  assert.equal(loadDeskSettings().apalancamientoMax, 8);
});

test("nothing cached is nothing, not a made-up decision", () => {
  assert.equal(cachedDesk("BTC"), null);
  assert.equal(cachedDesk("BTCUSDT"), null);
});

test("numbers typed on the phone: Argentine thousands and decimals, or plain decimals", () => {
  assert.equal(typedNumber("1.000"), 1000);
  assert.equal(typedNumber("1.000,5"), 1000.5);
  assert.equal(typedNumber("0,5"), 0.5);
  assert.equal(typedNumber("0.5"), 0.5);
  assert.equal(typedNumber("2500"), 2500);
  assert.equal(typedNumber("$ 2.500"), 2500);
  assert.equal(typedNumber("10x"), 10);
  assert.equal(typedNumber("1,5%"), 1.5);
  assert.equal(typedNumber("0,"), 0, "on the way to 0,5");
  assert.equal(typedNumber(""), null);
  assert.equal(typedNumber("abc"), null);
});

/** Binance-shaped klines of a steady advance, the last one still forming. */
function klines(interval: string, limit: number): unknown[] {
  const step = { "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 }[interval as "1h"]!;
  const lastOpen = Math.floor(Date.now() / step) * step;
  const hours = step / 3_600_000;
  const f = (h: number) => 150 * Math.exp(0.0006 * h) * (1 + 0.01 * Math.sin(h / 9));
  return Array.from({ length: limit }, (_, i) => {
    const t = lastOpen - (limit - 1 - i) * step;
    const h = (i - limit) * hours;
    const o = f(h);
    const c = f(h + hours);
    return [t, String(o), String(Math.max(o, c) * 1.002), String(Math.min(o, c) * 0.998), String(c), "1000", t + step - 1, String(1000 * c), 10, "500", String(500 * c), "0"];
  });
}

test("new risk settings decide again over the same data, without asking the network again", async () => {
  fakeWindow();
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const m = url.match(/\/fapi\/v1\/klines\?symbol=(\w+)&interval=(\w+)&limit=(\d+)/);
    if (m) return new Response(JSON.stringify(klines(m[2], Number(m[3]))), { status: 200 });
    return new Response("", { status: 404 });
  }) as typeof fetch;
  try {
    const first = await deskFor("SOL");
    assert.ok(first.decision, "a decision from the stubbed candles");
    assert.ok(first.decision!.alcista.riesgo, "an advance gives the bull side a plan reviewed by risk");
    assert.equal(first.decision!.alcista.riesgo!.posicionUsd, null, "no capital loaded: no position size invented");
    assert.match(first.snapshot.sources[0], /Velas: Binance Futures/);
    const before = calls.length;
    saveDeskSettings({ capital: 1000, riesgoPct: 1, apalancamientoMax: 10 });
    assert.equal(calls.length, before, "no new request");
    const again = cachedDesk("SOL")!;
    assert.equal(again.alcista.riesgo!.riesgoUsd, 10, "1% of 1000");
    assert.ok(again.alcista.riesgo!.posicionUsd! > 0);
    const cached = await deskFor("SOL");
    assert.equal(calls.length, before, "a second ask within 90 s reuses the reading");
    assert.equal(cached.decision, again);
  } finally {
    globalThis.fetch = realFetch;
  }
});
