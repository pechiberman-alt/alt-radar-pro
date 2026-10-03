import assert from "node:assert/strict";
import test from "node:test";
import { liveRobotTrade, robotSignalKey, robotSignalText, validateRobotSignal } from "../lib/robot-signals.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const NOW = Date.UTC(2026, 9, 3, 12);
const ok = { symbol: "SOLUSDT", timeframe: "15m", side: "LONG", entry: 150, stop: 147, target: 156, time: NOW - 900_000, variant: "volumen", validation: { trades: 31, profitFactor: 1.4, positive: 7, tested: 11 } };

test("a well-formed signal passes and keeps its numbers", () => {
  const s = validateRobotSignal(ok, NOW)!;
  assert.equal(s.symbol, "SOLUSDT");
  assert.equal(s.validation.positive, 7);
});

test("inconsistent or hostile input is rejected", () => {
  const bad = [
    { ...ok, symbol: "SOL/USDT" }, { ...ok, symbol: "<b>USDT" }, { ...ok, timeframe: "1w" }, { ...ok, side: "BUY" },
    { ...ok, stop: 151 }, { ...ok, target: 149 }, { ...ok, side: "SHORT" }, { ...ok, entry: Number.NaN },
    { ...ok, time: NOW + 3_600_000 }, { ...ok, time: NOW - 2 * 86_400_000 }, null, "x",
  ];
  for (const b of bad) assert.equal(validateRobotSignal(b, NOW), null, JSON.stringify(b));
});

test("one key per coin, timeframe, candle and side: the same signal is never sent twice", () => {
  const s = validateRobotSignal(ok, NOW)!;
  assert.equal(robotSignalKey(s), `mm:SOLUSDT:15m:${NOW - 900_000}:LONG`);
});

test("the Telegram text carries entry, stop, target with R, the variant and its validation, escaped", () => {
  const t = robotSignalText(validateRobotSignal({ ...ok, variant: "volumen <x>" }, NOW)!);
  assert.match(t, /ROBOT MM · SOL · 🟢 LONG/);
  assert.match(t, /Entrada 150/);
  assert.match(t, /SL 147 \(-2,00%\)/);
  assert.match(t, /TP 156 \(\+4,00% · 2,0R\)/);
  assert.match(t, /volumen &lt;x&gt;/);
  assert.match(t, /gana en 7 de 11 monedas/);
  assert.match(t, /no es una orden/);
});

test("live trade: only one opened on the last closed candle counts", () => {
  // The LIQ+VOL sweep scenario stretched to 260 candles, sweep at the end.
  const make = (sweepAt: number) =>
    Array.from({ length: 260 }, (_, i): SwingCandle => {
      if (i === sweepAt - 10) return { openTime: i, open: 100, high: 100.5, low: 98, close: 100.2, volume: 100, quoteVolume: 0 };
      if (i === sweepAt) return { openTime: i, open: 99.3, high: 99.6, low: 97.5, close: 99, volume: 400, quoteVolume: 0 };
      return { openTime: i, open: 100, high: 100.5, low: 99.5, close: 100.2, volume: 100, quoteVolume: 0 };
    });
  const lives = [{ price: 103, weight: 10, side: "short" as const, formedTime: 0, sweptTime: null }];
  const none = { vol: false, flush: false, imbalance: false, trend: false };
  const live = liveRobotTrade(make(259), lives, none);
  assert.ok(live, "sweep on the last candle opens a trade");
  assert.equal(live!.event.side, "LONG");
  assert.ok(Math.abs(live!.target - 103) < 0.3, `aims at the liquidity pool (0,25% buckets): ${live!.target}`);
  assert.equal(liveRobotTrade(make(240), lives, none), null, "an older trade is not a new signal");
  assert.equal(liveRobotTrade(make(259).slice(0, 150), lives, none), null, "too little history");
});
