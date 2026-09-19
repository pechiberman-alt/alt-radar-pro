"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildLiquidationHeatmap } from "@/lib/liquidation-heatmap";
import { HALF_LIFE_CANDLES, loadOiDelta, loadOpenInterest, loadRows } from "@/lib/market-fetch";
import { parseSwingKlines } from "@/lib/swing-entries";
import {
  buildSignalTargets,
  proximityAlert,
  type SignalTargets,
} from "@/lib/signal-confluence";
import type { SignalRecord } from "@/lib/signal-ledger";

/** Deriving targets costs a candle fetch per symbol, so this covers the most
 *  recent open signals rather than every one ever recorded. */
const MAX_TRACKED = 6;
const TIMEFRAME = "1h";

const price = (value: number) =>
  value >= 1000
    ? value.toLocaleString("es-AR", { maximumFractionDigits: 0 })
    : value.toLocaleString("es-AR", { maximumFractionDigits: value >= 1 ? 2 : 6 });

const usd = (value: number | null) => {
  if (value === null) return null;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${(value / 1e3).toFixed(0)}K`;
};

type Tracked = { record: SignalRecord; targets: SignalTargets; currentPrice: number };

export default function ActiveSignals({
  records,
  notificationsEnabled,
}: {
  records: SignalRecord[];
  notificationsEnabled: boolean;
}) {
  const [tracked, setTracked] = useState<Tracked[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  /** Levels already announced, so one approach does not notify every cycle. */
  const announced = useRef<Set<string>>(new Set());

  const open = records
    .filter((record) => record.status === "MONITORING")
    .slice(0, MAX_TRACKED);
  const openKey = open.map((record) => record.id).join(",");

  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), 120_000);
    return () => clearInterval(id);
  }, []);

  const notify = useCallback(
    (tracking: Tracked[]) => {
      if (!notificationsEnabled) return;
      if (typeof window === "undefined" || !("Notification" in window)) return;
      if (Notification.permission !== "granted") return;

      for (const item of tracking) {
        const alert = proximityAlert(item.targets, item.currentPrice);
        if (!alert) continue;
        // One notification per level per signal: price hovering near a zone
        // would otherwise fire on every refresh until it moved away.
        const key = `${item.record.id}-${alert.kind}-${alert.price}`;
        if (announced.current.has(key)) continue;
        announced.current.add(key);

        new Notification(
          alert.kind === "RIESGO" ? "ALT RADAR · RIESGO CERCA" : "ALT RADAR · OBJETIVO CERCA",
          {
            body: alert.message,
            icon: "/icon-192.png",
            tag: key,
          },
        );
      }
    },
    [notificationsEnabled],
  );

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    (async () => {
      // Every state change happens inside the async body: a synchronous
      // set-state at the top of an effect runs during the render commit,
      // which React rightly flags.
      if (!openKey) {
        setTracked([]);
        return;
      }
      setLoading(true);
      const results: Tracked[] = [];
      for (const record of open) {
        try {
          const rows = await loadRows(record.symbol, TIMEFRAME, 500, controller.signal);
          if (!alive) return;
          const candles = parseSwingKlines(rows);
          if (candles.length < 20) continue;

          const currentPrice = candles.at(-1)!.close;
          const [oiDeltaByIndex, openContracts] = await Promise.all([
            loadOiDelta(
              record.symbol,
              TIMEFRAME,
              candles.map((candle) => candle.openTime),
              controller.signal,
            ),
            loadOpenInterest(record.symbol, controller.signal),
          ]);
          if (!alive) return;

          const heatmap = buildLiquidationHeatmap(record.symbol, candles, currentPrice, {
            oiDeltaByIndex: oiDeltaByIndex ?? undefined,
            halfLifeCandles: HALF_LIFE_CANDLES[TIMEFRAME],
            totalOpenInterestUsd:
              openContracts !== null ? openContracts * currentPrice : undefined,
          });

          results.push({
            record,
            currentPrice,
            targets: buildSignalTargets(
              record.symbol,
              record.side,
              record.entryPrice,
              heatmap,
            ),
          });
        } catch {
          // One symbol failing must not cost the others their targets.
        }
      }
      if (!alive) return;
      setTracked(results);
      setLoading(false);
      notify(results);
    })();

    return () => {
      alive = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey, tick, notify]);

  if (!openKey) return null;

  return (
    <div className="asig">
      <div className="asig-head">
        <h4>SEÑALES ABIERTAS · OBJETIVO Y RIESGO</h4>
        <span>{loading ? "CALCULANDO…" : `${tracked.length} con mapa`}</span>
      </div>
      <p className="asig-why">
        Los niveles no son porcentajes elegidos a mano: salen del mapa de liquidaciones. El
        objetivo es la zona imán en la dirección del trade y el riesgo es la de enfrente, que es
        donde un barrido iría a buscar estos stops.
      </p>

      {tracked.length === 0 && !loading && (
        <p className="asig-none">
          No se pudo construir el mapa para las señales abiertas, así que no se muestran objetivos
          en vez de inventarlos.
        </p>
      )}

      <div className="asig-list">
        {tracked.map(({ record, targets, currentPrice }) => (
          <div key={record.id} className={`v-${targets.verdict.split(" ").pop()?.toLowerCase()}`}>
            <div className="asig-top">
              <b>{record.symbol.replace("USDT", "")}</b>
              <span className={`side-pill ${record.side.toLowerCase()}`}>{record.side}</span>
              <em>entrada {price(record.entryPrice)}</em>
              <u>ahora {price(currentPrice)}</u>
              <i className={`asig-verdict v-${targets.verdict.split(" ").pop()?.toLowerCase()}`}>
                {targets.verdict}
              </i>
            </div>

            <div className="asig-levels">
              <div className="t">
                <span>OBJETIVO</span>
                {targets.target ? (
                  <>
                    <b>{price(targets.target.price)}</b>
                    <em>
                      {targets.target.distancePct.toFixed(2)}%
                      {usd(targets.target.notionalUsd) ? ` · ${usd(targets.target.notionalUsd)}` : ""}
                    </em>
                  </>
                ) : (
                  <b className="none">sin zona</b>
                )}
              </div>
              <div className="r">
                <span>RIESGO</span>
                {targets.invalidation ? (
                  <>
                    <b>{price(targets.invalidation.price)}</b>
                    <em>
                      {targets.invalidation.distancePct.toFixed(2)}%
                      {usd(targets.invalidation.notionalUsd)
                        ? ` · ${usd(targets.invalidation.notionalUsd)}`
                        : ""}
                    </em>
                  </>
                ) : (
                  <b className="none">sin zona</b>
                )}
              </div>
              <div className="rr">
                <span>R:R</span>
                <b>{targets.riskReward !== null ? `${targets.riskReward.toFixed(2)}×` : "—"}</b>
              </div>
            </div>

            <p className="asig-note">{targets.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
