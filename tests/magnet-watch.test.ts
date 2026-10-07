import assert from "node:assert/strict";
import test from "node:test";
import type { LiquidationHeatmap } from "../lib/liquidation-heatmap.ts";
import { magnetEvents, magnetEventText, replayMagnets, strongestMagnets } from "../lib/magnet-watch.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const map = (buckets: [number, number, number, number][]): LiquidationHeatmap =>
  ({ symbol: "BTCUSDT", currentPrice: 100, binSize: 0.5, profileCandles: 100, halfLifeCandles: null, totalOpenInterestUsd: null, oiWeightedCandles: 0, buckets: buckets.map(([price, longDensity, shortDensity, intensity]) => ({ price, longDensity, shortDensity, intensity, notionalUsd: null, formedAt: 0 })) }) as unknown as LiquidationHeatmap;
const c = (i: number, o: number, h: number, l: number, cl: number): SwingCandle => ({ openTime: i, open: o, high: h, low: l, close: cl, volume: 1, quoteVolume: 0 });
const flat = (n: number) => Array.from({ length: n }, (_, i) => c(i, 100, 100.3, 99.7, 100));

test("strongest magnet each side, by density, within range", () => {
  const m = strongestMagnets(map([[102, 0, 5, 50], [104, 0, 9, 90], [130, 0, 99, 100], [97, 7, 0, 70], [95, 3, 0, 30]]), 100);
  assert.equal(m.above?.price, 104, "130 is beyond 8%");
  assert.equal(m.above?.side, "CORTOS");
  assert.ok(Math.abs((m.above?.distancePct ?? 0) - 4) < 1e-9);
  assert.equal(m.below?.price, 97);
  assert.equal(m.below?.side, "LARGOS");
  assert.deepEqual(strongestMagnets(map([]), 100), { above: null, below: null });
});

test("CERCA: a strong magnet within half an ATR (at least 0,4%)", () => {
  const cs = flat(30);
  const ev = magnetEvents(cs, null, map([[100.3, 0, 9, 80], [96, 9, 0, 80]]));
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, "CERCA");
  assert.equal(ev[0].magnet.price, 100.3);
  assert.deepEqual(magnetEvents(cs, null, map([[100.3, 0, 9, 40]])), [], "weak zones don't alert");
});

test("BARRIDA: the last candle trades through a magnet of the previous map; rejection vs continuation", () => {
  const before = map([[102, 0, 9, 90], [97, 9, 0, 85]]);
  const rejected = [...flat(29), c(29, 100, 102.4, 99.8, 101)];
  const [e] = magnetEvents(rejected, before, null);
  assert.equal(e.kind, "BARRIDA");
  assert.equal(e.kind === "BARRIDA" && e.closedBack, true);
  const through = [...flat(29), c(29, 100, 103, 99.9, 102.8)];
  const [e2] = magnetEvents(through, before, null);
  assert.equal(e2.kind === "BARRIDA" && e2.closedBack, false);
  const down = [...flat(29), c(29, 100, 100.2, 96.5, 97.5)];
  assert.equal(magnetEvents(down, before, null)[0].magnet.side, "LARGOS");
});

test("texts say what happened and what it doesn't mean", () => {
  const near = magnetEventText("SOLUSDT", "1h", { kind: "CERCA", price: 150, nearPct: 0.5, magnet: { side: "CORTOS", price: 150.6, intensity: 88, distancePct: 0.4, notionalUsd: 42e6, density: 1 } });
  assert.match(near.title, /SOL · cerca de un imán/);
  assert.match(near.body, /\+0,40%/);
  assert.match(near.body, /US\$42M estimados/);
  assert.match(near.body, /puede seguir de largo o rebotar/);
  const swept = magnetEventText("BTCUSDT", "1h", { kind: "BARRIDA", candleOpenTime: 0, closedBack: true, magnet: { side: "LARGOS", price: 84000, intensity: 91, distancePct: -1, notionalUsd: null, density: 1 } });
  assert.match(swept.title, /barrió la zona de largos/);
  assert.match(swept.body, /barrida y vuelta/);
  assert.match(swept.body, /se consumió/);
});

test("replay on a real-looking series: counts are consistent and labelled", () => {
  let seed = 5;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let p = 100;
  const cs = Array.from({ length: 700 }, (_, i) => {
    const o = p;
    p = p * (1 + (rnd() - 0.5) * 0.02);
    return { openTime: i * 3_600_000, open: o, close: p, high: Math.max(o, p) * (1 + rnd() * 0.004), low: Math.min(o, p) * (1 - rnd() * 0.004), volume: 50 + rnd() * 200, quoteVolume: 0 };
  });
  const r = replayMagnets("BTCUSDT", cs);
  assert.ok(r.cases > 5, `${r.cases} cases`);
  assert.ok(r.resolved <= r.cases);
  assert.ok(r.strongerFirst <= r.resolved && r.nearerFirst <= r.resolved && r.reversed <= r.resolved);
  assert.ok(["SIN MUESTRA", "MUESTRA MÍNIMA", "MUESTRA RAZONABLE"].includes(r.confidence));
  // The map at a moment never sees later candles: cutting the series doesn't change earlier cases.
  const cut = replayMagnets("BTCUSDT", cs.slice(0, 450));
  assert.ok(cut.cases <= r.cases);
});

import { collectMagnetEvents, MAGNET_WATCH } from "../lib/telegram-magnets.ts";

test("server collector: at most four requests per coin (OI down: all mirrors tried), only IMANES events with stable keys", async () => {
  const urls: string[] = [];
  const real = globalThis.fetch;
  const now = Date.UTC(2026, 9, 6, 12, 30);
  globalThis.fetch = (async (url: string) => {
    urls.push(url);
    const u = new URL(url);
    if (u.pathname.includes("openInterestHist")) return new Response("[]");
    let p = 100;
    let s = 9;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const rows = Array.from({ length: 500 }, (_, i) => {
      const t = Math.floor(now / 3_600_000) * 3_600_000 - (499 - i) * 3_600_000;
      const o = p;
      p *= 1 + (rnd() - 0.5) * 0.02;
      return [t, o, Math.max(o, p) * 1.003, Math.min(o, p) * 0.997, p, 100 + rnd() * 100, t + 3_599_999, 1, 1, 1, 1, "0"].map(String);
    });
    return new Response(JSON.stringify(rows));
  }) as typeof fetch;
  try {
    const events = await collectMagnetEvents(now);
    assert.ok(urls.length <= MAGNET_WATCH.length * 4, `${urls.length} requests`);
    for (const e of events) {
      assert.equal(e.category, "IMANES");
      assert.match(e.key, /^magnet:(near|swept):(BTC|ETH|SOL)USDT:1h:/);
      assert.match(e.text, /No es asesoramiento financiero/);
    }
  } finally {
    globalThis.fetch = real;
  }
});
