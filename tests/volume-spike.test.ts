import assert from "node:assert/strict";
import test from "node:test";
import { createDeliveryState, DEFAULT_ALERT_PREFERENCES, selectDeliverable, volumeAlert } from "../lib/alerts.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";
import { detectVolumeSpike, VOLUME_LOOKBACK } from "../lib/volume-spike.ts";

const F = 900_000;
const candle = (i: number, volume: number, o: Partial<SwingCandle> = {}): SwingCandle => ({
  openTime: i * F, open: 100, high: 101, low: 99, close: 100.5, volume, quoteVolume: volume * 100, ...o,
});
/** 20 candles of `base` volume, then the last one. */
const series = (last: number, base = 100, lastOpts: Partial<SwingCandle> = {}) => [
  ...Array.from({ length: VOLUME_LOOKBACK }, (_, i) => candle(i, base)),
  candle(VOLUME_LOOKBACK, last, lastOpts),
];
const NOW = (VOLUME_LOOKBACK + 5) * F;

test("3.5× the average of the previous 20 is a spike; just under 3× is not; exactly 3× is", () => {
  const s = detectVolumeSpike(series(350), F, NOW)!;
  assert.equal(s.multiple, 3.5);
  assert.equal(detectVolumeSpike(series(299), F, NOW), null);
  assert.equal(detectVolumeSpike(series(300), F, NOW)?.multiple, 3);
});

test("only the 20 candles before the last count: an older spike doesn't inflate the baseline", () => {
  const withOld = [candle(-1, 100_000), ...series(300)];
  assert.equal(detectVolumeSpike(withOld, F, NOW)?.multiple, 3);
  // and a spike inside the window does raise it, which is what makes the next one harder to trigger
  const inside = series(300);
  inside[5] = candle(5, 2100);
  assert.equal(detectVolumeSpike(inside, F, NOW), null);
});

test("not enough history, no baseline, or unusable numbers: nothing is reported", () => {
  assert.equal(detectVolumeSpike(series(350).slice(1), F, NOW), null, "20 candles is one short");
  assert.equal(detectVolumeSpike(series(350, 0), F, NOW), null, "zero baseline");
  assert.equal(detectVolumeSpike(series(Number.NaN), F, NOW), null);
  assert.equal(detectVolumeSpike(series(0), F, NOW), null);
  const bad = series(350);
  bad[3] = candle(3, Number.NaN);
  assert.equal(detectVolumeSpike(bad, F, NOW), null);
  assert.equal(detectVolumeSpike([], F, NOW), null);
});

test("a candle still forming is reported as such; one that has closed is not", () => {
  const forming = detectVolumeSpike(series(400), F, VOLUME_LOOKBACK * F + F / 2)!;
  assert.equal(forming.closed, false);
  assert.equal(detectVolumeSpike(series(400), F, (VOLUME_LOOKBACK + 1) * F)!.closed, true);
});

test("direction and size come from the candle: up, down, and a flat one", () => {
  assert.ok(Math.abs(detectVolumeSpike(series(400, 100, { close: 101 }), F, NOW)!.changePct - 1) < 1e-9);
  assert.ok(Math.abs(detectVolumeSpike(series(400, 100, { close: 98 }), F, NOW)!.changePct + 2) < 1e-9);
  assert.equal(detectVolumeSpike(series(400, 100, { close: 100 }), F, NOW)!.changePct, 0);
});

test("dollars traded come from the feed, or volume × close when the feed has none", () => {
  assert.equal(detectVolumeSpike(series(400), F, NOW)!.quoteVolume, 40_000);
  assert.equal(detectVolumeSpike(series(400, 100, { quoteVolume: 0, close: 50 }), F, NOW)!.quoteVolume, 20_000);
});

test("the alert: one id per candle, IMPORTANTE, category VOLUMEN, decimal comma, and it says what it does not claim", () => {
  const spike = { multiple: 4.25, quoteVolume: 48_100_000, changePct: 1.3, closed: false, openTime: 1_000 };
  const a = volumeAlert("BTCUSDT", "15m", spike, 5);
  assert.equal(a.category, "VOLUMEN");
  assert.equal(a.priority, "IMPORTANTE");
  assert.equal(a.id, "volume-BTCUSDT-15m-1000");
  assert.equal(a.title, "BTCUSDT · volumen 4,3× en 15m");
  assert.match(a.body, /va subiendo \+1,30%/);
  assert.match(a.body, /\$48,1 M negociados/);
  assert.match(a.body, /no dice hacia dónde sigue/);
  assert.notEqual(volumeAlert("BTCUSDT", "15m", { ...spike, openTime: 1_000 + F }).id, a.id, "the next candle is a new event");
  assert.notEqual(volumeAlert("ETHUSDT", "15m", spike).id, a.id);
  assert.notEqual(volumeAlert("BTCUSDT", "1h", spike).id, a.id);
  assert.match(volumeAlert("BTCUSDT", "1h", { ...spike, closed: true, changePct: -2.5 }).body, /cerró bajando −2,50%/);
  assert.match(volumeAlert("BTCUSDT", "1h", { ...spike, changePct: 0.01 }).body, /casi sin cambio/);
  assert.match(volumeAlert("BTCUSDT", "4h", { ...spike, quoteVolume: 2_300_000_000 }).body, /\$2,3 mil M/);
  assert.match(volumeAlert("BTCUSDT", "4h", { ...spike, quoteVolume: 750_000 }).body, /\$750 mil negociados/);
});

test("delivery: on by default once alerts are enabled, spaced five minutes apart, and switchable off", () => {
  const on = { ...DEFAULT_ALERT_PREFERENCES, enabled: true };
  const spike = { multiple: 4, quoteVolume: 1e6, changePct: 1, closed: true, openTime: 1 };
  const state = createDeliveryState();
  const first = volumeAlert("BTCUSDT", "15m", spike);
  const second = volumeAlert("ETHUSDT", "15m", spike);
  assert.equal(selectDeliverable([first], on, state, 0).length, 1);
  assert.equal(selectDeliverable([second], on, state, 4 * 60_000).length, 0, "inside the cooldown");
  assert.equal(selectDeliverable([second], on, state, 6 * 60_000).length, 1);
  assert.equal(selectDeliverable([volumeAlert("SOLUSDT", "1h", spike)], { ...on, categories: { ...on.categories, VOLUMEN: false } }, createDeliveryState(), 0).length, 0);
});
