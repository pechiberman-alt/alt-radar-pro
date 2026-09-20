import assert from "node:assert/strict";
import test from "node:test";
import { rankPressure, readPressure } from "../lib/pump-pressure.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const c = (i: number, price: number, spread: number, volume = 100): SwingCandle => ({
  openTime: 1_757_000_000_000 + i * 3_600_000,
  open: price,
  close: price,
  high: price + spread,
  low: price - spread,
  volume,
  quoteVolume: volume * price,
});

/** Wide for `wide` candles, then narrow for `tight` — a coiling market. */
const coiled = (wide: number, tight: number, volume = 100) => [
  ...Array.from({ length: wide }, (_, i) => c(i, 1000, 20, volume)),
  ...Array.from({ length: tight }, (_, i) => c(wide + i, 1000, 1, volume)),
];

/** Constant range throughout — nothing is coiling. */
const steady = (count: number) =>
  Array.from({ length: count }, (_, i) => c(i, 1000, 20));

test("a market that tightened reads as compressed", () => {
  const reading = readPressure({ symbol: "BTCUSDT", candles: coiled(46, 14) });
  assert.ok(reading);
  assert.ok(reading.factors.compression < 0.5, "el rango reciente es mucho menor que su media");
  assert.ok(reading.pressure > 55, `presión ${reading.pressure}`);
  assert.match(reading.note, /rara vez dura/);
});

test("a market with a constant range shows no pressure", () => {
  const reading = readPressure({ symbol: "BTCUSDT", candles: steady(70) });
  assert.ok(reading);
  assert.ok(reading.factors.compression > 0.9);
  assert.ok(reading.pressure < 40, `presión ${reading.pressure}`);
  assert.match(reading.note, /Sin compresión relevante/);
});

test("pressure is direction-free — it never moves with the bias", () => {
  const candles = coiled(46, 14);
  const flat = readPressure({ symbol: "X", candles });
  const bullish = readPressure({ symbol: "X", candles, oiChange: 0.2, funding: -0.001 });
  const bearish = readPressure({ symbol: "X", candles, oiChange: -0.2, funding: 0.001 });
  assert.equal(
    flat?.pressure,
    bullish?.pressure,
    "mezclarlas daría un número seguro hecho mitad de algo sólido y mitad de especulación",
  );
  assert.equal(flat?.pressure, bearish?.pressure);
});

test("crowded shorts lean the bias long, and the reverse", () => {
  const candles = coiled(46, 14);
  // Negative funding: shorts pay longs, which is fuel for an upward squeeze.
  const squeeze = readPressure({ symbol: "X", candles, oiChange: 0.15, funding: -0.0015 });
  assert.equal(squeeze?.biasLabel, "SESGO LARGO");
  const heavy = readPressure({ symbol: "X", candles, oiChange: -0.15, funding: 0.0015 });
  assert.equal(heavy?.biasLabel, "SESGO CORTO");
});

test("without open interest or funding there is no bias claimed", () => {
  const reading = readPressure({ symbol: "X", candles: coiled(46, 14) });
  assert.equal(reading?.bias, 0);
  assert.equal(reading?.biasLabel, "SIN SESGO");
  assert.equal(reading?.factors.oiChange, null);
  assert.equal(reading?.factors.funding, null);
});

test("the drivers name what is actually carrying the score", () => {
  const reading = readPressure({ symbol: "X", candles: coiled(46, 14) });
  assert.ok(reading);
  assert.ok(reading.drivers.length > 0);
  assert.ok(
    reading.drivers.some((driver) => /más angosto/.test(driver)),
    "la compresión debe aparecer nombrada cuando es la que manda",
  );
});

test("ranking puts the most coiled first", () => {
  const ranked = rankPressure([
    { symbol: "QUIETO", candles: steady(70) },
    { symbol: "COMPRIMIDO", candles: coiled(46, 14) },
  ]);
  assert.equal(ranked[0].symbol, "COMPRIMIDO");
  assert.equal(ranked.length, 2);
});

test("series too short are dropped rather than scored on thin data", () => {
  assert.equal(readPressure({ symbol: "X", candles: steady(20) }), null);
  assert.equal(readPressure({ symbol: "X", candles: [] }), null);
  assert.deepEqual(rankPressure([{ symbol: "X", candles: steady(10) }]), []);
});
