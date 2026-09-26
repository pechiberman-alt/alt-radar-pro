"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { subscribeToAlerts } from "@/lib/alert-bus";
import type { Alert } from "@/lib/alerts";

/**
 * On-screen alert banners.
 *
 * How long each stays is decided by priority rather than by one global
 * timer: a risk warning that vanishes before it is read defeats the point,
 * while a piece of context lingering on screen becomes clutter. Critical
 * banners do not dismiss themselves at all — they wait to be acknowledged.
 */
const DISMISS_MS: Record<Alert["priority"], number | null> = {
  CRITICA: null,
  IMPORTANTE: 12_000,
  INFORMATIVA: 7_000,
};

/** More than this on screen and they stop being readable; the oldest go. */
const MAX_VISIBLE = 3;

export default function AlertToasts() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(t);
  }, []);
  const [toasts, setToasts] = useState<Alert[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToAlerts((alert) => {
      setToasts((current) => [alert, ...current].slice(0, MAX_VISIBLE));

      const timeout = DISMISS_MS[alert.priority];
      if (timeout !== null) {
        setTimeout(() => dismiss(alert.id), timeout);
      }
    });
    return unsubscribe;
  }, [dismiss]);

  if (!toasts.length) return null;

  // Rendered into <body>: mounted inside the header, whose backdrop-filter
  // makes it the containing block for fixed children, the banners were
  // positioned against the header and appeared on top of it.
  if (!mounted) return null;
  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast p-${toast.priority.toLowerCase()}`}>
          <div className="toast-head">
            <b>{toast.category}</b>
            <button onClick={() => dismiss(toast.id)} aria-label="Cerrar aviso">
              ×
            </button>
          </div>
          <b className="toast-title">{toast.title}</b>
          <span>{toast.body}</span>
          {toast.evidence?.timeframes.length ? (
            <small>
              {toast.evidence.timeframes.join(" · ")}
              {toast.evidence.rate !== null && toast.evidence.sample > 0
                ? ` · ${Math.round(toast.evidence.rate * 100)}% en ${toast.evidence.sample} casos`
                : ""}
            </small>
          ) : null}
        </div>
      ))}
    </div>,
    document.body,
  );
}
