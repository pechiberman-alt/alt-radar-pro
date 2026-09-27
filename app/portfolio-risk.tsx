"use client";

import { useCallback, useEffect, useState } from "react";
import { onSession, openAccount } from "@/lib/account-events";
import { computeCostBasis, costBasisReliable as isCostBasisReliable, riskToInvalidation, type RiskPosition, unrealizedPnl } from "@/lib/cost-basis";
import { getAccountBalances, getMyTrades } from "@/lib/binance-client-signed";
import { loadSpotPlan } from "@/lib/spot-plan-client";
import type { SpotPlan } from "@/lib/spot-strategy";
import SignInPrompt from "./sign-in-prompt";

// Plans (candles + zones per asset) are fetched client-side, same as
// ESTRATEGIA SPOT; capped so a large portfolio doesn't fire off a dozen
// candle fetches at once.
const MAX_PLANS = 6;
const STABLES = new Set(["USDT", "USDC", "BUSD", "FDUSD", "DAI", "TUSD", "USDP"]);
// Trade history is one signed call per asset. Most portfolios have a long
// tail of dust; only the largest holdings are worth that cost.
const MAX_ASSETS_WITH_HISTORY = 8;
const DUST_USD = 5;

const usd = (v: number, opts: Intl.NumberFormatOptions = {}) =>
  `$${v.toLocaleString("es-AR", { maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2, ...opts })}`;
const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
const px = (v: number) =>
  v >= 1000 ? v.toLocaleString("es-AR", { maximumFractionDigits: 0 }) : v.toLocaleString("es-AR", { maximumFractionDigits: v >= 1 ? 3 : 6 });

type Enriched = RiskPosition & { plan: SpotPlan | null; planTried: boolean };

export default function PortfolioRisk() {
  const [authState, setAuthState] = useState<"loading" | "in" | "out">("loading");
  const [linked, setLinked] = useState<boolean | null>(null);
  const [positions, setPositions] = useState<Enriched[]>([]);
  const [totalUsd, setTotalUsd] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const credResponse = await fetch("/api/binance/credentials", { cache: "no-store" });
      if (credResponse.status === 401) {
        setAuthState("out");
        return;
      }
      setAuthState("in");
      if (credResponse.status === 404) {
        setLinked(false);
        return;
      }
      if (!credResponse.ok) {
        const d = (await credResponse.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? "NO SE PUDO LEER LA CARTERA");
        return;
      }
      setLinked(true);
      setError("");
      const { apiKey, apiSecret } = (await credResponse.json()) as { apiKey: string; apiSecret: string };

      // Everything past this point is the same computation
      // app/api/binance/risk/route.ts used to do server-side — moved here
      // because the signed calls it needs (balances, trade history) are
      // blocked by Binance's WAF from the Worker; see
      // lib/binance-client-signed.ts's doc comment.
      const [{ balances }, priceRows] = await Promise.all([
        getAccountBalances(apiKey, apiSecret),
        fetch("https://api.binance.com/api/v3/ticker/price")
          .then((r) => (r.ok ? (r.json() as Promise<{ symbol: string; price: string }[]>) : []))
          .catch(() => [] as { symbol: string; price: string }[]),
      ]);
      const priceOf = new Map(priceRows.map((r) => [r.symbol, Number(r.price)]));

      const held = balances
        .map((b) => {
          const qty = Number(b.free) + Number(b.locked);
          const isStable = STABLES.has(b.asset);
          const price = isStable ? 1 : (priceOf.get(`${b.asset}USDT`) ?? null);
          const valueUsd = price !== null ? qty * price : null;
          return { asset: b.asset, qty, isStable, price, valueUsd };
        })
        .filter((h) => h.qty > 0)
        .sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));

      const total = held.reduce((s, h) => s + (h.valueUsd ?? 0), 0);
      setTotalUsd(total);

      const withHistory = held.filter((h) => !h.isStable && (h.valueUsd ?? 0) >= DUST_USD).slice(0, MAX_ASSETS_WITH_HISTORY);
      const tradeResults = await Promise.allSettled(withHistory.map((h) => getMyTrades(apiKey, apiSecret, `${h.asset}USDT`)));
      const fillsByAsset = new Map<string, { price: number; qty: number; isBuyer: boolean; time: number }[]>();
      withHistory.forEach((h, i) => {
        const r = tradeResults[i];
        if (r.status === "fulfilled") {
          fillsByAsset.set(
            h.asset,
            r.value.map((f) => ({ price: Number(f.price), qty: Number(f.qty), isBuyer: f.isBuyer, time: f.time })),
          );
        }
      });

      const body: { positions: RiskPosition[] } = {
        positions: held.map((h) => {
          const fills = fillsByAsset.get(h.asset);
          const basis = fills?.length ? computeCostBasis(fills) : null;
          return {
            asset: h.asset,
            qty: h.qty,
            price: h.price,
            valueUsd: h.valueUsd,
            isStable: h.isStable,
            costBasis: basis,
            costBasisReliable: basis !== null && isCostBasisReliable(basis.units, h.qty),
          };
        }),
      };

      // Non-stable holdings, largest first, capped — each one needs its own
      // candle fetch, so the plan runs only for what's worth the cost.
      const plannable = body.positions
        .filter((p) => !p.isStable && (p.valueUsd ?? 0) >= 5)
        .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0))
        .slice(0, MAX_PLANS)
        .map((p) => p.asset);

      setPositions(body.positions.map((p) => ({ ...p, plan: null, planTried: false })));

      const controller = new AbortController();
      await Promise.all(
        plannable.map(async (asset) => {
          const pos = body.positions.find((p) => p.asset === asset)!;
          try {
            const result = await loadSpotPlan(`${asset}USDT`, pos.valueUsd ?? 0, controller.signal);
            setPositions((current) =>
              current.map((p) => (p.asset === asset ? { ...p, plan: result?.plan ?? null, planTried: true } : p)),
            );
          } catch {
            setPositions((current) => current.map((p) => (p.asset === asset ? { ...p, planTried: true } : p)));
          }
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "SIN CONEXIÓN CON EL SERVIDOR");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Wrapped in its own async IIFE rather than calling `load` bare — the
    // same pattern used elsewhere in the app (e.g. app/dca-desk.tsx) so the
    // effect body itself never sets state synchronously.
    (async () => {
      await load();
    })();
    // Signing in elsewhere on the page refreshes this panel.
    return onSession(() => void load());
  }, [load]);

  const badge =
    authState === "loading" || loading
      ? "CARGANDO…"
      : authState === "out"
        ? "SIN SESIÓN"
        : linked === false
          ? "SIN VINCULAR"
          : `${positions.filter((p) => !p.isStable && (p.valueUsd ?? 0) >= 5).length} POSICIONES`;

  return (
    <section className="panel portfolio-risk" id="cartera">
      <div className="panel-head">
        <div>
          <p className="eyebrow">MI CARTERA · BINANCE SOLO LECTURA</p>
          <h2>Balance, riesgo y toma de parciales</h2>
        </div>
        <span className={authState === "out" || linked === false ? "badge critical" : "badge"}>{badge}</span>
      </div>

      {authState === "out" && (
        <SignInPrompt why="Tu cartera es personal: se lee de tu cuenta de Binance vinculada a tu cuenta de ALT RADAR." />
      )}

      {authState === "in" && linked === false && (
        <div className="pr-empty">
          <b>NO HAY CUENTA DE BINANCE VINCULADA</b>
          <span>Vinculala desde tu cuenta (arriba a la derecha) en modo solo lectura para ver tu cartera acá.</span>
          <button onClick={() => openAccount("login")}>IR A VINCULAR</button>
        </div>
      )}

      {authState === "in" && linked && error && <p className="pr-error">{error}</p>}

      {authState === "in" && linked && !error && (
        <>
          <div className="pr-total">
            <span>VALOR TOTAL DE LA CARTERA</span>
            <b>{usd(totalUsd)}</b>
          </div>

          <div className="pr-positions">
            {positions
              .filter((p) => (p.valueUsd ?? 0) >= 1)
              .map((p) => (
                <PositionCard key={p.asset} position={p} totalUsd={totalUsd} />
              ))}
            {loading && <p className="pr-note">Leyendo balances…</p>}
          </div>

          <p className="pr-caveat">
            Esto es spot, sin apalancamiento: no hay stop automático que la app pueda poner por vos. La
            invalidación y la escalera de parciales salen del mismo motor que ESTRATEGIA SPOT, no son una orden.
            Una práctica habitual es no exponer a una sola caída hasta la invalidación más del 1–3% del capital
            total; es información general, no una recomendación personalizada — no somos asesores financieros.
          </p>
        </>
      )}
    </section>
  );
}

function PositionCard({ position, totalUsd }: { position: Enriched; totalUsd: number }) {
  const { asset, qty, price, valueUsd, isStable, costBasis, costBasisReliable, plan, planTried } = position;
  const weightPct = totalUsd > 0 && valueUsd !== null ? (valueUsd / totalUsd) * 100 : null;
  const pnl = !isStable && costBasis && price !== null ? unrealizedPnl(qty, price, costBasis.avgCost) : null;
  const risk =
    !isStable && plan?.invalidation && price !== null
      ? riskToInvalidation(qty, price, plan.invalidation.price, totalUsd)
      : null;

  return (
    <div className={`pr-card${isStable ? " stable" : ""}`}>
      <div className="pr-card-head">
        <b>{asset}</b>
        <span>{valueUsd !== null ? usd(valueUsd) : "—"}</span>
        {weightPct !== null && <em>{weightPct.toFixed(1)}% de la cartera</em>}
      </div>
      <div className="pr-card-sub">
        <span>{qty.toLocaleString("es-AR", { maximumFractionDigits: 6 })} {asset}</span>
        {price !== null && <span>precio {px(price)}</span>}
      </div>

      {isStable ? (
        <p className="pr-stable-note">Stablecoin: se cuenta a valor nominal, sin plan ni riesgo de invalidación.</p>
      ) : (
        <>
          {costBasis && costBasis.units > 0 ? (
            <div className="pr-pnl">
              <div>
                <span>COSTO PROMEDIO</span>
                <b>{px(costBasis.avgCost)}</b>
              </div>
              {pnl && (
                <div>
                  <span>RESULTADO NO REALIZADO</span>
                  <b className={pnl.usd >= 0 ? "up" : "down"}>
                    {usd(pnl.usd)} ({pct(pnl.pct)})
                  </b>
                </div>
              )}
              {!costBasisReliable && (
                <small className="pr-warn">
                  El historial de operaciones no coincide del todo con lo que tenés hoy (puede haber
                  transferencias, staking, o historial más viejo del que se leyó): tomá el costo promedio como
                  estimado.
                </small>
              )}
            </div>
          ) : (
            <p className="pr-note">Sin historial de compra/venta en {asset}USDT: no se puede estimar costo promedio ni resultado.</p>
          )}

          {!planTried && <p className="pr-note">Calculando plan de riesgo…</p>}
          {planTried && !plan && <p className="pr-note">Sin datos suficientes para calcular un plan en {asset}USDT.</p>}

          {plan && (
            <>
              <div className="pr-risk">
                {plan.invalidation ? (
                  <>
                    <span>INVALIDACIÓN</span>
                    <b>{px(plan.invalidation.price)}</b>
                    <em>{plan.invalidation.source}</em>
                    {risk && (
                      <small>
                        Si cae hasta ahí: {usd(risk.usd)} · {risk.pct.toFixed(2)}% de tu cartera total
                      </small>
                    )}
                  </>
                ) : (
                  <span className="pr-none">Sin estructura clara debajo para anclar una invalidación.</span>
                )}
              </div>

              <div className="pr-exits">
                <span>TOMA DE PARCIALES</span>
                {plan.exits.length ? (
                  plan.exits.map((e) => (
                    <div key={e.price}>
                      <b>{px(e.price)}</b>
                      <em>{e.source}</em>
                      <u>
                        vender {Math.round(e.weight * 100)}%
                        {valueUsd !== null ? ` (~${usd(valueUsd * e.weight)})` : ""}
                      </u>
                    </div>
                  ))
                ) : (
                  <span className="pr-none">Sin zona de oferta detectada arriba todavía.</span>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
