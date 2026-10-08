import type { DeskDecision } from "./jarvis-desk.ts";
import { closeManually, cursorOf, MINUTE, needsMinutes, paperFromDesk, resolvePaper, type PaperTrade } from "./jarvis-paper.ts";
import { BROWSER_BASES, FUTURES_BASES } from "./market-fetch.ts";
import { parseSwingKlines, type SwingCandle } from "./swing-entries.ts";

/**
 * Paper trading en el navegador. Con sesión, las operaciones viven en tu
 * cuenta (/api/jarvis/paper); sin sesión, en este equipo. Se resuelven acá,
 * con velas de Binance (la misma fuente del plan): 1 minuto para el pedazo
 * de hora en que se abrió cada una y 1 h después. Como se usan velas pasadas,
 * el resultado es el mismo aunque abras la app días después.
 */

export const PAPER_LOCAL_KEY = "alt-radar-pro:jarvis-paper:v1";
/** Se dispara cuando cambia la lista: la sección y el chat se mantienen iguales. */
export const PAPER_EVENT = "alt-radar:jarvis-paper";
const H = 3_600_000;
const MAX_OPEN = 20;
const STALE_PLAN_MS = 3 * H;

export type PaperMode = "cuenta" | "equipo" | "error";
type Store = { trades: PaperTrade[]; mode: PaperMode; loaded: boolean; error: string | null };
let store: Store = { trades: [], mode: "equipo", loaded: false, error: null };
let loading: Promise<Store> | null = null;
/** Último cierre de 1 h visto por moneda, para la R de las abiertas. */
const lastClose = new Map<string, { price: number; at: number }>();

const live = (t: PaperTrade) => t.estado === "ABIERTA" || t.estado === "PENDIENTE";
const sortTrades = (l: PaperTrade[]) => [...l].sort((a, b) => b.abiertaA - a.abiertaA);

function emit() {
  try {
    window.dispatchEvent(new CustomEvent(PAPER_EVENT));
  } catch {
    // No window (tests, the Worker): nobody to tell.
  }
}

function readLocal(): PaperTrade[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PAPER_LOCAL_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? (raw as PaperTrade[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(trades: PaperTrade[]) {
  try {
    window.localStorage.setItem(PAPER_LOCAL_KEY, JSON.stringify(trades.slice(0, 500)));
  } catch {
    // Private mode or full: they live only in this visit.
  }
}

export function paperState(): Readonly<Store> {
  return store;
}

export function paperTrades(): PaperTrade[] {
  return store.trades;
}

export function lastPrice(symbol: string): { price: number; at: number } | null {
  return lastClose.get(symbol) ?? null;
}

/** La lista de operaciones: de la cuenta si hay sesión, si no de este equipo. */
export async function loadPaper(force = false): Promise<Store> {
  if (store.loaded && !force) return store;
  if (loading) return loading;
  loading = (async () => {
    try {
      const r = await fetch("/api/jarvis/paper", { cache: "no-store" });
      if (r.ok) {
        const d = (await r.json()) as { trades?: PaperTrade[] };
        store = { trades: sortTrades(d.trades ?? []), mode: "cuenta", loaded: true, error: null };
      } else if (r.status === 401) {
        store = { trades: sortTrades(readLocal()), mode: "equipo", loaded: true, error: null };
      } else {
        // Signed in but the record did not answer: never fall back to an empty list as if it were real.
        store = { ...store, mode: "error", loaded: true, error: "No se pudo leer tu registro de papel. Probá en un rato." };
      }
    } catch {
      store = { ...store, mode: "error", loaded: true, error: "Sin conexión con tu registro de papel." };
    }
    emit();
    return store;
  })().finally(() => {
    loading = null;
  });
  return loading;
}

function replace(updated: PaperTrade[]) {
  const byId = new Map(updated.map((t) => [t.id, t]));
  store = { ...store, trades: sortTrades(store.trades.map((t) => byId.get(t.id) ?? t)) };
  if (store.mode === "equipo") writeLocal(store.trades);
}

async function persist(updated: PaperTrade[]): Promise<void> {
  if (!updated.length) return;
  if (store.mode !== "cuenta") {
    replace(updated);
    return;
  }
  for (let i = 0; i < updated.length; i += 20) {
    const chunk = updated.slice(i, i + 20);
    const r = await fetch("/api/jarvis/paper", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trades: chunk }) });
    const d = (await r.json().catch(() => ({}))) as { saved?: PaperTrade[] };
    // The server's version wins: it recomputes the result from the exits.
    if (r.ok && d.saved) replace(d.saved);
  }
}

export type OpenOutcome = { ok: true; trade: PaperTrade } | { ok: false; error: string };

/** Sigue en papel el plan que muestra la mesa. */
export async function openFromDesk(d: DeskDecision, now = Date.now()): Promise<OpenOutcome> {
  const s = await loadPaper();
  if (s.mode === "error") return { ok: false, error: s.error ?? "No se pudo leer tu registro de papel." };
  const t = paperFromDesk(d, now);
  if (!t) return { ok: false, error: "Este plan no se puede seguir en papel: el gestor de riesgo no lo aprobó." };
  if (now - t.vela > STALE_PLAN_MS) return { ok: false, error: "Ese plan ya es viejo: volvé a analizar el activo." };
  if (s.mode === "cuenta") {
    const r = await fetch("/api/jarvis/paper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trade: t }) });
    const body = (await r.json().catch(() => ({}))) as { trade?: PaperTrade; error?: string };
    if (!r.ok || !body.trade) return { ok: false, error: body.error ?? "No se pudo abrir la operación de papel." };
    store = { ...store, trades: sortTrades([body.trade, ...store.trades]) };
    emit();
    refreshSoon(body.trade, now);
    return { ok: true, trade: body.trade };
  }
  if (store.trades.some((x) => x.id === t.id)) return { ok: false, error: "Ya estás siguiendo este plan en papel." };
  if (store.trades.filter(live).length >= MAX_OPEN) return { ok: false, error: `Ya tenés ${MAX_OPEN} operaciones de papel abiertas: cerrá alguna primero.` };
  store = { ...store, trades: sortTrades([t, ...store.trades]) };
  writeLocal(store.trades);
  emit();
  refreshSoon(t, now);
  return { ok: true, trade: t };
}

/** Pide revisar las de papel apenas cierra el primer minuto de una recién abierta (con la pestaña visible). */
export function refreshSoon(t: PaperTrade, now = Date.now()) {
  if (typeof window === "undefined" || typeof window.setTimeout !== "function" || typeof document === "undefined") return;
  const wait = Math.max(5_000, cursorOf(t) + MINUTE + 15_000 - now);
  window.setTimeout(() => {
    if (document.visibilityState === "visible") void refreshPaper().catch(() => null);
  }, wait);
}

/** Velas desde `startTime` (de 1 h, o de 1 minuto): futuros primero (la fuente del plan), spot si no responde. */
export async function candlesSince(symbol: string, startTime: number, signal: AbortSignal, interval: "1h" | "1m" = "1h"): Promise<{ candles: SwingCandle[]; venue: string } | null> {
  const q = `symbol=${encodeURIComponent(symbol)}&interval=${interval}&startTime=${Math.floor(startTime)}&limit=1000`;
  const routes: [string[], string, string][] = [
    [FUTURES_BASES, "/fapi/v1/klines", "Binance Futures"],
    [BROWSER_BASES, "/api/v3/klines", "Binance Spot"],
  ];
  for (const [bases, path, venue] of routes) {
    for (const base of bases) {
      try {
        const r = await fetch(`${base}${path}?${q}`, { signal });
        if (!r.ok) continue;
        const candles = parseSwingKlines(await r.json());
        if (candles.length) return { candles, venue };
      } catch {
        // Next mirror.
      }
    }
  }
  return null;
}

const nextHour = (t: number) => Math.floor(t / H) * H + H;

/**
 * Lleva una lista de operaciones de una moneda hasta `now`: primero completa
 * con velas de 1 minuto la hora en que se abrió cada una, después avanza con
 * velas de 1 h y, con `toNow`, revisa también los minutos ya cerrados de la
 * hora en curso (para cerrar a mano sin saltear nada). Si una parte no tiene
 * datos, esa operación espera: nunca se saltea un tramo sin revisar.
 */
async function advanceSymbol(symbol: string, list: PaperTrade[], now: number, toNow: boolean): Promise<{ trades: PaperTrade[]; ok: boolean }> {
  let ok = true;
  let trades = list;
  const minutePass = async (until: (t: PaperTrade) => number, want: (t: PaperTrade) => boolean) => {
    const need = trades.filter((t) => live(t) && want(t) && Math.min(now, until(t)) - cursorOf(t) >= MINUTE);
    if (!need.length) return;
    const got = await candlesSince(symbol, Math.min(...need.map(cursorOf)), AbortSignal.timeout(15_000), "1m");
    if (!got) {
      ok = false;
      return;
    }
    const closed = got.candles.filter((c) => c.openTime + MINUTE <= now);
    const last = closed[closed.length - 1];
    if (last) lastClose.set(symbol, { price: last.close, at: last.openTime + MINUTE });
    trades = trades.map((t) => (need.includes(t) ? resolvePaper(t, got.candles, now, got.venue, MINUTE, until(t)) : t));
  };
  // 1. The rest of the hour each one was opened in, minute by minute.
  await minutePass((t) => nextHour(cursorOf(t)), needsMinutes);
  // 2. Whole hours.
  const hourly = trades.filter((t) => live(t) && !needsMinutes(t) && now - cursorOf(t) >= H);
  if (hourly.length) {
    const got = await candlesSince(symbol, Math.min(...hourly.map(cursorOf)), AbortSignal.timeout(15_000), "1h");
    if (!got) ok = false;
    else {
      const closed = got.candles.filter((c) => c.openTime + H <= now);
      const last = closed[closed.length - 1];
      const known = lastClose.get(symbol);
      if (last && (!known || known.at < last.openTime + H)) lastClose.set(symbol, { price: last.close, at: last.openTime + H });
      trades = trades.map((t) => (hourly.includes(t) ? resolvePaper(t, got.candles, now, got.venue, H) : t));
    }
  }
  // 3. To close by hand: the minutes already closed in the current hour too.
  if (toNow) await minutePass(() => now, () => true);
  return { trades, ok };
}

/** Avanza las abiertas con las velas cerradas desde la última revisión. */
export async function refreshPaper(now = Date.now(), opts: { toNow?: boolean } = {}): Promise<{ changed: number; sinDatos: string[] }> {
  const s = await loadPaper();
  const open = s.trades.filter(live);
  const sinDatos: string[] = [];
  if (!open.length) return { changed: 0, sinDatos };
  const bySymbol = new Map<string, PaperTrade[]>();
  for (const t of open) bySymbol.set(t.symbol, [...(bySymbol.get(t.symbol) ?? []), t]);
  const changed: PaperTrade[] = [];
  for (const [symbol, list] of bySymbol) {
    const r = await advanceSymbol(symbol, list, now, opts.toNow === true);
    if (!r.ok) sinDatos.push(symbol.replace(/USDT$/, ""));
    r.trades.forEach((t, i) => {
      if (t !== list[i]) changed.push(t);
    });
  }
  await persist(changed);
  if (changed.length) emit();
  return { changed: changed.length, sinDatos };
}

/**
 * Cierra a mano al cierre del último minuto (antes revisa minuto a minuto si
 * tocó stop u objetivos: nada queda sin revisar entre el último cierre de 1 h
 * y ahora).
 */
export async function closeNow(id: string, now = Date.now()): Promise<OpenOutcome> {
  const r = await refreshPaper(now, { toNow: true });
  const t = store.trades.find((x) => x.id === id);
  if (!t || !live(t)) return { ok: false, error: "Esa operación ya está cerrada." };
  if (t.estado === "ABIERTA" && r.sinDatos.includes(t.symbol.replace(/USDT$/, ""))) return { ok: false, error: "Binance no respondió: no se puede revisar hasta ahora. Este dato no está disponible actualmente." };
  const last = lastClose.get(t.symbol) ?? null;
  // The exit is the last minute already checked: never a price from before a stretch left unchecked.
  if (t.estado === "ABIERTA" && (!last || last.at !== cursorOf(t))) return { ok: false, error: "Todavía no hay un precio revisado para cerrarla. Probá en un minuto." };
  const next = closeManually(t, last?.price ?? 0, t.estado === "ABIERTA" ? cursorOf(t) : now);
  await persist([next]);
  emit();
  return { ok: true, trade: store.trades.find((x) => x.id === id) ?? next };
}
