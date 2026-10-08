import assert from "node:assert/strict";
import test from "node:test";
import type { CryptoNewsItem } from "../lib/crypto-news.ts";
import type { AgentReport } from "../lib/jarvis-desk-agents.ts";
import type { DeskDecision } from "../lib/jarvis-desk.ts";
import { cleanWatchPrefs, DEFAULT_WATCH_PREFS, liquidationWatchAlert, MAX_WATCHED, MEMORY_MAX_AGE_MS, watchAlerts, type WatchPrefs } from "../lib/jarvis-watch.ts";
import { createPriceAlert, listUserAlerts } from "../lib/price-alerts-server.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";
import { makeDb, sqlite } from "./helpers/fake-d1.ts";

const H = 3_600_000;
const NOW = Date.UTC(2026, 9, 8, 15, 5);
const ON: WatchPrefs = { ...DEFAULT_WATCH_PREFS, enabled: true };

const agent = (id: string, datos: AgentReport["datos"], disponible = true): AgentReport => ({ id: id as AgentReport["id"], nombre: id, disponible, sesgo: 0, peso: 0.1, hallazgos: [], faltantes: [], datos });

function desk(over: Partial<DeskDecision> = {}, datos: { tendencia4h?: string; tendencia1d?: string; vol?: number; funding?: number | null; oi?: number | null } = {}): DeskDecision {
  return {
    symbol: "XRPUSDT",
    moneda: "XRP",
    precio: 3,
    vela: NOW - 2 * H + 5 * 60_000 - 5 * 60_000,
    generadoA: NOW,
    direccion: "ESPERAR",
    puntaje: 50,
    consenso: 0,
    cobertura: 1,
    plan: null,
    riesgo: null,
    alcista: { plan: null, riesgo: null, argumentos: [] },
    bajista: { plan: null, riesgo: null, argumentos: [] },
    resolucion: "",
    razonamiento: [],
    invalidacion: "",
    alternativo: "",
    niveles: { soportes: [{ precio: 2.9, estrellas: 2 }], resistencias: [{ precio: 3.1, estrellas: 3 }] },
    imanes: { arriba: null, abajo: null },
    agentes: [
      agent("estructura", { tendencia1h: "ALCISTA", tendencia4h: datos.tendencia4h ?? "ALCISTA", tendencia1d: datos.tendencia1d ?? "ALCISTA" }),
      agent("volumen", { volumenRelativo1h: datos.vol ?? 1 }),
      agent("derivados", { fundingPct: datos.funding ?? 0.01, cambioInteresAbierto24hPct: datos.oi ?? 2 }, datos.funding !== null),
    ],
    faltantes: [],
    fuentes: [],
    historial: null,
    aviso: "",
    ...over,
  } as DeskDecision;
}

/** 1 h candles ending at the last closed hour; the last two closes given. */
function candles(before: number, last: number, n = 40): SwingCandle[] {
  const end = Math.floor(NOW / H) * H - H;
  return Array.from({ length: n }, (_, i) => {
    const close = i === n - 1 ? last : i === n - 2 ? before : 3;
    return { openTime: end - (n - 1 - i) * H, open: 3, high: Math.max(3, close) + 0.01, low: Math.min(3, close) - 0.01, close, volume: 1, quoteVolume: 1 };
  });
}

test("a close across a desk level is a break, once per candle, with its stars", () => {
  const up = watchAlerts({ d: desk(), h1: candles(3.05, 3.15), h4: null, news: null, prev: null, now: NOW, prefs: ON }).alerts;
  const brk = up.find((a) => a.title.includes("rompió"))!;
  assert.match(brk.title, /XRP rompió 3,1 hacia arriba/);
  assert.equal(brk.priority, "IMPORTANTE", "a ★★★ level");
  assert.equal(brk.category, "MESA");
  assert.match(brk.id, /^mesa:rompe:XRPUSDT:3\.1:/);
  const down = watchAlerts({ d: desk(), h1: candles(2.95, 2.85), h4: null, news: null, prev: null, now: NOW, prefs: ON }).alerts;
  assert.ok(down.some((a) => /perdió 2,9/.test(a.title)));
  const wick = watchAlerts({ d: desk(), h1: candles(3.05, 3.08), h4: null, news: null, prev: null, now: NOW, prefs: ON }).alerts;
  assert.ok(!wick.some((a) => a.title.includes("rompió")), "no close beyond the level, no break");
  const off = watchAlerts({ d: desk(), h1: candles(3.05, 3.15), h4: null, news: null, prev: null, now: NOW, prefs: { ...ON, kinds: { ...ON.kinds, RUPTURA: false } } }).alerts;
  assert.ok(!off.some((a) => a.title.includes("rompió")), "a kind turned off stays quiet");
});

test("a change of structure needs a recent previous reading", () => {
  const first = watchAlerts({ d: desk(), h1: candles(3, 3), h4: null, news: null, prev: null, now: NOW, prefs: ON });
  assert.equal(first.alerts.filter((a) => a.id.includes("estructura")).length, 0, "nothing to compare with yet");
  const flipped = watchAlerts({ d: desk({}, { tendencia4h: "BAJISTA" }), h1: candles(3, 3), h4: null, news: null, prev: first.memory, now: NOW + 10 * 60_000, prefs: ON }).alerts;
  const s = flipped.find((a) => a.id.includes("estructura"))!;
  assert.match(s.title, /4 h pasó de alcista a bajista/);
  assert.equal(s.priority, "IMPORTANTE");
  const stale = { ...first.memory, at: NOW - MEMORY_MAX_AGE_MS - 1 };
  assert.equal(watchAlerts({ d: desk({}, { tendencia4h: "BAJISTA" }), h1: candles(3, 3), h4: null, news: null, prev: stale, now: NOW, prefs: ON }).alerts.filter((a) => a.id.includes("estructura")).length, 0, "a day-old reading is not a change now");
});

test("volume, funding and open interest past their thresholds; missing derivatives fire nothing", () => {
  const r = watchAlerts({ d: desk({}, { vol: 4.2, funding: 0.08, oi: 14 }), h1: candles(3, 3.02), h4: null, news: null, prev: { at: NOW - H, trends: {}, fundingPct: 0.01 }, now: NOW, prefs: ON }).alerts;
  assert.ok(r.some((a) => /volumen 4,2× lo normal/.test(a.title)));
  assert.ok(r.some((a) => /funding \+0,08% cada 8 h/.test(a.title)));
  assert.ok(r.some((a) => /el funding cambió fuerte/.test(a.title)), "from 0,01 to 0,08 between readings");
  assert.ok(r.some((a) => /interés abierto \+14% en 24 h/.test(a.title)));
  const btc = watchAlerts({ d: desk({ symbol: "BTCUSDT", moneda: "BTC" }, { vol: 9 }), h1: candles(3, 3), h4: null, news: null, prev: null, now: NOW, prefs: ON }).alerts;
  assert.ok(!btc.some((a) => a.id.includes("volumen")), "BTC volume is already in the alert centre");
  const blind = watchAlerts({ d: desk({}, { funding: null, oi: 50 }), h1: candles(3, 3), h4: null, news: null, prev: null, now: NOW, prefs: ON }).alerts;
  assert.ok(!blind.some((a) => a.id.includes("funding") || a.id.includes(":oi:")), "derivatives not available: no guess");
});

test("news: only high-impact headlines about the coin from the last hours, with their source", () => {
  const item = (over: Partial<CryptoNewsItem>): CryptoNewsItem => ({ title: "Ripple wins", url: "https://example.com/a", source: "CoinDesk", publishedAt: NOW - H, category: "REGULACIÓN" as CryptoNewsItem["category"], impact: "ALTO", tone: "POSITIVO", assets: ["XRP"], ...over });
  const r = watchAlerts({ d: desk(), h1: candles(3, 3), h4: null, news: [item({}), item({ url: "b", impact: "MEDIO" }), item({ url: "c", publishedAt: NOW - 10 * H }), item({ url: "d", assets: ["BTC"] })], prev: null, now: NOW, prefs: ON }).alerts;
  const news = r.filter((a) => a.id.startsWith("mesa:noticia:"));
  assert.equal(news.length, 1);
  assert.match(news[0].body, /Ripple wins \(CoinDesk\)\. Es el titular: JARVIS no verificó la nota\./);
});

test("big liquidations from the live tape, for watched coins only, above the chosen size", () => {
  const l = { symbol: "XRPUSDT", time: NOW, price: 3, qty: 600_000, notionalUsd: 1_800_000, side: "LARGOS" as const };
  const prefs = { ...ON, symbols: ["XRPUSDT"] };
  const a = liquidationWatchAlert(l, prefs)!;
  assert.match(a.title, /liquidaron 1,8 millones de dólares de largos/);
  assert.match(a.body, /real informada por Binance/);
  assert.equal(liquidationWatchAlert({ ...l, notionalUsd: 400_000 }, prefs), null);
  assert.equal(liquidationWatchAlert({ ...l, symbol: "DOGEUSDT" }, prefs), null);
  assert.equal(liquidationWatchAlert(l, { ...prefs, enabled: false }), null);
  assert.equal(liquidationWatchAlert({ ...l, notionalUsd: 6_000_000 }, prefs)!.priority, "CRITICA");
});

test("saved preferences are cleaned: nothing out of range, never more coins than allowed", () => {
  const p = cleanWatchPrefs({ enabled: true, symbols: ["BTCUSDT", "BTCUSDT", "x'; drop", ...Array.from({ length: 10 }, (_, i) => `C${i}USDT`)], volumenX: 0, oiPct: 5, liquidacionUsd: 10, kinds: { NOTICIA: false } });
  assert.equal(p.enabled, true);
  assert.equal(p.symbols.length, MAX_WATCHED);
  assert.equal(new Set(p.symbols).size, p.symbols.length);
  assert.ok(p.symbols.every((s) => /^[A-Z0-9]+USDT$/.test(s)));
  assert.equal(p.volumenX, DEFAULT_WATCH_PREFS.volumenX);
  assert.equal(p.oiPct, 5);
  assert.equal(p.liquidacionUsd, DEFAULT_WATCH_PREFS.liquidacionUsd);
  assert.equal(p.kinds.NOTICIA, false);
  assert.equal(p.kinds.RUPTURA, true);
  assert.equal(cleanWatchPrefs("nonsense").enabled, false);
});

test("Telegram alerts from the app: direction from the price, the app's price only when Binance does not answer, at most ten", { skip: !sqlite }, async () => {
  const db = makeDb();
  const realFetch = globalThis.fetch;
  let binanceUp = true;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (!binanceUp) throw new Error("403");
    if (url.includes("NOPEUSDT")) return new Response("{}", { status: 400 });
    return Response.json({ price: "112000" });
  }) as typeof fetch;
  try {
    const below = await createPriceAlert(db, 1, "btc", 110_000, null, NOW);
    assert.ok(below.ok);
    if (below.ok) {
      assert.equal(below.alert.direction, "ABAJO");
      assert.equal(below.alert.symbol, "BTCUSDT");
      assert.match(below.message, /110/);
    }
    const twice = await createPriceAlert(db, 1, "BTC", 110_000, null, NOW);
    assert.equal(twice.ok, false, "the same level twice");
    assert.equal((await createPriceAlert(db, 1, "BTC", 112_010, null, NOW)).ok, false, "practically the current price");
    assert.equal((await createPriceAlert(db, 1, "NOPE", 5, null, NOW)).ok, false, "a coin Binance does not list");
    binanceUp = false;
    const fallback = await createPriceAlert(db, 1, "ETH", 5000, 4500, NOW);
    assert.ok(fallback.ok);
    if (fallback.ok) assert.equal(fallback.alert.direction, "ARRIBA", "decided with the app's price");
    assert.equal((await createPriceAlert(db, 1, "SOL", 300, null, NOW)).ok, false, "no price at all: said, not guessed");
    binanceUp = true;
    for (let i = 0; i < 8; i += 1) assert.ok((await createPriceAlert(db, 1, "BTC", 120_000 + i * 1000, null, NOW)).ok);
    const full = await createPriceAlert(db, 1, "BTC", 130_000, null, NOW);
    assert.equal(full.ok, false);
    if (!full.ok) assert.match(full.error, /máximo/);
    assert.equal((await listUserAlerts(db, 1)).length, 10);
    assert.equal((await listUserAlerts(db, 2)).length, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});
