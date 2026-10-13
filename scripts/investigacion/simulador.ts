/**
 * Simulador rápido de la mesa sobre lecturas precalculadas (ver precalcular.ts).
 *
 * Reproduce las decisiones de la mesa (lib/jarvis-desk.ts) y las reglas del papel (lib/jarvis-paper.ts) sin volver a
 * correr los especialistas en cada paso, para probar muchas reglas en segundos. Se validó contra el backtest real de la
 * app (lib/jarvis-backtest.ts): coincide salvo 10 de 2.884 operaciones. Si cambia el motor, volvé a validarlo con
 * `medir.ts --real`. Reglas que no se pueden olvidar: una operación a la vez, peor caso primero (si una vela toca
 * stop y objetivo cuenta el stop), comisión por lado, y nada de mirar velas posteriores a la decisión.
 */
import { readFileSync } from "node:fs";
import { H, SALIDA, velasBase, type Perfil, PERFILES } from "./util.ts";

/** Lo que la mesa veía en un cierre (solo velas cerradas). Ver precalcular.ts. */
export type Lectura = {
  /** Hora de la lectura y apertura de la última vela base cerrada. */
  t: number;
  vela: number;
  /** Precio (cierre de la última vela base) y ATR de la vela «de 4 h». */
  p: number;
  atr: number;
  /** Niveles: [precio, mínimo, máximo, estrellas]. */
  sup: number[][];
  res: number[][];
  /** Imanes: [precio, distancia %, intensidad]. */
  mu: number[] | null;
  md: number[] | null;
  /** Consenso: [valor, cobertura, acuerdo alcista, acuerdo bajista]. */
  c: number[];
  /** Voto de cada especialista con peso (−1 … +1). */
  ses: Record<string, number>;
  reg: string | null;
  al: string;
  tf: Record<string, string>;
  rsi: (number | null)[];
  ema: (number | null)[];
  vr: (number | null)[];
  ch24: number | null;
  lb: [string, number, number] | null;
};

export type Params = {
  edgeLong: number;
  edgeShort: number;
  stopBufAtr: number;
  stopFallbackAtr: number;
  anchorMinAtr: number;
  minRR: number;
  minRRHigh: number;
  tpMults: number[];
  fractions: number[];
  beAfterTp1: boolean;
  trailAfterTp2: boolean;
  /** Horizonte y vencimiento de la orden límite, en velas base. */
  horizonH: number;
  maxStopAtr: number;
  volNotAgainst: boolean;
  structNotAgainst: boolean;
  allowShorts: boolean;
  allowLongs: boolean;
  limitAlt: boolean;
  trendFilter: "none" | "d1" | "align" | "ema200";
  /** Si la vela que cobra el TP1 también toca la entrada, el resto sale en la entrada (peor caso). */
  beWorst: boolean;
  rsiMaxLong: number;
  rsiMinShort: number;
  tp1MaxR: number;
  minConfluence: number;
  /** Comisión por lado, como fracción (0,0005 = 0,05%). */
  fee: number;
  /** Filtro sobre la lectura antes de armar el plan. */
  extra?: (s: Lectura, side: "LONG" | "SHORT") => boolean;
  /** Filtro sobre el plan ya armado y aprobado por riesgo. */
  post?: (s: Lectura, pl: Plan) => boolean;
};

export const COMISION_PCT = Number(process.env.COMISION_PCT ?? 0.05);

/** Reglas v1 de la mesa (antes de docs/mesa-reglas-v2.md). */
export const V1: Params = {
  edgeLong: 0.15, edgeShort: 0.15, stopBufAtr: 0.25, stopFallbackAtr: 1.5, anchorMinAtr: 0.4, minRR: 1.5, minRRHigh: 2,
  tpMults: [1.5, 2.5, 3.5], fractions: [1 / 3, 1 / 3, 1 / 3], beAfterTp1: false, trailAfterTp2: false, horizonH: 168, maxStopAtr: 3.5,
  volNotAgainst: false, structNotAgainst: false, allowShorts: true, allowLongs: true, limitAlt: true, trendFilter: "none", beWorst: false,
  rsiMaxLong: 101, rsiMinShort: -1, tp1MaxR: 99, minConfluence: 0, fee: COMISION_PCT / 100,
};
/** Reglas v2 (las de la app hoy: DESK_RULES = 2). */
export const V2: Params = { ...V1, beAfterTp1: true, beWorst: true, stopBufAtr: 1, edgeLong: 0.3, edgeShort: 0.3 };

export type Plan = { side: "LONG" | "SHORT"; entry: number; stop: number; tp: number[]; limit: boolean; rr: number; stopAtr: number; stopPct: number };
const lvl = (l: number[]) => ({ price: l[0], low: l[1], high: l[2], stars: l[3] });

/** Plan de un lado (lib/jarvis-desk.ts › buildPlan): stop detrás del nivel con margen de ATR, objetivos en los niveles siguientes. */
export function buildPlan(side: "LONG" | "SHORT", s: Lectura, P: Params, entryOverride?: number): Plan | null {
  const long = side === "LONG";
  const entry = entryOverride ?? s.p;
  const atr = s.atr;
  if (!(entry > 0) || !(atr > 0)) return null;
  const sups = s.sup.map(lvl).filter((l) => l.price < entry).sort((a, b) => b.price - a.price);
  const ress = s.res.map(lvl).filter((l) => l.price > entry).sort((a, b) => a.price - b.price);
  const against = long ? sups : ress;
  const anchor = against.find((l) => Math.abs(entry - l.price) >= P.anchorMinAtr * atr);
  let stop: number;
  if (anchor) {
    const edge = long ? Math.min(anchor.low, anchor.price) : Math.max(anchor.high, anchor.price);
    stop = long ? edge - P.stopBufAtr * atr : edge + P.stopBufAtr * atr;
  } else stop = long ? entry - P.stopFallbackAtr * atr : entry + P.stopFallbackAtr * atr;
  const risk = Math.abs(entry - stop);
  if (!(risk > 0) || (long && stop <= 0)) return null;
  const favor = long ? ress : sups;
  const cands = favor.map((l) => l.price);
  const mag = long ? s.mu : s.md;
  if (mag && (long ? mag[0] > entry : mag[0] < entry)) cands.push(mag[0]);
  cands.sort((x, y) => (long ? x - y : y - x));
  const dist = (p: number) => (long ? p - entry : entry - p);
  const tps: number[] = [];
  let floor = risk;
  for (const mult of P.tpMults) {
    const next = cands.find((c) => dist(c) >= floor && !tps.includes(c) && (tps.length > 0 || dist(c) <= P.tp1MaxR * risk));
    if (next !== undefined) tps.push(next);
    else {
      const d = Math.max(mult * risk, floor);
      tps.push(long ? entry + d : entry - d);
    }
    floor = dist(tps[tps.length - 1]) + 0.5 * risk;
  }
  if (!long && tps.some((t) => t <= 0)) return null;
  const rrs = tps.map((t) => dist(t) / risk);
  // Con un tercio por objetivo, la cuenta de la mesa (rrOf): suma y división, no tres productos (cambia el último decimal).
  const rr = P.fractions.every((f) => f === 1 / 3) ? (rrs[0] + rrs[1] + rrs[2]) / 3 : rrs.reduce((a, r, i) => a + r * P.fractions[i], 0);
  return { side, entry, stop, tp: tps, limit: entryOverride !== undefined, rr, stopAtr: risk / atr, stopPct: (risk / entry) * 100 };
}

/** Gestor de riesgo (lib/jarvis-desk.ts › reviewRisk), sin lo que el backtest no tiene (eventos, derivados). */
function riskOk(pl: Plan, s: Lectura, P: Params): boolean {
  if (pl.rr < P.minRR) return false;
  if (pl.stopPct < 0.25 || pl.stopPct > 10 || pl.stopAtr > P.maxStopAtr) return false;
  const high = pl.stopAtr > 2.2 || s.reg === "EXPANDIDA" || s.c[1] < 0.5;
  if (high && pl.rr < P.minRRHigh) return false;
  return true;
}

/** Puntaje de confluencia (lib/jarvis-desk.ts › confluenceScore). */
export function confluence(s: Lectura, side: "LONG" | "SHORT") {
  const [v, cov, agreeLong, agreeShort] = s.c;
  const agree = side === "LONG" ? agreeLong : agreeShort;
  return Math.round(100 * (0.5 * agree + 0.5 * Math.min(1, Math.abs(v) / 0.6)) * (0.5 + 0.5 * cov));
}

function decide0(s: Lectura, P: Params): Plan | null {
  const v = s.c[0];
  const side = v >= P.edgeLong ? "LONG" : v <= -P.edgeShort ? "SHORT" : null;
  if (!side) return null;
  if (side === "SHORT" && !P.allowShorts) return null;
  if (side === "LONG" && !P.allowLongs) return null;
  const sg = side === "LONG" ? 1 : -1;
  if (P.volNotAgainst && sg * (s.ses.volumen ?? 0) <= -0.05) return null;
  if (P.structNotAgainst && sg * (s.ses.estructura ?? 0) <= -0.05) return null;
  if (P.trendFilter === "d1" && s.tf["1d"] !== (side === "LONG" ? "ALCISTA" : "BAJISTA")) return null;
  if (P.trendFilter === "align" && s.al !== (side === "LONG" ? "ALCISTA" : "BAJISTA")) return null;
  if (P.trendFilter === "ema200") {
    const sma = s.ema[3] ?? s.ema[2];
    if (sma === null || (side === "LONG" ? s.p < sma : s.p > sma)) return null;
  }
  const r4 = s.rsi[1];
  if (r4 !== null && side === "LONG" && r4 > P.rsiMaxLong) return null;
  if (r4 !== null && side === "SHORT" && r4 < P.rsiMinShort) return null;
  if (confluence(s, side) < P.minConfluence) return null;
  if (P.extra && !P.extra(s, side)) return null;
  const market = buildPlan(side, s, P);
  // Igual que la mesa (bestPlan en lib/jarvis-desk.ts): la orden límite se prueba solo si a mercado el R:R no llega al mínimo.
  // Si llega y otro veto lo frena (stop lejos, riesgo alto), no hay operación. Con los pisos de los objetivos el R:R de un
  // plan a mercado nunca baja de 1,5, así que en la práctica la alternativa límite casi no se usa.
  if (market && market.rr >= P.minRR) return riskOk(market, s, P) ? market : null;
  if (!P.limitAlt) return null;
  const level = (side === "LONG" ? s.sup.map(lvl).filter((l) => l.price < s.p).sort((a, b) => b.price - a.price) : s.res.map(lvl).filter((l) => l.price > s.p).sort((a, b) => a.price - b.price))[0];
  if (!level || Math.abs(s.p - level.price) / s.p > 0.08) return null;
  const at = side === "LONG" ? Math.max(level.price, level.high) : Math.min(level.price, level.low);
  const limit = buildPlan(side, s, P, at);
  return limit && riskOk(limit, s, P) ? limit : null;
}

/** La decisión de la mesa en una lectura: el plan aprobado (a mercado o límite) o nada. */
export function decide(s: Lectura, P: Params): Plan | null {
  const pl = decide0(s, P);
  if (pl && P.post && !P.post(s, pl)) return null;
  return pl;
}

/** `t` es la hora de la decisión y `fin` cuándo se cerró (la peor caída se ordena por cierre, como en la app). */
export type Operacion = { sym: string; side: string; t: number; fin: number; r: number; exits: string; dur: number; limit: boolean; rrPlan: number; mfe: number };
export type Resuelta = { r: number; exits: string; end: number; filledAt: number | null; mfe: number; cancelled?: boolean };
type Vela = { openTime: number; open: number; high: number; low: number; close: number };

/** Una operación con velas base desde `startIdx` (la primera posterior al cierre de la decisión), peor caso primero. */
export function resolve(pl: Plan, c: Vela[], startIdx: number, P: Params): Resuelta | null {
  const sg = pl.side === "LONG" ? 1 : -1;
  let filled = !pl.limit;
  let filledAt: number | null = filled ? c[startIdx]?.openTime ?? null : null;
  const entry = pl.entry;
  const risk = Math.abs(entry - pl.stop);
  let stop = pl.stop;
  let rem = 1;
  let r = 0;
  let fees = P.fee * entry;
  const ex: string[] = [];
  let hit = 0;
  let mfe = 0;
  const exitAt = (price: number, frac: number, kind: string) => {
    r += (frac * (sg * (price - entry))) / risk;
    fees += frac * P.fee * price;
    rem -= frac;
    ex.push(kind);
  };
  for (let i = startIdx; i < c.length; i++) {
    const k = c[i];
    const end = k.openTime + H;
    if (!filled) {
      const touches = sg > 0 ? k.low <= entry : k.high >= entry;
      const tp1 = sg > 0 ? k.high >= pl.tp[0] : k.low <= pl.tp[0];
      if (!touches) {
        if (tp1) return { r: 0, exits: "", end, filledAt: null, mfe: 0, cancelled: true };
        if (end - c[startIdx].openTime >= 48 * H) return { r: 0, exits: "", end, filledAt: null, mfe: 0, cancelled: true };
        continue;
      }
      filled = true;
      filledAt = k.openTime;
      if (sg > 0 ? k.low <= stop : k.high >= stop) {
        exitAt(stop, rem, "STOP");
        return { r: r - fees / risk, exits: ex.join(","), end, filledAt, mfe };
      }
      continue;
    }
    mfe = Math.max(mfe, (sg > 0 ? k.high - entry : entry - k.low) / risk);
    if (sg > 0 ? k.low <= stop : k.high >= stop) {
      exitAt(stop, rem, hit ? (stop === entry ? "BE" : "TRAIL") : "STOP");
      return { r: r - fees / risk, exits: ex.join(","), end, filledAt, mfe };
    }
    const before = hit;
    for (let j = hit; j < 3; j++) {
      const ok = sg > 0 ? k.high >= pl.tp[j] : k.low <= pl.tp[j];
      if (!ok) break;
      exitAt(pl.tp[j], j === 2 ? rem : P.fractions[j], `TP${j + 1}`);
      hit = j + 1;
      // Peor caso: la vela que llegó al TP1 pudo haber vuelto después a la entrada.
      if (P.beWorst && P.beAfterTp1 && hit === 1 && rem > 1e-9 && (sg > 0 ? k.low <= entry : k.high >= entry)) {
        exitAt(entry, rem, "BE");
        return { r: r - fees / risk, exits: ex.join(","), end, filledAt, mfe };
      }
    }
    if (rem <= 1e-9) return { r: r - fees / risk, exits: ex.join(","), end, filledAt, mfe };
    // La gestión mueve el stop recién después de la vela que llegó al objetivo (adentro, el orden no se conoce).
    if (hit > before) {
      if (P.trailAfterTp2 && hit >= 2) stop = pl.tp[0];
      else if (P.beAfterTp1 && hit >= 1) stop = entry;
    }
    if (end - (filledAt ?? k.openTime) >= P.horizonH * H) {
      exitAt(k.close, rem, "TIEMPO");
      return { r: r - fees / risk, exits: ex.join(","), end, filledAt, mfe };
    }
  }
  return null; // sigue abierta al final de los datos
}

/** Una operación a la vez sobre las lecturas de un activo entre `from` y `to` (tiempo del perfil). */
export function simulate(sym: string, lecturas: Lectura[], P: Params, from: number, to: number, perfil: Perfil = PERFILES["1h"]): Operacion[] {
  const c = velasBase(sym, perfil);
  const idx = new Map<number, number>();
  c.forEach((k, i) => idx.set(k.openTime, i));
  const out: Operacion[] = [];
  let busyUntil = 0;
  for (const s of lecturas) {
    if (s.t < from || s.t > to || s.t < busyUntil) continue;
    const pl = decide(s, P);
    if (!pl) continue;
    const start = idx.get(s.vela + H);
    if (start === undefined) continue;
    const res = resolve(pl, c, start, P);
    if (!res) break; // sigue abierta al final de los datos: no cuenta, ni nada de lo que viene después
    busyUntil = res.end;
    if (res.cancelled) continue;
    out.push({ sym, side: pl.side, t: s.t, fin: res.end, r: res.r, exits: res.exits, dur: (res.end - (res.filledAt ?? s.t)) / H, limit: pl.limit, rrPlan: pl.rr, mfe: res.mfe });
  }
  return out;
}

export type Etiquetada = { sym: string; t: number; side: "LONG" | "SHORT"; pl: Plan; res: Resuelta; i: number };
/** Todos los puntos de decisión con plan (sin importar si hay otra operación abierta), cada uno resuelto por separado. */
export function etiquetarTodas(sym: string, lecturas: Lectura[], P: Params, from: number, to: number, perfil: Perfil = PERFILES["1h"]): Etiquetada[] {
  const c = velasBase(sym, perfil);
  const idx = new Map<number, number>();
  c.forEach((k, i) => idx.set(k.openTime, i));
  const out: Etiquetada[] = [];
  lecturas.forEach((s, i) => {
    if (s.t < from || s.t > to) return;
    const pl = decide(s, P);
    if (!pl) return;
    const start = idx.get(s.vela + H);
    if (start === undefined) return;
    const res = resolve(pl, c, start, P);
    if (!res) return;
    out.push({ sym, t: s.t, side: pl.side, pl, res, i });
  });
  return out;
}

export function metricas(ts: { r: number; t: number; fin?: number }[]) {
  const n = ts.length;
  const w = ts.filter((t) => t.r > 0);
  const l = ts.filter((t) => t.r < 0);
  const gw = w.reduce((a, t) => a + t.r, 0);
  const gl = -l.reduce((a, t) => a + t.r, 0);
  let cum = 0;
  let peak = 0;
  let dd = 0;
  for (const t of [...ts].sort((a, b) => (a.fin ?? a.t) - (b.fin ?? b.t))) {
    cum += t.r;
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
  }
  return { n, wr: n ? w.length / n : 0, pf: gl ? gw / gl : gw ? Infinity : 0, e: n ? (gw - gl) / n : 0, tot: gw - gl, dd };
}
export type Metricas = ReturnType<typeof metricas>;

/** Profit factor de una lista de resultados en R (Infinity si no hay pérdidas). */
export const factorDeGanancia = (rs: number[]) => {
  const g = rs.filter((r) => r > 0).reduce((a, r) => a + r, 0);
  const p = -rs.filter((r) => r < 0).reduce((a, r) => a + r, 0);
  return p ? g / p : g ? Infinity : 0;
};
/** Expectativa: resultado medio por operación, en R. */
export const expectativa = (rs: number[]) => (rs.length ? rs.reduce((a, r) => a + r, 0) / rs.length : 0);

const SEMANA_MS = 7 * 86_400_000;
/**
 * Intervalo del 90% de una medida, remuestreando semanas enteras con reemplazo. Las operaciones de una misma semana (y de monedas
 * que se mueven juntas) van juntas, así el intervalo no supone que las operaciones son independientes. Con varias series (por
 * ejemplo v1 y v2, o dos velas base) se sortean las mismas semanas para todas, y la medida puede ser una diferencia entre ellas.
 * `aReal` pasa el tiempo de una operación a tiempo real (los perfiles de «tiempo virtual» lo necesitan). Determinista según la semilla.
 */
export function intervaloPorSemanas(
  series: { ts: { r: number; t: number; fin?: number }[]; aReal?: (t: number) => number }[],
  medida: (rs: number[][]) => number,
  repeticiones = 500,
  semilla = 7,
) {
  const porSemana = new Map<number, number[][]>();
  series.forEach((s, j) => {
    for (const t of s.ts) {
      const k = Math.floor((s.aReal ? s.aReal(t.fin ?? t.t) : (t.fin ?? t.t)) / SEMANA_MS);
      let g = porSemana.get(k);
      if (!g) {
        g = series.map(() => []);
        porSemana.set(k, g);
      }
      g[j].push(t.r);
    }
  });
  const semanas = [...porSemana.values()];
  const medir = (gs: number[][][]) => medida(series.map((_, j) => gs.flatMap((g) => g[j])));
  let estado = semilla >>> 0;
  const azar = () => (estado = (estado * 1664525 + 1013904223) >>> 0) / 4294967296;
  const muestras = Array.from({ length: repeticiones }, () => medir(Array.from(semanas, () => semanas[Math.floor(azar() * semanas.length)]))).sort((a, b) => a - b);
  return { valor: medir(semanas), bajo: muestras[Math.floor(0.05 * repeticiones)], alto: muestras[Math.floor(0.95 * repeticiones)], semanas: semanas.length };
}
export const fmt = (m: Metricas) =>
  `n=${String(m.n).padStart(5)} WR=${(m.wr * 100).toFixed(0).padStart(2)}% PF=${m.pf.toFixed(2)} E=${m.e >= 0 ? "+" : ""}${m.e.toFixed(3)}R total=${m.tot >= 0 ? "+" : ""}${m.tot.toFixed(0)}R caída=${m.dd.toFixed(0)}R`;

const lecturasCache = new Map<string, Lectura[]>();
/** Lecturas guardadas por precalcular.ts para un activo y perfil. */
export function lecturas(sym: string, perfil: Perfil): Lectura[] {
  const key = `${perfil.id}-${sym}`;
  const hit = lecturasCache.get(key);
  if (hit) return hit;
  const rows = JSON.parse(readFileSync(`${SALIDA}/lecturas-${key}.json`, "utf8")) as Lectura[];
  lecturasCache.set(key, rows);
  return rows;
}
