import { breakoutSignal, magnetSignal, type JarvisSignal, type JarvisSource, type LedgerStats } from "./jarvis-ledger.ts";
import type { LvStats } from "./liq-vol-signals.ts";
import type { LiquidationHeatmap } from "./liquidation-heatmap.ts";
import { magnetEvents, strongestMagnets } from "./magnet-watch.ts";
import { readPreBreak } from "./pre-breakout.ts";
import type { SwingCandle } from "./swing-entries.ts";

/**
 * JARVIS CORE: the part of JARVIS that runs on the server around the clock,
 * with the app closed. Every minute the Worker cron gives it one small job —
 * a free Cloudflare plan allows 50 outside requests and a few milliseconds of
 * CPU per run, so the work is spread over a 15-minute cycle instead of done
 * all at once:
 *
 *   minutes 0–9    scan 2 coins each for "a punto de romper" (20 coins)
 *   minutes 10–12  liquidation-magnet sweeps on BTC, ETH, SOL
 *   minute 13      resolve the open signals against closed candles
 *   minute 14      rest
 *
 * Signals and results are the same ones the app records (jarvis-ledger.ts),
 * but kept in the database, so they are shared, survive closing the app and
 * are measured from the first one: win rate, profit factor and R with their
 * sample size. This file is pure; the database side is jarvis-core-db.ts.
 */

export const CORE_TF = "1h";
export const CORE_COINS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "SUIUSDT",
  "TRXUSDT", "TONUSDT", "DOTUSDT", "LTCUSDT", "NEARUSDT", "APTUSDT", "ARBUSDT", "OPUSDT", "INJUSDT", "BCHUSDT",
];
export const CORE_MAGNETS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
export const CYCLE_MIN = 15;

export type CoreTask = { kind: "SCAN"; symbols: string[] } | { kind: "MAGNET"; symbol: string } | { kind: "RESOLVE" } | { kind: "REST" };

/** What the core does on a given minute of the cycle. */
export function coreTask(epochMinute: number): CoreTask {
  const slot = ((epochMinute % CYCLE_MIN) + CYCLE_MIN) % CYCLE_MIN;
  if (slot < 10) return { kind: "SCAN", symbols: CORE_COINS.slice(slot * 2, slot * 2 + 2) };
  if (slot < 13) return { kind: "MAGNET", symbol: CORE_MAGNETS[slot - 10] };
  if (slot === 13) return { kind: "RESOLVE" };
  return { kind: "REST" };
}

/** Only candles that have closed by `now`: the forming one would change the reading every minute. */
export function closedOnly(candles: SwingCandle[], frameMs: number, now: number): SwingCandle[] {
  return candles.filter((c) => c.openTime + frameMs <= now);
}

/** A breakout signal for this coin from its closed candles, if it is "a punto de romper" with a direction. */
export function scanSignal(symbol: string, closed: SwingCandle[]): JarvisSignal | null {
  const r = readPreBreak(closed, symbol);
  if (!r || r.state !== "A PUNTO") return null;
  return breakoutSignal(symbol, CORE_TF, closed, r);
}

/**
 * A reversal signal when the last closed candle swept the strongest magnet (as
 * the map stood before it) and closed back. `before` is the map without the
 * last candle, `now` with it.
 */
export function magnetSignals(symbol: string, closed: SwingCandle[], before: LiquidationHeatmap | null, now: LiquidationHeatmap | null): JarvisSignal[] {
  if (closed.length < 200) return [];
  const pair = now ? strongestMagnets(now, closed[closed.length - 1].close) : null;
  const out: JarvisSignal[] = [];
  for (const e of magnetEvents(closed, before, now, { minIntensity: 70 })) {
    const s = magnetSignal(symbol, CORE_TF, closed, e, pair);
    if (s) out.push(s);
  }
  return out;
}

/** Running totals per source, so the stats never need a scan of the whole table. */
export type CoreCounters = { resolved: number; wins: number; losses: number; gain: number; loss: number; total: number; open: number };
export const ZERO: CoreCounters = { resolved: 0, wins: 0, losses: 0, gain: 0, loss: 0, total: 0, open: 0 };

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

export function coreStats(bySource: Partial<Record<JarvisSource, CoreCounters>>): LedgerStats {
  const r = bySource.ROMPE ?? ZERO;
  const m = bySource["IMÁN"] ?? ZERO;
  const all: CoreCounters = {
    resolved: r.resolved + m.resolved,
    wins: r.wins + m.wins,
    losses: r.losses + m.losses,
    gain: r.gain + m.gain,
    loss: r.loss + m.loss,
    total: r.total + m.total,
    open: r.open + m.open,
  };
  return { ...countersToStats(all), bySource: { ROMPE: countersToStats(r), "IMÁN": countersToStats(m) } };
}

export type CoreHeartbeat = { at: number; task: string; ok: boolean; note: string };
/** The core counts as alive if it ticked within the last 5 minutes (it ticks every minute). */
export function coreOnline(hb: CoreHeartbeat | null, now: number): boolean {
  return !!hb && now - hb.at < 5 * 60_000;
}

export type CoreSnapshot = {
  heartbeat: CoreHeartbeat | null;
  stats: LedgerStats;
  open: JarvisSignal[];
  recent: JarvisSignal[];
  /** Newest first: created or closed after `since`, for "what happened while I was away". */
  generatedAt: number;
};

const coin = (s: string) => s.replace(/USDT$/, "");
const fmtR = (r: number) => `${r >= 0 ? "más" : "menos"} ${Math.abs(r).toFixed(1).replace(".", ",")} R`;

/**
 * What JARVIS says about the core's activity since `since`: signals opened
 * and closed in that time, each closed one with its result.
 */
export function awaySpeech(signals: JarvisSignal[], since: number): string | null {
  const opened = signals.filter((s) => s.time > since);
  const closed = signals.filter((s) => s.closedAt !== null && s.closedAt > since && s.r !== null);
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
    const sum = closed.reduce((a, s) => a + (s.r as number), 0);
    parts.push(
      `${opened.length ? "Y cerró" : "Mientras no estabas, el núcleo cerró"} ${closed.length}: ${closed
        .slice(0, 3)
        .map((s) => `${coin(s.symbol)} en ${s.result === "OBJETIVO" ? "objetivo" : s.result === "STOP" ? "stop" : "tiempo"}, ${fmtR(s.r as number)}`)
        .join("; ")}. En total ${fmtR(sum)}.`,
    );
  }
  return parts.join(" ");
}

/** A short status line: is it alive, what it is watching, how it has done. */
export function coreStatusSpeech(snap: Pick<CoreSnapshot, "heartbeat" | "stats" | "open">, now: number): string {
  if (!coreOnline(snap.heartbeat, now)) {
    return snap.heartbeat
      ? `El núcleo no da señales de vida desde hace ${Math.round((now - snap.heartbeat.at) / 60_000)} minutos. Sigo funcionando desde tu navegador.`
      : "El núcleo todavía no arrancó en el servidor. Sigo funcionando desde tu navegador.";
  }
  const st = snap.stats;
  const ago = Math.max(0, Math.round((now - (snap.heartbeat as CoreHeartbeat).at) / 60_000));
  const parts = [
    `Núcleo en línea, último latido ${ago === 0 ? "recién" : ago === 1 ? "hace un minuto" : `hace ${ago} minutos`}.`,
    `Vigilo ${CORE_COINS.length} monedas en una hora, las veinticuatro horas.`,
  ];
  if (snap.open.length) parts.push(`Tengo ${snap.open.length} ${snap.open.length === 1 ? "señal abierta" : "señales abiertas"}.`);
  if (st.resolved) {
    parts.push(
      `Cerradas: ${st.resolved}, win rate ${Math.round((st.winRate ?? 0) * 100)} por ciento, ${fmtR(st.totalR)}. ${st.confidence === "MUESTRA RAZONABLE" ? "Muestra razonable." : "Muestra mínima todavía."}`,
    );
  } else parts.push("Todavía no cerré ninguna señal: no hay resultados para medir.");
  return parts.join(" ");
}

/** Compact context for the AI, so it answers knowing what its own core is doing. */
export function coreContext(snap: CoreSnapshot, now: number) {
  const st = snap.stats;
  return {
    asistente: "JARVIS",
    nucleo: {
      enLinea: coreOnline(snap.heartbeat, now),
      ultimoLatidoMin: snap.heartbeat ? Math.round((now - snap.heartbeat.at) / 60_000) : null,
      vigila: `${CORE_COINS.map(coin).join(",")} en ${CORE_TF}; imanes de ${CORE_MAGNETS.map(coin).join(",")}`,
      registro: {
        cerradas: st.resolved,
        abiertas: snap.open.length,
        winRate: st.winRate,
        profitFactor: st.profitFactor === Infinity ? "infinito" : st.profitFactor,
        totalR: Number(st.totalR.toFixed(2)),
        muestra: st.confidence,
      },
      abiertas: snap.open.slice(0, 8).map((s) => ({ moneda: coin(s.symbol), lado: s.side, entrada: s.entry, stop: s.stop, objetivo: s.target, fuente: s.source })),
      ultimasCerradas: snap.recent.slice(0, 8).map((s) => ({ moneda: coin(s.symbol), lado: s.side, resultado: s.result, r: s.r })),
    },
  };
}

/** JSON turns Infinity into null: a record with wins and no losses has an infinite profit factor again. */
export function reviveSnapshot(raw: CoreSnapshot): CoreSnapshot {
  const fix = (st: LvStats): LvStats => (st.profitFactor === null && st.wins > 0 && st.losses === 0 ? { ...st, profitFactor: Infinity } : st);
  const st = raw.stats;
  return { ...raw, stats: { ...fix(st), bySource: { ROMPE: fix(st.bySource.ROMPE), "IMÁN": fix(st.bySource["IMÁN"]) } } };
}
