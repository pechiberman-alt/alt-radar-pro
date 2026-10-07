import assert from "node:assert/strict";
import test from "node:test";
import { arNumber, forAi, parseLevel } from "../lib/ai-numbers.ts";

test("numbers reach the AIs already written the Argentine way", () => {
  assert.equal(arNumber(82920.4), "82.920");
  assert.equal(arNumber(108121.5), "108.122", "every digit of a six-figure price is kept");
  assert.equal(arNumber(2462.5), "2.462,5");
  assert.equal(arNumber(1075), "1.075");
  assert.equal(arNumber(116.1134), "116,11");
  assert.equal(arNumber(11.0664), "11,066", "the AVAX level the model once wrote as 11.066,4");
  assert.equal(arNumber(1.14618), "1,1462");
  assert.equal(arNumber(0.70421), "0,70421");
  assert.equal(arNumber(0.00001234), "0,00001234");
  assert.equal(arNumber(-2.99), "-2,99");
  assert.equal(arNumber(-0), "0");
});

test("forAi converts every number but times, and leaves the rest alone", () => {
  const now = Date.UTC(2026, 9, 7, 18, 17);
  const out = forAi({ at: now, m: "AVAX", precio: 11.0664, sop: [11.0664, 10.782], c24: -2.99, ok: true, nada: null, inf: Infinity, closedAt: 1_791_397, hora: { openTime: 5 }, capUsd: 2.85e12 });
  assert.deepEqual(out, { at: now, m: "AVAX", precio: "11,066", sop: ["11,066", "10,782"], c24: "-2,99", ok: true, nada: null, inf: null, closedAt: 1_791_397, hora: { openTime: 5 }, capUsd: 2.85e12 });
});

test("a level written back is read in either notation, the one near the price winning", () => {
  assert.equal(parseLevel(11.07, 11), 11.07);
  assert.equal(parseLevel("11,066", 11), 11.066);
  assert.equal(parseLevel("11.07", 11), 11.07, "English notation from a model that slipped");
  assert.equal(parseLevel("82.920", 83_000), 82_920);
  assert.equal(parseLevel("2.462,5", 2_450), 2462.5);
  assert.equal(parseLevel("2,462.5", 2_450), 2462.5);
  assert.equal(parseLevel("0,7042", 0.7), 0.7042);
  assert.equal(parseLevel("$ 189,5 USD.", 180), 189.5);
  assert.equal(parseLevel("nivel", 180), null);
  assert.equal(parseLevel(-3, 180), null);
  assert.equal(parseLevel(null, 180), null);
});
