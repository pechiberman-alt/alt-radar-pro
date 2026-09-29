"use client";

import { useEffect, useMemo, useState } from "react";
import { onSession } from "@/lib/account-events";
import { futuresLogCsv, futuresLogSummary, logKey, mergeFuturesLog, type FuturesLogGroup, type FuturesLogRow } from "@/lib/futures-log";
import { RECORDER_ROWS_EVENT, RECORDER_STATUS_EVENT, recorderStatus, type RecorderStatus } from "./futures-recorder";

const stamp = (t: number) =>
  new Date(t).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
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
const qty = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: 8 });
const pf = (v: number | null) => (v === null ? "—" : v === Infinity ? "∞" : v.toLocaleString("es-AR", { maximumFractionDigits: 2 }));
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");
const LIST_LIMIT = 300;

const STATE_TEXT: Record<RecorderStatus["state"], string> = {
  apagado: "Grabador detenido.",
  "sin-sesion": "Iniciá sesión para grabar tus operaciones reales.",
  "sin-vincular": "Vinculá tu cuenta de Binance para grabar tus operaciones de futuros.",
  conectando: "Conectando con el canal privado de tu cuenta de Binance…",
  grabando: "● GRABANDO tus operaciones reales de futuros",
  reintentando: "Reconectando con Binance…",
  "sin-permiso": "Tu API key no tiene permiso de Futuros, así que Binance no envía tus operaciones.",
};

/** The report of the person's real futures activity, as recorded by FuturesRecorder. */
export default function FuturesLogReport() {
  const [rows, setRows] = useState<FuturesLogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<RecorderStatus>(recorderStatus);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const onStatus = (e: Event) => setStatus((e as CustomEvent<RecorderStatus>).detail);
    const onRows = (e: Event) => setRows((prev) => mergeFuturesLog(prev ?? [], (e as CustomEvent<FuturesLogRow[]>).detail));
    window.addEventListener(RECORDER_STATUS_EVENT, onStatus);
    window.addEventListener(RECORDER_ROWS_EVENT, onRows);
    const off = onSession(() => setReload((n) => n + 1));
    return () => {
      window.removeEventListener(RECORDER_STATUS_EVENT, onStatus);
      window.removeEventListener(RECORDER_ROWS_EVENT, onRows);
      off();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/binance/futures-log", { cache: "no-store" });
        if (!alive) return;
        if (r.status === 401) {
          setRows([]);
          setError(null);
          return;
        }
        if (!r.ok) throw new Error();
        const body = (await r.json()) as { rows: FuturesLogRow[] };
        if (alive) {
          setRows((prev) => mergeFuturesLog(body.rows, prev ?? []));
          setError(null);
        }
      } catch {
        if (alive) setError("No se pudo leer el registro guardado.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [reload]);

  const summary = useMemo(() => futuresLogSummary(rows ?? [], monthKey), [rows]);
  const recent = useMemo(() => [...(rows ?? [])].reverse().slice(0, LIST_LIMIT), [rows]);

  const download = () => {
    if (!rows?.length) return;
    const blob = new Blob([futuresLogCsv(rows, csvStamp)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    a.href = url;
    a.download = `binance-futuros-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const groupRows = (groups: FuturesLogGroup[], label: (key: string) => string) =>
    groups.map((g) => (
      <tr key={g.key}>
        <td>{label(g.key)}</td>
        <td>{g.fills}</td>
        <td>{pct(g.winners, g.closes)}</td>
        <td className={g.realized >= 0 ? "up" : "down"}>{usd(g.realized)}</td>
        <td>{usd(-g.fees)}</td>
        <td className={g.net >= 0 ? "up" : "down"}>{usd(g.net)}</td>
      </tr>
    ));

  const since = status.since ? new Date(status.since).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : null;
  const otherFees = Object.entries(summary.otherFees);

  return (
    <div className="bot-journal fl-report">
      <div className="bj-head">
        <h3 className="bot-h">Registro de mis operaciones reales</h3>
        <div className="bj-actions">
          <button onClick={download} disabled={!rows?.length}>DESCARGAR PARA EXCEL (.CSV)</button>
        </div>
      </div>

      <p className={`bj-status ${status.state === "grabando" ? "" : "warn"}`}>
        {STATE_TEXT[status.state]}
        {status.state === "grabando" && since ? ` desde las ${since} · ${status.captured} capturadas en esta sesión` : ""}
        {status.message && status.state !== "grabando" ? ` ${status.message}` : ""}
      </p>
      <p className="fl-note">
        Graba cada ejecución (precio, cantidad, comisión, PnL realizado, liquidaciones) y cada pago de funding{" "}
        <b>mientras la app esté abierta en alguna pestaña</b>, aunque estés en otro panel. Lo que operes con la app
        cerrada no queda: Binance no entrega ese historial por la vía que el navegador puede usar. Para el historial
        anterior, Binance permite exportarlo desde su web (Órdenes → Futuros → Historial de operaciones).
      </p>
      {error && <p className="bj-status warn">{error}</p>}

      {rows === null ? (
        <p className="bot-none">Cargando el registro…</p>
      ) : !rows.length ? (
        <p className="bot-none">Todavía no hay operaciones grabadas.</p>
      ) : (
        <>
          <div className="bj-tiles">
            <div><small>EJECUCIONES</small><b>{summary.fills}</b><em>{summary.closes} con PnL realizado{summary.liquidations ? ` · ${summary.liquidations} liquidación${summary.liquidations > 1 ? "es" : ""}` : ""}</em></div>
            <div><small>CIERRES CON GANANCIA</small><b>{pct(summary.winners, summary.closes)}</b><em>{summary.winners} de {summary.closes}</em></div>
            <div><small>PROFIT FACTOR</small><b>{pf(summary.profitFactor)}</b><em>1,00 = equilibrio</em></div>
            <div><small>PNL REALIZADO</small><b className={summary.realized >= 0 ? "up" : "down"}>{usd(summary.realized)}</b><em>antes de comisiones</em></div>
            <div><small>COMISIONES · FUNDING</small><b className="bj-small">{usd(-summary.fees)} · {usd(summary.funding)}</b><em>{otherFees.length ? `+ ${otherFees.map(([a, v]) => `${qty(v)} ${a}`).join(", ")}` : "en USDT/USDC"}</em></div>
            <div><small>RESULTADO NETO</small><b className={summary.net >= 0 ? "up" : "down"}>{usd(summary.net)}</b><em>realizado − comisiones + funding</em></div>
          </div>

          <div className="bj-groups">
            <table>
              <thead><tr><th>Par</th><th>Ejec.</th><th>Cierres +</th><th>Realizado</th><th>Comis.</th><th>Neto</th></tr></thead>
              <tbody>{groupRows(summary.bySymbol, (k) => k.replace(/USDT$/, ""))}</tbody>
            </table>
            <table>
              <thead><tr><th>Mes</th><th>Ejec.</th><th>Cierres +</th><th>Realizado</th><th>Comis.</th><th>Neto</th></tr></thead>
              <tbody>{groupRows(summary.byMonth, monthLabel)}</tbody>
            </table>
          </div>

          <div className="bj-list">
            <table>
              <thead><tr><th>Fecha</th><th>Par</th><th>Lado</th><th>Precio × cantidad</th><th>PnL realizado</th><th>Comisión</th><th>Detalle</th></tr></thead>
              <tbody>
                {recent.map((r) =>
                  r.kind === "fill" ? (
                    <tr key={logKey(r)}>
                      <td>{stamp(r.time)}</td>
                      <td>{r.symbol.replace(/USDT$/, "")}</td>
                      <td className={r.side === "BUY" ? "up" : "down"}>{r.side === "BUY" ? "COMPRA" : "VENTA"}{r.positionSide !== "BOTH" ? ` · ${r.positionSide}` : ""}</td>
                      <td>{qty(r.price)} × {qty(r.qty)}</td>
                      <td className={r.realizedPnl > 0 ? "up" : r.realizedPnl < 0 ? "down" : ""}>{r.realizedPnl ? usd(r.realizedPnl) : "—"}</td>
                      <td>{qty(r.commission)} {r.commissionAsset}</td>
                      <td>{r.liquidation ? "⚠ LIQUIDACIÓN" : `${r.orderType}${r.maker ? " · maker" : ""}${r.reduceOnly ? " · reduce" : ""}`}</td>
                    </tr>
                  ) : (
                    <tr key={logKey(r)}>
                      <td>{stamp(r.time)}</td>
                      <td>{r.symbol ? r.symbol.replace(/USDT$/, "") : "—"}</td>
                      <td>FUNDING</td>
                      <td>—</td>
                      <td className={r.amount >= 0 ? "up" : "down"}>{qty(r.amount)} {r.asset}</td>
                      <td>—</td>
                      <td>Pago de funding</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
          <small className="bj-foot">
            {rows.length > LIST_LIMIT ? `La lista muestra los últimos ${LIST_LIMIT}; la descarga incluye todo (${rows.length}). ` : ""}
            Datos de tu cuenta tal como los envía Binance. Las comisiones en BNB u otros activos se muestran aparte, sin convertir. No es asesoramiento financiero.
          </small>
        </>
      )}
    </div>
  );
}
