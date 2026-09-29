import assert from "node:assert/strict";
import test from "node:test";
import { parseBinanceCsv, parseCsv, parseQuantity, parseSide, parseTime, readSpotHistory, spotCandidates } from "../lib/binance-import.ts";
import { validateJFill } from "../lib/account-journal.ts";

const T = Date.UTC(2026, 8, 20, 12, 30, 45);
const ok = (text: string, market: "futures" | "spot" = "futures") => {
  const r = parseBinanceCsv(text, market);
  assert.ok(r.ok, JSON.stringify(r));
  return r as Extract<ReturnType<typeof parseBinanceCsv>, { ok: true }>;
};

test("the futures export layout: columns found by name, rows become fills", () => {
  const r = ok("Date(UTC),Symbol,Side,Price,Quantity,Amount,Fee,Fee Coin,Quote Asset\n2026-09-20 12:30:45,BTCUSDT,BUY,84000.5,0.01,840.005,0.42,USDT,USDT\n2026-09-20 12:31:00,ETHUSDT,SELL,2500,0.4,1000,0.5,USDT,USDT\n");
  assert.equal(r.fills.length, 2);
  assert.deepEqual([r.fills[0].symbol, r.fills[0].side, r.fills[0].price, r.fills[0].qty, r.fills[0].fee, r.fills[0].feeAsset, r.fills[0].time], ["BTCUSDT", "BUY", 84000.5, 0.01, 0.42, "USDT", T]);
  assert.equal(r.fills[1].side, "SELL");
  assert.equal(r.mismatched, 0);
  assert.deepEqual(r.symbols, ["BTCUSDT", "ETHUSDT"]);
  assert.equal(r.from, T);
  assert.equal(r.mapping.time, "Date(UTC)");
  assert.ok(r.fills.every((f) => validateJFill(f, T + 86_400_000) !== null), "every parsed fill passes the server's validation");
});

test("numbers carry their asset, pairs come in several spellings, columns in Spanish", () => {
  const r = ok('Fecha(UTC),Par,Lado,Precio,Ejecutado,Monto,Comisión\n26-09-20 12:30:45,"BTC/USDT",Compra,"84,000.5",0.0100BTC,840.005USDT,0.00001BTC\n', "spot");
  const f = r.fills[0];
  assert.deepEqual([f.symbol, f.side, f.price, f.qty, f.fee, f.feeAsset, f.time], ["BTCUSDT", "BUY", 84000.5, 0.01, 0.00001, "BTC", T]);
});

test("semicolon files read the comma as a decimal", () => {
  const r = ok("Fecha;Símbolo;Lado;Precio;Cantidad\n2026-09-20 12:30:45;BTCUSDT Perpetual;VENTA;84000,5;0,01\n");
  assert.equal(r.fills[0].price, 84000.5);
  assert.equal(r.fills[0].qty, 0.01);
  assert.equal(r.fills[0].symbol, "BTCUSDT");
  assert.equal(r.fills[0].side, "SELL");
});

test("a realised-profit column is used when the file has one", () => {
  const r = ok("Time(UTC),Symbol,Side,Price,Quantity,Realized Profit\n2026-09-20 12:30:45,BTCUSDT,SELL,110,1,9.5\n");
  assert.equal(r.fills[0].realizedPnl, 9.5);
  assert.equal(ok("Time(UTC),Symbol,Side,Price,Quantity,Realized Profit\n2026-09-20 12:30:45,BTCUSDT,SELL,110,1,9.5\n", "spot").fills[0].realizedPnl, null);
});

test("missing columns stop the import and say which ones, with the headers found", () => {
  const r = parseBinanceCsv("Foo,Bar\n1,2\n", "futures");
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.error, /fecha\/hora/);
    assert.match(r.error, /precio/);
    assert.deepEqual(r.headers, ["Foo", "Bar"]);
  }
  assert.equal(parseBinanceCsv("", "spot").ok, false);
});

test("rows that can't be read are reported with their line, never guessed", () => {
  const r = ok("Date(UTC),Symbol,Side,Price,Quantity\nnot-a-date,BTCUSDT,BUY,1,1\n2026-09-20 12:30:45,BTCUSDT,HOLD,1,1\n2026-09-20 12:30:45,BTCUSDT,BUY,abc,1\n2026-09-20 12:30:45,BTCUSDT,BUY,1,1\n");
  assert.equal(r.fills.length, 1);
  assert.deepEqual(r.rejected.map((x) => x.line), [2, 3, 4]);
  assert.match(r.rejected[0].reason, /fecha/);
  assert.match(r.rejected[1].reason, /lado/);
  assert.match(r.rejected[2].reason, /precio/);
});

test("zero-quantity rows (cancelled orders) are skipped quietly", () => {
  const r = ok("Date(UTC),Symbol,Side,Price,Quantity\n2026-09-20 12:30:45,BTCUSDT,BUY,1,0\n2026-09-20 12:30:45,BTCUSDT,BUY,1,2\n");
  assert.equal(r.fills.length, 1);
  assert.equal(r.skippedZero, 1);
  assert.equal(r.rejected.length, 0);
});

test("a file whose columns were misread is flagged by quantity × price against the amount", () => {
  const rows = Array.from({ length: 10 }, (_, i) => `2026-09-20 12:30:${10 + i},BTCUSDT,BUY,100,2,999`).join("\n");
  const r = ok(`Date(UTC),Symbol,Side,Price,Quantity,Amount\n${rows}\n`);
  assert.equal(r.mismatched, 10);
  assert.ok(r.warnings.some((w) => w.includes("no coincide")));
});

test("identical rows in one file get distinct, stable ids", () => {
  const text = "Date(UTC),Symbol,Side,Price,Quantity\n2026-09-20 12:30:45,BTCUSDT,BUY,100,1\n2026-09-20 12:30:45,BTCUSDT,BUY,100,1\n";
  const a = ok(text).fills.map((f) => f.id);
  assert.equal(new Set(a).size, 2);
  assert.deepEqual(ok(text).fills.map((f) => f.id), a);
});

test("primitives: csv quoting, quantities with units, times, sides", () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","he said ""hi"""\n').rows[1], ["x, y", 'he said "hi"']);
  assert.deepEqual(parseQuantity("0.5BTC", false), { value: 0.5, unit: "BTC" });
  assert.deepEqual(parseQuantity("1,234.5", false), { value: 1234.5, unit: "" });
  assert.deepEqual(parseQuantity("1.234,5", true), { value: 1234.5, unit: "" });
  assert.equal(parseQuantity("abc", false), null);
  assert.equal(parseTime("2026-09-20 12:30:45"), T);
  assert.equal(parseTime("26-09-20 12:30:45"), T);
  assert.equal(parseTime("2026-09-20T12:30:45Z"), T);
  assert.equal(parseTime("2026-09-20T09:30:45-03:00"), T);
  assert.equal(parseTime("2026-02-31 10:00:00"), null);
  assert.equal(parseTime("20/09/2026"), null);
  assert.equal(parseSide("Open Long"), "BUY");
  assert.equal(parseSide("Close Long"), "SELL");
  assert.equal(parseSide("x"), null);
});

test("spot pairs to read: every non-stable asset held, plus the ones added", () => {
  const out = spotCandidates([
    { asset: "BTC", free: "0.1", locked: "0" }, { asset: "USDT", free: "50", locked: "0" }, { asset: "ETH", free: "0", locked: "0" },
    { asset: "SOL", free: "0", locked: "3" }, { asset: "bad asset", free: "1", locked: "0" },
  ], ["dogeusdt", "sol/usdc", "x"]);
  assert.deepEqual(out, ["BTCUSDT", "DOGEUSDT", "SOLUSDC", "SOLUSDT"]);
});

test("a whole history is read forward in pages of 1000", async () => {
  const all = Array.from({ length: 2500 }, (_, i) => ({ id: i + 1 }));
  const calls: number[] = [];
  const page = async (fromId: number) => {
    calls.push(fromId);
    return all.filter((r) => r.id >= fromId).slice(0, 1000);
  };
  assert.equal((await readSpotHistory(page, null)).length, 2500);
  assert.deepEqual(calls, [0, 1001, 2001]);
  calls.length = 0;
  assert.equal((await readSpotHistory(page, 1500)).length, 1000);
  // A full page can't prove it was the last, so one more call confirms the end.
  assert.deepEqual(calls, [1501, 2501]);
  const endless = async (fromId: number) => Array.from({ length: 1000 }, (_, i) => ({ id: fromId + i }));
  assert.equal((await readSpotHistory(endless, null, 3)).length, 3000, "capped, never an endless loop");
});
