import { arNumber } from "./ai-numbers.ts";
import { FEE_PCT } from "./jarvis-ledger.ts";
import type { DeskDecision, DeskRecord, Direction, Side } from "./jarvis-desk.ts";
import type { SwingCandle } from "./swing-entries.ts";

/**
 * Paper trading de JARVIS TRADING: seguir un plan de la mesa sin plata real y
 * medir qué habría pasado. Reglas fijas desde que se abre, nada se edita
 * después:
 *
 *  - Entrada al cierre de la vela de 1 h que leyó la mesa (a mercado), o
 *    cuando el precio toca el nivel (límite). Una orden límite que ve el TP1
 *    antes de llenarse, o que pasa 48 h sin llenarse, se cancela.
 *  - Salida de un tercio en cada objetivo; el stop no se mueve (es el plan que
 *    mostró la tarjeta y su R:R ponderado).
 *  - Peor caso primero: si una vela toca el stop y un objetivo, cuenta el stop.
 *    En la vela que llena una límite, solo cuenta el stop.
 *  - Comisión de 0,05% por lado. A los 7 días se cierra lo que quede al cierre.
 *
 * Cada operación guarda su cadena de auditoría: ANÁLISIS (qué leyó la mesa),
 * DECISIÓN (el plan), RESULTADO (las salidas), ERROR o ACIERTO, y APRENDIZAJE:
 * una observación medida (cuánto fue a favor y en contra). El aprendizaje
 * informa; nunca cambia las reglas de la mesa.
 */

export const PAPER_HORIZON_H = 168;
export const LIMIT_EXPIRY_H = 48;
const H = 3_600_000;

export type PaperState = "PENDIENTE" | "ABIERTA" | "CERRADA" | "CANCELADA";
export type ExitKind = "TP1" | "TP2" | "TP3" | "STOP" | "TIEMPO" | "MANUAL";
export type PaperExit = { kind: ExitKind; price: number; at: number; fraction: number };

export type PaperTrade = {
  id: string;
  symbol: string;
  lado: Side;
  estado: PaperState;
  /** Cuándo la persona la abrió. */
  abiertaA: number;
  /** Apertura de la vela de 1 h que leyó la mesa: la entrada a mercado es su cierre. */
  vela: number;
  tipoEntrada: "MERCADO" | "LÍMITE";
  entrada: number;
  stop: number;
  tp: [number, number, number];
  /** R:R ponderado del plan al abrir. */
  rrPlan: number;
  /** Puntaje de confluencia de la mesa al abrir (no es una probabilidad). */
  confianza: number;
  analisis: {
    direccionMesa: Direction;
    consenso: number;
    cobertura: number;
    regimen: string | null;
    /** Sesgo de cada especialista con datos (−1 a +1). */
    sesgos: Record<string, number>;
    motivo: string;
    razonamiento: string[];
    fuentes: string[];
  };
  decision: { riesgoNivel: string; apalancamiento: number; riesgoUsd: number | null; posicionUsd: number | null; stopPct: number };
  salidas: PaperExit[];
  llenadaA: number | null;
  cerradaA: number | null;
  /** Neto de comisiones, en R; null mientras no cierra. */
  resultadoR: number | null;
  /** Máximo a favor y en contra, en R, desde que se llenó. */
  mfeR: number | null;
  maeR: number | null;
  /** Última vela de 1 h ya revisada. */
  revisadaHasta: number | null;
  /** De dónde salieron las velas que la resolvieron. */
  fuenteVelas: string | null;
  motivoCierre: string | null;
};

const dirOf = (side: Side) => (side === "LONG" ? 1 : -1);
const riskOf = (t: Pick<PaperTrade, "entrada" | "stop">) => Math.abs(t.entrada - t.stop);

/**
 * ¿Se puede seguir este plan en papel? Solo un plan que el gestor de riesgo
 * no vetó: LONG o SHORT a mercado, o una orden límite sin otra espera.
 */
export function canPaper(d: DeskDecision): boolean {
  if (!d.plan || !d.riesgo || d.riesgo.vetos.length) return false;
  if (d.direccion === "LONG" || d.direccion === "SHORT") return true;
  return d.direccion === "ESPERAR" && d.plan.tipoEntrada === "LÍMITE" && d.riesgo.esperas.every((e) => e.startsWith("Entrada límite"));
}

/** La operación de papel que sigue el plan de la mesa, con su análisis congelado. */
export function paperFromDesk(d: DeskDecision, now: number): PaperTrade | null {
  if (!canPaper(d) || !d.plan || !d.riesgo) return null;
  const p = d.plan;
  const sesgos: Record<string, number> = {};
  for (const a of d.agentes) if (a.disponible && a.peso > 0) sesgos[a.id] = Number(a.sesgo.toFixed(3));
  const regimen = d.agentes.find((a) => a.id === "volatilidad")?.datos.regimen;
  return {
    id: `${d.symbol}:${d.vela}:${p.lado}:${p.tipoEntrada === "LÍMITE" ? "L" : "M"}`,
    symbol: d.symbol,
    lado: p.lado,
    estado: p.tipoEntrada === "LÍMITE" ? "PENDIENTE" : "ABIERTA",
    abiertaA: now,
    vela: d.vela,
    tipoEntrada: p.tipoEntrada,
    entrada: p.entrada,
    stop: p.stop,
    tp: [p.tp[0].price, p.tp[1].price, p.tp[2].price],
    rrPlan: d.riesgo.rrPonderado,
    confianza: d.puntaje,
    analisis: {
      direccionMesa: d.direccion,
      consenso: Number(d.consenso.toFixed(3)),
      cobertura: Number(d.cobertura.toFixed(3)),
      regimen: typeof regimen === "string" ? regimen : null,
      sesgos,
      motivo: d.resolucion,
      razonamiento: d.razonamiento.slice(0, 6),
      fuentes: d.fuentes.slice(0, 8),
    },
    decision: { riesgoNivel: d.riesgo.nivel, apalancamiento: d.riesgo.apalancamiento, riesgoUsd: d.riesgo.riesgoUsd, posicionUsd: d.riesgo.posicionUsd, stopPct: d.riesgo.stopPct },
    salidas: [],
    llenadaA: p.tipoEntrada === "LÍMITE" ? null : d.vela + H,
    cerradaA: null,
    resultadoR: null,
    mfeR: null,
    maeR: null,
    revisadaHasta: null,
    fuenteVelas: null,
    motivoCierre: null,
  };
}

/** Plan geométricamente válido: stop y objetivos del lado correcto, en orden. */
export function validPlan(t: Pick<PaperTrade, "lado" | "entrada" | "stop" | "tp">): boolean {
  const s = dirOf(t.lado);
  const nums = [t.entrada, t.stop, ...t.tp];
  if (!nums.every((v) => typeof v === "number" && Number.isFinite(v) && v > 0)) return false;
  return s * (t.entrada - t.stop) > 0 && s * (t.tp[0] - t.entrada) > 0 && s * (t.tp[1] - t.tp[0]) > 0 && s * (t.tp[2] - t.tp[1]) > 0;
}

/** El resultado en R de una lista de salidas, neto de comisiones (las dos puntas). */
export function resultOf(t: Pick<PaperTrade, "lado" | "entrada" | "stop">, salidas: PaperExit[]): number {
  const risk = riskOf(t);
  const s = dirOf(t.lado);
  let r = 0;
  let fees = (FEE_PCT / 100) * t.entrada;
  for (const x of salidas) {
    r += x.fraction * ((s * (x.price - t.entrada)) / risk);
    fees += x.fraction * (FEE_PCT / 100) * x.price;
  }
  return r - fees / risk;
}

/**
 * Avanza una operación con las velas de 1 h (de cualquier rango: usa solo las
 * cerradas a `now` y posteriores a lo ya revisado). Devuelve la operación
 * nueva; si no hay velas nuevas, la misma.
 */
export function resolvePaper(t: PaperTrade, candles: SwingCandle[], now: number, fuente: string | null = null): PaperTrade {
  if (t.estado === "CERRADA" || t.estado === "CANCELADA") return t;
  const from = t.revisadaHasta ?? t.vela;
  const fresh = candles.filter((c) => c.openTime > from && c.openTime + H <= now).sort((a, b) => a.openTime - b.openTime);
  if (!fresh.length) return t;
  const s = dirOf(t.lado);
  const risk = riskOf(t);
  let x: PaperTrade = { ...t, salidas: [...t.salidas], fuenteVelas: fuente ?? t.fuenteVelas };
  const remaining = () => 1 - x.salidas.reduce((p, e) => p + e.fraction, 0);
  const close = (motivo: string, at: number): PaperTrade => {
    x = { ...x, estado: "CERRADA", cerradaA: at, resultadoR: resultOf(x, x.salidas), motivoCierre: motivo };
    return x;
  };
  for (const c of fresh) {
    x.revisadaHasta = c.openTime;
    const end = c.openTime + H;
    const hiR = (s > 0 ? c.high - x.entrada : x.entrada - c.low) / risk;
    const loR = (s > 0 ? x.entrada - c.low : c.high - x.entrada) / risk;
    const touchesStop = s > 0 ? c.low <= x.stop : c.high >= x.stop;
    if (x.estado === "PENDIENTE") {
      const touchesEntry = s > 0 ? c.low <= x.entrada : c.high >= x.entrada;
      const touchesTp1 = s > 0 ? c.high >= x.tp[0] : c.low <= x.tp[0];
      if (!touchesEntry) {
        if (touchesTp1) return { ...x, estado: "CANCELADA", cerradaA: end, motivoCierre: "Se fue al TP1 sin llenar la orden límite." };
        if (end - (x.abiertaA ?? x.vela) >= LIMIT_EXPIRY_H * H) return { ...x, estado: "CANCELADA", cerradaA: end, motivoCierre: `Pasaron ${LIMIT_EXPIRY_H} h sin llenar la orden límite.` };
        continue;
      }
      // Filled on this candle. Worst case first: only the stop counts on the fill candle.
      x = { ...x, estado: "ABIERTA", llenadaA: c.openTime, mfeR: 0, maeR: Math.max(0, loR) };
      if (touchesStop) {
        x.salidas.push({ kind: "STOP", price: x.stop, at: end, fraction: remaining() });
        return close("Se llenó y tocó el stop en la misma vela.", end);
      }
      continue;
    }
    x.mfeR = Math.max(x.mfeR ?? 0, hiR);
    x.maeR = Math.max(x.maeR ?? 0, loR);
    if (touchesStop) {
      x.salidas.push({ kind: "STOP", price: x.stop, at: end, fraction: remaining() });
      return close(x.salidas.length > 1 ? "Tocó el stop después de cobrar parte en los objetivos." : "Tocó el stop.", end);
    }
    for (let k = 0; k < 3; k += 1) {
      const kind = (["TP1", "TP2", "TP3"] as const)[k];
      if (x.salidas.some((e) => e.kind === kind)) continue;
      const hit = s > 0 ? c.high >= x.tp[k] : c.low <= x.tp[k];
      if (!hit) break;
      x.salidas.push({ kind, price: x.tp[k], at: end, fraction: k === 2 ? remaining() : 1 / 3 });
    }
    if (remaining() <= 1e-9) return close("Llegó a los tres objetivos.", end);
    const filledAt = x.llenadaA ?? x.vela + H;
    if (end - filledAt >= PAPER_HORIZON_H * H) {
      x.salidas.push({ kind: "TIEMPO", price: c.close, at: end, fraction: remaining() });
      return close(`Pasaron ${PAPER_HORIZON_H / 24} días: se cerró lo que quedaba al cierre.`, end);
    }
  }
  return x;
}

/** Cierre manual al precio dado (la última vela cerrada que vio la persona). */
export function closeManually(t: PaperTrade, price: number, at: number): PaperTrade {
  if (t.estado === "PENDIENTE") return { ...t, estado: "CANCELADA", cerradaA: at, motivoCierre: "Cancelada a mano antes de llenarse." };
  if (t.estado !== "ABIERTA" || !(price > 0)) return t;
  const rest = 1 - t.salidas.reduce((p, e) => p + e.fraction, 0);
  const salidas = [...t.salidas, { kind: "MANUAL" as const, price, at, fraction: rest }];
  return { ...t, salidas, estado: "CERRADA", cerradaA: at, resultadoR: resultOf(t, salidas), motivoCierre: "Cerrada a mano." };
}

/** La R que va ganando o perdiendo una abierta al precio dado (lo cobrado más lo que queda). */
export function openR(t: PaperTrade, price: number): number | null {
  if (t.estado !== "ABIERTA") return null;
  const rest = 1 - t.salidas.reduce((p, e) => p + e.fraction, 0);
  return resultOf(t, [...t.salidas, { kind: "MANUAL", price, at: 0, fraction: rest }]);
}

// ── Auditoría: ANÁLISIS → DECISIÓN → RESULTADO → ERROR/ACIERTO → APRENDIZAJE ──

const AGENT_NAMES: Record<string, string> = {
  tecnico: "técnico",
  estructura: "estructura",
  volumen: "volumen",
  derivados: "derivados",
  liquidaciones: "liquidaciones",
  macro: "macro",
  noticias: "noticias",
  sentimiento: "sentimiento",
  correlacion: "correlación",
  volatilidad: "volatilidad",
};
const r1 = (v: number) => arNumber(Number(v.toFixed(2)));
const px = (v: number) => arNumber(v);

export type Audit = { analisis: string; decision: string; resultado: string; veredicto: "ACIERTO" | "ERROR" | "NEUTRO" | "ABIERTA" | "CANCELADA"; detalle: string; aprendizaje: string };

export function auditOf(t: PaperTrade): Audit {
  const coin = t.symbol.replace(/USDT$/, "");
  const fav = Object.entries(t.analisis.sesgos).filter(([, v]) => dirOf(t.lado) * v >= 0.05).map(([k]) => AGENT_NAMES[k] ?? k);
  const against = Object.entries(t.analisis.sesgos).filter(([, v]) => dirOf(t.lado) * v <= -0.05).map(([k]) => AGENT_NAMES[k] ?? k);
  const analisis = `La mesa leyó ${coin} con consenso ${r1(t.analisis.consenso)} y ${Math.round(t.analisis.cobertura * 100)}% del peso con datos${t.analisis.regimen ? `, volatilidad ${t.analisis.regimen.toLowerCase()}` : ""}. A favor: ${fav.join(", ") || "nadie"}. En contra: ${against.join(", ") || "nadie"}.`;
  const decision = `${t.lado} ${t.tipoEntrada === "LÍMITE" ? "con orden límite" : "a mercado"} en ${px(t.entrada)}, stop ${px(t.stop)}, objetivos ${t.tp.map(px).join(" / ")} · R:R 1:${r1(t.rrPlan)} · confluencia ${t.confianza}/100 · riesgo ${t.decision.riesgoNivel.toLowerCase()}.`;
  if (t.estado === "CANCELADA") return { analisis, decision, resultado: t.motivoCierre ?? "Cancelada.", veredicto: "CANCELADA", detalle: "No cuenta en las estadísticas: nunca se llenó.", aprendizaje: "Sin resultado que medir." };
  if (t.estado !== "CERRADA" || t.resultadoR === null) {
    const hit = t.salidas.map((e) => e.kind).join(", ");
    return { analisis, decision, resultado: t.estado === "PENDIENTE" ? "Esperando que el precio llene la orden límite." : `Abierta${hit ? `; ya cobró ${hit}` : ""}.`, veredicto: "ABIERTA", detalle: "Todavía sin resultado.", aprendizaje: "Se mide al cerrar." };
  }
  const hours = t.cerradaA && t.llenadaA ? Math.max(1, Math.round((t.cerradaA - t.llenadaA) / H)) : null;
  const exits = t.salidas.map((e) => `${e.kind} ${px(e.price)}${e.kind === "TP1" || e.kind === "TP2" || (e.kind === "TP3" && e.fraction < 0.34) ? " (un tercio)" : ""}`).join(" · ");
  const resultado = `${t.motivoCierre ?? "Cerrada"} Salidas: ${exits}. Resultado ${t.resultadoR >= 0 ? "+" : ""}${r1(t.resultadoR)} R neto de comisiones${t.decision.riesgoUsd !== null ? ` (${t.resultadoR >= 0 ? "+" : "−"}$${arNumber(Number(Math.abs(t.resultadoR * t.decision.riesgoUsd).toFixed(2)))})` : ""}${hours !== null ? ` en ${hours} h` : ""}.`;
  const veredicto = t.resultadoR > 0.02 ? "ACIERTO" : t.resultadoR < -0.02 ? "ERROR" : "NEUTRO";
  const right = veredicto === "ACIERTO" ? fav : veredicto === "ERROR" ? against : [];
  const wrong = veredicto === "ACIERTO" ? against : veredicto === "ERROR" ? fav : [];
  const detalle = veredicto === "NEUTRO" ? "Terminó prácticamente en cero." : `Acertaron: ${right.join(", ") || "ninguno"}. Erraron: ${wrong.join(", ") || "ninguno"}.`;
  const mfe = t.mfeR ?? 0;
  const mae = t.maeR ?? 0;
  let aprendizaje: string;
  if (veredicto === "ERROR" && mfe >= 1) aprendizaje = `Llegó a +${r1(mfe)} R a favor antes de volverse: el movimiento existió, pero el primer objetivo quedó más lejos.`;
  else if (veredicto === "ERROR" && mfe < 0.3) aprendizaje = `Nunca fue a favor (máximo +${r1(mfe)} R): la entrada quedó contra el movimiento inmediato.`;
  else if (veredicto === "ERROR") aprendizaje = `Fue hasta +${r1(mfe)} R a favor y volvió al stop.`;
  else if (t.salidas.some((e) => e.kind === "TIEMPO")) aprendizaje = `En ${PAPER_HORIZON_H / 24} días no llegó ni al stop ni a todos los objetivos (máximo +${r1(mfe)} R, mínimo −${r1(mae)} R): el movimiento esperado no apareció completo.`;
  else if (veredicto === "ACIERTO" && mae >= 0.8) aprendizaje = `Ganó, pero estuvo a −${r1(mae)} R de tocar el stop.`;
  else aprendizaje = `En contra como máximo −${r1(mae)} R; a favor hasta +${r1(mfe)} R.`;
  return { analisis, decision, resultado, veredicto, detalle, aprendizaje: `${aprendizaje} Es una observación: las reglas de la mesa no cambian solas.` };
}

// ── Estadísticas medidas, con su muestra ──

export const MIN_SAMPLE = 15;

export type PaperStats = {
  cerradas: number;
  abiertas: number;
  pendientes: number;
  ganadas: number;
  perdidas: number;
  winRate: number | null;
  profitFactor: number | null;
  expectativaR: number | null;
  totalR: number;
  mejorR: number | null;
  peorR: number | null;
  pnlUsd: number | null;
  duracionMediaH: number | null;
  muestra: "SIN DATOS" | "MUESTRA MÍNIMA" | "MUESTRA RAZONABLE";
};

export function paperStats(trades: PaperTrade[]): PaperStats {
  const closed = trades.filter((t) => t.estado === "CERRADA" && t.resultadoR !== null);
  const rs = closed.map((t) => t.resultadoR!);
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  const gross = wins.reduce((p, v) => p + v, 0);
  const lossSum = -losses.reduce((p, v) => p + v, 0);
  const usd = closed.filter((t) => t.decision.riesgoUsd !== null);
  const dur = closed.filter((t) => t.cerradaA && t.llenadaA).map((t) => (t.cerradaA! - t.llenadaA!) / H);
  return {
    cerradas: closed.length,
    abiertas: trades.filter((t) => t.estado === "ABIERTA").length,
    pendientes: trades.filter((t) => t.estado === "PENDIENTE").length,
    ganadas: wins.length,
    perdidas: losses.length,
    winRate: closed.length ? wins.length / closed.length : null,
    profitFactor: lossSum > 0 ? gross / lossSum : gross > 0 ? Infinity : null,
    expectativaR: closed.length ? rs.reduce((p, v) => p + v, 0) / closed.length : null,
    totalR: rs.reduce((p, v) => p + v, 0),
    mejorR: rs.length ? Math.max(...rs) : null,
    peorR: rs.length ? Math.min(...rs) : null,
    pnlUsd: usd.length ? usd.reduce((p, t) => p + t.resultadoR! * t.decision.riesgoUsd!, 0) : null,
    duracionMediaH: dur.length ? dur.reduce((p, v) => p + v, 0) / dur.length : null,
    muestra: closed.length === 0 ? "SIN DATOS" : closed.length < MIN_SAMPLE ? "MUESTRA MÍNIMA" : "MUESTRA RAZONABLE",
  };
}

/** El tramo de confluencia de un puntaje, para agrupar setups parecidos. */
export function confluenceBucket(score: number): string {
  return score >= 80 ? "80–100" : score >= 65 ? "65–79" : score >= 50 ? "50–64" : "0–49";
}

export type StatsGroup = { grupo: string; stats: PaperStats };

/** Por lado, por tramo de confluencia, por volatilidad y por especialista a favor. */
export function statsBy(trades: PaperTrade[]): StatsGroup[] {
  const out: StatsGroup[] = [];
  const add = (grupo: string, f: (t: PaperTrade) => boolean) => {
    const sub = trades.filter(f);
    if (sub.some((t) => t.estado === "CERRADA")) out.push({ grupo, stats: paperStats(sub) });
  };
  add("LONG", (t) => t.lado === "LONG");
  add("SHORT", (t) => t.lado === "SHORT");
  for (const b of ["80–100", "65–79", "50–64", "0–49"]) add(`Confluencia ${b}`, (t) => confluenceBucket(t.confianza) === b);
  for (const reg of ["COMPRIMIDA", "NORMAL", "EXPANDIDA"]) add(`Volatilidad ${reg.toLowerCase()}`, (t) => t.analisis.regimen === reg);
  for (const [id, name] of Object.entries(AGENT_NAMES)) add(`Con ${name} a favor`, (t) => dirOf(t.lado) * (t.analisis.sesgos[id] ?? 0) >= 0.05);
  return out;
}

const pctText = (v: number | null) => (v === null ? "sin dato" : `${Math.round(v * 100)}%`);

/**
 * El acierto medido de setups parecidos (mismo lado y tramo de confluencia)
 * para mostrar al lado del puntaje. Null si todavía no hay ninguno cerrado.
 */
export function recordFor(trades: PaperTrade[], side: Side, score: number): DeskRecord | null {
  const bucket = confluenceBucket(score);
  const st = paperStats(trades.filter((t) => t.lado === side && confluenceBucket(t.confianza) === bucket));
  if (!st.cerradas) return null;
  const label = `${st.cerradas} ${st.cerradas === 1 ? "operación de papel parecida" : "operaciones de papel parecidas"} (${side}, confluencia ${bucket}): ${st.ganadas} ${st.ganadas === 1 ? "ganada" : "ganadas"} (${pctText(st.winRate)}), expectativa ${st.expectativaR! >= 0 ? "+" : ""}${r1(st.expectativaR!)} R${st.muestra === "MUESTRA MÍNIMA" ? " · muestra mínima" : ""}.`;
  return { n: st.cerradas, ganadas: st.ganadas, winRate: st.winRate, expectativaR: st.expectativaR, etiqueta: label };
}

/** La decisión con su historial medido, si lo hay (el plan no cambia). */
export function withRecord(d: DeskDecision, trades: PaperTrade[]): DeskDecision {
  const side = d.plan?.lado ?? null;
  if (!side || !trades.length) return d;
  const historial = recordFor(trades, side, d.puntaje);
  return historial ? { ...d, historial } : d;
}

const pfText = (v: number | null) => (v === null ? "sin dato" : v === Infinity ? "infinito" : r1(v));

/** Lo que JARVIS dice de su propio paper trading. */
export function paperSpeech(trades: PaperTrade[]): string {
  const st = paperStats(trades);
  if (!st.cerradas) {
    const open = st.abiertas + st.pendientes;
    return open
      ? `Tengo ${open} ${open === 1 ? "operación de papel abierta" : "operaciones de papel abiertas"} y ninguna cerrada todavía: no hay resultados para medir.`
      : "Todavía no hay operaciones de papel. En JARVIS TRADING, con un plan aprobado, tocá «Simular en papel» o decime «simulá la operación».";
  }
  const parts = [
    `Paper trading: ${st.cerradas} ${st.cerradas === 1 ? "cerrada" : "cerradas"}, ${st.ganadas} ${st.ganadas === 1 ? "ganada" : "ganadas"} y ${st.perdidas} ${st.perdidas === 1 ? "perdida" : "perdidas"}. Win rate ${pctText(st.winRate)}, profit factor ${pfText(st.profitFactor)}, expectativa ${st.expectativaR! >= 0 ? "más" : "menos"} ${r1(Math.abs(st.expectativaR!))} R por operación, total ${st.totalR >= 0 ? "más" : "menos"} ${r1(Math.abs(st.totalR))} R.`,
  ];
  const groups = statsBy(trades).filter((g) => g.stats.cerradas >= 3 && g.stats.expectativaR !== null);
  const best = [...groups].sort((a, b) => b.stats.expectativaR! - a.stats.expectativaR!)[0];
  const worst = [...groups].sort((a, b) => a.stats.expectativaR! - b.stats.expectativaR!)[0];
  if (best && worst && best.grupo !== worst.grupo) {
    parts.push(`Mejor grupo: ${best.grupo.toLowerCase()} (${best.stats.cerradas}, expectativa ${r1(best.stats.expectativaR!)} R). Peor: ${worst.grupo.toLowerCase()} (${worst.stats.cerradas}, ${r1(worst.stats.expectativaR!)} R).`);
  }
  if (st.abiertas + st.pendientes) parts.push(`${st.abiertas + st.pendientes} siguen abiertas.`);
  parts.push(st.muestra === "MUESTRA RAZONABLE" ? "Es una muestra razonable, pero no garantiza resultados futuros." : "Es una muestra mínima: todavía no alcanza para sacar conclusiones.");
  parts.push("Simulado, sin plata real.");
  return parts.join(" ");
}

export function paperCsv(trades: PaperTrade[]): string {
  const head = "abierta;moneda;lado;tipo;entrada;stop;tp1;tp2;tp3;confluencia;rr_plan;estado;salidas;resultado_R;pnl_usd;horas;motivo";
  const rows = trades.map((t) => {
    const hours = t.cerradaA && t.llenadaA ? ((t.cerradaA - t.llenadaA) / H).toFixed(1) : "";
    const pnl = t.resultadoR !== null && t.decision.riesgoUsd !== null ? (t.resultadoR * t.decision.riesgoUsd).toFixed(2) : "";
    return [new Date(t.abiertaA).toISOString(), t.symbol, t.lado, t.tipoEntrada, t.entrada, t.stop, t.tp[0], t.tp[1], t.tp[2], t.confianza, t.rrPlan.toFixed(2), t.estado, t.salidas.map((e) => `${e.kind}@${e.price}`).join(" "), t.resultadoR === null ? "" : t.resultadoR.toFixed(3), pnl, hours, (t.motivoCierre ?? "").replace(/;/g, ",")]
      .map((v) => (typeof v === "number" ? String(v).replace(".", ",") : String(v).replace(/^(-?\d+)\.(\d+)$/, "$1,$2")))
      .join(";");
  });
  return `\uFEFF${[head, ...rows].join("\r\n")}\r\n`;
}

/**
 * Lo que el servidor acepta de un navegador: la forma completa, el plan válido
 * y números sanos. El resultado lo recalcula el servidor con `resultOf`.
 */
export function validatePaper(raw: unknown, now: number): PaperTrade | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as PaperTrade;
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (typeof t.id !== "string" || t.id.length > 80 || typeof t.symbol !== "string" || !/^[A-Z0-9]{2,20}USDT$/.test(t.symbol)) return null;
  if (t.lado !== "LONG" && t.lado !== "SHORT") return null;
  if (!["PENDIENTE", "ABIERTA", "CERRADA", "CANCELADA"].includes(t.estado)) return null;
  if (t.tipoEntrada !== "MERCADO" && t.tipoEntrada !== "LÍMITE") return null;
  if (!Array.isArray(t.tp) || t.tp.length !== 3 || !validPlan(t)) return null;
  if (!num(t.abiertaA) || !num(t.vela) || t.vela > now || t.abiertaA > now + 60_000 || !num(t.rrPlan) || !num(t.confianza) || t.confianza < 0 || t.confianza > 100) return null;
  if (!t.analisis || typeof t.analisis !== "object" || !t.decision || typeof t.decision !== "object" || !Array.isArray(t.salidas) || t.salidas.length > 4) return null;
  let fraction = 0;
  for (const e of t.salidas) {
    if (!e || !["TP1", "TP2", "TP3", "STOP", "TIEMPO", "MANUAL"].includes(e.kind) || !num(e.price) || e.price <= 0 || !num(e.at) || !num(e.fraction) || e.fraction <= 0) return null;
    // A target or the stop exits exactly at the plan's price.
    const planned = e.kind === "STOP" ? t.stop : e.kind === "TP1" ? t.tp[0] : e.kind === "TP2" ? t.tp[1] : e.kind === "TP3" ? t.tp[2] : null;
    if (planned !== null && Math.abs(e.price - planned) > planned * 1e-9) return null;
    fraction += e.fraction;
  }
  if (fraction > 1 + 1e-6) return null;
  if (t.estado === "CERRADA" && Math.abs(fraction - 1) > 1e-6) return null;
  if ((t.estado === "PENDIENTE" || t.estado === "CANCELADA") && t.salidas.length) return null;
  if (t.estado === "ABIERTA" && fraction > 1 - 1e-6) return null;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  return {
    ...t,
    analisis: {
      direccionMesa: t.analisis.direccionMesa,
      consenso: num(t.analisis.consenso) ? t.analisis.consenso : 0,
      cobertura: num(t.analisis.cobertura) ? t.analisis.cobertura : 0,
      regimen: typeof t.analisis.regimen === "string" ? t.analisis.regimen.slice(0, 20) : null,
      sesgos: Object.fromEntries(Object.entries(t.analisis.sesgos ?? {}).filter(([k, v]) => k in AGENT_NAMES && num(v)).map(([k, v]) => [k, Math.max(-1, Math.min(1, v as number))])),
      motivo: text(t.analisis.motivo, 600),
      razonamiento: (Array.isArray(t.analisis.razonamiento) ? t.analisis.razonamiento : []).slice(0, 6).map((r) => text(r, 300)),
      fuentes: (Array.isArray(t.analisis.fuentes) ? t.analisis.fuentes : []).slice(0, 8).map((r) => text(r, 200)),
    },
    decision: {
      riesgoNivel: text(t.decision.riesgoNivel, 10),
      apalancamiento: num(t.decision.apalancamiento) ? t.decision.apalancamiento : 1,
      riesgoUsd: num(t.decision.riesgoUsd) ? t.decision.riesgoUsd : null,
      posicionUsd: num(t.decision.posicionUsd) ? t.decision.posicionUsd : null,
      stopPct: num(t.decision.stopPct) ? t.decision.stopPct : 0,
    },
    motivoCierre: t.motivoCierre === null || t.motivoCierre === undefined ? null : text(t.motivoCierre, 200),
    fuenteVelas: t.fuenteVelas === null || t.fuenteVelas === undefined ? null : text(t.fuenteVelas, 80),
    // The result is never taken from the browser: it is the exits, priced by the plan.
    resultadoR: t.estado === "CERRADA" ? resultOf(t, t.salidas) : null,
  };
}

/** El historial de papel para el contexto de la IA: números medidos y las últimas lecciones. */
export function paperForAi(trades: PaperTrade[]) {
  if (!trades.length) return null;
  const st = paperStats(trades);
  const recent = trades.filter((t) => t.estado === "CERRADA").slice(0, 5).map((t) => {
    const a = auditOf(t);
    return { moneda: t.symbol.replace(/USDT$/, ""), lado: t.lado, confluencia: t.confianza, resultadoR: t.resultadoR === null ? null : arNumber(Number(t.resultadoR.toFixed(2))), veredicto: a.veredicto, aprendizaje: a.aprendizaje };
  });
  return {
    simulado: true,
    cerradas: st.cerradas,
    abiertas: st.abiertas + st.pendientes,
    winRate: st.winRate === null ? null : `${Math.round(st.winRate * 100)}%`,
    profitFactor: st.profitFactor === null ? null : st.profitFactor === Infinity ? "infinito" : arNumber(Number(st.profitFactor.toFixed(2))),
    expectativaR: st.expectativaR === null ? null : arNumber(Number(st.expectativaR.toFixed(2))),
    muestra: st.muestra,
    ultimas: recent,
  };
}
