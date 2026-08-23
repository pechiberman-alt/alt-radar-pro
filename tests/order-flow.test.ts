import assert from "node:assert/strict";
import test from "node:test";
import {
  compositeBook,
  currentWalls,
  FOOTPRINT_TARGET_ROWS,
  classifyLargeTrades,
  cumulativeDelta,
  footprintRows,
  niceStep,
  percentile,
  type OrderFlowTrade,
} from "../lib/order-flow.ts";

const trade = (
  price: number,
  notional: number,
  buyerMaker: boolean,
  time = 0,
): OrderFlowTrade => ({ price, qty: notional / price, notional, buyerMaker, time });

test("niceStep snaps to 1/2/5 decades", () => {
  assert.equal(niceStep(0.9), 1);
  assert.equal(niceStep(1.4), 2);
  assert.equal(niceStep(4.2), 5);
  assert.equal(niceStep(7), 10);
  assert.equal(niceStep(0.42), 0.5);
  assert.equal(niceStep(340), 500);
});

test("niceStep rejects non-positive and non-finite input", () => {
  assert.equal(niceStep(0), 0);
  assert.equal(niceStep(-5), 0);
  assert.equal(niceStep(Number.NaN), 0);
  assert.equal(niceStep(Number.POSITIVE_INFINITY), 0);
});

test("percentile handles empty and single-value input", () => {
  assert.equal(percentile([], 0.9), 0);
  assert.equal(percentile([42], 0.9), 42);
  assert.equal(percentile([1, 2, 3, 4, 5], 0), 1);
  assert.equal(percentile([1, 2, 3, 4, 5], 1), 5);
});

test("footprint returns nothing without trades or a mid price", () => {
  assert.deepEqual(footprintRows([], 100, 0.1), []);
  assert.deepEqual(footprintRows([trade(100, 500, false)], 0, 0.1), []);
});

/**
 * The regression that motivated extracting this: a fixed bucket of mid*0.00015
 * collapsed a tight BTC window into a single row, so the footprint rendered one
 * line and reported one imbalance.
 */
test("footprint resolves a tight range into multiple levels", () => {
  const mid = 77_000;
  const trades: OrderFlowTrade[] = [];
  for (let i = 0; i < 60; i += 1) {
    const price = 77_000 + (i % 12) * 0.5;
    trades.push(trade(price, 1_000 + i, i % 3 === 0));
  }
  const rows = footprintRows(trades, mid, 0.01);
  assert.ok(rows.length >= 8, `esperaba varios niveles, obtuve ${rows.length}`);
  assert.ok(rows.length <= 16, "no debe exceder el objetivo de filas");
});

test("footprint never resolves finer than the spread", () => {
  const trades = Array.from({ length: 40 }, (_, i) =>
    trade(100 + i * 0.01, 500, i % 2 === 0),
  );
  const rows = footprintRows(trades, 100.2, 5);
  const gaps = rows
    .map((row) => row.price)
    .slice(1)
    .map((price, index) => Math.abs(rows[index].price - price));
  for (const gap of gaps) {
    assert.ok(gap >= 5 - 1e-9, `separación ${gap} menor al spread`);
  }
});

/**
 * The old implementation sliced the highest-priced rows, so with the market
 * mid-range the ladder drifted above where trading was actually happening.
 * The ladder must stay centred on the mid.
 */
test("footprint ladder stays centred on the mid price", () => {
  const trades: OrderFlowTrade[] = [];
  for (let i = 0; i < 60; i += 1) {
    trades.push(trade(100 + i, 1_000, false));
  }
  const mid = 130;
  const rows = footprintRows(trades, mid, 0.5);
  const prices = rows.map((row) => row.price);

  assert.ok(
    prices.some((price) => price < mid) && prices.some((price) => price > mid),
    "debe conservar niveles a ambos lados del precio actual",
  );
  const above = prices.filter((price) => price > mid).length;
  const below = prices.filter((price) => price < mid).length;
  assert.ok(
    Math.abs(above - below) <= 2,
    `escalera desbalanceada: ${above} arriba contra ${below} abajo`,
  );
});

/**
 * The adaptive step keeps the level count near the target on its own, but the
 * nearest-to-mid slice is the guard that bounds it whatever the distribution.
 */
test("footprint row count stays bounded across distributions", () => {
  const cases: { label: string; trades: OrderFlowTrade[]; mid: number; spread: number }[] = [
    {
      label: "rango estrecho",
      trades: Array.from({ length: 80 }, (_, i) => trade(100 + (i % 20) * 0.01, 500, i % 2 === 0)),
      mid: 100.1,
      spread: 0.001,
    },
    {
      label: "rango amplio",
      trades: Array.from({ length: 200 }, (_, i) => trade(1_000 + i * 13, 500, i % 3 === 0)),
      mid: 2_300,
      spread: 1,
    },
    {
      label: "con valor atípico lejano",
      trades: [
        ...Array.from({ length: 50 }, (_, i) => trade(100 + i * 0.1, 500, i % 2 === 0)),
        trade(900, 500, false),
      ],
      mid: 102,
      spread: 0.05,
    },
    {
      label: "precio sub-unitario",
      trades: Array.from({ length: 60 }, (_, i) => trade(0.00004 + i * 0.0000001, 500, i % 2 === 0)),
      mid: 0.000043,
      spread: 0.00000001,
    },
  ];

  for (const testCase of cases) {
    const rows = footprintRows(testCase.trades, testCase.mid, testCase.spread);
    assert.ok(
      rows.length > 0,
      `${testCase.label}: no produjo ningún nivel`,
    );
    assert.ok(
      rows.length <= FOOTPRINT_TARGET_ROWS,
      `${testCase.label}: ${rows.length} niveles supera el máximo`,
    );
    assert.ok(
      rows.every((row) => Number.isFinite(row.price) && Number.isFinite(row.buy)),
      `${testCase.label}: produjo valores no finitos`,
    );
  }
});

test("footprint rows are ordered by descending price", () => {
  const trades = Array.from({ length: 30 }, (_, i) =>
    trade(100 + i * 0.5, 800, i % 2 === 0),
  );
  const rows = footprintRows(trades, 107, 0.1);
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(rows[i - 1].price > rows[i].price, "orden de precios incorrecto");
  }
});

test("footprint reports imbalance and dominant side", () => {
  const rows = footprintRows(
    [
      trade(100, 9_000, false),
      trade(100, 1_000, true),
      trade(101, 500, true),
      trade(102, 400, false),
      trade(102, 400, true),
    ],
    101,
    1,
  );
  const buyHeavy = rows.find((row) => Math.abs(row.price - 100) < 0.6);
  assert.ok(buyHeavy);
  assert.equal(buyHeavy.dominant, "buy");
  assert.ok(Math.abs(buyHeavy.imbalance - 9) < 1e-9);

  const sellOnly = rows.find((row) => Math.abs(row.price - 101) < 0.6);
  assert.ok(sellOnly);
  assert.equal(sellOnly.dominant, "sell");
  assert.equal(sellOnly.imbalance, Infinity, "un lado vacío es desequilibrio total");

  const balanced = rows.find((row) => Math.abs(row.price - 102) < 0.6);
  assert.ok(balanced);
  assert.equal(balanced.dominant, "flat");
});

test("value area covers the levels holding 70% of volume", () => {
  const trades: OrderFlowTrade[] = [
    trade(100, 100, false),
    trade(101, 100, false),
    trade(102, 8_000, false),
    trade(103, 100, false),
    trade(104, 100, false),
  ];
  const rows = footprintRows(trades, 102, 0.5);
  const inArea = rows.filter((row) => row.inValueArea);
  assert.ok(inArea.length >= 1, "el área de valor no puede quedar vacía");
  const poc = rows.reduce((best, row) =>
    row.buy + row.sell > best.buy + best.sell ? row : best,
  );
  assert.ok(poc.inValueArea, "el POC siempre pertenece al área de valor");
});

test("cumulative delta signs aggressive sells negative", () => {
  assert.equal(cumulativeDelta([]), 0);
  assert.equal(
    cumulativeDelta([trade(100, 500, false), trade(100, 200, true)]),
    300,
  );
  assert.equal(
    cumulativeDelta([trade(100, 200, false), trade(100, 500, true)]),
    -300,
  );
});

test("large trades need a minimum sample before classifying", () => {
  const few = Array.from({ length: 5 }, (_, i) => trade(100, 100 * (i + 1), false));
  assert.equal(classifyLargeTrades(few).eligible, false);
  assert.deepEqual(classifyLargeTrades(few).large, []);

  const many = Array.from({ length: 20 }, (_, i) => trade(100, 100 * (i + 1), false));
  const result = classifyLargeTrades(many);
  assert.equal(result.eligible, true);
  assert.ok(result.large.length > 0);
  assert.ok(result.large.every((t) => t.notional >= result.threshold));
});

// ---- order book -----------------------------------------------------------

const side = (start: number, step: number, qty: number, count: number): [number, number][] =>
  Array.from({ length: count }, (_, i) => [start + i * step, qty]);

test("composite book keeps the live top and extends with the deep snapshot", () => {
  const live = { bids: side(100, -0.1, 10, 5), asks: side(100.1, 0.1, 10, 5) };
  const deep = { bids: side(100, -0.1, 10, 40), asks: side(100.1, 0.1, 10, 40) };
  const merged = compositeBook(live, deep, 30);

  assert.equal(merged.bids[0][0], live.bids[0][0], "el tope vivo debe mandar");
  assert.ok(merged.bids.length > live.bids.length, "debe extenderse con la profundidad");
  assert.ok(merged.bids.length <= 30);
  for (let i = 1; i < merged.bids.length; i += 1) {
    assert.ok(merged.bids[i - 1][0] > merged.bids[i][0], "bids descendentes");
    assert.ok(merged.asks[i - 1][0] < merged.asks[i][0], "asks ascendentes");
  }
});

test("composite book falls back cleanly when either feed is empty", () => {
  const live = { bids: side(100, -0.1, 10, 5), asks: side(100.1, 0.1, 10, 5) };
  const empty = { bids: [] as [number, number][], asks: [] as [number, number][] };
  assert.deepEqual(compositeBook(live, empty, 3).bids, live.bids.slice(0, 3));
  assert.deepEqual(compositeBook(empty, live, 3).asks, live.asks.slice(0, 3));
  assert.deepEqual(compositeBook(empty, empty, 3), { bids: [], asks: [] });
});

test("walls need a book with both sides", () => {
  assert.deepEqual(currentWalls({ bids: [], asks: [] }, []), []);
});

test("walls are the levels standing out against the book's own typical size", () => {
  const bids: [number, number][] = [
    ...side(100, -0.1, 1, 10),
    [98.5, 400], // the block
  ];
  const asks = side(100.1, 0.1, 1, 10);
  const walls = currentWalls({ bids, asks }, []);
  assert.ok(walls.length > 0);
  assert.equal(walls[0].price, 98.5, "el bloque debe encabezar");
  assert.equal(walls[0].side, "BID");
  assert.ok(walls[0].strength > 2, "debe destacar sobre la línea base");
  assert.ok(walls[0].distance < 0, "un bid está por debajo del mid");
});

test("persistence separates a standing block from one that appeared once", () => {
  const bids: [number, number][] = [...side(100, -0.1, 1, 10), [98.5, 400]];
  const asks = side(100.1, 0.1, 1, 10);
  const book = { bids, asks };

  const absent = currentWalls(book, Array.from({ length: 20 }, () => ({ bids: side(100, -0.1, 1, 10), asks })));
  assert.equal(absent[0].persistence, 0, "no estuvo en el historial");

  const present = currentWalls(book, Array.from({ length: 20 }, () => book));
  assert.equal(present[0].persistence, 100, "estuvo en todos los cuadros");
});

test("wall figures stay finite on a degenerate book", () => {
  const book = { bids: [[100, 0]] as [number, number][], asks: [[101, 0]] as [number, number][] };
  for (const wall of currentWalls(book, [])) {
    assert.ok(Number.isFinite(wall.strength) && Number.isFinite(wall.distance));
    assert.ok(Number.isFinite(wall.persistence));
  }
});
