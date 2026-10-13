import assert from "node:assert/strict";
import test from "node:test";
import { aggregate } from "../lib/asset-read.ts";
import { capitalAtRisk, council, gates, record, SESGO_MINIMO, signed, tape } from "../lib/jarvis-council.ts";
import { AGENT_WEIGHTS, consensus, type AgentId, type AgentReport } from "../lib/jarvis-desk-agents.ts";
import type { DeskSnapshot } from "../lib/jarvis-desk-data.ts";
import { AGAINST_EDGE, CONSENSUS_EDGE, DEFAULT_DESK_SETTINGS, MAX_OPEN_RISK_PCT, runDesk, type DeskDecision } from "../lib/jarvis-desk.ts";
import { MIN_SAMPLE, openR, type PaperTrade } from "../lib/jarvis-paper.ts";
import type { SwingCandle } from "../lib/swing-entries.ts";

/**
 * El tablero de mando (lib/jarvis-council.ts) no calcula nada nuevo sobre el
 * mercado: reordena los números de la mesa. Estas pruebas fijan que lo que
 * muestra cierra con lo que la mesa decidió.
 */

const H = 3_600_000;
const T0 = Date.UTC(2026, 8, 1);
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} no está cerca de ${b}`);

// ── Especialistas armados a mano ──

const ALL: AgentId[] = ["tecnico", "estructura", "volumen", "derivados", "liquidaciones", "macro", "noticias", "sentimiento", "correlacion", "volatilidad"];
const NAME: Record<AgentId, string> = { tecnico: "Técnico", estructura: "Estructura", volumen: "Volumen", derivados: "Derivados", liquidaciones: "Liquidaciones", macro: "Macro", noticias: "Noticias", sentimiento: "Sentimiento", correlacion: "Correlación", volatilidad: "Volatilidad" };

const rep = (id: AgentId, sesgo: number, over: Partial<AgentReport> = {}): AgentReport => ({
  id,
  nombre: NAME[id],
  disponible: true,
  sesgo,
  peso: AGENT_WEIGHTS[id],
  hallazgos: [`${NAME[id]} encontró algo`],
  faltantes: [],
  datos: {},
  ...over,
});
const sinDatos = (id: AgentId): AgentReport => rep(id, 0, { disponible: false, peso: 0, hallazgos: [], faltantes: ["el dato"] });

/** La decisión mínima que mira el consejo: los especialistas y el consenso que la mesa calculó con ellos. */
const viewOf = (agentes: AgentReport[]) => {
  const c = consensus(agentes);
  return { agentes, consenso: c.value, cobertura: c.coverage };
};

test("the weights of the voters add up to 1 and their contributions add up to the desk's consensus", () => {
  const agentes = [rep("estructura", 0.6), rep("tecnico", 0.4), rep("derivados", -0.5), rep("volumen", 0.2), rep("macro", 0), sinDatos("liquidaciones"), sinDatos("noticias"), rep("sentimiento", 0.3), rep("correlacion", 0.1), rep("volatilidad", 0)];
  const v = viewOf(agentes);
  const c = council(v);
  const voters = c.votos.filter((x) => x.estado === "VOTA");
  near(voters.reduce((p, x) => p + x.parte, 0), 1);
  assert.ok(Math.abs(voters.reduce((p, x) => p + x.aporte, 0) - c.consenso) < 5e-4, "the contributions are the consensus");
  assert.equal(c.consenso, v.consenso);
  // Weight shares are the effective weights over what the voters add up to (0,9 here: two specialists had no data, one does not vote).
  near(c.votos.find((x) => x.id === "estructura")!.parte, 0.25 / 0.9);
  near(c.votos.find((x) => x.id === "sentimiento")!.parte, 0.05 / 0.9);
  // The same weight shares the desk uses to count who agrees.
  const desk = consensus(agentes);
  near(c.alcista, desk.agreeLong);
  near(c.bajista, desk.agreeShort);
  near(c.alcista + c.bajista + c.neutral, 1);
  near(c.cobertura, desk.coverage);
  assert.equal(c.minimo, CONSENSUS_EDGE);
  assert.equal(c.vetoContra, AGAINST_EDGE);
});

test("who votes, who gives context and who had no data are told apart; the order puts the heaviest vote first", () => {
  const agentes = [rep("estructura", 0.6), rep("tecnico", 0.4), rep("derivados", -0.5), rep("volumen", 0.2), rep("macro", 0), sinDatos("liquidaciones"), sinDatos("noticias"), rep("sentimiento", 0.3), rep("correlacion", 0.1), rep("volatilidad", 0, { peso: 0 })];
  const c = council(viewOf(agentes));
  assert.equal(c.votan, 7);
  assert.equal(c.sinDatos, 2);
  const state = (id: AgentId) => c.votos.find((x) => x.id === id)!;
  assert.equal(state("volatilidad").estado, "CONTEXTO");
  assert.equal(state("volatilidad").parte, 0);
  assert.equal(state("liquidaciones").estado, "SIN DATOS");
  assert.equal(state("liquidaciones").sesgo, null, "no data is not a vote of zero");
  assert.equal(state("liquidaciones").aporte, 0);
  assert.deepEqual(c.votos.map((x) => x.id), ["estructura", "tecnico", "derivados", "volumen", "macro", "sentimiento", "correlacion", "volatilidad", "liquidaciones", "noticias"]);
  // Under the minimum stated by the desk: a lean, but no side.
  assert.equal(c.inclinacion, "ALCISTA");
  assert.equal(c.lado, null);
  assert.ok(c.margen < 0);
  assert.match(c.resumen, /faltan 0,08/);
  assert.match(c.resumen, /espera/);
  // Whoever pushes the other way is named as a dissenter, with the first thing it found.
  assert.deepEqual(c.disidentes.map((x) => x.id), ["derivados"]);
  assert.equal(c.disidentes[0].hallazgo, "Derivados encontró algo");
  assert.equal(state("macro").frente, "NEUTRAL");
  assert.equal(state("macro").postura, "NEUTRAL");
  assert.deepEqual(c.pivotales, [], "no side taken, nothing to hang by a thread");
  assert.equal(c.fragilidad, null);
});

test("a consensus just over the minimum names the specialists who tip it, and says so", () => {
  // estructura 0,25·1 + técnico 0,2·0,5 − derivados 0,15·0,3 + volumen 0,1·0,1 + correlación 0,05·0,2 = 0,325
  const agentes = [rep("estructura", 1), rep("tecnico", 0.5), rep("derivados", -0.3), rep("volumen", 0.1), rep("macro", 0), rep("correlacion", 0.2), rep("noticias", 0), rep("sentimiento", 0), rep("liquidaciones", 0), rep("volatilidad", 0)];
  const c = council(viewOf(agentes));
  assert.equal(c.consenso, 0.325);
  assert.equal(c.lado, "LONG");
  assert.equal(c.margen, 0.025);
  assert.deepEqual(c.pivotales.map((p) => p.id), ["estructura", "tecnico"]);
  assert.equal(c.pivotales[0].sinSuVoto, 0.075);
  assert.equal(c.pivotales[1].sinSuVoto, 0.225);
  assert.ok(c.pivotales.every((p) => Math.abs(p.sinSuVoto) < CONSENSUS_EDGE), "without them the desk would not take the side");
  assert.match(c.fragilidad!, /Decisión ajustada/);
  assert.match(c.fragilidad!, /estructura/);
  assert.match(c.resumen, /supera por 0,03 el mínimo de 0,30/);
  assert.match(c.resumen, /LONG/);
});

test("the short side is the mirror image", () => {
  const agentes = [rep("estructura", -0.9), rep("tecnico", -0.6), rep("derivados", 0.2), rep("volumen", -0.2), rep("macro", -0.1), rep("liquidaciones", 0), rep("noticias", 0), rep("sentimiento", 0), rep("correlacion", -0.3), rep("volatilidad", 0)];
  const c = council(viewOf(agentes));
  assert.ok(c.consenso <= -CONSENSUS_EDGE);
  assert.equal(c.lado, "SHORT");
  assert.equal(c.inclinacion, "BAJISTA");
  assert.ok(c.bajista > c.alcista);
  assert.deepEqual(c.disidentes.map((x) => x.id), ["derivados"]);
  assert.equal(c.votos.find((x) => x.id === "estructura")!.frente, "A FAVOR");
  // The surplus is measured on the absolute value.
  near(c.margen, Math.abs(c.consenso) - CONSENSUS_EDGE, 1e-9);
});

test("a push smaller than the desk's own threshold counts as neutral, the same way the desk counts who agrees", () => {
  assert.equal(SESGO_MINIMO, 0.05);
  const agentes = [rep("estructura", 0.04), rep("tecnico", -0.04), rep("derivados", 0.05), rep("volumen", 0), rep("macro", 0), rep("liquidaciones", 0), rep("noticias", 0), rep("sentimiento", 0), rep("correlacion", 0), rep("volatilidad", 0)];
  const c = council(viewOf(agentes));
  const desk = consensus(agentes);
  near(c.alcista, desk.agreeLong);
  near(c.bajista, desk.agreeShort);
  assert.equal(c.votos.find((x) => x.id === "estructura")!.postura, "NEUTRAL");
  assert.equal(c.votos.find((x) => x.id === "derivados")!.postura, "ALCISTA");
});

test("when nobody has data there is no consensus, and the board says so instead of showing a made-up number", () => {
  const c = council(viewOf(ALL.map(sinDatos)));
  assert.equal(c.votan, 0);
  assert.equal(c.consenso, 0);
  assert.equal(c.cobertura, 0);
  assert.equal(c.lado, null);
  assert.equal(c.alcista + c.bajista + c.neutral, 0);
  assert.match(c.resumen, /Este dato no está disponible actualmente/);
});

// ── Las compuertas ──

/** Una decisión armada a mano: las compuertas solo miran el consenso, el plan y el riesgo. */
function decision(over: { consenso: number; plan?: boolean; vetos?: string[]; esperas?: string[]; riesgoUsd?: number | null }): DeskDecision {
  const plan = over.plan === false ? null : { lado: over.consenso < 0 ? "SHORT" : "LONG", entrada: 100, tipoEntrada: "MERCADO", stop: 95, stopRazon: "x", tp: [{ price: 105, label: "a" }, { price: 110, label: "b" }, { price: 115, label: "c" }], obstaculos: [] };
  const riesgo = over.plan === false ? null : { lado: plan!.lado, rrPonderado: 2, nivel: "MEDIO", vetos: over.vetos ?? [], esperas: over.esperas ?? [], avisos: [], riesgoUsd: over.riesgoUsd ?? null };
  // La dirección que la mesa daría con esos datos: sin lado, ESPERAR; un veto, NO TRADE; un pedido de esperar, ESPERAR; si no, el lado del plan.
  const direccion = Math.abs(over.consenso) < CONSENSUS_EDGE ? "ESPERAR" : !plan ? "NO TRADE" : (over.vetos ?? []).length ? "NO TRADE" : (over.esperas ?? []).length ? "ESPERAR" : plan.lado;
  return { consenso: over.consenso, direccion, plan, riesgo, agentes: [], cobertura: 1 } as unknown as DeskDecision;
}
const states = (d: DeskDecision) => gates(d).map((g) => g.estado);

test("the gates stop at the first one that fails and leave the rest unevaluated", () => {
  assert.deepEqual(states(decision({ consenso: 0.18 })), ["FALLA", "NO EVALUADA", "NO EVALUADA", "NO EVALUADA"]);
  assert.deepEqual(states(decision({ consenso: 0.4, plan: false })), ["OK", "FALLA", "NO EVALUADA", "NO EVALUADA"]);
  assert.deepEqual(states(decision({ consenso: 0.4, vetos: ["Stop demasiado lejos."] })), ["OK", "OK", "FALLA", "NO EVALUADA"]);
  assert.deepEqual(states(decision({ consenso: -0.4, esperas: ["Hay un evento en 1 h."] })), ["OK", "OK", "OK", "FALLA"]);
  assert.deepEqual(states(decision({ consenso: -0.4 })), ["OK", "OK", "OK", "OK"]);
  // Exactly at the minimum the desk takes the side.
  assert.equal(gates(decision({ consenso: CONSENSUS_EDGE }))[0].estado, "OK");
  assert.equal(gates(decision({ consenso: -CONSENSUS_EDGE }))[0].estado, "OK");
  assert.equal(gates(decision({ consenso: 0.299 }))[0].estado, "FALLA");
});

test("each gate says why, with the numbers of the desk", () => {
  const g = gates(decision({ consenso: 0.18 }));
  assert.match(g[0].detalle, /\+0,18/);
  assert.match(g[0].detalle, /faltan 0,12/);
  const v = gates(decision({ consenso: 0.4, vetos: ["Stop demasiado lejos (4,2%)."] }));
  assert.match(v[2].detalle, /^Veto: Stop demasiado lejos/);
  const w = gates(decision({ consenso: 0.4, esperas: ["Hay un evento en 1 h."] }));
  assert.match(w[3].detalle, /^Esperar: Hay un evento/);
  const ok = gates(decision({ consenso: 0.4 }));
  assert.match(ok[1].detalle, /LONG: entrada 100, stop 95 y tres objetivos/);
  assert.match(ok[2].detalle, /R:R 1:2 \(mínimo 1:1,5\) · riesgo MEDIO/);
});

// ── La mesa de verdad ──

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

const FIXTURES: [string, SwingCandle[]][] = [
  ["a steady advance", path((i) => 100 * 1.0015 ** i + 2 * Math.sin(i / 6), 1000)],
  ["a steady decline", path((i) => 300 * 0.9985 ** i + 2 * Math.sin(i / 6), 1000)],
  ["a sideways range", path((i) => 100 + 3 * Math.sin(i / 9), 1000)],
  ["a slow advance with big swings", path((i) => 100 * 1.0004 ** i + 8 * Math.sin(i / 11) + 3 * Math.sin(i / 3), 1000)],
];

test("on the real desk: the board adds up to the desk's consensus and the gates reproduce its decision", () => {
  for (const [name, h1] of FIXTURES) {
    for (const settings of [DEFAULT_DESK_SETTINGS, { ...DEFAULT_DESK_SETTINGS, capital: 5000 }]) {
      const d = runDesk(snapshot(h1), settings)!;
      const c = council(d);
      assert.equal(c.consenso, d.consenso, name);
      assert.ok(Math.abs(c.votos.reduce((p, x) => p + x.aporte, 0) - d.consenso) < 5e-4, `${name}: the contributions add up to ${d.consenso}`);
      near(c.votos.filter((x) => x.estado === "VOTA").reduce((p, x) => p + x.parte, 0), 1, 1e-9);
      assert.equal(c.lado, d.consenso >= CONSENSUS_EDGE ? "LONG" : d.consenso <= -CONSENSUS_EDGE ? "SHORT" : null, name);
      assert.equal(c.votos.length, d.agentes.length, "every specialist shows up, voting or not");
      // The gates give the same direction the desk gave.
      const g = gates(d);
      const dir = g[0].estado === "FALLA" ? "ESPERAR" : g[1].estado === "FALLA" || g[2].estado === "FALLA" ? "NO TRADE" : g[3].estado === "FALLA" ? "ESPERAR" : d.plan!.lado;
      assert.equal(dir, d.direccion, `${name}: gates ${g.map((x) => x.estado).join("/")}`);
    }
  }
});

test("on the real desk the missing data are kept out of the vote and said, never filled in", () => {
  const d = runDesk(snapshot(FIXTURES[0][1]))!;
  const c = council(d);
  const none = c.votos.filter((x) => x.estado === "SIN DATOS");
  assert.ok(none.length > 0, "this fixture has no derivatives, news or calendar");
  for (const v of none) {
    assert.equal(v.sesgo, null);
    assert.equal(v.parte, 0);
    assert.equal(v.aporte, 0);
    assert.ok(v.falta.length > 0, `${v.nombre} says what it lacked`);
  }
  assert.ok(c.cobertura < 1);
});

// ── Capital en riesgo ──

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
    analisis: { direccionMesa: "LONG", consenso: 0.4, cobertura: 0.9, regimen: "NORMAL", sesgos: { tecnico: 0.5 }, motivo: "prueba", razonamiento: ["a"], fuentes: ["prueba"] },
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
    ...over,
  };
}
const withRisk = (usd: number | null): PaperTrade["decision"] => ({ riesgoNivel: "BAJO", apalancamiento: 3, riesgoUsd: usd, posicionUsd: 200, stopPct: 5 });
const noPrice = () => null;

test("capital at risk: only what is open or waiting to fill counts, and an unknown risk is told, not counted as zero", () => {
  const trades = [
    trade({ id: "a", decision: withRisk(10) }),
    trade({ id: "b", estado: "PENDIENTE", tipoEntrada: "LÍMITE", llenadaA: null, decision: withRisk(15) }),
    trade({ id: "c", symbol: "ETHUSDT", decision: withRisk(null) }),
    trade({ id: "d", estado: "CERRADA", lado: "SHORT", resultadoR: -1, decision: withRisk(99) }),
    trade({ id: "e", estado: "CANCELADA", decision: withRisk(99) }),
  ];
  const k = capitalAtRisk(trades, { ...DEFAULT_DESK_SETTINGS, capital: 1000 }, null, noPrice);
  assert.equal(k.abiertas, 3);
  assert.equal(k.largos, 3);
  assert.equal(k.cortos, 0);
  assert.equal(k.riesgoAbiertoUsd, 25);
  assert.equal(k.riesgoAbiertoPct, 2.5);
  assert.equal(k.sinRiesgoCalculado, 1);
  assert.equal(k.limitePct, MAX_OPEN_RISK_PCT);
  assert.ok(k.notas.some((n) => /no tiene el riesgo calculado/.test(n) && /no es cero/.test(n)));
  assert.ok(k.notas.some((n) => /Las 3 abiertas son LONG/.test(n)));
  assert.equal(k.conEsta, null, "no decision, nothing to add");
  // Same trades, no capital loaded: dollars are known but the share of the capital is not.
  const sin = capitalAtRisk(trades, { ...DEFAULT_DESK_SETTINGS, capital: null }, null, noPrice);
  assert.equal(sin.riesgoAbiertoUsd, 25);
  assert.equal(sin.riesgoAbiertoPct, null);
  assert.ok(sin.notas.some((n) => /Cargá tu capital/.test(n)));
});

test("capital at risk: adding the card's trade is projected against the limit of the desk", () => {
  const open = [trade({ id: "a", decision: withRisk(10) }), trade({ id: "b", lado: "SHORT", decision: withRisk(15) })];
  const d = decision({ consenso: 0.4, riesgoUsd: 30 });
  const k = capitalAtRisk(open, { ...DEFAULT_DESK_SETTINGS, capital: 1000 }, d, noPrice);
  assert.deepEqual(k.conEsta, { riesgoUsd: 30, totalUsd: 55, totalPct: 5.5, superaLimite: true });
  assert.ok(k.notas.some((n) => /pasaría del 5%/.test(n)));
  assert.ok(k.notas.some((n) => /sumaría otra LONG/.test(n)));
  assert.ok(!k.notas.some((n) => /abiertas son/.test(n)), "one long and one short are not the same side");
  const holgado = capitalAtRisk(open, { ...DEFAULT_DESK_SETTINGS, capital: 10_000 }, d, noPrice);
  assert.equal(holgado.conEsta!.superaLimite, false);
  assert.equal(holgado.conEsta!.totalPct, 0.55);
  // Without capital the share is unknown, so there is no verdict about the limit.
  const sinCapital = capitalAtRisk(open, DEFAULT_DESK_SETTINGS, d, noPrice);
  assert.equal(sinCapital.conEsta!.totalPct, null);
  assert.equal(sinCapital.conEsta!.superaLimite, null);
  // A card that is not an approved trade (vetoed or waiting) is not something to follow in paper: it adds no risk.
  const vetada = decision({ consenso: 0.4, riesgoUsd: 30, vetos: ["Stop demasiado lejos."] });
  assert.equal(vetada.direccion, "NO TRADE");
  assert.equal(capitalAtRisk(open, { ...DEFAULT_DESK_SETTINGS, capital: 1000 }, vetada, noPrice).conEsta, null);
  const esperando = decision({ consenso: 0.4, riesgoUsd: 30, esperas: ["Hay un evento en 1 h."] });
  assert.equal(esperando.direccion, "ESPERAR");
  assert.equal(capitalAtRisk(open, { ...DEFAULT_DESK_SETTINGS, capital: 1000 }, esperando, noPrice).conEsta, null);
  // A decision without a computed risk adds nothing and invents nothing.
  assert.equal(capitalAtRisk(open, { ...DEFAULT_DESK_SETTINGS, capital: 1000 }, decision({ consenso: 0.4, riesgoUsd: null }), noPrice).conEsta, null);
});

test("capital at risk: the result of the open ones uses the last known price and says which ones have none", () => {
  const a = trade({ id: "a", symbol: "SOLUSDT" });
  const b = trade({ id: "b", symbol: "ETHUSDT", lado: "SHORT", stop: 105, tp: [95, 90, 85] });
  const price = (s: string) => (s === "SOLUSDT" ? 105 : null);
  const k = capitalAtRisk([a, b], { ...DEFAULT_DESK_SETTINGS, capital: 1000 }, null, price);
  near(k.resultadoAbiertoR!, openR(a, 105)!);
  assert.equal(k.sinPrecio, 1);
  assert.ok(k.notas.some((n) => /Sin precio reciente de 1 operación abierta/.test(n)));
  const ninguno = capitalAtRisk([a, b], DEFAULT_DESK_SETTINGS, null, noPrice);
  assert.equal(ninguno.resultadoAbiertoR, null, "no price at all: unknown, not zero");
  assert.equal(capitalAtRisk([], DEFAULT_DESK_SETTINGS, null, noPrice).resultadoAbiertoR, null);
  assert.equal(capitalAtRisk([], DEFAULT_DESK_SETTINGS, null, noPrice).abiertas, 0);
});

// ── La cinta ──

test("the tape lists the latest paper trades newest first, with what each one is doing", () => {
  const trades = [
    trade({ id: "vieja", abiertaA: T0, estado: "CERRADA", resultadoR: 1.2, salidas: [{ kind: "TP1", price: 105, at: T0 + H, fraction: 1 / 3 }, { kind: "BE", price: 100, at: T0 + 2 * H, fraction: 2 / 3 }] }),
    trade({ id: "perdida", abiertaA: T0 + H, estado: "CERRADA", lado: "SHORT", resultadoR: -1.04, salidas: [{ kind: "STOP", price: 105, at: T0 + 2 * H, fraction: 1 }] }),
    trade({ id: "limite", abiertaA: T0 + 2 * H, estado: "PENDIENTE", tipoEntrada: "LÍMITE", llenadaA: null }),
    trade({ id: "cancelada", abiertaA: T0 + 3 * H, estado: "CANCELADA" }),
    trade({ id: "enCurso", abiertaA: T0 + 4 * H, symbol: "ETHUSDT" }),
  ];
  const rows = tape(trades, (s) => (s === "ETHUSDT" ? 103 : null));
  assert.deepEqual(rows.map((r) => r.id), ["enCurso", "cancelada", "limite", "perdida", "vieja"]);
  const byId = (id: string) => rows.find((r) => r.id === id)!;
  assert.equal(byId("vieja").texto, "+1,2 R · TP1 → BE");
  assert.equal(byId("vieja").tono, "up");
  assert.equal(byId("perdida").texto, "−1,04 R · STOP");
  assert.equal(byId("perdida").tono, "down");
  assert.equal(byId("limite").texto, "Orden límite sin llenar");
  assert.equal(byId("limite").tono, "pend");
  assert.equal(byId("limite").r, null);
  assert.equal(byId("cancelada").texto, "Cancelada");
  assert.equal(byId("enCurso").moneda, "ETH");
  near(byId("enCurso").r!, openR(trades[4], 103)!);
  assert.match(byId("enCurso").texto, /R en curso$/);
  // No known price: it says it is open, and does not make up a result.
  const sinPrecio = tape([trades[4]], noPrice)[0];
  assert.equal(sinPrecio.texto, "Abierta");
  assert.equal(sinPrecio.r, null);
  assert.equal(sinPrecio.tono, "flat");
  // The limit trims the list; the original is not reordered.
  assert.equal(tape(trades, noPrice, 2).length, 2);
  assert.equal(trades[0].id, "vieja");
  assert.deepEqual(tape([], noPrice), []);
});

// ── Lo medido ──

test("the measured record always travels with its sample size; below 15 it says «muestra mínima»", () => {
  const closed = (n: number, r: number) => Array.from({ length: n }, (_, i) => trade({ id: `c${i}`, estado: "CERRADA", resultadoR: r }));
  const none = record([]);
  assert.equal(none.muestra, "SIN DATOS");
  assert.equal(none.cerradas, 0);
  assert.equal(none.winRate, null);
  assert.equal(none.faltan, MIN_SAMPLE);
  assert.match(none.nota, /no hay nada medido/);
  assert.match(none.nota, /no son una probabilidad/);
  const few = record(closed(3, 1));
  assert.equal(few.muestra, "MUESTRA MÍNIMA");
  assert.equal(few.faltan, MIN_SAMPLE - 3);
  assert.match(few.nota, /Muestra mínima: 3 de 15/);
  assert.equal(few.winRate, 1, "100% of 3 is shown with its 3, never alone");
  const enough = record([...closed(10, 1), ...closed(5, -1).map((t, i) => ({ ...t, id: `p${i}` }))]);
  assert.equal(enough.muestra, "MUESTRA RAZONABLE");
  assert.equal(enough.cerradas, 15);
  assert.equal(enough.faltan, 0);
  assert.equal(enough.ganadas, 10);
  near(enough.winRate!, 10 / 15);
  assert.match(enough.nota, /no garantiza resultados futuros/);
  // Open or cancelled trades are not results.
  assert.equal(record([trade(), trade({ estado: "CANCELADA" })]).cerradas, 0);
});

test("the board never shows a probability: no field is named like one and the consensus is not presented as a chance", () => {
  const d = runDesk(snapshot(FIXTURES[0][1]), { ...DEFAULT_DESK_SETTINGS, capital: 5000 })!;
  const keys = (v: unknown, out: string[] = []): string[] => {
    if (Array.isArray(v)) v.forEach((x) => keys(x, out));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        out.push(k);
        keys(x, out);
      }
    }
    return out;
  };
  const all = [...keys(council(d)), ...keys(gates(d)), ...keys(capitalAtRisk([trade()], DEFAULT_DESK_SETTINGS, d, noPrice)), ...keys(tape([trade()], noPrice)), ...keys(record([trade()]))];
  assert.ok(all.length > 30);
  assert.deepEqual(all.filter((k) => /prob|azar|chance|acierto|confianza/i.test(k)), []);
  assert.doesNotMatch(council(d).resumen, /probabilidad|%\s+de\s+(éxito|acierto)/i);
});

test("signed numbers use the Argentine comma and the real minus sign", () => {
  assert.equal(signed(0.38), "+0,38");
  assert.equal(signed(-0.125), "−0,13");
  assert.equal(signed(0), "0");
  assert.equal(signed(-0.001), "0", "a value that rounds to zero carries no sign");
  assert.equal(signed(1.2), "+1,2");
});
