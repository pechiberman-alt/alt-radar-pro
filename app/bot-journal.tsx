"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  journalCsv, journalKey, journalSummary, mergeJournal, STATUS_LABEL, type JournalGroup, type JournalRow,
} from "@/lib/bot-journal";

const CHUNK = 100;

const stamp = (t: number) =>
  new Date(t).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
// For the spreadsheet: "dd/mm/aaaa hh:mm" with no comma, which Excel reads as a date.
const csvStamp = (t: number) => stamp(t).replace(",", "");
const monthKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
};
const usd = (v: number) => `${v < 0 ? "-" : v > 0 ? "+" : ""}$${Math.abs(v).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const px = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: v >= 100 ? 2 : v >= 1 ? 4 : 6 });
const pf = (v: number | null) => (v === null ? "—" : v === Infinity ? "∞" : v.toLocaleString("es-AR", { maximumFractionDigits: 2 }));
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

type Auth = { id: number } | null | undefined; // undefined while checking

/**
 * The bot's permanent record and its report.
 *
 * `localRows` is everything this browser has seen close (kept across resets).
 * For a logged-in person those rows are also written to the account, and the
 * account's own record — which may include trades from another computer — is
 * merged in. Writes are idempotent, so a trade sent twice is stored once.
 */
export default function BotJournal({ localRows, currentRun }: { localRows: JournalRow[]; currentRun: number | null }) {
  const [auth, setAuth] = useState<Auth>(undefined);
  const [serverRows, setServerRows] = useState<JournalRow[] | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [scope, setScope] = useState<"todo" | "actual">("todo");
  const sent = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await fetch("/api/auth/me", { cache: "no-store" });
        const body = me.ok ? ((await me.json()) as { user: { id: number } | null }) : { user: null };
        if (!alive) return;
        setAuth(body.user);
        if (!body.user) return;
        const r = await fetch("/api/bot/journal", { cache: "no-store" });
        if (!alive) return;
        if (!r.ok) {
          setSyncError("No se pudo leer el registro guardado en tu cuenta.");
          return;
        }
        const data = (await r.json()) as { rows: JournalRow[] };
        for (const row of data.rows) sent.current.add(journalKey(row));
        setServerRows(data.rows);
      } catch {
        if (alive) {
          setAuth((a) => (a === undefined ? null : a));
          setSyncError("Sin conexión con el servidor: el registro queda en este navegador por ahora.");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Push whatever closed here and the account doesn't have yet.
  useEffect(() => {
    if (!auth || serverRows === null) return;
    const pending = localRows.filter((row) => !sent.current.has(journalKey(row)));
    if (!pending.length) return;
    for (const row of pending) sent.current.add(journalKey(row)); // claimed, so a re-render can't send them twice
    let alive = true;
    (async () => {
      for (let i = 0; i < pending.length; i += CHUNK) {
        const chunk = pending.slice(i, i + CHUNK);
        try {
          const r = await fetch("/api/bot/journal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows: chunk }),
          });
          if (!r.ok) {
            const body = (await r.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? "No se pudo guardar en tu cuenta.");
          }
          if (alive) {
            setSyncError(null);
            setServerRows((rows) => mergeJournal(rows ?? [], chunk));
          }
        } catch (error) {
          // Released, so the next closed trade retries them.
          for (const row of pending.slice(i)) sent.current.delete(journalKey(row));
          if (alive) setSyncError(error instanceof Error ? error.message : "No se pudo guardar en tu cuenta.");
          return;
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [auth, serverRows, localRows]);

  const all = useMemo(() => mergeJournal(serverRows ?? [], localRows), [serverRows, localRows]);
  const rows = useMemo(
    () => (scope === "actual" && currentRun !== null ? all.filter((r) => r.runStartedAt === currentRun) : all),
    [all, scope, currentRun],
  );
  const summary = useMemo(() => journalSummary(rows, monthKey), [rows]);
  const runs = useMemo(() => new Set(all.map((r) => r.runStartedAt)).size, [all]);
  const unsaved = useMemo(() => {
    if (!auth || !serverRows) return 0;
    const stored = new Set(serverRows.map(journalKey));
    return localRows.filter((r) => !stored.has(journalKey(r))).length;
  }, [auth, serverRows, localRows]);

  const download = () => {
    const blob = new Blob([journalCsv(rows, csvStamp)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    a.href = url;
    a.download = `operaciones-bot-futuros-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const groupRows = (groups: JournalGroup[], label: (key: string) => string) =>
    groups.map((g) => (
      <tr key={g.key}>
        <td>{label(g.key)}</td>
        <td>{g.count}</td>
        <td>{pct(g.profitable, g.count)}</td>
        <td>{pf(g.profitFactor)}</td>
        <td className={g.net >= 0 ? "up" : "down"}>{usd(g.net)}</td>
      </tr>
    ));

  return (
    <div className="bot-journal">
      <div className="bj-head">
        <h3 className="bot-h">Registro e informe de operaciones</h3>
        <div className="bj-actions">
          {currentRun !== null && runs > 1 && (
            <select value={scope} onChange={(e) => setScope(e.target.value as "todo" | "actual")}>
              <option value="todo">Todo el historial ({runs} cuentas)</option>
              <option value="actual">Solo la cuenta actual</option>
            </select>
          )}
          <button onClick={download} disabled={!rows.length}>DESCARGAR PARA EXCEL (.CSV)</button>
        </div>
      </div>

      <p className={`bj-status ${syncError ? "warn" : ""}`}>
        {auth === undefined
          ? "Comprobando tu sesión…"
          : auth === null
            ? "Guardado solo en este navegador (sobrevive a «reiniciar cuenta», no a borrar los datos del navegador). Iniciá sesión para guardarlo en tu cuenta."
            : serverRows === null
              ? syncError ?? "Cargando el registro de tu cuenta…"
              : syncError ?? `✓ Guardado en tu cuenta · ${all.length} operaciones${unsaved ? ` · ${unsaved} subiendo…` : ""}`}
      </p>

      {!rows.length ? (
        <p className="bot-none">Todavía no hay operaciones cerradas para registrar.</p>
      ) : (
        <>
          <div className="bj-tiles">
            <div><small>OPERACIONES</small><b>{summary.count}</b><em>{summary.byStatus.win} objetivo · {summary.byStatus.loss} stop · {summary.byStatus.timeout + summary.byStatus.news} otras</em></div>
            <div><small>CON GANANCIA</small><b>{pct(summary.profitable, summary.count)}</b><em>{summary.profitable} de {summary.count}</em></div>
            <div><small>PROFIT FACTOR</small><b>{pf(summary.profitFactor)}</b><em>1,00 = equilibrio</em></div>
            <div><small>RESULTADO NETO</small><b className={summary.net >= 0 ? "up" : "down"}>{usd(summary.net)}</b><em>ya con comisiones</em></div>
            <div><small>COMISIONES</small><b>{usd(-summary.fees)}</b><em>pagadas</em></div>
            <div><small>MEJOR / PEOR</small><b className="bj-small">{summary.best ? usd(summary.best.pnl) : "—"} / {summary.worst ? usd(summary.worst.pnl) : "—"}</b><em>por operación</em></div>
          </div>
          {summary.count < 15 && (
            <p className="bot-sample thin">⚠ Con {summary.count} operaciones el porcentaje y el profit factor todavía se mueven mucho por azar.</p>
          )}

          <div className="bj-groups">
            <table>
              <thead><tr><th>Par</th><th>Ops</th><th>Con ganancia</th><th>PF</th><th>Neto</th></tr></thead>
              <tbody>{groupRows(summary.bySymbol, (k) => k.replace(/USDT$/, ""))}</tbody>
            </table>
            <table>
              <thead><tr><th>Mes</th><th>Ops</th><th>Con ganancia</th><th>PF</th><th>Neto</th></tr></thead>
              <tbody>{groupRows(summary.byMonth, monthLabel)}</tbody>
            </table>
          </div>

          <div className="bj-list">
            <table>
              <thead>
                <tr><th>Cierre</th><th>Par</th><th>Lado</th><th>Entrada → salida</th><th>Resultado</th><th>R</th><th>Motivo</th></tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((r) => (
                  <tr key={journalKey(r)} title={r.note ?? undefined}>
                    <td>{stamp(r.exitTime)}</td>
                    <td>{r.symbol.replace(/USDT$/, "")}{r.timeframe ? ` · ${r.timeframe}` : ""}</td>
                    <td className={r.side === "COMPRA" ? "up" : "down"}>{r.side} {r.leverage}x</td>
                    <td>{px(r.entry)} → {px(r.exit)}</td>
                    <td className={r.pnl >= 0 ? "up" : "down"}>{usd(r.pnl)}</td>
                    <td>{r.r >= 0 ? "+" : ""}{r.r.toLocaleString("es-AR", { maximumFractionDigits: 2 })}</td>
                    <td>{STATUS_LABEL[r.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <small className="bj-foot">
            Operaciones de la cuenta de papel del bot (dinero ficticio). Resultados ya descontadas comisiones y deslizamiento simulados; no incluye funding.
            No es asesoramiento financiero.
          </small>
        </>
      )}
    </div>
  );
}
