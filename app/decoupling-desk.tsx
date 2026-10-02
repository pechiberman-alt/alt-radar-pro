"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { openInMap } from "@/lib/account-events";
import { eligible, replayDecoupling, scanDecoupled, type CoinRead, type HourCandle, type Series } from "@/lib/decoupling";
import { loadRows, loadTopSymbols } from "@/lib/market-fetch";

/** How many of the most traded perpetuals are read, besides BTC and ETH. */
const UNIVERSE = 60;
const HOURS = 170;
const WINDOWS = {
  "4h": { window: 4, minRet: 1.5, maxMarket: 0.3, minAlpha: 1.5, lookback: 72, forward: 4, label: "4 HORAS" },
  "24h": { window: 24, minRet: 4, maxMarket: 1, minAlpha: 3, lookback: 72, forward: 12, label: "24 HORAS" },
} as const;
type WindowKey = keyof typeof WINDOWS;

const pct = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d).replace(".", ",")}%`;
const coin = (s: string) => s.replace(/USDT$/, "");

function toHours(rows: unknown, now: number): HourCandle[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => r as (string | number)[])
    // Only closed hours: the forming one would change while being read.
    .filter((r) => Array.isArray(r) && Number(r[6]) < now)
    .map((r) => ({ time: Number(r[0]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), quoteVolume: Number(r[7]) }))
    .filter((c) => c.close > 0 && Number.isFinite(c.time));
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

function useMounted() {
  return useSyncExternalStore(() => () => undefined, () => true, () => false);
}

function Flags({ r }: { r: CoinRead }) {
  const flags: [string, string][] = [];
  if (r.rvol !== null && r.rvol >= 1.5) flags.push(["up", `con volumen ${r.rvol.toFixed(1).replace(".", ",")}×`]);
  else if (r.rvol !== null && r.rvol < 1) flags.push(["warn", "sin volumen"]);
  if (r.corr !== null && r.corr < 0.5) flags.push(["up", "va por su cuenta"]);
  if (r.sustained >= 0.75) flags.push(["up", "sostenido"]);
  if (r.oneCandle >= 0.7) flags.push(["warn", "casi todo en 1 vela"]);
  return (
    <span className="dc-flags">
      {flags.map(([tone, text]) => (
        <i key={text} className={tone}>{text}</i>
      ))}
    </span>
  );
}

function Table({ rows }: { rows: CoinRead[] }) {
  return (
    <div className="dc-table">
      <table>
        <thead>
          <tr><th>Moneda</th><th>Sube</th><th>Fuerza propia</th><th>Sigue a BTC</th><th>Señales</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol}>
              <td><button className="dc-coin" onClick={() => openInMap(r.symbol)} title="Abrir en el MAPA">{coin(r.symbol)} ↗</button></td>
              <td className={r.ret >= 0 ? "up" : "down"}>{pct(r.ret)}</td>
              <td className={r.alpha >= 0 ? "up" : "down"}><b>{pct(r.alpha)}</b></td>
              <td>{r.corr === null ? "—" : r.corr.toFixed(2).replace(".", ",")}</td>
              <td><Flags r={r} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DecouplingDesk() {
  const mounted = useMounted();
  return mounted ? <Inner /> : <section className="panel dc-desk" id="desacople"><p className="bot-none">Cargando…</p></section>;
}

function Inner() {
  const [data, setData] = useState<{ universe: Series[]; btc: Series; eth: Series; at: number } | null>(null);
  const [progress, setProgress] = useState<string>("Leyendo las monedas más operadas…");
  const [error, setError] = useState<string | null>(null);
  const [win, setWin] = useState<WindowKey>("4h");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    (async () => {
      try {
        const ranked = await loadTopSymbols(controller.signal);
        if (!alive) return;
        const symbols = (ranked ?? []).filter(eligible).slice(0, UNIVERSE);
        if (!symbols.length) throw new Error("Binance no devolvió la lista de monedas.");
        const now = Date.now();
        let done = 0;
        const load = async (symbol: string): Promise<Series | null> => {
          try {
            const rows = await loadRows(symbol, "1h", HOURS, controller.signal);
            return { symbol, candles: toHours(rows, now) };
          } catch {
            return null;
          } finally {
            done += 1;
            if (alive && done % 6 === 0) setProgress(`Leyendo ${done} de ${symbols.length + 2} monedas…`);
          }
        };
        const [btc, eth] = await Promise.all([load("BTCUSDT"), load("ETHUSDT")]);
        if (!btc || !eth || btc.candles.length < 100) throw new Error("No se pudo leer BTC o ETH.");
        const universe = (await pool(symbols, 6, load)).filter((s): s is Series => s !== null && s.candles.length >= 100);
        if (!alive) return;
        setData({ universe, btc, eth, at: Date.now() });
        setError(null);
      } catch (e) {
        if (alive && !controller.signal.aborted) setError(e instanceof Error ? e.message : "No se pudo leer el mercado.");
      }
    })();
    // Every 5 minutes while the tab is in view; a hidden tab doesn't need it.
    const timer = window.setInterval(() => {
      if (!document.hidden) setReload((n) => n + 1);
    }, 300_000);
    return () => {
      alive = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [reload]);

  const cfg = WINDOWS[win];
  const scan = useMemo(() => (data ? scanDecoupled(data.universe, data.btc, data.eth, cfg) : null), [data, cfg]);
  const replay = useMemo(() => (data ? replayDecoupling(data.universe, data.btc, data.eth, cfg) : null), [data, cfg]);

  return (
    <section className="panel dc-desk" id="desacople">
      <div className="panel-head">
        <div>
          <p className="eyebrow">SUBEN SOLAS · DESACOPLE DE BTC Y ETH</p>
          <h2>Monedas que suben por su cuenta</h2>
        </div>
        <span className="badge">{data ? `${data.universe.length} monedas · ${new Date(data.at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}` : "CARGANDO"}</span>
      </div>

      <div className="dc-controls">
        {(Object.keys(WINDOWS) as WindowKey[]).map((k) => (
          <button key={k} className={win === k ? "on" : ""} onClick={() => setWin(k)} aria-pressed={win === k}>{WINDOWS[k].label}</button>
        ))}
        <button onClick={() => setReload((n) => n + 1)}>ACTUALIZAR</button>
      </div>

      {error && <p className="bot-sample thin">⚠ {error}</p>}
      {!data && !error && <p className="bot-none">{progress}</p>}

      {scan && (
        <>
          <p className={`dc-context ${scan.marketUp ? "warn" : ""}`}>
            En las últimas {cfg.window} horas: BTC {pct(scan.btcRet, 2)} · ETH {pct(scan.ethRet, 2)}.{" "}
            {scan.marketUp
              ? "BTC o ETH están subiendo, así que lo que sube puede estar yendo con el mercado: abajo van los que más le ganan a BTC, pero no cuentan como «solas»."
              : "BTC y ETH no están subiendo: lo que aparece abajo sube con compradores propios."}
          </p>

          {scan.rising.length ? (
            <Table rows={scan.rising} />
          ) : (
            <>
              <p className="bot-none">
                {scan.marketUp ? "Con el mercado subiendo no se marca ninguna como «sola»." : "Ahora ninguna sube sola con la fuerza mínima."} Los que más le ganan a BTC en este momento:
              </p>
              <Table rows={scan.leaders.slice(0, 6)} />
            </>
          )}

          {replay && (
            <p className={`dc-record ${replay.confidence !== "MUESTRA RAZONABLE" ? "warn" : (replay.rate ?? 0) >= 0.5 ? "up" : "down"}`}>
              {replay.rate === null
                ? "Medición: en los últimos días no hubo casos para medir."
                : `Medición en los últimos ~7 días: cuando una moneda cumplió esto, en las ${cfg.forward} horas siguientes le siguió ganando a BTC en ${replay.followed} de ${replay.instances} casos (${Math.round(replay.rate * 100)}%) · fuerza propia media después: ${pct(replay.meanForwardAlpha ?? 0, 2)} · ${replay.confidence.toLowerCase()}.`}
            </p>
          )}

          <small className="dc-foot">
            «Fuerza propia» es lo que sube la moneda descontando lo que suele moverse con BTC (calculado con las 72 horas anteriores, sin
            usar la suba misma). Para que cuente: sube al menos {cfg.minRet.toString().replace(".", ",")}%, BTC y ETH no más de{" "}
            {cfg.maxMarket.toString().replace(".", ",")}%, y fuerza propia de {cfg.minAlpha.toString().replace(".", ",")}% o más. Ojo: si BTC cae
            fuerte, casi todas caen con él, y una suba de una sola vela sin volumen suele devolverse. Lee las {UNIVERSE} monedas con más volumen
            en futuros, con velas cerradas de 1 hora. No es asesoramiento financiero.
          </small>
        </>
      )}
    </section>
  );
}
