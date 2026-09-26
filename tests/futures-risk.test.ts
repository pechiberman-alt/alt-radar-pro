import assert from "node:assert/strict";
import test from "node:test";
import {
  isNearLiquidation, openFuturesPositions, parseFuturesAccountSummary, parseFuturesPosition,
} from "../lib/futures-risk.ts";
import type { RawFuturesAccount, RawFuturesPosition } from "../lib/binance-futures.ts";

const raw = (patch: Partial<RawFuturesPosition> = {}): RawFuturesPosition => ({
  symbol: "BTCUSDT",
  positionAmt: "0.010",
  entryPrice: "9975.12",
  markPrice: "9973.50770517",
  unRealizedProfit: "-0.01612295",
  liquidationPrice: "7963.54",
  leverage: "50",
  marginType: "isolated",
  isolatedMargin: "199.5",
  notional: "99.735077",
  ...patch,
});

test("a positive positionAmt is LONG, negative is SHORT, qty is always positive", () => {
  assert.equal(parseFuturesPosition(raw({ positionAmt: "0.010" })).side, "LONG");
  const short = parseFuturesPosition(raw({ positionAmt: "-0.010" }));
  assert.equal(short.side, "SHORT");
  assert.equal(short.qty, 0.01);
});

test("matches Binance's own documented example values", () => {
  // developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Position-Information-V2
  const p = parseFuturesPosition(raw());
  assert.equal(p.entryPrice, 9975.12);
  assert.equal(p.markPrice, 9973.50770517);
  assert.equal(p.liquidationPrice, 7963.54);
  assert.equal(p.leverage, 50);
});

test("liquidationPrice of 0 is read as null, never as a real price of $0", () => {
  const p = parseFuturesPosition(raw({ liquidationPrice: "0" }));
  assert.equal(p.liquidationPrice, null);
  assert.equal(p.distanceToLiquidationPct, null, "sin nivel real, no hay distancia que calcular");
});

test("distance to liquidation is the gap between mark price and liquidation price", () => {
  const p = parseFuturesPosition(raw({ markPrice: "100", liquidationPrice: "90" }));
  assert.equal(p.distanceToLiquidationPct, 10);
});

test("ROE% for an isolated position uses the isolated margin as its basis", () => {
  const p = parseFuturesPosition(raw({ marginType: "isolated", isolatedMargin: "100", unRealizedProfit: "25" }));
  assert.equal(p.roePct, 25);
});

test("ROE% for a cross position falls back to notional / leverage, since isolatedMargin is 0 there", () => {
  const p = parseFuturesPosition(raw({ marginType: "cross", isolatedMargin: "0", notional: "1000", leverage: "10", unRealizedProfit: "50" }));
  // margin basis = 1000 / 10 = 100 -> 50/100 = 50%
  assert.equal(p.roePct, 50);
});

test("ROE% is null rather than Infinity/NaN when there is no usable margin basis", () => {
  const p = parseFuturesPosition(raw({ marginType: "cross", isolatedMargin: "0", leverage: "0" }));
  assert.equal(p.roePct, null);
});

test("margin at risk is only ever set for isolated positions — cross is always null, not a guess", () => {
  const isolated = parseFuturesPosition(raw({ marginType: "isolated", isolatedMargin: "199.5" }));
  assert.equal(isolated.marginAtRiskUsd, 199.5);
  const cross = parseFuturesPosition(raw({ marginType: "cross", isolatedMargin: "0" }));
  assert.equal(cross.marginAtRiskUsd, null, "en cruzado no hay un techo de pérdida por posición que afirmar");
});

test("flat symbols (positionAmt 0) are dropped; only real positions remain", () => {
  const rows = [raw({ symbol: "BTCUSDT", positionAmt: "0.01" }), raw({ symbol: "ETHUSDT", positionAmt: "0" })];
  const open = openFuturesPositions(rows);
  assert.equal(open.length, 1);
  assert.equal(open[0].symbol, "BTCUSDT");
});

test("near-liquidation flags a tight distance and nothing else", () => {
  assert.equal(isNearLiquidation(5), true);
  assert.equal(isNearLiquidation(10), true, "el umbral por defecto es inclusive");
  assert.equal(isNearLiquidation(11), false);
  assert.equal(isNearLiquidation(null), false);
});

test("account summary parses Binance's numeric-string fields and computes margin usage", () => {
  const rawAccount: RawFuturesAccount = {
    totalWalletBalance: "1000",
    totalUnrealizedProfit: "-50",
    totalMarginBalance: "950",
    availableBalance: "760",
    totalInitialMargin: "190",
    totalMaintMargin: "50",
  };
  const summary = parseFuturesAccountSummary(rawAccount);
  assert.equal(summary.totalWalletBalanceUsd, 1000);
  assert.equal(summary.totalUnrealizedPnlUsd, -50);
  assert.equal(summary.marginUsagePct, 20, "190 de margen inicial sobre 950 de balance de margen = 20%");
});

test("margin usage is null rather than divide-by-zero on an empty account", () => {
  const summary = parseFuturesAccountSummary({
    totalWalletBalance: "0", totalUnrealizedProfit: "0", totalMarginBalance: "0",
    availableBalance: "0", totalInitialMargin: "0", totalMaintMargin: "0",
  });
  assert.equal(summary.marginUsagePct, null);
});
