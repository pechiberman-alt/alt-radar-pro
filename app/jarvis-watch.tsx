"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { arNumber } from "@/lib/ai-numbers";
import type { DeskDecision } from "@/lib/jarvis-desk";
import { typedNumber } from "@/lib/jarvis-desk-run";
import { CENTER_VOLUME, DEFAULT_WATCH_PREFS, MAX_WATCHED, WATCH_KINDS, type WatchKind, type WatchPrefs } from "@/lib/jarvis-watch";
import { loadWatchPrefs, runWatch, saveWatchPrefs, setLiquidationTape, WATCH_EVENT, watchStatus } from "@/lib/jarvis-watch-run";
import { everyVisible } from "@/lib/visible-interval";

/**
 * Las alertas de la mesa: qué vigilar, en qué activos y con qué umbrales.
 * La vigilancia corre en el navegador con la app abierta; para avisos con la
 * app cerrada, las alertas de nivel van por Telegram.
 */

function subscribe(cb: () => void) {
  window.addEventListener(WATCH_EVENT, cb);
  return () => window.removeEventListener(WATCH_EVENT, cb);
}

// The server has no saved preferences: it renders the defaults, and the browser's take over after hydration.
const usePrefs = () => useSyncExternalStore(subscribe, loadWatchPrefs, () => DEFAULT_WATCH_PREFS);
const useStatus = () => useSyncExternalStore(subscribe, watchStatus, watchStatus);

/** Sin interfaz: corre la vigilancia mientras la app está abierta, aunque la sección esté cerrada. */
export function JarvisWatcher() {
  const prefs = usePrefs();
  const on = prefs.enabled;
  const tape = prefs.enabled && prefs.kinds.LIQUIDACIONES;
  useEffect(() => {
    if (!on) return;
    // First look after the app's own first loads, then every 5 minutes with the tab visible.
    const first = window.setTimeout(() => void runWatch().catch(() => null), 15_000);
    const stop = everyVisible(() => void runWatch().catch(() => null), 5 * 60_000);
    return () => {
      window.clearTimeout(first);
      stop();
    };
  }, [on]);
  useEffect(() => {
    if (!tape) {
      setLiquidationTape(false);
      return;
    }
    // The live tape only while someone can see it: a hidden tab gets throttled anyway.
    const sync = () => setLiquidationTape(!document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      setLiquidationTape(false);
    };
  }, [tape]);
  return null;
}

function Threshold({ label, value, suffix, accept, onCommit }: { label: string; value: number; suffix: string; accept: (v: number) => boolean; onCommit: (v: number) => void }) {
  // Argentine grouping ("1.000.000"): typedNumber reads it back the same way.
  const show = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: 3 });
  const [draft, setDraft] = useState(() => show(value));
  return (
    <label>
      {label}
      <span className="jt-unit">
        <input
          inputMode="decimal"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            const v = typedNumber(e.target.value);
            if (v !== null && accept(v)) onCommit(v);
          }}
          onBlur={() => setDraft(show(value))}
        />
        <i>{suffix}</i>
      </span>
    </label>
  );
}

const ago = (t: number | null) => {
  if (t === null) return "todavía no revisó";
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 1 ? "revisó recién" : `revisó hace ${m} min`;
};

export function WatchBlock({ d }: { d: DeskDecision | null }) {
  const prefs = usePrefs();
  const status = useStatus();
  const [add, setAdd] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const update = (patch: Partial<WatchPrefs>) => saveWatchPrefs({ ...prefs, ...patch });
  const toggleKind = (k: WatchKind) => update({ kinds: { ...prefs.kinds, [k]: !prefs.kinds[k] } });
  const coin = (s: string) => s.replace(/USDT$/, "");

  const telegram = async (target: number, label: string) => {
    if (!d) return;
    setBusy(label);
    const r = await fetch("/api/jarvis/alert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: d.symbol, target, reference: d.precio }) }).catch(() => null);
    const body = (await r?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(null);
    if (!r) setMsg({ ok: false, text: "Sin conexión con el servidor." });
    else if (r.ok) setMsg({ ok: true, text: `Listo: te aviso por Telegram si ${d.moneda} ${label}, aunque la app esté cerrada (lo reviso cada 5 minutos).` });
    else setMsg({ ok: false, text: body?.error ?? "No se pudo crear la alerta." });
  };

  const sup = d?.niveles.soportes[0] ?? null;
  const res = d?.niveles.resistencias[0] ?? null;
  return (
    <div className="jt-watch">
      <label className="jt-switch">
        <input type="checkbox" checked={prefs.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
        <span>{prefs.enabled ? "Vigilando" : "Vigilancia apagada"}</span>
        <small>{prefs.enabled ? `${ago(status.lastRun)} · cada 5 min con la app abierta${status.lastRun ? ` · ${status.lastAlerts} ${status.lastAlerts === 1 ? "alerta nueva" : "alertas nuevas"} en la última vuelta` : ""}` : "Prendela para que la mesa avise en estos activos."}</small>
      </label>

      <h3 className="jt-sub">Activos ({prefs.symbols.length} de {MAX_WATCHED})</h3>
      <div className="jt-quick" role="group" aria-label="Activos vigilados">
        {prefs.symbols.map((s) => (
          <button key={s} type="button" className="on" aria-label={`Dejar de vigilar ${coin(s)}`} onClick={() => update({ symbols: prefs.symbols.filter((x) => x !== s) })} disabled={prefs.symbols.length <= 1}>
            {coin(s)} ×
          </button>
        ))}
      </div>
      {prefs.symbols.length < MAX_WATCHED && (
        <form
          className="jt-search"
          onSubmit={(e) => {
            e.preventDefault();
            const sym = `${add.trim().toUpperCase().replace(/\/?USDT$/, "")}USDT`;
            if (/^[A-Z0-9]{2,20}USDT$/.test(sym) && !prefs.symbols.includes(sym)) update({ symbols: [...prefs.symbols, sym] });
            setAdd("");
          }}
        >
          <input value={add} onChange={(e) => setAdd(e.target.value)} aria-label="Agregar activo" placeholder="Agregar: XRP, DOGE…" autoCapitalize="characters" />
          <button type="submit">AGREGAR</button>
        </form>
      )}

      <h3 className="jt-sub">Qué avisar</h3>
      <div className="jt-kinds">
        {WATCH_KINDS.map((k) => (
          <label key={k.id} className="jt-kind">
            <input type="checkbox" checked={prefs.kinds[k.id]} onChange={() => toggleKind(k.id)} />
            <b>{k.label}</b>
            <small>{k.id === "VOLUMEN" && prefs.symbols.some((s) => CENTER_VOLUME.has(s)) ? `${k.hint}. BTC, ETH y SOL ya los avisa el centro de alertas.` : k.hint}</small>
          </label>
        ))}
      </div>

      <h3 className="jt-sub">Umbrales</h3>
      <div className="jt-settings">
        <Threshold label="Volumen" value={prefs.volumenX} suffix="× lo normal" accept={(v) => v >= 1.5 && v <= 20} onCommit={(v) => update({ volumenX: v })} />
        <Threshold label="Funding extremo" value={prefs.fundingPct} suffix="% cada 8 h" accept={(v) => v >= 0.01 && v <= 1} onCommit={(v) => update({ fundingPct: v })} />
        <Threshold label="Interés abierto" value={prefs.oiPct} suffix="% en 24 h" accept={(v) => v >= 2 && v <= 200} onCommit={(v) => update({ oiPct: v })} />
        <Threshold label="Liquidación grande" value={prefs.liquidacionUsd} suffix="USD" accept={(v) => v >= 50_000 && v <= 1e9} onCommit={(v) => update({ liquidacionUsd: v })} />
      </div>
      {prefs.enabled && prefs.kinds.LIQUIDACIONES && <p className="jt-note">Tape de liquidaciones: {status.tape}.</p>}
      {status.errors.length > 0 && <p className="jt-note jt-warn">Sin revisar: {status.errors.join(" · ")}.</p>}
      {prefs.enabled && (
        <button type="button" className="jt-mini" disabled={status.running} onClick={() => void runWatch()}>
          {status.running ? "REVISANDO…" : "REVISAR AHORA"}
        </button>
      )}

      {d && (sup || res) && (
        <>
          <h3 className="jt-sub">Con la app cerrada · Telegram 24/7</h3>
          <div className="jt-row">
            {res && (
              <button type="button" className="jt-mini" disabled={busy !== null} onClick={() => void telegram(res.precio, `rompe ${arNumber(res.precio)}`)}>
                🔔 SI ROMPE {arNumber(res.precio)}
              </button>
            )}
            {sup && (
              <button type="button" className="jt-mini" disabled={busy !== null} onClick={() => void telegram(sup.precio, `pierde ${arNumber(sup.precio)}`)}>
                🔔 SI PIERDE {arNumber(sup.precio)}
              </button>
            )}
          </div>
          {msg && <p className={msg.ok ? "jt-ok" : "jt-error"}>{msg.text}</p>}
        </>
      )}
      <p className="jt-note">
        Llegan como aviso en pantalla; para que suenen como notificación, activalas en ALERTAS (categoría JARVIS · MESA). Cada aviso sale una sola vez por vela o evento. Liquidaciones: reales de Binance, en vivo, solo con la app abierta. No es asesoramiento financiero.
      </p>
    </div>
  );
}
