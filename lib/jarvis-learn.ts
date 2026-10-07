import { breakoutSignal, HORIZON, resolveSignal, type LearnedSource as JarvisSource } from "./jarvis-ledger.ts";
import { readPreBreak } from "./pre-breakout.ts";
import type { SwingCandle } from "./swing-entries.ts";

/**
 * How JARVIS CORE learns, all the time and without looking ahead.
 *
 * WHAT IT LEARNS. For every situation where its rule fires, the result in R
 * (fees included, worst case first) and the context it fired in: long or
 * short, with BTC in favour or against, volatility, trading session, signal
 * strength, and whether it is BTC, ETH or an altcoin. A ridge regression on
 * those features — sufficient statistics only (XᵀX, Xᵀy, Σy²), so one more
 * case is one addition — estimates the expected R of a new signal and how
 * uncertain that estimate is.
 *
 * WHERE THE CASES COME FROM.
 *   Rupturas      a walk through each coin's history, candle by candle, with
 *                 exactly the live rule on the 200 candles available at that
 *                 moment, resolved with the 48 that followed. It keeps going
 *                 as new candles close, so the history it has studied grows
 *                 every hour. Live breakouts are those same candles, studied
 *                 again once their 48 candles have passed: never counted twice.
 *   Imanes        rebuilding the liquidation map at every past candle is too
 *                 heavy for the free plan, so magnet sweeps learn from the
 *                 live signals as they close.
 *
 * HOW IT IS USED. Each new live signal gets a grade:
 *   APRENDIENDO   fewer than 30 cases: no opinion yet.
 *   FAVORABLE     expected R minus one standard error is above zero.
 *   DESFAVORABLE  expected R plus one standard error is below zero.
 *   NEUTRA        anything in between.
 * Unfavourable signals are kept "en sombra": recorded and resolved like any
 * other but not announced. Learning never depends on that choice (the history
 * walk studies every candle), and the record shows taken against shadow, so
 * whether the learning helps is itself measured.
 *
 * The ridge penalty (ALPHA) pulls every effect — the base rate included —
 * towards zero: with little evidence JARVIS assumes it has no edge.
 */

export type Regime = "SUBE" | "BAJA" | "LATERAL";
export type Features = {
  side: "LONG" | "SHORT";
  btc: Regime;
  vol: "ALTA" | "NORMAL" | "BAJA";
  sess: "ASIA" | "EUROPA" | "EEUU" | "CIERRE";
  power: "MEDIA" | "ALTA" | "MAXIMA";
  coin: "BTC" | "ETH" | "ALT";
};

/** One-hot columns. The baseline of each group is left out (short, BTC sideways, normal volatility, late US session, medium strength, altcoin). */
export const DIMS = ["base", "largo", "btcAFavor", "btcEnContra", "volAlta", "volBaja", "asia", "europa", "eeuu", "potAlta", "potMaxima", "esBtc", "esEth"] as const;
export const D = DIMS.length;
/**
 * Ridge penalty = noise variance / prior variance of an effect: results vary
 * about ±1,2 R around their mean (≈1,5 R²) and a real edge from one condition
 * is rarely beyond ±0,25 R, so 1,5 / 0,25² ≈ 25. Ten lucky wins in a row then
 * move the estimate a little, not to +2 R.
 */
export const ALPHA = 25;
export const MIN_CASES = 30;

export function alignOf(side: Features["side"], btc: Regime): "CON" | "CONTRA" | "NEUTRO" {
  if (btc === "LATERAL") return "NEUTRO";
  return (side === "LONG") === (btc === "SUBE") ? "CON" : "CONTRA";
}

export function encode(f: Features): number[] {
  const a = alignOf(f.side, f.btc);
  return [
    1,
    f.side === "LONG" ? 1 : 0,
    a === "CON" ? 1 : 0,
    a === "CONTRA" ? 1 : 0,
    f.vol === "ALTA" ? 1 : 0,
    f.vol === "BAJA" ? 1 : 0,
    f.sess === "ASIA" ? 1 : 0,
    f.sess === "EUROPA" ? 1 : 0,
    f.sess === "EEUU" ? 1 : 0,
    f.power === "ALTA" ? 1 : 0,
    f.power === "MAXIMA" ? 1 : 0,
    f.coin === "BTC" ? 1 : 0,
    f.coin === "ETH" ? 1 : 0,
  ];
}

/** Sufficient statistics of a ridge regression: XᵀX (upper triangle, row-major), Xᵀy, Σy², n. */
export type Ridge = { n: number; xx: number[]; xy: number[]; yy: number };

export function emptyRidge(): Ridge {
  return { n: 0, xx: new Array((D * (D + 1)) / 2).fill(0), xy: new Array(D).fill(0), yy: 0 };
}

const ix = (i: number, j: number) => (i <= j ? i * D - (i * (i - 1)) / 2 + (j - i) : j * D - (j * (j - 1)) / 2 + (i - j));

/** Adds one case in place. */
export function addCase(m: Ridge, x: number[], y: number): Ridge {
  m.n += 1;
  m.yy += y * y;
  for (let i = 0; i < D; i += 1) {
    if (!x[i]) continue;
    m.xy[i] += x[i] * y;
    for (let j = i; j < D; j += 1) if (x[j]) m.xx[ix(i, j)] += x[i] * x[j];
  }
  return m;
}

function matrix(m: Ridge, alpha: number): number[][] {
  const M: number[][] = [];
  for (let i = 0; i < D; i += 1) {
    M.push([]);
    for (let j = 0; j < D; j += 1) M[i].push(m.xx[ix(i, j)] + (i === j ? alpha : 0));
  }
  return M;
}

function cholesky(M: number[][]): number[][] {
  const L = M.map(() => new Array(D).fill(0));
  for (let i = 0; i < D; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let s = M[i][j];
      for (let k = 0; k < j; k += 1) s -= L[i][k] * L[j][k];
      L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / L[j][j];
    }
  }
  return L;
}

function solveWith(L: number[][], b: number[]): number[] {
  const y = new Array(D).fill(0);
  for (let i = 0; i < D; i += 1) {
    let s = b[i];
    for (let k = 0; k < i; k += 1) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  const x = new Array(D).fill(0);
  for (let i = D - 1; i >= 0; i -= 1) {
    let s = y[i];
    for (let k = i + 1; k < D; k += 1) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

export type Fit = { beta: number[]; sigma2: number; solve: (v: number[]) => number[] };

/**
 * Ridge fit. The residual variance mixes the data with a prior of 2 R² worth
 * 10 cases, so with very few cases the uncertainty stays wide instead of
 * pretending to be precise.
 */
export function fit(m: Ridge, alpha = ALPHA): Fit {
  const L = cholesky(matrix(m, alpha));
  const solve = (v: number[]) => solveWith(L, v);
  const beta = solve(m.xy);
  let quad = 0;
  for (let i = 0; i < D; i += 1) for (let j = 0; j < D; j += 1) quad += beta[i] * m.xx[ix(i, j)] * beta[j];
  const rss = Math.max(0, m.yy - 2 * beta.reduce((s, b, i) => s + b * m.xy[i], 0) + quad);
  const sigma2 = (rss + 10 * 2) / (Math.max(0, m.n - D) + 10);
  return { beta, sigma2, solve };
}

export type Prediction = { e: number; se: number; n: number };

export function predict(m: Ridge, f: Features, alpha = ALPHA): Prediction {
  const x = encode(f);
  const { beta, sigma2, solve } = fit(m, alpha);
  const e = x.reduce((s, v, i) => s + v * beta[i], 0);
  const z = solve(x);
  const v = Math.max(0, x.reduce((s, xi, i) => s + xi * z[i], 0)) * sigma2;
  return { e, se: Math.sqrt(v), n: m.n };
}

export type Grade = "APRENDIENDO" | "FAVORABLE" | "NEUTRA" | "DESFAVORABLE";

export function gradeOf(p: Prediction, minCases = MIN_CASES): Grade {
  if (p.n < minCases) return "APRENDIENDO";
  if (p.e - p.se > 0) return "FAVORABLE";
  if (p.e + p.se < 0) return "DESFAVORABLE";
  return "NEUTRA";
}

const LABELS: Record<(typeof DIMS)[number], (src: JarvisSource) => string> = {
  base: () => "en general",
  largo: () => "Al alza (largos)",
  btcAFavor: () => "Con BTC a favor",
  btcEnContra: () => "Con BTC en contra",
  volAlta: () => "Con volatilidad alta",
  volBaja: () => "Con volatilidad baja",
  asia: () => "En horario de Asia (0–7 UTC)",
  europa: () => "En horario europeo (7–13 UTC)",
  eeuu: () => "En horario de EE.UU. (13–20 UTC)",
  potAlta: (s) => (s === "ROMPE" ? "Con presión de 80 a 89" : "Con imanes de intensidad 85 a 94"),
  potMaxima: (s) => (s === "ROMPE" ? "Con presión de 90 o más" : "Con imanes de intensidad 95 o más"),
  esBtc: () => "En BTC",
  esEth: () => "En ETH",
};
export const SOURCE_LABEL: Record<JarvisSource, string> = { ROMPE: "Rupturas", "IMÁN": "Barridas de imán" };

const fmtR = (r: number) => `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2).replace(".", ",")}R`;
const fmtN = (n: number) => n.toLocaleString("es-AR");

/** The two features that move this signal's estimate the most, for "¿por qué?". */
export function explain(m: Ridge, f: Features, src: JarvisSource, alpha = ALPHA): { label: string; r: number }[] {
  if (m.n < MIN_CASES) return [];
  const { beta } = fit(m, alpha);
  const x = encode(f);
  return DIMS.map((d, i) => ({ d, i }))
    .filter(({ i }) => i > 0 && x[i] && Math.abs(beta[i]) >= 0.05)
    .sort((a, b) => Math.abs(beta[b.i]) - Math.abs(beta[a.i]))
    .slice(0, 2)
    .map(({ d, i }) => ({ label: LABELS[d](src), r: beta[i] }));
}

export type Lesson = { text: string; strength: number };

/**
 * What it has learned, in words. A condition is mentioned only when the
 * regression says its effect is at least two standard errors from zero and it
 * moves the result by 0,10 R or more, with 20 cases on each side. The numbers
 * quoted are plain averages, which is what a person can check.
 */
export function lessons(src: JarvisSource, m: Ridge, alpha = ALPHA): Lesson[] {
  const label = SOURCE_LABEL[src];
  if (m.n < MIN_CASES) {
    return [{ text: `${label}: llevo ${fmtN(m.n)} ${m.n === 1 ? "caso" : "casos"}, todavía pocos para sacar conclusiones.`, strength: 0 }];
  }
  const { beta, sigma2, solve } = fit(m, alpha);
  const n = m.n;
  const mean = m.xy[0] / n;
  const out: Lesson[] = [{ text: `${label} en general: ${fmtR(mean)} por señal en ${fmtN(n)} casos.`, strength: 99 }];
  const found: Lesson[] = [];
  for (let j = 1; j < D; j += 1) {
    const nj = m.xx[ix(j, j)];
    if (nj < 20 || n - nj < 20) continue;
    const unit = new Array(D).fill(0);
    unit[j] = 1;
    const se = Math.sqrt(Math.max(0, solve(unit)[j]) * sigma2);
    const t = se > 0 ? beta[j] / se : 0;
    const mj = m.xy[j] / nj;
    const rest = (m.xy[0] - m.xy[j]) / (n - nj);
    if (Math.abs(t) < 2 || Math.abs(mj - rest) < 0.1 || Math.sign(mj - rest) !== Math.sign(beta[j])) continue;
    found.push({ text: `${LABELS[DIMS[j]](src)}: ${fmtR(mj)} por señal en ${fmtN(nj)} casos, contra ${fmtR(rest)} del resto.`, strength: Math.abs(t) });
  }
  found.sort((a, b) => b.strength - a.strength);
  if (!found.length) out.push({ text: "Todavía no encontré ninguna condición que cambie el resultado de forma clara.", strength: 0 });
  return [...out, ...found.slice(0, 4)];
}

// ── Context of a signal, from candles available at that moment only ────────

/** BTC's 24-candle change at each closed candle: above +1% "SUBE", below −1% "BAJA". "?" when unknown. */
export type BtcSeries = { t0: number; frame: number; s: string; last: Regime };

export function btcSeries(closed: SwingCandle[], frame: number): BtcSeries | null {
  if (closed.length < 30) return null;
  let s = "";
  for (let i = 0; i < closed.length; i += 1) {
    if (i < 24) {
      s += "?";
      continue;
    }
    const ch = closed[i].close / closed[i - 24].close - 1;
    s += ch > 0.01 ? "U" : ch < -0.01 ? "D" : "L";
  }
  const lastChar = s[s.length - 1];
  return { t0: closed[0].openTime, frame, s, last: lastChar === "U" ? "SUBE" : lastChar === "D" ? "BAJA" : "LATERAL" };
}

/** BTC's regime at a candle's open time; null when the series does not cover it. */
export function regimeAt(b: BtcSeries | null, openTime: number): Regime | null {
  if (!b) return null;
  const i = Math.round((openTime - b.t0) / b.frame);
  if (i < 0 || i >= b.s.length) return null;
  const c = b.s[i];
  return c === "U" ? "SUBE" : c === "D" ? "BAJA" : c === "L" ? "LATERAL" : null;
}

function avgRange(c: SwingCandle[], end: number, n: number): number {
  let s = 0;
  let k = 0;
  for (let i = Math.max(1, end - n + 1); i <= end; i += 1) {
    s += Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
    k += 1;
  }
  return k ? s / k : 0;
}

/** Recent volatility against the coin's own last 100 candles. */
export function volRegime(c: SwingCandle[], i: number): Features["vol"] {
  const short = avgRange(c, i, 14);
  const long = avgRange(c, i, 100);
  if (!(long > 0)) return "NORMAL";
  const r = short / long;
  return r > 1.3 ? "ALTA" : r < 0.75 ? "BAJA" : "NORMAL";
}

/** Session by the UTC hour at which the signal's candle closed. */
export function sessionOf(closeTime: number): Features["sess"] {
  const h = new Date(closeTime).getUTCHours();
  return h < 7 ? "ASIA" : h < 13 ? "EUROPA" : h < 20 ? "EEUU" : "CIERRE";
}

export function powerOf(src: JarvisSource, value: number): Features["power"] {
  if (src === "ROMPE") return value >= 90 ? "MAXIMA" : value >= 80 ? "ALTA" : "MEDIA";
  return value >= 95 ? "MAXIMA" : value >= 85 ? "ALTA" : "MEDIA";
}

export const coinOf = (symbol: string): Features["coin"] => (symbol === "BTCUSDT" ? "BTC" : symbol === "ETHUSDT" ? "ETH" : "ALT");

export function featuresAt(src: JarvisSource, symbol: string, side: Features["side"], c: SwingCandle[], i: number, frame: number, btc: Regime, power: number): Features {
  return { side, btc, vol: volRegime(c, i), sess: sessionOf(c[i].openTime + frame), power: powerOf(src, power), coin: coinOf(symbol) };
}

// ── The walk through history ──────────────────────────────────────────────

export const WINDOW = 200;
/** Where a coin's walk stands: the last candle studied, and the end of the trade open at that point, if any. */
export type Cursor = { last: number; busyUntil: number };
export type ReplayCase = { time: number; features: Features; r: number };
export type Replay = { cases: ReplayCase[]; cursor: Cursor; studied: number; backlog: number; waitingForBtc: boolean };

/**
 * Studies up to `max` candles of this coin's history that it has not studied
 * yet, oldest first, each with the 200 candles available then and resolved
 * with the 48 after (so only candles at least 48 old are studied). While a
 * trade from an earlier candle is still open, later candles are skipped, as
 * the live core does (one open signal per coin and source).
 */
export function replayRompe(symbol: string, closed: SwingCandle[], cursor: Cursor | null, btc: BtcSeries | null, frame: number, max: number, tf = "1h"): Replay {
  const cur: Cursor = cursor ? { ...cursor } : { last: 0, busyUntil: 0 };
  const end = closed.length - 1 - HORIZON;
  const cases: ReplayCase[] = [];
  let studied = 0;
  let waitingForBtc = false;
  let i = Math.max(WINDOW - 1, closed.findIndex((c) => c.openTime > cur.last));
  if (i < 0 || closed.findIndex((c) => c.openTime > cur.last) < 0) i = closed.length;
  for (; i <= end && studied < max; i += 1) {
    const t = closed[i].openTime;
    if (t < cur.busyUntil) {
      cur.last = t;
      continue;
    }
    const regime = regimeAt(btc, t);
    if (regime === null) {
      // Older than BTC's series: nothing to compare with, skip it. Newer: wait for BTC.
      if (btc && t < btc.t0 + 24 * btc.frame) {
        cur.last = t;
        continue;
      }
      waitingForBtc = true;
      break;
    }
    studied += 1;
    const window = closed.slice(i - WINDOW + 1, i + 1);
    const reading = readPreBreak(window, symbol);
    cur.last = t;
    if (!reading || reading.state !== "A PUNTO") continue;
    const sig = breakoutSignal(symbol, tf, window, reading);
    if (!sig) continue;
    const done = resolveSignal(sig, closed, frame);
    if (done.r === null || done.closedAt === null) continue;
    cases.push({ time: t, features: featuresAt("ROMPE", symbol, sig.side, closed, i, frame, regime, reading.score), r: done.r });
    cur.busyUntil = done.closedAt;
  }
  const nextIdx = closed.findIndex((c) => c.openTime > cur.last);
  const backlog = nextIdx < 0 ? 0 : Math.max(0, end - Math.max(nextIdx, WINDOW - 1) + 1);
  return { cases, cursor: cur, studied, backlog, waitingForBtc };
}

// ── The model as stored ────────────────────────────────────────────────────

export type LearnModel = {
  v: 1;
  rev: number;
  ridge: Record<JarvisSource, Ridge>;
  cursors: Record<string, Cursor>;
  backlog: Record<string, number>;
  btc: BtcSeries | null;
  /** Cases learned from the history walk and from live signals that closed. */
  historyCases: number;
  liveCases: number;
  /** History cases by the exchange whose candles they came from (klines-server.ts Venue). */
  venues: Record<string, number>;
  updatedAt: number;
};

export function emptyModel(): LearnModel {
  return { v: 1, rev: 0, ridge: { ROMPE: emptyRidge(), "IMÁN": emptyRidge() }, cursors: {}, backlog: {}, btc: null, historyCases: 0, liveCases: 0, venues: {}, updatedAt: 0 };
}

/** Rounds the sums so the stored model stays small; 1e-6 R is far below anything that matters. */
export function compactModel(m: LearnModel): LearnModel {
  const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
  const ridge = (x: Ridge): Ridge => ({ n: x.n, xx: x.xx.map(r6), xy: x.xy.map(r6), yy: r6(x.yy) });
  return { ...m, ridge: { ROMPE: ridge(m.ridge.ROMPE), "IMÁN": ridge(m.ridge["IMÁN"]) } };
}

export function parseModel(raw: string | null | undefined): LearnModel {
  if (!raw) return emptyModel();
  try {
    const m = JSON.parse(raw) as LearnModel;
    if (m.v !== 1 || !m.ridge?.ROMPE || m.ridge.ROMPE.xx.length !== (D * (D + 1)) / 2) return emptyModel();
    return { ...emptyModel(), ...m, venues: m.venues ?? {}, ridge: { ROMPE: m.ridge.ROMPE, "IMÁN": m.ridge["IMÁN"] ?? emptyRidge() } };
  } catch {
    return emptyModel();
  }
}

export type LearnSummary = {
  historyCases: number;
  liveCases: number;
  backlog: number;
  coins: number;
  updatedAt: number;
  sources: Record<JarvisSource, { n: number; base: Prediction | null; lessons: string[] }>;
  /** History cases by exchange: Binance when it answers the server, Kraken or Coinbase (in dollars) when it refuses it. */
  venues?: Record<string, number>;
};

/** What the app and the AI need to know about the learning, without the matrices. */
export function summarizeModel(m: LearnModel): LearnSummary {
  const src = (s: JarvisSource) => {
    const r = m.ridge[s];
    // The estimate for "an average signal": every feature at its share in the data.
    let base: Prediction | null = null;
    if (r.n >= MIN_CASES) {
      const { beta, sigma2, solve } = fit(r);
      const x = DIMS.map((_, i) => (i === 0 ? 1 : r.xx[ix(0, i)] / r.n));
      const e = x.reduce((a, v, i) => a + v * beta[i], 0);
      const z = solve(x);
      base = { e, se: Math.sqrt(Math.max(0, x.reduce((a, xi, i) => a + xi * z[i], 0)) * sigma2), n: r.n };
    }
    return { n: r.n, base, lessons: lessons(s, r).map((l) => l.text) };
  };
  return {
    historyCases: m.historyCases,
    liveCases: m.liveCases,
    backlog: Object.values(m.backlog).reduce((a, b) => a + b, 0),
    coins: Object.keys(m.cursors).length,
    updatedAt: m.updatedAt,
    sources: { ROMPE: src("ROMPE"), "IMÁN": src("IMÁN") },
    venues: Object.fromEntries(Object.entries(m.venues ?? {}).filter(([, n]) => n > 0)),
  };
}

const VENUE_WORDS: Record<string, string> = { BINANCE: "Binance", BINANCE_FUTURES: "Binance", BINANCE_US: "Binance.US", KRAKEN: "Kraken en dólares", COINBASE: "Coinbase en dólares" };

/**
 * Which exchange's candles the cases came from, when not all are Binance's
 * (null otherwise): Binance refuses the server's scheduled jobs, so the core
 * may study Kraken's or Coinbase's instead.
 */
export function venuesSpeech(venues: Record<string, number> | undefined): string | null {
  const byName = new Map<string, number>();
  for (const [v, n] of Object.entries(venues ?? {})) {
    const name = VENUE_WORDS[v] ?? v;
    if (n > 0) byName.set(name, (byName.get(name) ?? 0) + n);
  }
  const list = [...byName].sort((a, b) => b[1] - a[1]);
  if (!list.length || (list.length === 1 && list[0][0] === "Binance")) return null;
  if (list.length === 1) return `Las estudié con velas de ${list[0][0]}, porque Binance no deja leer al servidor.`;
  const items = list.map(([name, n], i) => `${fmtN(n)} ${i === 0 ? "salen de velas de" : "de"} ${name}`);
  return `De esas, ${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}: cuando Binance no deja leer al servidor, uso otra fuente.`;
}

/** What JARVIS says when asked what it has learned. */
export function learnSpeech(s: LearnSummary): string {
  const parts = [
    `Estudié ${fmtN(s.historyCases)} ${s.historyCases === 1 ? "situación" : "situaciones"} de la historia de ${s.coins} ${s.coins === 1 ? "moneda" : "monedas"}${s.liveCases ? ` y ${fmtN(s.liveCases)} señales en vivo` : ""}.`,
  ];
  const venues = venuesSpeech(s.venues);
  if (venues) parts.push(venues);
  if (s.backlog > 0) parts.push(`Me quedan ${fmtN(s.backlog)} velas por estudiar; sigo aprendiendo cada minuto.`);
  for (const k of ["ROMPE", "IMÁN"] as const) {
    const ls = s.sources[k].lessons;
    if (s.sources[k].n || k === "ROMPE") parts.push(...ls.slice(0, 3));
  }
  return parts.join(" ");
}

export const fmtExpect = (p: Prediction) => `${fmtR(p.e)} ± ${Math.abs(p.se).toFixed(2).replace(".", ",")}`;
