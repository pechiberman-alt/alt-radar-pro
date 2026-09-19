import type { LiquidationHeatmap } from "./liquidation-heatmap";
import type { SwingSetup } from "./swing-entries";

/**
 * Keeps a swing stop out of the liquidity that would come looking for it.
 *
 * THE LOSS THIS TARGETS
 *
 * A structurally correct swing entry still loses when price dips just far
 * enough to take the stop and then continues in the direction the setup
 * called. That is not bad luck and it is not a bad read — it is the market
 * reaching for a cluster of forced orders, which is exactly what the
 * liquidation map measures. A stop resting inside that cluster is not
 * protecting the trade; it is supplying it.
 *
 * WHY THIS IS NOT A WIN-RATE TRICK
 *
 * Win rate rises trivially by widening stops, and that "improvement" is
 * fraudulent: the same account loses more per loss and ends up worse. This
 * does something different and it pays for itself honestly:
 *
 *   - It only moves a stop that sits inside or just before a dense zone. A
 *     stop already clear of the liquidity is left exactly where it was.
 *   - Moving it costs risk. That cost is applied to the setup's own numbers:
 *     riskPct grows and riskRewardFirst falls, both recomputed, both shown.
 *   - If the honest R:R after that cost drops below the threshold, the setup
 *     is REJECTED rather than accepted with worse maths. Fewer trades, not
 *     flattering ones.
 *
 * So the mechanism is: remove a recurring cause of losing on correct reads,
 * and refuse the trades where avoiding it is not worth the price. Whether
 * that shows up as a better record is something the ledger measures over
 * time — it is not a number this module gets to promise.
 */

export type StopAdjustment = {
  setup: SwingSetup;
  /** True when the stop was moved beyond a cluster. */
  moved: boolean;
  /** True when the setup no longer clears its risk-reward floor. */
  rejected: boolean;
  originalStop: number;
  originalRiskReward: number;
  note: string;
};

/**
 * How far past a cluster a liquidation cascade is assumed to carry price.
 *
 * This is the whole point of the module, so it is worth stating plainly: when
 * price reaches a dense zone the forced orders there push it FURTHER in the
 * same direction. A stop sitting just beyond the zone is therefore not safe —
 * it is directly in the path of the move the zone itself creates. Only a stop
 * below that overshoot is genuinely clear.
 *
 * The figure is an assumption, not a measurement, and it is the one knob that
 * decides how much extra risk this module is willing to spend.
 */
const SWEEP_OVERSHOOT = 0.008;

/** A zone only counts as a real hazard above this intensity; faint rows are
 *  noise and moving a stop for them would just widen risk for nothing. */
const HAZARD_INTENSITY = 45;

export function adjustStopForLiquidity(
  setup: SwingSetup,
  heatmap: LiquidationHeatmap | null,
  minRiskReward = 1.8,
): StopAdjustment {
  const originalStop = setup.stop;
  const originalRiskReward = setup.riskRewardFirst;
  const unchanged: StopAdjustment = {
    setup,
    moved: false,
    rejected: false,
    originalStop,
    originalRiskReward,
    note: "",
  };

  if (!heatmap || !heatmap.buckets.length) {
    return {
      ...unchanged,
      note: "Sin mapa de liquidaciones para este par: el stop queda donde lo puso la estructura.",
    };
  }

  const entry = (setup.entryLow + setup.entryHigh) / 2;
  if (!(entry > 0) || !(originalStop > 0)) return unchanged;

  const long = setup.side === "LONG";

  // Zones that sit between the entry and the stop, or just beyond it — those
  // are the ones price would sweep on its way to taking this trade out.
  const reach = long ? originalStop * (1 - 0.02) : originalStop * (1 + 0.02);
  const hazards = heatmap.buckets.filter((bucket) => {
    if (bucket.intensity < HAZARD_INTENSITY) return false;
    return long
      ? bucket.price <= entry && bucket.price >= reach
      : bucket.price >= entry && bucket.price <= reach;
  });

  if (!hazards.length) {
    return {
      ...unchanged,
      note: "El stop no tiene zonas densas de liquidación en su camino: queda donde estaba.",
    };
  }

  // The edge price would reach first on its way down (or up, for a short):
  // that is where the cascade starts.
  const edge = long
    ? Math.max(...hazards.map((bucket) => bucket.price))
    : Math.min(...hazards.map((bucket) => bucket.price));

  // Where that cascade is assumed to carry price. Any stop short of this is
  // in its path, however far it looks from the zone itself.
  const sweepEnd = long ? edge * (1 - SWEEP_OVERSHOOT) : edge * (1 + SWEEP_OVERSHOOT);

  // Already beyond the overshoot: the trade is not exposed to this zone, and
  // widening anyway would be the exact win-rate trick this module refuses.
  if (long ? originalStop <= sweepEnd : originalStop >= sweepEnd) {
    return {
      ...unchanged,
      note: "El stop ya está más allá del alcance del barrido: no se toca.",
    };
  }

  const newStop = long ? sweepEnd * (1 - 0.001) : sweepEnd * (1 + 0.001);
  const newRisk = Math.abs(entry - newStop);
  if (!(newRisk > 0)) return unchanged;

  const firstTarget = setup.targets[0];
  if (firstTarget === undefined) return unchanged;

  const newRiskReward = Math.abs(firstTarget - entry) / newRisk;
  const newRiskPct = (newRisk / entry) * 100;

  const movedPct = (Math.abs(newStop - originalStop) / entry) * 100;

  if (newRiskReward < minRiskReward) {
    return {
      setup,
      moved: false,
      rejected: true,
      originalStop,
      originalRiskReward,
      note: `Para quedar fuera de la zona densa el stop tendría que irse a ${newStop.toFixed(6).replace(/0+$/, "")}, y ahí el R:R cae a ${newRiskReward.toFixed(2)}×, por debajo del mínimo de ${minRiskReward}×. El setup se descarta en vez de tomarse con peores números.`,
    };
  }

  return {
    setup: {
      ...setup,
      stop: newStop,
      riskPct: newRiskPct,
      riskRewardFirst: newRiskReward,
      warnings: [
        ...setup.warnings,
        `Stop alejado ${movedPct.toFixed(2)}% para quedar fuera de una zona densa de liquidación. Riesgo por operación mayor: ajustá el tamaño.`,
      ],
      reasons: [...setup.reasons, "Stop ubicado más allá del combustible de liquidación"],
    },
    moved: true,
    rejected: false,
    originalStop,
    originalRiskReward,
    note: `El stop original quedaba dentro del alcance de un barrido: la cascada que arranca en la zona densa lo habría arrastrado. Se corrió a ${newStop.toFixed(6).replace(/0+$/, "")}; el R:R baja de ${originalRiskReward.toFixed(2)}× a ${newRiskReward.toFixed(2)}× y ese es el precio de no regalar el stop.`,
  };
}
