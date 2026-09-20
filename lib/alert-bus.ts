import type { Alert } from "./alerts.ts";

/**
 * A tiny in-memory channel between whatever detects an alert and whatever
 * displays it.
 *
 * The alert centre finds conditions; the on-screen banners show them. They
 * sit in different parts of the tree, so without a channel the only options
 * are threading callbacks through every component in between or duplicating
 * the detection. Both are worse than twenty lines of subscribe/publish.
 *
 * Deliberately not persisted and not global state: an alert describes a
 * moment. Reloading the page should start clean rather than replay banners
 * for conditions that may no longer hold.
 */

type Listener = (alert: Alert) => void;

const listeners = new Set<Listener>();
/** Ids already published, so a condition that persists across refresh cycles
 *  does not raise the same banner repeatedly. */
const seen = new Set<string>();

export function subscribeToAlerts(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishAlert(alert: Alert): boolean {
  if (seen.has(alert.id)) return false;
  seen.add(alert.id);
  // Bounded: this runs for the life of the tab and an unbounded set would
  // grow with every level price visits.
  if (seen.size > 300) {
    const oldest = seen.values().next().value;
    if (oldest) seen.delete(oldest);
  }
  for (const listener of listeners) listener(alert);
  return true;
}

/** Exposed for tests; a tab never needs to forget on its own. */
export function resetAlertBus() {
  listeners.clear();
  seen.clear();
}
