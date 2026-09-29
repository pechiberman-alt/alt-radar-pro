import assert from "node:assert/strict";
import test from "node:test";
import {
  futuresLogCsv, futuresLogSummary, logKey, mergeFuturesLog, parseUserDataEvent, validateFuturesLogRow,
  type FuturesFill, type FuturesLogRow,
} from "../lib/futures-log.ts";

const T = Date.UTC(2026, 8, 28, 15, 0, 0);
// Shaped like Binance's documented ORDER_TRADE_UPDATE.
const tradeEvent = (o: Record<string, unknown> = {}) => ({
  e: "ORDER_TRADE_UPDATE", E: T + 1, T,
  o: {
    s: "BTCUSDT", c: "web_abc", S: "SELL", o: "MARKET", f: "GTC", q: "0.010", p: "0", ap: "84000", sp: "0",
    x: "TRADE", X: "FILLED", i: 998877, l: "0.010", z: "0.010", L: "84000.5", N: "USDT", n: "0.33600200",
    T, t: 5551234, b: "0", a: "0", m: false, R: true, wt: "CONTRACT_PRICE", ot: "MARKET", ps: "BOTH",
    cp: false, rp: "12.34000000", V: "EXPIRE_TAKER", pm: "NONE", gtd: 0, ...o,
  },
});

test("an execution becomes a fill with everything the report needs", () => {
  const [row] = parseUserDataEvent(tradeEvent()) as FuturesFill[];
  assert.equal(row.kind, "fill");
  assert.equal(row.id, "BTCUSDT-5551234");
  assert.equal(row.time, T);
  assert.equal(row.side, "SELL");
  assert.equal(row.price, 84000.5);
  assert.equal(row.qty, 0.01);
  assert.equal(row.commission, 0.336002);
  assert.equal(row.commissionAsset, "USDT");
  assert.equal(row.realizedPnl, 12.34);
  assert.equal(row.reduceOnly, true);
  assert.equal(row.orderId, 998877);
  assert.equal(row.liquidation, false);
});

test("new orders, cancels, expiries and amendments are not operations", () => {
  for (const x of ["NEW", "CANCELED", "EXPIRED", "AMENDMENT"]) assert.deepEqual(parseUserDataEvent(tradeEvent({ x, l: "0" })), [], x);
});

test("liquidations are recorded and flagged, whether Binance marks them by execution type or by order id", () => {
  assert.equal((parseUserDataEvent(tradeEvent({ x: "CALCULATED" }))[0] as FuturesFill).liquidation, true);
  assert.equal((parseUserDataEvent(tradeEvent({ c: "autoclose-1596107620040000020" }))[0] as FuturesFill).liquidation, true);
  assert.equal((parseUserDataEvent(tradeEvent({ c: "adl_autoclose" }))[0] as FuturesFill).liquidation, true);
});

test("funding payments are recorded, one row per asset, with the symbol when Binance sends it", () => {
  const rows = parseUserDataEvent({
    e: "ACCOUNT_UPDATE", E: T + 5, T: T + 4,
    a: { m: "FUNDING_FEE", S: "ETHUSDT", B: [{ a: "USDT", wb: "100", cw: "100", bc: "-0.42" }, { a: "BNB", wb: "1", cw: "1", bc: "0" }], P: [] },
  });
  assert.deepEqual(rows, [{ kind: "funding", id: `${T + 4}-USDT-ETHUSDT`, time: T + 4, symbol: "ETHUSDT", asset: "USDT", amount: -0.42 }]);
});

test("other balance updates, market data and junk yield nothing", () => {
  assert.deepEqual(parseUserDataEvent({ e: "ACCOUNT_UPDATE", E: T, T, a: { m: "ORDER", B: [{ a: "USDT", bc: "5" }] } }), []);
  for (const junk of [null, "x", { e: "aggTrade" }, { e: "ORDER_TRADE_UPDATE" }, tradeEvent({ t: undefined }), tradeEvent({ S: "LONG" })]) {
    assert.deepEqual(parseUserDataEvent(junk), []);
  }
});

test("validation accepts parsed rows unchanged and refuses anything malformed", () => {
  const now = T + 1000;
  const fill = parseUserDataEvent(tradeEvent())[0];
  assert.deepEqual(validateFuturesLogRow(JSON.parse(JSON.stringify(fill)), now), fill);
  const funding: FuturesLogRow = { kind: "funding", id: "f1", time: T, symbol: null, asset: "USDT", amount: 1 };
  assert.deepEqual(validateFuturesLogRow(funding, now), funding);
  const bad: Record<string, unknown>[] = [
    { ...fill, kind: "trade" }, { ...fill, symbol: "btc" }, { ...fill, side: "LONG" }, { ...fill, price: 0 },
    { ...fill, qty: -1 }, { ...fill, maker: "no" }, { ...fill, time: T + 2 * 86_400_000 }, { ...fill, id: "" },
    { ...fill, commissionAsset: "usdt" }, { ...funding, amount: 0 }, { ...funding, symbol: 5 }, { ...funding, asset: "" },
  ];
  for (const b of bad) assert.equal(validateFuturesLogRow(b, now), null, JSON.stringify(b).slice(0, 80));
  for (const junk of [null, 1, "row"]) assert.equal(validateFuturesLogRow(junk, now), null);
});

test("merge keeps one row per kind and id, oldest first", () => {
  const a = parseUserDataEvent(tradeEvent({ t: 1, T: T + 10 }))[0];
  const b = parseUserDataEvent(tradeEvent({ t: 2, T: T }))[0];
  const merged = mergeFuturesLog([a, b], [a]);
  assert.deepEqual(merged.map(logKey), ["fill:BTCUSDT-2", "fill:BTCUSDT-1"]);
});

const month = (t: number) => new Date(t).toISOString().slice(0, 7);
const fill = (p: Partial<FuturesFill>): FuturesFill => ({ ...(parseUserDataEvent(tradeEvent())[0] as FuturesFill), ...p });

test("summary: closes, win rate and profit factor come only from fills that realised PnL", () => {
  const rows: FuturesLogRow[] = [
    fill({ id: "a", realizedPnl: 0, commission: 0.5 }), // an opening fill
    fill({ id: "b", realizedPnl: 20, commission: 0.5 }),
    fill({ id: "c", realizedPnl: -8, commission: 0.5 }),
    fill({ id: "d", realizedPnl: 4, commission: 0.25, commissionAsset: "BNB" }),
    { kind: "funding", id: "f", time: T, symbol: "BTCUSDT", asset: "USDT", amount: -1.5 },
  ];
  const s = futuresLogSummary(rows, month);
  assert.equal(s.fills, 4);
  assert.equal(s.closes, 3);
  assert.equal(s.winners, 2);
  assert.equal(s.winRate, 2 / 3);
  assert.equal(s.profitFactor, 24 / 8);
  assert.equal(s.realized, 16);
  assert.equal(s.fees, 1.5, "only dollar fees are summed");
  assert.deepEqual(s.otherFees, { BNB: 0.25 }, "BNB fees reported apart, never converted at a guessed price");
  assert.equal(s.funding, -1.5);
  assert.equal(s.net, 16 - 1.5 - 1.5);
  assert.equal(s.bySymbol[0].key, "BTCUSDT");
  assert.equal(s.bySymbol[0].net, s.net);
});

test("summary counts liquidations and groups by month, newest first", () => {
  const s = futuresLogSummary([fill({ id: "1", time: Date.UTC(2026, 7, 3), liquidation: true }), fill({ id: "2", time: Date.UTC(2026, 8, 3) })], month);
  assert.equal(s.liquidations, 1);
  assert.deepEqual(s.byMonth.map((g) => g.key), ["2026-09", "2026-08"]);
});

test("summary of nothing is empty, not zeros pretending to be results", () => {
  const s = futuresLogSummary([], month);
  assert.equal(s.winRate, null);
  assert.equal(s.profitFactor, null);
  assert.equal(s.fills, 0);
});

test("CSV: header, one line per row, decimal comma, funding in its own columns", () => {
  const rows: FuturesLogRow[] = [fill({}), { kind: "funding", id: "f", time: T, symbol: null, asset: "USDT", amount: -0.42 }];
  const csv = futuresLogCsv(rows, (t) => new Date(t).toISOString().slice(0, 16).replace("T", " "));
  assert.ok(csv.startsWith("\uFEFFFecha;Tipo;Par;Lado;"));
  const [, first, second] = csv.trimEnd().split("\r\n");
  const a = first.split(";");
  assert.equal(a[1], "Ejecución");
  assert.equal(a[3], "VENTA");
  assert.equal(a[6], "84000,5");
  assert.equal(a[11], "12,34");
  const b = second.split(";");
  assert.equal(b[1], "Funding");
  assert.equal(b[12], "-0,42");
  assert.equal(b[13], "USDT");
});
