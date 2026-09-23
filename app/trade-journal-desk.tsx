"use client";

import { useCallback, useEffect, useState } from "react";
import type { TradeEntry, TradeStats } from "@/lib/trade-journal";

const money = (value: number) => {
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);
  return `${sign}$${abs.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
};

const pct = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);

const today = () => new Date().toISOString().slice(0, 10);

type FormState = {
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: string;
  exitPrice: string;
  sizeUsd: string;
  openedAt: string;
  closedAt: string;
  note: string;
};

const emptyForm = (): FormState => ({
  symbol: "",
  side: "LONG",
  entryPrice: "",
  exitPrice: "",
  sizeUsd: "",
  openedAt: today(),
  closedAt: "",
  note: "",
});

export default function TradeJournalDesk() {
  const [authState, setAuthState] = useState<"loading" | "in" | "out">("loading");
  const [entries, setEntries] = useState<TradeEntry[]>([]);
  const [stats, setStats] = useState<TradeStats | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/journal", { cache: "no-store" });
      if (response.status === 401) {
        setAuthState("out");
        return;
      }
      if (!response.ok) {
        setError("NO SE PUDO LEER EL REGISTRO");
        return;
      }
      const body = (await response.json()) as { entries: TradeEntry[]; stats: TradeStats };
      setEntries(body.entries);
      setStats(body.stats);
      setAuthState("in");
      setError("");
    } catch {
      setError("NO SE PUDO LEER EL REGISTRO");
    }
  }, []);

  useEffect(() => {
    // Wrapped in its own async IIFE rather than calling `load` bare: the
    // effect's body needs to visibly resolve to a promise it doesn't return,
    // which is what the same pattern elsewhere in this app already does.
    (async () => {
      await load();
    })();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: form.symbol,
          side: form.side,
          entryPrice: Number(form.entryPrice),
          exitPrice: form.exitPrice ? Number(form.exitPrice) : null,
          sizeUsd: Number(form.sizeUsd),
          openedAt: form.openedAt,
          closedAt: form.closedAt || null,
          note: form.note,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "NO SE PUDO GUARDAR");
        return;
      }
      setForm(emptyForm());
      await load();
    } catch {
      setError("NO SE PUDO GUARDAR");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await fetch(`/api/journal?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    } catch {
      setError("NO SE PUDO BORRAR");
    }
  };

  return (
    <section className="panel journal-desk" id="registro">
      <div className="panel-head">
        <div>
          <p className="eyebrow">REGISTRO DE OPERACIONES · WIN RATE</p>
          <h2>Lo que realmente operaste</h2>
        </div>
        <span className={authState === "out" ? "badge critical" : "badge"}>
          {authState === "loading" ? "CARGANDO…" : authState === "out" ? "SIN SESIÓN" : `${entries.length} CARGADAS`}
        </span>
      </div>

      <p className="journal-premise">
        Esto es distinto del historial de SEÑALES: ahí se califican solas las que detectó el radar. Acá
        cargás vos las que realmente tomaste, hayan salido de una señal o no, y el win rate sale de eso.
        Nada de esto ejecuta ni toca tu cuenta — es un cuaderno, no un bot de trading.
      </p>

      {authState === "loading" && <p className="journal-loading">CARGANDO…</p>}

      {authState === "out" && (
        <div className="journal-empty">
          <b>SIN SESIÓN INICIADA</b>
          <span>
            El registro es personal, así que necesita cuenta — entrá con INGRESAR arriba y volvé acá.
          </span>
        </div>
      )}

      {authState === "in" && (
        <>
          {stats && (
            <div className="journal-stats">
              <div>
                <span>WIN RATE</span>
                <b>{pct(stats.winRate)}</b>
                <em>{stats.confidence.toLowerCase()}</em>
              </div>
              <div>
                <span>PROFIT FACTOR</span>
                <b>{stats.profitFactor !== null ? stats.profitFactor.toFixed(2) + "×" : "—"}</b>
                <em>
                  {stats.wins}G · {stats.losses}P{stats.breakeven ? ` · ${stats.breakeven}E` : ""}
                </em>
              </div>
              <div>
                <span>P&L TOTAL</span>
                <b className={stats.totalPnlUsd >= 0 ? "positive" : "negative"}>{money(stats.totalPnlUsd)}</b>
                <em>{stats.closedTrades} cerradas · {stats.openTrades} abiertas</em>
              </div>
              <div>
                <span>RACHA</span>
                <b>{stats.currentStreak.count || "—"}</b>
                <em>{stats.currentStreak.direction.toLowerCase()}</em>
              </div>
            </div>
          )}

          <form className="journal-form" onSubmit={submit}>
            <input
              placeholder="Símbolo (BTCUSDT)"
              value={form.symbol}
              onChange={(e) => setForm({ ...form, symbol: e.target.value })}
              required
            />
            <select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value as "LONG" | "SHORT" })}>
              <option value="LONG">LONG</option>
              <option value="SHORT">SHORT</option>
            </select>
            <input
              type="number"
              step="any"
              placeholder="Entrada"
              value={form.entryPrice}
              onChange={(e) => setForm({ ...form, entryPrice: e.target.value })}
              required
            />
            <input
              type="number"
              step="any"
              placeholder="Salida (si cerró)"
              value={form.exitPrice}
              onChange={(e) => setForm({ ...form, exitPrice: e.target.value })}
            />
            <input
              type="number"
              step="any"
              placeholder="Tamaño USD"
              value={form.sizeUsd}
              onChange={(e) => setForm({ ...form, sizeUsd: e.target.value })}
              required
            />
            <input
              type="date"
              value={form.openedAt}
              onChange={(e) => setForm({ ...form, openedAt: e.target.value })}
              required
            />
            <input
              type="date"
              placeholder="Cierre"
              value={form.closedAt}
              onChange={(e) => setForm({ ...form, closedAt: e.target.value })}
            />
            <input
              className="journal-note"
              placeholder="Nota (opcional)"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
            <button type="submit" disabled={saving}>
              {saving ? "GUARDANDO…" : "REGISTRAR"}
            </button>
          </form>

          {error && <p className="journal-error">{error}</p>}

          <div className="journal-list">
            {entries.map((entry) => (
              <div key={entry.id} className={entry.side === "LONG" ? "long" : "short"}>
                <b>{entry.symbol.replace("USDT", "")}</b>
                <span className="j-side">{entry.side}</span>
                <em>
                  {entry.entryPrice} → {entry.exitPrice ?? "abierta"}
                </em>
                <u>${entry.sizeUsd}</u>
                <small>{entry.openedAt.slice(0, 10)}</small>
                <button onClick={() => remove(entry.id)} aria-label="Borrar">
                  ×
                </button>
              </div>
            ))}
            {entries.length === 0 && <p className="journal-none">Todavía no cargaste ninguna operación.</p>}
          </div>
        </>
      )}
    </section>
  );
}
