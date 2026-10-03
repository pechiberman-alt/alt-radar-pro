"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { openInMap } from "@/lib/account-events";
import { eligible } from "@/lib/decoupling";
import { loadRows, loadTopSymbols, timeframeConfig } from "@/lib/market-fetch";
import { preBreakKey, readPreBreak, type PreBreak } from "@/lib/pre-breakout";
import { parseSwingKlines } from "@/lib/swing-entries";
import { everyVisible } from "@/lib/visible-interval";

const FRAMES = ["15m", "1h", "4h"];
const UNIVERSE = 40;
type Row = { symbol: string; r: PreBreak; price: number; telegram: string };
const fmt = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: v >= 100 ? 2 : v >= 1 ? 4 : 6 });

function useMounted() {
  return useSyncExternalStore(() => () => undefined, () => true, () => false);
}

export default function PreBreakDesk() {
  const mounted = useMounted();
  return mounted ? <Inner /> : <section className="panel pb-desk" id="rompe"><p className="bot-none">Cargando…</p></section>;
}

function Inner() {
  const [tf, setTf] = useState("1h");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [progress, setProgress] = useState("Buscando monedas comprimidas…");
  const [tick, setTick] = useState(0);
  const [perm, setPerm] = useState<string>(() => (typeof Notification === "undefined" ? "unsupported" : Notification.permission));

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    (async () => {
      setRows(null);
      const ranked = (await loadTopSymbols(controller.signal).catch(() => null)) ?? [];
      const symbols = ["BTCUSDT", "ETHUSDT", ...ranked.filter(eligible).slice(0, UNIVERSE - 2)];
      const frameMs = timeframeConfig(tf).frameMs;
      const found: Row[] = [];
      for (const [k, symbol] of symbols.entries()) {
        if (!alive) return;
        if (k % 5 === 0) setProgress(`Leyendo ${k + 1} de ${symbols.length}…`);
        try {
          const now = Date.now();
          const candles = parseSwingKlines(await loadRows(symbol, tf, 200, controller.signal)).filter((c) => c.openTime + frameMs <= now);
          const r = readPreBreak(candles, symbol);
          if (r && r.state !== "QUIETO") found.push({ symbol, r, price: candles[candles.length - 1].close, telegram: "" });
        } catch {
          // a coin that can't be read is skipped this round
        }
      }
      found.sort((a, b) => b.r.score - a.r.score);
      // Alerts: once per coin, frame, direction and level per day (the server checks too).
      const sent = new Set<string>(JSON.parse(sessionStorage.getItem("alt-radar-pro:prebreak-sent") ?? "[]"));
      for (const row of found.filter((x) => x.r.state === "A PUNTO")) {
        const key = preBreakKey(row.symbol, tf, row.r) + ":" + new Date().toISOString().slice(0, 10);
        if (sent.has(key)) continue;
        sent.add(key);
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(`⚡ ${row.symbol.replace(/USDT$/, "")} a punto de romper (${tf})`, {
            body: `${row.r.side === "SIN DIRECCIÓN" ? "Sin dirección clara" : row.r.side === "ALCISTA" ? "Hacia arriba" : "Hacia abajo"} · presión ${row.r.score}/100${row.r.level ? ` · nivel ${fmt(row.r.level)}` : ""}`,
          });
        }
        try {
          const res = await fetch("/api/alerts/prebreak", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbol: row.symbol, timeframe: tf, side: row.r.side, score: row.r.score, level: row.r.level, touches: row.r.touches, distanceAtr: row.r.distanceAtr, price: row.price, reasons: row.r.reasons }),
            signal: controller.signal,
          });
          const j = (await res.json().catch(() => ({}))) as { sent?: boolean; reason?: string; error?: string };
          row.telegram = j.sent ? "enviada a Telegram" : j.reason ?? j.error ?? "";
        } catch {
          row.telegram = "";
        }
      }
      sessionStorage.setItem("alt-radar-pro:prebreak-sent", JSON.stringify([...sent].slice(-300)));
      if (alive) setRows(found);
    })();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [tf, tick]);

  useEffect(() => everyVisible(() => setTick((n) => n + 1), 300_000), []);

  return (
    <section className="panel pb-desk" id="rompe">
      <div className="panel-head">
        <div>
          <p className="eyebrow">A PUNTO DE ROMPER · AVISOS</p>
          <h2>Monedas comprimidas contra un nivel</h2>
        </div>
        <span className="badge">{rows ? `${rows.filter((x) => x.r.state === "A PUNTO").length} a punto · ${rows.length} armándose o más` : "ESCANEANDO"}</span>
      </div>
      <div className="dc-controls">
        {FRAMES.map((f) => (
          <button key={f} className={tf === f ? "on" : ""} onClick={() => setTf(f)} aria-pressed={tf === f}>{f.toUpperCase()}</button>
        ))}
        <button onClick={() => setTick((n) => n + 1)}>ESCANEAR AHORA</button>
        {perm !== "granted" && perm !== "unsupported" && (
          <button onClick={() => void Notification.requestPermission().then(setPerm)}>ACTIVAR AVISOS DEL NAVEGADOR</button>
        )}
      </div>
      {!rows ? (
        <p className="bot-none">{progress}</p>
      ) : rows.length ? (
        <div className="pb-list">
          {rows.map(({ symbol, r, telegram }) => (
            <div key={symbol} className={r.state === "A PUNTO" ? "hot" : ""}>
              <button className="dc-coin" onClick={() => openInMap(symbol)} title="Abrir en el MAPA">{symbol.replace(/USDT$/, "")} ↗</button>
              <b className={r.side === "ALCISTA" ? "up" : r.side === "BAJISTA" ? "down" : ""}>
                {r.state} · {r.side === "ALCISTA" ? "▲ arriba" : r.side === "BAJISTA" ? "▼ abajo" : "sin dirección"}
              </b>
              <span className="pb-bar" aria-label={`presión ${r.score} de 100`}><i style={{ width: `${r.score}%` }} />{r.score}</span>
              <span>
                {r.level !== null ? `nivel ${fmt(r.level)} · ${r.touches} toques · a ${(r.distanceAtr ?? 0).toFixed(1).replace(".", ",")} ATR · ` : ""}
                {r.reasons.join(" · ")}
              </span>
              {telegram && <em>{telegram}</em>}
            </div>
          ))}
        </div>
      ) : (
        <p className="bot-none">Ninguna moneda está comprimida contra un nivel en {tf.toUpperCase()} ahora.</p>
      )}
      <small className="dc-foot">
        «A punto» = compresión fuerte + precio a menos de 1 ATR de un nivel con 2 o más toques (+ mínimos crecientes contra un techo o máximos
        decrecientes contra un piso). Que esté comprimida dice que puede moverse fuerte; la dirección es la más probable, no segura. La medición de
        cada moneda está en el MAPA. Los avisos (navegador y Telegram, una vez por moneda y nivel por día) se calculan con la app abierta. No es
        asesoramiento financiero.
      </small>
    </section>
  );
}
