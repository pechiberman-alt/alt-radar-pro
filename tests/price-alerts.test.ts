import assert from "node:assert/strict";
import test from "node:test";
import {
  createdMessage, directionFor, firstTouch, listMessage, normalizeSymbol, parseAlertArgs, parseTarget, px, triggeredMessage, type PriceAlert,
} from "../lib/price-alerts.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

test("symbols: bare coins get USDT, pairs are kept, junk is refused", () => {
  assert.equal(normalizeSymbol("btc"), "BTCUSDT");
  assert.equal(normalizeSymbol("BTC/USDT"), "BTCUSDT");
  assert.equal(normalizeSymbol("ethbtc"), "ETHBTC");
  assert.equal(normalizeSymbol("1000pepe"), "1000PEPEUSDT");
  assert.equal(normalizeSymbol("usdt"), "USDTUSDT");
  assert.equal(normalizeSymbol("b$c"), null);
  assert.equal(normalizeSymbol(""), null);
});

test("prices written the Argentine way and the English way both land on what was meant", () => {
  assert.equal(parseTarget("90.000", 85_000), 90_000, "dot as thousands, BTC");
  assert.equal(parseTarget("90,000", 85_000), 90_000, "comma as thousands, BTC");
  assert.equal(parseTarget("1,495", 1.51), 1.495, "comma as decimal, XRP");
  assert.equal(parseTarget("1.495", 1.51), 1.495, "dot as decimal, XRP");
  assert.equal(parseTarget("1.495", 1_600), 1_495, "same text, ETH-like price: thousands");
  assert.equal(parseTarget("84.500,5", 85_000), 84_500.5);
  assert.equal(parseTarget("84,500.5", 85_000), 84_500.5);
  assert.equal(parseTarget("90k", 85_000), 90_000);
  assert.equal(parseTarget("$118,5", 120), 118.5);
  assert.equal(parseTarget("0.00002", 0.000021), 0.00002);
  assert.equal(parseTarget("5467", 5.4), 5467, "a plain integer is taken as written");
});

test("unreadable prices are refused, not guessed", () => {
  for (const bad of ["", "abc", "90.", "-5", "1..2", "9 0", "0", "1e5"]) assert.equal(parseTarget(bad, 100), null, bad);
});

test("arguments: exactly a pair and a price", () => {
  assert.deepEqual(parseAlertArgs("btc 90000"), { symbol: "BTCUSDT", target: "90000" });
  assert.deepEqual(parseAlertArgs("  SOL   118,5 "), { symbol: "SOLUSDT", target: "118,5" });
  assert.equal(parseAlertArgs("btc"), null);
  assert.equal(parseAlertArgs("btc 90000 ya"), null);
  assert.equal(parseAlertArgs(""), null);
});

test("direction comes from where price is now; a level on top of it is refused", () => {
  assert.equal(directionFor(90_000, 85_000), "ARRIBA");
  assert.equal(directionFor(80_000, 85_000), "ABAJO");
  assert.equal(directionFor(85_010, 85_000), null, "0,01% away is already there");
  assert.equal(directionFor(0, 85_000), null);
});

const m = 60_000;
const c = (i: number, high: number, low: number): SwingCandle => ({ openTime: i * m, open: 0, high, low, close: 0, volume: 0, quoteVolume: 0 });

test("a touch is the first 1-minute candle after creation whose wick reaches the level", () => {
  const up = { target: 100, direction: "ARRIBA" as const, createdAt: 2 * m };
  assert.equal(firstTouch(up, [c(1, 101, 95), c(2, 99, 95), c(3, 100, 96), c(4, 105, 99)]), 3 * m, "minute 1 is before creation; minute 3 touches exactly");
  const down = { target: 90, direction: "ABAJO" as const, createdAt: 0 };
  assert.equal(firstTouch(down, [c(2, 95, 89.9), c(1, 95, 91)]), 2 * m, "order of input doesn't matter");
  assert.equal(firstTouch(down, [c(1, 95, 91)]), null);
  assert.equal(firstTouch(up, []), null);
});

test("the minute in which the alert was created never fires it", () => {
  const alert = { target: 100, direction: "ARRIBA" as const, createdAt: 5 * m + 30_000 };
  assert.equal(firstTouch(alert, [c(5, 120, 90)]), null);
  assert.equal(firstTouch(alert, [c(5, 120, 90), c(6, 100, 99)]), 6 * m);
});

test("formatting: Argentine separators, sensible decimals per price size", () => {
  assert.equal(px(90_000), "90.000");
  assert.equal(px(118.5), "118,5");
  assert.equal(px(1.495), "1,495");
  assert.equal(px(0.00002345), "0,00002345");
  assert.equal(px(1_234_567), "1.234.567");
});

const alert: PriceAlert = { id: 1, symbol: "BTCUSDT", target: 90_000, direction: "ARRIBA", createdAt: 0, createdPrice: 85_000 };

test("messages say what was set, how far it is, and when it was reached in the person's time", () => {
  const created = createdMessage(alert, 85_000);
  assert.match(created, /BTC ↑ 90\.000/);
  assert.match(created, /falta \+5,88%/);
  assert.match(created, /mechas/);
  const fired = triggeredMessage(alert, Date.UTC(2026, 8, 30, 17, 32), 90_120, 180);
  assert.match(fired, /BTC llegó a 90\.000<\/b> subiendo/);
  assert.match(fired, /a las 14:32 · ahora 90\.120/, "UTC-3");
  assert.match(fired, /ya se borró/);
  assert.doesNotMatch(fired, /Kraken|dólares/, "Binance's own price: nothing to explain");
  const elsewhere = triggeredMessage(alert, Date.UTC(2026, 8, 30, 17, 32), 90_120, 180, "Kraken");
  assert.match(elsewhere, /Medido con el precio de Kraken en dólares: Binance no deja leer al servidor ahora\. Puede diferir levemente del de Binance\./);
  const list = listMessage([alert, { ...alert, id: 2, symbol: "SOLUSDT", target: 110, direction: "ABAJO" }], { BTCUSDT: 85_000 });
  assert.match(list, /1\. <b>BTC ↑ 90\.000<\/b> · ahora 85\.000/);
  assert.match(list, /2\. <b>SOL ↓ 110<\/b>$/m, "no price known: no distance invented");
  assert.match(listMessage([], {}), /No tenés alertas/);
});
