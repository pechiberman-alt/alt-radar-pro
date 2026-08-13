"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LedgerPayload, SignalRecord } from "@/lib/signal-ledger";
import type { MarketAsset, ScoredAsset } from "@/lib/radar";
import type { DashboardSettings } from "./dashboard-settings";

type Props = {
  settings: DashboardSettings;
  updateSettings: (patch: Partial<DashboardSettings>) => void;
  altseason: number | null;
  risk: number | null;
  active: ScoredAsset[];
  market: MarketAsset[];
  sources: string[];
};

const emptyStats: LedgerPayload["stats"] = {
  total: 0,
  evaluated4h: 0,
  wins4h: 0,
  winRate4h: null,
  grossProfit4h: 0,
  grossLoss4h: 0,
  profitFactor4h: null,
  falseSignalRate4h: null,
  averageReturn4h: null,
  bestReturn4h: null,
  worstReturn4h: null,
};

const initialPayload: LedgerPayload = {
  records: [],
  stats: emptyStats,
  automation: { lastRun: null, lastSummary: null, schedule: "Scalping cada 5 min · swing cada 15 min" },
};

const assetName = (symbol: string) => symbol.replace("USDT", "");
const price = (value: number) =>
  value >= 1000
    ? `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : value >= 1
      ? `$${value.toFixed(3)}`
      : `$${value.toPrecision(4)}`;
const percentage = (value: number | null) =>
  value === null ? "PENDIENTE" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const dateTime = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("es-AR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

function playAlertTone() {
  try {
    const AudioContextClass = window.AudioContext;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(740, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(1080, context.currentTime + 0.18);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.3);
  } catch {
    // Audio alerts are optional and may be blocked by the browser.
  }
}

function OutcomeCell({ value }: { value: number | null }) {
  return (
    <span
      className={
        value === null ? "pending" : value > 0 ? "positive" : value < 0 ? "negative" : "muted"
      }
    >
      {percentage(value)}
    </span>
  );
}

function StatCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "positive" | "negative";
}) {
  return (
    <div className="ledger-stat">
      <span>{label}</span>
      <b className={tone}>{value}</b>
      <small>{detail}</small>
    </div>
  );
}

export default function SignalLedger({
  settings,
  updateSettings,
  altseason,
  risk,
  active,
  market,
  sources,
}: Props) {
  const [payload, setPayload] = useState(initialPayload);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const knownIds = useRef<Set<string> | null>(null);
  const lastAlertAt = useRef(0);
  const marketSnapshot = useRef({ active, market, altseason, risk });

  useEffect(() => {
    marketSnapshot.current = { active, market, altseason, risk };
  }, [active, market, altseason, risk]);

  const notifyNewRecords = useCallback(
    (records: SignalRecord[]) => {
      if (!knownIds.current) {
        knownIds.current = new Set(records.map((record) => record.id));
        return;
      }
      const now = Date.now();
      const newRecord = records.find(
        (record) =>
          !knownIds.current?.has(record.id) &&
          record.score >= settings.alertMinimumScore &&
          now - lastAlertAt.current >= settings.alertCooldownMinutes * 60_000,
      );
      knownIds.current = new Set(records.map((record) => record.id));
      if (!newRecord) return;
      lastAlertAt.current = now;
      if (settings.sound) playAlertTone();
      if (
        settings.notifications &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        new Notification(`ALT RADAR ${newRecord.signal}`, {
          body: `${assetName(newRecord.symbol)}/USDT · ${newRecord.side} · ${newRecord.score}/100`,
          icon: "/icon-192.png",
          tag: newRecord.id,
        });
      }
    },
    [settings],
  );

  const loadLedger = useCallback(async () => {
    try {
      const response = await fetch("/api/signals", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const next = (await response.json()) as LedgerPayload;
      notifyNewRecords(next.records);
      setPayload(next);
      setError("");
    } catch {
      setError("HISTORIAL PERSISTENTE NO DISPONIBLE");
    } finally {
      setLoading(false);
    }
  }, [notifyNewRecords]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const current = marketSnapshot.current;
      const response = await fetch("/api/signals", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "browser",
          snapshot: {
            candidates: current.active
              .filter(
                (asset) =>
                  (asset.signal === "SETUP" || asset.signal === "TRIGGER") &&
                  (asset.side === "LONG" || asset.side === "SHORT"),
              )
              .slice(0, 8)
              .map((asset) => ({
                symbol: asset.symbol,
                side: asset.side,
                signal: asset.signal,
                score: asset.score,
                technicalScore: asset.technicalScore,
                entryPrice: asset.price,
                reasons: asset.reasons,
                penalties: asset.penalties,
              })),
            prices: current.market.map((asset) => ({
              symbol: asset.symbol,
              price: asset.price,
            })),
            altseason: current.altseason,
            risk: current.risk,
          },
        }),
      });
      if (!response.ok) throw new Error();
      const next = (await response.json()) as LedgerPayload;
      notifyNewRecords(next.records);
      setPayload(next);
      setError("");
    } catch {
      setError("AUTOMATIZACIÓN TEMPORALMENTE NO DISPONIBLE");
    } finally {
      setSyncing(false);
      setLoading(false);
    }
  }, [notifyNewRecords]);

  useEffect(() => {
    const boot = window.setTimeout(syncNow, 600);
    const readInterval = window.setInterval(loadLedger, 60_000);
    const syncInterval = window.setInterval(syncNow, 5 * 60_000);
    return () => {
      window.clearTimeout(boot);
      window.clearInterval(readInterval);
      window.clearInterval(syncInterval);
    };
  }, [loadLedger, syncNow]);

  const requestNotifications = async () => {
    if (!("Notification" in window)) {
      updateSettings({ notifications: false });
      return;
    }
    const permission = await Notification.requestPermission();
    updateSettings({ notifications: permission === "granted" });
  };

  const toggleSound = () => {
    const next = !settings.sound;
    updateSettings({ sound: next });
    if (next) playAlertTone();
  };

  const exportLedger = () => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `alt-radar-ledger-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const copyReport = async () => {
    const top = active.slice(0, 3);
    const report = [
      "ALT RADAR PRO — INFORME AUTOMÁTICO",
      `Fecha: ${new Date().toLocaleString("es-AR")}`,
      `Altseason ajustada: ${altseason ?? "DATA UNAVAILABLE"}/100`,
      `Riesgo geopolítico: ${risk ?? "DATA UNAVAILABLE"}/100`,
      `Señales activas: ${top.length}`,
      ...top.map(
        (asset) =>
          `• ${assetName(asset.symbol)}/USDT · ${asset.side} · ${asset.signal} · ${asset.score}/100`,
      ),
      `Historial real: ${payload.stats.total} registros; ${payload.stats.evaluated4h} evaluados a 4H`,
      `Fuentes: ${sources.join(" · ") || "DATA UNAVAILABLE"}`,
      "Las señales son escenarios probabilísticos, no garantías ni asesoramiento financiero.",
      "© 2026 URL.FX",
    ].join("\n");
    await navigator.clipboard.writeText(report);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const stats = payload.stats;
  const winRate = stats.winRate4h === null ? "—" : `${stats.winRate4h.toFixed(1)}%`;
  const falseRate =
    stats.falseSignalRate4h === null ? "—" : `${stats.falseSignalRate4h.toFixed(1)}%`;
  const average = percentage(stats.averageReturn4h);
  const profitFactor =
    stats.evaluated4h === 0
      ? "—"
      : stats.grossLoss4h === 0 && stats.grossProfit4h > 0
        ? "∞"
        : stats.profitFactor4h === null
          ? "—"
          : stats.profitFactor4h.toFixed(2);

  return (
    <section className="ledger-section" id="historial">
      <div className="section-head ledger-heading">
        <div>
          <p className="eyebrow">SIGNAL LEDGER · VALIDACIÓN SIN LOOK-AHEAD</p>
          <h2>Historial automático y rendimiento real</h2>
        </div>
        <div className="ledger-actions">
          <span className={error ? "automation-state degraded" : "automation-state"}>
            <i /> {error ? "DEGRADADO" : "AUTOMATIZACIÓN CLOUD"}
          </span>
          <button onClick={syncNow} disabled={syncing}>
            {syncing ? "SINCRONIZANDO…" : "SINCRONIZAR"}
          </button>
          <button onClick={() => setSettingsOpen((open) => !open)}>AJUSTES</button>
        </div>
      </div>

      <div className="ledger-command">
        <div>
          <span>PRÓXIMA LECTURA</span>
          <b>{payload.automation.schedule}</b>
        </div>
        <div>
          <span>ÚLTIMA EJECUCIÓN</span>
          <b>{dateTime(payload.automation.lastRun)}</b>
        </div>
        <div>
          <span>UNIVERSO ÚLTIMO CICLO</span>
          <b>{payload.automation.lastSummary?.universe ?? "—"} ACTIVOS</b>
        </div>
        <p>
          Cloudflare revisa scalping cada 5 minutos y el modelo swing cada 15 minutos; la PWA
          aporta el universo Binance mientras está abierta. Nunca completa resultados con datos futuros.
        </p>
      </div>

      {settingsOpen && (
        <div className="settings-grid">
          <label>
            UNIVERSO DEL ESCÁNER
            <select
              value={settings.universe}
              onChange={(event) =>
                updateSettings({ universe: event.target.value as DashboardSettings["universe"] })
              }
            >
              <option value="ALL">TODOS LOS PARES</option>
              <option value="200">TOP 200</option>
              <option value="100">TOP 100</option>
              <option value="50">TOP 50</option>
            </select>
          </label>
          <label>
            WATCH
            <input
              type="number"
              min="50"
              max="75"
              value={settings.watch}
              onChange={(event) => updateSettings({ watch: Number(event.target.value) })}
            />
          </label>
          <label>
            SETUP
            <input
              type="number"
              min="60"
              max="85"
              value={settings.setup}
              onChange={(event) => updateSettings({ setup: Number(event.target.value) })}
            />
          </label>
          <label>
            TRIGGER
            <input
              type="number"
              min="70"
              max="95"
              value={settings.trigger}
              onChange={(event) => updateSettings({ trigger: Number(event.target.value) })}
            />
          </label>
          <label>
            VOLUMEN MÍNIMO 24H
            <select
              value={settings.minimumQuoteVolume}
              onChange={(event) =>
                updateSettings({ minimumQuoteVolume: Number(event.target.value) })
              }
            >
              <option value="1000000">$1M</option>
              <option value="5000000">$5M</option>
              <option value="10000000">$10M</option>
              <option value="50000000">$50M</option>
              <option value="100000000">$100M</option>
            </select>
          </label>
          <label>
            ALERTAR DESDE SCORE
            <input
              type="number"
              min="60"
              max="100"
              value={settings.alertMinimumScore}
              onChange={(event) =>
                updateSettings({ alertMinimumScore: Number(event.target.value) })
              }
            />
          </label>
          <label>
            COOLDOWN
            <select
              value={settings.alertCooldownMinutes}
              onChange={(event) =>
                updateSettings({ alertCooldownMinutes: Number(event.target.value) })
              }
            >
              <option value="5">5 MIN</option>
              <option value="15">15 MIN</option>
              <option value="30">30 MIN</option>
              <option value="60">60 MIN</option>
              <option value="120">120 MIN</option>
            </select>
          </label>
          <div className="setting-switches">
            <button className={settings.sound ? "enabled" : ""} onClick={toggleSound}>
              {settings.sound ? "●" : "○"} SONIDO
            </button>
            <button
              className={settings.notifications ? "enabled" : ""}
              onClick={requestNotifications}
            >
              {settings.notifications ? "●" : "○"} NOTIFICACIONES
            </button>
          </div>
          <p>
            Los ajustes son privados de este dispositivo. El historial institucional usa el
            modelo base 70/80 para que sus estadísticas sean comparables.
          </p>
        </div>
      )}

      <div className="ledger-stats">
        <StatCard label="SEÑALES REGISTRADAS" value={String(stats.total)} detail="datos reales" />
        <StatCard
          label="EVALUADAS A 4H"
          value={String(stats.evaluated4h)}
          detail="muestra cerrada"
        />
        <StatCard
          label="WIN RATE 4H"
          value={winRate}
          detail={`${stats.wins4h} movimientos favorables`}
          tone={stats.winRate4h !== null && stats.winRate4h >= 50 ? "positive" : undefined}
        />
        <StatCard
          label="PROFIT FACTOR 4H"
          value={profitFactor}
          detail={
            stats.evaluated4h
              ? `ganancia ${stats.grossProfit4h.toFixed(2)}% / pérdida ${stats.grossLoss4h.toFixed(2)}%`
              : "esperando muestra real"
          }
          tone={
            stats.profitFactor4h !== null && stats.profitFactor4h >= 1
              ? "positive"
              : stats.profitFactor4h !== null
                ? "negative"
                : undefined
          }
        />
        <StatCard
          label="RETORNO MEDIO 4H"
          value={average}
          detail="ajustado por dirección"
          tone={
            stats.averageReturn4h === null
              ? undefined
              : stats.averageReturn4h >= 0
                ? "positive"
                : "negative"
          }
        />
        <StatCard
          label="FALSA SEÑAL 4H"
          value={falseRate}
          detail="retorno ≤ 0%"
          tone={stats.falseSignalRate4h !== null && stats.falseSignalRate4h > 50 ? "negative" : undefined}
        />
      </div>

      <div className="ledger-table-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>ACTIVO</th>
              <th>DETECTADA</th>
              <th>TIPO</th>
              <th>SCORE</th>
              <th>ENTRADA</th>
              <th>15M</th>
              <th>1H</th>
              <th>4H</th>
              <th>24H</th>
              <th>MÁX.</th>
              <th>ESTADO</th>
            </tr>
          </thead>
          <tbody>
            {payload.records.slice(0, 60).map((record) => (
              <tr key={record.id}>
                <td>
                  <b>{assetName(record.symbol)}</b><small>/USDT</small>
                </td>
                <td>{dateTime(record.detectedAt)}</td>
                <td>
                  <span className={`side-pill ${record.side.toLowerCase()}`}>{record.side}</span>
                  <span className={`signal-pill ${record.signal.toLowerCase()}`}>{record.signal}</span>
                </td>
                <td><b>{record.score}</b><small>/100</small></td>
                <td>{price(record.entryPrice)}</td>
                <td><OutcomeCell value={record.outcomes.m15.returnPct} /></td>
                <td><OutcomeCell value={record.outcomes.h1.returnPct} /></td>
                <td><OutcomeCell value={record.outcomes.h4.returnPct} /></td>
                <td><OutcomeCell value={record.outcomes.h24.returnPct} /></td>
                <td className={record.maxMove > 0 ? "positive" : "muted"}>
                  {percentage(record.maxMove)}
                </td>
                <td>
                  <span className={`record-state ${record.status.toLowerCase()}`}>
                    {record.status === "MONITORING" ? "MONITOREANDO" : "CERRADA 24H"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !payload.records.length && (
          <div className="ledger-empty">
            <b>{error || "TODAVÍA NO HAY SEÑALES CALIFICADAS"}</b>
            <span>
              El sistema no inventará una muestra. Los indicadores aparecerán cuando existan
              registros reales suficientes.
            </span>
          </div>
        )}
        {loading && <div className="ledger-empty"><b>SINCRONIZANDO HISTORIAL…</b></div>}
      </div>

      <div className="ledger-footer">
        <p>
          Estadística principal: retorno direccional a 4H. Win Rate y Profit Factor se calculan
          sólo con observaciones cerradas; no equivalen a operaciones ejecutadas ni incluyen comisiones.
        </p>
        <div>
          <button onClick={copyReport}>{copied ? "INFORME COPIADO" : "COPIAR INFORME"}</button>
          <button onClick={exportLedger} disabled={!payload.records.length}>EXPORTAR JSON</button>
        </div>
      </div>
    </section>
  );
}
