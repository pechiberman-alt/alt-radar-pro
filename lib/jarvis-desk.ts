import { arNumber } from "./ai-numbers.ts";
import type { MacroEvent } from "./econ-calendar.ts";
import { analyzeAsset, type Analysis } from "./jarvis-analyst.ts";
import { arTime, consensus, framesOf, n2, pct, px, runAgents, upcomingHighImpact, type AgentReport, type VolRegime } from "./jarvis-desk-agents.ts";
import { DESK_FRAMES, type DeskSnapshot } from "./jarvis-desk-data.ts";
import { closedOnly } from "./jarvis-core.ts";
import { atrOf } from "./level-engine.ts";

/**
 * JARVIS TRADING · la mesa. Coordina a los especialistas (jarvis-desk-agents),
 * hace debatir al analista alcista con el bajista, y el gestor de riesgo —que
 * manda sobre todos— decide si hay operación: LONG, SHORT, ESPERAR o NO TRADE.
 *
 * Reglas que no se negocian:
 * - Todo número sale de datos medidos (velas cerradas, derivados, calendario).
 *   Lo que falta se lista; nunca se rellena.
 * - El "puntaje" es de confluencia (cuánto coinciden los especialistas y con
 *   qué fuerza), NO una probabilidad. La probabilidad medida es "historial":
 *   el acierto real de setups parecidos, con su muestra.
 * - Una confianza alta nunca alcanza sola: si el riesgo no cierra, es NO TRADE.
 * - Esto es análisis. No ejecuta órdenes: ni la mesa ni JARVIS tienen un
 *   camino hacia una cuenta real. El paper trading es simulado.
 */

export type Side = "LONG" | "SHORT";
export type Direction = Side | "ESPERAR" | "NO TRADE";
export type Target = { price: number; label: string };

export type Plan = {
  lado: Side;
  entrada: number;
  tipoEntrada: "MERCADO" | "LÍMITE";
  stop: number;
  stopRazon: string;
  tp: [Target, Target, Target];
  /** Niveles en contra antes del TP1 (resistencias para un largo, soportes para un corto). */
  obstaculos: number[];
};

export type DeskSettings = {
  /** Capital de la cuenta en dólares, para el tamaño de la posición (null = no se calcula). */
  capital: number | null;
  /** Riesgo por operación, en porcentaje del capital. */
  riesgoPct: number;
  /** Tope de apalancamiento que la persona acepta. */
  apalancamientoMax: number;
  /** Riesgo en dólares de las operaciones de papel abiertas (lo pone quien llama; no se guarda). */
  riesgoAbiertoUsd?: number | null;
};

/** Riesgo abierto total (papel) que dispara el aviso, en % del capital. */
export const MAX_OPEN_RISK_PCT = 5;
/** Con riesgo ALTO, el R:R mínimo sube a este. */
export const MIN_RR_HIGH_RISK = 2;

export const DEFAULT_DESK_SETTINGS: DeskSettings = { capital: null, riesgoPct: 1, apalancamientoMax: 10 };

export type RiskLevel = "BAJO" | "MEDIO" | "ALTO";

export type RiskReview = {
  lado: Side;
  rr: [number, number, number];
  /** Saliendo un tercio en cada TP. */
  rrPonderado: number;
  stopPct: number;
  stopAtr: number;
  riesgoUsd: number | null;
  posicionUsd: number | null;
  cantidad: number | null;
  apalancamiento: number;
  apalancamientoMaxSeguro: number;
  margenUsd: number | null;
  liquidacionAprox: number;
  /** Cuántas veces más lejos que el stop queda la liquidación (con el apalancamiento sugerido). */
  liquidacionVsStop: number;
  /** Posición / capital (null sin capital cargado). */
  exposicionX: number | null;
  /** Precio ahora (mark de futuros) y el R:R entrando a ese precio, si se pudo leer. */
  precioVivo: number | null;
  rrVivo: number | null;
  nivel: RiskLevel;
  /** Motivos de NO TRADE. */
  vetos: string[];
  /** Motivos de esperar (el plan sirve, el momento no). */
  esperas: string[];
  avisos: string[];
  aprobado: boolean;
};

export type LevelLite = { precio: number; estrellas: number };

export type DeskDecision = {
  symbol: string;
  moneda: string;
  /** Cierre de la última vela de 1 h que leyó la mesa: el precio del análisis. */
  precio: number;
  /** El precio ahora (mark de futuros), si se pudo leer; solo para el control de riesgo de la entrada. */
  precioVivo: number | null;
  precioVivoFuente: string | null;
  /** Apertura de la última vela de 1 h cerrada que se leyó. */
  vela: number;
  generadoA: number;
  direccion: Direction;
  /** Puntaje de confluencia 0–100. No es una probabilidad. */
  puntaje: number;
  consenso: number;
  cobertura: number;
  plan: Plan | null;
  riesgo: RiskReview | null;
  alcista: { plan: Plan | null; riesgo: RiskReview | null; argumentos: string[] };
  bajista: { plan: Plan | null; riesgo: RiskReview | null; argumentos: string[] };
  /** Por qué la mesa eligió lo que eligió (el conflicto resuelto). */
  resolucion: string;
  razonamiento: string[];
  invalidacion: string;
  alternativo: string;
  niveles: { soportes: LevelLite[]; resistencias: LevelLite[] };
  imanes: { arriba: number | null; abajo: number | null };
  agentes: AgentReport[];
  faltantes: string[];
  fuentes: string[];
  /** Acierto medido de setups parecidos (paper y backtest), con su muestra. */
  historial: DeskRecord | null;
  aviso: string;
};

export type DeskRecord = { n: number; ganadas: number; winRate: number | null; expectativaR: number | null; etiqueta: string };

/** R:R ponderado mínimo que aprueba el gestor de riesgo (también al entrar en papel). */
export const MIN_RR = 1.5;
const CONSENSUS_EDGE = 0.15;
const MMR = 0.005;

const sortSupports = (a: Analysis, price: number) => [...a.levels.supports].filter((l) => l.price < price).sort((x, y) => y.price - x.price);
const sortResistances = (a: Analysis, price: number) => [...a.levels.resistances].filter((l) => l.price > price).sort((x, y) => x.price - y.price);
const stars = (n: number) => "★".repeat(Math.max(1, Math.min(3, n)));

/**
 * Un plan para un lado, con entrada a mercado o límite en un nivel: el stop
 * detrás del nivel que lo invalida (con un margen de ATR), y tres objetivos en
 * los niveles siguientes; si no hay niveles, en múltiplos del riesgo.
 */
export function buildPlan(side: Side, a: Analysis, atr: number, entryOverride?: { price: number; label: string }): Plan | null {
  const price = a.read.price;
  const long = side === "LONG";
  const entrada = entryOverride?.price ?? price;
  if (!(entrada > 0) || !(atr > 0)) return null;
  const against = long ? sortSupports(a, entrada) : sortResistances(a, entrada);
  const anchor = against.find((l) => Math.abs(entrada - l.price) >= 0.4 * atr);
  let stop: number;
  let stopRazon: string;
  if (anchor) {
    const edge = long ? Math.min(anchor.low, anchor.price) : Math.max(anchor.high, anchor.price);
    stop = long ? edge - 0.25 * atr : edge + 0.25 * atr;
    stopRazon = `detrás del ${long ? "soporte" : "resistencia"} ${px(anchor.price)} (${stars(anchor.stars)}) con un margen de 0,25 ATR de 4 h`;
  } else {
    stop = long ? entrada - 1.5 * atr : entrada + 1.5 * atr;
    stopRazon = "a 1,5 ATR de 4 h (no hay un nivel cercano que lo defienda)";
  }
  const risk = Math.abs(entrada - stop);
  if (!(risk > 0) || (long ? stop <= 0 : false)) return null;
  const favor = long ? sortResistances(a, entrada) : sortSupports(a, entrada);
  const cands: Target[] = favor.map((l) => ({ price: l.price, label: `${long ? "resistencia" : "soporte"} ${stars(l.stars)}` }));
  const mag = long ? a.magnets.above : a.magnets.below;
  if (mag && (long ? mag.price > entrada : mag.price < entrada)) cands.push({ price: mag.price, label: "imán de liquidaciones (estimado)" });
  cands.sort((x, y) => (long ? x.price - y.price : y.price - x.price));
  const dist = (p: number) => (long ? p - entrada : entrada - p);
  const obstaculos = cands.filter((c) => dist(c.price) > 0 && dist(c.price) < risk).map((c) => c.price);
  const tps: Target[] = [];
  let floor = risk;
  for (const mult of [1.5, 2.5, 3.5]) {
    const next = cands.find((c) => dist(c.price) >= floor && !tps.some((t) => t.price === c.price));
    if (next) tps.push(next);
    else {
      // Without a level beyond, a multiple of the risk; never closer than half an R to the previous target.
      const d = Math.max(mult * risk, floor);
      tps.push({ price: long ? entrada + d : entrada - d, label: `${arNumber(Number((d / risk).toFixed(1)))} R (sin nivel más allá)` });
    }
    floor = dist(tps[tps.length - 1].price) + 0.5 * risk;
  }
  if (!long && tps.some((t) => t.price <= 0)) return null;
  return { lado: side, entrada, tipoEntrada: entryOverride ? "LÍMITE" : "MERCADO", stop, stopRazon, tp: [tps[0], tps[1], tps[2]], obstaculos };
}

/** Riesgo/beneficio de cada objetivo, el ponderado saliendo un tercio en cada uno. */
export function rrOf(p: Plan): { rr: [number, number, number]; rrPonderado: number } {
  const risk = Math.abs(p.entrada - p.stop);
  const rr = p.tp.map((t) => Math.abs(t.price - p.entrada) / risk) as [number, number, number];
  return { rr, rrPonderado: (rr[0] + rr[1] + rr[2]) / 3 };
}

/**
 * El gestor de riesgo. Tiene la última palabra: veta lo que no cierra aunque
 * todo lo demás diga que sí. Calcula tamaño, apalancamiento y liquidación.
 */
/** R:R ponderado (un tercio por objetivo) entrando a `price`; null si ya está del otro lado del stop o del TP1. */
export function rrFrom(p: Pick<Plan, "lado" | "stop" | "tp">, price: number): number | null {
  const s = p.lado === "LONG" ? 1 : -1;
  const risk = s * (price - p.stop);
  if (!(risk > 0) || !(s * (p.tp[0].price - price) > 0)) return null;
  return p.tp.reduce((acc, t) => acc + (s * (t.price - price)) / risk, 0) / 3;
}

const usd = (v: number) => `$${v.toLocaleString("es-AR", { maximumFractionDigits: v >= 100 ? 0 : 2 })}`;

export function reviewRisk(
  p: Plan,
  ctx: { atr: number; regime: VolRegime; events: MacroEvent[] | null; now: number; fundingPct: number | null; longShort: number | null; coverage: number; consensus: number; livePrice?: number | null },
  settings: DeskSettings,
): RiskReview {
  const { rr, rrPonderado } = rrOf(p);
  const stopPct = (Math.abs(p.entrada - p.stop) / p.entrada) * 100;
  const stopAtr = Math.abs(p.entrada - p.stop) / ctx.atr;
  const vetos: string[] = [];
  const esperas: string[] = [];
  const avisos: string[] = [];
  if (rrPonderado < MIN_RR) vetos.push(`Relación riesgo/beneficio insuficiente: 1:${arNumber(Number(rrPonderado.toFixed(2)))} (mínimo 1:${arNumber(MIN_RR)}).`);
  // The plan is priced at the close the desk read; the market kept moving. A market entry is judged at today's price.
  const live = typeof ctx.livePrice === "number" && ctx.livePrice > 0 ? ctx.livePrice : null;
  const rrVivo = live !== null ? rrFrom(p, live) : null;
  if (live !== null && p.tipoEntrada === "MERCADO") {
    const movedPct = ((live - p.entrada) / p.entrada) * 100;
    if (rrVivo === null) {
      const beyondStop = (p.lado === "LONG" ? live <= p.stop : live >= p.stop);
      esperas.push(`El precio ahora (${px(live)}) ya está ${beyondStop ? "del otro lado del stop" : "más allá del TP1"}: este plan es del cierre de la vela y ya no sirve. La mesa vuelve a leer al próximo cierre.`);
    } else if (rrVivo < MIN_RR) {
      esperas.push(`El precio ya se movió ${pct(movedPct, 2)} desde el cierre (ahora ${px(live)}): a mercado el R:R quedaría en 1:${arNumber(Number(rrVivo.toFixed(2)))} (mínimo 1:${arNumber(MIN_RR)}). Esperá un retroceso hacia ${px(p.entrada)} o el próximo cierre.`);
    } else if (Math.abs(movedPct) >= 0.1) {
      avisos.push(`El precio ahora es ${px(live)} (${pct(movedPct, 2)} desde el cierre leído): a ese precio el R:R es 1:${arNumber(Number(rrVivo.toFixed(2)))}.`);
    }
  }
  if (stopPct < 0.25) vetos.push(`Stop a ${pct(stopPct, 2, false)}: dentro del ruido normal del precio.`);
  if (stopPct > 10 || stopAtr > 3.5) vetos.push(`Stop demasiado lejos (${pct(stopPct, 1, false)}, ${arNumber(Number(stopAtr.toFixed(1)))} ATR).`);
  const against = p.lado === "LONG" ? ctx.consensus <= -CONSENSUS_EDGE : ctx.consensus >= CONSENSUS_EDGE;
  if (against) vetos.push("El consenso de los especialistas va en contra de este lado.");
  if (ctx.coverage < 0.5) avisos.push("Faltan datos de varios especialistas: la lectura es parcial.");
  const soon = upcomingHighImpact(ctx.events, ctx.now, 12);
  const imminent = soon.filter((e) => e.time - ctx.now <= 2 * 3_600_000);
  if (imminent.length) esperas.push(`Evento de alto impacto en menos de 2 h: ${imminent[0].title} (${arTime(imminent[0].time)}, hora argentina).`);
  else if (soon.length) avisos.push(`Evento de alto impacto en las próximas 12 h: ${soon[0].title} (${arTime(soon[0].time)}).`);
  if (ctx.regime === "EXPANDIDA") avisos.push("Volatilidad expandida: conviene la mitad del tamaño habitual.");
  if (p.lado === "LONG" && ((ctx.fundingPct ?? 0) >= 0.05 || (ctx.longShort ?? 0) >= 2.5)) avisos.push("El mercado está cargado de largos: riesgo de barrida antes de subir.");
  if (p.lado === "SHORT" && ((ctx.fundingPct ?? 0) <= -0.03 || (ctx.longShort ?? 9) <= 0.7)) avisos.push("El mercado está cargado de cortos: riesgo de apretón alcista.");
  if (p.obstaculos.length) avisos.push(`${p.lado === "LONG" ? "Resistencias" : "Soportes"} antes del TP1: ${p.obstaculos.map(px).join(", ")}.`);

  // Apalancamiento: la liquidación tiene que quedar al menos 3 veces más lejos que el stop.
  const maxSafe = Math.max(1, Math.min(settings.apalancamientoMax, Math.floor(100 / (stopPct * 3))));
  let apalancamiento = Math.max(1, Math.min(maxSafe, Math.round(maxSafe / 2)));
  const capital = settings.capital && settings.capital > 0 ? settings.capital : null;
  const riesgoUsd = capital !== null ? (capital * settings.riesgoPct) / 100 : null;
  const posicionUsd = riesgoUsd !== null ? riesgoUsd / (stopPct / 100) : null;
  const cantidad = posicionUsd !== null ? posicionUsd / p.entrada : null;
  // The size the risk asks for has to fit the capital at a safe leverage; if not, it is not a trade.
  if (posicionUsd !== null && capital !== null) {
    if (posicionUsd / maxSafe > capital) {
      vetos.push(`Con ${arNumber(settings.riesgoPct)}% de riesgo y el stop a ${pct(stopPct, 2, false)}, la posición (${usd(posicionUsd)}) no entra en tu capital ni con el apalancamiento máximo seguro (${maxSafe}x): bajá el riesgo por operación.`);
    } else if (posicionUsd / apalancamiento > capital) {
      apalancamiento = Math.min(maxSafe, Math.ceil(posicionUsd / capital));
      avisos.push(`Para que el margen entre en tu capital, el apalancamiento sube a ${apalancamiento}x (sigue dentro del máximo seguro, ${maxSafe}x).`);
    }
  }
  const liquidacionAprox = p.lado === "LONG" ? p.entrada * (1 - 1 / apalancamiento + MMR) : p.entrada * (1 + 1 / apalancamiento - MMR);
  const liquidacionVsStop = Math.abs(p.entrada - liquidacionAprox) / Math.abs(p.entrada - p.stop);
  const margenUsd = posicionUsd !== null ? posicionUsd / apalancamiento : null;
  const exposicionX = posicionUsd !== null && capital !== null ? posicionUsd / capital : null;
  if (settings.riesgoPct > 2) avisos.push(`Riesgo por operación de ${arNumber(settings.riesgoPct)}%: por encima del 1–2% que permite aguantar una racha perdedora.`);
  if (exposicionX !== null && exposicionX > 3) avisos.push(`Exposición: la posición equivale a ${n2(exposicionX)} veces tu capital.`);
  const open = typeof settings.riesgoAbiertoUsd === "number" && settings.riesgoAbiertoUsd > 0 ? settings.riesgoAbiertoUsd : 0;
  if (capital !== null && riesgoUsd !== null && open > 0 && ((open + riesgoUsd) / capital) * 100 > MAX_OPEN_RISK_PCT) {
    avisos.push(`Con las operaciones de papel abiertas (${usd(open)} en riesgo) más esta, el riesgo abierto sería ${pct(((open + riesgoUsd) / capital) * 100, 1, false)} de tu capital (más de ${MAX_OPEN_RISK_PCT}%).`);
  }

  const nivel: RiskLevel = stopAtr > 2.2 || ctx.regime === "EXPANDIDA" || soon.length > 0 || ctx.coverage < 0.5 ? "ALTO" : stopPct > 3 || avisos.length >= 2 ? "MEDIO" : "BAJO";
  // High risk has to pay more: a thin reward does not compensate it.
  if (nivel === "ALTO" && rrPonderado >= MIN_RR && rrPonderado < MIN_RR_HIGH_RISK) {
    vetos.push(`Riesgo alto con R:R 1:${arNumber(Number(rrPonderado.toFixed(2)))}: no compensa (con riesgo alto la mesa pide 1:${arNumber(MIN_RR_HIGH_RISK)} o más).`);
  }
  return {
    lado: p.lado,
    rr,
    rrPonderado,
    stopPct,
    stopAtr,
    riesgoUsd,
    posicionUsd,
    cantidad,
    apalancamiento,
    apalancamientoMaxSeguro: maxSafe,
    margenUsd,
    liquidacionAprox,
    liquidacionVsStop,
    exposicionX,
    precioVivo: live,
    rrVivo,
    nivel,
    vetos,
    esperas,
    avisos,
    aprobado: vetos.length === 0 && esperas.length === 0,
  };
}

/** Con entrada a mercado no cierra: probar una entrada límite en el nivel a favor más cercano. */
function limitAlternative(side: Side, a: Analysis, atr: number): Plan | null {
  const price = a.read.price;
  const lvl = side === "LONG" ? sortSupports(a, price)[0] : sortResistances(a, price)[0];
  if (!lvl || Math.abs(price - lvl.price) / price > 0.08) return null;
  const at = side === "LONG" ? Math.max(lvl.price, lvl.high) : Math.min(lvl.price, lvl.low);
  return buildPlan(side, a, atr, { price: at, label: `${side === "LONG" ? "soporte" : "resistencia"} ${px(lvl.price)}` });
}

const strongest = (agents: AgentReport[], sign: number, n: number) =>
  agents
    .filter((x) => x.disponible && x.peso > 0 && Math.sign(x.sesgo) === sign && Math.abs(x.sesgo) >= 0.05)
    .sort((x, y) => Math.abs(y.sesgo * y.peso) - Math.abs(x.sesgo * x.peso))
    .slice(0, n);

function argumentsFor(agents: AgentReport[], sign: number): string[] {
  return strongest(agents, sign, 4).map((x) => `${x.nombre}: ${x.hallazgos[0] ?? ""}`.trim());
}

function bestPlan(side: Side, a: Analysis, atr: number, ctx: Parameters<typeof reviewRisk>[1], settings: DeskSettings): { plan: Plan | null; riesgo: RiskReview | null } {
  const market = buildPlan(side, a, atr);
  const mReview = market ? reviewRisk(market, ctx, settings) : null;
  if (market && mReview && mReview.rrPonderado >= MIN_RR) return { plan: market, riesgo: mReview };
  const limit = limitAlternative(side, a, atr);
  const lReview = limit ? reviewRisk(limit, ctx, settings) : null;
  if (limit && lReview && lReview.rrPonderado >= MIN_RR) {
    lReview.esperas.unshift(`Entrada límite en ${px(limit.entrada)}: a mercado la relación riesgo/beneficio no alcanza.`);
    lReview.aprobado = false;
    return { plan: limit, riesgo: lReview };
  }
  return { plan: market, riesgo: mReview };
}

/** Solo velas cerradas a `now`, en todas las series: ninguna vela en formación entra a la mesa. */
export function closedSnapshot(s: DeskSnapshot): DeskSnapshot {
  const c = (x: DeskSnapshot["candles"]["h1"] | null, f: number) => (x ? closedOnly(x, f, s.now) : null);
  return {
    ...s,
    candles: { h1: c(s.candles.h1, DESK_FRAMES.h1) ?? [], h4: c(s.candles.h4, DESK_FRAMES.h4), d1: c(s.candles.d1, DESK_FRAMES.d1) },
    btc: c(s.btc, DESK_FRAMES.h1),
    eth: c(s.eth, DESK_FRAMES.h1),
  };
}

/** El puntaje de confluencia: cuánto peso coincide con el lado, con qué fuerza, y cuánto se pudo leer. */
export function confluenceScore(c: ReturnType<typeof consensus>, side: Side | null): number {
  const agree = side === "LONG" ? c.agreeLong : side === "SHORT" ? c.agreeShort : Math.max(c.agreeLong, c.agreeShort);
  const strength = Math.min(1, Math.abs(c.value) / 0.6);
  return Math.round(100 * (0.5 * agree + 0.5 * strength) * (0.5 + 0.5 * c.coverage));
}

/**
 * La mesa completa sobre un activo. `historial` es el acierto medido de
 * setups parecidos (paper/backtest) para mostrar al lado del puntaje.
 */
export function runDesk(raw: DeskSnapshot, settings: DeskSettings = DEFAULT_DESK_SETTINGS, historial: DeskRecord | null = null): DeskDecision | null {
  const s = closedSnapshot(raw);
  const frames = framesOf(s);
  if (frames.h1.length < 200) return null;
  const a = analyzeAsset(s.symbol, { h1: s.candles.h1, h4: s.candles.h4, d1: s.candles.d1 }, s.now);
  if (!a) return null;
  const agents = runAgents(s, a);
  const cons = consensus(agents);
  const atr = atrOf(frames.h4);
  const price = a.read.price;
  const regime = (agents.find((x) => x.id === "volatilidad")?.datos.regimen as VolRegime | undefined) ?? "NORMAL";
  // The price now (futures mark), read with the derivatives: it never enters the analysis, only the risk check of a market entry.
  const livePrice = raw.derivatives?.markPrice ?? null;
  const ctx = { atr, regime, events: s.macro.events, now: s.now, fundingPct: s.derivatives?.fundingPct ?? null, longShort: s.derivatives?.longShortRatio ?? null, coverage: cons.coverage, consensus: cons.value, livePrice };
  const bull = bestPlan("LONG", a, atr, ctx, settings);
  const bear = bestPlan("SHORT", a, atr, ctx, settings);
  const favored: Side | null = cons.value >= CONSENSUS_EDGE ? "LONG" : cons.value <= -CONSENSUS_EDGE ? "SHORT" : null;
  const chosen = favored === "LONG" ? bull : favored === "SHORT" ? bear : null;
  const other = favored === "LONG" ? bear : favored === "SHORT" ? bull : null;

  let direccion: Direction;
  let resolucion: string;
  const lean = (side: Side) => (side === "LONG" ? "alcista" : "bajista");
  if (!favored) {
    direccion = "ESPERAR";
    resolucion = `Los especialistas están divididos (consenso ${arNumber(Number(cons.value.toFixed(2)))} sobre ±1): ni el escenario alcista ni el bajista tienen ventaja. La mesa espera una confirmación: ${bull.plan ? `arriba de ${px(sortResistances(a, price)[0]?.price ?? bull.plan.tp[0].price)}` : "una ruptura"} o ${bear.plan ? `abajo de ${px(sortSupports(a, price)[0]?.price ?? bear.plan.tp[0].price)}` : "una pérdida de soporte"}.`;
  } else if (!chosen?.plan || !chosen.riesgo) {
    direccion = "NO TRADE";
    resolucion = `El consenso es ${lean(favored)}, pero no se pudo armar un plan con stop y objetivos válidos.`;
  } else if (chosen.riesgo.vetos.length) {
    direccion = "NO TRADE";
    resolucion = `El consenso es ${lean(favored)}, pero el gestor de riesgo lo veta: ${chosen.riesgo.vetos.join(" ")}`;
  } else if (chosen.riesgo.esperas.length) {
    direccion = "ESPERAR";
    resolucion = `El escenario ${lean(favored)} gana el debate, pero todavía no es el momento: ${chosen.riesgo.esperas.join(" ")}`;
  } else {
    direccion = favored;
    const otherSide = favored === "LONG" ? "bajista" : "alcista";
    const otherNote = other?.riesgo ? `El escenario ${otherSide} queda descartado porque va contra el consenso${other.riesgo.rrPonderado >= MIN_RR ? `, aunque su riesgo/beneficio (1:${arNumber(Number(other.riesgo.rrPonderado.toFixed(2)))}) también cerraría` : ""}.` : `El escenario ${otherSide} no tiene un plan válido.`;
    resolucion = `Gana el escenario ${lean(favored)}: lo respalda el ${Math.round((favored === "LONG" ? cons.agreeLong : cons.agreeShort) * 100)}% del peso de la mesa y su riesgo/beneficio (1:${arNumber(Number(chosen.riesgo.rrPonderado.toFixed(2)))}) supera el mínimo de 1:${arNumber(MIN_RR)}. ${otherNote}`;
  }

  const plan = chosen?.plan ?? null;
  const riesgo = chosen?.riesgo ?? null;
  const sign = favored === "LONG" ? 1 : favored === "SHORT" ? -1 : 0;
  const razonamiento = sign ? [...argumentsFor(agents, sign).slice(0, 4), ...strongest(agents, -sign, 1).map((x) => `En contra · ${x.nombre}: ${x.hallazgos[0] ?? ""}`)] : [...argumentsFor(agents, 1).slice(0, 2), ...argumentsFor(agents, -1).slice(0, 2)];

  const sup = sortSupports(a, price)[0];
  const res = sortResistances(a, price)[0];
  const invalidacion = plan
    ? plan.lado === "LONG"
      ? `Un cierre de 4 h por debajo de ${px(plan.stop)} (stop ${plan.stopRazon}) invalida el escenario alcista.`
      : `Un cierre de 4 h por encima de ${px(plan.stop)} (stop ${plan.stopRazon}) invalida el escenario bajista.`
    : `Sin plan: la lectura cambia si rompe ${res ? px(res.price) : "la resistencia"} hacia arriba o pierde ${sup ? px(sup.price) : "el soporte"} hacia abajo.`;
  const alt = favored === "LONG" ? bear.plan : favored === "SHORT" ? bull.plan : null;
  const trigger = alt ? (alt.lado === "SHORT" ? (sup?.price ?? alt.entrada) : (res?.price ?? alt.entrada)) : null;
  const beyond = alt && trigger !== null ? (alt.tp.find((t) => (alt.lado === "SHORT" ? t.price < trigger : t.price > trigger)) ?? null) : null;
  const alternativo = alt && trigger !== null
    ? `Si el mercado va al revés y ${alt.lado === "SHORT" ? `pierde ${px(trigger)}` : `supera ${px(trigger)}`}, toma fuerza el escenario ${alt.lado === "SHORT" ? "bajista" : "alcista"}${beyond ? ` con objetivo en ${px(beyond.price)} (${beyond.label})` : ""}. No se da vuelta la posición automáticamente: la mesa vuelve a evaluar.`
    : `Si rompe ${res ? px(res.price) : "arriba"}, el escenario alcista toma el control; si pierde ${sup ? px(sup.price) : "el soporte"}, el bajista.`;

  const faltantes = [...new Set(agents.flatMap((x) => x.faltantes))];
  return {
    symbol: s.symbol,
    moneda: s.symbol.replace(/USDT$/, ""),
    precio: price,
    precioVivo: livePrice !== null && livePrice > 0 ? livePrice : null,
    precioVivoFuente: livePrice !== null && livePrice > 0 ? `${raw.derivatives?.source ?? "futuros"} (mark)` : null,
    vela: a.read.at,
    generadoA: s.now,
    direccion,
    puntaje: confluenceScore(cons, favored),
    consenso: cons.value,
    cobertura: cons.coverage,
    plan,
    riesgo,
    alcista: { ...bull, argumentos: argumentsFor(agents, 1) },
    bajista: { ...bear, argumentos: argumentsFor(agents, -1) },
    resolucion,
    razonamiento,
    invalidacion,
    alternativo,
    niveles: {
      soportes: sortSupports(a, price).slice(0, 4).map((l) => ({ precio: l.price, estrellas: l.stars })),
      resistencias: sortResistances(a, price).slice(0, 4).map((l) => ({ precio: l.price, estrellas: l.stars })),
    },
    imanes: { arriba: a.magnets.above?.price ?? null, abajo: a.magnets.below?.price ?? null },
    agentes: agents,
    faltantes,
    fuentes: s.sources,
    historial,
    aviso: "Análisis, no ejecución: no es asesoramiento financiero.",
  };
}

// ── Lo que JARVIS dice y lo que responde en el chat ──

const rrText = (r: number) => `1:${arNumber(Number(r.toFixed(2)))}`;

/** La decisión en pocas frases, para la voz y el chat. */
export function deskSpeech(d: DeskDecision): string {
  const head = `${d.moneda} en ${px(d.precio)}.`;
  if ((d.direccion === "LONG" || d.direccion === "SHORT") && d.plan && d.riesgo) {
    return [
      head,
      `${d.direccion === "LONG" ? "Largo" : "Corto"}, puntaje de confluencia ${d.puntaje} de 100.`,
      `Entrada ${px(d.plan.entrada)}, stop ${px(d.plan.stop)}, objetivos ${d.plan.tp.map((t) => px(t.price)).join(", ")}.`,
      `Riesgo ${d.riesgo.nivel.toLowerCase()}, riesgo/beneficio ${rrText(d.riesgo.rrPonderado)}, apalancamiento sugerido ${d.riesgo.apalancamiento}x.`,
      d.resolucion,
      d.aviso,
    ].join(" ");
  }
  return [head, d.direccion === "ESPERAR" ? "Esperar." : "No trade.", d.resolucion, d.aviso].join(" ");
}

/** "¿Qué pasa si pierde X?" / "¿Y si supera X?": qué invalida y qué nivel sigue. */
export function whatIf(d: DeskDecision, level: number): string {
  const below = level < d.precio;
  const parts: string[] = [];
  const dist = pct(((level - d.precio) / d.precio) * 100);
  if (below) {
    parts.push(`Si ${d.moneda} pierde ${px(level)} (${dist} del precio actual):`);
    const bull = d.alcista.plan;
    if (bull && level <= bull.stop) parts.push(`queda invalidado el escenario alcista (su stop está en ${px(bull.stop)}).`);
    else if (bull) parts.push(`el escenario alcista sigue en pie mientras no cierre debajo de ${px(bull.stop)}.`);
    const next = d.niveles.soportes.filter((l) => l.precio < level).slice(0, 2);
    parts.push(next.length ? `El próximo soporte es ${next.map((l) => `${px(l.precio)} (${stars(l.estrellas)})`).join(", después ")}.` : "No hay soportes medidos más abajo en el rango que lee la mesa.");
    if (d.imanes.abajo !== null && d.imanes.abajo < level) parts.push(`Más abajo hay un imán de liquidaciones estimado en ${px(d.imanes.abajo)}.`);
    const bear = d.bajista.plan;
    if (bear) {
      // Only targets still ahead of that price: one already passed is not a target any more.
      const ahead = bear.tp.filter((t) => t.price < level);
      parts.push(ahead.length ? `El escenario bajista apunta a ${px(ahead[0].price)}.` : `Ese precio ya está más allá de los objetivos del escenario bajista (el último, ${px(bear.tp[2].price)}): la mesa tendría que volver a evaluar desde ahí.`);
    }
  } else {
    parts.push(`Si ${d.moneda} supera ${px(level)} (${dist}):`);
    const bear = d.bajista.plan;
    if (bear && level >= bear.stop) parts.push(`queda invalidado el escenario bajista (su stop está en ${px(bear.stop)}).`);
    const next = d.niveles.resistencias.filter((l) => l.precio > level).slice(0, 2);
    parts.push(next.length ? `La próxima resistencia es ${next.map((l) => `${px(l.precio)} (${stars(l.estrellas)})`).join(", después ")}.` : "No hay resistencias medidas más arriba en el rango que lee la mesa.");
    if (d.imanes.arriba !== null && d.imanes.arriba > level) parts.push(`Más arriba hay un imán de liquidaciones estimado en ${px(d.imanes.arriba)}.`);
    const bull = d.alcista.plan;
    if (bull) {
      const ahead = bull.tp.filter((t) => t.price > level);
      parts.push(ahead.length ? `El escenario alcista apunta a ${px(ahead[0].price)}.` : `Ese precio ya está más allá de los objetivos del escenario alcista (el último, ${px(bull.tp[2].price)}): la mesa tendría que volver a evaluar desde ahí.`);
    }
  }
  parts.push("No es asesoramiento financiero.");
  return parts.join(" ");
}

/** "¿Hay riesgo de liquidaciones?": derivados + mapa estimado + la liquidación del plan sugerido. */
export function liquidationRisk(d: DeskDecision): string {
  const liq = d.agentes.find((x) => x.id === "liquidaciones");
  const der = d.agentes.find((x) => x.id === "derivados");
  const parts = [`${d.moneda}:`];
  if (liq?.disponible) parts.push(...liq.hallazgos.slice(1));
  else parts.push("El mapa de liquidaciones no está disponible ahora.");
  if (der?.disponible) parts.push(...der.hallazgos.filter((h) => /Funding|Ratio|Interés abierto/.test(h)).slice(0, 3));
  else parts.push("Funding e interés abierto: este dato no está disponible actualmente.");
  if (d.riesgo) parts.push(`Con el apalancamiento sugerido (${d.riesgo.apalancamiento}x) la liquidación quedaría cerca de ${px(d.riesgo.liquidacionAprox)}.`);
  parts.push("Las liquidaciones del mapa son estimadas, no reales.");
  return parts.join(" ");
}

/** "¿Qué opinan los indicadores?" */
export function indicatorsSpeech(d: DeskDecision): string {
  const t = d.agentes.find((x) => x.id === "tecnico");
  if (!t?.disponible) return `${d.moneda}: los indicadores no están disponibles ahora (faltan velas).`;
  return `${d.moneda}, indicadores: ${t.hallazgos.join(" ")} En conjunto, ${t.sesgo > 0.1 ? "a favor de subir" : t.sesgo < -0.1 ? "a favor de bajar" : "sin dirección clara"}.`;
}

// ── Comparación de activos ──

export type CompareRow = { criterio: string; a: string; b: string; gana: "A" | "B" | "EMPATE" | "SIN DATOS" };
export type Comparison = { a: string; b: string; filas: CompareRow[]; ganador: "A" | "B" | "EMPATE"; resumen: string };

const agentOf = (d: DeskDecision, id: string) => d.agentes.find((x) => x.id === id && x.disponible) ?? null;
const numOf = (d: DeskDecision, id: string, key: string) => {
  const v = agentOf(d, id)?.datos[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

/** Dos activos, criterio por criterio, con los datos que haya. Gana el que gana más criterios. */
export function compareDesks(x: DeskDecision, y: DeskDecision): Comparison {
  const rows: CompareRow[] = [];
  const add = (criterio: string, av: number | null, bv: number | null, fmt: (v: number) => string, higherWins = true) => {
    if (av === null || bv === null) rows.push({ criterio, a: av === null ? "sin datos" : fmt(av), b: bv === null ? "sin datos" : fmt(bv), gana: "SIN DATOS" });
    else rows.push({ criterio, a: fmt(av), b: fmt(bv), gana: Math.abs(av - bv) < 1e-9 ? "EMPATE" : av > bv === higherWins ? "A" : "B" });
  };
  const bias = (v: number) => (v > 0.1 ? `alcista (${arNumber(Number(v.toFixed(2)))})` : v < -0.1 ? `bajista (${arNumber(Number(v.toFixed(2)))})` : `neutral (${arNumber(Number(v.toFixed(2)))})`);
  add("Tendencia y estructura", agentOf(x, "estructura")?.sesgo ?? null, agentOf(y, "estructura")?.sesgo ?? null, bias);
  add("Momentum (indicadores)", agentOf(x, "tecnico")?.sesgo ?? null, agentOf(y, "tecnico")?.sesgo ?? null, bias);
  const r2 = (v: number) => arNumber(Number(v.toFixed(2)));
  add("Volumen 24 h vs semana", numOf(x, "volumen", "volumen24VsSemana"), numOf(y, "volumen", "volumen24VsSemana"), (v) => `${r2(v)}×`);
  add("Volatilidad por hora, últimas 24 h (menos es mejor)", numOf(x, "volatilidad", "volatilidad24hPct"), numOf(y, "volatilidad", "volatilidad24hPct"), (v) => `${r2(v)}%`, false);
  add("Derivados", agentOf(x, "derivados")?.sesgo ?? null, agentOf(y, "derivados")?.sesgo ?? null, bias);
  // Each asset's own 7-day change: the same yardstick for both (relative strength against BTC would not be, for BTC).
  add("Cambio 7 días (fuerza relativa)", numOf(x, "correlacion", "cambio7dPct"), numOf(y, "correlacion", "cambio7dPct"), (v) => pct(v));
  const riskRank = (d: DeskDecision) => (d.riesgo && (d.direccion === "LONG" || d.direccion === "SHORT") ? { BAJO: 3, MEDIO: 2, ALTO: 1 }[d.riesgo.nivel] : 0);
  add("Riesgo del mejor plan", riskRank(x), riskRank(y), (v) => (["sin operación", "alto", "medio", "bajo"][v] ?? "sin datos"));
  add("Consenso de la mesa", x.consenso, y.consenso, bias);
  const wa = rows.filter((r) => r.gana === "A").length;
  const wb = rows.filter((r) => r.gana === "B").length;
  const ganador = wa > wb ? "A" : wb > wa ? "B" : "EMPATE";
  const name = (g: "A" | "B") => (g === "A" ? x.moneda : y.moneda);
  const resumen = ganador === "EMPATE" ? `${x.moneda} y ${y.moneda} empatan con los datos disponibles (${wa} a ${wb}).` : `Con los datos disponibles gana ${name(ganador)}: ${Math.max(wa, wb)} criterios contra ${Math.min(wa, wb)}.`;
  return { a: x.moneda, b: y.moneda, filas: rows, ganador, resumen: `${resumen} No es asesoramiento financiero.` };
}

// ── Eventos macro ──

export type MacroKind = "CPI" | "PPI" | "NFP" | "FOMC" | "TASAS" | "DESEMPLEO" | "PBI" | "FED";

const MACRO_MATCH: Record<MacroKind, RegExp> = {
  CPI: /\bCPI\b/i,
  PPI: /\bPPI\b/i,
  NFP: /non-?farm|\bNFP\b/i,
  FOMC: /FOMC/i,
  TASAS: /Federal Funds Rate|Interest Rate|Rate Decision/i,
  DESEMPLEO: /Unemployment|Jobless Claims/i,
  PBI: /\bGDP\b/i,
  FED: /Powell|Fed Chair|FOMC Member|Speaks/i,
};

/** Escenarios típicos de cada dato: lo que suele pasar, dicho como tal, no una predicción. */
const MACRO_PLAYBOOK: Record<MacroKind, { hot: string; cool: string; btc: string; eth: string }> = {
  CPI: {
    hot: "Inflación por encima del pronóstico: el mercado descuenta tasas altas por más tiempo, sube el dólar y los activos de riesgo suelen caer.",
    cool: "Inflación por debajo del pronóstico: se adelantan los recortes de tasas, baja el dólar y los activos de riesgo suelen subir.",
    btc: "BTC suele moverse fuerte en los primeros minutos y barrer liquidez a ambos lados antes de elegir dirección.",
    eth: "ETH suele amplificar el movimiento de BTC (más beta).",
  },
  PPI: { hot: "Precios mayoristas altos: anticipan inflación, presión bajista típica.", cool: "Precios mayoristas bajos: alivio para tasas, sesgo alcista típico.", btc: "Impacto menor que el CPI, pero mueve si sorprende.", eth: "Sigue a BTC con más volatilidad." },
  NFP: { hot: "Mucho empleo: economía fuerte, tasas altas por más tiempo; presión típica sobre cripto.", cool: "Poco empleo: más chances de recortes; sesgo alcista típico, salvo que asuste por recesión.", btc: "Reacción fuerte en los primeros minutos después del dato.", eth: "Sigue a BTC con más beta." },
  FOMC: { hot: "Tono duro (hawkish) o suba: presión bajista típica.", cool: "Tono blando (dovish) o recorte: sesgo alcista típico.", btc: "La conferencia posterior suele mover más que el dato.", eth: "Sigue a BTC con más volatilidad." },
  TASAS: { hot: "Tasa más alta de lo esperado: presión bajista típica.", cool: "Tasa más baja de lo esperado: sesgo alcista típico.", btc: "Reacción en minutos; cuidado con el apalancamiento.", eth: "Sigue a BTC con más beta." },
  DESEMPLEO: { hot: "Desempleo bajo: mercado laboral firme, tasas altas por más tiempo.", cool: "Desempleo alto: más chances de recortes, aunque puede asustar por recesión.", btc: "Impacto medio.", eth: "Sigue a BTC." },
  PBI: { hot: "Crecimiento fuerte: tasas altas por más tiempo.", cool: "Crecimiento débil: más chances de recortes, con riesgo de recesión.", btc: "Impacto medio, mayor si sorprende mucho.", eth: "Sigue a BTC." },
  FED: { hot: "Discurso duro: presión bajista típica.", cool: "Discurso blando: sesgo alcista típico.", btc: "Se mueve con las frases sobre tasas e inflación.", eth: "Sigue a BTC." },
};

export type MacroBrief = {
  evento: string | null;
  hora: string | null;
  impacto: string | null;
  pronostico: string | null;
  previo: string | null;
  hot: string;
  cool: string;
  btc: string;
  eth: string;
  nota: string;
};

/** El próximo evento de un tipo (o el próximo de alto impacto) con sus escenarios. Nunca inventa horarios. */
export function macroBrief(events: MacroEvent[] | null, now: number, kind: MacroKind | null): MacroBrief {
  const book = MACRO_PLAYBOOK[kind ?? "CPI"];
  const base = { ...book, nota: "Escenarios típicos de cómo suele reaccionar el mercado; no son una predicción. No es asesoramiento financiero." };
  const empty = (why: string): MacroBrief => ({ evento: null, hora: null, impacto: null, pronostico: null, previo: null, ...base, nota: `${why} ${base.nota}` });
  if (events === null) return empty("El calendario económico no respondió: este dato no está disponible actualmente.");
  const pool = events.filter((e) => e.currency === "USD" && e.time >= now - 3_600_000).sort((x, y) => x.time - y.time);
  const ev = kind ? pool.find((e) => MACRO_MATCH[kind].test(e.title)) : pool.find((e) => e.impact === "high");
  if (!ev) return empty(`No hay ${kind ?? "eventos de alto impacto"} de EE.UU. en el calendario de esta semana (Forex Factory).`);
  const k = kind ?? ((Object.keys(MACRO_MATCH) as MacroKind[]).find((x) => MACRO_MATCH[x].test(ev.title)) ?? "CPI");
  return {
    evento: ev.title,
    hora: `${arTime(ev.time)} (hora argentina)`,
    impacto: ev.impact === "high" ? "ALTO" : ev.impact === "medium" ? "MEDIO" : "BAJO",
    pronostico: ev.forecast,
    previo: ev.previous,
    ...MACRO_PLAYBOOK[k],
    nota: base.nota,
  };
}

/** Qué tipo de evento nombra una pregunta ("si sale un CPI peor…"). */
export function macroKindOf(text: string): MacroKind | null {
  const t = text.toLowerCase();
  if (/\bcpi\b|inflaci[oó]n/.test(t)) return "CPI";
  if (/\bppi\b|precios mayoristas/.test(t)) return "PPI";
  if (/\bnfp\b|n[oó]minas|payrolls|empleo no agr/.test(t)) return "NFP";
  if (/fomc/.test(t)) return "FOMC";
  if (/tasa|tipos de inter[eé]s/.test(t)) return "TASAS";
  if (/desempleo|paro/.test(t)) return "DESEMPLEO";
  if (/\bpbi\b|\bgdp\b|\bpib\b/.test(t)) return "PBI";
  if (/powell|la fed|discurso/.test(t)) return "FED";
  return null;
}

export function macroSpeech(b: MacroBrief): string {
  if (!b.evento) return b.nota;
  return `${b.evento}: ${b.hora}, impacto ${b.impacto?.toLowerCase()}. Pronóstico ${b.pronostico ?? "sin dato"}, previo ${b.previo ?? "sin dato"}. Si sale caliente: ${b.hot} Si sale frío: ${b.cool} ${b.btc} ${b.nota}`;
}

const ARROW: Record<Direction, string> = { LONG: "🟢 LONG", SHORT: "🔴 SHORT", ESPERAR: "⏸ ESPERAR", "NO TRADE": "⛔ NO TRADE" };
const hourAr = (t: number) => new Date(t).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * La ficha de la operación, con el formato de siempre (ACTIVO, DIRECCIÓN,
 * CONFIANZA, ENTRADA, STOP LOSS, TP1-3, RIESGO, R:R, APALANCAMIENTO,
 * INVALIDACIÓN, RAZONAMIENTO, ESCENARIO ALTERNATIVO), para leer y copiar.
 * Sin operación lo dice; nunca rellena un número que no hay.
 */
export function deskTicket(d: DeskDecision): string {
  const lines: string[] = [];
  const close = `cierre 1 h de las ${hourAr(d.vela + 3_600_000)}`;
  lines.push(`ACTIVO: ${d.moneda}/USDT`);
  lines.push(`DIRECCIÓN: ${ARROW[d.direccion]}`);
  lines.push(`CONFIANZA: ${d.puntaje}/100 (confluencia de la mesa; no es probabilidad de acierto)`);
  lines.push(`ACIERTO MEDIDO: ${d.historial?.etiqueta ?? "todavía sin historial de setups parecidos"}`);
  lines.push(`PRECIO: ${px(d.precio)} · ${close}${d.precioVivo !== null ? ` · ahora ${px(d.precioVivo)} · ${d.precioVivoFuente}` : " · precio en vivo: este dato no está disponible actualmente"}`);
  const trade = (d.direccion === "LONG" || d.direccion === "SHORT") && d.plan && d.riesgo;
  if (trade && d.plan && d.riesgo) {
    const p = d.plan;
    const r = d.riesgo;
    lines.push(`ENTRADA: ${px(p.entrada)} · ${p.tipoEntrada === "LÍMITE" ? "orden límite" : "a mercado"}`);
    lines.push(`STOP LOSS: ${px(p.stop)} · ${p.stopRazon}`);
    p.tp.forEach((t, i) => lines.push(`TAKE PROFIT ${i + 1}: ${px(t.price)} · ${t.label}`));
    lines.push(`RIESGO: ${r.nivel}`);
    lines.push(`R:R: ${rrText(r.rrPonderado)} · ponderado, un tercio en cada objetivo (por objetivo ${r.rr.map(rrText).join(" / ")})`);
    lines.push(`APALANCAMIENTO SUGERIDO: ${r.apalancamiento}x · máximo seguro ${r.apalancamientoMaxSeguro}x · liquidación aprox. ${px(r.liquidacionAprox)}, ${arNumber(Number(r.liquidacionVsStop.toFixed(1)))} veces más lejos que el stop`);
    lines.push(r.posicionUsd !== null && r.riesgoUsd !== null ? `TAMAÑO: posición ${usd(r.posicionUsd)} (${px(r.cantidad ?? 0)} ${d.moneda}) · arriesgás ${usd(r.riesgoUsd)}${r.exposicionX !== null ? ` · exposición ${n2(r.exposicionX)}x tu capital` : ""}` : "TAMAÑO: cargá tu capital en «Mi riesgo» para calcularlo");
  } else {
    lines.push(`POR QUÉ: ${d.resolucion}`);
    if (d.direccion === "ESPERAR" && d.plan) lines.push(`SI SE DA: ${d.plan.lado} en ${px(d.plan.entrada)}, stop ${px(d.plan.stop)}, objetivos ${d.plan.tp.map((t) => px(t.price)).join(" / ")}${d.riesgo ? ` (R:R ${rrText(d.riesgo.rrPonderado)})` : ""}`);
    else lines.push("ENTRADA, STOP Y OBJETIVOS: sin operación");
    if (d.riesgo) lines.push(`RIESGO: ${d.riesgo.nivel}`);
  }
  lines.push(`INVALIDACIÓN: ${d.invalidacion}`);
  lines.push(`RAZONAMIENTO: ${trade ? d.resolucion : ""}${d.razonamiento.length ? `${trade ? " " : ""}${d.razonamiento.map((x) => `• ${x}`).join(" ")}` : ""}`.trim());
  lines.push(`ESCENARIO ALTERNATIVO: ${d.alternativo}`);
  if (d.faltantes.length) lines.push(`DATOS QUE FALTAN: ${d.faltantes.slice(0, 4).join("; ")}. Este dato no está disponible actualmente.`);
  lines.push(d.aviso);
  return lines.join("\n");
}

/** "¿Dónde entrarías?": el plan, o por qué no hay entrada. */
export function entrySpeech(d: DeskDecision): string {
  if ((d.direccion === "LONG" || d.direccion === "SHORT") && d.plan && d.riesgo) {
    const p = d.plan;
    return `${d.moneda}: entraría en ${d.direccion === "LONG" ? "largo" : "corto"} ${p.tipoEntrada === "LÍMITE" ? "con orden límite en" : "a mercado cerca de"} ${px(p.entrada)}, stop en ${px(p.stop)} (${p.stopRazon}). Objetivos: ${p.tp.map((t, i) => `TP${i + 1} ${px(t.price)}`).join(", ")}. Riesgo/beneficio ${rrText(d.riesgo.rrPonderado)}, riesgo ${d.riesgo.nivel.toLowerCase()}, apalancamiento sugerido ${d.riesgo.apalancamiento}x. ${d.invalidacion} ${d.aviso}`;
  }
  if (d.direccion === "ESPERAR" && d.plan) return `${d.moneda}: todavía no entraría. ${d.resolucion} Si se da, el plan sería ${d.plan.lado === "LONG" ? "largo" : "corto"} en ${px(d.plan.entrada)} con stop en ${px(d.plan.stop)}. ${d.aviso}`;
  return `${d.moneda}: no entraría. ${d.resolucion} ${d.aviso}`;
}

/** La decisión de la mesa, compacta, para que la IA de JARVIS converse sobre ella con estos mismos números. */
export function deskForAi(d: DeskDecision) {
  const plan = (p: Plan | null) => (p ? { lado: p.lado, entrada: p.entrada, tipoEntrada: p.tipoEntrada, stop: p.stop, objetivos: p.tp.map((t) => ({ precio: t.price, por: t.label })) } : null);
  return {
    moneda: d.moneda,
    precio: d.precio,
    direccion: d.direccion,
    puntajeDeConfluencia: `${d.puntaje}/100 (no es probabilidad)`,
    aciertoMedido: d.historial?.etiqueta ?? "sin historial todavía",
    plan: plan(d.plan),
    riesgo: d.riesgo ? { rrPonderado: Number(d.riesgo.rrPonderado.toFixed(2)), nivel: d.riesgo.nivel, apalancamientoSugerido: d.riesgo.apalancamiento, liquidacionAprox: d.riesgo.liquidacionAprox, vetos: d.riesgo.vetos, esperas: d.riesgo.esperas, avisos: d.riesgo.avisos } : null,
    porQue: d.resolucion,
    invalidacion: d.invalidacion,
    alternativo: d.alternativo,
    escenarioAlcista: { plan: plan(d.alcista.plan), argumentos: d.alcista.argumentos },
    escenarioBajista: { plan: plan(d.bajista.plan), argumentos: d.bajista.argumentos },
    especialistas: d.agentes.map((a) => ({ nombre: a.nombre, disponible: a.disponible, sesgo: Number(a.sesgo.toFixed(2)), hallazgos: a.hallazgos.slice(0, 4), falta: a.faltantes })),
    faltantes: d.faltantes,
  };
}
