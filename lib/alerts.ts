/**
 * One alert engine for every panel.
 *
 * WHY UNIFY INSTEAD OF ADDING A THIRD NOTIFIER
 *
 * Signals already notified on their own and target proximity notified on its
 * own. A third independent notifier would mean three components each deciding
 * for itself what deserves to interrupt someone, with no shared idea of
 * priority and no shared memory of what was already sent. That is how a
 * useful alert becomes a muted one.
 *
 * THE RULE THIS ENCODES
 *
 * An alert that always arrives is an alert nobody reads. So selectivity is
 * the feature, not a limitation:
 *
 *   - Every alert declares a PRIORITY, and the reader picks a floor. Below
 *     it, the alert still appears in the panel's own feed but never becomes
 *     a notification.
 *   - Every alert carries a stable id built from what it is about, so the
 *     same condition persisting does not re-fire on every refresh. Price
 *     hovering at a level would otherwise notify forever.
 *   - Categories have a cooldown. A market moving fast can satisfy the same
 *     kind of condition repeatedly, and the second one within the window
 *     adds nothing the first did not already say.
 */

export type AlertPriority = "CRITICA" | "IMPORTANTE" | "INFORMATIVA";
export type AlertCategory = "SEÑAL" | "RIESGO" | "ZONA" | "LIQUIDACIÓN" | "FLUJO";

/**
 * Evidence attached to an alert.
 *
 * Deliberately not called a probability. `rate` is the share of comparable
 * cases that resolved in favour IN THE DATA THE PANEL MEASURED, and `sample`
 * is how many cases that was. The two always travel together: a rate without
 * its sample invites reading 100% over two cases as certainty, which is the
 * easiest way for a tool like this to mislead someone.
 */
export type AlertEvidence = {
  /** 0–1 share of comparable cases that held. */
  rate: number | null;
  /** How many resolved cases the rate is computed from. */
  sample: number;
  /** Timeframes the condition was confirmed on. */
  timeframes: string[];
};

export type Alert = {
  /** Stable across refreshes for the same underlying condition. */
  id: string;
  priority: AlertPriority;
  category: AlertCategory;
  symbol: string;
  title: string;
  body: string;
  at: number;
  evidence?: AlertEvidence;
};

/** Phrasing for a rate, honest about what a thin sample can support. */
export function describeEvidence(evidence: AlertEvidence | undefined): string | null {
  if (!evidence) return null;
  const frames = evidence.timeframes.length ? evidence.timeframes.join(" · ") : null;

  if (evidence.rate === null || evidence.sample === 0) {
    return frames ? `${frames} · sin casos resueltos todavía` : "sin casos resueltos todavía";
  }

  const pct = `${Math.round(evidence.rate * 100)}%`;
  const base = `${pct} en ${evidence.sample} ${evidence.sample === 1 ? "caso" : "casos"}`;
  // Under this, the number is arithmetic, not evidence — say so rather than
  // let a reader treat it as a track record.
  const qualified = evidence.sample < 8 ? `${base} (muestra mínima)` : base;
  return frames ? `${frames} · ${qualified}` : qualified;
}

const PRIORITY_RANK: Record<AlertPriority, number> = {
  CRITICA: 3,
  IMPORTANTE: 2,
  INFORMATIVA: 1,
};

/** Minutes before the same category may notify again. Risk is shortest
 *  because it is the one worth repeating; flow is longest because it
 *  describes a regime that does not change by the minute. */
export const CATEGORY_COOLDOWN_MINUTES: Record<AlertCategory, number> = {
  RIESGO: 5,
  SEÑAL: 10,
  ZONA: 20,
  LIQUIDACIÓN: 20,
  FLUJO: 120,
};

export type AlertPreferences = {
  enabled: boolean;
  minimumPriority: AlertPriority;
  categories: Record<AlertCategory, boolean>;
};

export const DEFAULT_ALERT_PREFERENCES: AlertPreferences = {
  enabled: false,
  // Default floor is IMPORTANTE: the informative tier is worth having in the
  // feed but is not worth a phone buzzing.
  minimumPriority: "IMPORTANTE",
  categories: {
    SEÑAL: true,
    RIESGO: true,
    ZONA: true,
    LIQUIDACIÓN: true,
    FLUJO: false,
  },
};

export type DeliveryState = {
  /** Alert ids already delivered. */
  sent: Set<string>;
  /** Category → timestamp of last delivery. */
  lastByCategory: Map<AlertCategory, number>;
};

export function createDeliveryState(): DeliveryState {
  return { sent: new Set(), lastByCategory: new Map() };
}

/**
 * Decides which of a batch may be delivered now, in priority order.
 *
 * Returns the alerts to send and mutates the state, so a caller cannot
 * accidentally send the same thing twice by evaluating twice.
 */
export function selectDeliverable(
  alerts: Alert[],
  preferences: AlertPreferences,
  state: DeliveryState,
  now = Date.now(),
): Alert[] {
  if (!preferences.enabled) return [];

  const floor = PRIORITY_RANK[preferences.minimumPriority];
  const deliverable: Alert[] = [];

  // Highest priority first, so if a cooldown lets only one through, it is the
  // one that mattered most rather than whichever was evaluated first.
  const ordered = [...alerts].sort(
    (a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || a.at - b.at,
  );

  for (const alert of ordered) {
    if (PRIORITY_RANK[alert.priority] < floor) continue;
    if (!preferences.categories[alert.category]) continue;
    if (state.sent.has(alert.id)) continue;

    const last = state.lastByCategory.get(alert.category);
    const cooldownMs = CATEGORY_COOLDOWN_MINUTES[alert.category] * 60_000;
    // A critical alert overrides its category cooldown: the point of the
    // tier is that it is worth interrupting for.
    if (last !== undefined && now - last < cooldownMs && alert.priority !== "CRITICA") continue;

    deliverable.push(alert);
    state.sent.add(alert.id);
    state.lastByCategory.set(alert.category, now);
  }

  return deliverable;
}

/* ── Builders: each encodes what makes that condition worth an alert ── */

export function signalAlert(
  symbol: string,
  side: string,
  score: number,
  signalId: string,
  timeframe = "",
  at = Date.now(),
): Alert {
  return {
    id: `signal-${signalId}`,
    // A trigger at high conviction is worth interrupting for; a routine
    // setup is not, and grading them the same would flatten the tier.
    priority: score >= 80 ? "CRITICA" : "IMPORTANTE",
    category: "SEÑAL",
    symbol,
    title: `${symbol} · señal ${side}`,
    body: `Convicción ${score}%. Abrí el historial para ver objetivo y riesgo.`,
    at,
    evidence: { rate: score / 100, sample: 0, timeframes: [timeframe] },
  };
}

export function riskAlert(
  symbol: string,
  price: number,
  distancePct: number,
  signalId: string,
  at = Date.now(),
): Alert {
  return {
    // Keyed by level, not by time: the same level approaching again is the
    // same news until price leaves it.
    id: `risk-${signalId}-${price}`,
    priority: "CRITICA",
    category: "RIESGO",
    symbol,
    title: `${symbol} · riesgo cerca`,
    body: `A ${distancePct.toFixed(2)}% de la zona de riesgo en ${price}. Ahí es donde un barrido buscaría estos stops.`,
    at,
  };
}

export function targetAlert(
  symbol: string,
  price: number,
  distancePct: number,
  signalId: string,
  at = Date.now(),
): Alert {
  return {
    id: `target-${signalId}-${price}`,
    priority: "IMPORTANTE",
    category: "SEÑAL",
    symbol,
    title: `${symbol} · objetivo cerca`,
    body: `A ${distancePct.toFixed(2)}% del objetivo en ${price}.`,
    at,
  };
}

export function zoneAlert(
  symbol: string,
  kind: string,
  low: number,
  high: number,
  timeframes: string[],
  tests: number,
  evidence: { rate: number | null; sample: number },
  at = Date.now(),
): Alert {
  const confluence = timeframes.length;
  const detail = describeEvidence({ ...evidence, timeframes });
  return {
    id: `zone-${symbol}-${kind}-${low}`,
    // Two timeframes agreeing, or a zone that already held a test, is a
    // different level from a fresh one seen on a single chart.
    priority: confluence > 1 || tests > 0 ? "IMPORTANTE" : "INFORMATIVA",
    category: "ZONA",
    symbol,
    title: `${symbol} · entró en zona de ${kind.toLowerCase()}`,
    body: `Rango ${low}–${high}. ${tests > 0 ? `Aguantó ${tests} ${tests === 1 ? "test" : "tests"}.` : "Sin testear."}${detail ? ` Zonas de este tipo: ${detail}.` : ""}`,
    at,
    evidence: { ...evidence, timeframes },
  };
}

export function fibAlert(
  symbol: string,
  side: string,
  nearestRatio: number,
  timeframe: string,
  retracementPct: number,
  at = Date.now(),
): Alert {
  return {
    id: `fib-${symbol}-${side}-${nearestRatio}`,
    priority: "IMPORTANTE",
    category: "ZONA",
    symbol,
    title: `${symbol} · zona ${side === "LONG" ? "de compra" : "de venta"} Fibonacci`,
    body: `Retroceso ${retracementPct.toFixed(1)}% del tramo, cerca del ${nearestRatio}. Marco ${timeframe}.`,
    at,
    // No rate here on purpose: the Fibonacci backtest measures level
    // performance over a different sample than this live reading, and pairing
    // them would imply a link the data does not support.
    evidence: { rate: null, sample: 0, timeframes: [timeframe] },
  };
}

export function liquidationAlert(
  symbol: string,
  price: number,
  notionalUsd: number | null,
  at = Date.now(),
): Alert {
  return {
    id: `liq-${symbol}-${price}`,
    priority: "IMPORTANTE",
    category: "LIQUIDACIÓN",
    symbol,
    title: `${symbol} · zona imán cerca`,
    body: `Acumulación de liquidaciones en ${price}${notionalUsd ? ` (~${(notionalUsd / 1e6).toFixed(0)}M estimados)` : ""}.`,
    at,
  };
}

export function flowAlert(
  leader: string,
  laggard: string | null,
  at = Date.now(),
): Alert {
  return {
    // One per day per pairing: a regime does not change hourly, and alerting
    // as if it did would teach the reader to ignore the category.
    id: `flow-${leader}-${laggard ?? "none"}-${new Date(at).toISOString().slice(0, 10)}`,
    priority: "INFORMATIVA",
    category: "FLUJO",
    symbol: leader,
    title: "Flujo institucional",
    body: laggard
      ? `El dinero institucional entró a ${leader} y salió de ${laggard} esta semana.`
      : `${leader} lidera las entradas institucionales de la semana.`,
    at,
  };
}
