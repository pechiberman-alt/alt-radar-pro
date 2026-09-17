import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExchangeFlows,
  median,
  parseVenues,
} from "../lib/exchange-reserves.ts";

const venue = (name: string, tvl: number, change_1d: number, change_7d: number) => ({
  name,
  slug: name.toLowerCase(),
  category: "CEX",
  tvl,
  change_1d,
  change_7d,
});

/** Six venues all moving the same: a pure price move, no coins going anywhere. */
const priceOnly = (pct: number) =>
  Array.from({ length: 6 }, (_, index) =>
    venue(`Venue${index}`, 10_000_000_000, pct, pct),
  );

test("median handles both odd and even counts", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

test("parseVenues keeps only exchanges with real reserves", () => {
  const parsed = parseVenues([
    venue("Binance", 1_000, 1, 1),
    { ...venue("Empty", 0, 1, 1) },
    { name: "Aave", slug: "aave", category: "Lending", tvl: 5_000 },
    null,
    "nope",
  ]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, "Binance");
});

test("a market-wide drop is not reported as coins leaving", () => {
  // Every reserve fell 8% because the market fell 8%. Nothing moved.
  const flows = buildExchangeFlows(priceOnly(-8));
  assert.ok(flows);
  assert.equal(flows.marketMove7dPct, -8);
  assert.equal(flows.state, "SIN SESGO CLARO");
  for (const entry of flows.venues) {
    assert.equal(entry.netFlow7dPct, 0, "ningún exchange se desvió de la mediana");
  }
});

test("a venue falling harder than the market is read as an outflow", () => {
  const days = [...priceOnly(-5), venue("Fuga", 10_000_000_000, -15, -15)];
  const flows = buildExchangeFlows(days);
  assert.ok(flows);
  assert.equal(flows.marketMove7dPct, -5);
  const leaking = flows.venues.find((entry) => entry.name === "Fuga");
  assert.equal(leaking?.netFlow7dPct, -10);
  assert.ok((leaking?.netFlow7dUsd ?? 0) < 0);
});

test("net coins leaving the tracked venues reads as accumulation", () => {
  const flows = buildExchangeFlows([
    ...priceOnly(0),
    venue("Salida", 40_000_000_000, -12, -12),
  ]);
  assert.equal(flows?.state, "ACUMULACIÓN");
  assert.match(flows?.reading ?? "", /custodia propia/);
});

test("net coins arriving reads as distribution", () => {
  const flows = buildExchangeFlows([
    ...priceOnly(0),
    venue("Entrada", 40_000_000_000, 12, 12),
  ]);
  assert.equal(flows?.state, "DISTRIBUCIÓN");
  assert.match(flows?.reading ?? "", /posicionando para vender/);
});

test("too few venues yields nothing rather than a median of noise", () => {
  assert.equal(
    buildExchangeFlows([venue("A", 1e9, 1, 1), venue("B", 1e9, 2, 2)]),
    null,
  );
});

test("the derivation is declared, never passed off as a measured flow", () => {
  const flows = buildExchangeFlows(priceOnly(1));
  assert.match(flows?.method ?? "", /No es un flujo on-chain medido/);
});
