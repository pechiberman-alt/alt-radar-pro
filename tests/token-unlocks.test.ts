import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUnlockBoard,
  classifyAudience,
  parseUnlock,
} from "../lib/token-unlocks.ts";

const NOW = Date.UTC(2026, 8, 18);
const inDays = (n: number) => NOW + n * 86_400_000;

const entry = (patch: Record<string, unknown> = {}) => ({
  name: "Ejemplo",
  token: "EJ",
  tPrice: 2,
  mcap: 1_000_000_000,
  nextEvent: { date: inDays(10) / 1000, toUnlock: 5_000_000, category: "investors" },
  ...patch,
});

test("recipient categories map to the groups that behave differently", () => {
  assert.equal(classifyAudience("investors"), "INVERSORES");
  assert.equal(classifyAudience("Private Sale"), "INVERSORES");
  assert.equal(classifyAudience("team"), "EQUIPO");
  assert.equal(classifyAudience("Core Contributors"), "EQUIPO");
  assert.equal(classifyAudience("ecosystem incentives"), "ECOSISTEMA");
  assert.equal(classifyAudience("airdrop"), "ECOSISTEMA");
  assert.equal(classifyAudience(undefined), "OTROS");
});

test("an unlock is parsed with its dilution relative to market cap", () => {
  const unlock = parseUnlock(entry(), NOW, new Set());
  assert.ok(unlock);
  assert.equal(unlock.symbol, "EJ");
  assert.equal(unlock.daysAway, 10);
  assert.equal(unlock.valueUsd, 10_000_000);
  // 10M of a 1B cap is 1%.
  assert.ok(Math.abs((unlock.pctOfMcap ?? 0) - 1) < 1e-9);
  assert.equal(unlock.audience, "INVERSORES");
});

test("seconds and milliseconds timestamps both resolve to the same date", () => {
  const seconds = parseUnlock(entry({ nextEvent: { date: inDays(5) / 1000 } }), NOW, new Set());
  const millis = parseUnlock(entry({ nextEvent: { date: inDays(5) } }), NOW, new Set());
  assert.equal(seconds?.date, millis?.date);
});

test("a record with no usable date is skipped rather than defaulted", () => {
  // Inventing a date on a sell-pressure calendar would be worse than a gap.
  assert.equal(parseUnlock(entry({ nextEvent: {} }), NOW, new Set()), null);
  assert.equal(parseUnlock({ name: "Sin fecha" }, NOW, new Set()), null);
  assert.equal(parseUnlock(null, NOW, new Set()), null);
});

test("events already past are not listed as upcoming", () => {
  assert.equal(parseUnlock(entry({ nextEvent: { date: inDays(-3) / 1000 } }), NOW, new Set()), null);
});

test("watchlist matching strips the pair suffix and Binance's 1000x prefix", () => {
  const board = buildUnlockBoard(
    [entry({ token: "PEPE" }), entry({ token: "SOL" }), entry({ token: "ZZZ" })],
    ["1000PEPEUSDT", "SOLUSDT"],
    NOW,
  );
  assert.ok(board);
  assert.deepEqual(
    board.watched.map((u) => u.symbol).sort(),
    ["PEPE", "SOL"],
  );
  assert.equal(board.upcoming.length, 3, "los demás siguen listados, sólo no están marcados");
});

test("unlocks are ordered soonest first and bounded by the horizon", () => {
  const board = buildUnlockBoard(
    [
      entry({ token: "A", nextEvent: { date: inDays(40) / 1000, toUnlock: 1 } }),
      entry({ token: "B", nextEvent: { date: inDays(2) / 1000, toUnlock: 1 } }),
      entry({ token: "C", nextEvent: { date: inDays(400) / 1000, toUnlock: 1 } }),
    ],
    [],
    NOW,
  );
  assert.ok(board);
  assert.deepEqual(board.upcoming.map((u) => u.symbol), ["B", "A"]);
  assert.equal(board.projectsScanned, 3, "se informa el total escaneado, no sólo lo que entró");
});

test("a payload that is not a list, or has nothing ahead, yields nothing", () => {
  assert.equal(buildUnlockBoard({ error: "pro plan required" }, [], NOW), null);
  assert.equal(buildUnlockBoard([], [], NOW), null);
  assert.equal(
    buildUnlockBoard([entry({ nextEvent: { date: inDays(-1) / 1000 } })], [], NOW),
    null,
  );
});

test("missing price or cap degrades to nulls instead of fake figures", () => {
  const noPrice = parseUnlock(entry({ tPrice: undefined }), NOW, new Set());
  assert.equal(noPrice?.valueUsd, null);
  assert.equal(noPrice?.pctOfMcap, null);
  assert.equal(noPrice?.tokens, 5_000_000, "lo que sí se sabe se conserva");
});
