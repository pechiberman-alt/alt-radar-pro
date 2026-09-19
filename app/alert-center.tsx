"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildMtfZones } from "@/lib/mtf-zones";
import { readFibZone } from "@/lib/fib-zone";
import { loadRows } from "@/lib/market-fetch";
import { parseSwingKlines } from "@/lib/swing-entries";
import {
  CATEGORY_COOLDOWN_MINUTES,
  fibAlert,
  zoneAlert,
  createDeliveryState,
  DEFAULT_ALERT_PREFERENCES,
  selectDeliverable,
  type Alert,
  type AlertCategory,
  type AlertPreferences,
  type AlertPriority,
} from "@/lib/alerts";

const CATEGORIES: { id: AlertCategory; label: string; hint: string }[] = [
  { id: "RIESGO", label: "RIESGO", hint: "El precio se acerca a donde te sacarían" },
  { id: "SEÑAL", label: "SEÑALES", hint: "Señales nuevas y objetivos cercanos" },
  { id: "ZONA", label: "ZONAS", hint: "Entrada en demanda, oferta o banda Fibonacci" },
  { id: "LIQUIDACIÓN", label: "LIQUIDACIÓN", hint: "Cercanía a una zona imán" },
  { id: "FLUJO", label: "FLUJO", hint: "Cambios de régimen institucional" },
];

const PRIORITIES: { id: AlertPriority; label: string; hint: string }[] = [
  { id: "CRITICA", label: "SOLO CRÍTICAS", hint: "Riesgo inminente y señales de alta convicción" },
  { id: "IMPORTANTE", label: "IMPORTANTES", hint: "Lo anterior más señales y zonas confirmadas" },
  { id: "INFORMATIVA", label: "TODO", hint: "Incluye contexto que no requiere acción" },
];

/**
 * The feed is kept in memory only. Persisting it would mean deciding how long
 * to keep alerts that describe conditions which have already passed, and a
 * stale alert read as current is worse than no history at all.
 */
/** Watched for zone and Fibonacci conditions. Kept short on purpose: each one
 *  costs three candle fetches, and monitoring thirty pairs would spend the
 *  reader's rate limit to produce alerts about pairs they do not trade. */
const WATCHED = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const FRAMES = ["4h", "1h", "15m"];

export default function AlertCenter({ pending = [] }: { pending?: Alert[] }) {
  const [detected, setDetected] = useState<Alert[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), 180_000);
    return () => clearInterval(id);
  }, []);

  // Evaluates the conditions the other panels display, so the alert centre
  // works even when those panels are collapsed — which is when an alert is
  // most useful.
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    (async () => {
      const found: Alert[] = [];
      for (const symbol of WATCHED) {
        try {
          const series: { timeframe: string; candles: ReturnType<typeof parseSwingKlines> }[] = [];
          for (const timeframe of FRAMES) {
            const rows = await loadRows(symbol, timeframe, 300, controller.signal);
            if (!alive) return;
            const candles = parseSwingKlines(rows);
            if (candles.length >= 40) series.push({ timeframe, candles });
          }
          if (!series.length) continue;

          const currentPrice = series[series.length - 1].candles.at(-1)!.close;
          const board = buildMtfZones(series, currentPrice);
          if (board?.standingIn) {
            found.push(
              zoneAlert(
                symbol,
                board.standingIn.kind,
                board.standingIn.low,
                board.standingIn.high,
                board.standingIn.confluence.length,
                board.standingIn.tests,
              ),
            );
          }

          const hourly = series.find((entry) => entry.timeframe === "1h");
          const fib = hourly ? readFibZone(hourly.candles) : null;
          if (fib?.inZone && fib.nearest) {
            found.push(fibAlert(symbol, fib.side, fib.nearest.ratio));
          }
        } catch {
          // One symbol failing must not silence the others.
        }
      }
      if (alive && found.length) setDetected(found);
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [tick]);

  const [prefs, setPrefs] = useState<AlertPreferences>(DEFAULT_ALERT_PREFERENCES);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() => {
    // Read during initialisation rather than in an effect: the value is
    // already available synchronously, and setting it from an effect just
    // causes a second render for something that never changed.
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
    return Notification.permission;
  });
  const [feed, setFeed] = useState<Alert[]>([]);
  const delivery = useRef(createDeliveryState());

  const askPermission = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setPermission(result);
    // Turning the switch on without the browser's consent would be a promise
    // the panel cannot keep, so it only enables when permission is granted.
    if (result === "granted") setPrefs((current) => ({ ...current, enabled: true }));
  }, []);

  const incoming = [...pending, ...detected];

  useEffect(() => {
    if (!incoming.length) return;

    // Queued as a microtask so the state update is not a synchronous set
    // during the effect's own commit.
    queueMicrotask(() => {
    // Everything reaches the feed; only what passes the rules is delivered.
    setFeed((current) => {
      const known = new Set(current.map((alert) => alert.id));
      const fresh = incoming.filter((alert) => !known.has(alert.id));
      return fresh.length ? [...fresh, ...current].slice(0, 40) : current;
    });

      if (permission !== "granted") return;
      const deliverable = selectDeliverable(incoming, prefs, delivery.current);
      for (const alert of deliverable) {
        new Notification(alert.title, { body: alert.body, tag: alert.id, icon: "/icon-192.png" });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, detected, prefs, permission]);

  const toggleCategory = (id: AlertCategory) =>
    setPrefs((current) => ({
      ...current,
      categories: { ...current.categories, [id]: !current.categories[id] },
    }));

  return (
    <section className="panel alerts-desk" id="alertas">
      <div className="panel-head">
        <div>
          <p className="eyebrow">ALERTAS · QUÉ MERECE INTERRUMPIRTE</p>
          <h2>Centro de avisos</h2>
        </div>
        <span className={prefs.enabled && permission === "granted" ? "badge" : "badge critical"}>
          {permission === "unsupported"
            ? "NO SOPORTADO"
            : permission !== "granted"
              ? "SIN PERMISO"
              : prefs.enabled
                ? "ACTIVAS"
                : "PAUSADAS"}
        </span>
      </div>

      <p className="alerts-premise">
        Una alerta que llega siempre es una alerta que se silencia. Por eso cada aviso declara su
        prioridad, el mismo nivel no vuelve a sonar mientras el precio siga ahí, y cada categoría
        tiene un tiempo mínimo entre avisos. La selectividad es la función, no una limitación.
      </p>

      {permission === "unsupported" && (
        <div className="alerts-empty">
          <b>ESTE NAVEGADOR NO SOPORTA NOTIFICACIONES</b>
          <span>Los avisos siguen apareciendo abajo, en la lista.</span>
        </div>
      )}

      {permission !== "granted" && permission !== "unsupported" && (
        <button className="alerts-permission" onClick={askPermission}>
          ACTIVAR NOTIFICACIONES
          <em>El navegador va a pedirte permiso. Sin eso ninguna web puede avisarte.</em>
        </button>
      )}

      {permission === "granted" && (
        <>
          <label className="alerts-switch" htmlFor="alerts-enabled">
            <input
              id="alerts-enabled"
              type="checkbox"
              checked={prefs.enabled}
              onChange={() => setPrefs((c) => ({ ...c, enabled: !c.enabled }))}
            />
            <span>{prefs.enabled ? "Notificaciones activas" : "Notificaciones pausadas"}</span>
          </label>

          <h4 className="alerts-section">NIVEL MÍNIMO</h4>
          <div className="alerts-priorities">
            {PRIORITIES.map((option) => (
              <button
                key={option.id}
                className={prefs.minimumPriority === option.id ? "active" : ""}
                onClick={() => setPrefs((c) => ({ ...c, minimumPriority: option.id }))}
              >
                <b>{option.label}</b>
                <em>{option.hint}</em>
              </button>
            ))}
          </div>

          <h4 className="alerts-section">CATEGORÍAS</h4>
          <div className="alerts-categories">
            {CATEGORIES.map((category) => (
              <label
                key={category.id}
                className={prefs.categories[category.id] ? "on" : ""}
                htmlFor={`alert-cat-${category.id}`}
              >
                <input
                  id={`alert-cat-${category.id}`}
                  type="checkbox"
                  // The visible text sits in nested elements, which assistive
                  // tech does not reliably associate; naming the control
                  // directly is what actually makes it announce correctly.
                  aria-label={`${category.label}: ${category.hint}`}
                  checked={prefs.categories[category.id]}
                  onChange={() => toggleCategory(category.id)}
                />
                <div>
                  <b>{category.label}</b>
                  <em>{category.hint}</em>
                  <small>mínimo {CATEGORY_COOLDOWN_MINUTES[category.id]} min entre avisos</small>
                </div>
              </label>
            ))}
          </div>
        </>
      )}

      <h4 className="alerts-section">ÚLTIMOS AVISOS</h4>
      {feed.length === 0 ? (
        <p className="alerts-none">
          Todavía no hay avisos en esta sesión. Aparecen acá aunque las notificaciones estén
          pausadas.
        </p>
      ) : (
        <div className="alerts-feed">
          {feed.map((alert) => (
            <div key={alert.id} className={`p-${alert.priority.toLowerCase()}`}>
              <div className="alerts-meta">
                <b>{alert.category}</b>
                <em>{new Date(alert.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</em>
              </div>
              <div className="alerts-body">
                <b>{alert.title}</b>
                <span>{alert.body}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
