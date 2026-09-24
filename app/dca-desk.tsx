"use client";

import { useCallback, useEffect, useState } from "react";
import { onSession } from "@/lib/account-events";
import SignInPrompt from "./sign-in-prompt";
import {
  DCA_SCHEDULE_FREQUENCIES,
  type DcaFrequency,
  type DcaPosition,
  type DcaPurchase,
  type DcaSchedule,
} from "@/lib/dca-tracker";
import { FUTURES_BASES } from "@/lib/market-fetch";

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const money = (value: number) =>
  `$${value.toLocaleString("es-AR", { maximumFractionDigits: value >= 100 ? 0 : 2 })}`;

const today = () => new Date().toISOString().slice(0, 10);

async function fetchPrice(symbol: string): Promise<number | null> {
  for (const base of FUTURES_BASES) {
    try {
      const response = await fetch(`${base}/fapi/v1/ticker/price?symbol=${symbol}`);
      if (!response.ok) continue;
      const body = (await response.json()) as { price?: string };
      const price = Number(body.price);
      return Number.isFinite(price) ? price : null;
    } catch {
      // Next mirror.
    }
  }
  return null;
}

export default function DcaDesk() {
  const [authState, setAuthState] = useState<"loading" | "in" | "out">("loading");
  const [purchases, setPurchases] = useState<DcaPurchase[]>([]);
  const [positions, setPositions] = useState<DcaPosition[]>([]);
  const [schedules, setSchedules] = useState<DcaSchedule[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [symbol, setSymbol] = useState("BTCUSDT");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [manualPrice, setManualPrice] = useState("");

  const [scheduleSymbol, setScheduleSymbol] = useState("BTCUSDT");
  const [scheduleAmount, setScheduleAmount] = useState("");
  const [scheduleFreq, setScheduleFreq] = useState<DcaFrequency>("SEMANAL");
  const [scheduleWeekday, setScheduleWeekday] = useState(1);

  const load = useCallback(async () => {
    try {
      const [purchasesRes, schedulesRes] = await Promise.all([
        fetch("/api/dca", { cache: "no-store" }),
        fetch("/api/dca/schedule", { cache: "no-store" }),
      ]);
      if (purchasesRes.status === 401) {
        setAuthState("out");
        return;
      }
      if (!purchasesRes.ok) {
        setError("NO SE PUDO LEER EL REGISTRO");
        return;
      }
      const purchasesBody = (await purchasesRes.json()) as {
        purchases: DcaPurchase[];
        positions: DcaPosition[];
      };
      setPurchases(purchasesBody.purchases);

      // Apply live prices client-side, per symbol actually held — the
      // server route deliberately does not fetch market data itself.
      const symbols = [...new Set(purchasesBody.purchases.map((p) => p.symbol))];
      const prices = await Promise.all(symbols.map((s) => fetchPrice(s)));
      const priceMap: Record<string, number> = {};
      symbols.forEach((s, i) => {
        const price = prices[i];
        if (price !== null) priceMap[s] = price;
      });
      const withPrices = purchasesBody.positions.map((position) => {
        const price = priceMap[position.symbol];
        if (price === undefined) return position;
        const currentValueUsd = position.totalUnits * price;
        const pnlUsd = currentValueUsd - position.totalInvestedUsd;
        return {
          ...position,
          currentValueUsd,
          pnlUsd,
          pnlPct: position.totalInvestedUsd > 0 ? (pnlUsd / position.totalInvestedUsd) * 100 : null,
        };
      });
      setPositions(withPrices);

      if (schedulesRes.ok) {
        const scheduleBody = (await schedulesRes.json()) as { schedules: DcaSchedule[] };
        setSchedules(scheduleBody.schedules);
      }
      setAuthState("in");
      setError("");
    } catch {
      setError("NO SE PUDO LEER EL REGISTRO");
    }
  }, []);

  useEffect(() => {
    // Wrapped in its own async IIFE rather than calling `load` bare: the
    // effect's body needs to visibly resolve to a promise it doesn't return,
    // which is what the same pattern elsewhere in this app already does.
    (async () => {
      await load();
    })();
    // Signing in elsewhere on the page refreshes this panel.
    return onSession(() => void load());
  }, [load]);

  const submitPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      let price = manualPrice ? Number(manualPrice) : null;
      if (!price) price = await fetchPrice(symbol);
      if (!price) {
        setError("NO SE PUDO OBTENER EL PRECIO — CARGALO A MANO");
        return;
      }
      const response = await fetch("/api/dca", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          usdAmount: Number(amount),
          priceAtPurchase: price,
          purchasedAt: date,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "NO SE PUDO GUARDAR");
        return;
      }
      setAmount("");
      setManualPrice("");
      await load();
    } catch {
      setError("NO SE PUDO GUARDAR");
    } finally {
      setSaving(false);
    }
  };

  const removePurchase = async (id: string) => {
    await fetch(`/api/dca?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
    await load();
  };

  const saveSchedule = async () => {
    if (!(Number(scheduleAmount) > 0)) return;
    await fetch("/api/dca/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: scheduleSymbol,
        usdAmount: Number(scheduleAmount),
        frequency: scheduleFreq,
        weekday: scheduleWeekday,
        enabled: true,
      }),
    }).catch(() => undefined);
    setScheduleAmount("");
    await load();
  };

  const removeSchedule = async (sym: string) => {
    await fetch(`/api/dca/schedule?symbol=${encodeURIComponent(sym)}`, { method: "DELETE" }).catch(
      () => undefined,
    );
    await load();
  };

  return (
    <section className="panel dca-desk" id="dca">
      <div className="panel-head">
        <div>
          <p className="eyebrow">DCA · REGISTRO Y RECORDATORIO</p>
          <h2>Lo que fuiste acumulando</h2>
        </div>
        <span className={authState === "out" ? "badge critical" : "badge"}>
          {authState === "loading" ? "CARGANDO…" : authState === "out" ? "SIN SESIÓN" : `${purchases.length} COMPRAS`}
        </span>
      </div>

      <p className="dca-premise">
        Esto no compra nada por vos. Cargás cada compra que hiciste a mano y el sistema calcula cuánto
        invertiste, tu costo promedio y tu resultado. El calendario de abajo solo te <b>avisa</b> que
        toca comprar — la compra la hacés vos, en Binance o donde uses, y después la cargás acá.
      </p>

      {authState === "loading" && <p className="dca-loading">CARGANDO…</p>}

      {authState === "out" && (
        <SignInPrompt why="Tu DCA es personal: cada compra y el calendario quedan guardados en tu cuenta." />
      )}

      {authState === "in" && (
        <>
          {positions.length > 0 && (
            <div className="dca-positions">
              {positions.map((position) => (
                <div key={position.symbol}>
                  <b>{position.symbol.replace("USDT", "")}</b>
                  <div className="dca-pos-figures">
                    <div>
                      <span>INVERTIDO</span>
                      <u>{money(position.totalInvestedUsd)}</u>
                    </div>
                    <div>
                      <span>COSTO PROM.</span>
                      <u>{money(position.averageCost)}</u>
                    </div>
                    <div>
                      <span>VALOR ACTUAL</span>
                      <u>{position.currentValueUsd !== null ? money(position.currentValueUsd) : "—"}</u>
                    </div>
                    <div>
                      <span>P&L</span>
                      <u className={position.pnlUsd !== null && position.pnlUsd >= 0 ? "positive" : "negative"}>
                        {position.pnlUsd !== null
                          ? `${money(position.pnlUsd)} (${position.pnlPct?.toFixed(1)}%)`
                          : "—"}
                      </u>
                    </div>
                  </div>
                  <em>{position.purchases} compras</em>
                </div>
              ))}
            </div>
          )}

          <form className="dca-form" onSubmit={submitPurchase}>
            <h4>REGISTRAR COMPRA</h4>
            <div className="dca-form-row">
              <input placeholder="BTCUSDT" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
              <input type="number" step="any" placeholder="Monto USD" value={amount} onChange={(e) => setAmount(e.target.value)} required />
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              <input
                type="number"
                step="any"
                placeholder="Precio (auto si lo dejás vacío)"
                value={manualPrice}
                onChange={(e) => setManualPrice(e.target.value)}
              />
              <button type="submit" disabled={saving}>
                {saving ? "…" : "REGISTRAR"}
              </button>
            </div>
          </form>

          {error && <p className="dca-error">{error}</p>}

          <div className="dca-list">
            {purchases.slice(0, 12).map((purchase) => (
              <div key={purchase.id}>
                <b>{purchase.symbol.replace("USDT", "")}</b>
                <em>{money(purchase.usdAmount)} @ {purchase.priceAtPurchase}</em>
                <small>{purchase.purchasedAt.slice(0, 10)}</small>
                <button onClick={() => removePurchase(purchase.id)} aria-label="Borrar">
                  ×
                </button>
              </div>
            ))}
          </div>

          <h4 className="dca-section">RECORDATORIO PROGRAMADO</h4>
          <p className="dca-schedule-note">
            El bot te manda un aviso el día que toca — categoría DCA en el centro de alertas. No compra
            nada: te lo recuerda para que lo hagas vos y lo cargues arriba.
          </p>
          <div className="dca-schedule-list">
            {schedules.map((schedule) => (
              <div key={schedule.symbol}>
                <b>{schedule.symbol.replace("USDT", "")}</b>
                <em>
                  {money(schedule.usdAmount)} · {schedule.frequency.toLowerCase()}
                  {schedule.frequency === "SEMANAL" || schedule.frequency === "QUINCENAL"
                    ? ` · ${WEEKDAYS[schedule.weekday]}`
                    : ""}
                </em>
                <button onClick={() => removeSchedule(schedule.symbol)} aria-label="Quitar">
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="dca-schedule-form">
            <input
              placeholder="BTCUSDT"
              value={scheduleSymbol}
              onChange={(e) => setScheduleSymbol(e.target.value.toUpperCase())}
            />
            <input
              type="number"
              step="any"
              placeholder="Monto USD"
              value={scheduleAmount}
              onChange={(e) => setScheduleAmount(e.target.value)}
            />
            <select value={scheduleFreq} onChange={(e) => setScheduleFreq(e.target.value as DcaFrequency)}>
              {DCA_SCHEDULE_FREQUENCIES.map((freq) => (
                <option key={freq} value={freq}>
                  {freq}
                </option>
              ))}
            </select>
            {(scheduleFreq === "SEMANAL" || scheduleFreq === "QUINCENAL") && (
              <select value={scheduleWeekday} onChange={(e) => setScheduleWeekday(Number(e.target.value))}>
                {WEEKDAYS.map((day, i) => (
                  <option key={day} value={i}>
                    {day}
                  </option>
                ))}
              </select>
            )}
            <button onClick={saveSchedule}>GUARDAR</button>
          </div>
        </>
      )}
    </section>
  );
}
