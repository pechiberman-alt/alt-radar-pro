import assert from "node:assert/strict";
import test from "node:test";
import {
  bybitDerivatives,
  derivativesWithFallback,
  hyperliquidDerivatives,
  loadOkxLiquidations,
  okxContractValue,
  okxDerivatives,
  okxLiquidationTape,
  PROVIDER_LABEL,
  venueSymbol,
  type Fetcher,
} from "../lib/market-providers.ts";

const H = 3_600_000;
const NOW = Date.UTC(2026, 9, 8, 12, 0);

test("each exchange's name for the coin, including the 1000x contracts", () => {
  assert.equal(venueSymbol("BTCUSDT", "bybit"), "BTCUSDT");
  assert.equal(venueSymbol("BTCUSDT", "okx"), "BTC-USDT-SWAP");
  assert.equal(venueSymbol("BTCUSDT", "hyperliquid"), "BTC");
  assert.equal(venueSymbol("1000PEPEUSDT", "okx"), "PEPE-USDT-SWAP");
  assert.equal(venueSymbol("1000PEPEUSDT", "hyperliquid"), "kPEPE");
  assert.equal(venueSymbol("1000PEPEUSDT", "bybit"), "1000PEPEUSDT");
  assert.equal(venueSymbol("BTC/USDT; DROP", "okx"), null, "never a name built from garbage");
});

/** Bybit v5 shapes: strings everywhere, history newest first. */
const bybit = {
  tickers: { retCode: 0, retMsg: "OK", result: { category: "linear", list: [{ symbol: "BTCUSDT", markPrice: "62000", fundingRate: "0.0001", nextFundingTime: String(NOW + 2 * H), openInterest: "50000", openInterestValue: "3100000000", fundingIntervalHour: "8" }] } },
  oiHist: { retCode: 0, result: { list: Array.from({ length: 25 }, (_, i) => ({ openInterest: String(50_000 - i * 100), timestamp: String(NOW - i * H) })) } },
  ratio: { retCode: 0, result: { list: [{ symbol: "BTCUSDT", buyRatio: "0.6", sellRatio: "0.4", timestamp: String(NOW) }] } },
};

test("Bybit: funding per 8 h whatever the contract's interval, OI change over 24 h, accounts long/short", () => {
  const d = bybitDerivatives(bybit, 62_000)!;
  assert.equal(d.source, PROVIDER_LABEL.bybit);
  assert.ok(Math.abs(d.fundingPct! - 0.01) < 1e-12);
  assert.equal(d.openInterestUsd, 3_100_000_000);
  // Newest first: 50.000 now against 47.600 a day ago.
  assert.ok(Math.abs(d.oiChange24hPct! - ((50_000 - 47_600) / 47_600) * 100) < 1e-9);
  assert.ok(Math.abs(d.longShortRatio! - 1.5) < 1e-12);
  assert.equal(d.takerBuySell, null, "Bybit does not publish it: missing, not zero");
  const fourHours = bybitDerivatives({ ...bybit, tickers: { ...bybit.tickers, result: { list: [{ ...bybit.tickers.result.list[0], fundingIntervalHour: "4" }] } } }, 62_000)!;
  assert.ok(Math.abs(fourHours.fundingPct! - 0.02) < 1e-12, "a 4 h contract charges twice per 8 h");
  assert.equal(bybitDerivatives({ ...bybit, tickers: { retCode: 10001, result: { list: [] } } }, 62_000), null);
  // Without a day of history the change is unknown, not computed over a shorter span.
  const short = bybitDerivatives({ ...bybit, oiHist: { retCode: 0, result: { list: bybit.oiHist.result.list.slice(0, 5) } } }, 62_000)!;
  assert.equal(short.oiChange24hPct, null);
});

/** OKX v5 shapes: code "0", rubik rows as arrays, newest first. */
const okx = {
  funding: { code: "0", msg: "", data: [{ instId: "BTC-USDT-SWAP", fundingRate: "0.00015", fundingTime: String(NOW + 4 * H), nextFundingTime: String(NOW + 12 * H) }] },
  oi: { code: "0", data: [{ instId: "BTC-USDT-SWAP", oi: "2500000", oiCcy: "25000", oiUsd: "1550000000", ts: String(NOW) }] },
  oiHist: { code: "0", data: Array.from({ length: 25 }, (_, i) => [String(NOW - i * H), "2500000", "25000", String(1_550_000_000 - i * 1_000_000)]) },
  ratio: { code: "0", data: [[String(NOW), "1.85"], [String(NOW - H), "1.9"]] },
  taker: { code: "0", data: [[String(NOW), "120", "150"], [String(NOW - H), "100", "90"]] },
};

test("OKX: funding brought to 8 h, OI in dollars and its 24 h change, accounts ratio and aggressor flow", () => {
  const d = okxDerivatives(okx, 62_000)!;
  assert.equal(d.source, PROVIDER_LABEL.okx);
  assert.ok(Math.abs(d.fundingPct! - 0.015) < 1e-12, "8 h between fundings: the rate as it is");
  assert.equal(d.openInterestUsd, 1_550_000_000);
  assert.equal(d.openInterest, 25_000);
  assert.ok(Math.abs(d.oiChange24hPct! - ((1_550_000_000 - 1_526_000_000) / 1_526_000_000) * 100) < 1e-9);
  assert.equal(d.longShortRatio, 1.85, "the newest row");
  assert.ok(Math.abs(d.takerBuySell! - 150 / 120) < 1e-12);
  const four = okxDerivatives({ ...okx, funding: { code: "0", data: [{ fundingRate: "0.00015", fundingTime: String(NOW), nextFundingTime: String(NOW + 4 * H) }] } }, 62_000)!;
  assert.ok(Math.abs(four.fundingPct! - 0.03) < 1e-12);
  assert.equal(okxDerivatives({ funding: { code: "51001", data: [] }, oi: null, oiHist: null, ratio: null, taker: null }, 62_000), null);
});

test("Hyperliquid: hourly funding times eight, open interest in coins priced at the mark", () => {
  const raw = [{ universe: [{ name: "ETH" }, { name: "BTC" }] }, [{ funding: "0.00002", openInterest: "100", markPx: "2400" }, { funding: "0.0000125", openInterest: "10", markPx: "62000" }]];
  const d = hyperliquidDerivatives(raw, "BTC", 61_000)!;
  assert.ok(Math.abs(d.fundingPct! - 0.01) < 1e-12);
  assert.equal(d.openInterestUsd, 620_000);
  assert.equal(d.markPrice, 62_000);
  assert.equal(d.oiChange24hPct, null);
  assert.equal(hyperliquidDerivatives(raw, "SOL", 140), null, "a coin it does not list");
  assert.equal(hyperliquidDerivatives({ error: "x" }, "BTC", 1), null);
});

function stub(routes: [RegExp, unknown | ((url: string) => unknown)][]): { f: Fetcher; calls: string[] } {
  const calls: string[] = [];
  const f: Fetcher = async (url) => {
    calls.push(url);
    for (const [re, body] of routes) if (re.test(url)) return Response.json(typeof body === "function" ? (body as (u: string) => unknown)(url) : body);
    return new Response("Forbidden", { status: 403 });
  };
  return { f, calls };
}

test("fallback: Binance refuses, Bybit answers the whole block, and every attempt is reported", async () => {
  const { f, calls } = stub([
    [/api\.bybit\.com\/v5\/market\/tickers/, bybit.tickers],
    [/api\.bybit\.com\/v5\/market\/open-interest/, bybit.oiHist],
    [/api\.bybit\.com\/v5\/market\/account-ratio/, bybit.ratio],
  ]);
  const r = await derivativesWithFallback("BTCUSDT", 62_000, ["binance", "bybit", "okx"], f);
  assert.equal(r.provider, "bybit");
  assert.equal(r.derivatives!.source, PROVIDER_LABEL.bybit);
  assert.deepEqual(r.tried.map((x) => [x.provider, x.ok]), [["binance", false], ["bybit", true]]);
  assert.ok(!calls.some((u) => u.includes("okx.com")), "stops at the first that answers");
  const none = await derivativesWithFallback("BTCUSDT", 62_000, ["bybit", "okx", "hyperliquid"], stub([]).f);
  assert.equal(none.derivatives, null);
  assert.equal(none.tried.length, 3);
});

// ── Real liquidations (OKX) ──

const detail = (minsAgo: number, posSide: string, side: string, sz: string, bkPx: string) => ({ bkLoss: "0", bkPx, ccy: "", posSide, side, sz, ts: String(NOW - minsAgo * 60_000) });

test("OKX liquidations: long and short by position, dollars from contracts, windows of 1, 4 and 24 h", () => {
  const page = { code: "0", data: [{ instFamily: "BTC-USDT", details: [
    detail(10, "long", "sell", "100", "60000"), // 100 contracts × 0,01 BTC × 60.000 = 60.000 USD
    detail(30, "short", "buy", "50", "61000"), // 30.500 USD
    detail(90, "net", "sell", "200", "59000"), // net + sell = a long: 118.000 USD
    detail(300, "net", "buy", "10", "58000"), // a short: 5.800 USD
    detail(-5, "long", "sell", "999", "60000"), // from the future: ignored
    detail(10, "long", "sell", "100", "60000"), // the same order twice: counted once
  ] }] };
  const t = okxLiquidationTape([page], 0.01, NOW, true)!;
  const w = (h: number) => t.ventanas.find((x) => x.horas === h)!;
  assert.equal(w(1).largosUsd, 60_000);
  assert.equal(w(1).cortosUsd, 30_500);
  assert.equal(w(1).ordenes, 2);
  assert.equal(w(4).largosUsd, 178_000);
  assert.equal(w(24).cortosUsd, 36_300);
  assert.ok(t.ventanas.every((x) => x.completa), "OKX returned less than asked: that was all there was");
  assert.deepEqual(t.mayor, { usd: 118_000, lado: "LARGO", precio: 59_000, at: NOW - 90 * 60_000 });
  assert.match(t.fuente, /una parte del mercado/);
});

test("OKX liquidations: a full page means older ones may exist, so the longer windows say 'at least'", () => {
  const page = { code: "0", data: [{ details: Array.from({ length: 100 }, (_, i) => detail(i, "long", "sell", "1", "60000")) }] };
  const t = okxLiquidationTape([page], 0.01, NOW, false)!;
  const w = (h: number) => t.ventanas.find((x) => x.horas === h)!;
  assert.equal(w(1).completa, true, "it reaches back past an hour");
  assert.equal(w(4).completa, false);
  assert.equal(w(24).completa, false);
  assert.equal(okxLiquidationTape([page], 0, NOW, false), null, "without the contract value there is no dollar figure");
  assert.equal(okxContractValue({ code: "0", data: [{ instId: "BTC-USDT-SWAP", ctVal: "0.01" }] }), 0.01);
  assert.equal(okxContractValue({ code: "0", data: [] }), null);
});

test("OKX liquidations: pages back with 'after' until a short page or a day back", async () => {
  const first = Array.from({ length: 100 }, (_, i) => detail(i * 2, "long", "sell", "1", "60000"));
  const second = Array.from({ length: 40 }, (_, i) => detail(200 + i * 2, "short", "buy", "1", "60000"));
  const { f, calls } = stub([
    [/public\/instruments/, { code: "0", data: [{ ctVal: "0.01" }] }],
    [/liquidation-orders.*after=/, { code: "0", data: [{ details: second }] }],
    [/liquidation-orders/, { code: "0", data: [{ details: first }] }],
  ]);
  const t = (await loadOkxLiquidations("BTCUSDT", NOW, f))!;
  const pages = calls.filter((u) => u.includes("liquidation-orders"));
  assert.equal(pages.length, 2);
  assert.match(pages[1], new RegExp(`after=${NOW - 198 * 60_000}`));
  assert.ok(t.ventanas.every((x) => x.completa), "the second page was short: nothing older");
  assert.equal(t.ventanas.find((x) => x.horas === 24)!.ordenes, 140);
  assert.equal(await loadOkxLiquidations("BTCUSDT", NOW, stub([]).f), null, "no contract value, no tape");
});
