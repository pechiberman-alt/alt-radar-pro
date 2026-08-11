import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the branded Spanish application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]*lang="es"/i);
  assert.match(html, /ALT RADAR PRO/i);
  assert.match(html, /Inteligencia de Mercado Cripto/i);
  assert.match(html, /manifest\.webmanifest/i);
  assert.match(html, /og\.png/i);
  assert.doesNotMatch(html, /Your site is taking shape|codex-preview/i);
});

test("keeps persistent signal history and automation wired", async () => {
  const [schema, worker, route, hosting, manifest] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/signals/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
  ]);

  assert.match(schema, /signalRecords/);
  assert.match(schema, /return24h/);
  assert.match(worker, /scheduled/);
  assert.match(worker, /runSignalAutomation/);
  assert.match(route, /VALIDATION|readLedger|runSignalAutomation/i);
  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.equal(JSON.parse(manifest).lang, "es");
});

test("contains the requested ownership and safety language", async () => {
  const [app, layout] = await Promise.all([
    readFile(new URL("../app/radar-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(app, /© 2026 URL\.FX/);
  assert.match(app, /escenarios probabilísticos/i);
  assert.match(app, /DATA UNAVAILABLE/);
  assert.match(layout, /creator: "URL\.FX"/);
});

test("wires real performance metrics and redundant global intelligence", async () => {
  const [signalsRoute, ledger, news, radarRoute] = await Promise.all([
    readFile(new URL("../app/api/signals/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/signal-ledger.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/news-intelligence.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/radar/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(signalsRoute, /gross_profit_4h/i);
  assert.match(signalsRoute, /profitFactor4h/i);
  assert.match(ledger, /WIN RATE 4H/);
  assert.match(ledger, /PROFIT FACTOR 4H/);
  assert.match(news, /Dow Jones World RSS/);
  assert.match(news, /BBC World RSS/);
  assert.match(news, /clusterEvents/);
  assert.match(radarRoute, /loadGlobalNews/);
});

test("wires the zero-token market brain, real timeframes and auditable learning", async () => {
  const [engine, route, panel, schema] = await Promise.all([
    readFile(new URL("../lib/market-brain.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/brain/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/market-brain.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);

  assert.match(engine, /\["5m", "15m", "1h", "4h", "1d"\]/);
  assert.match(engine, /theoreticalLiquidationZones/);
  assert.match(route, /Binance Futures public API/);
  assert.match(route, /walk-forward/i);
  assert.match(route, /ON CONFLICT\(id\) DO NOTHING/);
  assert.match(panel, /0 TOKENS/);
  assert.match(panel, /DATA INSUFICIENTE/);
  assert.match(panel, /forceOrder/);
  assert.match(schema, /brainObservations/);
  assert.match(schema, /directionalReturn/);
});

test("adds real Bookmap timeframes and horizon performance without fabricated stats", async () => {
  const [chart, performance, automation, schema] = await Promise.all([
    readFile(new URL("../app/bookmap-timeframe-chart.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/performance/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/automation.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);

  assert.match(chart, /MARKET STRUCTURE · KLINES REALES/);
  assert.match(chart, /WIN RATE/);
  assert.match(chart, /PROFIT FACTOR/);
  assert.match(chart, /BRAIN_TIMEFRAMES\.map/);
  assert.match(performance, /COUNT\(return_5m\)/);
  assert.match(performance, /profitFactorInfinite/);
  assert.match(performance, /DATA INSUFICIENTE/);
  assert.match(automation, /elapsed <= 20 \* 60_000/);
  assert.match(schema, /return5m/);
});
