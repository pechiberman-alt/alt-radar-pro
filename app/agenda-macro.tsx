"use client";

import { useEffect, useMemo, useState } from "react";
import {
  activeBlackout, calendarBlackouts, DEFAULT_NEWS_GUARD, loadCalendar, upcomingEvents,
  type CalendarLoad, type MacroEvent,
} from "@/lib/econ-calendar";

type Mode = "usd-alto" | "usd-medio" | "todas-alto";
const MODES: { id: Mode; label: string }[] = [
  { id: "usd-alto", label: "USD · ALTO" },
  { id: "usd-medio", label: "USD · ALTO + MEDIO" },
  { id: "todas-alto", label: "TODAS LAS MONEDAS · ALTO" },
];

const when = (ms: number) =>
  new Date(ms).toLocaleString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function countdown(ms: number, now: number) {
  const min = Math.round((ms - now) / 60_000);
  const abs = Math.abs(min);
  const text = abs >= 60 ? `${Math.floor(abs / 60)} h ${abs % 60} min` : `${abs} min`;
  return min >= 0 ? `en ${text}` : `hace ${text}`;
}

/**
 * The scheduled releases that actually move markets (Forex Factory's calendar),
 * with how long until each — and whether the bot is standing aside for it.
 * Loaded once and refreshed rarely: the feed rate-limits.
 */
export default function AgendaMacro() {
  const [calendar, setCalendar] = useState<CalendarLoad | undefined>(undefined); // undefined = loading, null = unavailable
  const [now, setNow] = useState(0);
  const [mode, setMode] = useState<Mode>("usd-alto");

  useEffect(() => {
    let alive = true;
    (async () => {
      const result = await loadCalendar();
      if (alive) {
        setCalendar(result);
        setNow(Date.now());
      }
    })();
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const events = useMemo<MacroEvent[]>(() => {
    if (!calendar || !now) return [];
    return upcomingEvents(calendar.events, now, {
      hours: 24 * 7,
      impacts: mode === "usd-medio" ? ["high", "medium"] : ["high"],
      currencies: mode === "todas-alto" ? undefined : ["USD"],
      limit: 10,
    });
  }, [calendar, now, mode]);
  const blackouts = useMemo(() => (calendar ? calendarBlackouts(calendar.events, DEFAULT_NEWS_GUARD) : []), [calendar]);
  const paused = now ? activeBlackout(blackouts, now) : null;

  return (
    <div className="agenda-macro">
      <div className="agenda-head">
        <div>
          <p className="eyebrow">AGENDA MACRO · FOREX FACTORY</p>
          <h3>Lo que mueve al mercado esta semana</h3>
        </div>
        <div className="agenda-modes">
          {MODES.map((m) => (
            <button key={m.id} className={mode === m.id ? "on" : ""} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {paused && (
        <p className="agenda-pause">
          🛑 EN ZONA DE NOTICIA · {paused.label}. El bot no abre operaciones nuevas hasta {new Date(paused.end).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}.
        </p>
      )}

      {calendar === undefined && <p className="agenda-none">Cargando el calendario…</p>}
      {calendar === null && (
        <p className="agenda-none warn">
          Calendario no disponible ahora. Sin él no se sabe qué noticias vienen: el bot no abre operaciones mientras tanto.
        </p>
      )}
      {calendar && !events.length && <p className="agenda-none">No hay eventos de este tipo en los próximos 7 días.</p>}

      <div className="agenda-list">
        {events.map((e) => {
          const inWindow = blackouts.some((b) => now >= b.start && now < b.end && b.label.endsWith(e.title));
          return (
            <div key={e.id} className={`agenda-item i-${e.impact}${inWindow ? " now" : ""}`}>
              <b className={`imp i-${e.impact}`}>{e.impact === "high" ? "ALTO" : "MEDIO"}</b>
              <strong>
                {e.currency} · {e.title}
              </strong>
              <span>
                {when(e.time)} · {countdown(e.time, now)}
              </span>
              <em>
                {e.forecast ? `pronóstico ${e.forecast}` : "sin pronóstico"}
                {e.previous ? ` · previo ${e.previous}` : ""}
              </em>
            </div>
          );
        })}
      </div>

      <small className="agenda-foot">
        Hora local de tu computadora. Fuente: Forex Factory (calendario semanal{calendar?.stale ? ", copia guardada" : ""}). Los eventos de alto
        impacto pueden mover el precio varios puntos en minutos y ensanchar el spread: por eso el bot no opera alrededor de ellos.
      </small>
    </div>
  );
}
