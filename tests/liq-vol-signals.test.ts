import assert from "node:assert/strict";
import test from "node:test";
import { findLvSignals, flushSeries, lvStats, resolveLv, type LvTrade } from "../lib/liq-vol-signals.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const M = 60_000;
const flat = (i: number, o: Partial<SwingCandle> = {}): SwingCandle => ({ openTime: i * M, open: 100, high: 100.5, low: 99.5, close: 100.2, volume: 100, quoteVolume: 0, ...o });
/** A swing low at 35 (98), swept at 45 (wick 97,5, close 99) on 4× volume; target candle at `targetAt`. */
function scenario(o: { sweepVolume?: number; sweepClose?: number; targetAt?: number | null; n?: number } = {}): SwingCandle[] {
  const n = o.n ?? 80;
  return Array.from({ length: n }, (_, i) => {
    if (i === 35) return flat(i, { low: 98 });
    if (i === 45) return flat(i, { open: 99.3, high: 99.6, low: 97.5, close: o.sweepClose ?? 99, volume: o.sweepVolume ?? 400 });
    if (o.targetAt !== null && i === (o.targetAt ?? 50)) return flat(i, { high: 103 });
    return flat(i);
  });
}
const mirror = (cs: SwingCandle[]) => cs.map((c) => ({ ...c, open: 200 - c.open, close: 200 - c.close, high: 200 - c.low, low: 200 - c.high }));

test("a swept swing low, closed back above on high volume, is a LONG with stop beyond the wick and target at 2R", () => {
  const [s] = findLvSignals(scenario());
  assert.equal(s.index, 45);
  assert.equal(s.side, "LONG");
  assert.equal(s.level, 98);
  assert.equal(s.entry, 99);
  assert.ok(s.stop < 97.5 && s.stop > 97.3, `stop ${s.stop}`);
  assert.ok(Math.abs(s.target - (s.entry + 2 * s.risk)) < 1e-9);
  assert.ok(Math.abs(s.rvol - 4) < 1e-9);
  assert.equal(s.flushRatio, null, "no liquidation model given");
});

test("no signal without the volume, or when the candle closes below the level (that is a breakdown)", () => {
  assert.deepEqual(findLvSignals(scenario({ sweepVolume: 140 })), []);
  assert.deepEqual(findLvSignals(scenario({ sweepClose: 97.8 })), []);
});

test("a swept swing high is the mirror-image SHORT", () => {
  const [s] = findLvSignals(mirror(scenario()));
  assert.equal(s.side, "SHORT");
  assert.equal(s.level, 102);
  assert.ok(s.stop > 102.5);
  assert.ok(Math.abs(s.target - (s.entry - 2 * s.risk)) < 1e-9);
});

test("liquidations: the wick must flush at least the recent average; without the model the filter is skipped", () => {
  const cs = scenario();
  const base = { long: new Array(cs.length).fill(10), short: new Array(cs.length).fill(10) };
  const weak = { ...base, long: base.long.map((v, i) => (i === 45 ? 5 : v)) };
  const strong = { ...base, long: base.long.map((v, i) => (i === 45 ? 30 : v)) };
  assert.deepEqual(findLvSignals(cs, { flush: weak }), []);
  const [s] = findLvSignals(cs, { flush: strong });
  assert.ok(Math.abs((s.flushRatio as number) - 3) < 1e-9);
  assert.equal(findLvSignals(cs, { flush: null }).length, 1);
  assert.deepEqual(findLvSignals(cs, { flush: { long: new Array(cs.length).fill(0), short: base.short } }), [], "no liquidations known at all: no signal");
});

test("resolution: target, stop, both in one candle counts as stop, time exit, still open — all net of fees", () => {
  const hit = resolveLv(scenario(), findLvSignals(scenario()))[0];
  assert.equal(hit.result, "OBJETIVO");
  assert.equal(hit.exitIndex, 50);
  assert.ok((hit.r as number) < 2 && (hit.r as number) > 1.8, "2R minus fees");
  const stopped = scenario({ targetAt: null });
  stopped[48] = flat(48, { low: 97 });
  const st = resolveLv(stopped, findLvSignals(stopped))[0];
  assert.equal(st.result, "STOP");
  assert.ok((st.r as number) < -1);
  const both = scenario({ targetAt: null });
  both[48] = flat(48, { low: 97, high: 104 });
  assert.equal(resolveLv(both, findLvSignals(both))[0].result, "STOP", "worst case first");
  const timed = resolveLv(scenario({ targetAt: null }), findLvSignals(scenario({ targetAt: null })))[0];
  assert.equal(timed.result, "TIEMPO");
  assert.equal(timed.exitIndex, 45 + 24);
  const open = resolveLv(scenario({ targetAt: null, n: 55 }), findLvSignals(scenario({ targetAt: null, n: 55 })))[0];
  assert.equal(open.result, "ABIERTA");
  assert.equal(open.r, null);
});

test("statistics: win rate, profit factor, expectancy and sample label", () => {
  const t = (r: number | null): LvTrade => ({ signal: findLvSignals(scenario())[0], result: r === null ? "ABIERTA" : r > 0 ? "OBJETIVO" : "STOP", exitIndex: null, exitPrice: null, r });
  const s = lvStats([t(2), t(-1), t(-1), t(1.5), t(null)]);
  assert.equal(s.resolved, 4);
  assert.equal(s.open, 1);
  assert.equal(s.winRate, 0.5);
  assert.equal(s.profitFactor, 3.5 / 2);
  assert.equal(s.expectancyR, 1.5 / 4);
  assert.equal(s.confidence, "MUESTRA MÍNIMA");
  assert.equal(lvStats([]).profitFactor, null);
  assert.equal(lvStats([t(1)]).profitFactor, Infinity);
});

test("NO LOOKAHEAD: signals up to a cut are identical with or without the candles after it", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let events = 0;
  for (let round = 0; round < 6; round += 1) {
    let p = 100;
    const cs: SwingCandle[] = Array.from({ length: 400 }, (_, i) => {
      const o = p;
      p = p * (1 + (rnd() - 0.5) * 0.02);
      return { openTime: i * M, open: o, close: p, high: Math.max(o, p) * (1 + rnd() * 0.006), low: Math.min(o, p) * (1 - rnd() * 0.006), volume: 50 + rnd() * (rnd() < 0.1 ? 900 : 150), quoteVolume: 0 };
    });
    const flush = { long: cs.map(() => rnd() * 10), short: cs.map(() => rnd() * 10) };
    for (const withFlush of [false, true]) {
      const full = findLvSignals(cs, withFlush ? { flush } : {});
      for (const cut of [120, 200, 333]) {
        const part = findLvSignals(cs.slice(0, cut), withFlush ? { flush: { long: flush.long.slice(0, cut), short: flush.short.slice(0, cut) } } : {});
        assert.deepEqual(part, full.filter((s) => s.index < cut));
        events += part.length;
      }
    }
  }
  assert.ok(events > 20, `only ${events} signals exercised`);
});

test("liquidations are summed per sweeping candle and side", () => {
  const f = flushSeries([0, M, 2 * M], [
    { side: "long", weight: 2, sweptTime: M }, { side: "long", weight: 3, sweptTime: M }, { side: "short", weight: 4, sweptTime: 2 * M },
    { side: "long", weight: 9, sweptTime: null }, { side: "short", weight: 9, sweptTime: 99 * M },
  ]);
  assert.deepEqual(f, { long: [0, 5, 0], short: [0, 0, 4] });
});
