import assert from "node:assert/strict";
import test from "node:test";
import { aggregate } from "../lib/asset-read.ts";
import type { DeskSnapshot } from "../lib/jarvis-desk-data.ts";
import { DEFAULT_DESK_SETTINGS, deskTicket, MIN_RR, reviewRisk, rrFrom, runDesk, type DeskDecision, type Plan } from "../lib/jarvis-desk.ts";
import { manualTicket, REAL_ORDERS_FROM_JARVIS, TICKET_MAX_AGE_MS } from "../lib/jarvis-execution.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

const H = 3_600_000;
const NOW = Date.UTC(2026, 9, 8, 15, 5);

/** LONG 100 → stop 98 → TPs 103 / 105 / 107: R:R 1,5 / 2,5 / 3,5, weighted 2,5. */
const plan = (over: Partial<Plan> = {}): Plan => ({
  lado: "LONG",
  entrada: 100,
  tipoEntrada: "MERCADO",
  stop: 98,
  stopRazon: "detrás del soporte",
  tp: [
    { price: 103, label: "resistencia ★★" },
    { price: 105, label: "resistencia ★" },
    { price: 107, label: "3,5 R" },
  ],
  obstaculos: [],
  ...over,
});

const ctx = (over: Partial<Parameters<typeof reviewRisk>[1]> = {}): Parameters<typeof reviewRisk>[1] => ({
  atr: 1.5,
  regime: "NORMAL",
  events: [],
  now: NOW,
  fundingPct: 0.01,
  longShort: 1.1,
  coverage: 0.9,
  consensus: 0.4,
  livePrice: null,
  ...over,
});

test("the risk manager judges a market entry at today's price, not at the close it read", () => {
  const chased = reviewRisk(plan(), ctx({ livePrice: 101 }), DEFAULT_DESK_SETTINGS);
  assert.equal(chased.aprobado, false, "1% higher with the same stop: R:R 1,33");
  assert.match(chased.esperas[0], /se movió \+1,00% desde el cierre/);
  assert.match(chased.esperas[0], /1:1,33/);
  assert.equal(chased.rrVivo!.toFixed(2), "1.33");
  const gone = reviewRisk(plan(), ctx({ livePrice: 97.5 }), DEFAULT_DESK_SETTINGS);
  assert.match(gone.esperas[0], /del otro lado del stop/);
  assert.equal(gone.rrVivo, null);
  const past = reviewRisk(plan(), ctx({ livePrice: 103.4 }), DEFAULT_DESK_SETTINGS);
  assert.match(past.esperas[0], /más allá del TP1/);
  const close = reviewRisk(plan(), ctx({ livePrice: 100.3 }), DEFAULT_DESK_SETTINGS);
  assert.equal(close.aprobado, true);
  assert.ok(close.avisos.some((a) => /El precio ahora es 100,3 \(\+0,30% desde el cierre leído\): a ese precio el R:R es 1:2,04/.test(a)));
  const still = reviewRisk(plan(), ctx({ livePrice: 100.05 }), DEFAULT_DESK_SETTINGS);
  assert.ok(!still.avisos.some((a) => /El precio ahora/.test(a)), "a hair from the close says nothing");
  // A limit order waits at its level: a live price elsewhere is not a reason to wait.
  const limit = reviewRisk(plan({ tipoEntrada: "LÍMITE" }), ctx({ livePrice: 101 }), DEFAULT_DESK_SETTINGS);
  assert.equal(limit.esperas.length, 0);
  assert.equal(rrFrom(plan(), 100), 2.5);
});

test("no live price: nothing is assumed, the plan stands on its own numbers", () => {
  const r = reviewRisk(plan(), ctx(), DEFAULT_DESK_SETTINGS);
  assert.equal(r.precioVivo, null);
  assert.equal(r.rrVivo, null);
  assert.equal(r.aprobado, true);
});

test("a size that does not fit the capital at a safe leverage is NO TRADE; one that fits only higher raises it within the safe max", () => {
  const tight = plan({ stop: 99.7, tp: [{ price: 100.8, label: "a" }, { price: 101.2, label: "b" }, { price: 101.5, label: "c" }] });
  const tooBig = reviewRisk(tight, ctx({ atr: 0.5 }), { capital: 1000, riesgoPct: 5, apalancamientoMax: 10 });
  assert.ok(tooBig.vetos.some((v) => /no entra en tu capital ni con el apalancamiento máximo seguro \(10x\)/.test(v)), tooBig.vetos.join(" | "));
  assert.equal(tooBig.aprobado, false);
  const raised = reviewRisk(tight, ctx({ atr: 0.5 }), { capital: 1000, riesgoPct: 2, apalancamientoMax: 10 });
  assert.equal(raised.vetos.length, 0, raised.vetos.join(" | "));
  assert.equal(raised.apalancamiento, 7, "6.667 of position on 1.000 of capital");
  assert.ok(raised.margenUsd! <= 1000);
  assert.ok(raised.avisos.some((a) => /el apalancamiento sube a 7x/.test(a)));
  assert.ok(raised.liquidacionVsStop >= 3, "still far beyond the stop");
});

test("exposure, risk per trade and open paper risk are measured and said", () => {
  const r = reviewRisk(plan(), ctx(), { capital: 1000, riesgoPct: 3, apalancamientoMax: 10, riesgoAbiertoUsd: 40 });
  assert.equal(r.riesgoUsd, 30);
  assert.equal(r.posicionUsd, 1500);
  assert.equal(r.exposicionX, 1.5);
  assert.ok(r.avisos.some((a) => /Riesgo por operación de 3%/.test(a)));
  assert.ok(r.avisos.some((a) => /el riesgo abierto sería 7,0% de tu capital/.test(a)), r.avisos.join(" | "));
  const big = reviewRisk(plan({ stop: 99.5, tp: [{ price: 101, label: "a" }, { price: 101.5, label: "b" }, { price: 102, label: "c" }] }), ctx({ atr: 0.6 }), { capital: 1000, riesgoPct: 2, apalancamientoMax: 20 });
  assert.equal(big.exposicionX, 4);
  assert.ok(big.avisos.some((a) => /equivale a 4 veces tu capital/.test(a)));
});

test("with risk high, a thin reward is vetoed: NO TRADE before forcing an entry", () => {
  const thin = plan({ tp: [{ price: 103, label: "a" }, { price: 103.5, label: "b" }, { price: 104, label: "c" }] });
  assert.ok(Math.abs(reviewRisk(thin, ctx(), DEFAULT_DESK_SETTINGS).rrPonderado - 1.75) < 1e-9);
  const calm = reviewRisk(thin, ctx(), DEFAULT_DESK_SETTINGS);
  assert.equal(calm.aprobado, true, "1:1,75 is fine when the risk is not high");
  const wild = reviewRisk(thin, ctx({ regime: "EXPANDIDA" }), DEFAULT_DESK_SETTINGS);
  assert.equal(wild.nivel, "ALTO");
  assert.ok(wild.vetos.some((v) => /Riesgo alto con R:R 1:1,75: no compensa/.test(v)));
  const paid = reviewRisk(plan(), ctx({ regime: "EXPANDIDA" }), DEFAULT_DESK_SETTINGS);
  assert.equal(paid.vetos.length, 0, "1:2,5 pays for high risk");
});

test("the suggested leverage always leaves the liquidation at least 3 stops away", () => {
  for (const stop of [99.9, 99.5, 99, 98, 96, 93]) {
    const r = reviewRisk(plan({ stop }), ctx({ atr: 3 }), { capital: 5000, riesgoPct: 1, apalancamientoMax: 50 });
    if (r.vetos.length) continue;
    assert.ok(r.liquidacionVsStop >= 3, `stop ${stop}: ${r.liquidacionVsStop}`);
    assert.ok(r.apalancamiento <= r.apalancamientoMaxSeguro);
  }
});

// ── The ticket (response format) and the manual execution gate ──

const path = (f: (i: number) => number, n: number, t0 = Date.UTC(2026, 5, 1)): SwingCandle[] =>
  Array.from({ length: n }, (_, i) => {
    const o = f(i);
    const c = f(i + 1);
    return { openTime: t0 + i * H, open: o, high: Math.max(o, c) * 1.003, low: Math.min(o, c) * 0.997, close: c, volume: 100 + (i % 9) * 10, quoteVolume: (100 + (i % 9) * 10) * c };
  });

function snapshot(h1: SwingCandle[], markPrice: number | null): DeskSnapshot {
  return {
    symbol: "SOLUSDT",
    now: h1[h1.length - 1].openTime + H + 60_000,
    candles: { h1, h4: aggregate(h1, 4), d1: aggregate(h1, 24) },
    btc: path((i) => 60_000 * 1.0004 ** i + 300 * Math.sin(i / 7), h1.length),
    eth: path((i) => 3_000 * 1.0005 ** i + 20 * Math.sin(i / 5), h1.length),
    derivatives: markPrice === null ? null : { fundingPct: 0.01, nextFundingAt: null, markPrice, openInterest: null, openInterestUsd: null, oiChange24hPct: null, longShortRatio: null, takerBuySell: null, source: "Binance Futures" },
    macro: { btcDominance: null, usdtDominance: null, marketCapChange24h: null, events: [], calendarSource: "prueba" },
    news: null,
    fearGreed: null,
    sources: ["prueba"],
  };
}

const up = path((i) => 100 * 1.0015 ** i + 2 * Math.sin(i / 6), 1000);

test("the ticket has every field of the format, and says when there is no trade", () => {
  const d = runDesk(snapshot(up, null))!;
  const text = deskTicket(d);
  for (const label of ["ACTIVO: SOL/USDT", "DIRECCIÓN:", "CONFIANZA:", "PRECIO:", "INVALIDACIÓN:", "RAZONAMIENTO:", "ESCENARIO ALTERNATIVO:"]) assert.ok(text.includes(label), `${label} in\n${text}`);
  assert.match(text, /no es probabilidad de acierto/);
  assert.match(text, /precio en vivo: este dato no está disponible actualmente/);
  if (d.direccion === "LONG" || d.direccion === "SHORT") {
    for (const label of ["ENTRADA:", "STOP LOSS:", "TAKE PROFIT 1:", "TAKE PROFIT 2:", "TAKE PROFIT 3:", "RIESGO:", "R:R:", "APALANCAMIENTO SUGERIDO:"]) assert.ok(text.includes(label), label);
  }
  const none: DeskDecision = { ...d, direccion: "NO TRADE", plan: null, riesgo: null, resolucion: "El consenso es alcista, pero el gestor de riesgo lo veta." };
  const t2 = deskTicket(none);
  assert.match(t2, /DIRECCIÓN: ⛔ NO TRADE/);
  assert.match(t2, /ENTRADA, STOP Y OBJETIVOS: sin operación/);
  assert.match(t2, /POR QUÉ: El consenso es alcista, pero el gestor de riesgo lo veta\./);
  assert.ok(!/TAKE PROFIT/.test(t2), "no invented levels");
});

test("the live price is read for the risk check and never enters the analysis", () => {
  const a = runDesk(snapshot(up, null))!;
  const b = runDesk(snapshot(up, a.precio))!;
  assert.equal(b.precioVivo, a.precio);
  assert.match(b.precioVivoFuente!, /Binance Futures \(mark\)/);
  assert.deepEqual(b.agentes.filter((x) => x.id !== "derivados"), a.agentes.filter((x) => x.id !== "derivados"), "same reading of the market");
  assert.deepEqual(b.niveles, a.niveles);
});

test("real execution: JARVIS never sends orders; the manual ticket needs every check and the person's confirmation", () => {
  assert.equal(REAL_ORDERS_FROM_JARVIS, false);
  const r = reviewRisk(plan(), ctx({ livePrice: 100.2 }), { capital: 2000, riesgoPct: 1, apalancamientoMax: 10 });
  const d = {
    symbol: "SOLUSDT",
    moneda: "SOL",
    precio: 100,
    precioVivo: 100.2,
    precioVivoFuente: "Binance Futures (mark)",
    vela: NOW - 65 * 60_000,
    generadoA: NOW - 2 * 60_000,
    direccion: "LONG",
    puntaje: 70,
    plan: plan(),
    riesgo: r,
    resolucion: "Gana el escenario alcista.",
    aviso: "Análisis, no ejecución: no es asesoramiento financiero.",
  } as DeskDecision;
  const settings = { capital: 2000, riesgoPct: 1, apalancamientoMax: 10 };
  const unconfirmed = manualTicket(d, settings, NOW, false);
  assert.equal(unconfirmed.ready, false);
  assert.equal(unconfirmed.text, null);
  assert.equal(unconfirmed.checks.find((c) => c.id === "confirmacion")!.ok, false);
  assert.ok(unconfirmed.checks.filter((c) => c.id !== "confirmacion").every((c) => c.ok), unconfirmed.checks.map((c) => `${c.id}:${c.detail}`).join(" | "));
  const ok = manualTicket(d, settings, NOW, true);
  assert.equal(ok.ready, true);
  assert.match(ok.text!, /ORDEN MANUAL · SOL\/USDT perpetuo · LONG/);
  assert.match(ok.text!, /Stop loss: 98 \(stop-market, reduce-only\)/);
  assert.match(ok.text!, /Riesgo: \$20 \(1% de \$2\.000\)/);
  assert.match(ok.text!, /JARVIS no envía órdenes: esta la cargás vos en tu exchange/);
  // Each control can stop it on its own.
  assert.equal(manualTicket(d, settings, NOW + TICKET_MAX_AGE_MS, true).ready, false, "stale reading");
  assert.equal(manualTicket(d, { ...settings, capital: null }, NOW, true).ready, false, "no capital, no size");
  assert.equal(manualTicket(d, { ...settings, riesgoPct: 3 }, NOW, true).ready, false, "more than 2% per trade");
  assert.equal(manualTicket({ ...d, precioVivo: null }, settings, NOW, true).ready, false, "no live price");
  assert.equal(manualTicket({ ...d, precioVivo: 101.5 }, settings, NOW, true).checks.find((c) => c.id === "precio")!.ok, false, `the price ran: R:R below ${MIN_RR}`);
  const vetoed = { ...d, direccion: "NO TRADE" as const, riesgo: { ...r, vetos: ["x"], aprobado: false } };
  assert.equal(manualTicket(vetoed, settings, NOW, true).ready, false, "never a vetoed plan");
});
