import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSpot, type SpotInputs } from "../lib/spot-strategy.ts";

const base = (patch: Partial<SpotInputs> = {}): SpotInputs => ({
  symbol: "SOLUSDT",
  price: 100,
  demandZones: [{ low: 96, high: 100.5, tests: 1, confluence: ["1d", "4h"] }],
  supplyZones: [
    { low: 115, high: 118, tests: 0, confluence: ["4h"] },
    { low: 130, high: 134, tests: 0, confluence: ["1d"] },
  ],
  fib: {
    inZone: true,
    side: "LONG",
    levels: [
      { ratio: 0.618, price: 98 },
      { ratio: 0.68, price: 97 },
      { ratio: 0.786, price: 94 },
    ],
    legLow: 80,
  },
  aboveTrend: true,
  overhangRatio: 0.1,
  ...patch,
});

test("all conditions present reads as present, never as a buy order", () => {
  const plan = evaluateSpot(base(), 1000);
  assert.equal(plan.status, "CONDICIONES PRESENTES");
  assert.equal(plan.passed, 4);
  assert.doesNotMatch(plan.note, /comprá|compra ya/i);
  assert.match(plan.note, /no garantiza/);
});

test("without a location condition it cannot be 'present', however many others pass", () => {
  const plan = evaluateSpot(
    base({ price: 110, demandZones: [{ low: 96, high: 100, tests: 0, confluence: ["4h"] }], fib: { ...base().fib!, inZone: false } }),
    1000,
  );
  assert.notEqual(plan.status, "CONDICIONES PRESENTES", "tendencia y dilución solas no dicen dónde comprar");
});

test("the entry ladder puts the largest tranche at the lowest level", () => {
  const plan = evaluateSpot(base(), 1000);
  assert.equal(plan.entries.length, 3);
  const lowest = [...plan.entries].sort((a, b) => a.price - b.price)[0];
  assert.equal(lowest.weight, 0.4);
  const total = plan.entries.reduce((s, t) => s + t.usd, 0);
  assert.ok(Math.abs(total - 1000) < 1e-9, "los tramos suman el presupuesto");
});

test("levels closer than 0.5% collapse into one tranche", () => {
  const plan = evaluateSpot(
    base({ fib: { ...base().fib!, levels: [{ ratio: 0.618, price: 100.3 }, { ratio: 0.786, price: 100.2 }] } }),
    1000,
  );
  const prices = plan.entries.map((e) => e.price);
  for (let i = 1; i < prices.length; i += 1) {
    assert.ok(Math.abs(prices[i - 1] - prices[i]) / prices[i] >= 0.005);
  }
});

test("invalidation sits below every entry and is stated up front", () => {
  const plan = evaluateSpot(base(), 1000);
  assert.ok(plan.invalidation);
  for (const e of plan.entries) assert.ok(plan.invalidation.price < e.price);
  assert.ok(plan.riskPct !== null && plan.riskPct > 0);
});

test("the average entry is weighted by units, not a plain mean of prices", () => {
  const plan = evaluateSpot(base(), 1000);
  const units = plan.entries.reduce((s, t) => s + t.usd / t.price, 0);
  assert.ok(Math.abs((plan.averageEntry ?? 0) - 1000 / units) < 1e-9);
});

test("exits scale out into supply above, the largest part last", () => {
  const plan = evaluateSpot(base(), 1000);
  assert.equal(plan.exits.length, 2);
  assert.ok(plan.exits[0].price < plan.exits[1].price);
  assert.equal(plan.exits[1].weight, 0.6);
});

test("heavy dilution fails its check, and unknown data is not counted either way", () => {
  const heavy = evaluateSpot(base({ overhangRatio: 1.4 }), 1000);
  assert.equal(heavy.checks.find((c) => c.id === "dilucion")?.state, "NO");
  const unknown = evaluateSpot(base({ overhangRatio: null }), 1000);
  assert.equal(unknown.checks.find((c) => c.id === "dilucion")?.state, "SIN DATO");
  assert.equal(unknown.known, 3);
});

test("no budget means no tranche amounts, but the checklist still runs", () => {
  const plan = evaluateSpot(base(), 0);
  assert.deepEqual(plan.entries, []);
  assert.equal(plan.checks.length, 4);
});
