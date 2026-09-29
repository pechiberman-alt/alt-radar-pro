"use client";

import { useMemo, useState } from "react";
import {
  dropDuplicates, fromSpotApi, tradesCsv, type JFill, type JTrade, type Market, type TradeNote,
} from "@/lib/account-journal";
import { parseBinanceCsv, readSpotHistory, spotCandidates } from "@/lib/binance-import";
import { BinanceClientError, friendlyClientError, getAccountBalances, getFuturesAccountSummary, getMyTrades } from "@/lib/binance-client-signed";
import { dailyLimit, riskPlan, streakImpact } from "@/lib/risk-calc";
import { csvStamp, fileDate, money, num, px, qty, stamp, usd } from "./diario-format";
import type { Creds, DiarioSettings } from "./diario-settings";
import type { RecorderStatus } from "./futures-recorder";

const toNum = (s: string) => Number(s.trim().replace(",", "."));

export function CalculatorView({
  s, set, worstLossStreak, todayNet, getCreds,
}: {
  s: DiarioSettings; set: (patch: Partial<DiarioSettings>) => void; worstLossStreak: number; todayNet: number; getCreds: () => Promise<Creds>;
}) {
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [available, setAvailable] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const targets = useMemo(() => s.targets.split(/[,;\s]+/).map(toNum).filter((n) => Number.isFinite(n) && n > 0), [s.targets]);
  const plan = useMemo(
    () => riskPlan({ market: s.market, equity: s.equity, riskPct: s.riskPct, entry: toNum(entry), stop: toNum(stop), leverage: s.leverage, feePct: s.feePct, slipPct: s.slipPct, targetsR: targets, available }),
    [s, entry, stop, targets, available],
  );
  const limit = s.equity > 0 && s.dailyLossPct > 0 ? dailyLimit(todayNet, s.equity, s.dailyLossPct) : null;
  const streaks = useMemo(() => [...new Set([3, 5, 10, Math.max(1, worstLossStreak)])].sort((a, b) => a - b), [worstLossStreak]);
  const impact = useMemo(() => streakImpact([0.5, 1, 2, 3, 5, 10], streaks), [streaks]);

  const field = (label: string, value: string | number, onChange: (v: string) => void, hint?: string) => (
    <label>{label}<input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />{hint && <em>{hint}</em>}</label>
  );
  const numField = (label: string, key: keyof DiarioSettings, hint?: string) =>
    field(label, String(s[key]), (v) => { const n = toNum(v); if (v.trim() === "" || Number.isFinite(n)) set({ [key]: v.trim() === "" ? 0 : n } as Partial<DiarioSettings>); }, hint);

  const loadBalance = async () => {
    setBusy(true);
    setNote(null);
    try {
      const c = await getCreds();
      if (s.market === "futures") {
        const sum = await getFuturesAccountSummary(c.apiKey, c.apiSecret);
        const total = Number(sum.totalWalletBalance);
        const free = Number(sum.availableBalance);
        if (!Number.isFinite(total)) throw new Error("Binance no devolvió el saldo de futuros.");
        set({ equity: Math.round(total * 100) / 100 });
        setAvailable(Number.isFinite(free) ? free : null);
        setNote(`Saldo de futuros: ${money(total)} · disponible ${money(free)}.`);
      } else {
        const { balances } = await getAccountBalances(c.apiKey, c.apiSecret);
        const stable = balances.filter((b) => ["USDT", "USDC", "FDUSD", "BUSD"].includes(b.asset)).reduce((sum, b) => sum + Number(b.free), 0);
        set({ equity: Math.round(stable * 100) / 100 });
        setAvailable(null);
        setNote(`Dólares libres en spot: ${money(stable)} (no cuenta lo que tenés invertido en otras monedas).`);
      }
    } catch (error) {
      setNote(friendlyClientError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dz-calc">
      <div className="dz-card">
        <h4>Datos de la operación</h4>
        <div className="dz-form">
          <label>Mercado
            <select value={s.market} onChange={(e) => { set({ market: e.target.value as Market }); setAvailable(null); }}>
              <option value="futures">Futuros</option>
              <option value="spot">Spot</option>
            </select>
          </label>
          {numField("Saldo de la cuenta (USDT)", "equity")}
          {numField("Riesgo por operación (%)", "riskPct", "cuánto del saldo perdés si toca el stop")}
          {field("Precio de entrada", entry, setEntry)}
          {field("Precio del stop", stop, setStop, "debajo de la entrada = largo; encima = corto")}
          {s.market === "futures" && numField("Apalancamiento (x)", "leverage")}
          {numField("Comisión por lado (%)", "feePct")}
          {numField("Deslizamiento por lado (%)", "slipPct")}
          {field("Objetivos en R", s.targets, (v) => set({ targets: v }), "ej: 1, 2, 3")}
        </div>
        <button className="dz-btn" onClick={loadBalance} disabled={busy}>{busy ? "LEYENDO…" : "TRAER MI SALDO DE BINANCE"}</button>
        {note && <p className="dz-note">{note}</p>}
      </div>

      <div className="dz-card">
        <h4>Qué tamaño tomar</h4>
        {!plan.ok ? (
          <p className="bot-none">{entry.trim() === "" || stop.trim() === "" ? "Cargá la entrada y el stop para ver el tamaño." : plan.error}</p>
        ) : (
          <>
            <div className="bj-tiles dz-out">
              <div><small>TAMAÑO</small><b>{qty(Number(plan.qty.toPrecision(6)))}</b><em>{plan.side === "LONG" ? "largo" : "corto"} · valor {money(plan.notional)}</em></div>
              <div><small>{s.market === "futures" ? "MARGEN" : "INVERSIÓN"}</small><b>{money(plan.margin)}</b><em>{num((plan.margin / s.equity) * 100, 1)}% del saldo</em></div>
              <div><small>RIESGO SI TOCA EL STOP</small><b className="down">{money(plan.riskUsd)}</b><em>{num(plan.riskPct, 2)}% del saldo · con costos</em></div>
              <div><small>DISTANCIA AL STOP</small><b>{num(plan.stopDistancePct, 2)}%</b><em>del precio de entrada</em></div>
              {plan.liqPrice !== null && <div><small>LIQUIDACIÓN (ESTIMADA)</small><b>{px(plan.liqPrice)}</b><em>stop al {num((plan.stopToLiq as number) * 100, 0)}% del camino</em></div>}
              <div><small>BREAK-EVEN</small><b>{px(plan.breakeven)}</b><em>cubre comisiones y deslizamiento</em></div>
              <div><small>COMISIONES IDA Y VUELTA</small><b>{money(plan.feesRoundTrip)}</b><em>aprox.</em></div>
            </div>
            {plan.warnings.map((w) => <p key={w} className="bot-sample thin">⚠ {w}</p>)}
            <table className="dz-mini">
              <thead><tr><th>Objetivo</th><th>Precio</th><th>Ganancia neta</th><th>{s.market === "futures" ? "Sobre el margen" : "Sobre lo invertido"}</th></tr></thead>
              <tbody>
                {plan.targets.map((t) => (
                  <tr key={t.r}><td>{num(t.r, 2)}R</td><td>{px(t.price)}</td><td className={t.netUsd >= 0 ? "up" : "down"}>{usd(t.netUsd)}</td><td>{t.roiPct === null ? "—" : `${num(t.roiPct, 1)}%`}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="bj-foot">Cuenta pura sobre los números que cargaste: la liquidación usa una tasa de mantenimiento fija de 0,5% y la real de Binance depende del tamaño de la posición. No es una recomendación de operar.</p>
          </>
        )}
      </div>

      <div className="dz-card">
        <h4>Límite de pérdida diaria</h4>
        <div className="dz-form">{numField("Límite (% del saldo)", "dailyLossPct", "0 para no usarlo")}</div>
        {limit ? (
          <p className={`dz-today ${limit.breached ? "warn" : ""}`}>
            Hoy: {usd(todayNet)}. Límite {money(limit.limitUsd)} · usaste {money(limit.used)} · te quedan {money(limit.remaining)}.
            {limit.breached ? " 🛑 Llegaste al límite: cortar el día es la regla que te pusiste." : ""}
          </p>
        ) : <p className="bot-none">Sin límite activo.</p>}
      </div>

      <div className="dz-card dz-wide">
        <h4>Qué le hace una racha de pérdidas a tu cuenta</h4>
        <p className="dz-note">
          Cada celda muestra cuánto cae el saldo si perdés seguidas esa cantidad de operaciones arriesgando ese porcentaje, y cuánto tenés que ganar después
          para volver al punto de partida. {worstLossStreak > 0 ? `Tu peor racha registrada fue de ${worstLossStreak}.` : "Todavía no hay racha registrada."} No existe un porcentaje correcto para todos:
          es una decisión tuya, y esta tabla es para tomarla mirando números.
        </p>
        <table className="dz-mini">
          <thead><tr><th>Riesgo</th>{streaks.map((n) => <th key={n}>{n} seguidas</th>)}</tr></thead>
          <tbody>
            {impact.map((row) => (
              <tr key={row.risk} className={row.risk === s.riskPct ? "dz-current" : ""}>
                <td>{num(row.risk, 1)}%</td>
                {row.rows.map((c) => <td key={c.n}>−{num(c.drawdownPct, 1)}% <em>(+{num(c.recoveryPct, 1)}%)</em></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const CHUNK = 100;

async function postFills(fills: JFill[], onProgress: (done: number) => void): Promise<JFill[]> {
  const saved: JFill[] = [];
  for (let i = 0; i < fills.length; i += CHUNK) {
    const chunk = fills.slice(i, i + CHUNK);
    const r = await fetch("/api/diario/fills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fills: chunk }) });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "No se pudo guardar en tu cuenta.");
    }
    saved.push(...chunk);
    onProgress(saved.length);
  }
  return saved;
}

export function DataView({
  fills, stored, liveCount, recorder, trades, notes, settings, set, getCreds, onAdded,
}: {
  fills: JFill[]; stored: JFill[]; liveCount: number; recorder: RecorderStatus; trades: JTrade[]; notes: Record<string, TradeNote>;
  settings: DiarioSettings; set: (patch: Partial<DiarioSettings>) => void; getCreds: () => Promise<Creds>; onAdded: (fills: JFill[]) => void;
}) {
  const [log, setLog] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [fileName, setFileName] = useState("");
  const [fileText, setFileText] = useState("");
  const [market, setMarket] = useState<Market>("futures");
  const [importing, setImporting] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const counts = useMemo(() => ({ sync: stored.filter((f) => f.source === "sync").length, import: stored.filter((f) => f.source === "import").length }), [stored]);
  const preview = useMemo(() => (fileText ? parseBinanceCsv(fileText, market) : null), [fileText, market]);

  const say = (line: string) => setLog((l) => [...l.slice(-60), line]);

  const syncSpot = async () => {
    setSyncing(true);
    setLog([]);
    try {
      const c = await getCreds();
      const { balances } = await getAccountBalances(c.apiKey, c.apiSecret);
      const extras = settings.extraSymbols.split(/[,;\s]+/).filter(Boolean);
      const symbols = spotCandidates(balances, extras);
      if (!symbols.length) {
        say("No hay monedas con saldo ni pares agregados para leer. Agregá pares abajo (por ejemplo los que ya vendiste).");
        return;
      }
      say(`Leyendo ${symbols.length} par(es): ${symbols.join(", ")}`);
      const collected: JFill[] = [];
      for (const symbol of symbols) {
        try {
          const lastId = stored
            .filter((f) => f.market === "spot" && f.source === "sync" && f.symbol === symbol)
            .reduce((m, f) => Math.max(m, Number(f.id.slice(symbol.length + 1)) || 0), 0);
          const rows = await readSpotHistory((from) => getMyTrades(c.apiKey, c.apiSecret, symbol, 1000, from), lastId || null);
          const mapped = rows.map(fromSpotApi).filter((f): f is JFill => f !== null);
          collected.push(...mapped);
          say(`${symbol}: ${mapped.length} operación(es) ${lastId ? "nuevas" : "en total"}`);
        } catch (error) {
          if (error instanceof BinanceClientError && error.code === -1121) say(`${symbol}: ese par no existe en Binance.`);
          else say(`${symbol}: ${friendlyClientError(error)}`);
        }
      }
      if (!collected.length) {
        say("Nada nuevo para guardar.");
        return;
      }
      const saved = await postFills(collected, (n) => say(`Guardando en tu cuenta… ${n}/${collected.length}`));
      onAdded(saved);
      say(`✓ Listo: ${saved.length} operaciones de spot guardadas.`);
    } catch (error) {
      say(`⚠ ${friendlyClientError(error)}`);
    } finally {
      setSyncing(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    setImportMsg(null);
    if (!file) return;
    if (file.size > 20_000_000) {
      setFileText("");
      setImportMsg("El archivo pesa más de 20 MB: exportá por tramos de fechas.");
      return;
    }
    if (/\.xlsx?$/i.test(file.name)) {
      setFileText("");
      setImportMsg("Los archivos de Excel no se pueden leer directo: abrilo en Excel y guardalo como CSV (delimitado por comas), después importalo.");
      return;
    }
    setFileName(file.name);
    setFileText(await file.text());
  };

  const runImport = async () => {
    if (!preview || !preview.ok) return;
    setImportMsg(null);
    const fresh = dropDuplicates(fills, preview.fills);
    if (!fresh.length) {
      setImportMsg("Todas las operaciones del archivo ya estaban en tu diario.");
      return;
    }
    setImporting(`0/${fresh.length}`);
    try {
      const saved = await postFills(fresh, (n) => setImporting(`${n}/${fresh.length}`));
      onAdded(saved);
      setImportMsg(`✓ Importadas ${saved.length} operaciones${preview.fills.length - fresh.length ? ` (${preview.fills.length - fresh.length} ya estaban)` : ""}.`);
      setFileText("");
      setFileName("");
    } catch (error) {
      setImportMsg(`⚠ ${error instanceof Error ? error.message : "No se pudo importar."} Lo que se alcanzó a guardar quedó guardado; volvé a importar el mismo archivo y se completa.`);
    } finally {
      setImporting(null);
    }
  };

  const recorderText: Record<RecorderStatus["state"], string> = {
    apagado: "detenido", "sin-sesion": "sin sesión", "sin-vincular": "cuenta de Binance sin vincular", conectando: "conectando…",
    grabando: "● grabando", reintentando: "reconectando…", "sin-permiso": "la key no tiene permiso de Futuros",
  };

  return (
    <div className="dz-data">
      <div className="dz-card">
        <h4>De dónde sale tu diario</h4>
        <ul className="dz-list">
          <li><b>Futuros, en vivo:</b> {liveCount} ejecuciones grabadas · grabador {recorderText[recorder.state]}. Graba solo mientras la app esté abierta.</li>
          <li><b>Spot, leído de Binance:</b> {counts.sync} operaciones.</li>
          <li><b>Importadas de archivos:</b> {counts.import} operaciones.</li>
        </ul>
        <button className="dz-btn" disabled={!trades.length} onClick={() => download(`diario-binance-${fileDate()}.csv`, tradesCsv(trades, csvStamp, (k) => notes[k]))}>
          DESCARGAR EL DIARIO (.CSV)
        </button>
      </div>

      <div className="dz-card">
        <h4>Spot: traer mi historial</h4>
        <p className="dz-note">
          Lee de Binance las operaciones spot de cada moneda que tenés hoy, contra USDT. Binance no permite pedir «todo el historial»: para monedas que ya vendiste
          entera, agregá el par acá (ej. <code>SOLUSDT, DOGEUSDT</code>); para pares contra FDUSD o USDC, también.
        </p>
        <label className="dz-wide-input">Pares adicionales
          <input value={settings.extraSymbols} onChange={(e) => set({ extraSymbols: e.target.value })} placeholder="SOLUSDT, DOGEUSDT, BNBFDUSD" />
        </label>
        <button className="dz-btn" onClick={syncSpot} disabled={syncing}>{syncing ? "LEYENDO…" : "SINCRONIZAR SPOT"}</button>
        {log.length > 0 && <pre className="dz-log">{log.join("\n")}</pre>}
      </div>

      <div className="dz-card">
        <h4>Importar el historial de Binance (archivo)</h4>
        <p className="dz-note">
          Binance no entrega por acá el historial de futuros anterior a hoy, pero lo podés exportar desde su web (Órdenes → Futuros o Spot → Historial de operaciones →
          Exportar; los nombres exactos pueden variar) y subirlo acá. Si viene en Excel, guardalo como CSV. Se detectan las columnas por su nombre y, si algo no cuadra, te lo dice.
          Se descartan solas las operaciones que ya tenías. Para que el resultado sea correcto, exportá <b>todo</b> el historial desde tu primera operación: si empieza a mitad
          de una posición, esa operación va a salir incompleta.
        </p>
        <div className="dz-form">
          <label>El archivo es de
            <select value={market} onChange={(e) => setMarket(e.target.value as Market)}><option value="futures">Futuros</option><option value="spot">Spot</option></select>
          </label>
          <label>Archivo (.csv)<input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} /></label>
        </div>
        {importMsg && <p className={`dz-note ${importMsg.startsWith("✓") ? "ok" : "warn"}`}>{importMsg}</p>}
        {preview && !preview.ok && (
          <div className="dz-note warn">
            <p>{preview.error}</p>
            <p>Columnas que vi: {preview.headers.join(" · ") || "ninguna"}</p>
          </div>
        )}
        {preview && preview.ok && (
          <div className="dz-preview">
            <p><b>{fileName}</b>: {preview.fills.length} operaciones leídas de {preview.rows} filas
              {preview.skippedZero ? `, ${preview.skippedZero} sin cantidad (órdenes canceladas)` : ""}
              {preview.from !== null && preview.to !== null ? ` · del ${stamp(preview.from).slice(0, 10)} al ${stamp(preview.to).slice(0, 10)}` : ""}.
            </p>
            <p>Pares: {preview.symbols.slice(0, 12).join(", ")}{preview.symbols.length > 12 ? ` y ${preview.symbols.length - 12} más` : ""}.</p>
            <p className="dz-map">Columnas usadas: {Object.entries(preview.mapping).map(([k, v]) => `${k} ← «${v}»`).join(" · ")}</p>
            {preview.warnings.map((w) => <p key={w} className="dz-note warn">⚠ {w}</p>)}
            {preview.rejected.slice(0, 5).map((r) => <p key={r.line} className="dz-note warn">Línea {r.line}: {r.reason}</p>)}
            <table className="dz-mini">
              <thead><tr><th>Fecha</th><th>Par</th><th>Lado</th><th>Precio</th><th>Cantidad</th><th>Comisión</th></tr></thead>
              <tbody>
                {preview.fills.slice(0, 4).map((f) => (
                  <tr key={f.id}><td>{stamp(f.time)}</td><td>{f.symbol}</td><td className={f.side === "BUY" ? "up" : "down"}>{f.side === "BUY" ? "COMPRA" : "VENTA"}</td><td>{px(f.price)}</td><td>{qty(f.qty)}</td><td>{qty(f.fee)} {f.feeAsset}</td></tr>
                ))}
              </tbody>
            </table>
            <button className="dz-btn" onClick={runImport} disabled={importing !== null || !preview.fills.length}>
              {importing ? `IMPORTANDO ${importing}…` : `IMPORTAR ${preview.fills.length} OPERACIONES`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
