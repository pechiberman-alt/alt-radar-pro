import type { LiquidationHeatmap } from "./liquidation-heatmap";

/**
 * Where a signal's targets should sit, read off the liquidation map.
 *
 * THE GAP THIS FILLS
 *
 * The signal ledger records entries and grades them by what price did after,
 * but it never carried a target or an invalidation level — so there was
 * nothing to alert on beyond "a signal appeared". A target picked as a round
 * percentage would be arbitrary. The liquidation map already knows where
 * forced orders are stacked, and those levels are where price has a reason to
 * accelerate toward and a reason to stall.
 *
 * So: the target is the magnet zone in the trade's direction, and the
 * invalidation is the magnet zone against it — the place where a sweep would
 * take out the stops of everyone positioned the same way.
 *
 * WHAT THIS INHERITS
 *
 * Everything the heatmap is: an estimate built on assumed leverage, not a
 * measurement. A target derived from it is a zone of interest, never a
 * promise. It also inherits the heatmap's blind spot — a level outside the
 * projected range simply is not there, and no target is invented to fill the
 * silence.
 */

export type SignalTargets = {
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  /** Magnet zone the trade is aiming at, when one exists on that side. */
  target: { price: number; notionalUsd: number | null; distancePct: number } | null;
  /** Magnet zone behind the trade — where a sweep would hunt these stops. */
  invalidation: { price: number; notionalUsd: number | null; distancePct: number } | null;
  /** Reward divided by risk, when both levels exist. */
  riskReward: number | null;
  /** Whether the map's own directional bias agrees with the trade. */
  mapAgrees: boolean | null;
  verdict: "A FAVOR" | "EN CONTRA" | "NEUTRO" | "SIN MAPA";
  note: string;
};

const pctAway = (from: number, to: number) => Math.abs((to - from) / from) * 100;

export function buildSignalTargets(
  symbol: string,
  side: "LONG" | "SHORT",
  entryPrice: number,
  heatmap: LiquidationHeatmap | null,
): SignalTargets {
  const base: SignalTargets = {
    symbol,
    side,
    entryPrice,
    target: null,
    invalidation: null,
    riskReward: null,
    mapAgrees: null,
    verdict: "SIN MAPA",
    note: "No hay mapa de liquidaciones para este par, así que no se derivan objetivos. No se inventa uno.",
  };

  if (!heatmap || !(entryPrice > 0)) return base;

  // A long aims up and is invalidated down; a short is the mirror.
  const ahead = side === "LONG" ? heatmap.topZoneAbove : heatmap.topZoneBelow;
  const behind = side === "LONG" ? heatmap.topZoneBelow : heatmap.topZoneAbove;

  const target = ahead
    ? {
        price: ahead.price,
        notionalUsd: ahead.notionalUsd,
        distancePct: pctAway(entryPrice, ahead.price),
      }
    : null;
  const invalidation = behind
    ? {
        price: behind.price,
        notionalUsd: behind.notionalUsd,
        distancePct: pctAway(entryPrice, behind.price),
      }
    : null;

  const riskReward =
    target && invalidation && invalidation.distancePct > 0
      ? target.distancePct / invalidation.distancePct
      : null;

  const mapAgrees =
    heatmap.bias === "SIN SESGO CLARO"
      ? null
      : (side === "LONG") === heatmap.bias.includes("ALZA");

  let verdict: SignalTargets["verdict"] = "NEUTRO";
  let note =
    "El mapa no se inclina a ningún lado, así que no suma ni resta a esta señal. Los niveles siguen sirviendo como objetivo y como zona de riesgo.";

  if (mapAgrees === true) {
    verdict = "A FAVOR";
    note =
      "El combustible de liquidación se acumula en la dirección del trade: si el precio llega, esas liquidaciones empujan a favor.";
  } else if (mapAgrees === false) {
    verdict = "EN CONTRA";
    note =
      "El combustible pesa del lado contrario al trade. No lo invalida, pero significa que una cascada trabajaría en contra, no a favor.";
  }

  // A trade whose invalidation sits on a dense cluster is positioned exactly
  // where a sweep would hunt — worth saying outright, because it is the case
  // most likely to stop someone out before the move they were right about.
  if (invalidation && invalidation.distancePct < 1.5) {
    note += ` La zona de riesgo está a sólo ${invalidation.distancePct.toFixed(2)}% de la entrada: ahí es donde un barrido buscaría estos stops.`;
  }

  return {
    symbol,
    side,
    entryPrice,
    target,
    invalidation,
    riskReward,
    mapAgrees,
    verdict,
    note,
  };
}

export type ProximityAlert = {
  kind: "OBJETIVO" | "RIESGO";
  symbol: string;
  price: number;
  distancePct: number;
  message: string;
};

/**
 * Fires when price closes in on a derived level.
 *
 * The threshold is a percentage rather than a fixed figure so it means the
 * same thing on a $76,000 pair and a $0.50 one. Alerts are only worth sending
 * while the level is still ahead: once price has passed it the information is
 * history, and a notification about it would be noise arriving late.
 */
export function proximityAlert(
  targets: SignalTargets,
  currentPrice: number,
  thresholdPct = 0.6,
): ProximityAlert | null {
  if (!(currentPrice > 0)) return null;

  // The "still ahead" test is computed inside, not passed in: evaluating it
  // at the call site dereferenced a level that may be null.
  const check = (
    level: SignalTargets["target"],
    kind: ProximityAlert["kind"],
  ): ProximityAlert | null => {
    if (!level) return null;

    const longTrade = targets.side === "LONG";
    // A target is ahead when price has not reached it yet; an invalidation is
    // ahead when price has not broken it yet. For a short both invert.
    const stillAhead =
      kind === "OBJETIVO"
        ? longTrade
          ? currentPrice < level.price
          : currentPrice > level.price
        : longTrade
          ? currentPrice > level.price
          : currentPrice < level.price;
    if (!stillAhead) return null;

    const distancePct = pctAway(currentPrice, level.price);
    if (distancePct > thresholdPct) return null;

    return {
      kind,
      symbol: targets.symbol,
      price: level.price,
      distancePct,
      message:
        kind === "OBJETIVO"
          ? `${targets.symbol} a ${distancePct.toFixed(2)}% del objetivo en ${level.price}`
          : `${targets.symbol} a ${distancePct.toFixed(2)}% de la zona de riesgo en ${level.price}`,
    };
  };

  // Risk first: being told you are about to be stopped matters more than
  // being told you are about to be right.
  return check(targets.invalidation, "RIESGO") ?? check(targets.target, "OBJETIVO");
}
