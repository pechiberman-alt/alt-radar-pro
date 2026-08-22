"use client";

import { useMemo, useState } from "react";
import type { MarketAsset } from "@/lib/radar";
import {
  PROFILE_ORDER,
  TRADING_PROFILES,
  calculateRisk,
  type ProfileId,
} from "@/lib/trading-profiles";

type Props = {
  profile: ProfileId;
  setProfile: (id: ProfileId) => void;
  market: MarketAsset[];
};

const assetName = (symbol: string) => symbol.replace("USDT", "");

const money = (value: number) =>
  value >= 1000
    ? `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : `$${value.toFixed(2)}`;

const priceLabel = (value: number) =>
  value >= 1000
    ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : value >= 1
      ? value.toFixed(4)
      : value.toPrecision(5);

export default function RiskDesk({ profile, setProfile, market }: Props) {
  const active = TRADING_PROFILES[profile];

  const [equity, setEquity] = useState("1000");
  const [riskPct, setRiskPct] = useState(String(active.defaultRiskPct));
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [leverage, setLeverage] = useState(String(active.maxLeverage));
  const [targetR, setTargetR] = useState(String(active.targetR));
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const liquidSymbols = useMemo(
    () =>
      market
        .filter((asset) => asset.quoteVolume >= 5_000_000)
        .slice(0, 200)
        .map((asset) => asset.symbol),
    [market],
  );

  const selectProfile = (id: ProfileId) => {
    const next = TRADING_PROFILES[id];
    setProfile(id);
    // The profile defines how this desk sizes risk, so its defaults load with it.
    setRiskPct(String(next.defaultRiskPct));
    setLeverage(String(next.maxLeverage));
    setTargetR(String(next.targetR));
    setChecked({});
  };

  const useMarketPrice = () => {
    const asset = market.find((item) => item.symbol === symbol);
    if (!asset) return;
    setEntry(String(asset.price));
    // Seed the stop from the observed 24H range so it starts on real structure
    // rather than an arbitrary percentage.
    const range =
      asset.high !== null && asset.low !== null && asset.high > asset.low
        ? asset.high - asset.low
        : asset.price * 0.02;
    setStop(String(Number((asset.price - range * 0.35).toPrecision(6))));
  };

  const result = calculateRisk({
    equity: Number(equity),
    riskPct: Number(riskPct),
    entry: Number(entry),
    stop: Number(stop),
    leverage: Number(leverage),
    targetR: Number(targetR),
  });

  const doneCount = active.discipline.filter((rule) => checked[rule]).length;
  const ready = doneCount === active.discipline.length && result.valid;

  return (
    <section className="panel risk-desk" id="riesgo">
      <div className="panel-head">
        <div>
          <p className="eyebrow">MESA DE RIESGO · TAMAÑO DESDE LA INVALIDACIÓN</p>
          <h2>Perfil operativo y calculadora</h2>
        </div>
        <span className="badge">{active.market}</span>
      </div>

      <div className="profile-switch">
        {PROFILE_ORDER.map((id) => {
          const item = TRADING_PROFILES[id];
          return (
            <button
              key={id}
              className={id === profile ? "active" : ""}
              onClick={() => selectProfile(id)}
            >
              <b>{item.name}</b>
              <small>{item.tagline}</small>
              <em>
                {item.horizon} · {item.market}
              </em>
            </button>
          );
        })}
      </div>

      <div className="profile-brief">
        <p>{active.focus}</p>
        <div className="profile-priorities">
          {active.priorities.map((priority) => (
            <span key={priority}>▸ {priority}</span>
          ))}
        </div>
      </div>

      <div className="risk-body">
        <div className="risk-form">
          <p className="risk-form-title">PARÁMETROS</p>

          <label className="risk-symbol">
            ACTIVO
            <div>
              <select value={symbol} onChange={(event) => setSymbol(event.target.value)}>
                {liquidSymbols.map((item) => (
                  <option key={item} value={item}>
                    {assetName(item)}/USDT
                  </option>
                ))}
              </select>
              <button onClick={useMarketPrice}>USAR PRECIO REAL</button>
            </div>
          </label>

          <div className="risk-fields">
            <label>
              CAPITAL (USDT)
              <input
                type="number"
                min="0"
                step="any"
                value={equity}
                onChange={(event) => setEquity(event.target.value)}
              />
            </label>
            <label>
              RIESGO POR OPERACIÓN (%)
              <input
                type="number"
                min="0.1"
                max="100"
                step="0.1"
                value={riskPct}
                onChange={(event) => setRiskPct(event.target.value)}
              />
            </label>
            <label>
              ENTRADA
              <input
                type="number"
                min="0"
                step="any"
                placeholder="0.00"
                value={entry}
                onChange={(event) => setEntry(event.target.value)}
              />
            </label>
            <label>
              INVALIDACIÓN (STOP)
              <input
                type="number"
                min="0"
                step="any"
                placeholder="0.00"
                value={stop}
                onChange={(event) => setStop(event.target.value)}
              />
            </label>
            <label>
              APALANCAMIENTO
              <select value={leverage} onChange={(event) => setLeverage(event.target.value)}>
                {[1, 2, 3, 5, 10, 20, 50].
                  filter((value) => value <= active.maxLeverage).
                  map((value) => (
                    <option key={value} value={value}>
                      {value}× {value === 1 ? "(SPOT)" : ""}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              OBJETIVO (R)
              <select value={targetR} onChange={(event) => setTargetR(event.target.value)}>
                {[1, 1.5, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>
                    {value}R
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="risk-output">
          <p className="risk-form-title">RESULTADO</p>

          {result.valid ? (
            <>
              <div className="risk-headline">
                <div>
                  <span>TAMAÑO DE POSICIÓN</span>
                  <b>
                    {result.units >= 1
                      ? result.units.toLocaleString("en-US", { maximumFractionDigits: 4 })
                      : result.units.toPrecision(4)}
                  </b>
                  <small>{assetName(symbol)}</small>
                </div>
                <div>
                  <span>NOCIONAL</span>
                  <b>{money(result.notional)}</b>
                  <small>{result.leverageUsed.toFixed(2)}× sobre capital</small>
                </div>
              </div>

              <div className="risk-grid">
                <div>
                  <span>DIRECCIÓN</span>
                  <b className={result.direction === "LONG" ? "positive" : "negative"}>
                    {result.direction}
                  </b>
                </div>
                <div>
                  <span>RIESGO ASUMIDO</span>
                  <b className="negative">−{money(result.riskAmount)}</b>
                </div>
                <div>
                  <span>DISTANCIA AL STOP</span>
                  <b>{result.stopDistancePct.toFixed(2)}%</b>
                </div>
                <div>
                  <span>MARGEN REQUERIDO</span>
                  <b>{money(result.marginRequired)}</b>
                </div>
                <div>
                  <span>OBJETIVO {targetR}R</span>
                  <b>{priceLabel(result.target)}</b>
                </div>
                <div>
                  <span>GANANCIA EN OBJETIVO</span>
                  <b className="positive">+{money(result.rewardAmount)}</b>
                </div>
                <div>
                  <span>LIQUIDACIÓN APROX.</span>
                  <b className={result.liquidationEstimate ? "negative" : ""}>
                    {result.liquidationEstimate
                      ? priceLabel(result.liquidationEstimate)
                      : "SIN APALANCAMIENTO"}
                  </b>
                </div>
                <div>
                  <span>EXPOSICIÓN SOBRE CAPITAL</span>
                  <b className={result.exposureOverEquity > 0 ? "negative" : ""}>
                    {result.exposureOverEquity > 0
                      ? `+${money(result.exposureOverEquity)}`
                      : "NINGUNA"}
                  </b>
                </div>
              </div>
            </>
          ) : (
            <div className="risk-placeholder">
              <b>DEFINÍ ENTRADA E INVALIDACIÓN</b>
              <span>
                El tamaño se calcula desde la distancia al stop. Sin invalidación no hay
                posición que dimensionar.
              </span>
            </div>
          )}

          {result.warnings.length > 0 && (
            <div className="risk-warnings">
              {result.warnings.map((warning) => (
                <span
                  key={warning}
                  className={warning.startsWith("LIQUIDACIÓN ANTES") ? "critical" : ""}
                >
                  ⚠ {warning}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="risk-discipline">
          <p className="risk-form-title">
            DISCIPLINA · {active.name.toUpperCase()}
            <em>
              {doneCount}/{active.discipline.length}
            </em>
          </p>
          <div className="discipline-list">
            {active.discipline.map((rule) => (
              <label key={rule} className={checked[rule] ? "done" : ""}>
                <input
                  type="checkbox"
                  checked={Boolean(checked[rule])}
                  onChange={(event) =>
                    setChecked((current) => ({ ...current, [rule]: event.target.checked }))
                  }
                />
                <span>{rule}</span>
              </label>
            ))}
          </div>
          <div className={ready ? "discipline-state ready" : "discipline-state"}>
            {ready
              ? "● CHECKLIST COMPLETA · PLAN DEFINIDO"
              : "○ PLAN INCOMPLETO"}
          </div>
        </div>
      </div>

      <p className="risk-footnote">
        El tamaño sale de la distancia a la invalidación, no del apalancamiento: el
        apalancamiento sólo limita cuánto nocional soporta la cuenta. La liquidación es una
        estimación de margen aislado que ignora margen de mantenimiento, comisiones y
        financiamiento, así que el precio real de liquidación en el exchange será algo peor.
        La herramienta dimensiona riesgo; no ejecuta órdenes ni constituye asesoramiento
        financiero.
      </p>
    </section>
  );
}
