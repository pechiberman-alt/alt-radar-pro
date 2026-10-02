import assert from "node:assert/strict";
import test from "node:test";
import { eligible, readCoin, replayDecoupling, scanDecoupled, type HourCandle, type Series } from "../lib/decoupling.ts";

const H = 3_600_000;
const N = 100;
/** A series from a close path; volume 1000 per hour unless given. */
function series(symbol: string, closes: number[], vols?: number[]): Series {
  return { symbol, candles: closes.map((c, i): HourCandle => ({ time: i * H, close: c, high: c * 1.001, low: c * 0.999, quoteVolume: vols?.[i] ?? 1000 })) };
}
/** Gently noisy flat path so beta and correlation are defined. */
function flat(seed: number, n = N, level = 100): number[] {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  return Array.from({ length: n }, () => level * (1 + (rnd() - 0.5) * 0.002));
}
const btc = series("BTCUSDT", flat(1));
const eth = series("ETHUSDT", flat(2));
const last = (N - 1) * H;

test("a coin up 3% in 4 hours on volume while BTC and ETH sit flat rises on its own", () => {
  const path = flat(3);
  for (let k = 0; k < 4; k += 1) path[N - 4 + k] = path[N - 5] * (1 + 0.0075 * (k + 1));
  const vols = Array.from({ length: N }, (_, i) => (i >= N - 4 ? 3000 : 1000));
  const r = readCoin(series("SOLUSDT", path, vols), btc, eth, last)!;
  assert.ok(r.ret > 2.9 && r.ret < 3.1, `ret ${r.ret}`);
  assert.ok(Math.abs(r.btcRet) < 0.3);
  assert.ok(r.alpha > 2.5);
  assert.ok(r.rvol !== null && Math.abs(r.rvol - 3) < 0.05, `rvol ${r.rvol}`);
  assert.equal(r.sustained, 1, "beat BTC every hour");
  assert.ok(r.oneCandle < 0.3, "spread over the hours");
  assert.equal(r.qualifies, true);
});

test("when BTC itself is up, rising with it is not rising alone", () => {
  const b = flat(1);
  const c = flat(3);
  for (let k = 0; k < 4; k += 1) {
    b[N - 4 + k] = b[N - 5] * (1 + 0.005 * (k + 1));
    c[N - 4 + k] = c[N - 5] * (1 + 0.0075 * (k + 1));
  }
  const r = readCoin(series("SOLUSDT", c), series("BTCUSDT", b), eth, last)!;
  assert.ok(r.btcRet > 1.9);
  assert.equal(r.qualifies, false);
});

test("beta comes from the hours before the window: a high-beta coin's alpha discounts what BTC explains", () => {
  // Coin moves 2× BTC for 72 h before the window; in the window BTC drops 1% and the coin rises 1%.
  const b = flat(1);
  const c: number[] = b.map((_v, i) => (i === 0 ? 100 : 0));
  for (let i = 1; i < N; i += 1) c[i] = c[i - 1] * (1 + 2 * (b[i] / b[i - 1] - 1));
  for (let k = 0; k < 4; k += 1) {
    b[N - 4 + k] = b[N - 5] * (1 - 0.0025 * (k + 1));
    c[N - 4 + k] = c[N - 5] * (1 + 0.0025 * (k + 1));
  }
  const r = readCoin(series("XUSDT", c), series("BTCUSDT", b), eth, last, { minRet: 0.5 })!;
  assert.ok(r.beta !== null && Math.abs(r.beta - 2) < 0.05, `beta ${r.beta}`);
  assert.ok(r.corr !== null && r.corr > 0.99);
  assert.ok(Math.abs(r.alpha - (r.ret - (r.beta as number) * r.btcRet)) < 1e-9, "alpha uses the estimated beta");
  assert.ok(r.alpha > 2.9, "up 1% while beta says it should be down 2%");
});

test("a pump in one candle is flagged as such", () => {
  const c = flat(3);
  c[N - 4] = c[N - 5];
  c[N - 3] = c[N - 5];
  c[N - 2] = c[N - 5] * 1.04;
  c[N - 1] = c[N - 2];
  const r = readCoin(series("PUMPUSDT", c), btc, eth, last)!;
  assert.ok(r.oneCandle > 0.9);
  assert.ok(r.sustained <= 0.25, "flat hours are not strength, even if BTC dipped");
});

test("missing hours or too little history: no reading instead of a wrong one", () => {
  const holes = series("HOLEUSDT", flat(3));
  holes.candles.splice(N - 3, 1);
  assert.equal(readCoin(holes, btc, eth, last), null, "a gap inside the window");
  const short = series("NEWUSDT", flat(3, 10));
  assert.equal(readCoin({ symbol: "NEWUSDT", candles: short.candles.map((x) => ({ ...x, time: x.time + (N - 10) * H })) }, btc, eth, last)?.beta, null);
});

test("the scan lists only eligible coins that qualify, strongest first, and says when the market is up", () => {
  const strong = flat(3);
  const mild = flat(4);
  for (let k = 0; k < 4; k += 1) {
    strong[N - 4 + k] = strong[N - 5] * (1 + 0.01 * (k + 1));
    mild[N - 4 + k] = mild[N - 5] * (1 + 0.005 * (k + 1));
  }
  const s = scanDecoupled([series("AUSDT", mild), series("BUSDT", strong), series("USDCUSDT", strong), series("CUSDT", flat(5))], btc, eth)!;
  assert.deepEqual(s.rising.map((r) => r.symbol), ["BUSDT", "AUSDT"]);
  assert.equal(s.marketUp, false);
  assert.ok(!s.leaders.some((r) => r.symbol === "USDCUSDT"), "stablecoins never read");
});

test("eligible: no BTC/ETH, stables, leveraged tokens or metals", () => {
  assert.equal(eligible("SOLUSDT"), true);
  for (const s of ["BTCUSDT", "ETHUSDT", "USDCUSDT", "FDUSDUSDT", "BTCUPUSDT", "XAUUSDT", "SOLBTC"]) assert.equal(eligible(s), false, s);
});

test("replay: a long run is counted in non-overlapping forward windows, not once per qualifying hour", () => {
  // A coin rising alone for 10 hours in a flat market, then flat.
  const c = flat(3, 120);
  const b = series("BTCUSDT", flat(1, 120));
  const e = series("ETHUSDT", flat(2, 120));
  for (let k = 0; k < 10; k += 1) c[90 + k] = c[89] * (1 + 0.006 * (k + 1));
  for (let k = 100; k < 120; k += 1) c[k] = c[99];
  const qualifyingHours = Array.from({ length: 30 }, (_, k) => 85 + k).filter((t) => readCoin(series("RUNUSDT", c), b, e, t * H)?.qualifies).length;
  assert.equal(qualifyingHours, 9);
  const stats = replayDecoupling([series("RUNUSDT", c)], b, e, { forward: 4 });
  assert.equal(stats.instances, 3, "hours 92, 96 and 100");
  assert.ok(stats.followed >= 2, "the first two windows kept rising");
  assert.equal(stats.confidence, "MUESTRA MÍNIMA");
  assert.equal(replayDecoupling([], b, e).rate, null);
});

test("NO LOOKAHEAD: a reading at hour t is the same with or without the hours after it", () => {
  const c = flat(9, 120);
  for (let k = 0; k < 8; k += 1) c[95 + k] = c[94] * (1 + 0.004 * (k + 1));
  const full = series("ZUSDT", c);
  const B = series("BTCUSDT", flat(1, 120));
  const E = series("ETHUSDT", flat(2, 120));
  for (const t of [80, 97, 101]) {
    const cut = (s: Series) => ({ symbol: s.symbol, candles: s.candles.slice(0, t + 1) });
    assert.deepEqual(readCoin(cut(full), cut(B), cut(E), t * H), readCoin(full, B, E, t * H));
  }
});

test("a one-candle pump on thin volume ranks below a steady rise on volume, even if it rose more", () => {
  const steady = flat(3);
  const pump = flat(4);
  for (let k = 0; k < 4; k += 1) steady[N - 4 + k] = steady[N - 5] * (1 + 0.008 * (k + 1));
  pump[N - 4] = pump[N - 5];
  pump[N - 3] = pump[N - 5];
  pump[N - 2] = pump[N - 5] * 1.05;
  pump[N - 1] = pump[N - 2];
  const vols = (hot: number) => Array.from({ length: N }, (_, i) => (i >= N - 4 ? hot : 1000));
  const s = scanDecoupled([series("PUMPUSDT", pump, vols(600)), series("STEADYUSDT", steady, vols(3000))], btc, eth)!;
  assert.deepEqual(s.rising.map((r) => r.symbol), ["STEADYUSDT", "PUMPUSDT"]);
});
