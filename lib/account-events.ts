/**
 * Small browser events so any panel can open the account drawer, and every
 * panel learns when someone signs in or out without reloading the page.
 */
export type AccountMode = "login" | "register";

const OPEN = "alt-radar:open-account";
const SESSION = "alt-radar:session";
const HAS_ACCOUNT = "alt-radar-pro:has-account";

export function openAccount(mode: AccountMode = "register") {
  window.dispatchEvent(new CustomEvent(OPEN, { detail: { mode } }));
}

export function onOpenAccount(cb: (mode: AccountMode) => void) {
  const handler = (e: Event) => cb(((e as CustomEvent).detail?.mode as AccountMode) ?? "register");
  window.addEventListener(OPEN, handler);
  return () => window.removeEventListener(OPEN, handler);
}

export function notifySession() {
  window.dispatchEvent(new Event(SESSION));
}

export function onSession(cb: () => void) {
  window.addEventListener(SESSION, cb);
  return () => window.removeEventListener(SESSION, cb);
}

/** Someone who has signed in on this device before gets the login tab first;
 *  everyone else gets "create account", which is what a new visitor needs. */
export function rememberHasAccount() {
  try {
    window.localStorage.setItem(HAS_ACCOUNT, "1");
  } catch {
    // Not persisted.
  }
}
export function defaultAccountMode(): AccountMode {
  try {
    return window.localStorage.getItem(HAS_ACCOUNT) === "1" ? "login" : "register";
  } catch {
    return "register";
  }
}

const SHOW = "alt-radar:show-section";

/** Opens a workspace section (even if collapsed) and scrolls to it. */
export function showSection(id: string) {
  window.dispatchEvent(new CustomEvent(SHOW, { detail: { id } }));
  window.setTimeout(
    () => document.querySelector(`[data-section="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
    120,
  );
}

export function onShowSection(cb: (id: string) => void) {
  const handler = (e: Event) => {
    const id = (e as CustomEvent).detail?.id;
    if (typeof id === "string") cb(id);
  };
  window.addEventListener(SHOW, handler);
  return () => window.removeEventListener(SHOW, handler);
}

const MAP_SYMBOL = "alt-radar:map-symbol";

/** Opens a coin on the liquidation map and scrolls to it. */
export function openInMap(symbol: string, timeframe?: string | null) {
  window.dispatchEvent(new CustomEvent(MAP_SYMBOL, { detail: { symbol, timeframe: timeframe ?? null } }));
  showSection("liquidaciones");
}

export function onMapSymbol(cb: (symbol: string, timeframe: string | null) => void) {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    const symbol = detail?.symbol;
    const timeframe = typeof detail?.timeframe === "string" && /^\d{1,2}[mhdw]$/.test(detail.timeframe) ? detail.timeframe : null;
    if (typeof symbol === "string" && /^[A-Z0-9]{2,24}$/.test(symbol)) cb(symbol, timeframe);
  };
  window.addEventListener(MAP_SYMBOL, handler);
  return () => window.removeEventListener(MAP_SYMBOL, handler);
}

const MAPA_AR = "alt-radar:mapa-ar";

/** Abre una acción o un CEDEAR de BYMA en el MAPA (su vista con mentes y agentes) y lo lleva a pantalla. */
export function openArEnMapa(ticker: string) {
  window.dispatchEvent(new CustomEvent(MAPA_AR, { detail: { ticker } }));
  showSection("liquidaciones");
}

export function onArEnMapa(cb: (ticker: string) => void) {
  const handler = (e: Event) => {
    const t = (e as CustomEvent).detail?.ticker;
    if (typeof t === "string" && /^[A-Z0-9]{1,8}$/.test(t)) cb(t);
  };
  window.addEventListener(MAPA_AR, handler);
  return () => window.removeEventListener(MAPA_AR, handler);
}

const LAB_TAB = "alt-radar:lab-tab";

/** Opens the AI TRADING LAB on one of its tabs (the office, for example) and scrolls to it. */
export function openLabTab(tab: string) {
  window.dispatchEvent(new CustomEvent(LAB_TAB, { detail: { tab } }));
  showSection("lab");
}

export function onLabTab(cb: (tab: string) => void) {
  const handler = (e: Event) => {
    const tab = (e as CustomEvent).detail?.tab;
    if (typeof tab === "string" && /^[a-z]{3,20}$/.test(tab)) cb(tab);
  };
  window.addEventListener(LAB_TAB, handler);
  return () => window.removeEventListener(LAB_TAB, handler);
}
