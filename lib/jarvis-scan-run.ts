import { closedCandles, loadMarketContext, type MarketContext } from "./jarvis-desk-data.ts";
import { deskFor, loadDeskSettings, openPaperRiskUsd } from "./jarvis-desk-run.ts";
import type { DeskDecision, DeskSettings } from "./jarvis-desk.ts";
import { DEFAULT_SCAN_VOLUME, SCAN_DEEP_MAX, eligibleSymbols, quickRead, rankApproved, rowFrom, rowWithoutData, scanCandles, summarize, type Eligible, type ScanResult, type ScanRow, type ScanShared } from "./jarvis-scan.ts";
import { FUTURES_BASES } from "./market-fetch.ts";

/**
 * El escáner de todo el mercado en el navegador: baja de Binance Futures las
 * velas de cada moneda de a poco, corre la mesa (lib/jarvis-scan.ts) y relee
 * completas las aprobadas. Corre acá y no en el servidor: Binance le responde
 * a la conexión de la persona y no al Worker, y el cálculo gasta el celular y
 * no el plan gratis del Worker.
 *
 * Cuida a Binance (el límite es por conexión, 2.400 de peso por minuto, y la
 * lectura de una moneda pesa 9): una moneda cada 700 ms como mucho (unos 770 de
 * peso por minuto, bastante menos que el tope, porque la app también consulta
 * por su cuenta), nunca el servidor de la app como plan B (no queremos que el
 * límite de Binance se vuelva lecturas de base de datos), y si Binance contesta
 * 429 espera y reintenta una vez; si insiste, o contesta 418, corta y dice por qué.
 */

export const SCAN_EVENT = "alt-radar:jarvis-scan";
/** Pausa mínima entre el comienzo de dos monedas. */
export const SCAN_GAP_MS = 700;
/** Si Binance limita más veces que estas, se corta. */
const MAX_THROTTLES = 2;
const DEFAULT_WAIT_MS = 30_000;
const MAX_WAIT_MS = 120_000;
const WORKERS = 2;

export type ScanProgress = {
  fase: "monedas" | "datos" | "lectura" | "completa";
  hechas: number;
  total: number;
  actual: string | null;
  /** Cuánto falta, estimado con lo que va tardando; null hasta tener un ritmo. */
  restanteMs: number | null;
};

export type ScanOutcome = { ok: true; result: ScanResult } | { ok: false; error: string };

export type ScanOptions = {
  minVolume?: number;
  signal?: AbortSignal;
  onProgress?: (p: ScanProgress) => void;
  /** Para probar sin red ni reloj. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  gapMs?: number;
  settings?: DeskSettings;
  loadContext?: () => Promise<MarketContext>;
  deep?: (symbol: string) => Promise<DeskDecision | null>;
};

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const id = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        resolve();
      },
      { once: true },
    );
  });

type Klines = { rows: unknown[] } | { limited: number } | { banned: true } | { failed: true };

/** Velas de Binance Futures. Nunca cae al servidor de la app ni a spot: sin velas de futuros, la moneda queda sin leer. */
async function klines(fetchImpl: typeof fetch, bases: { at: number }, symbol: string, interval: "1h" | "4h" | "1d", limit: number, signal: AbortSignal): Promise<Klines> {
  const query = `symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  for (let k = 0; k < FUTURES_BASES.length && !signal.aborted; k += 1) {
    const at = (bases.at + k) % FUTURES_BASES.length;
    try {
      const r = await fetchImpl(`${FUTURES_BASES[at]}/fapi/v1/klines?${query}`, { signal });
      if (r.status === 418) return { banned: true };
      if (r.status === 429) {
        const seconds = Number(r.headers?.get?.("retry-after"));
        return { limited: Number.isFinite(seconds) && seconds > 0 ? Math.min(MAX_WAIT_MS, seconds * 1000) : DEFAULT_WAIT_MS };
      }
      // A symbol Binance does not know (just delisted, new): no mirror will have it.
      if (r.status === 400 || r.status === 404) return { failed: true };
      if (!r.ok) continue;
      const rows = (await r.json()) as unknown;
      bases.at = at;
      return Array.isArray(rows) && rows.length ? { rows } : { failed: true };
    } catch {
      // Network error or abort: next mirror (the loop ends by itself when aborted).
    }
  }
  return { failed: true };
}

async function fetchTickers(fetchImpl: typeof fetch, signal: AbortSignal): Promise<unknown[] | null> {
  for (const base of FUTURES_BASES) {
    if (signal.aborted) return null;
    try {
      const r = await fetchImpl(`${base}/fapi/v1/ticker/24hr`, { signal });
      if (r.status === 418 || r.status === 429) return null;
      if (!r.ok) continue;
      const rows = (await r.json()) as unknown;
      if (Array.isArray(rows) && rows.length) return rows;
    } catch {
      // Next mirror.
    }
  }
  return null;
}

/**
 * Lee todas las monedas con volumen suficiente. Devuelve el resultado (completo
 * o parcial, y dice por qué se cortó) o un error si ni siquiera hay con qué empezar.
 */
export async function scanMarket(opts: ScanOptions = {}): Promise<ScanOutcome> {
  const fetchImpl = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const clock = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const signal = opts.signal ?? new AbortController().signal;
  const gap = opts.gapMs ?? SCAN_GAP_MS;
  const minVolume = opts.minVolume ?? DEFAULT_SCAN_VOLUME;
  const settings = opts.settings ?? { ...loadDeskSettings(), riesgoAbiertoUsd: openPaperRiskUsd() };
  const t0 = clock();
  const report = (p: ScanProgress) => opts.onProgress?.(p);

  report({ fase: "monedas", hechas: 0, total: 0, actual: null, restanteMs: null });
  const tickers = await fetchTickers(fetchImpl, signal);
  if (!tickers) return { ok: false, error: signal.aborted ? "Cortaste el escaneo." : "Binance no respondió la lista de monedas. Probá de nuevo en un rato." };
  const universe = eligibleSymbols(tickers, minVolume);
  const list = universe.elegibles;
  if (!list.length) return { ok: false, error: "Ninguna moneda supera ese volumen mínimo en 24 horas. Probá con un volumen más bajo." };

  // What is the same for every coin, once: BTC and ETH for the correlation, and calendar, sentiment, news and dominance.
  report({ fase: "datos", hechas: 0, total: list.length, actual: null, restanteMs: null });
  const now = clock();
  const bases = { at: 0 };
  const [btc, eth, context] = await Promise.all([klines(fetchImpl, bases, "BTCUSDT", "1h", 200, signal), klines(fetchImpl, bases, "ETHUSDT", "1h", 200, signal), (opts.loadContext ?? (() => loadMarketContext(AbortSignal.timeout(20_000))))()]);
  const shared: ScanShared = { btc: "rows" in btc ? closedCandles(btc.rows, "1h", now) : null, eth: "rows" in eth ? closedCandles(eth.rows, "1h", now) : null, context };

  const rows: (ScanRow | undefined)[] = new Array(list.length).fill(undefined);
  let cursor = 0;
  let done = 0;
  let nextAt = clock();
  let pausedUntil = 0;
  let throttles = 0;
  let stopReason: string | null = null;
  const stopped = () => stopReason !== null || signal.aborted;
  const progress = (fase: ScanProgress["fase"], hechas: number, total: number, actual: string | null) => {
    const spent = clock() - t0;
    report({ fase, hechas, total, actual, restanteMs: hechas >= 3 ? Math.round((spent / hechas) * (total - hechas)) : null });
  };

  // One coin every `gap` ms at most, and never while Binance has asked us to wait.
  const reserve = async () => {
    const t = clock();
    const start = Math.max(t, nextAt, pausedUntil);
    nextAt = start + gap;
    if (start > t) await sleep(start - t, signal);
  };

  const readCoin = async (e: Eligible): Promise<{ row: ScanRow } | { limited: number } | { banned: true } | { gone: true }> => {
    const [h1, h4, d1] = await Promise.all([klines(fetchImpl, bases, e.symbol, "1h", 1000, signal), klines(fetchImpl, bases, e.symbol, "4h", 300, signal), klines(fetchImpl, bases, e.symbol, "1d", 220, signal)]);
    if (signal.aborted) return { gone: true };
    for (const k of [h1, h4, d1]) {
      if ("banned" in k) return { banned: true };
      if ("limited" in k) return { limited: k.limited };
    }
    if (!("rows" in h1)) return { row: rowWithoutData(e, "Binance no devolvió velas de 1 h de esta moneda.") };
    const candles = scanCandles({ h1: h1.rows, h4: "rows" in h4 ? h4.rows : null, d1: "rows" in d1 ? d1.rows : null }, now);
    return { row: quickRead(e, candles, shared, now, settings) };
  };

  const worker = async () => {
    while (!stopped()) {
      const i = cursor;
      cursor += 1;
      if (i >= list.length) return;
      const e = list[i];
      for (let attempt = 0; attempt < 2 && !stopped(); attempt += 1) {
        await reserve();
        if (stopped()) break;
        const out = await readCoin(e);
        if ("row" in out) {
          rows[i] = out.row;
          done += 1;
          progress("lectura", done, list.length, e.moneda);
          break;
        }
        if ("banned" in out) {
          stopReason = "Binance bloqueó por un rato las consultas de esta conexión (error 418). Esperá unos minutos antes de volver a escanear.";
          break;
        }
        if ("limited" in out) {
          throttles += 1;
          pausedUntil = Math.max(pausedUntil, clock() + out.limited);
          if (throttles > MAX_THROTTLES) stopReason = "Binance limitó las consultas varias veces (error 429): conviene esperar un rato antes de volver a escanear.";
        }
      }
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, () => worker()));

  let filas = rows.filter((r): r is ScanRow => r !== undefined);

  // The ones that pass on candles alone are read again with the whole desk (derivatives, liquidations).
  if (!stopped()) {
    const finalists = rankApproved(filas).slice(0, SCAN_DEEP_MAX);
    const deep = opts.deep ?? (async (symbol: string) => (await deskFor(symbol, { force: true })).decision);
    for (let n = 0; n < finalists.length && !signal.aborted; n += 1) {
      const quick = finalists[n];
      progress("completa", n, finalists.length, quick.moneda);
      if (n > 0) await sleep(gap * 2, signal);
      if (signal.aborted) break;
      const e: Eligible = { symbol: quick.symbol, moneda: quick.moneda, volumenUsd: quick.volumenUsd };
      let full: ScanRow;
      try {
        const d = await deep(quick.symbol);
        full = d ? rowFrom(e, d, "completa", quick.direccion) : { ...quick, nota: "No se pudo releer completa: queda la lectura rápida." };
      } catch {
        full = { ...quick, nota: "No se pudo releer completa: queda la lectura rápida." };
      }
      filas = filas.map((r) => (r.symbol === quick.symbol ? full : r));
    }
  }

  const parcial = stopped() || filas.length < list.length;
  const result: ScanResult = {
    at: clock(),
    minVolumen: minVolume,
    universo: { elegibles: list.length, contratos: universe.contratos, noMonedas: universe.noMonedas, sinVolumen: universe.sinVolumen, recortadas: universe.recortadas },
    filas,
    resumen: summarize(filas),
    parcial,
    motivoParcial: !parcial ? null : (stopReason ?? (signal.aborted ? "lo cortaste vos" : "no llegó a leer todas")),
    duracionMs: clock() - t0,
  };
  return { ok: true, result };
}

// ── El escaneo en curso, compartido entre la sección y el chat de JARVIS ──

export type ScanState = { running: boolean; progress: ScanProgress | null; result: ScanResult | null; error: string | null };
let state: ScanState = { running: false, progress: null, result: null, error: null };
let controller: AbortController | null = null;

function emit() {
  try {
    window.dispatchEvent(new CustomEvent(SCAN_EVENT));
  } catch {
    // No window (tests, the Worker): nobody to tell.
  }
}

function set(patch: Partial<ScanState>) {
  state = { ...state, ...patch };
  emit();
}

export function scanState(): Readonly<ScanState> {
  return state;
}

export function lastScan(): ScanResult | null {
  return state.result;
}

/** Empieza un escaneo (uno por vez). El avance y el resultado se leen con scanState(). */
export function startScan(opts: { minVolume?: number } = {}): Promise<ScanOutcome> {
  if (state.running) return Promise.resolve({ ok: false, error: "Ya hay un escaneo en curso." });
  controller = new AbortController();
  set({ running: true, error: null, progress: { fase: "monedas", hechas: 0, total: 0, actual: null, restanteMs: null } });
  return scanMarket({ minVolume: opts.minVolume, signal: controller.signal, onProgress: (p) => set({ progress: p }) })
    .then((out) => {
      set(out.ok ? { running: false, progress: null, result: out.result } : { running: false, progress: null, error: out.error });
      return out;
    })
    .catch(() => {
      set({ running: false, progress: null, error: "El escaneo falló por un error inesperado. Probá de nuevo." });
      return { ok: false as const, error: "El escaneo falló por un error inesperado." };
    });
}

export function cancelScan() {
  controller?.abort();
}
