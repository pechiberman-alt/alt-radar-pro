import assert from "node:assert/strict";
import test from "node:test";
import {
  computeCostBasis, costBasisReliable, portfolioWeightPct, riskToInvalidation, unrealizedPnl,
} from "../lib/cost-basis.ts";

const fill = (price: number, qty: number, isBuyer: boolean, time: number) => ({ price, qty, isBuyer, time });

test("a single buy sets the average cost to its own price", () => {
  const b = computeCostBasis([fill(100, 10, true, 1)]);
  assert.deepEqual(b, { units: 10, avgCost: 100, investedUsd: 1000 });
});

test("two buys at different prices give the size-weighted average", () => {
  const b = computeCostBasis([fill(100, 10, true, 1), fill(200, 10, true, 2)]);
  assert.equal(b.units, 20);
  assert.equal(b.avgCost, 150);
  assert.equal(b.investedUsd, 3000);
});

test("a sell removes units at the current average and leaves the average unchanged", () => {
  const b = computeCostBasis([fill(100, 10, true, 1), fill(999, 5, false, 2)]);
  assert.equal(b.units, 5);
  assert.equal(b.avgCost, 100, "el precio de venta nunca mueve el costo promedio");
  assert.equal(b.investedUsd, 500);
});

test("average cost survives a sell after a mixed-price position", () => {
  const b = computeCostBasis([fill(100, 10, true, 1), fill(200, 10, true, 2), fill(1, 10, false, 3)]);
  assert.equal(b.units, 10);
  assert.equal(b.avgCost, 150);
});

test("fills are sorted by time regardless of the order given", () => {
  const chrono = [fill(100, 10, true, 1), fill(200, 10, true, 2), fill(1, 5, false, 3)];
  const reversed = [...chrono].reverse();
  assert.deepEqual(computeCostBasis(chrono), computeCostBasis(reversed));
});

test("selling more than held clamps at zero, never negative", () => {
  const b = computeCostBasis([fill(100, 10, true, 1), fill(1, 999, false, 2)]);
  assert.equal(b.units, 0);
  assert.equal(b.investedUsd, 0);
});

test("a sell with no prior buy is ignored rather than going negative", () => {
  assert.deepEqual(computeCostBasis([fill(50, 10, false, 1)]), { units: 0, avgCost: 0, investedUsd: 0 });
});

test("zero or negative price/qty rows are skipped", () => {
  const b = computeCostBasis([fill(100, 10, true, 1), fill(0, 5, true, 2), fill(50, 0, true, 3), fill(-10, 5, true, 4)]);
  assert.equal(b.units, 10);
});

test("reliability compares trade-history units against the live balance within tolerance", () => {
  assert.equal(costBasisReliable(10, 10), true);
  assert.equal(costBasisReliable(10, 10.3), true, "3% de diferencia entra en la tolerancia por defecto");
  assert.equal(costBasisReliable(10, 20), false, "el historial no explica un saldo del doble");
  assert.equal(costBasisReliable(0, 10), false);
  assert.equal(costBasisReliable(10, 0), false);
});

test("unrealized P&L is null without a real average cost, not zero", () => {
  assert.equal(unrealizedPnl(10, 150, 0), null);
  const p = unrealizedPnl(10, 150, 100);
  assert.equal(p!.usd, 500);
  assert.equal(p!.pct, 50);
});

test("portfolio weight is 0 with no total, never NaN or Infinity", () => {
  assert.equal(portfolioWeightPct(500, 0), 0);
  assert.equal(portfolioWeightPct(500, 2000), 25);
});

test("risk to invalidation is per TOTAL portfolio, not per position", () => {
  const r = riskToInvalidation(10, 150, 100, 10_000);
  assert.equal(r!.usd, 500);
  assert.equal(r!.pct, 5, "500 sobre una cartera de 10.000, no sobre la posicion de 1.500");
});

test("risk to invalidation is null when price is already at or below it", () => {
  assert.equal(riskToInvalidation(10, 100, 100, 10_000), null);
  assert.equal(riskToInvalidation(10, 90, 100, 10_000), null, "ya está por debajo: no es una caída pendiente");
});
