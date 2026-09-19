"use client";

import { useEffect, useState } from "react";
import { buildBigTradeBoard, type BigTradeBoard } from "@/lib/big-trades";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
const FUTURES_BASES = [
  "https://fapi.binance.com",
  "https://fapi1.binance.com",
  "https://fapi2.binance.com",
];

const usd = (value: number) => {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
};

const clock = (time: number) =>
  new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function BigTradesDesk() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [board, setBoard] = useState<BigTradeBoard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  // Executed trades move fast; a minute is already stale on a liquid pair.
  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    const isRefresh = tick > 0;

    (async () => {
      for (const base of FUTURES_BASES) {
        try {
          const response = await fetch(
            `${base}/fapi/v1/aggTrades?symbol=${symbol}&limit=1000`,
            { signal: controller.signal },
          );
          if (!response.ok) continue;
          const built = buildBigTradeBoard(symbol, await response.json());
          if (!alive) return;
          if (built) {
            setBoard(built);
            setError("");
            setLoading(false);
            return;
          }
        } catch {
          // Next mirror.
        }
      }
      if (!alive) return;
      // A failed refresh must not wipe the board the reader is looking at.
      if (!isRefresh) {
        setError("CINTA NO DISPONIBLE");
        setBoard(null);
      }
      setLoading(false);
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [symbol, tick]);

  const selectSymbol = (next: string) => {
    setLoading(true);
    setError("");
    setBoard(null);
    setTick(0);
    setSymbol(next);
  };

  return (
    <section className="panel bigt-desk" id="ordenes-grandes">
      <div className="panel-head">
        <div>
          <p className="eyebrow">ÓRDENES GRANDES · DINERO EJECUTADO</p>
          <h2>Quién está entrando con tamaño</h2>
        </div>
        <span className={error ? "badge critical" : "badge"}>
          {loading ? "LEYENDO…" : error ? "NO DISPONIBLE" : "EN VIVO"}
        </span>
      </div>

      <p className="bigt-premise">
        Una orden en el libro se puede cancelar — eso es lo que hace el spoofing. Una operación
        ejecutada no. Por eso esto mide dinero comprometido y no intención. Lo que importa de cada
        una no es el volumen sino <b>quién cruzó el spread</b>: pagar peor precio con tal de entrar
        ya es urgencia, y la urgencia deja huella.
      </p>

      <div className="bigt-symbols">
        {SYMBOLS.map((s) => (
          <button key={s} className={s === symbol ? "active" : ""} onClick={() => selectSymbol(s)}>
            {s.replace("USDT", "")}
          </button>
        ))}
      </div>

      {loading && <p className="bigt-loading">LEYENDO LA CINTA…</p>}
      {error && !loading && (
        <div className="bigt-empty">
          <b>{error}</b>
          <span>No se completa con estimaciones cuando la fuente no responde.</span>
        </div>
      )}

      {board && (
        <>
          <div className={`bigt-bias b-${board.bias.split(" ")[0].toLowerCase()}`}>
            <div>
              <span>SESGO DEL DINERO GRANDE</span>
              <h3>{board.bias}</h3>
              <p>{board.reading}</p>
            </div>
            <div className="bigt-figures">
              <div>
                <span>NETO</span>
                <b className={board.netUsd >= 0 ? "positive" : "negative"}>{usd(board.netUsd)}</b>
              </div>
              <div>
                <span>COMPRA</span>
                <b>{board.buyShare.toFixed(0)}%</b>
              </div>
            </div>
          </div>

          <div className="bigt-scale">
            <i className="buy" style={{ width: `${board.buyShare}%` }} />
            <i className="sell" style={{ width: `${100 - board.buyShare}%` }} />
          </div>
          <small className="bigt-meta">
            Grande = desde {usd(board.thresholdUsd)} · {board.trades.length} operaciones en los
            últimos {board.windowMinutes} min · umbral calculado sobre la cinta de este par
          </small>

          <div className="bigt-list">
            {board.trades.map((trade) => (
              <div key={`${trade.time}-${trade.notional}`} className={trade.side === "COMPRA" ? "buy" : "sell"}>
                <b>{trade.side}</b>
                <u>{usd(trade.notional)}</u>
                <em>{trade.price.toLocaleString("es-AR", { maximumFractionDigits: 2 })}</em>
                <i>{clock(trade.time)}</i>
              </div>
            ))}
          </div>

          <p className="bigt-caveat">
            <b>Qué no dice.</b> No identifica a nadie. Una operación grande puede ser una mesa, un
            creador de mercado cubriéndose, o un algoritmo partiendo una orden madre — no hay dato
            público que distinga cuál. «Grande» describe tamaño y urgencia, nunca identidad. Fuente:{" "}
            {board.source}.
          </p>
        </>
      )}
    </section>
  );
}
