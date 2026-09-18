"use client";

import { useEffect, useState } from "react";
import {
  buildOverhangBoard,
  type OverhangBoard,
  type SupplyOverhang,
} from "@/lib/token-unlocks";

const FALLBACK_WATCHLIST = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];

const usd = (value: number) => {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
};

/** How hard the remaining supply weighs against today's float. */
const band = (ratio: number) => {
  if (ratio >= 1) return "alto";
  if (ratio >= 0.35) return "medio";
  return "bajo";
};

const bandLabel = (ratio: number) => {
  if (ratio >= 1) return "PUEDE MÁS QUE DUPLICAR EL FLOTANTE";
  if (ratio >= 0.35) return "DILUCIÓN RELEVANTE PENDIENTE";
  return "POCA OFERTA PENDIENTE";
};

export default function UnlockDesk({ watchlist }: { watchlist?: string[] }) {
  const [board, setBoard] = useState<OverhangBoard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const symbolKey = (watchlist?.length ? watchlist : FALLBACK_WATCHLIST).join(",");

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    (async () => {
      try {
        // From the browser: CoinGecko blocks datacenter addresses, the same
        // reason api/klines exists. A visitor's own connection is not blocked.
        const response = await fetch(
          "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false",
          { signal: controller.signal },
        );
        if (!alive) return;
        if (!response.ok) {
          setError("OFERTA PENDIENTE NO DISPONIBLE");
          return;
        }
        const built = buildOverhangBoard(await response.json(), symbolKey.split(","));
        if (!alive) return;
        if (!built) {
          setError("OFERTA PENDIENTE NO DISPONIBLE");
          return;
        }
        setBoard(built);
      } catch {
        if (alive) setError("OFERTA PENDIENTE NO DISPONIBLE");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [symbolKey]);

  const rows: SupplyOverhang[] = board
    ? showAll
      ? board.ranked.slice(0, 25)
      : board.watched
    : [];

  return (
    <section className="panel unlock-desk" id="desbloqueos">
      <div className="panel-head">
        <div>
          <p className="eyebrow">OFERTA PENDIENTE · DILUCIÓN POR VENIR</p>
          <h2>Cuánto supply falta que entre</h2>
        </div>
        <span className={error ? "badge critical" : "badge"}>
          {loading ? "CARGANDO…" : error ? "NO DISPONIBLE" : `${board?.scanned ?? 0} TOKENS`}
        </span>
      </div>

      <p className="unlock-premise">
        La diferencia entre lo que circula y el total es todo lo que todavía se le debe a fondos,
        equipo y tesorería. Comparada con la capitalización de hoy, dice cuánto puede diluirse el
        precio cuando esa oferta llegue. Un token con el 80% sin circular carga ese peso aunque no
        se sepa la fecha.
      </p>

      {/* Said openly rather than implied: the dated calendar is not free. */}
      <p className="unlock-scope">
        <b>Esto mide tamaño, no fecha.</b> El calendario con fechas exactas de cada desbloqueo sólo
        lo publican proveedores de pago. Lo que sí es verificable gratis es cuánta oferta falta, y
        es lo que se muestra acá.
      </p>

      {loading && <p className="unlock-loading">LEYENDO OFERTA…</p>}
      {error && !loading && (
        <div className="unlock-empty">
          <b>{error}</b>
          <span>No se completa con estimaciones cuando la fuente no responde.</span>
        </div>
      )}

      {board && (
        <>
          <div className="unlock-tabs">
            <button className={!showAll ? "active" : ""} onClick={() => setShowAll(false)}>
              TUS PARES ({board.watched.length})
            </button>
            <button className={showAll ? "active" : ""} onClick={() => setShowAll(true)}>
              MAYOR DILUCIÓN ({board.ranked.length})
            </button>
          </div>

          {rows.length === 0 ? (
            <div className="unlock-empty">
              <b>SIN DATOS DE TUS PARES</b>
              <span>Mirá el ranking general para ver dónde pesa la oferta pendiente.</span>
            </div>
          ) : (
            <div className="unlock-list">
              {rows.map((row) => (
                <div
                  key={row.symbol}
                  className={`${row.onWatchlist ? "watched" : ""} w-${band(row.overhangRatio)}`}
                >
                  <div className="unlock-who">
                    <b>{row.symbol}</b>
                    <em>{row.name}</em>
                  </div>
                  <div className="unlock-when">
                    <b>{row.unlockedPct.toFixed(0)}%</b>
                    <em>ya circula</em>
                  </div>
                  <div className="unlock-size">
                    <b>{usd(row.lockedValueUsd)}</b>
                    <em>{row.overhangRatio.toFixed(2)}× el cap actual</em>
                  </div>
                  <span className={`unlock-audience a-${band(row.overhangRatio)}`}>
                    {bandLabel(row.overhangRatio)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <p className="unlock-caveat">
            <b>Cómo leerlo.</b> {board.caveat} Un ratio de 1,00× significa que la oferta pendiente
            vale tanto como todo lo que circula hoy: si entra, el flotante se duplica. Fuente:{" "}
            {board.source}.
          </p>
        </>
      )}
    </section>
  );
}
