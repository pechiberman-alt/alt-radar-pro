import assert from "node:assert/strict";
import test from "node:test";
import { aggregate } from "../lib/asset-read.ts";
import { analyzeAsset } from "../lib/jarvis-analyst.ts";
import type { DeskSnapshot } from "../lib/jarvis-desk-data.ts";
import { buildPlan, CONSENSUS_EDGE, DEFAULT_DESK_SETTINGS, DESK_RULES, MANAGEMENT_TEXT, reviewRisk, STOP_BUFFER_ATR, runDesk, type Plan } from "../lib/jarvis-desk.ts";
import { FEE_PCT } from "../lib/jarvis-ledger.ts";
import { auditOf, paperCsv, resolvePaper, resultOf, stopNow, validatePaper, type PaperTrade } from "../lib/jarvis-paper.ts";
import { mergeProgress } from "../lib/jarvis-paper-db.ts";
import type { Level } from "../lib/level-engine.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

/**
 * Las reglas v2 de la mesa (docs/mesa-reglas-v2.md): stop a 1 ATR del nivel,
 * consenso mínimo ±0,30 y, al cobrar el TP1, el stop pasa a la entrada.
 */

const H = 3_600_000;
const T0 = Date.UTC(2026, 8, 1);
const far = T0 + 1000 * H;

// ── The management of the stop, in paper ──

function trade(over: Partial<PaperTrade> = {}): PaperTrade {
  return {
    id: "SOLUSDT:1:LONG:M",
    symbol: "SOLUSDT",
    lado: "LONG",
    estado: "ABIERTA",
    abiertaA: T0 + H + 600_000,
    vela: T0,
    tipoEntrada: "MERCADO",
    entrada: 100,
    stop: 95,
    tp: [105, 110, 115],
    rrPlan: 2,
    confianza: 70,
    analisis: { direccionMesa: "LONG", consenso: 0.4, cobertura: 0.9, regimen: "NORMAL", sesgos: { tecnico: 0.5, estructura: 0.4, derivados: -0.2 }, motivo: "prueba", razonamiento: ["a"], fuentes: ["prueba"] },
    decision: { riesgoNivel: "BAJO", apalancamiento: 3, riesgoUsd: 10, posicionUsd: 200, stopPct: 5 },
    salidas: [],
    llenadaA: T0 + H,
    cerradaA: null,
    resultadoR: null,
    mfeR: null,
    maeR: null,
    revisadaHasta: null,
    fuenteVelas: null,
    motivoCierre: null,
    gestion: "BE_TP1",
    reglas: DESK_RULES,
    ...over,
  };
}

/** A 1 h candle `i` hours after T0. */
const c = (i: number, high: number, low: number, close = (high + low) / 2): SwingCandle => ({ openTime: T0 + i * H, open: (high + low) / 2, high, low, close, volume: 1, quoteVolume: 1 });
const fee = (entry: number, exits: [number, number][], risk: number) => ((FEE_PCT / 100) * entry + exits.reduce((p, [price, f]) => p + f * (FEE_PCT / 100) * price, 0)) / risk;
const kinds = (t: PaperTrade) => t.salidas.map((e) => e.kind);

test("v2: after TP1 the stop is the entry; coming back to it closes the rest at break-even, not at the plan's stop", () => {
  // Candle 1 cashes TP1 and stays above the entry; candle 2 comes back through the entry (still far above the plan's stop).
  const t = resolvePaper(trade(), [c(1, 106, 100.5), c(2, 104, 99.5)], far);
  assert.equal(t.estado, "CERRADA");
  assert.deepEqual(kinds(t), ["TP1", "BE"]);
  assert.deepEqual(t.salidas.map((e) => Number(e.fraction.toFixed(4))), [0.3333, 0.6667]);
  assert.equal(t.salidas[1].price, 100, "the rest leaves at the entry");
  assert.equal(t.cerradaA, T0 + 3 * H);
  const expected = 1 / 3 - fee(100, [[105, 1 / 3], [100, 2 / 3]], 5);
  assert.ok(Math.abs(t.resultadoR! - expected) < 1e-9, `${t.resultadoR} vs ${expected}`);
  assert.ok(t.resultadoR! > 0, "a trade that cashed TP1 never ends in a loss");
  assert.match(t.motivoCierre!, /equilibrio/);
});

test("v2: the R is still measured against the plan's original risk", () => {
  const t = resolvePaper(trade(), [c(1, 106, 100.5), c(2, 104, 99.5)], far);
  const again = resultOf(t, t.salidas);
  assert.equal(again, t.resultadoR);
  assert.equal(t.stop, 95, "the plan is never edited: the stop in force is a different thing");
  assert.equal(stopNow(t), 100);
  assert.equal(stopNow(trade()), 95, "before TP1 the plan's stop rules");
});

test("v2 worst case: the candle that cashes TP1 and also touches the entry closes the rest at the entry, before any later target of that candle", () => {
  // The order inside the candle is unknown: TP1 may have come first and the price back to the entry before TP2.
  const t = resolvePaper(trade(), [c(1, 111, 99), c(2, 120, 100)], far);
  assert.deepEqual(kinds(t), ["TP1", "BE"], "TP2 in the same candle does not count");
  assert.equal(t.cerradaA, T0 + 2 * H);
  assert.ok(t.resultadoR! > 0);
});

test("v2: a candle that touches the plan's stop and TP1 counts as the stop (worst case first, as always)", () => {
  const t = resolvePaper(trade(), [c(1, 106, 94)], far);
  assert.deepEqual(kinds(t), ["STOP"]);
  assert.ok(Math.abs(t.resultadoR! - (-1 - fee(100, [[95, 1]], 5))) < 1e-9);
});

test("v2: with the stop at the entry, targets keep paying until the price comes back", () => {
  const t = resolvePaper(trade(), [c(1, 106, 100.5), c(2, 111, 101), c(3, 104, 99)], far);
  assert.deepEqual(kinds(t), ["TP1", "TP2", "BE"]);
  assert.deepEqual(t.salidas.map((e) => Number(e.fraction.toFixed(4))), [0.3333, 0.3333, 0.3333]);
  const expected = (1 + 2 + 0) / 3 - fee(100, [[105, 1 / 3], [110, 1 / 3], [100, 1 / 3]], 5);
  assert.ok(Math.abs(t.resultadoR! - expected) < 1e-9, `${t.resultadoR} vs ${expected}`);
  // All three targets in a row: no break-even involved.
  const all = resolvePaper(trade(), [c(1, 106, 100.5), c(2, 111, 101), c(3, 116, 108)], far);
  assert.deepEqual(kinds(all), ["TP1", "TP2", "TP3"]);
});

test("v2: shorts mirror longs", () => {
  const s = trade({ lado: "SHORT", entrada: 100, stop: 105, tp: [95, 90, 85] });
  const t = resolvePaper(s, [c(1, 99.5, 94), c(2, 100.5, 96)], far);
  assert.deepEqual(kinds(t), ["TP1", "BE"]);
  assert.equal(t.salidas[1].price, 100);
  assert.ok(Math.abs(t.resultadoR! - (1 / 3 - fee(100, [[95, 1 / 3], [100, 2 / 3]], 5))) < 1e-9);
  const same = resolvePaper(s, [c(1, 101, 94)], far);
  assert.deepEqual(kinds(same), ["TP1", "BE"], "same candle: TP1 and back to the entry");
  const stopFirst = resolvePaper(s, [c(1, 106, 94)], far);
  assert.deepEqual(kinds(stopFirst), ["STOP"]);
});

test("v1 trades (saved before the rules changed) keep a fixed stop: nothing moves after TP1", () => {
  const legacy = trade({ gestion: undefined, reglas: undefined });
  delete legacy.gestion;
  delete legacy.reglas;
  const open = resolvePaper(legacy, [c(1, 106, 100.5), c(2, 104, 99.5)], far);
  assert.equal(open.estado, "ABIERTA", "back at the entry is not an exit for them");
  assert.deepEqual(kinds(open), ["TP1"]);
  const done = resolvePaper(open, [c(3, 104, 94)], far);
  assert.deepEqual(kinds(done), ["TP1", "STOP"]);
  assert.equal(stopNow(legacy), 95);
});

test("v2 no lookahead: a break-even needs a candle that had already closed; resolving in pieces gives the same as at once", () => {
  const candles = [c(1, 106, 100.5), c(2, 104, 99.5), c(3, 140, 60)];
  // At the end of candle 1 only TP1 is known; the return to the entry is in candle 2, still in the future.
  const early = resolvePaper(trade(), candles, T0 + 2 * H);
  assert.equal(early.estado, "ABIERTA");
  assert.deepEqual(kinds(early), ["TP1"]);
  // Candle 3 is the wildest, but it comes after the close: it can never change what already happened.
  const mid = resolvePaper(early, candles, T0 + 3 * H);
  assert.deepEqual(kinds(mid), ["TP1", "BE"]);
  assert.equal(mid.estado, "CERRADA");
  const once = resolvePaper(trade(), candles, far);
  assert.deepEqual(once.salidas, mid.salidas);
  assert.equal(once.resultadoR, mid.resultadoR);
  // Until the close of a candle, the candle does not exist.
  const until = resolvePaper(trade(), candles, far, null, H, T0 + 2 * H);
  assert.deepEqual(kinds(until), ["TP1"]);
});

test("v2 audit: a break-even is a win with its reason, and the lesson changes no rule", () => {
  const t = resolvePaper(trade(), [c(1, 106, 100.5), c(2, 104, 99.5)], far);
  const a = auditOf(t);
  assert.equal(a.veredicto, "ACIERTO");
  assert.match(a.resultado, /BE 100 \(stop en la entrada\)/);
  assert.match(a.aprendizaje, /equilibrio/);
  assert.match(a.aprendizaje, /las reglas de la mesa no cambian solas/);
  assert.ok(paperCsv([t]).includes("BE@100"));
});

test("v2 server: BE exits only with the BE_TP1 management, after TP1, at the entry; the result is recomputed", () => {
  const closed = resolvePaper(trade(), [c(1, 106, 100.5), c(2, 104, 99.5)], far);
  const now = far;
  const ok = validatePaper({ ...closed, resultadoR: 99 }, now)!;
  assert.ok(ok, "a legitimate break-even is accepted");
  assert.equal(ok.resultadoR, closed.resultadoR, "never the result the browser sends");
  assert.equal(ok.gestion, "BE_TP1");
  assert.equal(ok.reglas, DESK_RULES);
  const bad = (over: Record<string, unknown>) => validatePaper({ ...closed, ...over }, now);
  assert.equal(bad({ salidas: [closed.salidas[0], { ...closed.salidas[1], price: 101 }] }), null, "BE at another price");
  const noManagement = { ...closed } as Partial<PaperTrade>;
  delete noManagement.gestion;
  assert.equal(validatePaper(noManagement, now), null, "BE without the management is forged");
  assert.equal(bad({ salidas: [{ ...closed.salidas[1], fraction: 1 }] }), null, "BE without TP1 before it");
  assert.equal(bad({ salidas: [closed.salidas[0], { ...closed.salidas[1], kind: "STOP", price: 95 }] }), null, "after TP1 the stop is the entry, never the plan's stop");
  assert.equal(bad({ gestion: "TRAIL" }), null);
  assert.equal(bad({ reglas: 0 }), null);
  assert.equal(bad({ reglas: 2.5 }), null);
  // A v1 trade (no management, no version) is still accepted, with its fixed stop.
  const legacy = trade({ salidas: [{ kind: "TP1", price: 105, at: T0 + 2 * H, fraction: 1 / 3 }, { kind: "STOP", price: 95, at: T0 + 3 * H, fraction: 2 / 3 }], estado: "CERRADA", llenadaA: T0 + H, cerradaA: T0 + 3 * H });
  delete legacy.gestion;
  delete legacy.reglas;
  const accepted = validatePaper(legacy, now)!;
  assert.ok(accepted);
  assert.equal(accepted.gestion, undefined);
});

test("v2 server: how the stop is managed is frozen with the plan, like the plan itself", () => {
  const stored = trade();
  const progressed = resolvePaper(stored, [c(1, 106, 100.5)], far);
  assert.ok(mergeProgress(stored, progressed, far), "honest progress is merged");
  const swapped = { ...progressed } as Partial<PaperTrade>;
  delete swapped.gestion;
  assert.equal(mergeProgress(stored, swapped as PaperTrade, far), null, "a v2 trade cannot be turned into a v1 one");
  const legacy = { ...stored } as Partial<PaperTrade>;
  delete legacy.gestion;
  delete legacy.reglas;
  assert.equal(mergeProgress(legacy as PaperTrade, { ...legacy, gestion: "BE_TP1" } as PaperTrade, far), null, "nor a v1 trade into a v2 one");
});

// ── The plan and the decision ──

const H1 = 3_600_000;
const path = (f: (i: number) => number, n: number, t0 = T0): SwingCandle[] =>
  Array.from({ length: n }, (_, i) => {
    const o = f(i);
    const cl = f(i + 1);
    return { openTime: t0 + i * H1, open: o, high: Math.max(o, cl) * 1.003, low: Math.min(o, cl) * 0.997, close: cl, volume: 100 + (i % 9) * 10, quoteVolume: (100 + (i % 9) * 10) * cl };
  });

function snapshot(h1: SwingCandle[]): DeskSnapshot {
  return {
    symbol: "SOLUSDT",
    now: h1[h1.length - 1].openTime + H1 + 1000,
    candles: { h1, h4: aggregate(h1, 4), d1: aggregate(h1, 24) },
    btc: path((i) => 60_000 * 1.0004 ** i + 300 * Math.sin(i / 7), h1.length),
    eth: path((i) => 3_000 * 1.0005 ** i + 20 * Math.sin(i / 5), h1.length),
    derivatives: null,
    macro: { btcDominance: null, usdtDominance: null, marketCapChange24h: null, events: null, calendarSource: null },
    news: null,
    fearGreed: null,
    sources: ["prueba"],
  };
}

test("v2 constants: stop at 1 ATR from the level, minimum consensus ±0,30, rules version 2", () => {
  assert.equal(DESK_RULES, 2);
  assert.equal(STOP_BUFFER_ATR, 1);
  assert.equal(CONSENSUS_EDGE, 0.3);
  assert.match(MANAGEMENT_TEXT, /el stop pasa a la entrada/);
});

const lvl = (kind: Level["kind"], price: number, low: number, high: number): Level => ({ price, low, high, kind, score: 5, stars: 2, sources: [], distancePct: 0 });

test("v2 stop: behind the level that defends it with a margin of 1 ATR; without a level, 1,5 ATR", () => {
  const base = analyzeAsset("SOLUSDT", { h1: path((i) => 100 * 1.0015 ** i + 2 * Math.sin(i / 6), 1000) }, T0 + 1001 * H1)!;
  const a = { ...base, read: { ...base.read, price: 100 }, levels: { supports: [lvl("SOPORTE", 90, 89, 91)], resistances: [lvl("RESISTENCIA", 110, 109, 111)] } };
  const atr = 2;
  const long = buildPlan("LONG", a, atr)!;
  assert.equal(long.stop, 89 - STOP_BUFFER_ATR * atr, "below the lowest edge of the support");
  assert.match(long.stopRazon, /con un margen de 1 ATR de 4 h/);
  const short = buildPlan("SHORT", a, atr)!;
  assert.equal(short.stop, 111 + STOP_BUFFER_ATR * atr, "above the highest edge of the resistance");
  const bare = { ...a, levels: { supports: [], resistances: [] } };
  assert.equal(buildPlan("LONG", bare, atr)!.stop, 100 - 1.5 * atr);
  assert.equal(buildPlan("SHORT", bare, atr)!.stop, 100 + 1.5 * atr);
});

test("v2 consensus: below ±0,30 the desk waits and gives no plan; at ±0,30 or more it can take a side", () => {
  let inBand = 0;
  let taken = 0;
  for (const g of [1.0015, 1.001, 1.0007, 1.0004, 1.0002, 0.9998, 0.9995, 0.999, 0.9985]) {
    for (const amp of [2, 6, 12]) {
      const d = runDesk(snapshot(path((i) => 100 * g ** i + amp * Math.sin(i / 6), 1000)));
      assert.ok(d);
      if (Math.abs(d.consenso) < CONSENSUS_EDGE) {
        assert.equal(d.direccion, "ESPERAR", `${g}/${amp}: consenso ${d.consenso}`);
        assert.equal(d.plan, null);
        assert.match(d.resolucion, /al menos 0,3 para tomar un lado/);
        if (Math.abs(d.consenso) >= 0.15) inBand += 1;
      } else if (d.direccion === "LONG" || d.direccion === "SHORT") {
        taken += 1;
        assert.ok(Math.abs(d.consenso) >= CONSENSUS_EDGE);
        assert.match(d.plan!.stopRazon, /margen de 1 ATR de 4 h|a 1,5 ATR de 4 h/);
      }
    }
  }
  assert.ok(inBand > 0, "the test must cover the band the old minimum (±0,15) would have traded");
  assert.ok(taken > 0, "and some decision above the new minimum");
});

test("v2 risk manager: a plan against the consensus is vetoed from ±0,15 (not from ±0,30), so it never trades against a moderate consensus", () => {
  const plan: Plan = { lado: "LONG", entrada: 100, tipoEntrada: "MERCADO", stop: 97, stopRazon: "prueba", tp: [{ price: 106, label: "a" }, { price: 109, label: "b" }, { price: 112, label: "c" }], obstaculos: [] };
  const ctx = (consensus: number) => ({ atr: 2, regime: "NORMAL" as const, events: [], now: T0, fundingPct: null, longShort: null, coverage: 1, consensus });
  const against = (consensus: number) => reviewRisk(plan, ctx(consensus), DEFAULT_DESK_SETTINGS).vetos.some((v) => /va en contra de este lado/.test(v));
  assert.equal(against(-0.2), true, "−0,20: moderate, but against");
  assert.equal(against(-0.15), true);
  assert.equal(against(-0.1), false, "a weak opinion against does not veto");
  assert.equal(against(0.5), false, "in favor");
  const d = runDesk(snapshot(path((i) => 100 * 1.0007 ** i + 12 * Math.sin(i / 6), 1000)))!;
  assert.ok(d.consenso >= CONSENSUS_EDGE);
  assert.ok(d.bajista.riesgo?.vetos.some((v) => /va en contra de este lado/.test(v)), "the scenario against the consensus is shown vetoed");
});
