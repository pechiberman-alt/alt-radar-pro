import assert from "node:assert/strict";
import test from "node:test";
import { buildSignalTargets, proximityAlert } from "../lib/signal-confluence.ts";
import type { LiquidationHeatmap } from "../lib/liquidation-heatmap.ts";

const heatmap = (
  bias: LiquidationHeatmap["bias"],
  above: number | null,
  below: number | null,
): LiquidationHeatmap =>
  ({
    symbol: "BTCUSDT",
    currentPrice: 100_000,
    binSize: 10,
    profileCandles: 500,
    halfLifeCandles: 48,
    totalOpenInterestUsd: 12e9,
    oiWeightedCandles: 500,
    buckets: [],
    topZoneAbove:
      above === null
        ? null
        : { price: above, longDensity: 0, shortDensity: 1, intensity: 100, notionalUsd: 3e7, formedAt: 0 },
    topZoneBelow:
      below === null
        ? null
        : { price: below, longDensity: 1, shortDensity: 0, intensity: 100, notionalUsd: 4e7, formedAt: 0 },
    bias,
    biasNote: "",
    method: "",
    assumptions: "",
  }) as LiquidationHeatmap;

test("a long aims at the zone above and is invalidated at the one below", () => {
  const t = buildSignalTargets("BTCUSDT", "LONG", 100_000, heatmap("EMPUJE FUERTE AL ALZA", 104_000, 98_000));
  assert.equal(t.target?.price, 104_000);
  assert.equal(t.invalidation?.price, 98_000);
  assert.ok(Math.abs((t.target?.distancePct ?? 0) - 4) < 1e-9);
  // 4% reward against 2% risk.
  assert.ok(Math.abs((t.riskReward ?? 0) - 2) < 1e-9);
});

test("a short mirrors it", () => {
  const t = buildSignalTargets("BTCUSDT", "SHORT", 100_000, heatmap("EMPUJE FUERTE A LA BAJA", 104_000, 98_000));
  assert.equal(t.target?.price, 98_000);
  assert.equal(t.invalidation?.price, 104_000);
  assert.equal(t.verdict, "A FAVOR");
});

test("the map's bias is read against the trade's direction", () => {
  const withTrend = buildSignalTargets("BTCUSDT", "LONG", 100_000, heatmap("EMPUJE FUERTE AL ALZA", 104_000, 98_000));
  assert.equal(withTrend.verdict, "A FAVOR");
  assert.equal(withTrend.mapAgrees, true);

  const against = buildSignalTargets("BTCUSDT", "LONG", 100_000, heatmap("EMPUJE FUERTE A LA BAJA", 104_000, 98_000));
  assert.equal(against.verdict, "EN CONTRA");
  assert.match(against.note, /cascada trabajaría en contra/);

  const neutral = buildSignalTargets("BTCUSDT", "LONG", 100_000, heatmap("SIN SESGO CLARO", 104_000, 98_000));
  assert.equal(neutral.verdict, "NEUTRO");
  assert.equal(neutral.mapAgrees, null);
});

test("an invalidation sitting right under the entry is called out", () => {
  const t = buildSignalTargets("BTCUSDT", "LONG", 100_000, heatmap("SIN SESGO CLARO", 104_000, 99_200));
  assert.match(t.note, /un barrido buscaría estos stops/);
});

test("no map means no invented targets", () => {
  const t = buildSignalTargets("BTCUSDT", "LONG", 100_000, null);
  assert.equal(t.verdict, "SIN MAPA");
  assert.equal(t.target, null);
  assert.equal(t.riskReward, null);
  assert.match(t.note, /No se inventa uno/);
});

test("a missing zone on one side leaves that side null without breaking", () => {
  const t = buildSignalTargets("BTCUSDT", "LONG", 100_000, heatmap("SIN SESGO CLARO", null, 98_000));
  assert.equal(t.target, null);
  assert.equal(t.invalidation?.price, 98_000);
  assert.equal(t.riskReward, null, "sin objetivo no hay ratio que calcular");
});

/* ── proximity alerts ── */

const longTargets = buildSignalTargets(
  "BTCUSDT",
  "LONG",
  100_000,
  heatmap("SIN SESGO CLARO", 104_000, 98_000),
);

test("risk is announced before target when both are near", () => {
  // Price at 98,300: 0.31% from risk, far from target.
  const alert = proximityAlert(longTargets, 98_300);
  assert.equal(alert?.kind, "RIESGO");
});

test("approaching the target fires an objective alert", () => {
  const alert = proximityAlert(longTargets, 103_600);
  assert.equal(alert?.kind, "OBJETIVO");
  assert.match(alert?.message ?? "", /del objetivo/);
});

test("a level already passed does not alert — that news arrives late", () => {
  // Below the invalidation: it is history, not a warning.
  assert.equal(proximityAlert(longTargets, 97_900)?.kind, undefined);
  // Above the target: already reached.
  assert.equal(proximityAlert(longTargets, 104_100)?.kind, undefined);
});

test("distance beyond the threshold stays silent", () => {
  assert.equal(proximityAlert(longTargets, 101_000), null);
});

test("a short's alerts invert correctly", () => {
  const shortTargets = buildSignalTargets(
    "BTCUSDT",
    "SHORT",
    100_000,
    heatmap("SIN SESGO CLARO", 104_000, 98_000),
  );
  // For a short the risk is above: price rising toward 104,000.
  assert.equal(proximityAlert(shortTargets, 103_600)?.kind, "RIESGO");
  // And the target is below.
  assert.equal(proximityAlert(shortTargets, 98_400)?.kind, "OBJETIVO");
});

test("targets without levels never alert", () => {
  const none = buildSignalTargets("BTCUSDT", "LONG", 100_000, null);
  assert.equal(proximityAlert(none, 100_000), null);
});
