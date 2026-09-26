"use client";
import { onShowSection, openAccount } from "@/lib/account-events";
import { BUILD_ID } from "@/lib/build-info";

import { useCallback, useEffect, useState } from "react";

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
  { id: "noticias", label: "NOTICIAS", primary: true, group: "EMPEZÁ ACÁ" },
  { id: "inteligencia", label: "SEÑALES", primary: true, group: "EMPEZÁ ACÁ" },

  // SEÑALES Y ENTRADAS — strategies and entry detection.
  { id: "spot", label: "ESTRATEGIA SPOT", primary: false, group: "SEÑALES Y ENTRADAS" },
  { id: "swing", label: "SWING", primary: false, group: "SEÑALES Y ENTRADAS" },
  { id: "scalping", label: "SCALPING", primary: false, group: "SEÑALES Y ENTRADAS" },
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
  { id: "dca", label: "DCA", primary: false, group: "GESTIÓN Y HERRAMIENTAS" },
  { id: "configuracion", label: "CONFIGURACIÓN", primary: false, group: "GESTIÓN Y HERRAMIENTAS" },
];

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
  useEffect(() => onShowSection((id) => setOpen((current) => ({ ...current, [id]: true }))), []);

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
  const visible = WORKSPACE_SECTIONS.filter((section) => open[section.id]).length;

  return (
    <div className="workspace-bar">
      <div className="ws-title">
        <span>WORKSPACE</span>
        <b>{visible}/{WORKSPACE_SECTIONS.length} PANELES</b>
        <small className="ws-build" title="Versión de la app que estás usando">v {BUILD_ID}</small>
      </div>
      {WORKSPACE_GROUPS.map((group) => {
        const sections = WORKSPACE_SECTIONS.filter((section) => section.group === group);
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
      <span>
        Para empezar: <b>RESUMEN</b> te da el pulso del mercado y <b>ALERTAS</b> lo que necesita tu
        atención ahora. Con una cuenta gratis activás alertas por Telegram, registro, DCA e IA.
        <button className="ws-welcome-cta" onClick={() => openAccount("register")}>CREAR CUENTA GRATIS</button>
      </span>
      <button onClick={dismiss} aria-label="Cerrar">
        ×
      </button>
    </div>
  );
}
