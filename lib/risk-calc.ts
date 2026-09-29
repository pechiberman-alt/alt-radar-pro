/**
 * Position-size and risk calculator.
 *
 * Given the account, how much to risk and where the entry and stop are, it
 * returns the size that loses exactly that much if the stop is hit — after
 * fees and slippage on both sides — capped by the margin the account has. It
 * also shows where the position would be liquidated and what each target pays.
 *
 * It computes arithmetic on numbers the person chose. It does not recommend
 * a risk level or a trade.
 */

export type RiskInput = {
  market: "futures" | "spot";
  equity: number;
  riskPct: number;
  entry: number;
  stop: number;
  leverage: number;
  /** Per side, percent of notional. */
  feePct: number;
  /** Per side, percent of price. */
  slipPct: number;
  targetsR: number[];
  /** Free balance available as margin (futures); defaults to equity. */
  available?: number | null;
  /** Maintenance margin rate, percent. A flat approximation: the real rate depends on position size. */
  mmrPct?: number;
};

export type RiskTarget = { r: number; price: number; netUsd: number; roiPct: number | null };

export type RiskPlan =
  | { ok: false; error: string }
  | {
      ok: true;
      side: "LONG" | "SHORT";
      qty: number;
      notional: number;
      margin: number;
      riskUsd: number;
      riskPct: number;
      stopDistancePct: number;
      liqPrice: number | null;
      /** Share of the way to liquidation the stop sits at; ≥1 means liquidation comes first. */
      stopToLiq: number | null;
      breakeven: number;
      feesRoundTrip: number;
      limitedBy: "riesgo" | "margen" | "saldo";
      targets: RiskTarget[];
      warnings: string[];
    };

export function riskPlan(input: RiskInput): RiskPlan {
  const { market, equity, riskPct, entry, stop, leverage } = input;
  const finite = [equity, riskPct, entry, stop, leverage, input.feePct, input.slipPct].every(Number.isFinite);
  if (!finite) return { ok: false, error: "Completá todos los números." };
  if (!(equity > 0)) return { ok: false, error: "El saldo tiene que ser mayor a cero." };
  if (!(riskPct > 0) || riskPct > 100) return { ok: false, error: "El riesgo tiene que estar entre 0 y 100%." };
  if (!(entry > 0) || !(stop > 0)) return { ok: false, error: "Entrada y stop tienen que ser mayores a cero." };
  if (entry === stop) return { ok: false, error: "La entrada y el stop no pueden ser iguales." };
  if (market === "futures" && !(leverage >= 1 && leverage <= 125)) return { ok: false, error: "El apalancamiento va de 1x a 125x." };
  if (input.feePct < 0 || input.slipPct < 0) return { ok: false, error: "Comisión y deslizamiento no pueden ser negativos." };

  const side: "LONG" | "SHORT" = stop < entry ? "LONG" : "SHORT";
  if (market === "spot" && side === "SHORT") return { ok: false, error: "En spot solo se compra: el stop tiene que estar debajo de la entrada." };

  const f = input.feePct / 100;
  const s = input.slipPct / 100;
  const dist = Math.abs(entry - stop);
  const perUnit = dist + (s + f) * (entry + stop);
  const budget = (equity * riskPct) / 100;
  const byRisk = budget / perUnit;
  const lev = market === "futures" ? leverage : 1;
  const pool = market === "futures" ? (input.available ?? equity) : equity;
  const cap = market === "futures" ? (pool * lev) / entry : pool / (entry * (1 + f));
  const qty = Math.min(byRisk, Math.max(0, cap));
  if (!(qty > 0)) return { ok: false, error: "No hay saldo disponible para abrir esta operación." };
  const limitedBy: "riesgo" | "margen" | "saldo" = byRisk <= cap ? "riesgo" : market === "futures" ? "margen" : "saldo";

  const notional = qty * entry;
  const margin = market === "futures" ? notional / lev : notional;
  const riskUsd = qty * perUnit;
  const mmr = (input.mmrPct ?? 0.5) / 100;
  const liqPrice = market === "futures" ? (side === "LONG" ? entry * (1 - 1 / lev + mmr) : entry * (1 + 1 / lev - mmr)) : null;
  const stopToLiq = liqPrice === null ? null : dist / Math.abs(entry - liqPrice);
  const feesRoundTrip = qty * f * (entry + stop);
  const breakeven = side === "LONG" ? (entry * (1 + s + f)) / (1 - s - f) : (entry * (1 - s - f)) / (1 + s + f);

  const targets: RiskTarget[] = input.targetsR
    .filter((r) => Number.isFinite(r) && r > 0 && r <= 50)
    .map((r) => {
      const price = side === "LONG" ? entry + r * dist : entry - r * dist;
      const net = qty * r * dist - qty * (s + f) * (entry + price);
      return { r, price, netUsd: net, roiPct: margin > 0 ? (net / margin) * 100 : null };
    });

  const warnings: string[] = [];
  const actualPct = (riskUsd / equity) * 100;
  if (riskPct > 3) warnings.push("Arriesgás más del 3% del saldo en una sola operación.");
  if (market === "futures" && leverage > 25) warnings.push("Apalancamiento muy alto: un movimiento chico ya te liquida.");
  if (limitedBy !== "riesgo") warnings.push(`El tamaño quedó limitado por el ${limitedBy} disponible: en realidad arriesgás ${actualPct.toLocaleString("es-AR", { maximumFractionDigits: 2 })}%, no ${riskPct}%.`);
  if (stopToLiq !== null && stopToLiq >= 1) warnings.push("Te liquidan ANTES de llegar al stop: bajá el apalancamiento o acercá el stop.");
  else if (stopToLiq !== null && stopToLiq > 0.6) warnings.push("El stop queda muy cerca de la liquidación: un deslizamiento puede saltearlo.");
  if (dist / entry < 4 * (s + f)) warnings.push("El stop es tan corto que las comisiones y el deslizamiento se comen buena parte del riesgo.");
  if (notional < 5) warnings.push("El tamaño es menor al mínimo de Binance (unos 5 USDT de valor).");

  return {
    ok: true, side, qty, notional, margin, riskUsd, riskPct: actualPct, stopDistancePct: (dist / entry) * 100, liqPrice, stopToLiq,
    breakeven, feesRoundTrip, limitedBy, targets, warnings,
  };
}

/** What a run of losses does to the account, and the gain needed to get back. */
export function streakImpact(riskPcts: number[], streaks: number[]) {
  return riskPcts.map((risk) => ({
    risk,
    rows: streaks.map((n) => {
      const remaining = Math.pow(1 - risk / 100, n);
      return { n, drawdownPct: (1 - remaining) * 100, recoveryPct: (1 / remaining - 1) * 100 };
    }),
  }));
}

export function dailyLimit(todayNet: number, equity: number, limitPct: number) {
  const limitUsd = (equity * limitPct) / 100;
  const used = Math.max(0, -todayNet);
  return { limitUsd, used, remaining: Math.max(0, limitUsd - used), breached: limitUsd > 0 && used >= limitUsd };
}
