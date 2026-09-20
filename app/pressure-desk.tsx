"use client";

import { useEffect, useState } from "react";
import { rankPressure, type PressureReading } from "@/lib/pump-pressure";
import { FUTURES_BASES, loadRows } from "@/lib/market-fetch";
import { parseSwingKlines } from "@/lib/swing-entries";

const WATCHED = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
  "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "SUIUSDT",
];
const TIMEFRAME = "1h";

/** Open interest change over the same window the candles cover. */
async function loadOiChange(symbol: string, signal: AbortSignal): Promise<number | null> {
  for (const base of FUTURES_BASES) {
    try {
      const response = await fetch(
        `${base}/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=24`,
        { signal },
      );
      if (!response.ok) continue;
      const rows = (await response.json()) as { sumOpenInterest?: string }[];
      if (!Array.isArray(rows) || rows.length < 2) continue;
      const first = Number(rows[0]?.sumOpenInterest);
      const last = Number(rows[rows.length - 1]?.sumOpenInterest);
      if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0) continue;
      return last / first - 1;
    } catch {
      // Next mirror.
    }
  }
  return null;
}

async function loadFunding(symbol: string, signal: AbortSignal): Promise<number | null> {
  for (const base of FUTURES_BASES) {
    try {
      const response = await fetch(`${base}/fapi/v1/premiumIndex?symbol=${symbol}`, { signal });
      if (!response.ok) continue;
      const body = (await response.json()) as { lastFundingRate?: string };
      const rate = Number(body.lastFundingRate);
      return Number.isFinite(rate) ? rate : null;
    } catch {
      // Next mirror.
    }
  }
  return null;
}

export default function PressureDesk() {
  const [readings, setReadings] = useState<PressureReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), 300_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    (async () => {
      setLoading(true);
      const inputs: Parameters<typeof rankPressure>[0] = [];
      for (const symbol of WATCHED) {
        try {
          const rows = await loadRows(symbol, TIMEFRAME, 200, controller.signal);
          if (!alive) return;
          const candles = parseSwingKlines(rows);
          if (candles.length < 60) continue;
          const [oiChange, funding] = await Promise.all([
            loadOiChange(symbol, controller.signal),
            loadFunding(symbol, controller.signal),
          ]);
          if (!alive) return;
          inputs.push({ symbol, candles, oiChange, funding });
        } catch {
          // One symbol failing must not empty the ranking.
        }
      }
      if (!alive) return;
      const ranked = rankPressure(inputs);
      setReadings(ranked);
      setError(ranked.length ? "" : "PRESIÓN NO DISPONIBLE");
      setLoading(false);
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [tick]);

  const coiled = readings.filter((reading) => reading.pressure >= 55).length;

  return (
    <section className="panel pres-desk" id="presion">
      <div className="panel-head">
        <div>
          <p className="eyebrow">PRESIÓN · ANTES DEL MOVIMIENTO</p>
          <h2>Qué está comprimido</h2>
        </div>
        <span className={error ? "badge critical" : "badge"}>
          {loading ? "MIDIENDO…" : error ? "NO DISPONIBLE" : `${coiled}/${readings.length} CARGADOS`}
        </span>
      </div>

      {/* The distinction the whole panel is built on, stated before the data. */}
      <p className="pres-premise">
        Esto no dice qué va a pumpear. Dice <b>qué está comprimido</b>. Un rango que se estrechó
        mucho rara vez sigue así: lo probable es un movimiento fuerte. Hacia dónde es otra
        pregunta, y por eso va en una columna aparte en vez de mezclada en el mismo número.
      </p>

      {loading && <p className="pres-loading">MIDIENDO COMPRESIÓN EN {WATCHED.length} PARES…</p>}
      {error && !loading && (
        <div className="pres-empty">
          <b>{error}</b>
          <span>No se completa con estimaciones cuando la fuente no responde.</span>
        </div>
      )}

      {readings.length > 0 && (
        <>
          <div className="pres-list">
            {readings.map((reading) => (
              <div
                key={reading.symbol}
                className={reading.pressure >= 65 ? "hot" : reading.pressure >= 40 ? "warm" : ""}
              >
                <b className="pres-sym">{reading.symbol.replace("USDT", "")}</b>
                <div className="pres-bar">
                  <i style={{ width: `${reading.pressure}%` }} />
                </div>
                <u className="pres-score">{reading.pressure}</u>
                <span className={`pres-bias b-${reading.biasLabel.split(" ").pop()?.toLowerCase()}`}>
                  {reading.biasLabel === "SIN SESGO" ? "—" : reading.biasLabel.replace("SESGO ", "")}
                </span>
                {reading.drivers.length > 0 && (
                  <em className="pres-why">{reading.drivers.join(" · ")}</em>
                )}
              </div>
            ))}
          </div>

          <div className="pres-legend">
            <span><i className="hot" />≥ 65 muy comprimido</span>
            <span><i className="warm" />40 a 65 en observación</span>
            <span><i className="cold" />&lt; 40 rango normal</span>
          </div>

          <p className="pres-caveat">
            <b>Cómo se calcula.</b> La presión sale del rango reciente contra su propia media (lo
            que más pesa, porque la volatilidad se agrupa y vuelve a su media), más volumen
            sostenido sin avance de precio y cuántas velas lleva dentro del mismo rango. El sesgo es
            otra cosa: sale del cambio de open interest y del funding. Cuando el funding es
            negativo los cortos le pagan a los largos, y unos cortos amontonados son combustible
            para un squeeze al alza. Esa evidencia es más débil que la compresión, así que se
            informa por separado y nunca se suma al puntaje.
          </p>
        </>
      )}
    </section>
  );
}
