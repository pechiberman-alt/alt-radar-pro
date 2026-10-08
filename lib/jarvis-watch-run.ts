import { publishAlert } from "./alert-bus.ts";
import type { Alert } from "./alerts.ts";
import { futuresStreamUrl } from "./binance-ws.ts";
import { deskFor } from "./jarvis-desk-run.ts";
import { cleanWatchPrefs, liquidationWatchAlert, watchAlerts, type WatchMemory, type WatchPrefs } from "./jarvis-watch.ts";
import { parseForceOrder } from "./live-market.ts";

/**
 * La vigilancia de la mesa en el navegador: con la app abierta y visible,
 * cada pocos minutos lee los activos elegidos con la misma mesa y publica las
 * alertas nuevas (banners, y notificaciones si están permitidas en el centro
 * de alertas). Las liquidaciones grandes llegan en vivo por el WebSocket de
 * Binance. Preferencias y memoria quedan en este equipo.
 */

export const WATCH_PREFS_KEY = "alt-radar-pro:jarvis-watch:v1";
export const WATCH_STATE_KEY = "alt-radar-pro:jarvis-watch-state:v1";
export const WATCH_EVENT = "alt-radar:jarvis-watch";
const H = 3_600_000;
const MAX_FIRED = 300;

type State = { memory: Record<string, WatchMemory>; fired: string[] };
export type WatchStatus = { lastRun: number | null; lastAlerts: number; errors: string[]; running: boolean; tape: "apagado" | "conectando" | "en vivo" | "sin conexión" };
let status: WatchStatus = { lastRun: null, lastAlerts: 0, errors: [], running: false, tape: "apagado" };

function emit() {
  try {
    window.dispatchEvent(new CustomEvent(WATCH_EVENT));
  } catch {
    // No window: nobody to tell.
  }
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode: it lives only in this visit.
  }
}

let prefsCache: WatchPrefs | null = null;

export function loadWatchPrefs(): WatchPrefs {
  prefsCache ??= cleanWatchPrefs(read<unknown>(WATCH_PREFS_KEY, {}));
  return prefsCache;
}

export function saveWatchPrefs(p: WatchPrefs) {
  prefsCache = cleanWatchPrefs(p);
  write(WATCH_PREFS_KEY, prefsCache);
  emit();
}

export function watchStatus(): WatchStatus {
  return status;
}

function setStatus(patch: Partial<WatchStatus>) {
  status = { ...status, ...patch };
  emit();
}

/** Una vuelta de vigilancia sobre los activos elegidos. Devuelve las alertas nuevas. */
export async function runWatch(now = Date.now()): Promise<Alert[]> {
  const prefs = loadWatchPrefs();
  if (!prefs.enabled || status.running) return [];
  setStatus({ running: true });
  const fresh: Alert[] = [];
  const errors: string[] = [];
  try {
    await watchSymbols(prefs, now, fresh, errors);
  } finally {
    setStatus({ running: false, lastRun: now, lastAlerts: fresh.length, errors });
  }
  return fresh;
}

async function watchSymbols(prefs: WatchPrefs, now: number, fresh: Alert[], errors: string[]) {
  const state = read<State>(WATCH_STATE_KEY, { memory: {}, fired: [] });
  const fired = new Set(state.fired);
  for (const sym of prefs.symbols) {
    try {
      const { decision, snapshot } = await deskFor(sym);
      if (!decision) {
        errors.push(`${sym.replace(/USDT$/, "")}: sin velas suficientes`);
        continue;
      }
      // Only candles closed when the desk read them: the same ones behind its levels.
      const closed = (c: typeof snapshot.candles.h1 | null, frame: number) => (c ? c.filter((x) => x.openTime + frame <= snapshot.now) : null);
      const r = watchAlerts({ d: decision, h1: closed(snapshot.candles.h1, H) ?? [], h4: closed(snapshot.candles.h4, 4 * H), news: snapshot.news, prev: state.memory[sym] ?? null, now, prefs });
      state.memory[sym] = r.memory;
      for (const a of r.alerts) {
        if (fired.has(a.id)) continue;
        fired.add(a.id);
        fresh.push(a);
      }
    } catch {
      errors.push(`${sym.replace(/USDT$/, "")}: Binance no respondió`);
    }
  }
  write(WATCH_STATE_KEY, { memory: state.memory, fired: [...fired].slice(-MAX_FIRED) });
  for (const a of fresh) publishAlert(a);
}

let socket: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let backoff = 2_000;
let wanted = false;

/** El tape de liquidaciones reales: abierto solo si la regla está prendida y la app visible. */
export function setLiquidationTape(on: boolean) {
  wanted = on;
  if (!on) {
    if (retry) clearTimeout(retry);
    retry = null;
    socket?.close();
    socket = null;
    if (status.tape !== "apagado") setStatus({ tape: "apagado" });
    return;
  }
  if (socket) return;
  setStatus({ tape: "conectando" });
  const ws = new WebSocket(futuresStreamUrl(["!forceOrder@arr"]));
  socket = ws;
  ws.onopen = () => {
    backoff = 2_000;
    setStatus({ tape: "en vivo" });
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data)) as { data?: unknown };
      const l = parseForceOrder(msg.data ?? msg);
      const alert = l ? liquidationWatchAlert(l, loadWatchPrefs()) : null;
      if (alert) publishAlert(alert);
    } catch {
      // A frame that cannot be read is skipped.
    }
  };
  ws.onclose = () => {
    if (socket === ws) socket = null;
    if (!wanted) return;
    setStatus({ tape: "sin conexión" });
    retry = setTimeout(() => {
      retry = null;
      if (wanted) setLiquidationTape(true);
    }, backoff);
    backoff = Math.min(60_000, backoff * 2);
  };
}
