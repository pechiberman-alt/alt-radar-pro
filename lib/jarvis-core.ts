import { breakoutSignal, magnetSignal, type JarvisSignal, type JarvisSource, type LedgerStats } from "./jarvis-ledger.ts";
import {
  explain,
  featuresAt,
  gradeOf,
  predict,
  regimeAt,
  WINDOW,
  type Features,
  type Grade,
  type LearnModel,
  type LearnSummary,
  type Regime,
  type Ridge,
} from "./jarvis-learn.ts";
import { isOutside, VENUE_LABEL, type BinanceStatus, type Venue } from "./klines-server.ts";
import type { LvStats } from "./liq-vol-signals.ts";
import type { Magnet, MagnetEvent } from "./magnet-watch.ts";
import { readPreBreak, type PreBreak } from "./pre-breakout.ts";
import type { SwingCandle } from "./swing-entries.ts";

/**
 * JARVIS CORE: the part of JARVIS that runs on the server around the clock,
 * with the app closed. Every minute the Worker cron gives it one small job —
 * the free Cloudflare plan allows 50 outside requests and a few milliseconds
 * of CPU per run, so the work is spread over a 15-minute cycle:
 *
 *   minutes 0–9    2 coins each (20 coins): live reading, a graded signal if
 *                  one is "a punto de romper", and a step of the history walk
 *   minutes 10–12  liquidation-magnet sweeps on BTC, ETH, SOL
 *   minute 13      resolve open signals; magnet results feed the learning
 *   minute 14      extra study for the coin with the most history left
 *
 * Signals are the same ones the app records (jarvis-ledger.ts), kept in the
 * database with their grade (jarvis-learn.ts). The record counts the signals
 * it took; the ones it kept in shadow are measured apart. This file is pure;
 * the database side is jarvis-core-db.ts.
 */

export const CORE_TF = "1h";
export const CORE_FRAME = 3_600_000;
export const CORE_COINS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "SUIUSDT",
  "TRXUSDT", "TONUSDT", "DOTUSDT", "LTCUSDT", "NEARUSDT", "APTUSDT", "ARBUSDT", "OPUSDT", "INJUSDT", "BCHUSDT",
];
export const CORE_MAGNETS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
export const CYCLE_MIN = 15;

export type CoreTask = { kind: "SCAN"; symbols: string[] } | { kind: "MAGNET"; symbol: string } | { kind: "RESOLVE" } | { kind: "STUDY" };

/** What the core does on a given minute of the cycle. */
export function coreTask(epochMinute: number): CoreTask {
  const slot = ((epochMinute % CYCLE_MIN) + CYCLE_MIN) % CYCLE_MIN;
  if (slot < 10) return { kind: "SCAN", symbols: CORE_COINS.slice(slot * 2, slot * 2 + 2) };
  if (slot < 13) return { kind: "MAGNET", symbol: CORE_MAGNETS[slot - 10] };
  if (slot === 13) return { kind: "RESOLVE" };
  return { kind: "STUDY" };
}

/** Only candles that have closed by `now`: the forming one would change the reading every minute. */
export function closedOnly(candles: SwingCandle[], frameMs: number, now: number): SwingCandle[] {
  return candles.filter((c) => c.openTime + frameMs <= now);
}

/** A signal as the core keeps it: the plan, plus what it had learned when it gave it. */
export type CoreSignal = JarvisSignal & {
  /** Announced and counted in the record; false = kept in shadow because its grade was unfavourable. */
  taken: boolean;
  grade: Grade | null;
  /** Expected R and its standard error at the moment of the signal. */
  expectR: number | null;
  expectSe: number | null;
  features: Features | null;
  /** The conditions that moved the estimate the most. */
  why: string | null;
};

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const fmtR = (r: number) => `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2).replace(".", ",")}R`;

export function gradeSignal(sig: JarvisSignal, f: Features, ridge: Ridge, src: JarvisSource): CoreSignal {
  const p = predict(ridge, f);
  const g = gradeOf(p);
  const why = explain(ridge, f, src)
    .map((x) => `${x.label} (${fmtR(x.r)})`)
    .join("; ");
  return { ...sig, taken: g !== "DESFAVORABLE", grade: g, expectR: r4(p.e), expectSe: r4(p.se), features: f, why: why || null };
}

/** `at`: open time of the last closed candle read; `seen`: when the core read it. */
export type Reading = { at: number; seen: number; price: number; state: PreBreak["state"]; side: PreBreak["side"]; score: number; change24: number | null };

/**
 * The live look at one coin: its reading on the last 200 closed candles (the
 * same window the history walk uses) and, if it is "a punto de romper" with a
 * direction, the graded signal.
 */
export function liveRompe(symbol: string, closed: SwingCandle[], model: LearnModel, now: number): { reading: Reading | null; signal: CoreSignal | null } {
  if (closed.length < 120) return { reading: null, signal: null };
  const window = closed.slice(-WINDOW);
  const last = window[window.length - 1];
  const r = readPreBreak(window, symbol);
  const change24 = closed.length > 24 ? last.close / closed[closed.length - 25].close - 1 : null;
  const reading: Reading | null = r ? { at: last.openTime, seen: now, price: last.close, state: r.state, side: r.side, score: r.score, change24 } : null;
  if (!r || r.state !== "A PUNTO") return { reading, signal: null };
  const sig = breakoutSignal(symbol, CORE_TF, window, r);
  if (!sig) return { reading, signal: null };
  const btc: Regime = regimeAt(model.btc, last.openTime) ?? model.btc?.last ?? "LATERAL";
  const f = featuresAt("ROMPE", symbol, sig.side, window, window.length - 1, CORE_FRAME, btc, r.score);
  return { reading, signal: gradeSignal(sig, f, model.ridge.ROMPE, "ROMPE") };
}

export type MagnetPairLite = { above: Magnet | null; below: Magnet | null };

/**
 * Sweeps of the strongest magnets as the map stood before the last candle —
 * the BARRIDA rule of magnetEvents, taking the previous map's magnets as
 * stored instead of rebuilding that map (which would double the CPU).
 */
export function sweepsOf(last: SwingCandle, before: MagnetPairLite, minIntensity = 70): MagnetEvent[] {
  const out: MagnetEvent[] = [];
  for (const g of [before.above, before.below]) {
    if (!g || g.intensity < minIntensity) continue;
    if (last.low <= g.price && last.high >= g.price) {
      out.push({ kind: "BARRIDA", magnet: g, candleOpenTime: last.openTime, closedBack: g.side === "CORTOS" ? last.close < g.price : last.close > g.price });
    }
  }
  return out;
}

export function liveMagnets(symbol: string, closed: SwingCandle[], before: MagnetPairLite, now: MagnetPairLite, model: LearnModel): CoreSignal[] {
  if (closed.length < 200) return [];
  const last = closed[closed.length - 1];
  const out: CoreSignal[] = [];
  for (const e of sweepsOf(last, before)) {
    const sig = magnetSignal(symbol, CORE_TF, closed, e, now);
    if (!sig || e.kind !== "BARRIDA") continue;
    const btc: Regime = regimeAt(model.btc, last.openTime) ?? model.btc?.last ?? "LATERAL";
    const f = featuresAt("IMÁN", symbol, sig.side, closed, closed.length - 1, CORE_FRAME, btc, e.magnet.intensity);
    out.push(gradeSignal(sig, f, model.ridge["IMÁN"], "IMÁN"));
  }
  return out;
}

/** Running totals per source, so the stats never need a scan of the whole table. */
export type CoreCounters = { resolved: number; wins: number; losses: number; gain: number; loss: number; total: number; open: number };
export const ZERO: CoreCounters = { resolved: 0, wins: 0, losses: 0, gain: 0, loss: 0, total: 0, open: 0 };
/** Counter key: the source for taken signals, source + "~SOMBRA" for the shadow ones. */
export const counterKey = (source: JarvisSource, taken: boolean) => (taken ? source : `${source}~SOMBRA`);

export function countOpened(c: CoreCounters): CoreCounters {
  return { ...c, open: c.open + 1 };
}

/** A signal that just closed with result R. Same rule as lvStats: R above 0 wins, below 0 loses. */
export function countClosed(c: CoreCounters, r: number): CoreCounters {
  return {
    resolved: c.resolved + 1,
    wins: c.wins + (r > 0 ? 1 : 0),
    losses: c.losses + (r < 0 ? 1 : 0),
    gain: c.gain + (r > 0 ? r : 0),
    loss: c.loss + (r < 0 ? -r : 0),
    total: c.total + r,
    open: Math.max(0, c.open - 1),
  };
}

export function countersToStats(c: CoreCounters): LvStats {
  return {
    resolved: c.resolved,
    open: c.open,
    wins: c.wins,
    losses: c.losses,
    winRate: c.resolved ? c.wins / c.resolved : null,
    profitFactor: c.loss > 0 ? c.gain / c.loss : c.gain > 0 ? Infinity : null,
    expectancyR: c.resolved ? c.total / c.resolved : null,
    totalR: c.total,
    confidence: c.resolved === 0 ? "SIN MUESTRA" : c.resolved < 15 ? "MUESTRA MÍNIMA" : "MUESTRA RAZONABLE",
  };
}

const sum = (a: CoreCounters, b: CoreCounters): CoreCounters => ({
  resolved: a.resolved + b.resolved,
  wins: a.wins + b.wins,
  losses: a.losses + b.losses,
  gain: a.gain + b.gain,
  loss: a.loss + b.loss,
  total: a.total + b.total,
  open: a.open + b.open,
});

/** The record of the signals it took (announced), by source. */
export function coreStats(byKey: Record<string, CoreCounters>): LedgerStats {
  const r = byKey.ROMPE ?? ZERO;
  const m = byKey["IMÁN"] ?? ZERO;
  return { ...countersToStats(sum(r, m)), bySource: { ROMPE: countersToStats(r), "IMÁN": countersToStats(m) } };
}

/** The same for the ones it kept in shadow: if these do worse, the learning is helping. */
export function shadowStats(byKey: Record<string, CoreCounters>): LvStats {
  return countersToStats(sum(byKey["ROMPE~SOMBRA"] ?? ZERO, byKey["IMÁN~SOMBRA"] ?? ZERO));
}

/** `feed`: the exchange whose candles the job read (klines-server.ts). */
export type Tick = { at: number; task: string; ok: boolean; note: string; feed?: Venue };
export type CoreHeartbeat = Tick & { ring?: Tick[] };

/** The core counts as alive if it ticked within the last 5 minutes (it ticks every minute). */
export function coreOnline(hb: CoreHeartbeat | null, now: number): boolean {
  return !!hb && now - hb.at < 5 * 60_000;
}

export function withTick(prev: CoreHeartbeat | null, t: Tick, keep = 15): CoreHeartbeat {
  return { ...t, ring: [...(prev?.ring ?? []), t].slice(-keep) };
}

/**
 * The strongest magnets after the last closed candle, the distance that counts
 * as "near" (max of 0,4% and half an ATR) and that candle's sweeps — what the
 * Telegram dispatch needs, so it never rebuilds a map itself.
 */
export type MindMagnet = { lastTime: number; at: number; price: number; above: Magnet | null; below: Magnet | null; nearPct?: number; sweeps?: MagnetEvent[]; venue?: Venue };
/**
 * Where the core's candles come from: Binance when it answers the server;
 * Kraken or Coinbase, in dollars, when its firewall refuses the cron.
 */
export type Feed = { venue: Venue; binance: BinanceStatus; at: number };
/** What the core knows about the market right now. */
export type Mind = { readings: Record<string, Reading>; btc: { regime: Regime; change24: number | null; at: number } | null; magnets: Record<string, MindMagnet>; feed?: Feed | null };
export const emptyMind = (): Mind => ({ readings: {}, btc: null, magnets: {}, feed: null });

export function parseMind(raw: string | null | undefined): Mind {
  if (!raw) return emptyMind();
  try {
    const m = JSON.parse(raw) as Mind;
    return { readings: m.readings ?? {}, btc: m.btc ?? null, magnets: m.magnets ?? {}, feed: m.feed ?? null };
  } catch {
    return emptyMind();
  }
}

export type CoreSnapshot = {
  heartbeat: CoreHeartbeat | null;
  stats: LedgerStats;
  shadow: LvStats;
  open: CoreSignal[];
  recent: CoreSignal[];
  learning: LearnSummary | null;
  mind: Mind | null;
  generatedAt: number;
};

const coin = (s: string) => s.replace(/USDT$/, "");
const fmtRWords = (r: number) => `${r >= 0 ? "más" : "menos"} ${Math.abs(r).toFixed(1).replace(".", ",")} R`;

/** Why the candles are not Binance's, in words. */
const binanceWhy = (b: BinanceStatus) => (b === "BLOQUEADO" ? "Binance bloquea al servidor" : "Binance no responde al servidor");

/**
 * One sentence on where the candles come from, only when they are not
 * Binance's (null otherwise): the price is practically the same, the volume
 * is that exchange's own.
 */
export function feedSpeech(feed: Pick<Feed, "venue" | "binance"> | null | undefined): string | null {
  if (!feed || !isOutside(feed.venue)) return null;
  const name = VENUE_LABEL[feed.venue];
  return `Leo las velas de ${name}, en dólares, porque ${binanceWhy(feed.binance)}. El precio es prácticamente el mismo; el volumen es el de ${name}.`;
}

/** Short label for the app: "Kraken (USD) · Binance bloquea al servidor", or "Binance futuros". */
export function feedLabel(feed: Pick<Feed, "venue" | "binance"> | null | undefined): string | null {
  if (!feed) return null;
  return isOutside(feed.venue) ? `${VENUE_LABEL[feed.venue]} (USD) · ${binanceWhy(feed.binance)}` : VENUE_LABEL[feed.venue];
}

/**
 * What JARVIS says about the core's activity since `since`: signals it took
 * and signals it closed in that time, each closed one with its result.
 */
export function awaySpeech(signals: CoreSignal[], since: number): string | null {
  const taken = signals.filter((s) => s.taken !== false);
  const opened = taken.filter((s) => s.time > since && s.result === "ABIERTA");
  const closed = taken.filter((s) => s.closedAt !== null && s.closedAt > since && s.r !== null);
  if (!opened.length && !closed.length) return null;
  const parts: string[] = [];
  if (opened.length) {
    parts.push(
      `Mientras no estabas, el núcleo abrió ${opened.length} ${opened.length === 1 ? "señal" : "señales"}: ${opened
        .slice(0, 3)
        .map((s) => `${coin(s.symbol)} ${s.side === "LONG" ? "largo" : "corto"}`)
        .join(", ")}${opened.length > 3 ? " y más" : ""}.`,
    );
  }
  if (closed.length) {
    const total = closed.reduce((a, s) => a + (s.r as number), 0);
    parts.push(
      `${opened.length ? "Y cerró" : "Mientras no estabas, el núcleo cerró"} ${closed.length}: ${closed
        .slice(0, 3)
        .map((s) => `${coin(s.symbol)} en ${s.result === "OBJETIVO" ? "objetivo" : s.result === "STOP" ? "stop" : "tiempo"}, ${fmtRWords(s.r as number)}`)
        .join("; ")}. En total ${fmtRWords(total)}.`,
    );
  }
  return parts.join(" ");
}

/** A short status line: alive or not, what it watches, its health, record and learning. */
export function coreStatusSpeech(snap: Pick<CoreSnapshot, "heartbeat" | "stats" | "open" | "learning"> & { mind?: Mind | null }, now: number): string {
  if (!coreOnline(snap.heartbeat, now)) {
    return snap.heartbeat
      ? `El núcleo no da señales de vida desde hace ${Math.round((now - snap.heartbeat.at) / 60_000)} minutos. Sigo funcionando desde tu navegador.`
      : "El núcleo todavía no arrancó en el servidor. Sigo funcionando desde tu navegador.";
  }
  const hb = snap.heartbeat as CoreHeartbeat;
  const ago = Math.max(0, Math.round((now - hb.at) / 60_000));
  const fails = (hb.ring ?? []).filter((t) => !t.ok).length;
  const parts = [
    `Núcleo en línea, último latido ${ago === 0 ? "recién" : ago === 1 ? "hace un minuto" : `hace ${ago} minutos`}${
      hb.ring?.length ? (fails ? `, con ${fails} ${fails === 1 ? "falla" : "fallas"} en los últimos ${hb.ring.length} minutos` : ", sin fallas en el último cuarto de hora") : ""
    }.`,
    `Vigilo ${CORE_COINS.length} monedas en una hora, las veinticuatro horas.`,
  ];
  const feed = snap.mind?.feed;
  const fromElsewhere = feed && now - feed.at < 30 * 60_000 ? feedSpeech(feed) : null;
  if (fromElsewhere) parts.push(fromElsewhere);
  const open = snap.open.filter((s) => s.taken !== false);
  if (open.length) parts.push(`Tengo ${open.length} ${open.length === 1 ? "señal abierta" : "señales abiertas"}.`);
  const st = snap.stats;
  if (st.resolved) {
    parts.push(`Cerradas: ${st.resolved}, win rate ${Math.round((st.winRate ?? 0) * 100)} por ciento, ${fmtRWords(st.totalR)}. ${st.confidence === "MUESTRA RAZONABLE" ? "Muestra razonable." : "Muestra mínima todavía."}`);
  } else parts.push("Todavía no cerré ninguna señal: no hay resultados para medir.");
  if (snap.learning) {
    const l = snap.learning;
    parts.push(`Aprendí de ${l.historyCases.toLocaleString("es-AR")} situaciones de la historia${l.backlog ? ` y me quedan ${l.backlog.toLocaleString("es-AR")} velas por estudiar` : ""}.`);
  }
  return parts.join(" ");
}

/**
 * "¿Qué está por romper?" from the core's latest readings, if they are fresh
 * (each coin is read every 15 minutes). Null when they are not, so the app
 * scans by itself.
 */
export function breakoutsFromMind(mind: Mind | null, now: number, maxAgeMin = 25): { text: string; coins: string[] } | null {
  if (!mind) return null;
  const fresh = Object.entries(mind.readings).filter(([, r]) => now - r.seen < maxAgeMin * 60_000);
  if (fresh.length < CORE_COINS.length / 2) return null;
  const hot = fresh.filter(([, r]) => r.state === "A PUNTO").sort((a, b) => b[1].score - a[1].score);
  const warm = fresh.filter(([, r]) => r.state === "ARMÁNDOSE").sort((a, b) => b[1].score - a[1].score);
  const oldest = Math.max(...fresh.map(([, r]) => now - r.seen));
  const age = Math.max(1, Math.round(oldest / 60_000));
  const dir = (s: Reading["side"]) => (s === "ALCISTA" ? "hacia arriba" : s === "BAJISTA" ? "hacia abajo" : "sin dirección clara");
  const parts: string[] = [];
  if (hot.length) parts.push(`A punto de romper en una hora: ${hot.slice(0, 4).map(([s, r]) => `${coin(s)} ${dir(r.side)}, presión ${r.score}`).join("; ")}.`);
  else parts.push(`Ninguna de las ${fresh.length} monedas que vigilo está a punto de romper en una hora.`);
  if (warm.length) parts.push(`Armándose: ${warm.slice(0, 4).map(([s]) => coin(s)).join(", ")}.`);
  parts.push(`Lectura del núcleo de hace menos de ${age} minutos. La dirección es probable, no segura.`);
  return { text: parts.join(" "), coins: hot.map(([s]) => s) };
}

/** Compact context for the AI, so it answers knowing what its own core is doing and has learned. */
export function coreContext(snap: CoreSnapshot, now: number) {
  const st = snap.stats;
  const mind = snap.mind;
  return {
    asistente: "JARVIS",
    nucleo: {
      enLinea: coreOnline(snap.heartbeat, now),
      ultimoLatidoMin: snap.heartbeat ? Math.round((now - snap.heartbeat.at) / 60_000) : null,
      vigila: `${CORE_COINS.map(coin).join(",")} en ${CORE_TF}; imanes de ${CORE_MAGNETS.map(coin).join(",")}`,
      datos: mind?.feed ? { velasDe: VENUE_LABEL[mind.feed.venue], enDolares: isOutside(mind.feed.venue), binance: mind.feed.binance, aclaracion: feedSpeech(mind.feed) } : null,
      registro: {
        cerradas: st.resolved,
        abiertas: snap.open.filter((s) => s.taken !== false).length,
        winRate: st.winRate,
        profitFactor: st.profitFactor === Infinity ? "infinito" : st.profitFactor,
        totalR: Number(st.totalR.toFixed(2)),
        muestra: st.confidence,
        enSombra: { cerradas: snap.shadow.resolved, totalR: Number(snap.shadow.totalR.toFixed(2)) },
      },
      aprendizaje: snap.learning
        ? {
            situacionesEstudiadas: snap.learning.historyCases,
            señalesEnVivoAprendidas: snap.learning.liveCases,
            velasPorEstudiar: snap.learning.backlog,
            lecciones: [...snap.learning.sources.ROMPE.lessons, ...snap.learning.sources["IMÁN"].lessons],
            casosPorFuente: snap.learning.venues ?? {},
          }
        : null,
      mercado: mind
        ? {
            btc: mind.btc,
            aPunto: Object.entries(mind.readings)
              .filter(([, r]) => r.state === "A PUNTO")
              .map(([s, r]) => ({ moneda: coin(s), lado: r.side, presion: r.score })),
            imanes: Object.fromEntries(Object.entries(mind.magnets).map(([s, m]) => [coin(s), { arriba: m.above?.price ?? null, abajo: m.below?.price ?? null }])),
          }
        : null,
      abiertas: snap.open
        .filter((s) => s.taken !== false)
        .slice(0, 8)
        .map((s) => ({ moneda: coin(s.symbol), lado: s.side, entrada: s.entry, stop: s.stop, objetivo: s.target, fuente: s.source, calidad: s.grade, esperadoR: s.expectR })),
      ultimasCerradas: snap.recent
        .filter((s) => s.taken !== false)
        .slice(0, 8)
        .map((s) => ({ moneda: coin(s.symbol), lado: s.side, resultado: s.result, r: s.r })),
    },
  };
}

/** JSON turns Infinity into null: a record with wins and no losses has an infinite profit factor again. */
export function reviveSnapshot(raw: CoreSnapshot): CoreSnapshot {
  const fix = <T extends LvStats>(st: T): T => (st.profitFactor === null && st.wins > 0 && st.losses === 0 ? { ...st, profitFactor: Infinity } : st);
  const st = raw.stats;
  return {
    ...raw,
    shadow: raw.shadow ? fix(raw.shadow) : countersToStats(ZERO),
    learning: raw.learning ?? null,
    mind: raw.mind ?? null,
    stats: { ...fix(st), bySource: { ROMPE: fix(st.bySource.ROMPE), "IMÁN": fix(st.bySource["IMÁN"]) } },
  };
}

export const GRADE_LABEL: Record<Grade, string> = { APRENDIENDO: "aprendiendo", FAVORABLE: "favorable", NEUTRA: "neutra", DESFAVORABLE: "desfavorable" };
