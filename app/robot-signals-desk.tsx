"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { openInMap, showSection } from "@/lib/account-events";
import { buildLiquidationLives } from "@/lib/liquidation-columns";
import { loadRows, timeframeConfig } from "@/lib/market-fetch";
import { liveRobotTrade, MM_WIDE_KEY, MM_WIDE_TTL, type WideSummary } from "@/lib/robot-signals";
import { parseSwingKlines } from "@/lib/swing-entries";

type Live = { symbol: string; timeframe: string; side: "LONG" | "SHORT"; entry: number; stop: number; target: number; time: number; ago: number; telegram: string };

const fmt = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: v >= 100 ? 2 : v >= 1 ? 4 : 6 });
const pct = (a: number, b: number) => `${b >= a ? "+" : ""}${(((b - a) / a) * 100).toFixed(2).replace(".", ",")}%`;

function readStudies(): Record<string, WideSummary> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(MM_WIDE_KEY) ?? "null") as Record<string, WideSummary> | null;
    if (!raw || typeof raw !== "object") return {};
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => v && Date.now() - v.at < MM_WIDE_TTL));
  } catch {
    return {};
  }
}

function useMounted() {
  return useSyncExternalStore(() => () => undefined, () => true, () => false);
}

export default function RobotSignalsDesk() {
  const mounted = useMounted();
  return mounted ? <Inner /> : <section className="panel rs-desk" id="robot-senales"><p className="bot-none">Cargando…</p></section>;
}

function Inner() {
  const [studies, setStudies] = useState<Record<string, WideSummary>>({});
  const [signals, setSignals] = useState<Live[]>([]);
  const [status, setStatus] = useState<string>("");
  const [scanAt, setScanAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  // Studies are saved by the map's ROBOT MM card; re-read when it announces one.
  useEffect(() => {
    const load = () => setStudies(readStudies());
    const t = window.setTimeout(load, 0);
    window.addEventListener("alt-radar:mm-wide", load);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("alt-radar:mm-wide", load);
    };
  }, []);

  const approved = Object.values(studies).filter((s) => s.best);

  useEffect(() => {
    if (!approved.length) return;
    const controller = new AbortController();
    let alive = true;
    (async () => {
      setStatus("Escaneando…");
      const found: Live[] = [];
      for (const study of approved) {
        const best = study.best!;
        const frameMs = timeframeConfig(study.timeframe).frameMs;
        for (const { symbol } of study.perCoin) {
          if (!alive) return;
          try {
            const now = Date.now();
            const candles = parseSwingKlines(await loadRows(symbol, study.timeframe, 500, controller.signal)).filter((c) => c.openTime + frameMs <= now);
            const live = liveRobotTrade(candles, buildLiquidationLives(symbol, candles, { samples: 2 }), best.filter);
            if (live) {
              const e = live.event;
              const signal = { symbol, timeframe: study.timeframe, side: e.side, entry: e.entry, stop: e.stop, target: live.target, time: e.time, variant: best.name, validation: { trades: best.outSample.resolved, profitFactor: best.outSample.profitFactor, positive: best.breadth.positive, tested: best.breadth.tested } };
              let telegram = "";
              try {
                const r = await fetch("/api/robot/signal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(signal), signal: controller.signal });
                const j = (await r.json().catch(() => ({}))) as { sent?: boolean; reason?: string; error?: string };
                telegram = j.sent ? "enviada a Telegram" : j.reason ?? j.error ?? "";
              } catch {
                telegram = "";
              }
              found.push({ symbol, timeframe: study.timeframe, side: e.side, entry: e.entry, stop: e.stop, target: live.target, time: e.time, ago: candles.length - 1 - e.index, telegram });
            }
          } catch {
            // a coin that can't be read this round is skipped
          }
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      if (!alive) return;
      setSignals(found);
      setScanAt(Date.now());
      setStatus("");
    })();
    // Every 5 minutes while the tab is visible.
    const timer = window.setInterval(() => {
      if (!document.hidden) setTick((n) => n + 1);
    }, 300_000);
    return () => {
      alive = false;
      controller.abort();
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rescan when the approved set or the tick changes
  }, [JSON.stringify(approved.map((s) => [s.timeframe, s.at])), tick]);

  return (
    <section className="panel rs-desk" id="robot-senales">
      <div className="panel-head">
        <div>
          <p className="eyebrow">SEÑALES · ROBOT MM</p>
          <h2>Señales del robot del mapa de liquidez</h2>
        </div>
        <span className="badge">{approved.length ? `${approved.length} ${approved.length === 1 ? "estrategia aprobada" : "estrategias aprobadas"}` : "SIN ESTRATEGIA APROBADA"}</span>
      </div>

      <div className="rs-frames">
        {Object.values(studies).length ? (
          Object.values(studies).map((s) => (
            <span key={s.timeframe} className={s.best ? "up" : "warn"}>
              {s.timeframe.toUpperCase()} · {s.best ? `✓ ${s.best.name}` : "ninguna aprobada"}
            </span>
          ))
        ) : (
          <span className="warn">Todavía no hay estudios.</span>
        )}
      </div>

      {!approved.length ? (
        <div className="rs-empty">
          <p>
            Las señales salen solo de estrategias que el robot <b>aprobó</b>: que ganaron en el estudio, en la validación (la parte de la historia que no
            usó para elegir) y en al menos la mitad de 12 monedas. Ahora no hay ninguna, así que no hay señales — y eso es a propósito.
          </p>
          <p>
            Para estudiar: abrí el MAPA, elegí una temporalidad (15M, 1H…) y en la tarjeta ROBOT MM tocá <b>ESTUDIAR 12 MONEDAS</b>. Si aprueba algo, las
            señales aparecen acá y en Telegram.
          </p>
          <button className="lv-csv" onClick={() => showSection("liquidaciones")}>IR AL MAPA</button>
        </div>
      ) : (
        <>
          {signals.length ? (
            <div className="rs-list">
              {signals.map((s) => (
                <div key={`${s.symbol}-${s.timeframe}-${s.time}`} className={s.side === "LONG" ? "up" : "down"}>
                  <button className="dc-coin" onClick={() => openInMap(s.symbol)} title="Abrir en el MAPA">
                    {s.symbol.replace(/USDT$/, "")} ↗
                  </button>
                  <b>{s.side === "LONG" ? "🟢 LONG" : "🔴 SHORT"} · {s.timeframe.toUpperCase()}</b>
                  <span>
                    entrada {fmt(s.entry)} · SL {fmt(s.stop)} ({pct(s.entry, s.stop)}) · TP {fmt(s.target)} ({pct(s.entry, s.target)} · {(Math.abs(s.target - s.entry) / Math.abs(s.entry - s.stop)).toFixed(1).replace(".", ",")}R)
                  </span>
                  <em>
                    {s.ago === 0 ? "en la última vela" : `hace ${s.ago} vela`}
                    {s.telegram ? ` · ${s.telegram}` : ""}
                  </em>
                </div>
              ))}
            </div>
          ) : (
            <p className="bot-none">{status || "Sin señales ahora: ninguna de las monedas estudiadas barrió liquidez en la última vela con la estrategia aprobada."}</p>
          )}
          <p className="rs-meta">
            {scanAt ? `Último escaneo ${new Date(scanAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} · ` : ""}
            se repite cada 5 minutos con esta pestaña visible.{" "}
            <button className="lv-csv" onClick={() => setTick((n) => n + 1)}>ESCANEAR AHORA</button>
          </p>
        </>
      )}

      <small className="dc-foot">
        El motor de confluencia y el modo scalping están apagados: venían perdiendo en la medición. Las señales se calculan en este navegador y se
        mandan a Telegram mientras la app está abierta (una sola vez cada una). Son del robot en papel: no son órdenes ni asesoramiento financiero.
      </small>
    </section>
  );
}
