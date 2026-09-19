import assert from "node:assert/strict";
import test from "node:test";
import { detectZones, findSupplyDemandZones, zoneStats } from "../lib/supply-demand.ts";


const c = (i: number, open: number, close: number, high: number, low: number) => ({
  openTime: 1_757_000_000_000 + i * 3_600_000,
  open,
  close,
  high,
  low,
  volume: 100,
  quoteVolume: 0,
});

/** Quiet candles: the baseline, and the material a base is made of. */
const calm = (count: number, price: number, from: number) =>
  Array.from({ length: count }, (_, i) => c(from + i, price, price, price + 2, price - 2));

/**
 * A demand zone at `base`: three quiet candles, then an impulsive departure
 * upward, then whatever the scenario needs.
 */
const demandSetup = (base: number, from: number) => [
  ...calm(3, base, from),
  c(from + 3, base, base + 20, base + 22, base - 1),
  c(from + 4, base + 20, base + 35, base + 37, base + 19),
  c(from + 5, base + 35, base + 40, base + 42, base + 34),
];

test("a quiet base followed by an impulsive departure is a demand zone", () => {
  const zones = findSupplyDemandZones(
    [...calm(21, 1000, 0), ...demandSetup(1000, 21), ...calm(15, 1040, 27)],
    "1h",
  );
  assert.equal(zones.length, 1);
  assert.equal(zones[0].kind, "DEMANDA");
  assert.equal(zones[0].state, "FRESCA", "sin testear todavía");
  assert.ok(zones[0].departure >= 2);
});

test("a wide base is not a zone — that is a move, not a level", () => {
  const zones = findSupplyDemandZones(
    [
      ...calm(21, 1000, 0),
      c(21, 1000, 1010, 1020, 990),
      c(22, 1010, 995, 1025, 985),
      c(23, 995, 1005, 1022, 988),
      c(24, 1005, 1030, 1032, 1004),
      c(25, 1030, 1045, 1047, 1029),
      c(26, 1045, 1050, 1052, 1044),
      ...calm(15, 1050, 27),
    ],
    "1h",
  );
  assert.deepEqual(zones, []);
});

test("a touch that holds VALIDATES the zone instead of consuming it", () => {
  // Price returns into the base and leaves without closing below it.
  const zones = findSupplyDemandZones(
    [
      ...calm(21, 1000, 0),
      ...demandSetup(1000, 21),
      ...calm(4, 1040, 27),
      c(31, 1040, 1001, 1041, 999), // dips in, closes inside
      c(32, 1001, 1030, 1032, 1000), // leaves upward
      ...calm(10, 1030, 33),
    ],
    "1h",
  );
  // The pullback that tests demand also creates a legitimate supply zone on
  // the way down, so this looks for the demand zone rather than assuming it
  // is the only one on the chart.
  const demand = zones.find((zone) => zone.kind === "DEMANDA");
  assert.ok(demand, "la zona de demanda debe seguir en el mapa");
  assert.equal(demand.state, "VALIDADA");
  assert.equal(demand.tests, 1, "el toque respetado cuenta como test superado");
});

test("a close beyond the far side removes the zone from the map", () => {
  const zones = findSupplyDemandZones(
    [
      ...calm(21, 1000, 0),
      ...demandSetup(1000, 21),
      ...calm(4, 1040, 27),
      c(31, 1040, 990, 1041, 988), // closes below the base
      ...calm(10, 990, 32),
    ],
    "1h",
  );
  assert.equal(
    zones.find((zone) => zone.kind === "DEMANDA" && zone.low < 1005),
    undefined,
    "una zona rota desaparece, no se muestra debilitada",
  );
});

test("a broken zone is still detected — the base rate needs the failures", () => {
  const all = detectZones(
    [
      ...calm(21, 1000, 0),
      ...demandSetup(1000, 21),
      ...calm(4, 1040, 27),
      c(31, 1040, 990, 1041, 988),
      ...calm(10, 990, 32),
    ],
    "1h",
  );
  const broken = all.filter((zone) => zone.state === "ROTA");
  assert.ok(broken.length >= 1, "contar sólo sobrevivientes daría casi 100% siempre");
});

test("hold rate counts failures in the denominator", () => {
  const stats = zoneStats(
    [
      ...calm(21, 1000, 0),
      ...demandSetup(1000, 21),
      ...calm(4, 1040, 27),
      c(31, 1040, 990, 1041, 988),
      ...calm(10, 990, 32),
    ],
    "1h",
  );
  assert.ok(stats.tested >= 1);
  assert.equal(stats.held, 0, "la única zona resuelta se rompió");
  assert.equal(stats.holdRate, 0);
});

test("a thin sample is labelled as such rather than rounded into confidence", () => {
  const stats = zoneStats([...calm(21, 1000, 0), ...demandSetup(1000, 21), ...calm(15, 1040, 27)], "1h");
  assert.ok(
    stats.confidence === "SIN MUESTRA" || stats.confidence === "MUESTRA MÍNIMA",
    "con una o ninguna zona resuelta no se puede hablar de probabilidad",
  );
});

test("no data means no rate rather than a default", () => {
  const stats = zoneStats([], "1h");
  assert.equal(stats.holdRate, null);
  assert.equal(stats.confidence, "SIN MUESTRA");
  assert.deepEqual(findSupplyDemandZones([], "1h"), []);
});

test("the timeframe travels with the zone, so an MTF view can label it", () => {
  const zones = findSupplyDemandZones(
    [...calm(21, 1000, 0), ...demandSetup(1000, 21), ...calm(15, 1040, 27)],
    "4h",
  );
  assert.equal(zones[0].timeframe, "4h");
});
