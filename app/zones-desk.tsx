"use client";

import { useEffect, useState } from "react";
import { buildMtfZones, type MtfZoneBoard } from "@/lib/mtf-zones";
import { loadRows } from "@/lib/market-fetch";
import { parseSwingKlines } from "@/lib/swing-entries";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
/** Coarse to fine: a 4h zone frames what the 15m is doing inside it. */
const FRAMES = ["4h", "1h", "15m"];

const price = (value: number) =>
  value >= 1000
    ? value.toLocaleString("es-AR", { maximumFractionDigits: 0 })
    : value.toLocaleString("es-AR", { maximumFractionDigits: value >= 1 ? 2 : 6 });

export default function ZonesDesk() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [board, setBoard] = useState<MtfZoneBoard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    (async () => {
      setLoading(true);
      try {
        const series: { timeframe: string; candles: ReturnType<typeof parseSwingKlines> }[] = [];
        for (const timeframe of FRAMES) {
          const rows = await loadRows(symbol, timeframe, 400, controller.signal);
          if (!alive) return;
          const candles = parseSwingKlines(rows);
          if (candles.length >= 40) series.push({ timeframe, candles });
        }
        if (!alive) return;
        if (!series.length) {
          setError("ZONAS NO DISPONIBLES");
          setBoard(null);
          return;
        }
        const currentPrice = series[series.length - 1].candles.at(-1)!.close;
        const built = buildMtfZones(series, currentPrice);
        if (!built) {
          setError("SIN ZONAS VÁLIDAS EN ESTE MOMENTO");
          setBoard(null);
          return;
        }
        setBoard(built);
        setError("");
      } catch {
        if (alive) {
          setError("ZONAS NO DISPONIBLES");
          setBoard(null);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [symbol]);

  return (
    <section className="panel zones-desk" id="zonas">
      <div className="panel-head">
        <div>
          <p className="eyebrow">DEMANDA Y OFERTA · MULTI-TIMEFRAME</p>
          <h2>Dónde se defendió el precio</h2>
        </div>
        <span className={error ? "badge critical" : "badge"}>
          {loading ? "LEYENDO…" : error ? "NO DISPONIBLE" : FRAMES.join(" · ")}
        </span>
      </div>

      <p className="zones-premise">
        Una zona es una base tranquila seguida de una salida impulsiva. Se <b>valida</b> cuando el
        precio la toca y aguanta, y sólo <b>desaparece</b> cuando cierra del otro lado. Un toque
        respetado no la gasta: la confirma.
      </p>

      <div className="zones-symbols">
        {SYMBOLS.map((s) => (
          <button key={s} className={s === symbol ? "active" : ""} onClick={() => setSymbol(s)}>
            {s.replace("USDT", "")}
          </button>
        ))}
      </div>

      {loading && <p className="zones-loading">LEYENDO TRES MARCOS…</p>}
      {error && !loading && (
        <div className="zones-empty">
          <b>{error}</b>
          <span>No se completa con niveles inventados cuando no hay datos.</span>
        </div>
      )}

      {board && (
        <>
          <div className={`zones-reading ${board.standingIn ? board.standingIn.kind.toLowerCase() : ""}`}>
            {board.reading}
          </div>

          <div className="zones-list">
            {board.zones.slice(0, 8).map((zone) => (
              <div
                key={`${zone.kind}-${zone.timeframe}-${zone.index}`}
                className={`${zone.kind.toLowerCase()} ${zone.active ? "active" : ""}`}
              >
                <div className="zones-what">
                  <b>{zone.kind}</b>
                  <em>{zone.confluence.join(" · ")}</em>
                </div>
                <div className="zones-range">
                  <b>
                    {price(zone.low)} – {price(zone.high)}
                  </b>
                  <em>{zone.active ? "precio adentro" : `${zone.ageCandles} velas`}</em>
                </div>
                <div className="zones-tests">
                  <b>{zone.tests > 0 ? `${zone.tests}/${zone.tests}` : "—"}</b>
                  <em>{zone.tests > 0 ? "tests aguantados" : "sin testear"}</em>
                </div>
              </div>
            ))}
          </div>

          {/* The base rate, with its sample size beside it — a hold rate over
              three zones is not a probability and must not read like one. */}
          <div className="zones-stats">
            <h4>CUÁNTO AGUANTARON HISTÓRICAMENTE EN ESTA SERIE</h4>
            {board.stats.map(({ timeframe, stats }) => (
              <div key={timeframe}>
                <b>{timeframe}</b>
                <u>
                  {stats.holdRate !== null
                    ? `${(stats.holdRate * 100).toFixed(0)}%`
                    : "sin datos"}
                </u>
                <em>
                  {stats.tested > 0
                    ? `${stats.held} de ${stats.tested} zonas resueltas · ${stats.confidence.toLowerCase()}`
                    : "ninguna zona se resolvió todavía"}
                </em>
              </div>
            ))}
          </div>

          <p className="zones-caveat">
            <b>Qué es ese porcentaje.</b> No es una probabilidad: es la cuenta de lo que pasó en
            estas velas. Una zona se cuenta como resuelta cuando fue testeada o rota, y las rotas
            entran en el denominador — contar sólo las que sobreviven daría casi 100% siempre. Con
            menos de ocho zonas resueltas el número no alcanza para concluir nada, y por eso el
            tamaño de muestra va al lado.
          </p>
        </>
      )}
    </section>
  );
}
