"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onSession, openAccount } from "@/lib/account-events";
import type { FuturesPositionView, FuturesSummaryView } from "@/lib/futures-risk";
import { isNearLiquidation } from "@/lib/futures-risk";
import SignInPrompt from "./sign-in-prompt";

const POLL_MS = 5000;

const usd = (v: number) =>
  `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("es-AR", { maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 })}`;
const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
const px = (v: number) =>
  v >= 1000 ? v.toLocaleString("es-AR", { maximumFractionDigits: 0 }) : v.toLocaleString("es-AR", { maximumFractionDigits: v >= 1 ? 3 : 6 });

export default function FuturesDesk() {
  const [authState, setAuthState] = useState<"loading" | "in" | "out">("loading");
  const [linked, setLinked] = useState<boolean | null>(null);
  const [positions, setPositions] = useState<FuturesPositionView[]>([]);
  const [summary, setSummary] = useState<FuturesSummaryView | null>(null);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [polling, setPolling] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/binance/futures", { cache: "no-store" });
      if (r.status === 401) {
        setAuthState("out");
        return;
      }
      setAuthState("in");
      if (r.status === 404) {
        setLinked(false);
        return;
      }
      setLinked(true);
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? "NO SE PUDO LEER FUTUROS");
        return;
      }
      const body = (await r.json()) as { positions: FuturesPositionView[]; summary: FuturesSummaryView; updateTime: number };
      setPositions(body.positions);
      setSummary(body.summary);
      setUpdatedAt(body.updateTime);
      setError("");
    } catch {
      setError("SIN CONEXIÓN CON EL SERVIDOR");
    }
  }, []);

  // Polled, not pushed: a true user-data WebSocket needs a listenKey the
  // Worker must keep renewing every <60 min. For a dashboard (not an
  // execution surface), a 5s poll is close enough to "corriendo" that the
  // difference isn't perceptible, without that extra lifecycle to maintain.
  // Paused while the tab is hidden, so a forgotten background tab doesn't
  // keep polling Binance for no one to see it.
  const visibleRef = useRef(true);
  useEffect(() => {
    const onVisible = () => {
      visibleRef.current = document.visibilityState === "visible";
      setPolling(visibleRef.current);
      if (visibleRef.current) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  useEffect(() => {
    (async () => {
      await load();
    })();
    const id = window.setInterval(() => {
      if (visibleRef.current) void load();
    }, POLL_MS);
    const offSession = onSession(() => void load());
    return () => {
      window.clearInterval(id);
      offSession();
    };
  }, [load]);

  const nearLiq = positions.filter((p) => isNearLiquidation(p.distanceToLiquidationPct));

  return (
    <section className="panel futures-desk" id="futuros">
      <div className="panel-head">
        <div>
          <p className="eyebrow">MI CARTERA · BINANCE FUTUROS (USDⓈ-M)</p>
          <h2>Contratos abiertos, PNL y distancia a liquidación</h2>
        </div>
        <span className={authState === "out" || linked === false || nearLiq.length ? "badge critical" : "badge"}>
          {authState === "loading"
            ? "CARGANDO…"
            : authState === "out"
              ? "SIN SESIÓN"
              : linked === false
                ? "SIN VINCULAR"
                : `${positions.length} ABIERTAS${polling ? " · EN VIVO" : " · PAUSADO"}`}
        </span>
      </div>

      <p className="fd-warn">
        A diferencia de spot, Binance no tiene un permiso de Futuros &quot;solo lectura&quot;: &quot;Habilitar Futuros&quot;
        en tu API key también permite operar futuros, aunque esta app nunca coloca ni modifica órdenes — solo lee
        posiciones y balance. Si preferís no correr ese riesgo, usá una API key separada solo para esto y nunca le
        actives retiros.
      </p>

      {authState === "out" && (
        <SignInPrompt why="Tus posiciones de futuros son personales: se leen de tu cuenta de Binance vinculada a tu cuenta de ALT RADAR." />
      )}

      {authState === "in" && linked === false && (
        <div className="fd-empty">
          <b>NO HAY CUENTA DE BINANCE VINCULADA</b>
          <span>Vinculá tu API key (arriba a la derecha) con Habilitar Futuros activado para ver tus posiciones acá.</span>
          <button onClick={() => openAccount("login")}>IR A VINCULAR</button>
        </div>
      )}

      {authState === "in" && linked && error && <p className="fd-error">{error}</p>}

      {authState === "in" && linked && !error && (
        <>
          {summary && (
            <div className="fd-summary">
              <div>
                <span>BALANCE DE BILLETERA</span>
                <b>{usd(summary.totalWalletBalanceUsd)}</b>
              </div>
              <div>
                <span>PNL NO REALIZADO</span>
                <b className={summary.totalUnrealizedPnlUsd >= 0 ? "up" : "down"}>{usd(summary.totalUnrealizedPnlUsd)}</b>
              </div>
              <div>
                <span>DISPONIBLE</span>
                <b>{usd(summary.availableBalanceUsd)}</b>
              </div>
              <div>
                <span>MARGEN USADO</span>
                <b>{summary.marginUsagePct !== null ? `${summary.marginUsagePct.toFixed(1)}%` : "—"}</b>
              </div>
            </div>
          )}

          {nearLiq.length > 0 && (
            <div className="fd-alert">
              <b>⚠ {nearLiq.length} posición(es) a menos de 10% de liquidación</b>
              <span>{nearLiq.map((p) => p.symbol).join(" · ")}</span>
            </div>
          )}

          <div className="fd-positions">
            {positions.length === 0 && <p className="fd-none">Sin posiciones abiertas en Futuros ahora mismo.</p>}
            {positions.map((p) => (
              <div key={p.symbol} className={`fd-card ${p.side === "LONG" ? "long" : "short"}`}>
                <div className="fd-card-head">
                  <b>{p.symbol.replace("USDT", "")}</b>
                  <span className={`fd-side ${p.side === "LONG" ? "long" : "short"}`}>{p.side}</span>
                  <em>{p.leverage}x · {p.marginType === "isolated" ? "aislado" : "cruzado"}</em>
                </div>
                <div className="fd-card-sub">
                  <span>{p.qty.toLocaleString("es-AR", { maximumFractionDigits: 6 })} contratos</span>
                  <span>entrada {px(p.entryPrice)}</span>
                  <span>marca {px(p.markPrice)}</span>
                  <span>nocional {usd(p.notionalUsd)}</span>
                </div>

                <div className="fd-pnl">
                  <div>
                    <span>PNL NO REALIZADO</span>
                    <b className={p.unrealizedPnlUsd >= 0 ? "up" : "down"}>{usd(p.unrealizedPnlUsd)}</b>
                  </div>
                  {p.roePct !== null && (
                    <div>
                      <span>ROE</span>
                      <b className={p.roePct >= 0 ? "up" : "down"}>{pct(p.roePct)}</b>
                    </div>
                  )}
                </div>

                <div className={`fd-liq${isNearLiquidation(p.distanceToLiquidationPct) ? " near" : ""}`}>
                  {p.liquidationPrice !== null ? (
                    <>
                      <span>LIQUIDACIÓN</span>
                      <b>{px(p.liquidationPrice)}</b>
                      {p.distanceToLiquidationPct !== null && <em>{p.distanceToLiquidationPct.toFixed(1)}% de distancia a la marca</em>}
                    </>
                  ) : (
                    <span className="fd-nonelabel">Sin nivel de liquidación reportado.</span>
                  )}
                  <small>
                    {p.marginType === "isolated" && p.marginAtRiskUsd !== null
                      ? `Aislado: la pérdida máxima está limitada a ${usd(p.marginAtRiskUsd)} de margen asignado.`
                      : "Cruzado: el margen se comparte con el resto de tu cuenta — la pérdida no está limitada a esta posición sola."}
                  </small>
                </div>
              </div>
            ))}
          </div>

          <p className="fd-caveat">
            Se actualiza cada 5 segundos mientras esta pestaña está abierta y visible, no es un stream en vivo
            empujado por Binance. Esto es información de tu cuenta, no una recomendación: no somos asesores
            financieros y el apalancamiento puede liquidar la posición completa. Última lectura:{" "}
            {updatedAt ? new Date(updatedAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}.
          </p>
        </>
      )}
    </section>
  );
}
