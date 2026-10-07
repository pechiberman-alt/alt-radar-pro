import assert from "node:assert/strict";
import test from "node:test";
import { aggregate } from "../lib/asset-read.ts";
import { analyzeAsset } from "../lib/jarvis-analyst.ts";
import { consensus, correlation, NOT_AVAILABLE, runAgents } from "../lib/jarvis-desk-agents.ts";
import { derivativesFrom, type DeskSnapshot } from "../lib/jarvis-desk-data.ts";
import { buildPlan, compareDesks, confluenceScore, DEFAULT_DESK_SETTINGS, deskSpeech, macroBrief, macroKindOf, reviewRisk, rrOf, runDesk, whatIf, type Plan } from "../lib/jarvis-desk.ts";
import type { MacroEvent } from "../lib/econ-calendar.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const H = 3_600_000;
const T0 = Date.UTC(2026, 5, 1);

/** 1 h candles from a price path, with a little deterministic noise in the wicks and volume. */
const path = (f: (i: number) => number, n: number, t0 = T0): SwingCandle[] =>
  Array.from({ length: n }, (_, i) => {
    const o = f(i);
    const c = f(i + 1);
    return { openTime: t0 + i * H, open: o, high: Math.max(o, c) * 1.003, low: Math.min(o, c) * 0.997, close: c, volume: 100 + (i % 9) * 10, quoteVolume: (100 + (i % 9) * 10) * c };
  });

function snapshot(h1: SwingCandle[], extra: Partial<DeskSnapshot> = {}): DeskSnapshot {
  const now = h1[h1.length - 1].openTime + H + 1000;
  return {
    symbol: "SOLUSDT",
    now,
    candles: { h1, h4: aggregate(h1, 4), d1: aggregate(h1, 24) },
    btc: path((i) => 60_000 * 1.0004 ** i + 300 * Math.sin(i / 7), h1.length),
    eth: path((i) => 3_000 * 1.0005 ** i + 20 * Math.sin(i / 5), h1.length),
    derivatives: null,
    macro: { btcDominance: null, usdtDominance: null, marketCapChange24h: null, events: null, calendarSource: null },
    news: null,
    fearGreed: null,
    sources: ["prueba"],
    ...extra,
  };
}

const uptrend = path((i) => 100 * 1.0015 ** i + 2 * Math.sin(i / 6), 1000);
const downtrend = path((i) => 300 * 0.9985 ** i + 2 * Math.sin(i / 6), 1000);

test("the desk never reads a candle still forming, on any series (no lookahead)", () => {
  const s = snapshot(uptrend);
  const a = runDesk(s)!;
  const wild = (t: number): SwingCandle => ({ openTime: t, open: 1, high: 99_999, low: 0.01, close: 90_000, volume: 1e12, quoteVolume: 1e12 });
  const last = (c: SwingCandle[]) => c[c.length - 1].openTime;
  const withForming: DeskSnapshot = {
    ...s,
    candles: { h1: [...s.candles.h1, wild(last(s.candles.h1) + H)], h4: [...s.candles.h4!, wild(last(s.candles.h4!) + 4 * H)], d1: [...s.candles.d1!, wild(last(s.candles.d1!) + 24 * H)] },
    btc: [...s.btc!, wild(last(s.btc!) + H)],
    eth: [...s.eth!, wild(last(s.eth!) + H)],
  };
  assert.deepEqual(runDesk(withForming), a);
  assert.equal(a.vela, last(s.candles.h1));
});

test("a steady advance is never read as a short; any plan has its stop and targets on the right side", () => {
  const d = runDesk(snapshot(uptrend))!;
  assert.notEqual(d.direccion, "SHORT");
  assert.ok(d.consenso > 0, `consenso ${d.consenso}`);
  const p = d.alcista.plan!;
  assert.ok(p.stop < p.entrada && p.tp[0].price > p.entrada && p.tp[1].price > p.tp[0].price && p.tp[2].price > p.tp[1].price);
  if (d.direccion === "LONG") {
    assert.ok(d.riesgo!.rrPonderado >= 1.5);
    assert.ok(d.riesgo!.liquidacionAprox < p.stop, "the liquidation sits beyond the stop");
    assert.ok(d.riesgo!.apalancamiento >= 1 && d.riesgo!.apalancamiento <= DEFAULT_DESK_SETTINGS.apalancamientoMax);
  }
  const b = d.bajista.plan;
  if (b) assert.ok(b.stop > b.entrada && b.tp[0].price < b.entrada && b.tp[2].price < b.tp[1].price);
  assert.match(deskSpeech(d), /no es asesoramiento financiero/i);
});

test("a steady decline is never read as a long", () => {
  const d = runDesk({ ...snapshot(downtrend), symbol: "ADAUSDT" })!;
  assert.notEqual(d.direccion, "LONG");
  assert.ok(d.consenso < 0);
});

test("missing data is said, kept out of the consensus, and never filled in", () => {
  const d = runDesk(snapshot(uptrend))!;
  const der = d.agentes.find((x) => x.id === "derivados")!;
  assert.equal(der.disponible, false);
  assert.equal(der.peso, 0);
  assert.equal(der.sesgo, 0);
  for (const id of ["noticias", "sentimiento"]) assert.equal(d.agentes.find((x) => x.id === id)!.disponible, false);
  assert.ok(d.faltantes.some((f) => /funding/.test(f)));
  assert.ok(d.cobertura < 1);
  assert.equal(NOT_AVAILABLE, "Este dato no está disponible actualmente.");
});

test("with derivatives, news and sentiment the consensus reads them, and the score stays between 0 and 100", () => {
  const derivatives = derivativesFrom(
    {
      premium: { lastFundingRate: "-0.0004", nextFundingTime: T0, markPrice: "150" },
      oi: { openInterest: "1000000" },
      oiHist: Array.from({ length: 25 }, (_, i) => ({ timestamp: T0 + i * H, sumOpenInterest: String(1_000_000 * (1 + i * 0.004)) })),
      ls: [{ longShortRatio: "0.6" }],
      taker: [{ buySellRatio: "1.2" }],
    },
    150,
  )!;
  assert.equal(derivatives.fundingPct, -0.04);
  assert.ok(Math.abs(derivatives.oiChange24hPct! - 9.6) < 1e-9);
  const s = snapshot(uptrend, { derivatives, fearGreed: { value: 20, label: "Extreme Fear", zone: "MIEDO EXTREMO", yesterday: 22, weekAgo: 30, monthAgo: 40, average30: 35, series: [], reading: "" } });
  const a = analyzeAsset(s.symbol, s.candles, s.now)!;
  const agents = runAgents(s, a);
  const der = agents.find((x) => x.id === "derivados")!;
  assert.ok(der.disponible && der.sesgo > 0, "shorts crowded and paying, OI rising with price: bullish fuel");
  const c = consensus(agents);
  for (const side of ["LONG", "SHORT", null] as const) {
    const score = confluenceScore(c, side);
    assert.ok(score >= 0 && score <= 100);
  }
});

test("derivatives that do not answer are null, not zero", () => {
  assert.equal(derivativesFrom({ premium: null, oi: null, oiHist: null, ls: null, taker: null }, 100), null);
});

const analysisFor = (h1: SwingCandle[]) => analyzeAsset("SOLUSDT", { h1 }, h1[h1.length - 1].openTime + H + 1)!;

test("the risk manager vetoes a plan whose reward does not pay its risk, whatever the confidence", () => {
  const plan: Plan = { lado: "LONG", entrada: 100, tipoEntrada: "MERCADO", stop: 95, stopRazon: "prueba", tp: [{ price: 102, label: "a" }, { price: 104, label: "b" }, { price: 106, label: "c" }], obstaculos: [] };
  assert.ok(Math.abs(rrOf(plan).rrPonderado - 0.8) < 1e-9);
  const r = reviewRisk(plan, { atr: 3, regime: "NORMAL", events: [], now: T0, fundingPct: null, longShort: null, coverage: 1, consensus: 0.9 }, DEFAULT_DESK_SETTINGS);
  assert.equal(r.aprobado, false);
  assert.match(r.vetos.join(" "), /riesgo\/beneficio insuficiente/);
});

test("a high-impact event within two hours means waiting, even for a good plan", () => {
  const plan: Plan = { lado: "LONG", entrada: 100, tipoEntrada: "MERCADO", stop: 97, stopRazon: "prueba", tp: [{ price: 106, label: "a" }, { price: 109, label: "b" }, { price: 112, label: "c" }], obstaculos: [] };
  const cpi: MacroEvent = { id: "cpi", title: "CPI m/m", currency: "USD", time: T0 + 60 * 60_000, impact: "high", forecast: "0.3%", previous: "0.4%" };
  const r = reviewRisk(plan, { atr: 2, regime: "NORMAL", events: [cpi], now: T0, fundingPct: null, longShort: null, coverage: 1, consensus: 0.5 }, { capital: 1000, riesgoPct: 1, apalancamientoMax: 10 });
  assert.equal(r.aprobado, false);
  assert.equal(r.vetos.length, 0);
  assert.match(r.esperas.join(" "), /CPI m\/m/);
  assert.equal(r.riesgoUsd, 10, "1% of 1000");
  assert.ok(Math.abs(r.posicionUsd! - 10 / 0.03) < 1e-6, "position = risk / stop distance");
  assert.ok(r.liquidacionAprox < plan.stop);
});

test("plans keep their targets in order and on their side, with or without levels beyond", () => {
  const a = analysisFor(uptrend);
  for (const side of ["LONG", "SHORT"] as const) {
    const p = buildPlan(side, a, 2)!;
    const dir = side === "LONG" ? 1 : -1;
    assert.ok(dir * (p.tp[0].price - p.entrada) > 0 && dir * (p.tp[1].price - p.tp[0].price) > 0 && dir * (p.tp[2].price - p.tp[1].price) > 0, side);
    assert.ok(dir * (p.entrada - p.stop) > 0, side);
    assert.ok(rrOf(p).rr[0] >= 1 - 1e-9, "the first target pays at least the risk");
    const [r1, r2, r3] = rrOf(p).rr;
    assert.ok(r2 - r1 >= 0.5 - 1e-9 && r3 - r2 >= 0.5 - 1e-9, `${side}: targets at least half an R apart (${r1}, ${r2}, ${r3})`);
  }
});

test("a fallback target never lands on top of a level target", () => {
  // The case seen live: one level at 2,44 R and nothing beyond, so TP2 and TP3 are fallbacks.
  // Before the fix TP2 was a flat 2,5 R, a hair above TP1.
  const a = analysisFor(uptrend);
  for (const [side, dir] of [["LONG", 1], ["SHORT", -1]] as const) {
    const bare = buildPlan(side, { ...a, magnets: { above: null, below: null } }, 2)!;
    const risk = Math.abs(bare.entrada - bare.stop);
    const at = bare.entrada + dir * 2.44 * risk;
    const magnet = { price: at, distancePct: ((at - bare.entrada) / bare.entrada) * 100, intensity: 80 };
    const p = buildPlan(side, { ...a, magnets: side === "LONG" ? { above: magnet, below: null } : { above: null, below: magnet } }, 2)!;
    const [r1, r2, r3] = rrOf(p).rr;
    if (Math.abs(r1 - 2.44) < 1e-6) {
      assert.match(p.tp[0].label, /imán/);
      assert.ok(r2 - r1 >= 0.5 - 1e-9 && r3 - r2 >= 0.5 - 1e-9, `${side}: ${r1} ${r2} ${r3}`);
      if (/sin nivel/.test(p.tp[1].label)) assert.match(p.tp[1].label, /2,9 R/, "half an R past the level, not a flat 2,5 R");
    } else {
      // Another level of the series came first: the spacing rule still holds.
      assert.ok(r2 - r1 >= 0.5 - 1e-9 && r3 - r2 >= 0.5 - 1e-9, `${side}: ${r1} ${r2} ${r3}`);
    }
  }
});

test("'what if it loses X' says what is invalidated and which level follows", () => {
  const d = runDesk(snapshot(uptrend))!;
  const bull = d.alcista.plan!;
  const text = whatIf(d, bull.stop * 0.99);
  assert.match(text, /invalidado el escenario alcista/);
  assert.match(text, /no es asesoramiento financiero/i);
  assert.match(whatIf(d, d.precio * 1.5), /Si SOL supera/);
  // Far past every target: no passed target is named as one still ahead.
  const far = whatIf(d, d.precio * 3);
  assert.match(far, /más allá de los objetivos del escenario alcista/);
  if (d.bajista.plan) assert.match(whatIf(d, d.bajista.plan.tp[2].price * 0.5), /más allá de los objetivos del escenario bajista/);
});

test("two assets compared criterion by criterion; missing data is a row of its own, never a win", () => {
  const a = runDesk(snapshot(uptrend))!;
  const b = runDesk({ ...snapshot(downtrend), symbol: "XRPUSDT" })!;
  const c = compareDesks(a, b);
  assert.equal(c.ganador, "A");
  assert.ok(c.filas.some((r) => r.criterio === "Derivados" && r.gana === "SIN DATOS"));
  assert.match(c.resumen, /gana SOL/);
});

test("macro events come from the calendar with the Argentine time; without the calendar it says so", () => {
  const now = Date.UTC(2026, 9, 7, 12);
  const cpi: MacroEvent = { id: "c", title: "Core CPI m/m", currency: "USD", time: Date.UTC(2026, 9, 8, 12, 30), impact: "high", forecast: "0.3%", previous: "0.4%" };
  const b = macroBrief([cpi], now, "CPI");
  assert.equal(b.evento, "Core CPI m/m");
  assert.match(b.hora ?? "", /09:30/);
  assert.equal(b.pronostico, "0.3%");
  assert.match(b.hot, /dólar/);
  assert.match(macroBrief(null, now, "CPI").nota, /no está disponible actualmente/);
  assert.match(macroBrief([cpi], now, "NFP").nota, /No hay NFP/);
  assert.equal(macroKindOf("¿qué pasa si sale un CPI peor de lo esperado?"), "CPI");
  assert.equal(macroKindOf("y si la fed sube la tasa"), "TASAS");
});

test("correlation lines up hours, not positions, and needs enough of them", () => {
  const a = path((i) => 100 + i, 200);
  const shifted = path((i) => 100 + i, 200, T0 + 1000 * H);
  assert.equal(correlation(a, shifted), null, "no common hours");
  const same = correlation(a, a)!;
  assert.ok(Math.abs(same.corr - 1) < 1e-9);
});
