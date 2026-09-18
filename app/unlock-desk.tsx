"use client";

import { useEffect, useState } from "react";
import { buildUnlockBoard, type TokenUnlock, type UnlockBoard } from "@/lib/token-unlocks";

const FALLBACK_WATCHLIST = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];

const usd = (value: number) => {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
};

const when = (unlock: TokenUnlock) => {
  if (unlock.daysAway === 0) return "hoy";
  if (unlock.daysAway === 1) return "mañana";
  return `en ${unlock.daysAway} días`;
};

/** Dilution bands. A 1% unlock is routine; past 5% it is a supply event. */
const weight = (unlock: TokenUnlock) => {
  if (unlock.pctOfMcap === null) return "";
  if (unlock.pctOfMcap >= 5) return "alto";
  if (unlock.pctOfMcap >= 1.5) return "medio";
  return "bajo";
};

export default function UnlockDesk({ watchlist }: { watchlist?: string[] }) {
  const [board, setBoard] = useState<UnlockBoard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  // A stable key for the effect: the array identity changes on every parent
  // render even when the pairs are the same, which would refetch endlessly.
  const symbolKey = (watchlist?.length ? watchlist : FALLBACK_WATCHLIST).join(",");

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    (async () => {
      try {
        // Fetched from the browser for the same reason the heatmap is: the
        // Worker's own address is blocked by several of these upstreams.
        const response = await fetch("https://api.llama.fi/emissions", {
          signal: controller.signal,
        });
        if (!alive) return;
        if (!response.ok) {
          setError("CALENDARIO NO DISPONIBLE");
          return;
        }
        const built = buildUnlockBoard(await response.json(), symbolKey.split(","));
        if (!alive) return;
        if (!built) {
          setError("SIN DESBLOQUEOS PRÓXIMOS");
          return;
        }
        setBoard(built);
      } catch {
        if (alive) setError("CALENDARIO NO DISPONIBLE");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [symbolKey]);

  const rows = board ? (showAll ? board.upcoming.slice(0, 40) : board.watched) : [];

  return (
    <section className="panel unlock-desk" id="desbloqueos">
      <div className="panel-head">
        <div>
          <p className="eyebrow">DESBLOQUEOS · OFERTA PROGRAMADA</p>
          <h2>Qué supply entra al mercado</h2>
        </div>
        <span className={error ? "badge critical" : "badge"}>
          {loading ? "CARGANDO…" : error ? "NO DISPONIBLE" : `${board?.projectsScanned ?? 0} PROYECTOS`}
        </span>
      </div>

      <p className="unlock-premise">
        Los fondos que entran en rondas privadas compran a un precio que el mercado no ve, y esos
        tokens se liberan por calendario. Cada desbloqueo pone oferta en manos con un costo muy por
        debajo del precio actual. Es de lo poco del futuro que está escrito de antemano.
      </p>

      {loading && <p className="unlock-loading">LEYENDO CALENDARIO…</p>}
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
              TODO EL MERCADO ({board.upcoming.length})
            </button>
          </div>

          {rows.length === 0 ? (
            <div className="unlock-empty">
              <b>SIN DESBLOQUEOS EN TUS PARES</b>
              <span>
                Ninguno de los pares que seguís tiene un desbloqueo programado en los próximos 60
                días. Mirá el mercado completo para ver dónde sí los hay.
              </span>
            </div>
          ) : (
            <div className="unlock-list">
              {rows.map((unlock) => (
                <div
                  key={`${unlock.name}-${unlock.date}`}
                  className={`${unlock.onWatchlist ? "watched" : ""} w-${weight(unlock)}`}
                >
                  <div className="unlock-who">
                    <b>{unlock.symbol ?? unlock.name}</b>
                    <em>{unlock.name}</em>
                  </div>
                  <div className="unlock-when">
                    <b>{when(unlock)}</b>
                    <em>{new Date(unlock.date).toLocaleDateString("es-AR")}</em>
                  </div>
                  <div className="unlock-size">
                    <b>{unlock.valueUsd !== null ? usd(unlock.valueUsd) : "—"}</b>
                    <em>
                      {unlock.pctOfMcap !== null
                        ? `${unlock.pctOfMcap.toFixed(2)}% del cap`
                        : "tamaño no publicado"}
                    </em>
                  </div>
                  <span className={`unlock-audience a-${unlock.audience.toLowerCase()}`}>
                    {unlock.audience}
                  </span>
                </div>
              ))}
            </div>
          )}

          <p className="unlock-caveat">
            <b>Cómo leerlo.</b> {board.caveat} Un desbloqueo para inversores o equipo pesa más que
            uno de ecosistema: esos tenedores suelen estar muy arriba en ganancia y con mandato de
            realizarla. Fuente: {board.source}.
          </p>
        </>
      )}
    </section>
  );
}
