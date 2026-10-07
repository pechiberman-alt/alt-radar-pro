import type { DeskDecision } from "./jarvis-desk.ts";
import { closeManually, paperFromDesk, resolvePaper, type PaperTrade } from "./jarvis-paper.ts";
import { BROWSER_BASES, FUTURES_BASES } from "./market-fetch.ts";
import { parseSwingKlines, type SwingCandle } from "./swing-entries.ts";

/**
 * Paper trading en el navegador. Con sesión, las operaciones viven en tu
 * cuenta (/api/jarvis/paper); sin sesión, en este equipo. Se resuelven acá,
 * con velas de 1 h de Binance (la misma fuente del plan): como se usan velas
 * pasadas, el resultado es el mismo aunque abras la app días después.
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
    return { ok: true, trade: body.trade };
  }
  if (store.trades.some((x) => x.id === t.id)) return { ok: false, error: "Ya estás siguiendo este plan en papel." };
  if (store.trades.filter(live).length >= MAX_OPEN) return { ok: false, error: `Ya tenés ${MAX_OPEN} operaciones de papel abiertas: cerrá alguna primero.` };
  store = { ...store, trades: sortTrades([t, ...store.trades]) };
  writeLocal(store.trades);
  emit();
  return { ok: true, trade: t };
}

/** Velas de 1 h desde `startTime`: futuros primero (la fuente del plan), spot si no responde. */
export async function candlesSince(symbol: string, startTime: number, signal: AbortSignal): Promise<{ candles: SwingCandle[]; venue: string } | null> {
  const q = `symbol=${encodeURIComponent(symbol)}&interval=1h&startTime=${Math.floor(startTime)}&limit=1000`;
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

/** Avanza las abiertas con las velas cerradas desde la última revisión. */
export async function refreshPaper(now = Date.now()): Promise<{ changed: number; sinDatos: string[] }> {
  const s = await loadPaper();
  const open = s.trades.filter(live);
  const sinDatos: string[] = [];
  if (!open.length) return { changed: 0, sinDatos };
  const bySymbol = new Map<string, PaperTrade[]>();
  for (const t of open) bySymbol.set(t.symbol, [...(bySymbol.get(t.symbol) ?? []), t]);
  const changed: PaperTrade[] = [];
  for (const [symbol, list] of bySymbol) {
    const start = Math.min(...list.map((t) => (t.revisadaHasta ?? t.vela) + H));
    if (now - start < H) continue;
    const got = await candlesSince(symbol, start, AbortSignal.timeout(15_000));
    if (!got) {
      sinDatos.push(symbol.replace(/USDT$/, ""));
      continue;
    }
    const closed = got.candles.filter((c) => c.openTime + H <= now);
    const last = closed[closed.length - 1];
    if (last) lastClose.set(symbol, { price: last.close, at: last.openTime + H });
    for (const t of list) {
      const next = resolvePaper(t, got.candles, now, got.venue);
      if (next !== t) changed.push(next);
    }
  }
  await persist(changed);
  if (changed.length) emit();
  return { changed: changed.length, sinDatos };
}

/** Cierra a mano al último cierre de 1 h (antes revisa si tocó stop u objetivos). */
export async function closeNow(id: string, now = Date.now()): Promise<OpenOutcome> {
  await refreshPaper(now);
  const t = store.trades.find((x) => x.id === id);
  if (!t || !live(t)) return { ok: false, error: "Esa operación ya está cerrada." };
  let price = lastClose.get(t.symbol)?.price ?? null;
  if (price === null && t.estado === "ABIERTA") {
    const got = await candlesSince(t.symbol, now - 3 * H, AbortSignal.timeout(15_000));
    const last = got?.candles.filter((c) => c.openTime + H <= now).at(-1);
    price = last?.close ?? null;
  }
  if (price === null && t.estado === "ABIERTA") return { ok: false, error: "Binance no respondió: no hay precio para cerrarla. Este dato no está disponible actualmente." };
  const next = closeManually(t, price ?? 0, now);
  await persist([next]);
  emit();
  return { ok: true, trade: store.trades.find((x) => x.id === id) ?? next };
}
