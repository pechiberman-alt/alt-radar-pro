"use client";

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
};

export const WORKSPACE_SECTIONS: WorkspaceSection[] = [
  { id: "resumen", label: "RESUMEN", primary: true },
  { id: "inteligencia", label: "SEÑALES", primary: true },
  { id: "scalping", label: "SCALPING", primary: false },
  { id: "pumpeo", label: "PUMPEO", primary: true },
  { id: "liquidaciones", label: "LIQUIDACIONES", primary: true },
  { id: "institucional", label: "INSTITUCIONAL", primary: true },
  { id: "reservas", label: "RESERVAS", primary: true },
  { id: "swing", label: "SWING", primary: true },
  { id: "riesgo", label: "RIESGO", primary: true },
  { id: "asistente", label: "ANALISTA", primary: true },
  { id: "comparador", label: "COMPARAR", primary: false },
  { id: "estructura", label: "DOMINANCIA", primary: false },
  { id: "vigilancia", label: "CORRELACIONES", primary: false },
  { id: "order-flow", label: "ORDER FLOW", primary: true },
  { id: "scanner", label: "ESCÁNER", primary: false },
  { id: "historial", label: "HISTORIAL", primary: false },
  { id: "instalar", label: "INSTALAR", primary: false },
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

/** Control bar listing every section, so nothing hidden is ever lost. */
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
      </div>
      <div className="ws-chips">
        {WORKSPACE_SECTIONS.map((section) => (
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
      <div className="ws-actions">
        <button onClick={() => setAll(true)}>TODO</button>
        <button onClick={() => setAll(false)}>NADA</button>
        <button onClick={reset}>PREDET.</button>
      </div>
    </div>
  );
}
