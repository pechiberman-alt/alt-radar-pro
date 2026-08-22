import assert from "node:assert/strict";
import test from "node:test";
import { seriesChange, type StructurePoint } from "../lib/structure-archive.ts";

const point = (patch: Partial<StructurePoint>): StructurePoint => ({
  capturedAt: new Date().toISOString(),
  totalMarketCap: 2_000_000_000_000,
  total2: 1_000_000_000_000,
  total3: 800_000_000_000,
  btcDominance: 50,
  ethDominance: 10,
  usdtDominance: 7,
  stablecoinDominance: 10,
  ...patch,
});

test("series change is the difference in percentage points", () => {
  const points = [
    point({ usdtDominance: 6 }),
    point({ usdtDominance: 6.5 }),
    point({ usdtDominance: 7.4 }),
  ];
  const change = seriesChange(points, (p) => p.usdtDominance);
  assert.ok(change !== null);
  assert.ok(Math.abs(change - 1.4) < 1e-9, `esperaba +1.4, obtuve ${change}`);
});

test("a falling series reports a negative change", () => {
  const points = [point({ btcDominance: 60 }), point({ btcDominance: 57.5 })];
  assert.equal(seriesChange(points, (p) => p.btcDominance), -2.5);
});

test("gaps in the series are skipped, not treated as zero", () => {
  const points = [
    point({ usdtDominance: 6 }),
    point({ usdtDominance: null }),
    point({ usdtDominance: 8 }),
  ];
  assert.equal(seriesChange(points, (p) => p.usdtDominance), 2);
});

test("a series without two readings has no change", () => {
  assert.equal(seriesChange([], (p) => p.usdtDominance), null);
  assert.equal(seriesChange([point({})], (p) => p.usdtDominance), null);
  assert.equal(
    seriesChange(
      [point({ usdtDominance: null }), point({ usdtDominance: 7 })],
      (p) => p.usdtDominance,
    ),
    null,
    "una sola lectura válida no permite calcular variación",
  );
});

test("a flat series reports zero, not null", () => {
  const points = [point({ usdtDominance: 7 }), point({ usdtDominance: 7 })];
  assert.equal(seriesChange(points, (p) => p.usdtDominance), 0);
});
