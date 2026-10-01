import assert from "node:assert/strict";
import test from "node:test";
import { fetchKlinesServer, marketOf } from "../lib/klines-server.ts";
import { createdMessage, normalizeSymbol, parseTarget, px } from "../lib/price-alerts.ts";
import { fetchSpotPrice } from "../lib/price-alerts-server.ts";
import { collectVolumeEvents, framesFor } from "../lib/telegram-volume.ts";

function capture(respond: (u: URL) => Response) {
  const urls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    urls.push(url);
    return respond(new URL(url));
  }) as typeof fetch;
  return { urls, restore: () => { globalThis.fetch = real; } };
}

test("gold and silver by any common name, and real coins untouched", () => {
  for (const name of ["xau", "XAUUSD", "oro", "Gold", "xau/usdt"]) assert.equal(normalizeSymbol(name), "XAUUSDT", name);
  for (const name of ["xag", "plata", "silver"]) assert.equal(normalizeSymbol(name), "XAGUSDT", name);
  assert.equal(normalizeSymbol("btc"), "BTCUSDT");
  assert.equal(normalizeSymbol("paxg"), "PAXGUSDT", "the tokenised gold coin stays itself");
});

test("the metals live on the futures API; everything else on spot", () => {
  assert.equal(marketOf("XAUUSDT"), "futures");
  assert.equal(marketOf("XAGUSDT"), "futures");
  assert.equal(marketOf("BTCUSDT"), "spot");
});

test("gold prices keep their cents and both writing habits work", () => {
  assert.equal(px(4123.5), "4.123,5");
  assert.equal(px(4123.55), "4.123,55");
  assert.equal(px(90_000), "90.000");
  assert.equal(parseTarget("4.200", 4_120), 4_200);
  assert.equal(parseTarget("4200,5", 4_120), 4_200.5);
  assert.equal(parseTarget("4,123.50", 4_120), 4_123.5);
});

test("a gold alert says where its price comes from and what that implies", () => {
  const m = createdMessage({ symbol: "XAUUSDT", target: 4_200, direction: "ARRIBA" }, 4_120);
  assert.match(m, /XAU ↑ 4\.200/);
  assert.match(m, /perpetuo XAUUSDT de Binance/);
  assert.match(m, /de tu broker/);
  assert.doesNotMatch(createdMessage({ symbol: "BTCUSDT", target: 90_000, direction: "ARRIBA" }, 85_000), /perpetuo/);
});

test("candles and price for gold are requested from the futures API", async () => {
  const c = capture((u) =>
    u.pathname.endsWith("/ticker/price")
      ? new Response(JSON.stringify({ price: "4120.35" }))
      : new Response(JSON.stringify([[0, "1", "1", "1", "1", "1", 1, "1", 1, "0", "0", "0"]])),
  );
  try {
    await fetchKlinesServer("XAUUSDT", "1m", { limit: 5 });
    assert.equal(await fetchSpotPrice("XAUUSDT"), 4120.35);
    await fetchKlinesServer("BTCUSDT", "1m", { limit: 5 });
    assert.match(c.urls[0], /^https:\/\/fapi\.binance\.com\/fapi\/v1\/klines\?symbol=XAUUSDT/);
    assert.match(c.urls[1], /^https:\/\/fapi\.binance\.com\/fapi\/v1\/ticker\/price\?symbol=XAUUSDT/);
    assert.match(c.urls[2], /\/api\/v3\/klines\?symbol=BTCUSDT/);
  } finally {
    c.restore();
  }
});

test("volume: gold is watched on 1h and 4h only, through the futures API", async () => {
  assert.deepEqual(framesFor("XAUUSDT").map((f) => f.interval), ["1h", "4h"]);
  assert.deepEqual(framesFor("BTCUSDT").map((f) => f.interval), ["15m", "1h", "4h"]);
  const c = capture(() => new Response("[]"));
  try {
    await collectVolumeEvents(Date.now());
    const gold = c.urls.filter((u) => u.includes("symbol=XAUUSDT"));
    assert.ok(gold.length >= 2 && gold.every((u) => u.includes("/fapi/v1/klines")));
    assert.ok(!gold.some((u) => u.includes("interval=15m")));
  } finally {
    c.restore();
  }
});
