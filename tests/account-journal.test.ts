import assert from "node:assert/strict";
import test from "node:test";
import {
  attachFunding, buildJournal, cleanNote, dropDuplicates, futuresTrades, groupTrades, journalStats, mergeJFills, netOnDay, rMultiple,
  spotTrades, splitSymbol, tradesCsv, validateJFill, type JFill, type JTrade,
} from "../lib/account-journal.ts";

let seq = 0;
const fut = (time: number, side: "BUY" | "SELL", price: number, qty: number, o: Partial<JFill> = {}): JFill => ({
  id: `f${++seq}`, market: "futures", source: "live", time, symbol: "BTCUSDT", side, price, qty, fee: 0, feeAsset: "USDT",
  realizedPnl: null, positionSide: "BOTH", liquidation: false, ...o,
});
const spot = (time: number, side: "BUY" | "SELL", price: number, qty: number, o: Partial<JFill> = {}): JFill =>
  fut(time, side, price, qty, { market: "spot", source: "sync", symbol: "BTCUSDT", ...o });
const close = (a: number | null, b: number, eps = 1e-9) => assert.ok(a !== null && Math.abs(a - b) < eps, `${a} ≉ ${b}`);

// ─── futures ──────────────────────────────────────────────────────────────

test("a long: entry, exit, size, result and fees", () => {
  const [t] = futuresTrades([fut(1, "BUY", 100, 1, { fee: 0.1 }), fut(2, "SELL", 110, 1, { fee: 0.11 })]);
  assert.equal(t.direction, "LONG");
  assert.equal(t.status, "cerrada");
  assert.equal(t.entry, 100);
  assert.equal(t.exit, 110);
  assert.equal(t.qty, 1);
  close(t.gross, 10);
  close(t.fees, 0.21);
  close(t.net, 10 - 0.21);
  assert.equal(t.holdMs, 1);
});

test("Binance's own realised figure wins over the recomputed one", () => {
  const [t] = futuresTrades([fut(1, "BUY", 100, 1), fut(2, "SELL", 110, 1, { realizedPnl: 9.5 })]);
  close(t.gross, 9.5);
});

test("a short mirrors a long", () => {
  const [t] = futuresTrades([fut(1, "SELL", 100, 1), fut(2, "BUY", 90, 1)]);
  assert.equal(t.direction, "SHORT");
  close(t.gross, 10);
});

test("scaling in averages the entry; scaling out averages the exit; it stays one trade", () => {
  const scaleIn = futuresTrades([fut(1, "BUY", 100, 1), fut(2, "BUY", 110, 1), fut(3, "SELL", 120, 2)]);
  assert.equal(scaleIn.length, 1);
  assert.equal(scaleIn[0].entry, 105);
  close(scaleIn[0].gross, 30);
  assert.equal(scaleIn[0].qty, 2);
  const scaleOut = futuresTrades([fut(1, "BUY", 100, 2), fut(2, "SELL", 110, 1), fut(3, "SELL", 120, 1)]);
  assert.equal(scaleOut.length, 1);
  assert.equal(scaleOut[0].exit, 115);
  close(scaleOut[0].gross, 30);
});

test("a fill bigger than the position closes it and opens the other way, splitting the fee", () => {
  const trades = futuresTrades([fut(1, "BUY", 100, 1), fut(2, "SELL", 110, 3, { fee: 0.3 }), fut(3, "BUY", 100, 2)]).sort((a, b) => a.openTime - b.openTime);
  assert.equal(trades.length, 2);
  assert.equal(trades[0].direction, "LONG");
  close(trades[0].gross, 10);
  close(trades[0].fees, 0.1);
  assert.equal(trades[1].direction, "SHORT");
  assert.equal(trades[1].status, "cerrada");
  close(trades[1].gross, 20);
  close(trades[1].fees, 0.2);
});

test("on a flip, Binance's realised figure belongs to the closing part and is not prorated", () => {
  const trades = futuresTrades([fut(1, "BUY", 100, 1), fut(2, "SELL", 110, 3, { realizedPnl: 10 })]);
  const long = trades.find((t) => t.direction === "LONG")!;
  close(long.gross, 10);
  assert.equal(trades.find((t) => t.direction === "SHORT")!.status, "abierta");
});

test("hedge mode keeps the LONG and SHORT books apart", () => {
  const trades = futuresTrades([
    fut(1, "BUY", 100, 1, { positionSide: "LONG" }), fut(2, "SELL", 100, 1, { positionSide: "SHORT" }),
    fut(3, "SELL", 110, 1, { positionSide: "LONG" }), fut(4, "BUY", 90, 1, { positionSide: "SHORT" }),
  ]);
  assert.equal(trades.length, 2);
  const long = trades.find((t) => t.direction === "LONG")!;
  const short = trades.find((t) => t.direction === "SHORT")!;
  close(long.gross, 10);
  close(short.gross, 10);
});

test("a symbol never mixes with another", () => {
  const trades = futuresTrades([fut(1, "BUY", 100, 1), fut(2, "BUY", 10, 5, { symbol: "ETHUSDT" }), fut(3, "SELL", 110, 1), fut(4, "SELL", 12, 5, { symbol: "ETHUSDT" })]);
  assert.equal(trades.length, 2);
  close(trades.find((t) => t.symbol === "ETHUSDT")!.gross, 10);
});

test("a closing fill with no known opening becomes an INCOMPLETE trade with an estimated entry", () => {
  const [t] = futuresTrades([fut(5, "SELL", 110, 1, { realizedPnl: 10, fee: 0.1 })]);
  assert.equal(t.status, "incompleta");
  assert.equal(t.direction, "LONG");
  close(t.entry, 100);
  close(t.gross, 10);
  close(t.net, 9.9);
  assert.match(t.reason ?? "", /anterior al registro/);
});

test("a position still open is reported as open, with no result yet", () => {
  const [t] = futuresTrades([fut(1, "BUY", 100, 1)]);
  assert.equal(t.status, "abierta");
  assert.equal(t.net, null);
  assert.equal(t.closeTime, null);
});

test("fees in BNB are reported apart and never enter the result", () => {
  const [t] = futuresTrades([fut(1, "BUY", 100, 1, { fee: 0.5, feeAsset: "BNB" }), fut(2, "SELL", 110, 1, { fee: 0.1 })]);
  close(t.fees, 0.1);
  assert.deepEqual(t.feesOther, { BNB: 0.5 });
  close(t.net, 10 - 0.1);
});

test("a liquidation fill flags the trade", () => {
  const [t] = futuresTrades([fut(1, "BUY", 100, 1), fut(2, "SELL", 90, 1, { liquidation: true })]);
  assert.equal(t.liquidation, true);
  close(t.gross, -10);
});

test("funding lands on the trade open when it was charged; the rest is returned apart", () => {
  const trades = futuresTrades([fut(1, "BUY", 100, 1), fut(10, "SELL", 110, 1)]);
  const { trades: withFunding, unattributed } = attachFunding(trades, [
    { time: 5, symbol: "BTCUSDT", asset: "USDT", amount: -0.5 },
    { time: 50, symbol: "BTCUSDT", asset: "USDT", amount: -1 },
    { time: 5, symbol: null, asset: "USDT", amount: -2 },
    { time: 5, symbol: "BTCUSDT", asset: "BNB", amount: -3 },
  ]);
  close(withFunding[0].funding, -0.5);
  close(withFunding[0].net, 10 - 0.5);
  close(unattributed, -3);
});

test("PROPERTY: for random sequences that end flat, the trades' results add up to the fills' cash flow, in any input order", () => {
  let s = 12345;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let round = 0; round < 60; round += 1) {
    const fills: JFill[] = [];
    let net = 0;
    let t = 1;
    const steps = 3 + Math.floor(rnd() * 12);
    for (let i = 0; i < steps; i += 1) {
      const side = rnd() < 0.5 ? "BUY" : "SELL";
      const qty = (1 + Math.floor(rnd() * 5)) / 2;
      net += side === "BUY" ? qty : -qty;
      fills.push(fut(t++, side, 90 + Math.floor(rnd() * 2000) / 100, qty, { fee: rnd() < 0.5 ? 0.01 : 0 }));
    }
    if (Math.abs(net) > 1e-9) fills.push(fut(t++, net > 0 ? "SELL" : "BUY", 100, Math.abs(net)));
    const cash = fills.reduce((c, f) => c + (f.side === "SELL" ? 1 : -1) * f.price * f.qty, 0);
    const trades = futuresTrades(fills);
    assert.ok(trades.every((tr) => tr.status === "cerrada"), `round ${round}`);
    close(trades.reduce((sum, tr) => sum + (tr.gross as number), 0), cash, 1e-6);
    const shuffled = [...fills].sort(() => rnd() - 0.5);
    assert.deepEqual(futuresTrades(shuffled).map((tr) => tr.key).sort(), trades.map((tr) => tr.key).sort());
  }
});

// ─── spot ─────────────────────────────────────────────────────────────────

test("spot: average cost with fees in the quote asset", () => {
  const { trades } = spotTrades([spot(1, "BUY", 100, 1, { fee: 0.1 }), spot(2, "SELL", 110, 1, { fee: 0.11 })]);
  assert.equal(trades.length, 1);
  const t = trades[0];
  assert.equal(t.status, "cerrada");
  assert.equal(t.direction, "LONG");
  close(t.net, 9.79);
  close(t.fees, 0.21);
  close(t.gross, 10);
  assert.equal(t.entry, 100);
  assert.equal(t.exit, 110);
});

test("spot: a buy fee paid in the base asset shrinks the units held and raises their cost", () => {
  const { trades } = spotTrades([spot(1, "BUY", 100, 1, { fee: 0.001, feeAsset: "BTC" }), spot(2, "SELL", 110, 0.999, { fee: 0.1098 })]);
  assert.equal(trades[0].status, "cerrada");
  close(trades[0].net, 110 * 0.999 - 0.1098 - 100, 1e-9);
  close(trades[0].fees, 0.001 * 100 + 0.1098);
});

test("spot: partial sells realise against the average cost and keep the trade open until flat", () => {
  const first = spotTrades([spot(1, "BUY", 100, 2), spot(2, "SELL", 120, 1)]).trades;
  assert.equal(first[0].status, "abierta");
  close(first[0].net, 20);
  const done = spotTrades([spot(1, "BUY", 100, 2), spot(2, "SELL", 120, 1), spot(3, "SELL", 130, 1)]).trades;
  assert.equal(done[0].status, "cerrada");
  close(done[0].net, 50);
});

test("spot: selling more than the record shows was bought leaves the result unknown, and out of the statistics", () => {
  const orphan = spotTrades([spot(1, "SELL", 110, 1)]).trades[0];
  assert.equal(orphan.status, "incompleta");
  assert.equal(orphan.net, null);
  const over = spotTrades([spot(1, "BUY", 100, 1), spot(2, "SELL", 110, 2)]).trades[0];
  assert.equal(over.status, "incompleta");
  assert.equal(over.net, null);
  assert.equal(journalStats([orphan, over]).count, 0);
});

test("spot: dust left after selling everything still closes the trade; a real remainder doesn't", () => {
  assert.equal(spotTrades([spot(1, "BUY", 100, 1), spot(2, "SELL", 110, 0.9975)]).trades[0].status, "cerrada");
  assert.equal(spotTrades([spot(1, "BUY", 100, 1), spot(2, "SELL", 110, 0.9)]).trades[0].status, "abierta");
});

test("spot: a new position after a closed one is a separate trade", () => {
  const { trades } = spotTrades([spot(1, "BUY", 100, 1), spot(2, "SELL", 110, 1), spot(3, "BUY", 50, 1), spot(4, "SELL", 40, 1)]);
  assert.equal(trades.length, 2);
  assert.deepEqual(trades.map((t) => Math.round(t.net as number)).sort((a, b) => a - b), [-10, 10]);
});

test("spot: coin-quoted pairs are left out, not converted", () => {
  const { trades, excluded } = spotTrades([spot(1, "BUY", 0.05, 1, { symbol: "ETHBTC" }), spot(2, "SELL", 0.06, 1, { symbol: "ETHBTC" })]);
  assert.equal(trades.length, 0);
  assert.deepEqual(excluded, ["ETHBTC"]);
});

test("spot: fees in BNB go apart", () => {
  const t = spotTrades([spot(1, "BUY", 100, 1, { fee: 0.01, feeAsset: "BNB" }), spot(2, "SELL", 110, 1)]).trades[0];
  assert.deepEqual(t.feesOther, { BNB: 0.01 });
  close(t.net, 10);
});

test("symbols split into base and quote", () => {
  assert.deepEqual(splitSymbol("BTCUSDT"), { base: "BTC", quote: "USDT" });
  assert.deepEqual(splitSymbol("BNBFDUSD"), { base: "BNB", quote: "FDUSD" });
  assert.deepEqual(splitSymbol("ETHBTC"), { base: "ETH", quote: "BTC" });
  assert.equal(splitSymbol("USDT"), null);
});

// ─── merging ──────────────────────────────────────────────────────────────

test("an imported fill that matches a live one within a second is dropped; a genuinely different one stays", () => {
  const live = [fut(10_000, "BUY", 100, 1, { id: "live1" })];
  const incoming = [
    fut(10_800, "BUY", 100, 1, { id: "imp1", source: "import" }),
    fut(10_800, "BUY", 101, 1, { id: "imp2", source: "import" }),
    fut(90_000, "BUY", 100, 1, { id: "imp3", source: "import" }),
  ];
  assert.deepEqual(dropDuplicates(live, incoming).map((f) => f.id), ["imp2", "imp3"]);
});

test("each existing fill absorbs one incoming fill: two identical genuine fills against one recorded leave one", () => {
  const live = [fut(10_000, "SELL", 100, 1, { id: "live1" })];
  const incoming = [fut(10_100, "SELL", 100, 1, { id: "a", source: "import" }), fut(10_100, "SELL", 100, 1, { id: "b", source: "import" })];
  assert.deepEqual(dropDuplicates(live, incoming).map((f) => f.id), ["b"]);
});

test("merge keeps one fill per market and id, the first source winning", () => {
  const a = fut(1, "BUY", 100, 1, { id: "same" });
  const b = fut(1, "BUY", 999, 1, { id: "same", source: "import" });
  const merged = mergeJFills([a], [b]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].price, 100);
});

// ─── stats ────────────────────────────────────────────────────────────────

const trade = (net: number | null, closeTime: number, o: Partial<JTrade> = {}): JTrade => ({
  key: `k${closeTime}`, market: "futures", symbol: "BTCUSDT", direction: "LONG", status: "cerrada", reason: null, openTime: closeTime - 10, closeTime,
  entry: 100, exit: 110, qty: 1, gross: net, fees: 0, feesOther: {}, funding: 0, net, liquidation: false, fills: [], holdMs: 10, ...o,
});

test("statistics: rate, profit factor, expectancy, payoff, streaks and drawdown, by hand", () => {
  const trades = [10, -5, 10, -20, 5].map((n, i) => trade(n, i + 1));
  const s = journalStats(trades);
  assert.equal(s.count, 5);
  assert.equal(s.winRate, 0.6);
  assert.equal(s.profitFactor, 1);
  assert.equal(s.expectancy, 0);
  close(s.avgWin, 25 / 3);
  assert.equal(s.avgLoss, 12.5);
  close(s.payoff, 25 / 3 / 12.5);
  assert.equal(s.maxDrawdown, 20);
  assert.deepEqual(s.equity.map((p) => p.cum), [10, 5, 15, -5, 0]);
  assert.equal(s.longestWin, 1);
  assert.equal(s.longestLoss, 1);
  assert.deepEqual(s.currentStreak, { count: 1, kind: "ganadora" });
  assert.equal(s.confidence, "MUESTRA MÍNIMA");
  assert.equal(s.best?.net, 10);
  assert.equal(s.worst?.net, -20);
});

test("statistics: longest runs, and a zero result breaks a streak", () => {
  const s = journalStats([1, 1, 1, 0, 1, -1, -1, -1, -1, 1].map((n, i) => trade(n, i + 1)));
  assert.equal(s.longestWin, 3);
  assert.equal(s.longestLoss, 4);
  assert.deepEqual(s.currentStreak, { count: 1, kind: "ganadora" });
});

test("statistics: open trades and trades with an unknown result are not counted", () => {
  const s = journalStats([trade(10, 1), trade(null, 2), trade(5, 3, { status: "abierta", closeTime: null }), trade(4, 4, { status: "incompleta" })]);
  assert.equal(s.count, 2);
  assert.equal(s.net, 14);
});

test("statistics: profit factor with no losses is infinite; with no trades it is nothing, not zero", () => {
  assert.equal(journalStats([trade(3, 1)]).profitFactor, Infinity);
  const empty = journalStats([]);
  assert.equal(empty.profitFactor, null);
  assert.equal(empty.winRate, null);
  assert.equal(empty.confidence, "SIN MUESTRA");
});

test("statistics: 15 counted trades is a reasonable sample", () => {
  assert.equal(journalStats(Array.from({ length: 15 }, (_, i) => trade(1, i + 1))).confidence, "MUESTRA RAZONABLE");
});

test("R multiple: result over what the stop would have lost, and only with a stop on the right side", () => {
  const long = trade(20, 1, { entry: 100, qty: 2 });
  close(rMultiple(long, 90), 20 / (10 * 2));
  assert.equal(rMultiple(long, 110), null);
  assert.equal(rMultiple(long, null), null);
  const short = trade(20, 1, { direction: "SHORT", entry: 100, qty: 1 });
  close(rMultiple(short, 110), 2);
  assert.equal(rMultiple(short, 90), null);
  const s = journalStats([long, short], (k) => (k === long.key ? 90 : null));
  assert.equal(s.rCount, 1);
  close(s.avgR, 1);
});

test("groups: by symbol with profit factor; net by day", () => {
  const trades = [trade(10, 1), trade(-4, 2), trade(6, 3, { symbol: "ETHUSDT" })];
  const g = groupTrades(trades, (t) => t.symbol);
  assert.deepEqual(g.map((x) => [x.key, x.count, x.net]).sort(), [["BTCUSDT", 2, 6], ["ETHUSDT", 1, 6]]);
  assert.equal(g.find((x) => x.key === "BTCUSDT")!.profitFactor, 2.5);
  assert.equal(netOnDay(trades, "d", () => "d"), 12);
  assert.equal(netOnDay(trades, "x", () => "d"), 0);
});

test("buildJournal joins futures, funding and spot, newest first", () => {
  const fills = [fut(1, "BUY", 100, 1), fut(2, "SELL", 110, 1), spot(3, "BUY", 50, 1, { symbol: "SOLUSDT" }), spot(4, "SELL", 60, 1, { symbol: "SOLUSDT" }), spot(5, "BUY", 1, 1, { symbol: "ETHBTC" })];
  const out = buildJournal(fills, [{ time: 1.5, symbol: "BTCUSDT", asset: "USDT", amount: -1 }]);
  assert.deepEqual(out.trades.map((t) => t.market + t.symbol), ["spotSOLUSDT", "futuresBTCUSDT"]);
  assert.equal(out.trades[1].funding, -1);
  assert.deepEqual(out.excludedSpot, ["ETHBTC"]);
});

// ─── validation, notes, csv ───────────────────────────────────────────────

test("validation accepts a real fill and refuses malformed ones", () => {
  const now = Date.UTC(2026, 8, 29);
  const good = fut(Date.UTC(2026, 8, 20), "BUY", 100, 1);
  assert.deepEqual(validateJFill(JSON.parse(JSON.stringify(good)), now), good);
  const bad: Record<string, unknown>[] = [
    { ...good, market: "options" }, { ...good, source: "x" }, { ...good, symbol: "btc" }, { ...good, price: 0 }, { ...good, qty: -1 },
    { ...good, fee: -1 }, { ...good, time: 5 }, { ...good, time: now + 5 * 86_400_000 }, { ...good, positionSide: "UP" }, { ...good, liquidation: "no" },
    { ...good, realizedPnl: "1" }, { ...good, id: "" },
  ];
  for (const b of bad) assert.equal(validateJFill(b, now), null, JSON.stringify(b).slice(0, 60));
  assert.notEqual(validateJFill({ ...good, realizedPnl: null }, now), null);
});

test("notes: trims, caps, and refuses nonsense", () => {
  const n = cleanNote({ stop: 90, setup: "ruptura", emotion: "calma", rating: 4, tags: [" a ", "", "b"], notes: "ok" })!;
  assert.deepEqual(n.tags, ["a", "b"]);
  assert.equal(n.stop, 90);
  assert.equal(cleanNote({ stop: -1 }), null);
  assert.equal(cleanNote({ rating: 9 }), null);
  assert.equal(cleanNote({ setup: 5 }), null);
  assert.equal(cleanNote("x"), null);
  assert.equal(cleanNote({ notes: "x".repeat(5000) })!.notes.length, 2000);
  assert.equal(cleanNote({ tags: Array.from({ length: 30 }, (_, i) => `t${i}`) })!.tags.length, 10);
});

test("CSV: header, decimal comma, R from the planned stop, formulas neutralised", () => {
  const t = trade(20, 2_000, { entry: 100, qty: 2 });
  const csv = tradesCsv([t], (x) => `T${x}`, () => ({ stop: 90, setup: "=cmd", emotion: "", rating: 3, tags: ["a", "b"], notes: 'dijo "hola"; bien' }));
  const [head, line] = csv.replace("\uFEFF", "").trimEnd().split("\r\n");
  assert.ok(head.startsWith("Mercado;Par;Dirección;Estado;"));
  assert.ok(line.includes(";1;"), "R = 1");
  assert.ok(line.includes(";'=cmd;"));
  assert.ok(line.includes('"dijo ""hola""; bien"'));
});
