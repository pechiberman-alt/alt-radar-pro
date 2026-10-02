import assert from "node:assert/strict";
import test from "node:test";
import { findInducements, idmStats, type Inducement } from "../lib/inducement.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const c = (i: number, o: number, h: number, l: number, cl: number): SwingCandle => ({ openTime: i, open: o, high: h, low: l, close: cl, volume: 1, quoteVolume: 0 });
/** Candle drifting from a to b. */
const step = (i: number, a: number, b: number) => c(i, a, Math.max(a, b) + 0.2, Math.min(a, b) - 0.2, b);

/**
 * Uptrend: swing high 105 at 10, dip to 100, BOS at 20 (close 106), push to 108,
 * pullback low 104,5 at 26 (the inducement), up again, then:
 *   "continue": sweep of 104,5 at 32 and a new high above 108
 *   "fail":     sweep, then a close below the leg origin (100)
 *   "pending":  never comes back to 104,5
 */
function uptrend(ending: "continue" | "fail" | "pending"): SwingCandle[] {
  const p: number[] = [];
  for (let k = 0; k <= 10; k += 1) p.push(100 + k * 0.5); // to 105 at 10
  for (let k = 1; k <= 5; k += 1) p.push(105 - k); // to 100 at 15
  for (let k = 1; k <= 5; k += 1) p.push(100 + k * 1.2); // 106 at 20 (BOS)
  p.push(107, 108, 107, 106, 105, 104.7, 105.6, 106.4, 107.2); // high 108 at 22, IDM low at 26
  if (ending === "continue") p.push(106.5, 105.5, 104, 106, 107.5, 109, 110, 111);
  if (ending === "fail") p.push(106.5, 105.5, 104, 102, 100.5, 99, 98, 97);
  if (ending === "pending") p.push(108, 109, 110, 111, 112, 113, 114, 115);
  for (let k = 0; k < 12; k += 1) p.push(p[p.length - 1] + (ending === "fail" ? -0.3 : 0.3));
  const cs = p.map((v, i) => (i === 0 ? c(0, v, v + 0.2, v - 0.2, v) : step(i, p[i - 1], v)));
  // Make the turns real turns: a swing must stick out past both neighbours.
  cs[10] = { ...cs[10], high: cs[10].high + 0.5 }; // swing high 105,7
  cs[15] = { ...cs[15], low: cs[15].low - 0.5 }; // dip low 99,3 (leg origin)
  cs[22] = { ...cs[22], high: cs[22].high + 0.5 }; // leg high 108,7
  cs[26] = { ...cs[26], low: cs[26].low - 0.3 }; // inducement 104,2
  return cs;
}
const mirror = (cs: SwingCandle[]) => cs.map((x) => ({ ...x, open: 300 - x.open, close: 300 - x.close, high: 300 - x.low, low: 300 - x.high }));
const firstUp = (cs: SwingCandle[]) => findInducements(cs).find((x) => x.side === "ALCISTA" && x.bosIndex === 20)!;

test("bullish: BOS on the close above the swing high, the first real pullback is the IDM, swept, then continuation", () => {
  const idm = firstUp(uptrend("continue"));
  assert.ok(idm, "found");
  assert.ok(Math.abs(idm.brokenLevel - 105.7) < 0.01, `broke ${idm.brokenLevel}`);
  assert.ok(Math.abs(idm.legOrigin - 99.3) < 0.01, "leg origin is the dip low (100 − 0,2 wick − 0,5 bump)");
  assert.equal(idm.idmIndex, 26);
  assert.ok(Math.abs(idm.level - 104.2) < 0.01, `IDM ${idm.level}`);
  assert.ok(idm.sweptIndex !== null && idm.sweptIndex > 26);
  assert.equal(idm.outcome, "CONTINUÓ");
});

test("swept and then structure failed: a close below the leg origin", () => {
  assert.equal(firstUp(uptrend("fail")).outcome, "FALLÓ");
});

test("not swept yet: pending, no outcome", () => {
  const idm = firstUp(uptrend("pending"));
  assert.equal(idm.sweptIndex, null);
  assert.equal(idm.outcome, null);
});

test("the mirror image is a bearish inducement with the same reading", () => {
  const down = findInducements(mirror(uptrend("continue"))).find((x) => x.side === "BAJISTA" && x.bosIndex === 20)!;
  assert.equal(down.idmIndex, 26);
  assert.ok(Math.abs(down.level - (300 - 104.2)) < 0.01);
  assert.equal(down.outcome, "CONTINUÓ");
});

test("a pullback smaller than a quarter ATR is noise, not an inducement", () => {
  const strict = findInducements(uptrend("continue"), { minDepthAtr: 50 }).find((x) => x.bosIndex === 20);
  assert.equal(strict, undefined);
});

test("NO LOOKAHEAD: later candles never move a BOS or an IDM, only their status", () => {
  let seed = 3;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let seen = 0;
  for (let round = 0; round < 5; round += 1) {
    let v = 100;
    const cs = Array.from({ length: 500 }, (_, i) => {
      const o = v;
      v = v * (1 + (rnd() - 0.48) * 0.02);
      return c(i, o, Math.max(o, v) * (1 + rnd() * 0.004), Math.min(o, v) * (1 - rnd() * 0.004), v);
    });
    const key = (x: Inducement) => `${x.side}|${x.bosIndex}|${x.idmIndex}|${x.level}`;
    const full = findInducements(cs);
    for (const cut of [150, 300, 420]) {
      // Within the cut, an IDM is only known once the candle after it closed.
      const part = findInducements(cs.slice(0, cut)).map(key);
      const expected = full.filter((x) => x.idmIndex + 1 < cut).map(key);
      assert.deepEqual(part, expected);
      seen += part.length;
    }
  }
  assert.ok(seen > 30, `only ${seen} inducements exercised`);
});

test("stats count only resolved ones and carry the sample label", () => {
  const mk = (outcome: Inducement["outcome"]): Inducement => ({ side: "ALCISTA", bosIndex: 0, brokenLevel: 1, legOrigin: 0, idmIndex: 1, level: 1, sweptIndex: outcome ? 2 : null, outcome });
  const s = idmStats([mk("CONTINUÓ"), mk("CONTINUÓ"), mk("FALLÓ"), mk("SIN RESOLVER"), mk(null)]);
  assert.deepEqual(s, { resolved: 3, continued: 2, failed: 1, rate: 2 / 3, confidence: "MUESTRA MÍNIMA" });
  assert.equal(idmStats([]).rate, null);
});
