import assert from "node:assert/strict";
import test from "node:test";
import { computeTradeStats, tradePnlUsd } from "../lib/trade-journal.ts";
import type { TradeEntry } from "../lib/trade-journal.ts";

const trade = (patch: Partial<TradeEntry>): TradeEntry => ({
  id: "t1",
  symbol: "BTCUSDT",
  side: "LONG",
  entryPrice: 100,
  exitPrice: null,
  sizeUsd: 1000,
  openedAt: "2026-09-01T00:00:00Z",
  closedAt: null,
  note: "",
  ...patch,
});

test("a long profits when price rises, sized by the recorded USD amount", () => {
  const pnl = tradePnlUsd(trade({ entryPrice: 100, exitPrice: 110, sizeUsd: 1000 }));
  assert.ok(pnl !== null && Math.abs(pnl - 100) < 1e-9);
});

test("a short profits when price falls — the sign is flipped, not the math", () => {
  const pnl = tradePnlUsd(
    trade({ side: "SHORT", entryPrice: 100, exitPrice: 90, sizeUsd: 1000 }),
  );
  assert.ok(pnl !== null && Math.abs(pnl - 100) < 1e-9);
});

test("an open trade has no P&L yet — not zero, genuinely unknown", () => {
  assert.equal(tradePnlUsd(trade({ exitPrice: null })), null);
});

test("win rate is wins over resolved trades, open ones excluded from the denominator", () => {
  const stats = computeTradeStats([
    trade({ id: "1", entryPrice: 100, exitPrice: 110, closedAt: "2026-09-02" }),
    trade({ id: "2", entryPrice: 100, exitPrice: 90, closedAt: "2026-09-03" }),
    trade({ id: "3", entryPrice: 100, exitPrice: null }), // still open
  ]);
  assert.equal(stats.closedTrades, 2);
  assert.equal(stats.openTrades, 1);
  assert.equal(stats.winRate, 0.5);
});

test("profit factor divides gross profit by gross loss", () => {
  const stats = computeTradeStats([
    trade({ id: "1", entryPrice: 100, exitPrice: 120, sizeUsd: 1000, closedAt: "2026-09-02" }), // +200
    trade({ id: "2", entryPrice: 100, exitPrice: 95, sizeUsd: 1000, closedAt: "2026-09-03" }), // -50
  ]);
  assert.ok(stats.profitFactor !== null && Math.abs(stats.profitFactor - 4) < 1e-9);
});

test("no losses at all means profit factor has nothing to divide by", () => {
  const stats = computeTradeStats([
    trade({ id: "1", entryPrice: 100, exitPrice: 110, closedAt: "2026-09-02" }),
  ]);
  assert.equal(stats.profitFactor, null);
});

test("a breakeven trade counts as neither a win nor a loss", () => {
  const stats = computeTradeStats([
    trade({ id: "1", entryPrice: 100, exitPrice: 100, closedAt: "2026-09-02" }),
    trade({ id: "2", entryPrice: 100, exitPrice: 110, closedAt: "2026-09-03" }),
  ]);
  assert.equal(stats.breakeven, 1);
  assert.equal(stats.winRate, 1, "1 de 1 resueltos ganador — el breakeven no entra al denominador");
});

test("the streak counts only the run reaching the most recent trade, by date not insertion order", () => {
  const stats = computeTradeStats([
    // Inserted out of chronological order on purpose.
    trade({ id: "3", entryPrice: 100, exitPrice: 110, closedAt: "2026-09-05" }),
    trade({ id: "1", entryPrice: 100, exitPrice: 90, closedAt: "2026-09-01" }),
    trade({ id: "2", entryPrice: 100, exitPrice: 110, closedAt: "2026-09-03" }),
  ]);
  assert.equal(stats.currentStreak.direction, "GANADORA");
  assert.equal(stats.currentStreak.count, 2, "las dos ultimas por fecha, no por orden de carga");
});

test("a thin sample is labelled rather than rounded into confidence", () => {
  const stats = computeTradeStats([
    trade({ id: "1", entryPrice: 100, exitPrice: 110, closedAt: "2026-09-02" }),
  ]);
  assert.equal(stats.confidence, "MUESTRA MÍNIMA");
});

test("no trades at all yields no rate rather than a default", () => {
  const stats = computeTradeStats([]);
  assert.equal(stats.winRate, null);
  assert.equal(stats.confidence, "SIN MUESTRA");
});
