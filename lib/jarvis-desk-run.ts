import { loadDeskSnapshot, type DeskSnapshot } from "./jarvis-desk-data.ts";
import { DEFAULT_DESK_SETTINGS, runDesk, type DeskDecision, type DeskRecord, type DeskSettings } from "./jarvis-desk.ts";
import type { MarketStructure } from "./market-structure.ts";

/**
 * JARVIS TRADING en el navegador: carga los datos, corre la mesa y guarda la
 * última decisión de cada activo un rato, para que la sección y el chat de
 * JARVIS hablen de lo mismo sin pedir todo dos veces. Las preferencias de
 * riesgo (capital, % por operación, apalancamiento máximo) quedan en este
 * equipo.
 */

export const DESK_SETTINGS_KEY = "alt-radar-pro:jarvis-trading:v1";
/** La sección escucha este evento: JARVIS le pide mostrar un activo. */
export const DESK_SHOW_EVENT = "alt-radar:jarvis-trading";
const TTL_MS = 90_000;

type Entry = { at: number; decision: DeskDecision | null; snapshot: DeskSnapshot; record: DeskRecord | null };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();

/**
 * A number typed on the phone, the Argentine way or not: "1.000" and "1.000,5"
 * (dots for thousands), "0,5" or "0.5". Null when it is not a number.
 */
export function typedNumber(raw: string): number | null {
  const t = raw.trim().replace(/\s|\$|%|x$/gi, "");
  if (!t) return null;
  let v: number;
  if (t.includes(",")) v = Number(t.replace(/\./g, "").replace(",", "."));
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) v = Number(t.replace(/\./g, ""));
  else v = Number(t);
  return Number.isFinite(v) ? v : null;
}

export function loadDeskSettings(): DeskSettings {
  try {
    const raw = JSON.parse(window.localStorage.getItem(DESK_SETTINGS_KEY) ?? "{}") as Partial<DeskSettings>;
    const capital = typeof raw.capital === "number" && raw.capital > 0 ? raw.capital : null;
    const riesgoPct = typeof raw.riesgoPct === "number" && raw.riesgoPct > 0 && raw.riesgoPct <= 5 ? raw.riesgoPct : DEFAULT_DESK_SETTINGS.riesgoPct;
    const apalancamientoMax = typeof raw.apalancamientoMax === "number" && raw.apalancamientoMax >= 1 && raw.apalancamientoMax <= 50 ? Math.round(raw.apalancamientoMax) : DEFAULT_DESK_SETTINGS.apalancamientoMax;
    return { capital, riesgoPct, apalancamientoMax };
  } catch {
    return DEFAULT_DESK_SETTINGS;
  }
}

export function saveDeskSettings(s: DeskSettings) {
  try {
    window.localStorage.setItem(DESK_SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Private mode: the settings live only in this visit.
  }
  // The same data decided again with the new risk: no new request, and the answer changes at once.
  for (const [sym, e] of cache) cache.set(sym, { ...e, decision: runDesk(e.snapshot, s, e.record) });
}

/** La decisión de la mesa para un activo; la reutiliza si tiene menos de 90 s. */
export async function deskFor(symbol: string, opts: { structure?: MarketStructure | null; force?: boolean; record?: DeskRecord | null } = {}): Promise<Entry> {
  const sym = symbol.toUpperCase().endsWith("USDT") ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
  const hit = cache.get(sym);
  if (!opts.force && hit && Date.now() - hit.at < TTL_MS) return hit;
  const running = inflight.get(sym);
  if (running) return running;
  const job = (async () => {
    const snapshot = await loadDeskSnapshot(sym, { structure: opts.structure });
    const record = opts.record ?? null;
    const decision = runDesk(snapshot, loadDeskSettings(), record);
    const entry: Entry = { at: Date.now(), decision, snapshot, record };
    cache.set(sym, entry);
    return entry;
  })().finally(() => inflight.delete(sym));
  inflight.set(sym, job);
  return job;
}

/** La última decisión ya calculada de un activo, sin pedir nada. */
export function cachedDesk(symbol: string): DeskDecision | null {
  return cache.get(symbol.toUpperCase().endsWith("USDT") ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`)?.decision ?? null;
}

/** Pide a la sección JARVIS TRADING que muestre un activo (y la abre). */
export function showInDesk(symbol: string, compareWith?: string) {
  window.dispatchEvent(new CustomEvent(DESK_SHOW_EVENT, { detail: { symbol, compareWith } }));
}
