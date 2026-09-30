import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_TELEGRAM_PREFS, parsePrefs, selectForUser, volumeEvent } from "../lib/telegram.ts";
import { collectVolumeEvents, volumeEventsFrom } from "../lib/telegram-volume.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";
import type { VolumeSpike } from "../lib/volume-spike.ts";

const F = 900_000;
const spike: VolumeSpike = { multiple: 4.25, quoteVolume: 48_100_000, changePct: 1.3, closed: false, openTime: 777 };
const candle = (i: number, volume: number): SwingCandle => ({ openTime: i * F, open: 100, high: 101, low: 99, close: 100.5, volume, quoteVolume: volume * 100 });
const series = (last: number) => [...Array.from({ length: 20 }, (_, i) => candle(i, 100)), candle(20, last)];

test("the Telegram message: one key per candle, its own category, escaped text, and the caveat", () => {
  const e = volumeEvent("BTCUSDT", "15m", spike);
  assert.equal(e.key, "volume:BTCUSDT:15m:777");
  assert.equal(e.category, "VOLUMEN");
  assert.equal(e.priority, 68);
  assert.match(e.text, /<b>📊 BTC · volumen 4,3× en 15m<\/b>/);
  assert.match(e.text, /va subiendo \+1,30% con \$48,1 M negociados/);
  assert.match(e.text, /no dice hacia dónde sigue/);
  assert.notEqual(volumeEvent("BTCUSDT", "15m", { ...spike, openTime: 778 }).key, e.key, "the next candle is a new event");
  assert.notEqual(volumeEvent("BTCUSDT", "1h", spike).key, e.key);
  assert.doesNotMatch(volumeEvent("A<B>USDT", "15m", spike).text, /<B>/);
});

test("preferences saved before this category existed read it as on; an explicit off stays off", () => {
  assert.equal(parsePrefs({ categories: { "SEÑAL": true, DCA: true, NOTICIAS: true, SENTIMIENTO: true }, signalMinScore: 60 }).categories.VOLUMEN, true);
  assert.equal(parsePrefs({}).categories.VOLUMEN, true);
  assert.equal(parsePrefs({ categories: { VOLUMEN: false } }).categories.VOLUMEN, false);
  assert.equal(parsePrefs({ signalMinScore: 60 }).signalMinScore, 60, "the threshold he already lowered is untouched");
});

test("selection: sent when on, skipped when off, never twice, and folded into the summary past the cap", () => {
  const e = volumeEvent("BTCUSDT", "15m", spike);
  assert.equal(selectForUser([e], DEFAULT_TELEGRAM_PREFS, new Set()).send.length, 1);
  assert.equal(selectForUser([e], { ...DEFAULT_TELEGRAM_PREFS, categories: { ...DEFAULT_TELEGRAM_PREFS.categories, VOLUMEN: false } }, new Set()).send.length, 0);
  assert.equal(selectForUser([e], DEFAULT_TELEGRAM_PREFS, new Set([e.key])).send.length, 0);
  const many = ["15m", "1h", "4h", "5m", "30m", "2h"].map((tf) => volumeEvent("BTCUSDT", tf, spike));
  const { send, rest } = selectForUser(many, DEFAULT_TELEGRAM_PREFS, new Set());
  assert.equal(send.length, 4);
  assert.equal(rest.length, 2);
});

test("only the series with a spike produce an event", () => {
  const events = volumeEventsFrom(
    [
      { symbol: "BTCUSDT", interval: "15m", frameMs: F, candles: series(450) },
      { symbol: "ETHUSDT", interval: "15m", frameMs: F, candles: series(150) },
      { symbol: "SOLUSDT", interval: "1h", frameMs: 4 * F, candles: series(300) },
    ],
    30 * F,
  );
  assert.deepEqual(events.map((e) => e.key.split(":").slice(0, 3).join(":")), ["volume:BTCUSDT:15m", "volume:SOLUSDT:1h"]);
});

test("NETWORK: a coin whose data can't be fetched is skipped and the others still report", async () => {
  const real = globalThis.fetch;
  const now = 1_000 * 14_400_000;
  const rows = (interval: string, spikeIt: boolean) => {
    const f = interval === "15m" ? 900_000 : interval === "1h" ? 3_600_000 : 14_400_000;
    return Array.from({ length: 30 }, (_, i) => {
      const t = now - (30 - i) * f;
      const vol = i === 29 && spikeIt ? 500 : 100;
      return [t, "100", "101", "99", "100.5", String(vol), t + f - 1, String(vol * 100), 10, "0", "0", "0"];
    });
  };
  globalThis.fetch = (async (url: string) => {
    const u = new URL(url);
    const symbol = u.searchParams.get("symbol");
    if (symbol === "ETHUSDT") return new Response("nope", { status: 500 });
    return new Response(JSON.stringify(rows(u.searchParams.get("interval") as string, symbol === "BTCUSDT")), { status: 200 });
  }) as typeof fetch;
  try {
    const events = await collectVolumeEvents(now);
    assert.deepEqual(events.map((e) => e.key.split(":")[1]).sort(), ["BTCUSDT", "BTCUSDT", "BTCUSDT"], "BTC on its three frames; ETH failed; SOL is quiet");
    assert.ok(events.every((e) => e.category === "VOLUMEN"));
  } finally {
    globalThis.fetch = real;
  }
});
