"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { onSession } from "@/lib/account-events";
import {
  buildJournal, countable, fromFuturesLog, journalStats, mergeJFills, netOnDay, type JFill, type JTrade, type Market, type TradeNote,
} from "@/lib/account-journal";
import { mergeFuturesLog, type FuturesLogRow } from "@/lib/futures-log";
import { dailyLimit } from "@/lib/risk-calc";
import { CalculatorView, DataView } from "./diario-tools";
import { dayOf } from "./diario-format";
import { DEFAULT_SETTINGS, readSettings, SETTINGS_KEY, type Creds, type DiarioSettings } from "./diario-settings";
import { SummaryView, TradesView, type NoteMap } from "./diario-views";
import { RECORDER_ROWS_EVENT, RECORDER_STATUS_EVENT, recorderStatus, type RecorderStatus } from "./futures-recorder";
import SignInPrompt from "./sign-in-prompt";

type Tab = "resumen" | "operaciones" | "calculadora" | "datos";
const TABS: { id: Tab; label: string }[] = [
  { id: "resumen", label: "RESUMEN" },
  { id: "operaciones", label: "OPERACIONES" },
  { id: "calculadora", label: "CALCULADORA" },
  { id: "datos", label: "DATOS" },
];
const PERIODS = [{ id: "7", label: "7 DÍAS", days: 7 }, { id: "30", label: "30 DÍAS", days: 30 }, { id: "90", label: "90 DÍAS", days: 90 }, { id: "todo", label: "TODO", days: 0 }];
const RESULTS = [
  { id: "todas", label: "TODAS" }, { id: "ganadoras", label: "GANADORAS" }, { id: "perdedoras", label: "PERDEDORAS" },
  { id: "abiertas", label: "ABIERTAS" }, { id: "incompletas", label: "INCOMPLETAS" },
];

function useMounted() {
  return useSyncExternalStore(() => () => undefined, () => true, () => false);
}

export default function DiarioDesk() {
  const mounted = useMounted();
  return mounted ? <DiarioInner /> : <section className="panel diario-desk" id="diario"><p className="bot-none">Cargando…</p></section>;
}

function DiarioInner() {
  const [auth, setAuth] = useState<"loading" | "out" | "in">("loading");
  const [live, setLive] = useState<FuturesLogRow[]>([]);
  const [stored, setStored] = useState<JFill[]>([]);
  const [notes, setNotes] = useState<NoteMap>({});
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(0);
  const [tab, setTab] = useState<Tab>("resumen");
  const [market, setMarket] = useState<"todos" | Market>("todos");
  const [period, setPeriod] = useState("todo");
  const [symbol, setSymbol] = useState("todos");
  const [result, setResult] = useState("todas");
  const [settings, setSettings] = useState<DiarioSettings>(() => readSettings());
  const [recorder, setRecorder] = useState<RecorderStatus>(recorderStatus);
  const credsRef = useRef<Creds | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // not persisted
    }
  }, [settings]);
  const patchSettings = useCallback((patch: Partial<DiarioSettings>) => setSettings((s) => ({ ...s, ...patch })), []);

  useEffect(() => {
    const onStatus = (e: Event) => setRecorder((e as CustomEvent<RecorderStatus>).detail);
    const onRows = (e: Event) => setLive((prev) => mergeFuturesLog(prev, (e as CustomEvent<FuturesLogRow[]>).detail));
    window.addEventListener(RECORDER_STATUS_EVENT, onStatus);
    window.addEventListener(RECORDER_ROWS_EVENT, onRows);
    const off = onSession(() => {
      credsRef.current = null;
      setReload((n) => n + 1);
    });
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      window.removeEventListener(RECORDER_STATUS_EVENT, onStatus);
      window.removeEventListener(RECORDER_ROWS_EVENT, onRows);
      off();
      clearInterval(tick);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await fetch("/api/auth/me", { cache: "no-store" });
        const body = me.ok ? ((await me.json()) as { user: unknown }) : { user: null };
        if (!alive) return;
        if (!body.user) {
          setAuth("out");
          setNow(Date.now());
          return;
        }
        setAuth("in");
        const [a, b, c] = await Promise.all([
          fetch("/api/binance/futures-log", { cache: "no-store" }),
          fetch("/api/diario/fills", { cache: "no-store" }),
          fetch("/api/diario/notes", { cache: "no-store" }),
        ]);
        if (!alive) return;
        if (!a.ok || !b.ok || !c.ok) throw new Error("No se pudo leer todo tu diario. Recargá en unos segundos.");
        const [rows, fills, nts] = await Promise.all([a.json(), b.json(), c.json()]) as [{ rows: FuturesLogRow[] }, { fills: JFill[] }, { notes: NoteMap }];
        if (!alive) return;
        setLive((prev) => mergeFuturesLog(rows.rows, prev));
        setStored(fills.fills);
        setNotes(nts.notes);
        setError(null);
        setNow(Date.now());
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "No se pudo leer tu diario.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [reload]);

  const getCreds = useCallback(async (): Promise<Creds> => {
    if (credsRef.current) return credsRef.current;
    const r = await fetch("/api/binance/credentials", { cache: "no-store" });
    if (r.status === 401) throw new Error("Iniciá sesión.");
    if (r.status === 404) throw new Error("Primero vinculá tu cuenta de Binance (en tu cuenta → BINANCE).");
    if (!r.ok) throw new Error("No se pudieron leer las credenciales guardadas.");
    credsRef.current = (await r.json()) as Creds;
    return credsRef.current;
  }, []);

  const { fills, fundings } = useMemo(() => {
    const a = fromFuturesLog(live);
    return { fills: mergeJFills(a.fills, stored), fundings: a.fundings };
  }, [live, stored]);
  const build = useMemo(() => buildJournal(fills, fundings), [fills, fundings]);

  const filtered = useMemo(() => {
    const days = PERIODS.find((p) => p.id === period)?.days ?? 0;
    const cutoff = days && now ? now - days * 86_400_000 : 0;
    return build.trades.filter((t) => (market === "todos" || t.market === market) && (symbol === "todos" || t.symbol === symbol) && (t.closeTime ?? t.openTime) >= cutoff);
  }, [build.trades, market, symbol, period, now]);

  const stopOf = useCallback((key: string) => notes[key]?.stop ?? null, [notes]);
  const stats = useMemo(() => journalStats(filtered, stopOf), [filtered, stopOf]);
  const allStats = useMemo(() => journalStats(build.trades, stopOf), [build.trades, stopOf]);
  const symbols = useMemo(() => [...new Set(build.trades.map((t) => t.symbol))].sort(), [build.trades]);

  const listed = useMemo(() => {
    const pick = (t: JTrade) =>
      result === "todas" ? true
        : result === "abiertas" ? t.status === "abierta"
          : result === "incompletas" ? t.status === "incompleta"
            : t.status !== "abierta" && t.net !== null && (result === "ganadoras" ? t.net > 0 : t.net < 0);
    return filtered.filter(pick);
  }, [filtered, result]);

  const today = useMemo(() => (now ? netOnDay(build.trades, dayOf(now), dayOf) : 0), [build.trades, now]);
  const limit = settings.equity > 0 && settings.dailyLossPct > 0 ? dailyLimit(today, settings.equity, settings.dailyLossPct) : null;

  const saveNote = useCallback(async (key: string, note: TradeNote) => {
    const r = await fetch("/api/diario/notes", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, note }) });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "No se pudo guardar la nota.");
    }
    setNotes((n) => ({ ...n, [key]: note }));
  }, []);
  const onAdded = useCallback((added: JFill[]) => setStored((prev) => mergeJFills(prev, added)), []);

  const chip = (on: boolean, label: string, click: () => void) => <button key={label} className={on ? "on" : ""} onClick={click}>{label}</button>;
  const statusText = auth === "in" ? (error ?? (recorder.state === "grabando" ? "● GRABANDO EN VIVO" : "GRABADOR: " + recorder.state.toUpperCase())) : auth === "out" ? "SIN SESIÓN" : "CARGANDO…";

  return (
    <section className="panel diario-desk" id="diario">
      <div className="panel-head">
        <div>
          <p className="eyebrow">DIARIO · MI CUENTA REAL DE BINANCE</p>
          <h2>Diario de operaciones, riesgo y estadísticas</h2>
        </div>
        <span className={auth === "in" && !error ? "badge" : "badge critical"}>{statusText}</span>
      </div>

      {auth === "out" ? (
        <SignInPrompt why="El diario guarda tus operaciones reales en tu cuenta para que las tengas en cualquier compu." />
      ) : (
        <>
          <div className="dz-tabs" role="tablist">
            {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>{t.label}</button>)}
          </div>
          {error && <p className="bot-sample thin">⚠ {error}</p>}

          {(tab === "resumen" || tab === "operaciones") && (
            <div className="dz-filters">
              <div>{[["todos", "TODO"], ["futures", "FUTUROS"], ["spot", "SPOT"]].map(([id, l]) => chip(market === id, l, () => setMarket(id as "todos" | Market)))}</div>
              <div>{PERIODS.map((p) => chip(period === p.id, p.label, () => setPeriod(p.id)))}</div>
              <select value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Par">
                <option value="todos">Todos los pares</option>
                {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {tab === "operaciones" && <div>{RESULTS.map((r) => chip(result === r.id, r.label, () => setResult(r.id)))}</div>}
            </div>
          )}

          {tab === "resumen" && (
            <SummaryView
              stats={stats} trades={countable(filtered)} today={today} limit={limit}
              incomplete={filtered.filter((t) => t.status === "incompleta").length} openCount={filtered.filter((t) => t.status === "abierta").length}
              excluded={build.excludedSpot} unattributed={build.unattributedFunding}
            />
          )}
          {tab === "operaciones" && <TradesView trades={listed} notes={notes} onSave={saveNote} />}
          {tab === "calculadora" && (
            <CalculatorView s={settings} set={patchSettings} worstLossStreak={allStats.longestLoss} todayNet={today} getCreds={getCreds} />
          )}
          {tab === "datos" && (
            <DataView
              fills={fills} stored={stored} liveCount={live.filter((r) => r.kind === "fill").length} recorder={recorder}
              trades={build.trades} notes={notes} settings={settings} set={patchSettings} getCreds={getCreds} onAdded={onAdded}
            />
          )}
        </>
      )}
    </section>
  );
}

export { DEFAULT_SETTINGS };
