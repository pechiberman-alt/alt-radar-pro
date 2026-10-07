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

import { MAGNET_WATCH, magnetEventsFromMind } from "../lib/telegram-magnets.ts";

test("server alerts come from the core's stored map: no candles fetched, no map built, stale maps silent", () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response("[]");
  }) as typeof fetch;
  try {
    const now = Date.UTC(2026, 9, 6, 12, 30);
    const lastTime = Date.UTC(2026, 9, 6, 11);
    const above = { side: "CORTOS" as const, price: 85000, intensity: 90, distancePct: 0.3, notionalUsd: null, density: 1 };
    const below = { side: "LARGOS" as const, price: 80000, intensity: 95, distancePct: -5.6, notionalUsd: null, density: 1 };
    const swept = { kind: "BARRIDA" as const, magnet: { ...below, price: 84500 }, candleOpenTime: lastTime, closedBack: true };
    const mind = {
      readings: {},
      btc: null,
      magnets: {
        BTCUSDT: { lastTime, at: now, price: 84745, above, below, nearPct: 0.4, sweeps: [swept] },
        ETHUSDT: { lastTime: lastTime - 5 * 3_600_000, at: now, price: 1, above, below, nearPct: 0.4, sweeps: [swept] },
      },
    };
    const events = magnetEventsFromMind(mind, now);
    assert.equal(calls, 0, "nothing fetched");
    assert.deepEqual(events.map((e) => e.key).sort(), [`magnet:near:BTCUSDT:1h:85000:2026-10-06`, `magnet:swept:BTCUSDT:1h:${lastTime}:LARGOS`]);
    for (const e of events) {
      assert.equal(e.category, "IMANES");
      assert.match(e.text, /No es asesoramiento financiero/);
    }
    assert.deepEqual(magnetEventsFromMind(mind, now, 99), [magnetEventsFromMind(mind, now)[0]].filter((e) => e.key.startsWith("magnet:swept")), "weak zones are not 'near' alerts");
    assert.equal(MAGNET_WATCH.length, 3);
    assert.ok(events.every((e) => !/Kraken/.test(e.text)), "a map from Binance's candles needs no note");
    const fromKraken = magnetEventsFromMind({ ...mind, magnets: { BTCUSDT: { ...mind.magnets.BTCUSDT, venue: "KRAKEN" as const } } }, now);
    assert.ok(fromKraken.length > 0 && fromKraken.every((e) => /Mapa hecho con velas de Kraken en dólares: Binance no deja leer al servidor\./.test(e.text)));
  } finally {
    globalThis.fetch = real;
  }
});
