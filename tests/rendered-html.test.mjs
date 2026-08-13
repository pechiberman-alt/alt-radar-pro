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
  assert.match(news, /COMMENTARY_TERMS/);
  assert.match(news, /CONCRETE_EVENT_TERMS/);
  assert.match(radarRoute, /loadGlobalNews/);
});

test("does not let opinion headlines or unconfirmed events trigger market safety", async () => {
  const [news, radar] = await Promise.all([
    readFile(new URL("../lib/news-intelligence.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/radar.ts", import.meta.url), "utf8"),
  ]);

  assert.match(news, /commentary \|\| \(question && !concreteEvent\)/);
  assert.match(news, /primary\.status === "CONFIRMED"/);
  assert.match(radar, /event\.status !== "UNCONFIRMED"/);
  assert.match(radar, /event\.tier <= 2 \|\| \(event\.sourceCount \?\? 1\) >= 2/);
});

test("filters commentary in executable geopolitical intelligence", async () => {
  const suffix = `?case=${process.pid}-${Date.now()}`;
  const [{ classifyNewsItems }, { globalRisk }] = await Promise.all([
    import(new URL(`../lib/news-intelligence.ts${suffix}`, import.meta.url)),
    import(new URL(`../lib/radar.ts${suffix}`, import.meta.url)),
  ]);
  const now = Date.parse("2026-08-13T17:00:00.000Z");
  const events = classifyNewsItems([
    {
      title: "Opinion | Spain’s Migration Invasion Wasn’t Normal",
      url: "https://example.com/opinion",
      source: "Dow Jones",
      publishedAt: new Date(now - 10 * 60_000).toISOString(),
    },
    {
      title: "Major Russian grain export terminals hit in Ukraine Black Sea port attack",
      url: "https://example.com/event",
      source: "BBC",
      publishedAt: new Date(now - 5 * 60_000).toISOString(),
    },
  ], now);

  assert.equal(events.some((event) => event.url.endsWith("/opinion")), false);
  assert.equal(events.some((event) => event.url.endsWith("/event")), true);
  assert.equal(globalRisk([{
    id: "rumor",
    title: "Unconfirmed social media claim",
    url: "https://example.com/rumor",
    source: "Secondary",
    publishedAt: new Date(now).toISOString(),
    region: "GLOBAL",
    category: "GEOPOLITICS",
    tier: 3,
    risk: 94,
    btcImpact: -50,
    altImpact: -70,
    goldImpact: 40,
    oilImpact: 0,
    status: "UNCONFIRMED",
    sourceCount: 1,
  }]).killSwitch, false);
  assert.ok(globalRisk([{
    id: "rumor",
    title: "Unconfirmed social media claim",
    url: "https://example.com/rumor",
    source: "Secondary",
    publishedAt: new Date(now).toISOString(),
    region: "GLOBAL",
    category: "GEOPOLITICS",
    tier: 3,
    risk: 94,
    btcImpact: -50,
    altImpact: -70,
    goldImpact: 40,
    oilImpact: 0,
    status: "UNCONFIRMED",
    sourceCount: 1,
  }]).score <= 40);
});

test("does not merge unrelated country headlines into fake corroboration", async () => {
  const suffix = `?cluster=${process.pid}-${Date.now()}`;
  const { classifyNewsItems } = await import(
    new URL(`../lib/news-intelligence.ts${suffix}`, import.meta.url)
  );
  const now = Date.parse("2026-08-13T17:00:00.000Z");
  const events = classifyNewsItems([
    {
      title: "China announces new securities market rules",
      url: "https://example.com/rules",
      source: "BBC",
      publishedAt: new Date(now - 4 * 60_000).toISOString(),
    },
    {
      title: "Former China premier dies at 97",
      url: "https://example.com/obituary",
      source: "Dow Jones",
      publishedAt: new Date(now - 3 * 60_000).toISOString(),
    },
    {
      title: "China announces new securities market rules",
      url: "https://example.com/rules-two",
      source: "Dow Jones",
      publishedAt: new Date(now - 2 * 60_000).toISOString(),
    },
  ], now);

  const rules = events.find((event) => event.title.includes("securities market rules"));
  assert.equal(rules?.sourceCount, 2);
  assert.equal(events.some((event) => event.title.includes("premier dies") && event.sourceCount > 1), false);
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

test("archives observed liquidity for honest 5M through 1D Bookmap windows", async () => {
  const [history, route, bookmap, schema] = await Promise.all([
    readFile(new URL("../lib/liquidity-history.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/liquidity-history/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/live-bookmap.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);

  assert.match(history, /liquidity_snapshots/);
  assert.match(history, /55_000/);
  assert.match(history, /25 \* 3_600_000/);
  assert.match(route, /Sólo snapshots observados/);
  assert.match(route, /ORIGEN NO AUTORIZADO/);
  assert.match(bookmap, /LIQUIDITY_WINDOW_MS/);
  assert.match(bookmap, /ARCHIVO REAL ACTIVO/);
  assert.match(bookmap, /ACUMULANDO/);
  assert.match(schema, /liquiditySnapshots/);
});

test("adds a numeric real-trade footprint and an interactive liquidity viewport", async () => {
  const [bookmap, interactionCss, layout] = await Promise.all([
    readFile(new URL("../app/live-bookmap.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/bookmap-interactions.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(bookmap, /BID × ASK/);
  assert.match(bookmap, /USD EJECUTADO/);
  assert.match(bookmap, /stackedImbalances/);
  assert.match(bookmap, /onWheel=\{handleWheel\}/);
  assert.match(bookmap, /onPointerDown=\{handlePointerDown\}/);
  assert.match(bookmap, /startDistance/);
  assert.match(bookmap, /SIGUIENDO LIVE/);
  assert.match(interactionCss, /touch-action:\s*none/);
  assert.match(interactionCss, /chart-footprint-numbers/);
  assert.match(layout, /bookmap-interactions\.css/);
});

test("matches the premium heatmap reference with real expandable market context", async () => {
  const [bookmap, premiumCss, radar, layout] = await Promise.all([
    readFile(new URL("../app/live-bookmap.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/bookmap-premium.css", import.meta.url), "utf8"),
    readFile(new URL("../app/radar-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(bookmap, /bookmap-premium-shell/);
  assert.match(bookmap, /PANTALLA COMPLETA/);
  assert.match(bookmap, /OPEN INTEREST/);
  assert.match(bookmap, /FUNDING/);
  assert.match(bookmap, /MAYORES LIQUIDACIONES OBSERVADAS/);
  assert.match(bookmap, /Binance Futures public API · DATA UNAVAILABLE/);
  assert.match(bookmap, /news\.slice\(0, 5\)/);
  assert.match(radar, /news=\{data\.news\}/);
  assert.match(premiumCss, /dock-tabs/);
  assert.match(premiumCss, /bookmap-premium-shell\.fullscreen/);
  assert.match(layout, /bookmap-premium\.css/);
});

test("uses real 100-level depth and an unattended core liquidity archive", async () => {
  const [bookmap, orderbook, history, archive, worker, wrangler] = await Promise.all([
    readFile(new URL("../app/live-bookmap.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/orderbook/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/liquidity-history.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/liquidity-archive.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../wrangler.production.jsonc", import.meta.url), "utf8"),
  ]);

  assert.match(bookmap, /compositeBook/);
  assert.match(bookmap, /100 NIVELES REALES/);
  assert.match(bookmap, /streamDepth/);
  assert.match(bookmap, /forwardFillLiquidity/);
  assert.match(orderbook, /fapi\.binance\.com\/fapi\/v1\/depth/);
  assert.match(orderbook, /payload\.bids \?\? payload\.b/);
  assert.match(history, /MAX_LEVELS = 100/);
  assert.match(archive, /archiveCoreLiquidity/);
  assert.match(worker, /archiveCoreLiquidity/);
  assert.match(wrangler, /"\* \* \* \* \*"/);
});

test("adds secure market memory, a zero-token analyst and an independent scalping mode", async () => {
  const [security, brainRoute, brainPanel, scalpEngine, scalpRoute, scalpPanel, worker, schema] = await Promise.all([
    readFile(new URL("../lib/brain-security.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/brain/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/market-brain.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/scalping-engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/scalping/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/scalping-desk.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);

  assert.match(security, /SHA-256/);
  assert.match(security, /previous_hash TEXT NOT NULL UNIQUE/);
  assert.match(security, /Las preguntas del analista no se guardan/);
  assert.match(brainRoute, /appendBrainAuditEvent/);
  assert.match(brainPanel, /CEREBRO SEGURO/);
  assert.match(brainPanel, /¿Hay scalp\?/);
  assert.match(scalpEngine, /Alineación real 5M \+ 15M/);
  assert.match(scalpEngine, /Anti-FOMO/);
  assert.match(scalpRoute, /velas cerradas 5M\/15M/);
  assert.match(scalpPanel, /Modo Scalping/);
  assert.match(scalpPanel, /LOCAL · 0 TOKENS/);
  assert.match(worker, /runScalpingAutomation/);
  assert.match(schema, /brainSecurityEvents/);
});
