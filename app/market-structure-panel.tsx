"use client";

import { stablecoinRegime, type MarketStructure } from "@/lib/market-structure";

const cap = (value: number | null) => {
  if (value === null) return "—";
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${value.toFixed(0)}`;
};

const pct = (value: number | null, digits = 2) =>
  value === null ? "—" : `${value.toFixed(digits)}%`;

const signed = (value: number | null) =>
  value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

function DominanceBar({
  label,
  value,
  tone,
  note,
}: {
  label: string;
  value: number | null;
  tone: string;
  note?: string;
}) {
  return (
    <div className="dom-bar">
      <span>{label}</span>
      <i>
        <b className={tone} style={{ width: `${Math.min(100, value ?? 0)}%` }} />
      </i>
      <em>{pct(value)}</em>
      {note && <small>{note}</small>}
    </div>
  );
}

export default function MarketStructurePanel({
  data,
  error,
}: {
  data: MarketStructure | null;
  error: string;
}) {
  const regime = stablecoinRegime(data?.dominance.usdt ?? null);

  return (
    <article className="panel structure-panel" id="estructura">
      <div className="panel-head">
        <div>
          <p className="eyebrow">ESTRUCTURA GLOBAL · CAPITALIZACIÓN Y DOMINANCIA</p>
          <h2>Market cap y dominancia</h2>
        </div>
        <span className={error ? "badge critical" : "badge"}>
          {error ? "DATOS PARCIALES" : data?.source ?? "CARGANDO…"}
        </span>
      </div>

      <div className="structure-caps">
        <div>
          <span>TOTAL</span>
          <b>{cap(data?.totalMarketCap ?? null)}</b>
          <small className={(data?.marketCapChange24h ?? 0) >= 0 ? "positive" : "negative"}>
            {signed(data?.marketCapChange24h ?? null)} 24H
          </small>
        </div>
        <div>
          <span>TOTAL2</span>
          <b>{cap(data?.total2 ?? null)}</b>
          <small>MERCADO SIN BTC</small>
        </div>
        <div>
          <span>TOTAL3</span>
          <b>{cap(data?.total3 ?? null)}</b>
          <small>SIN BTC NI ETH</small>
        </div>
        <div>
          <span>VOLUMEN 24H</span>
          <b>{cap(data?.totalVolume24h ?? null)}</b>
          <small>TODO EL MERCADO</small>
        </div>
      </div>

      <div className="structure-dominance">
        <p className="key-readings-title">REPARTO DEL CAPITAL</p>
        <DominanceBar label="BTC.D" value={data?.dominance.btc ?? null} tone="btc" />
        <DominanceBar label="ETH.D" value={data?.dominance.eth ?? null} tone="eth" />
        <DominanceBar
          label="ALT.D"
          value={data?.dominance.altcoins ?? null}
          tone="alt"
          note="Todo lo que no es BTC ni ETH, stablecoins incluidas"
        />
        <DominanceBar
          label="USDT.D"
          value={data?.dominance.usdt ?? null}
          tone="stable"
          note="Capital estacionado fuera de riesgo"
        />
        <DominanceBar label="USDC.D" value={data?.dominance.usdc ?? null} tone="stable" />
      </div>

      <div className={`stable-regime tone-${regime.tone}`}>
        <div>
          <span>LECTURA DE STABLECOINS</span>
          <b>{regime.label}</b>
        </div>
        <p>{regime.reading}</p>
        <div className="stable-figures">
          <span>
            USDT + USDC <b>{pct(data?.dominance.stablecoins ?? null)}</b>
          </span>
          <span>
            EQUIVALE A{" "}
            <b>
              {cap(
                data && data.dominance.stablecoins !== null && data.totalMarketCap !== null
                  ? data.totalMarketCap * (data.dominance.stablecoins / 100)
                  : null,
              )}
            </b>{" "}
            AL MARGEN
          </span>
        </div>
      </div>

      <p className="structure-footnote">
        TOTAL2 y TOTAL3 no son un feed aparte: son definiciones. TOTAL2 es la capitalización
        total menos BTC, y TOTAL3 menos BTC y ETH, así que se derivan de la dominancia
        publicada en lugar de mostrarse como no disponibles. La dominancia de stablecoins se
        lee al revés que el resto: cuando sube, hay capital esperando afuera; cuando baja, ese
        capital volvió al mercado. Es contexto de régimen, no una señal de entrada.
      </p>
    </article>
  );
}
