import assert from "node:assert/strict";
import test from "node:test";
import { classifyCryptoNews, dedupeNews } from "../lib/crypto-news.ts";
import { parseFearGreed, zoneFor } from "../lib/fear-greed.ts";

const raw = (title: string, hoursAgo = 1) => ({
  title,
  url: "https://x/" + encodeURIComponent(title),
  source: "Test",
  publishedAt: new Date(Date.now() - hoursAgo * 3_600_000).toUTCString(),
});

test("headlines are classified by fundamental type", () => {
  assert.equal(classifyCryptoNews(raw("SEC approves spot Solana ETF"))?.category, "REGULACIÓN");
  assert.equal(classifyCryptoNews(raw("DeFi protocol drained in $40M exploit"))?.category, "SEGURIDAD");
  assert.equal(classifyCryptoNews(raw("Fed signals rate cut as inflation cools"))?.category, "MACRO");
  assert.equal(classifyCryptoNews(raw("Bitcoin ETFs log $500M inflows"))?.category, "INSTITUCIONAL");
  assert.equal(classifyCryptoNews(raw("Tether mints another 1B USDT"))?.category, "STABLECOINS");
  assert.equal(classifyCryptoNews(raw("Aptos token unlock next week"))?.category, "TOKENS");
});

test("security incidents outrank everything else in the same headline", () => {
  assert.equal(classifyCryptoNews(raw("Binance hot wallet hacked"))?.category, "SEGURIDAD");
});

test("a strong verb in a fundamental category is high impact", () => {
  assert.equal(classifyCryptoNews(raw("SEC approves spot Solana ETF"))?.impact, "ALTO");
  assert.equal(classifyCryptoNews(raw("Analyst shares weekly chart thoughts"))?.impact, "BAJO");
});

test("tone is the headline's tone; mixed headlines stay neutral", () => {
  assert.equal(classifyCryptoNews(raw("Bitcoin surges to record high"))?.tone, "POSITIVO");
  assert.equal(classifyCryptoNews(raw("Ether plunges as outflows mount"))?.tone, "NEGATIVO");
  assert.equal(classifyCryptoNews(raw("Bitcoin rally fades as ETF outflows return"))?.tone, "NEUTRO");
});

test("assets mentioned are extracted", () => {
  assert.deepEqual(classifyCryptoNews(raw("Bitcoin and Solana lead gains"))?.assets, ["BTC", "SOL"]);
});

test("the same story from two outlets is kept once", () => {
  const a = classifyCryptoNews(raw("SEC approves first spot Solana ETF in historic decision", 1))!;
  const b = classifyCryptoNews(raw("SEC approves first spot Solana ETF, a historic decision", 2))!;
  const c = classifyCryptoNews(raw("Ethereum developers schedule next upgrade", 3))!;
  assert.equal(dedupeNews([a, b, c]).length, 2);
});

test("unparseable dates are dropped", () => {
  assert.equal(classifyCryptoNews({ title: "x", url: "u", source: "s", publishedAt: "nope" }), null);
});

const fng = (values: number[]) => ({
  data: values.map((v, i) => ({ value: String(v), timestamp: String(1_758_000_000 - i * 86400) })),
});

test("fear & greed reads current value, zone and changes", () => {
  const f = parseFearGreed(fng([71, 56, 50, 48, 45, 40, 38, 35, ...Array(30).fill(30)]));
  assert.ok(f);
  assert.equal(f.value, 71);
  assert.equal(f.zone, "AVARICIA");
  assert.equal(f.yesterday, 56);
  assert.equal(f.weekAgo, 35);
  assert.equal(f.series.length, 30);
  assert.equal(f.series.at(-1)?.value, 71, "la serie termina en el valor actual");
});

test("zones follow the index bands", () => {
  assert.equal(zoneFor(10), "MIEDO EXTREMO");
  assert.equal(zoneFor(30), "MIEDO");
  assert.equal(zoneFor(50), "NEUTRAL");
  assert.equal(zoneFor(65), "AVARICIA");
  assert.equal(zoneFor(90), "AVARICIA EXTREMA");
});

test("the reading never presents an extreme as a trigger", () => {
  assert.match(parseFearGreed(fng([10]))!.reading, /puede durar semanas/);
  assert.match(parseFearGreed(fng([90]))!.reading, /puede extenderse/);
});

test("a malformed payload yields nothing", () => {
  assert.equal(parseFearGreed({}), null);
  assert.equal(parseFearGreed({ data: [{ value: "x" }] }), null);
});
