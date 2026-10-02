import assert from "node:assert/strict";
import test from "node:test";
import { buildLevels, referenceSources, replayLevels, roundSources, sourcesAt, volumeProfile, type LevelSource } from "../lib/level-engine.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const DAY = 86_400_000;
const c = (t: number, o: number, h: number, l: number, cl: number, v = 1): SwingCandle => ({ openTime: t, open: o, high: h, low: l, close: cl, volume: v, quoteVolume: 0 });
const MON = Date.UTC(2026, 8, 21); // Monday 21 September 2026

test("day and week references: yesterday's range, today's open, last week's range, this week's open", () => {
  // Two full weeks of days, then Monday to Wednesday of the current week; it's Wednesday noon.
  const days: SwingCandle[] = [];
  for (let d = 0; d < 17; d += 1) days.push(c(MON + d * DAY, 100 + d, 110 + d, 90 + d, 101 + d));
  const now = MON + 16 * DAY + DAY / 2;
  const src = Object.fromEntries(referenceSources(days, now).map((s) => [s.kind, s.price]));
  assert.equal(src.PDH, 110 + 15, "Tuesday's high");
  assert.equal(src.PDL, 90 + 15);
  assert.equal(src.DO, 100 + 16, "Wednesday's open");
  assert.equal(src.PWH, 110 + 13, "highest high of last Monday–Sunday (days 7–13)");
  assert.equal(src.PWL, 90 + 7);
  assert.equal(src.WO, 100 + 14, "this Monday's open");
});

test("references never use a day that has not closed by `now`", () => {
  const days = [c(MON, 100, 110, 90, 105), c(MON + DAY, 105, 130, 70, 120), c(MON + 2 * DAY, 120, 125, 115, 121)];
  const src = Object.fromEntries(referenceSources(days, MON + DAY + 1000).map((s) => [s.kind, s.price]));
  assert.equal(src.PDH, 110, "yesterday is Monday; Tuesday is still open");
  assert.equal(src.DO, 105);
});

test("volume profile: POC where most volume traded, value area around it", () => {
  const candles = [
    ...Array.from({ length: 40 }, (_, i) => c(i, 100, 101, 99, 100, 50)),
    ...Array.from({ length: 10 }, (_, i) => c(40 + i, 110, 112, 108, 110, 2)),
  ];
  const p = volumeProfile(candles)!;
  assert.ok(Math.abs(p.poc - 100) < 0.5, `POC ${p.poc}`);
  assert.ok(p.val < 99.6 && p.vah > 100.4 && p.vah < 108, `VA ${p.val}–${p.vah}`);
  assert.equal(volumeProfile(candles.slice(0, 5)), null, "too few candles");
});

test("round numbers near price, by importance, without repeats", () => {
  const r = roundSources(2698);
  const prices = r.map((s) => s.price);
  assert.ok(prices.includes(2700) && prices.includes(2600) && prices.includes(2800));
  assert.equal(new Set(prices).size, prices.length);
  assert.ok(r.every((s) => Math.abs(s.price / 2698 - 1) <= 0.06));
  assert.equal(roundSources(84_000).find((s) => s.price === 80_000)?.weight, 1.5, "a multiple of ten thousand on BTC weighs most");
});

const S = (kind: string, price: number, weight: number): LevelSource => ({ kind, label: kind, price, weight });

test("reasons within tolerance become one level; one weight per kind; stars from the score", () => {
  const levels = buildLevels([S("S/R 1h", 100, 1), S("S/R 1h", 100.2, 1.5), S("PDH", 100.1, 2), S("POC", 99.95, 2), S("REDONDO", 100, 0.5), S("PWL", 95, 3), S("PDL", 95.1, 2), S("POC", 95.2, 2)], 98, 1);
  const r = levels.find((l) => l.kind === "RESISTENCIA")!;
  assert.deepEqual(r.sources.map((s) => s.kind).sort(), ["PDH", "POC", "REDONDO", "S/R 1h"]);
  assert.equal(r.score, 1.5 + 2 + 2 + 0.5, "two structure hits on the same frame count once, at the stronger weight");
  assert.equal(r.stars, 3);
  const s = levels.find((l) => l.kind === "SOPORTE")!;
  assert.equal(s.score, 7);
  assert.ok(Math.abs(s.distancePct - (s.price / 98 - 1) * 100) < 1e-9);
});

test("a lone round number is not a level, and far levels are left out", () => {
  const levels = buildLevels([S("REDONDO", 99, 1.5), S("S/R 4h", 150, 3), S("PDL", 97, 2)], 98, 1);
  assert.deepEqual(levels.map((l) => l.sources[0].kind), ["PDL"]);
  assert.equal(levels[0].stars, 1);
});

test("at most N per side, the strongest, then nearest first", () => {
  const src = [S("S/R 1h", 101, 1), S("PDH", 102, 2), S("PWH", 103, 3), S("POC", 104, 2)];
  const levels = buildLevels(src, 100, 0.2, { perSide: 2 });
  // PWH (3) is strongest; PDH and POC tie at 2 and the nearer one wins; then nearest first.
  assert.deepEqual(levels.map((l) => l.sources[0].kind), ["PDH", "PWH"]);
});

function range(n: number): SwingCandle[] {
  // A market oscillating between ~100 and ~110 with clear turns.
  const out: SwingCandle[] = [];
  for (let i = 0; i < n; i += 1) {
    const phase = (i % 20) / 20;
    const mid = 105 + 5 * Math.sin(phase * 2 * Math.PI);
    out.push(c(i * 3_600_000, mid - 0.3, mid + 0.6, mid - 0.6, mid + 0.3, 10 + (i % 7)));
  }
  return out;
}

test("sources at a time ignore candles that had not closed by then", () => {
  const cs = range(300);
  const H = 3_600_000;
  const at = cs[200].openTime + H;
  const full = sourcesAt({ current: { frame: "1h", candles: cs, frameMs: H, weight: 1 }, higher: [], daily: null, now: at });
  const cut = sourcesAt({ current: { frame: "1h", candles: cs.slice(0, 201), frameMs: H, weight: 1 }, higher: [], daily: null, now: at });
  assert.deepEqual(full, cut);
});

test("replay: levels are rebuilt over time and their first touches resolved into held or broke", () => {
  const H = 3_600_000;
  const buckets = replayLevels({ current: { frame: "1h", candles: range(400), frameMs: H, weight: 1 }, higher: [], daily: null });
  assert.deepEqual(buckets.map((b) => b.stars), [1, 2, 3]);
  const touched = buckets.reduce((s, b) => s + b.touched, 0);
  assert.ok(touched > 10, `only ${touched} touches`);
  for (const b of buckets) {
    assert.ok(b.held + b.broke <= b.touched);
    if (b.rate !== null) assert.ok(b.rate >= 0 && b.rate <= 1);
  }
});
