import assert from "node:assert/strict";
import test from "node:test";
import { keyLevels } from "../lib/key-levels.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const c = (i: number, high: number, low: number, close = (high + low) / 2): SwingCandle => ({ openTime: i, open: close, high, low, close, volume: 1, quoteVolume: 0 });

/** Price oscillating in a 100–110 range: turns at ~110 and ~100 several times, ending at `end`. */
function range(touches: number, end = 105): SwingCandle[] {
  const out: SwingCandle[] = [];
  let i = 0;
  for (let k = 0; k < touches; k += 1) {
    for (const mid of [103, 104, 105, 106, 107, 108]) out.push(c(i++, mid + 1, mid - 1));
    out.push(c(i++, 110 + (k % 2) * 0.2, 107));
    for (const mid of [107, 106, 105, 104, 103, 102]) out.push(c(i++, mid + 1, mid - 1));
    out.push(c(i++, 103, 100 - (k % 2) * 0.2));
  }
  for (const mid of [102, 103, 104]) out.push(c(i++, mid + 1, mid - 1));
  out.push(c(i++, end + 0.5, end - 0.5, end));
  return out;
}

test("a range turned at 110 and 100 four times: strong resistance above, strong support below", () => {
  const levels = keyLevels(range(4));
  const r = levels.find((l) => l.kind === "RESISTENCIA")!;
  const s = levels.find((l) => l.kind === "SOPORTE")!;
  assert.ok(Math.abs(r.price - 110.1) < 0.2, `R ${r.price}`);
  assert.ok(Math.abs(s.price - 99.9) < 0.2, `S ${s.price}`);
  assert.equal(r.touches, 4);
  assert.equal(s.touches, 4);
  assert.equal(r.strength, "FUERTE");
  assert.ok(r.distancePct > 0 && s.distancePct < 0);
  assert.ok(r.low <= r.price && r.high >= r.price);
});

test("two turns make a weak level; one turn is not a level", () => {
  const two = keyLevels(range(2));
  assert.equal(two.find((l) => l.kind === "RESISTENCIA")!.strength, "DÉBIL");
  assert.deepEqual(keyLevels(range(1)), []);
});

test("which side a level is on depends only on where price closed", () => {
  const above = keyLevels(range(3, 111.5));
  assert.equal(above.find((l) => Math.abs(l.price - 110.1) < 0.3)!.kind, "SOPORTE", "price above the old ceiling: it is now a floor");
});

test("a level turned from both sides is marked as having changed role", () => {
  const out = range(3);
  let i = out.length;
  // From below: price comes back up to 100 and turns down there (a high at the old low).
  for (const mid of [96, 97, 98]) out.push(c(i++, mid + 1, mid - 1));
  out.push(c(i++, 100.05, 97));
  for (const mid of [97, 96, 95, 94]) out.push(c(i++, mid + 1, mid - 1));
  const s = keyLevels(out).find((l) => Math.abs(l.price - 100) < 0.5)!;
  assert.equal(s.kind, "RESISTENCIA", "price now below it");
  assert.equal(s.flipped, true);
});

test("at most N per side, nearest first; unusable input gives nothing", () => {
  const levels = keyLevels(range(4), { perSide: 1 });
  assert.equal(levels.filter((l) => l.kind === "RESISTENCIA").length, 1);
  assert.equal(levels.filter((l) => l.kind === "SOPORTE").length, 1);
  assert.deepEqual(keyLevels([]), []);
  assert.deepEqual(keyLevels(Array.from({ length: 40 }, (_, k) => c(k, 100, 100))), [], "no range, no ATR");
});
