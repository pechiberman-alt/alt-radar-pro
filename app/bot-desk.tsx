"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  activeBlackout, calendarBlackouts, DEFAULT_NEWS_GUARD, headlineBlackouts, loadCalendar, upcomingEvents,
  type CalendarLoad, type HeadlineLike, type NewsGuardConfig,
} from "@/lib/econ-calendar";
import { loadRows, timeframeConfig } from "@/lib/market-fetch";
import {
  botStats, DEFAULT_BOT_CONFIG, newBotState, parseBotKlines, resumeBot, stepBot, type BotConfig, type BotState,
} from "@/lib/paper-bot";

const STORAGE = "alt-radar-bot-v1";
const POLL_MS = 15_000;
const CALENDAR_REFRESH_MS = 10 * 60_000;
const CALENDAR_RETRY_MS = 60_000;
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT", "AVAXUSDT", "SUIUSDT"];
const FRAMES = ["1m", "3m", "5m", "15m", "30m", "1h"];

type Saved = { config: BotConfig; guard: NewsGuardConfig; state: BotState | null };

function readSaved(): Saved | null {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE) ?? "null") as Saved | null;
    if (!raw?.config || (raw.state && raw.state.version !== 1)) return null;
    // Never resume "on" from a stale save: a closed tab means nothing ran.
    return { config: { ...DEFAULT_BOT_CONFIG, ...raw.config, enabled: false }, guard: { ...DEFAULT_NEWS_GUARD, ...raw.guard }, state: raw.state };
  } catch {
    return null;
  }
}

const usd = (v: number) => `${v < 0 ? "-" : v > 0 ? "+" : ""}$${Math.abs(v).toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
const px = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: v >= 100 ? 2 : v >= 1 ? 4 : 6 });
const pct = (v: number, d = 1) => `${v.toLocaleString("es-AR", { maximumFractionDigits: d })}%`;
const ago = (ms: number) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s}s` : `${Math.round(s / 60)} min`;
};

/** Reading localStorage during render would differ between server and client;
 *  this renders nothing until the browser has taken over. */
function useMounted() {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}

export default function BotDesk({ news }: { news: HeadlineLike[] }) {
  const mounted = useMounted();
  return mounted ? <BotInner news={news} /> : <section className="panel bot-desk" id="bot"><p className="bot-none">Cargando…</p></section>;
}

function BotInner({ news }: { news: HeadlineLike[] }) {
  const [saved] = useState(readSaved);
  const [config, setConfig] = useState<BotConfig>(() => saved?.config ?? DEFAULT_BOT_CONFIG);
  const [guard, setGuard] = useState<NewsGuardConfig>(() => saved?.guard ?? DEFAULT_NEWS_GUARD);
  const [state, setState] = useState<BotState | null>(() => saved?.state ?? null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<{ at: number; error: string | null } | null>(null);
  const [calendar, setCalendar] = useState<CalendarLoad | undefined>(undefined);
  const [now, setNow] = useState(0);

  // The polling loop outlives renders; it reads the latest values from refs.
  const configRef = useRef(config);
  const guardRef = useRef(guard);
  const stateRef = useRef(state);
  const newsRef = useRef(news);
  useEffect(() => {
    configRef.current = config;
    guardRef.current = guard;
    stateRef.current = state;
    newsRef.current = news;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify({ config, guard, state } satisfies Saved));
    } catch {
      // storage full or blocked: the bot still runs, it just won't survive a reload
    }
  }, [config, guard, state]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!config.enabled) return;
    const controller = new AbortController();
    let alive = true;
    let running = false;
    let cal: CalendarLoad = null;
    let calAt = 0;

    const tick = async () => {
      if (running) return;
      running = true;
      try {
        if (Date.now() - calAt > (cal ? CALENDAR_REFRESH_MS : CALENDAR_RETRY_MS)) {
          cal = await loadCalendar();
          calAt = Date.now();
          if (alive) setCalendar(cal);
        }
        const cfg = configRef.current;
        const blackouts = [
          ...(cal ? calendarBlackouts(cal.events, guardRef.current) : []),
          ...headlineBlackouts(newsRef.current),
        ];
        for (const symbol of cfg.symbols) {
          if (!alive) return;
          const rows = await loadRows(symbol, cfg.timeframe, 300, controller.signal);
          if (!alive || !rows || !stateRef.current) continue;
          const candles = parseBotKlines(rows);
          if (candles.length < 60) continue;
          const last = candles[candles.length - 1];
          setPrices((p) => ({ ...p, [symbol]: last.close }));
          // The last candle is still forming; only closed ones are ever acted on.
          const next = stepBot(stateRef.current, cfg, symbol, candles.slice(0, -1), { blackouts, calendarKnown: cal !== null });
          stateRef.current = next;
          setState(next);
        }
        if (alive) setStatus({ at: Date.now(), error: null });
      } catch (error) {
        if (alive && !controller.signal.aborted) setStatus({ at: Date.now(), error: error instanceof Error ? error.message : "Error de red" });
      } finally {
        running = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [config.enabled]);

  const toggle = () => {
    const t = Date.now();
    if (config.enabled) {
      setConfig({ ...config, enabled: false });
      return;
    }
    const base = state ? resumeBot(state, t) : newBotState(config, t);
    stateRef.current = base;
    setState(base);
    setConfig({ ...config, enabled: true });
  };
  const reset = () => {
    if (!window.confirm("¿Borrar la cuenta de papel y todo su historial? No se puede deshacer.")) return;
    stateRef.current = null;
    setState(null);
    setPrices({});
    setConfig({ ...config, enabled: false });
  };

  const stats = useMemo(() => (state ? botStats(state, config.startingEquity) : null), [state, config.startingEquity]);
  const blackouts = useMemo(
    () => [...(calendar ? calendarBlackouts(calendar.events, guard) : []), ...headlineBlackouts(news)],
    [calendar, guard, news],
  );
  const paused = now ? activeBlackout(blackouts, now) : null;
  const nextEvent = useMemo(() => {
    if (!calendar || !now) return null;
    return upcomingEvents(calendar.events, now, { impacts: guard.impacts, currencies: guard.currencies, hours: 24 * 7, limit: 1 })[0] ?? null;
  }, [calendar, now, guard]);

  const locked = Boolean(state?.trades.length) || config.enabled;
  const set = <K extends keyof BotConfig>(key: K, value: BotConfig[K]) => setConfig((c) => ({ ...c, [key]: value }));
  const num = (key: keyof BotConfig, min: number, max: number) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(event.target.value);
    if (Number.isFinite(v)) set(key, Math.min(max, Math.max(min, v)) as never);
  };
  const frameMin = timeframeConfig(config.timeframe).frameMs / 60_000;

  const open = state?.trades.filter((t) => t.status === "open") ?? [];
  const closed = state?.trades.filter((t) => t.status !== "open").slice(-25).reverse() ?? [];

  return (
    <section className="panel bot-desk" id="bot">
      <div className="panel-head">
        <div>
          <p className="eyebrow">BOT DE FUTUROS · CUENTA DE PAPEL</p>
          <h2>Cerebro que opera solo con dinero ficticio</h2>
        </div>
        <button className={`bot-switch ${config.enabled ? "on" : ""}`} onClick={toggle}>
          {config.enabled ? "● ENCENDIDO · APAGAR" : "ENCENDER BOT"}
        </button>
      </div>

      <p className="bot-notice">
        <b>Simulación.</b> Opera una cuenta ficticia de futuros con las señales del software y <b>no toca tu Binance</b>. Funciona solo mientras
        esta pestaña esté abierta; si la computadora se duerme, al volver recupera las velas que se perdió. No modela funding ni la
        profundidad del libro, así que operar en vivo rendiría algo peor. Nada de esto es asesoramiento financiero.
      </p>

      <div className="bot-status">
        <span className={config.enabled ? "ok" : ""}>{config.enabled ? "● CEREBRO ACTIVO" : "○ APAGADO"}</span>
        {status && <span>{status.error ? `⚠ ${status.error}` : `último chequeo hace ${ago(status.at)}`}</span>}
        {config.enabled && calendar === null && <span className="warn">⚠ CALENDARIO NO DISPONIBLE · no abre operaciones</span>}
        {nextEvent && <span>próxima noticia: {nextEvent.currency} {nextEvent.title} ({new Date(nextEvent.time).toLocaleString("es-AR", { weekday: "short", hour: "2-digit", minute: "2-digit" })})</span>}
        {paused && <span className="warn">🛑 EN PAUSA: {paused.label}</span>}
      </div>

      {stats && (
        <>
          <div className="bot-tiles">
            <div><small>CAPITAL</small><b>${px(stats.equity)}</b><em className={stats.returnPct >= 0 ? "up" : "down"}>{stats.returnPct >= 0 ? "+" : ""}{pct(stats.returnPct, 2)}</em></div>
            <div><small>WIN RATE</small><b>{stats.winRate === null ? "—" : pct(stats.winRate * 100, 0)}</b><em>{stats.closed} cerradas</em></div>
            <div><small>PROFIT FACTOR</small><b>{stats.profitFactor === null ? "—" : stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toLocaleString("es-AR", { maximumFractionDigits: 2 })}</b><em>1,00 = equilibrio</em></div>
            <div><small>EXPECTATIVA</small><b>{stats.expectancyR === null ? "—" : `${stats.expectancyR >= 0 ? "+" : ""}${stats.expectancyR.toLocaleString("es-AR", { maximumFractionDigits: 2 })}R`}</b><em>por operación</em></div>
            <div><small>CAÍDA MÁXIMA</small><b>{pct(stats.maxDrawdownPct, 1)}</b><em>desde el pico</em></div>
            <div><small>ABIERTAS</small><b>{stats.open}</b><em>de {config.maxOpen} máx.</em></div>
          </div>
          <p className={`bot-sample ${stats.confidence === "MUESTRA RAZONABLE" ? "" : "thin"}`}>
            {stats.confidence === "SIN MUESTRA"
              ? "Todavía no cerró ninguna operación."
              : stats.confidence === "MUESTRA MÍNIMA"
                ? `⚠ MUESTRA MÍNIMA (${stats.closed} operaciones): con tan pocas, el win rate y el profit factor cambian decenas de puntos por azar. No concluyas nada todavía.`
                : `Muestra razonable (${stats.closed} operaciones). Cerradas por noticia o tiempo: ${stats.other}.`}
            {state && ` Descartó por — flujo: ${state.skipped.flow} · noticias: ${state.skipped.news} · calendario: ${state.skipped.calendar} · capacidad: ${state.skipped.capacity} · pérdida diaria: ${state.skipped.halted} · liquidación: ${state.skipped.liquidation}.`}
          </p>
        </>
      )}

      <h3 className="bot-h">Configuración {locked && <small>(el capital, el marco y los símbolos se cambian al reiniciar la cuenta o con el bot apagado)</small>}</h3>
      <div className="bot-config">
        <label>Capital inicial (USDT)<input type="number" value={config.startingEquity} disabled={Boolean(state)} onChange={num("startingEquity", 10, 1_000_000)} /></label>
        <label>Riesgo por operación (%)<input type="number" step="0.1" value={config.riskPct} onChange={num("riskPct", 0.1, 10)} /></label>
        <label>Apalancamiento (x)<input type="number" value={config.leverage} onChange={num("leverage", 1, 50)} /></label>
        <label>Objetivo (R:R)<input type="number" step="0.1" value={config.rr} onChange={num("rr", 0.5, 5)} /></label>
        <label>Máx. posiciones<input type="number" value={config.maxOpen} onChange={num("maxOpen", 1, 10)} /></label>
        <label>Pérdida diaria máx. (%)<input type="number" step="0.5" value={config.dailyLossPct} onChange={num("dailyLossPct", 0.5, 50)} /></label>
        <label>Comisión por lado (%)<input type="number" step="0.01" value={config.feePct} onChange={num("feePct", 0, 1)} /></label>
        <label>Deslizamiento (%)<input type="number" step="0.01" value={config.slipPct} onChange={num("slipPct", 0, 1)} /></label>
        <label>Temporalidad
          <select value={config.timeframe} disabled={config.enabled} onChange={(e) => set("timeframe", e.target.value)}>
            {FRAMES.map((f) => <option key={f} value={f}>{timeframeConfig(f).label}</option>)}
          </select>
        </label>
      </div>
      <div className="bot-symbols">
        {SYMBOLS.map((s) => (
          <button key={s} disabled={config.enabled} className={config.symbols.includes(s) ? "on" : ""}
            onClick={() => set("symbols", config.symbols.includes(s) ? config.symbols.filter((x) => x !== s) : [...config.symbols, s])}>
            {s.replace("USDT", "")}
          </button>
        ))}
      </div>
      <div className="bot-checks">
        <label><input type="checkbox" checked={config.requireFlow} onChange={(e) => set("requireFlow", e.target.checked)} /> Exigir que el flujo agresivo acompañe la señal</label>
        <label><input type="checkbox" checked={config.requireCalendar} onChange={(e) => set("requireCalendar", e.target.checked)} /> No operar si no se pudo cargar el calendario (recomendado)</label>
      </div>

      <h3 className="bot-h">Noticias <small>el bot no opera alrededor de ellas</small></h3>
      <div className="bot-config">
        <label>Monedas que cuentan
          <select value={guard.currencies.join(",")} onChange={(e) => setGuard({ ...guard, currencies: e.target.value.split(",") })}>
            <option value="USD">Solo USD</option>
            <option value="USD,EUR,GBP">USD + EUR + GBP</option>
            <option value="USD,EUR,GBP,JPY,CNY">USD + EUR + GBP + JPY + CNY</option>
          </select>
        </label>
        <label>Impacto
          <select value={guard.impacts.join(",")} onChange={(e) => setGuard({ ...guard, impacts: e.target.value.split(",") as NewsGuardConfig["impacts"] })}>
            <option value="high">Solo alto</option>
            <option value="high,medium">Alto + medio</option>
          </select>
        </label>
        <label>No abrir desde (min antes)<input type="number" value={guard.blockBeforeMin} onChange={(e) => setGuard({ ...guard, blockBeforeMin: Math.max(0, Number(e.target.value) || 0) })} /></label>
        <label>Cerrar posiciones (min antes)<input type="number" value={guard.closeBeforeMin} onChange={(e) => setGuard({ ...guard, closeBeforeMin: Math.max(0, Number(e.target.value) || 0) })} /></label>
        <label>Retomar (min después)<input type="number" value={guard.blockAfterMin} onChange={(e) => setGuard({ ...guard, blockAfterMin: Math.max(0, Number(e.target.value) || 0) })} /></label>
      </div>
      {guard.closeBeforeMin < frameMin && (
        <p className="bot-warn">⚠ Con velas de {frameMin} min, cerrar solo {guard.closeBeforeMin} min antes puede no alcanzar: el bot mira una vez por vela. Subí el margen o usá una temporalidad menor.</p>
      )}

      <h3 className="bot-h">Posiciones abiertas</h3>
      {open.length ? (
        <div className="bot-table">
          {open.map((t) => {
            const p = prices[t.symbol];
            const pnl = p === undefined ? null : (p - t.entry) * t.qty * (t.side === "COMPRA" ? 1 : -1);
            return (
              <div key={t.id} className={t.side === "COMPRA" ? "up" : "down"}>
                <b>{t.symbol.replace("USDT", "")} · {t.side} {t.leverage}x</b>
                <span>entrada {px(t.entry)} · stop {px(t.stop)} · objetivo {px(t.target)} · liquidación {px(t.liqPrice)}</span>
                <em className={pnl === null ? "" : pnl >= 0 ? "up" : "down"}>{pnl === null ? "…" : `${usd(pnl)} (${(pnl / t.riskUsd >= 0 ? "+" : "")}${(pnl / t.riskUsd).toLocaleString("es-AR", { maximumFractionDigits: 2 })}R)`}</em>
              </div>
            );
          })}
        </div>
      ) : <p className="bot-none">Sin posiciones abiertas.</p>}

      <h3 className="bot-h">Últimas operaciones cerradas</h3>
      {closed.length ? (
        <div className="bot-table">
          {closed.map((t) => (
            <div key={t.id} className={(t.pnl ?? 0) >= 0 ? "up" : "down"}>
              <b>{t.symbol.replace("USDT", "")} · {t.side} · {t.status === "win" ? "OBJETIVO" : t.status === "loss" ? "STOP" : t.status === "news" ? "CERRADA POR NOTICIA" : "TIEMPO"}</b>
              <span>{px(t.entry)} → {px(t.exit ?? 0)}{t.note ? ` · ${t.note}` : ""} · {new Date(t.exitTime ?? 0).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              <em className={(t.pnl ?? 0) >= 0 ? "up" : "down"}>{usd(t.pnl ?? 0)} ({(t.r ?? 0) >= 0 ? "+" : ""}{(t.r ?? 0).toLocaleString("es-AR", { maximumFractionDigits: 2 })}R)</em>
            </div>
          ))}
        </div>
      ) : <p className="bot-none">Todavía no hay operaciones cerradas.</p>}

      {state && <button className="bot-reset" onClick={reset}>REINICIAR CUENTA DE PAPEL</button>}
    </section>
  );
}
