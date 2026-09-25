"use client";

import { useEffect, useState } from "react";
import { loadRows, timeframeConfig } from "@/lib/market-fetch";
import {
  divergenceStats,
  findDivergences,
  macd,
  oscillatorState,
  rsi,
  type DivergenceStats,
  type OscState,
} from "@/lib/oscillators";
import { parseSwingKlines } from "@/lib/swing-entries";

const FRAMES = ["15m", "1h", "4h", "1d"];
type Row = { tf: string; state: OscState; stats: DivergenceStats };

/**
 * RSI, MACD and recent divergences on four timeframes at once. The value is
 * in agreement across frames: a bullish divergence on the 15m against a
 * bearish one on the 4h says the short-term bounce is inside a weakening
 * higher frame, which neither row says alone.
 */
export default function MtfOscillators({ symbol }: { symbol: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    (async () => {
      setLoading(true);
      const out: Row[] = [];
      for (const tf of FRAMES) {
        try {
          // Same candle count as the map for that frame: RSI and MACD depend on
          // how much history they warm up on, so a shorter series gave values
          // that did not match the chart's own panes.
          const candles = parseSwingKlines(await loadRows(symbol, tf, timeframeConfig(tf).lookback, controller.signal));
          if (!alive) return;
          if (candles.length < 60) continue;
          const closes = candles.map((c) => c.close);
          const m = macd(closes);
          const range = Math.max(1e-12, ...m.macd.slice(-150).filter((v): v is number => v !== null).map(Math.abs));
          const all = [
            ...findDivergences(candles, rsi(closes), "RSI", { minOscDelta: 2 }),
            ...findDivergences(candles, m.macd, "MACD", { minOscDelta: range * 0.05 }),
          ];
          out.push({ tf, state: oscillatorState(candles, 20), stats: divergenceStats(candles, all) });
        } catch {
          // A missing frame just drops its row.
        }
      }
      if (!alive) return;
      setRows(out);
      setLoading(false);
    })();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [symbol]);

  const bullDiv = rows.filter((r) => r.state.recent.some((d) => d.side === "ALCISTA")).length;
  const bearDiv = rows.filter((r) => r.state.recent.some((d) => d.side === "BAJISTA")).length;
  const macdUp = rows.filter((r) => r.state.macdCross === "ALCISTA").length;
  const summary =
    !rows.length
      ? ""
      : bullDiv && bearDiv
        ? `Divergencias en sentidos opuestos (${bullDiv} alcista, ${bearDiv} bajista): los marcos no coinciden; el más alto suele pesar más.`
        : bullDiv
          ? `Divergencia alcista en ${bullDiv} de ${rows.length} marcos. MACD alcista en ${macdUp}/${rows.length}.`
          : bearDiv
            ? `Divergencia bajista en ${bearDiv} de ${rows.length} marcos. MACD alcista en ${macdUp}/${rows.length}.`
            : `Sin divergencias recientes. MACD alcista en ${macdUp} de ${rows.length} marcos${macdUp === rows.length ? ": momentum alineado al alza" : macdUp === 0 ? ": momentum alineado a la baja" : ""}.`;

  return (
    <div className="mtf-osc">
      <h4>RSI · MACD · DIVERGENCIAS MULTI-TEMPORALIDAD</h4>
      {loading && <p className="mo-note">Leyendo 15m, 1h, 4h y 1D…</p>}
      {!loading && summary && <p className="mo-summary">{summary}</p>}
      <div className="mo-table">
        {rows.map((r) => (
          <div key={r.tf} className="mo-row">
            <b className="mo-tf">{r.tf.toUpperCase()}</b>
            <div className="mo-cell">
              <span>RSI</span>
              <u className={r.state.rsiZone === "SOBRECOMPRA" ? "down" : r.state.rsiZone === "SOBREVENTA" ? "up" : ""}>
                {r.state.rsi != null ? r.state.rsi.toFixed(1) : "—"}
              </u>
              <em>{r.state.rsiZone?.toLowerCase() ?? ""}</em>
            </div>
            <div className="mo-cell">
              <span>MACD</span>
              <u className={r.state.macdCross === "ALCISTA" ? "up" : r.state.macdCross === "BAJISTA" ? "down" : ""}>
                {r.state.macdCross ?? "—"}
              </u>
              <em>{r.state.histRising == null ? "" : r.state.histRising ? "histograma sube" : "histograma baja"}</em>
            </div>
            <div className="mo-divs">
              {r.state.recent.length ? (
                r.state.recent.slice(0, 3).map((d) => (
                  <i key={`${d.indicator}-${d.from}-${d.to}`} className={`${d.side === "ALCISTA" ? "up" : "down"}${d.kind === "OCULTA" ? " hidden" : ""}`}>
                    {d.indicator} {d.kind === "OCULTA" ? "oculta" : "regular"} {d.side === "ALCISTA" ? "↑" : "↓"} · hace {d.age}
                  </i>
                ))
              ) : (
                <i className="none">sin divergencias recientes</i>
              )}
              <small>
                {r.stats.rate === null
                  ? "sin divergencias resueltas en la serie"
                  : `funcionaron ${Math.round(r.stats.rate * 100)}% en ${r.stats.tested} casos${r.stats.tested < 8 ? " (muestra mínima)" : ""}`}
              </small>
            </div>
          </div>
        ))}
      </div>
      <p className="mo-note">
        Regular: el precio hace un extremo nuevo que el oscilador no confirma — aviso de giro. Oculta: el precio respeta
        la tendencia y el oscilador no — aviso de continuación. Se detectan sobre pivotes confirmados (no se redibujan).
        &quot;Funcionaron&quot; = el precio se movió 1 ATR a favor antes que 1 ATR en contra dentro de 12 velas, en esa
        misma serie. Referencia: en 200 gráficos aleatorios ese criterio da 49%, así que cerca de 50% no es mejor que
        el azar; lo que importa es cuánto se aleja, y con muestra suficiente. Son avisos, no gatillos.
      </p>
    </div>
  );
}
