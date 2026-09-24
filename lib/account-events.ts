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
