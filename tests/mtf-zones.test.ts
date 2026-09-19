import assert from "node:assert/strict";
import test from "node:test";
import { buildMtfZones } from "../lib/mtf-zones.ts";

const c = (i: number, open: number, close: number, high: number, low: number) => ({
  openTime: 1_757_000_000_000 + i * 3_600_000,
  open,
  close,
  high,
  low,
  volume: 100,
  quoteVolume: 0,
});

const calm = (count: number, price: number, from: number) =>
  Array.from({ length: count }, (_, i) => c(from + i, price, price, price + 2, price - 2));

/** Demand zone at `base`, then price parks at `end`. */
const series = (base: number, end: number) => [
  ...calm(21, base, 0),
  ...calm(3, base, 21),
  c(24, base, base + 20, base + 22, base - 1),
  c(25, base + 20, base + 35, base + 37, base + 19),
  c(26, base + 35, base + 40, base + 42, base + 34),
  ...calm(14, end, 27),
];

test("a level present on two timeframes is reported with both", () => {
  const board = buildMtfZones(
    [
      { timeframe: "4h", candles: series(1000, 1040) },
      { timeframe: "1h", candles: series(1000, 1040) },
    ],
    1040,
  );
  assert.ok(board);
  const demand = board.zones.find((zone) => zone.kind === "DEMANDA");
  assert.ok(demand);
  assert.deepEqual([...demand.confluence].sort(), ["1h", "4h"]);
});

test("one level is one row, not one row per timeframe", () => {
  const board = buildMtfZones(
    [
      { timeframe: "4h", candles: series(1000, 1040) },
      { timeframe: "1h", candles: series(1000, 1040) },
      { timeframe: "15m", candles: series(1000, 1040) },
    ],
    1040,
  );
  assert.ok(board);
  const demandRows = board.zones.filter((zone) => zone.kind === "DEMANDA");
  assert.equal(demandRows.length, 1, "tres copias del mismo nivel dirían lo mismo tres veces");
  assert.equal(demandRows[0].confluence.length, 3);
});

test("price inside a zone is reported as standing in it", () => {
  const board = buildMtfZones([{ timeframe: "1h", candles: series(1000, 1000) }], 1000);
  assert.ok(board);
  assert.ok(board.standingIn);
  assert.equal(board.standingIn.kind, "DEMANDA");
  assert.match(board.reading, /dentro de una zona de demanda/);
});

test("price between zones is described as reference, not as a signal", () => {
  const board = buildMtfZones([{ timeframe: "1h", candles: series(1000, 1040) }], 1040);
  assert.ok(board);
  assert.equal(board.standingIn, null);
  assert.match(board.reading, /referencia, no señal/);
});

test("each timeframe carries its own sample size", () => {
  const board = buildMtfZones(
    [
      { timeframe: "4h", candles: series(1000, 1040) },
      { timeframe: "1h", candles: series(1000, 1040) },
    ],
    1040,
  );
  assert.ok(board);
  assert.equal(board.stats.length, 2);
  for (const entry of board.stats) {
    assert.ok(["SIN MUESTRA", "MUESTRA MÍNIMA", "MUESTRA RAZONABLE"].includes(entry.stats.confidence));
  }
});

test("series too short to analyse are skipped, not padded", () => {
  const board = buildMtfZones(
    [
      { timeframe: "4h", candles: calm(10, 1000, 0) },
      { timeframe: "1h", candles: series(1000, 1040) },
    ],
    1040,
  );
  assert.ok(board);
  assert.deepEqual(board.stats.map((entry) => entry.timeframe), ["1h"]);
});

test("nothing usable yields nothing", () => {
  assert.equal(buildMtfZones([], 1000), null);
  assert.equal(buildMtfZones([{ timeframe: "1h", candles: calm(5, 1000, 0) }], 1000), null);
  assert.equal(buildMtfZones([{ timeframe: "1h", candles: series(1000, 1040) }], 0), null);
});
