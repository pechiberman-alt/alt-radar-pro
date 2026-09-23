import assert from "node:assert/strict";
import test from "node:test";
import { buildDcaPosition, buildDcaPositions } from "../lib/dca-tracker.ts";
import type { DcaPurchase } from "../lib/dca-tracker.ts";

const buy = (patch: Partial<DcaPurchase>): DcaPurchase => ({
  id: "p1",
  symbol: "BTCUSDT",
  usdAmount: 100,
  units: 0.001,
  priceAtPurchase: 100_000,
  purchasedAt: "2026-09-01",
  ...patch,
});

test("average cost is total invested over total units, not a plain price average", () => {
  const position = buildDcaPosition(
    "BTCUSDT",
    [
      buy({ id: "1", usdAmount: 100, units: 0.001, priceAtPurchase: 100_000, purchasedAt: "2026-09-01" }),
      // Same USD amount, higher price, so fewer units — a plain average of
      // the two PRICES would be wrong; it has to be weighted by units.
      buy({ id: "2", usdAmount: 100, units: 0.0005, priceAtPurchase: 200_000, purchasedAt: "2026-09-08" }),
    ],
    null,
  );
  assert.ok(position);
  assert.equal(position.totalInvestedUsd, 200);
  assert.ok(Math.abs(position.totalUnits - 0.0015) < 1e-12);
  // 200 / 0.0015 ≈ 133,333 — not (100,000+200,000)/2 = 150,000.
  assert.ok(Math.abs(position.averageCost - 133_333.33) < 1);
});

test("P&L is null until a current price is supplied — not zero", () => {
  const position = buildDcaPosition("BTCUSDT", [buy({})], null);
  assert.equal(position?.currentValueUsd, null);
  assert.equal(position?.pnlUsd, null);
  assert.equal(position?.pnlPct, null);
});

test("with a current price, P&L compares current value to what was actually invested", () => {
  const position = buildDcaPosition(
    "BTCUSDT",
    [buy({ usdAmount: 100, units: 0.001, priceAtPurchase: 100_000 })],
    120_000,
  );
  assert.ok(position);
  assert.equal(position.currentValueUsd, 0.001 * 120_000);
  assert.ok(Math.abs(position.pnlUsd! - 20) < 1e-9);
  assert.ok(Math.abs(position.pnlPct! - 20) < 1e-9);
});

test("purchases of a different symbol are excluded from this position", () => {
  const position = buildDcaPosition(
    "BTCUSDT",
    [buy({ id: "1", symbol: "BTCUSDT" }), buy({ id: "2", symbol: "ETHUSDT" })],
    null,
  );
  assert.equal(position?.purchases, 1);
});

test("multiple symbols become separate positions, ranked by size invested", () => {
  const positions = buildDcaPositions(
    [
      buy({ id: "1", symbol: "BTCUSDT", usdAmount: 500 }),
      buy({ id: "2", symbol: "ETHUSDT", usdAmount: 100 }),
    ],
    {},
  );
  assert.equal(positions.length, 2);
  assert.equal(positions[0].symbol, "BTCUSDT");
});

test("a missing current price for one symbol does not block the others", () => {
  const positions = buildDcaPositions(
    [buy({ id: "1", symbol: "BTCUSDT" }), buy({ id: "2", symbol: "ETHUSDT" })],
    { BTCUSDT: 120_000 },
  );
  const btc = positions.find((p) => p.symbol === "BTCUSDT");
  const eth = positions.find((p) => p.symbol === "ETHUSDT");
  assert.notEqual(btc?.currentValueUsd, null);
  assert.equal(eth?.currentValueUsd, null);
});

test("no purchases for a symbol yields no position, not an empty shell", () => {
  assert.equal(buildDcaPosition("SOLUSDT", [buy({})], null), null);
  assert.deepEqual(buildDcaPositions([], {}), []);
});

/* ── isDueToday ── */

const sched = (patch: Partial<import("../lib/dca-tracker.ts").DcaSchedule> = {}) => ({
  symbol: "BTCUSDT",
  usdAmount: 50,
  frequency: "SEMANAL" as const,
  weekday: 1, // Monday
  enabled: true,
  ...patch,
});

test("a disabled schedule never fires, regardless of frequency", async () => {
  const { isDueToday } = await import("../lib/dca-tracker.ts");
  assert.equal(isDueToday(sched({ frequency: "DIARIO", enabled: false }), new Date("2026-09-21")), false);
});

test("DIARIO fires every day", async () => {
  const { isDueToday } = await import("../lib/dca-tracker.ts");
  for (const day of ["2026-09-21", "2026-09-22", "2026-09-27"]) {
    assert.equal(isDueToday(sched({ frequency: "DIARIO" }), new Date(day)), true);
  }
});

test("SEMANAL fires only on the configured weekday", async () => {
  const { isDueToday } = await import("../lib/dca-tracker.ts");
  const schedule = sched({ frequency: "SEMANAL", weekday: 1 }); // Monday
  assert.equal(isDueToday(schedule, new Date("2026-09-21")), true, "21 sep 2026 es lunes");
  assert.equal(isDueToday(schedule, new Date("2026-09-22")), false, "martes no");
});

test("QUINCENAL fires on the right weekday but only every other week", async () => {
  const { isDueToday } = await import("../lib/dca-tracker.ts");
  const schedule = sched({ frequency: "QUINCENAL", weekday: 1 });
  const mondays = ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"].map(
    (d) => isDueToday(schedule, new Date(d)),
  );
  // Exactly half of four consecutive Mondays should fire, alternating.
  assert.equal(mondays.filter(Boolean).length, 2);
  assert.notEqual(mondays[0], mondays[1]);
  assert.equal(mondays[0], mondays[2], "el patron se repite cada dos semanas");
});

test("MENSUAL fires on the 1st regardless of the weekday field", async () => {
  const { isDueToday } = await import("../lib/dca-tracker.ts");
  const schedule = sched({ frequency: "MENSUAL", weekday: 4 }); // irrelevant here
  assert.equal(isDueToday(schedule, new Date("2026-10-01")), true);
  assert.equal(isDueToday(schedule, new Date("2026-10-02")), false);
});
