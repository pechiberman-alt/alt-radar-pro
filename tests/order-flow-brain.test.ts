import assert from "node:assert/strict";
import test from "node:test";
import {
  detectInstitutional,
  detectSqueeze,
  findStructureLevels,
  type DerivativesInput,
  type LiquidationInput,
  type WallInput,
} from "../lib/order-flow-brain.ts";
import type { OrderFlowTrade } from "../lib/order-flow.ts";

const trade = (
  price: number,
  notional: number,
  buyerMaker: boolean,
  time = 0,
): OrderFlowTrade => ({ price, qty: notional / price, notional, buyerMaker, time });

/** Ordinary two-sided flow with nothing unusual in it. */
function calmFlow(count = 60, base = 100): OrderFlowTrade[] {
  return Array.from({ length: count }, (_, i) =>
    trade(base + (i % 8) * 0.1, 1_000 + (i % 5) * 50, i % 2 === 0, i * 400),
  );
}

const book = {
  bids: [
    { price: 99.9, qty: 100, notional: 9_990 },
    { price: 99.8, qty: 120, notional: 11_976 },
  ],
  asks: [
    { price: 100.1, qty: 100, notional: 10_010 },
    { price: 100.2, qty: 90, notional: 9_018 },
  ],
};

const noDerivatives: DerivativesInput = {
  fundingRatePct: null,
  openInterestUsd: null,
  openInterestChangePct: null,
  takerBuySellRatio: null,
  longShortAccountRatio: null,
};

// ---- institutional detection ----------------------------------------------

test("a thin sample produces no institutional claims", () => {
  assert.deepEqual(detectInstitutional([], book, 100, 0.1), []);
  assert.deepEqual(detectInstitutional(calmFlow(10), book, 100, 0.1), []);
});

test("calm two-sided flow does not manufacture icebergs", () => {
  const events = detectInstitutional(calmFlow(), book, 100, 0.1);
  assert.equal(
    events.filter((event) => event.kind === "ICEBERG").length,
    0,
    "no debe inventar tamaño oculto donde el flujo es normal",
  );
});

test("detects hidden size refilling far beyond the displayed depth", () => {
  const trades = [
    ...calmFlow(40, 100),
    // Level 99.9 shows ~10k but absorbs 400k across many prints.
    ...Array.from({ length: 40 }, (_, i) => trade(99.9, 10_000, true, 20_000 + i * 50)),
  ];
  const events = detectInstitutional(trades, book, 100, 0.1);
  const iceberg = events.find((event) => event.kind === "ICEBERG");
  assert.ok(iceberg, "debía detectar reposición oculta");
  assert.ok(iceberg.confidence > 50);
  assert.ok(iceberg.detail.includes("tamaño oculto"));
});

test("detects absorption where aggression is one-sided but price holds", () => {
  const trades = [
    ...calmFlow(30, 100),
    ...Array.from({ length: 30 }, (_, i) => trade(100.0, 8_000, false, 15_000 + i * 60)),
  ];
  const events = detectInstitutional(trades, book, 100, 0.1);
  assert.ok(
    events.some((event) => event.kind === "ABSORCIÓN" || event.kind === "ICEBERG"),
    "agresión concentrada sin avance debe leerse como absorción o iceberg",
  );
});

test("detects a sweep: many prints, one direction, seconds apart", () => {
  const trades = [
    ...calmFlow(30, 100),
    ...Array.from({ length: 30 }, (_, i) =>
      trade(100 + i * 0.02, 5_000, false, 100_000 + i * 50),
    ),
  ];
  const events = detectInstitutional(trades, book, 100.3, 0.1);
  const sweep = events.find((event) => event.kind === "BARRIDO");
  assert.ok(sweep, "debía detectar el barrido");
  assert.equal(sweep.side, "COMPRA");
});

test("slow one-directional drift is not a sweep", () => {
  const trades = Array.from({ length: 40 }, (_, i) =>
    // Same direction but spread over minutes, not seconds.
    trade(100 + i * 0.02, 5_000, false, i * 30_000),
  );
  const events = detectInstitutional(trades, book, 100.4, 0.1);
  assert.equal(
    events.filter((event) => event.kind === "BARRIDO").length,
    0,
    "una deriva lenta no es un barrido",
  );
});

test("institutional events are ranked and bounded", () => {
  const trades = [
    ...calmFlow(40),
    ...Array.from({ length: 40 }, (_, i) => trade(99.9, 20_000, true, 20_000 + i * 40)),
  ];
  const events = detectInstitutional(trades, book, 100, 0.1);
  assert.ok(events.length <= 8);
  for (let i = 1; i < events.length; i += 1) {
    assert.ok(events[i - 1].confidence >= events[i].confidence, "deben venir ordenados");
  }
  for (const event of events) {
    assert.ok(event.confidence >= 0 && event.confidence <= 100);
    assert.ok(Number.isFinite(event.price) && Number.isFinite(event.notional));
    // Regression: an unrounded score rendered as "CONFIANZA 57.500062152585826/100".
    assert.equal(
      Number.isInteger(event.confidence),
      true,
      `confianza sin redondear: ${event.confidence}`,
    );
  }
});

test("every confidence and strength is a whole number", () => {
  const trades = [
    ...calmFlow(40),
    ...Array.from({ length: 40 }, (_, i) => trade(99.9, 17_777, true, 20_000 + i * 37)),
    ...Array.from({ length: 15 }, (_, i) => trade(100 + i * 0.013, 3_333, false, 90_000 + i * 60)),
  ];
  for (const event of detectInstitutional(trades, book, 100, 0.1)) {
    assert.ok(Number.isInteger(event.confidence), `confianza ${event.confidence}`);
  }
  const walls: WallInput[] = [{ side: "BID", price: 99.9, notional: 700_000, persistence: 63.7 }];
  for (const level of findStructureLevels(trades, walls, [], 100, 0.05)) {
    assert.ok(Number.isInteger(level.strength), `fuerza ${level.strength}`);
  }
  const reading = detectSqueeze(
    { fundingRatePct: -0.033, openInterestUsd: 1e9, openInterestChangePct: 0.37, takerBuySellRatio: 1.77, longShortAccountRatio: 0.73 },
    [{ time: Date.now(), side: "SHORT", price: 100, notional: 333_333 }],
    17.3,
  );
  assert.ok(Number.isInteger(reading.score), `score ${reading.score}`);
});

// ---- squeeze --------------------------------------------------------------

test("no derivatives data means no squeeze claim, and says what is missing", () => {
  const reading = detectSqueeze(noDerivatives, [], null);
  assert.equal(reading.type, "SIN PRESIÓN");
  assert.equal(reading.bias, "NEUTRAL");
  assert.ok(reading.missing.includes("funding"));
  assert.ok(reading.missing.length >= 3);
});

test("one isolated factor is not enough to call a squeeze", () => {
  const reading = detectSqueeze(
    { ...noDerivatives, fundingRatePct: -0.05 },
    [],
    null,
  );
  assert.equal(reading.type, "SIN PRESIÓN");
  assert.ok(reading.detail.includes("suficientes factores"));
});

test("crowded shorts paying funding while being liquidated reads as a short squeeze", () => {
  const now = Date.now();
  const liquidations: LiquidationInput[] = [
    { time: now - 60_000, side: "SHORT", price: 100, notional: 900_000 },
    { time: now - 120_000, side: "SHORT", price: 101, notional: 700_000 },
    { time: now - 90_000, side: "LONG", price: 99, notional: 80_000 },
  ];
  const reading = detectSqueeze(
    {
      fundingRatePct: -0.04,
      openInterestUsd: 8e9,
      openInterestChangePct: 0.6,
      takerBuySellRatio: 1.8,
      longShortAccountRatio: 0.7,
    },
    liquidations,
    18,
    now,
  );
  assert.equal(reading.type, "SHORT SQUEEZE");
  assert.equal(reading.bias, "ALCISTA");
  assert.ok(reading.score >= 45);
  assert.ok(reading.factors.length >= 3);
});

test("the mirror case reads as a long squeeze", () => {
  const now = Date.now();
  const liquidations: LiquidationInput[] = [
    { time: now - 60_000, side: "LONG", price: 100, notional: 900_000 },
    { time: now - 120_000, side: "LONG", price: 99, notional: 800_000 },
  ];
  const reading = detectSqueeze(
    {
      fundingRatePct: 0.06,
      openInterestUsd: 8e9,
      openInterestChangePct: 0.5,
      takerBuySellRatio: 0.6,
      longShortAccountRatio: 2.1,
    },
    liquidations,
    -20,
    now,
  );
  assert.equal(reading.type, "LONG SQUEEZE");
  assert.equal(reading.bias, "BAJISTA");
});

test("stale liquidations do not count toward a live squeeze", () => {
  const now = Date.now();
  const old: LiquidationInput[] = [
    { time: now - 3 * 60 * 60_000, side: "SHORT", price: 100, notional: 5_000_000 },
  ];
  const reading = detectSqueeze(noDerivatives, old, null, now);
  assert.ok(
    reading.missing.includes("liquidaciones en la ventana"),
    "liquidaciones de hace horas no describen la presión actual",
  );
});

test("squeeze score never leaves 0..100", () => {
  const now = Date.now();
  const extreme = detectSqueeze(
    {
      fundingRatePct: -5,
      openInterestUsd: 1e12,
      openInterestChangePct: 900,
      takerBuySellRatio: 50,
      longShortAccountRatio: 0.01,
    },
    Array.from({ length: 50 }, (_, i) => ({
      time: now - i * 1_000,
      side: "SHORT" as const,
      price: 100,
      notional: 1e9,
    })),
    999,
    now,
  );
  assert.ok(extreme.score >= 0 && extreme.score <= 100, `score ${extreme.score}`);
});

// ---- structure levels -----------------------------------------------------

test("no levels without a price reference", () => {
  assert.deepEqual(findStructureLevels(calmFlow(), [], [], 0, 0.1), []);
});

test("derives the point of control as a structural level", () => {
  const trades = [
    ...calmFlow(30, 100),
    ...Array.from({ length: 40 }, (_, i) => trade(99.5, 20_000, i % 2 === 0, i * 100)),
  ];
  const levels = findStructureLevels(trades, [], [], 100, 0.05);
  assert.ok(levels.length > 0);
  assert.ok(
    levels.some((level) => level.sources.some((source) => source.includes("Punto de control"))),
    "el nivel de mayor volumen debe aparecer",
  );
});

test("classifies levels below price as floor and above as ceiling", () => {
  const walls: WallInput[] = [
    { side: "BID", price: 98, notional: 900_000, persistence: 80 },
    { side: "ASK", price: 102, notional: 900_000, persistence: 80 },
  ];
  const levels = findStructureLevels(calmFlow(), walls, [], 100, 0.05);
  const floor = levels.find((level) => Math.abs(level.price - 98) < 0.5);
  const ceiling = levels.find((level) => Math.abs(level.price - 102) < 0.5);
  assert.equal(floor?.kind, "PISO");
  assert.equal(ceiling?.kind, "TECHO");
  assert.ok(floor && floor.distancePct < 0, "el piso está por debajo del precio");
  assert.ok(ceiling && ceiling.distancePct > 0, "el techo está por encima");
});

test("a level backed by several readings outranks one backed by a single wall", () => {
  const trades = [
    ...calmFlow(30, 100),
    ...Array.from({ length: 50 }, (_, i) => trade(99.5, 25_000, i % 2 === 0, i * 100)),
  ];
  const walls: WallInput[] = [
    { side: "BID", price: 99.5, notional: 900_000, persistence: 90 },
    { side: "BID", price: 97, notional: 400_000, persistence: 30 },
  ];
  const liquidations: LiquidationInput[] = [
    { time: Date.now(), side: "LONG", price: 99.5, notional: 500_000 },
    { time: Date.now(), side: "LONG", price: 99.5, notional: 400_000 },
    { time: Date.now(), side: "LONG", price: 96, notional: 10_000 },
  ];
  const levels = findStructureLevels(trades, walls, liquidations, 100, 0.05);
  const confluent = levels.find((level) => Math.abs(level.price - 99.5) < 0.4);
  const single = levels.find((level) => Math.abs(level.price - 97) < 0.4);
  assert.ok(confluent, "el nivel con confluencia debe existir");
  assert.ok(confluent.sources.length >= 2, "debe citar varias fuentes");
  if (single) {
    assert.ok(
      confluent.strength > single.strength,
      "más evidencia debe pesar más",
    );
  }
});

test("transient walls are ignored as structure", () => {
  const walls: WallInput[] = [
    { side: "BID", price: 98, notional: 900_000, persistence: 5 },
  ];
  const levels = findStructureLevels(calmFlow(), walls, [], 100, 0.05);
  assert.ok(
    !levels.some((level) => level.sources.some((source) => source.includes("persistente"))),
    "una pared que apareció y se fue no es estructura",
  );
});

test("levels are bounded, ranked and finite", () => {
  const trades = [
    ...calmFlow(60, 100),
    ...Array.from({ length: 60 }, (_, i) => trade(99 + (i % 10) * 0.2, 30_000, i % 2 === 0, i * 90)),
  ];
  const walls: WallInput[] = Array.from({ length: 12 }, (_, i) => ({
    side: i % 2 === 0 ? ("BID" as const) : ("ASK" as const),
    price: 95 + i * 0.9,
    notional: 500_000,
    persistence: 60,
  }));
  const levels = findStructureLevels(trades, walls, [], 100, 0.05);
  assert.ok(levels.length <= 8);
  for (let i = 1; i < levels.length; i += 1) {
    assert.ok(levels[i - 1].strength >= levels[i].strength);
  }
  for (const level of levels) {
    assert.ok(level.strength >= 20 && level.strength <= 100);
    assert.ok(Number.isFinite(level.distancePct));
    assert.ok(level.sources.length > 0, "todo nivel debe declarar en qué se apoya");
  }
});
