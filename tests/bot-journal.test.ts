import assert from "node:assert/strict";
import test from "node:test";
import {
  journalCsv, journalKey, journalRowFrom, journalSummary, mergeJournal, validateJournalRow, type JournalRow,
} from "../lib/bot-journal.ts";
import type { PaperTrade } from "../lib/paper-bot.ts";

const T = Date.UTC(2026, 8, 20, 12, 0, 0);
const trade = (p: Partial<PaperTrade> = {}): PaperTrade => ({
  id: "BTCUSDT-1-COMPRA", symbol: "BTCUSDT", side: "COMPRA", entryTime: T, entry: 100, stop: 99, target: 101.5,
  qty: 10, notional: 1000, leverage: 10, margin: 100, liqPrice: 90.5, riskUsd: 10, status: "win", barsHeld: 3,
  exitTime: T + 900_000, exit: 101.5, pnl: 13.99, r: 1.399, fees: 1.01, timeframe: "5m", ...p,
});
const row = (p: Partial<JournalRow> = {}): JournalRow => ({ ...journalRowFrom(trade(), T - 86_400_000)!, ...p });
const month = (t: number) => new Date(t).toISOString().slice(0, 7);
const iso = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ");

test("a closed trade becomes a row carrying everything the report needs; an open one doesn't", () => {
  const r = journalRowFrom(trade(), 5)!;
  assert.equal(r.runStartedAt, 5);
  assert.equal(r.timeframe, "5m");
  assert.equal(r.pnl, 13.99);
  assert.equal(r.note, null);
  assert.equal(journalRowFrom(trade({ status: "open", exit: undefined, exitTime: undefined, pnl: undefined }), 5), null);
  assert.equal(journalRowFrom(trade({ timeframe: undefined }), 5)!.timeframe, null, "trades from before the field existed");
});

test("the key includes the account start: the same trade id after a reset is a different trade", () => {
  assert.notEqual(journalKey(row({ runStartedAt: 1 })), journalKey(row({ runStartedAt: 2 })));
  assert.equal(mergeJournal([row({ runStartedAt: 1 })], [row({ runStartedAt: 2 })]).length, 2);
});

test("merge keeps one row per key — the first source wins — sorted by close time", () => {
  const a = row({ id: "a", exitTime: T + 2 });
  const b = row({ id: "b", exitTime: T + 1 });
  const merged = mergeJournal([a, b], [row({ id: "a", exitTime: T + 2, pnl: 999 })]);
  assert.deepEqual(merged.map((r) => r.id), ["b", "a"]);
  assert.equal(merged.find((r) => r.id === "a")!.pnl, 13.99);
});

test("validation accepts a real row as is", () => {
  const good = row();
  assert.deepEqual(validateJournalRow(JSON.parse(JSON.stringify(good)), T + 86_400_000), good);
});

test("validation refuses anything malformed rather than repairing it", () => {
  const now = T + 86_400_000;
  const bad: Partial<Record<keyof JournalRow, unknown>>[] = [
    { symbol: "btc/usdt" }, { symbol: "" }, { side: "LONG" }, { status: "open" }, { id: "" }, { id: "x".repeat(81) },
    { pnl: Number.NaN }, { entry: 0 }, { qty: -1 }, { leverage: 0 }, { leverage: 200 }, { fees: -1 },
    { exitTime: T - 1 }, { entryTime: 5 }, { exitTime: now + 2 * 86_400_000 }, { timeframe: "5 minutos" }, { note: 42 },
  ];
  for (const patch of bad) assert.equal(validateJournalRow({ ...row(), ...patch }, now), null, JSON.stringify(patch));
  for (const junk of [null, "row", 1, []]) assert.equal(validateJournalRow(junk, now), null);
});

test("validation trims an over-long note instead of storing an essay", () => {
  assert.equal(validateJournalRow({ ...row(), note: "n".repeat(500) }, T + 86_400_000)!.note!.length, 200);
});

test("summary: counts, rate, profit factor, net, fees, best and worst", () => {
  const rows = [row({ id: "1", pnl: 20, fees: 1 }), row({ id: "2", pnl: -10, fees: 1, status: "loss" }), row({ id: "3", pnl: 5, fees: 1, status: "timeout" }), row({ id: "4", pnl: -5, fees: 1, status: "news" })];
  const s = journalSummary(rows, month);
  assert.equal(s.count, 4);
  assert.equal(s.profitable, 2);
  assert.equal(s.winRate, 0.5);
  assert.equal(s.profitFactor, 25 / 15);
  assert.equal(s.net, 10);
  assert.equal(s.fees, 4);
  assert.equal(s.best!.id, "1");
  assert.equal(s.worst!.id, "2");
  assert.deepEqual(s.byStatus, { win: 1, loss: 1, timeout: 1, news: 1 });
});

test("summary: groups by symbol (most traded first) and by month (newest first)", () => {
  const rows = [
    row({ id: "1", symbol: "ETHUSDT", exitTime: Date.UTC(2026, 7, 5) }),
    row({ id: "2", symbol: "BTCUSDT", exitTime: Date.UTC(2026, 8, 5), pnl: -4 }),
    row({ id: "3", symbol: "BTCUSDT", exitTime: Date.UTC(2026, 8, 6), pnl: 6 }),
  ];
  const s = journalSummary(rows, month);
  assert.deepEqual(s.bySymbol.map((g) => [g.key, g.count, g.net]), [["BTCUSDT", 2, 2], ["ETHUSDT", 1, 13.99]]);
  assert.equal(s.bySymbol[0].profitFactor, 1.5);
  assert.equal(s.bySymbol[1].profitFactor, Infinity);
  assert.deepEqual(s.byMonth.map((g) => g.key), ["2026-09", "2026-08"]);
});

test("summary of nothing is empty, not zeros pretending to be results", () => {
  const s = journalSummary([], month);
  assert.equal(s.count, 0);
  assert.equal(s.winRate, null);
  assert.equal(s.profitFactor, null);
  assert.equal(s.best, null);
});

test("CSV: BOM, semicolons, decimal comma, one line per trade plus the header", () => {
  const csv = journalCsv([row(), row({ id: "2", pnl: -3.5, r: -0.35, status: "loss" })], iso);
  assert.ok(csv.startsWith("\uFEFFApertura;Cierre;Par;Lado;Marco;Apalancamiento;"));
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines.length, 3);
  const cells = lines[1].split(";");
  assert.equal(cells[0], "2026-09-20 12:00");
  assert.equal(cells[2], "BTCUSDT");
  assert.equal(cells[5], "10");
  assert.equal(cells[12], "13,99");
  assert.equal(cells[15], "Objetivo");
  assert.equal(lines[2].split(";")[12], "-3,5", "a negative number stays a number");
  assert.equal(lines[2].split(";")[15], "Stop");
});

test("CSV: text that could break a column or run as a formula is neutralised", () => {
  const csv = journalCsv([row({ note: 'Cerrada; "antes"' }), row({ id: "2", note: "=HYPERLINK(1)" })], iso);
  const [, first, second] = csv.trimEnd().split("\r\n");
  assert.ok(first.includes('"Cerrada; ""antes"""'));
  assert.ok(second.includes(";'=HYPERLINK(1);"));
});
