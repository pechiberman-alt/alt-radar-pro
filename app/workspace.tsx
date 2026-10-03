"use client";
import { onShowSection, openAccount, showSection } from "@/lib/account-events";
import { BUILD_ID } from "@/lib/build-info";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/**
 * Workspace layout.
 *
 * The terminal grew into a document 26 screens tall where everything was
 * always expanded, so finding anything meant scrolling past everything. A
 * professional desk shows what you are working on and keeps the rest one click
 * away, so each section can be collapsed and the choice is remembered.
 */

export type WorkspaceSection = {
  id: string;
  label: string;
  /** Shown collapsed by default when false. */
  primary: boolean;
  /** Which group this section's chip renders under in the workspace bar. */
  group: WorkspaceGroup;
};

export const WORKSPACE_GROUPS = [
  "EMPEZÁ ACÁ",
  "SEÑALES Y ENTRADAS",
  "ESTRUCTURA DE MERCADO",
  "FLUJO INSTITUCIONAL",
  "GESTIÓN Y HERRAMIENTAS",
] as const;
export type WorkspaceGroup = (typeof WORKSPACE_GROUPS)[number];

/**
 * Only three sections open by default: the ones that answer "what's going on
 * right now" without picking a symbol or a strategy first. Every other panel
 * is real work someone came here to do on purpose, so it waits one tap away
 * instead of loading — and, for the live ones, connecting — before anyone
 * asked for it. This is the rule the file's own comment above already
 * states; it had drifted to 16 of 23 open by default as panels were added
 * across sessions, each one seeming reasonable on its own.
 */
export const WORKSPACE_SECTIONS: WorkspaceSection[] = [
  // EMPEZÁ ACÁ — orientation. Open by default; everything else is not.
  { id: "resumen", label: "RESUMEN", primary: true, group: "EMPEZÁ ACÁ" },
  { id: "alertas", label: "ALERTAS", primary: true, group: "EMPEZÁ ACÁ" },
  { id: "noticias", label: "NOTICIAS", primary: false, group: "EMPEZÁ ACÁ" },
  { id: "inteligencia", label: "SEÑALES · ROBOT MM", primary: true, group: "EMPEZÁ ACÁ" },

  // SEÑALES Y ENTRADAS — strategies and entry detection.
  { id: "spot", label: "ESTRATEGIA SPOT", primary: false, group: "SEÑALES Y ENTRADAS" },
  { id: "swing", label: "SWING", primary: false, group: "SEÑALES Y ENTRADAS" },
  { id: "pumpeo", label: "PUMPEO", primary: false, group: "SEÑALES Y ENTRADAS" },
  { id: "presion", label: "PRESIÓN", primary: false, group: "SEÑALES Y ENTRADAS" },
  { id: "order-flow", label: "ORDER FLOW", primary: false, group: "SEÑALES Y ENTRADAS" },

  // ESTRUCTURA DE MERCADO — where price sits and why.
  { id: "liquidaciones", label: "LIQUIDACIONES", primary: false, group: "ESTRUCTURA DE MERCADO" },
  { id: "zonas", label: "ZONAS MTF", primary: false, group: "ESTRUCTURA DE MERCADO" },
  { id: "estructura", label: "DOMINANCIA", primary: false, group: "ESTRUCTURA DE MERCADO" },
  { id: "vigilancia", label: "CORRELACIONES", primary: false, group: "ESTRUCTURA DE MERCADO" },
  { id: "comparador", label: "COMPARAR", primary: false, group: "ESTRUCTURA DE MERCADO" },

  // FLUJO INSTITUCIONAL — what large money is doing.
  { id: "institucional", label: "INSTITUCIONAL", primary: false, group: "FLUJO INSTITUCIONAL" },
  { id: "reservas", label: "RESERVAS", primary: false, group: "FLUJO INSTITUCIONAL" },
  { id: "flujo-activos", label: "FLUJO POR ACTIVO", primary: false, group: "FLUJO INSTITUCIONAL" },
  { id: "ordenes-grandes", label: "ÓRDENES GRANDES", primary: false, group: "FLUJO INSTITUCIONAL" },
  { id: "desbloqueos", label: "OFERTA PENDIENTE", primary: false, group: "FLUJO INSTITUCIONAL" },

  // GESTIÓN Y HERRAMIENTAS — everything else useful.
  { id: "riesgo", label: "RIESGO", primary: false, group: "GESTIÓN Y HERRAMIENTAS" },
  { id: "asistente", label: "ANALISTA", primary: false, group: "GESTIÓN Y HERRAMIENTAS" },
  { id: "scanner", label: "ESCÁNER", primary: false, group: "GESTIÓN Y HERRAMIENTAS" },
  { id: "historial", label: "HISTORIAL", primary: false, group: "GESTIÓN Y HERRAMIENTAS" },
  { id: "instalar", label: "INSTALAR", primary: false, group: "GESTIÓN Y HERRAMIENTAS" },
  { id: "registro", label: "REGISTRO", primary: false, group: "GESTIÓN Y HERRAMIENTAS" },
  { id: "cartera", label: "MI CARTERA", primary: false, group: "GESTIÓN Y HERRAMIENTAS" },
  { id: "futuros", label: "MI CARTERA · FUTUROS", primary: false, group: "GESTIÓN Y HERRAMIENTAS" },
  { id: "bot", label: "BOT DE FUTUROS · PAPEL", primary: false, group: "SEÑALES Y ENTRADAS" },
  { id: "diario", label: "DIARIO · MI CUENTA REAL", primary: false, group: "GESTIÓN Y HERRAMIENTAS" },
  { id: "desacople", label: "SUBEN SOLAS · DESACOPLE DE BTC", primary: false, group: "SEÑALES Y ENTRADAS" },
  { id: "dca", label: "DCA", primary: false, group: "GESTIÓN Y HERRAMIENTAS" },
  { id: "configuracion", label: "CONFIGURACIÓN", primary: false, group: "GESTIÓN Y HERRAMIENTAS" },
];

/**
 * ESSENTIAL: what someone needs on day one — the market at a glance, the
 * robot's signals, the liquidity map, coins rising on their own, alerts, their
 * own journal and settings. The other panels are real tools, but a second
 * step: with 33 sections always listed, the first impression was a wall.
 * They live under AVANZADO, one tap away, and opening any of them from
 * elsewhere in the app turns AVANZADO on by itself.
 */
export const ESSENTIAL_IDS = new Set(["resumen", "inteligencia", "liquidaciones", "desacople", "alertas", "diario", "configuracion"]);
const ADVANCED_KEY = "alt-radar-pro:workspace:advanced:v1";
const ADVANCED_EVENT = "alt-radar:advanced";

function readAdvanced(): boolean {
  try {
    return window.localStorage.getItem(ADVANCED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAdvanced(on: boolean) {
  try {
    window.localStorage.setItem(ADVANCED_KEY, on ? "1" : "0");
  } catch {
    // remembered for this page only
  }
  window.dispatchEvent(new Event(ADVANCED_EVENT));
}

export function useAdvanced(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(ADVANCED_EVENT, cb);
      window.addEventListener("storage", cb);
      return () => {
        window.removeEventListener(ADVANCED_EVENT, cb);
        window.removeEventListener("storage", cb);
      };
    },
    readAdvanced,
    () => false,
  );
}

export const isVisibleSection = (id: string, advanced: boolean) => advanced || ESSENTIAL_IDS.has(id);

const STORAGE_KEY = "alt-radar-pro:workspace:v1";

function defaultState(): Record<string, boolean> {
  return Object.fromEntries(
    WORKSPACE_SECTIONS.map((section) => [section.id, section.primary]),
  );
}

export function useWorkspace() {
  const [open, setOpen] = useState<Record<string, boolean>>(defaultState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as Record<string, boolean>;
          setOpen({ ...defaultState(), ...parsed });
        }
      } catch {
        // A corrupt preference should not break the layout.
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(open));
  }, [hydrated, open]);

  const toggle = useCallback((id: string) => {
    setOpen((current) => ({ ...current, [id]: !current[id] }));
  }, []);

  const setAll = useCallback((value: boolean) => {
    setOpen(
      Object.fromEntries(WORKSPACE_SECTIONS.map((section) => [section.id, value])),
    );
  }, []);

  const reset = useCallback(() => setOpen(defaultState()), []);

  // "Go to" buttons elsewhere in the app open the section before scrolling.
  useEffect(
    () =>
      onShowSection((id) => {
        if (!ESSENTIAL_IDS.has(id)) setAdvanced(true);
        setOpen((current) => ({ ...current, [id]: true }));
      }),
    [],
  );

  return { open, toggle, setAll, reset };
}

/**
 * Wraps a section so it can be collapsed. The heading stays visible when
 * closed, so the workspace still reads as an index of what exists.
 */
export function Collapsible({
  id,
  label,
  open,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  open: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  const advanced = useAdvanced();
  if (!isVisibleSection(id, advanced)) return null;
  return (
    <div className={open ? "ws-section open" : "ws-section"} data-section={id}>
      <button
        className="ws-handle"
        onClick={() => onToggle(id)}
        aria-expanded={open}
        aria-controls={`ws-body-${id}`}
      >
        <i aria-hidden="true">{open ? "▾" : "▸"}</i>
        <span>{label}</span>
        {!open && <em>MOSTRAR</em>}
      </button>
      <div id={`ws-body-${id}`} className="ws-body" hidden={!open}>
        {children}
      </div>
    </div>
  );
}

/** Control bar listing every section grouped by what it's for, so nothing
 *  hidden is ever lost and a new visitor can tell what kind of panel each
 *  one is before opening it. */
export function WorkspaceBar({
  open,
  toggle,
  setAll,
  reset,
}: {
  open: Record<string, boolean>;
  toggle: (id: string) => void;
  setAll: (value: boolean) => void;
  reset: () => void;
}) {
  const advanced = useAdvanced();
  const shown = WORKSPACE_SECTIONS.filter((section) => isVisibleSection(section.id, advanced));
  const visible = shown.filter((section) => open[section.id]).length;
  const extra = WORKSPACE_SECTIONS.length - ESSENTIAL_IDS.size;

  return (
    <div className="workspace-bar">
      <div className="ws-title">
        <span>WORKSPACE</span>
        <b>{visible}/{shown.length} PANELES</b>
        <small className="ws-build" title="Versión de la app que estás usando">v {BUILD_ID}</small>
      </div>
      {WORKSPACE_GROUPS.map((group) => {
        const sections = shown.filter((section) => section.group === group);
        if (!sections.length) return null;
        return (
          <div className="ws-group" key={group}>
            <span className="ws-group-label">{group}</span>
            <div className="ws-chips">
              {sections.map((section) => (
                <button
                  key={section.id}
                  className={open[section.id] ? "on" : ""}
                  onClick={() => toggle(section.id)}
                  aria-pressed={open[section.id]}
                >
                  {section.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <div className="ws-actions">
        <button onClick={() => setAll(true)}>TODO</button>
        <button onClick={() => setAll(false)}>NADA</button>
        <button onClick={reset}>PREDET.</button>
        <button className={advanced ? "ws-advanced on" : "ws-advanced"} onClick={() => setAdvanced(!advanced)} aria-pressed={advanced}>
          {advanced ? "SOLO LO ESENCIAL" : `AVANZADO · ${extra} HERRAMIENTAS MÁS`}
        </button>
      </div>
    </div>
  );
}

const WELCOME_KEY = "alt-radar-pro:welcome-seen:v1";

/**
 * A one-line orientation hint for a first visit, dismissed once and
 * remembered — the same storage pattern the panel-open state already uses.
 *
 * Reducing which panels open by default (above) fixes the wall-of-data
 * problem, but a brand new visitor still lands on an unfamiliar layout with
 * no explanation of where to look first. This says it once, in one line, and
 * gets out of the way — it is not a guided tour, because a tour that has to
 * be dismissed on every screen becomes its own kind of clutter.
 */
export function WelcomeHint() {
  // Starts hidden on both server and first client render, matching what
  // useWorkspace does above and for the same reason: reading localStorage
  // directly in the initial render can disagree between the server's HTML
  // and the client's first paint, and that mismatch is a real bug, not a
  // theoretical one. The deferred effect below corrects it after hydration,
  // which React treats as a normal post-mount update rather than a mismatch.
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (window.localStorage.getItem(WELCOME_KEY) !== "1") setDismissed(false);
      } catch {
        setDismissed(false);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.localStorage.setItem(WELCOME_KEY, "1");
    } catch {
      // Nothing to do: worst case it shows again next visit.
    }
  }, []);

  if (dismissed) return null;

  return (
    <div className="ws-welcome">
      <div className="ws-steps">
        <b>PRIMEROS PASOS</b>
        <ol>
          <li>Abrí el <b>MAPA</b> y tocá <b>MODO SIMPLE</b>: deja lo esencial y te explica qué mirar.</li>
          <li>Mirá los <b>NIVELES</b>: el techo y el piso más cercanos, con estrellas según cuántas razones coinciden.</li>
          <li>Creá tu cuenta gratis y activá <b>alertas por Telegram</b> (por ejemplo <code>/alerta BTC 90000</code>).</li>
          <li>Arriesgá como máximo <b>1% por operación</b>, siempre con stop. Calculalo en DIARIO → CALCULADORA.</li>
        </ol>
        <span>
          <button className="ws-welcome-cta" onClick={() => showSection("liquidaciones")}>ABRIR EL MAPA</button>
          <button className="ws-welcome-cta" onClick={() => openAccount("register")}>CREAR CUENTA GRATIS</button>
        </span>
        <small>Es una herramienta de análisis, no de promesas: todo lo que muestra está medido. No es asesoramiento financiero.</small>
      </div>
      <button onClick={dismiss} aria-label="Cerrar">
        ×
      </button>
    </div>
  );
}
