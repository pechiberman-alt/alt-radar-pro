/**
 * Squeeze conditions: which side is trapped, and what it would cost to hold.
 *
 * A squeeze is not a pattern on a chart. It is a crowd on one side of the
 * market, paying to stay there, with its liquidation prices stacked close
 * enough that a modest move starts forcing exits — and each forced exit
 * pushes price further into the rest of them. So the honest way to assess one
 * is to measure those three things separately and say which are present.
 *
 * RETAIL AND LARGE TRADERS ARE READ DIFFERENTLY, ON PURPOSE
 *
 * Binance publishes both the ratio across all accounts and the ratio among
 * the largest position holders. They are not the same signal and averaging
 * them would destroy the only interesting thing about having both.
 *
 * The account ratio counts heads, so it is dominated by small positions and
 * has a long-documented tendency to be wrong at extremes — a crowd of small
 * accounts leaning one way is the classic setup for a squeeze against them.
 * The top-trader ratio weighs positions that survived long enough to be
 * large. When the two DISAGREE, that is the configuration worth naming: the
 * crowd on one side and size on the other.
 *
 * WHAT THIS DOES NOT CLAIM
 *
 * No probability. A squeeze needs a trigger and none of this predicts one.
 * What it reports is whether the fuel, the crowding and the cost are present
 * right now, each shown on its own so a reader can see which are missing.
 */

export type SqueezeSide = "CORTOS" | "LARGOS" | "NINGUNO";

export type SqueezeInputs = {
  symbol: string;
  /** Long share across all accounts, 0–1. Crowd positioning. */
  accountLongShare: number | null;
  /** Long share among the largest position holders, 0–1. */
  topTraderLongShare: number | null;
  /** Latest funding rate. Positive means longs pay shorts. */
  funding: number | null;
  /** Open interest change over the recent window, as a share. */
  oiChange: number | null;
  /** Liquidation fuel above price, in quote currency. */
  fuelAbove: number | null;
  /** Liquidation fuel below price, in quote currency. */
  fuelBelow: number | null;
  /** Distance to the nearest magnet above, as a share of price. */
  distanceAbove: number | null;
  /** Distance to the nearest magnet below, as a share of price. */
  distanceBelow: number | null;
};

export type SqueezeFactor = {
  label: string;
  /** Which side this factor would squeeze. */
  favours: SqueezeSide;
  /** 0–100 contribution. */
  weight: number;
  detail: string;
};

export type SqueezeReading = {
  symbol: string;
  /** Side that would be squeezed, i.e. forced to close. */
  side: SqueezeSide;
  /** 0–100: how many of the conditions are present, not a probability. */
  setup: number;
  factors: SqueezeFactor[];
  /** Present when crowd and large traders disagree. */
  divergence: string | null;
  note: string;
};

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

export function readSqueeze(inputs: SqueezeInputs): SqueezeReading | null {
  const factors: SqueezeFactor[] = [];

  // 1. Crowding. A lopsided crowd is the precondition — without someone
  //    trapped there is nobody to squeeze.
  if (inputs.accountLongShare !== null) {
    const share = inputs.accountLongShare;
    const lean = Math.abs(share - 0.5);
    if (lean >= 0.08) {
      const crowdLong = share > 0.5;
      factors.push({
        label: "Multitud apilada",
        // A crowd of long accounts is squeezed by a fall, so the side under
        // pressure is the crowd itself.
        favours: crowdLong ? "LARGOS" : "CORTOS",
        weight: Math.min(30, lean * 200),
        detail: `${pct(share)} de las cuentas está en ${crowdLong ? "largo" : "corto"}`,
      });
    }
  }

  // 2. Cost of holding. Paying to stay in a position is what turns patience
  //    into capitulation.
  if (inputs.funding !== null && Math.abs(inputs.funding) > 0.00005) {
    const longsPay = inputs.funding > 0;
    factors.push({
      label: "Costo de mantener",
      favours: longsPay ? "LARGOS" : "CORTOS",
      weight: Math.min(25, Math.abs(inputs.funding) * 25_000),
      detail: longsPay
        ? `funding ${pct(inputs.funding)}: los largos le pagan a los cortos`
        : `funding ${pct(inputs.funding)}: los cortos le pagan a los largos`,
    });
  }

  // 3. Fuel, weighted by how close it is. Liquidations twenty percent away
  //    are not a squeeze risk today; the same size two percent away is.
  const fuelFactor = (
    fuel: number | null,
    distance: number | null,
    squeezed: SqueezeSide,
    where: string,
  ) => {
    if (fuel === null || fuel <= 0 || distance === null || distance <= 0) return;
    const proximity = Math.max(0, 1 - distance / 0.08);
    if (proximity <= 0) return;
    factors.push({
      label: `Combustible ${where}`,
      favours: squeezed,
      weight: Math.min(30, proximity * 30),
      detail: `${(fuel / 1e6).toFixed(0)}M estimados a ${(distance * 100).toFixed(1)}% ${where}`,
    });
  };
  // Fuel above liquidates shorts; fuel below liquidates longs.
  fuelFactor(inputs.fuelAbove, inputs.distanceAbove, "CORTOS", "arriba");
  fuelFactor(inputs.fuelBelow, inputs.distanceBelow, "LARGOS", "abajo");

  // 4. Leverage being added. Rising open interest means more positions to
  //    force out if price reaches them.
  if (inputs.oiChange !== null && inputs.oiChange > 0.03) {
    factors.push({
      label: "Apalancamiento creciendo",
      favours: "NINGUNO",
      weight: Math.min(15, inputs.oiChange * 100),
      detail: `open interest +${pct(inputs.oiChange)} en la ventana`,
    });
  }

  if (!factors.length) return null;

  const scoreFor = (side: SqueezeSide) =>
    factors.filter((factor) => factor.favours === side).reduce((sum, f) => sum + f.weight, 0);
  const shortScore = scoreFor("CORTOS");
  const longScore = scoreFor("LARGOS");
  const neutral = scoreFor("NINGUNO");

  const side: SqueezeSide =
    Math.abs(shortScore - longScore) < 12
      ? "NINGUNO"
      : shortScore > longScore
        ? "CORTOS"
        : "LARGOS";

  const setup =
    side === "NINGUNO"
      ? Math.round(Math.min(100, Math.max(shortScore, longScore) + neutral))
      : Math.round(Math.min(100, Math.max(shortScore, longScore) + neutral));

  // The configuration worth naming: the crowd on one side, size on the other.
  let divergence: string | null = null;
  if (inputs.accountLongShare !== null && inputs.topTraderLongShare !== null) {
    const crowdLong = inputs.accountLongShare > 0.5;
    const topLong = inputs.topTraderLongShare > 0.5;
    if (crowdLong !== topLong) {
      divergence = `Las cuentas están mayormente en ${crowdLong ? "largo" : "corto"} (${pct(inputs.accountLongShare)}) mientras los traders grandes están del otro lado (${pct(inputs.topTraderLongShare)}). La multitud y el tamaño no coinciden.`;
    }
  }

  const note =
    side === "NINGUNO"
      ? "Las condiciones están repartidas: no hay un lado claramente atrapado."
      : side === "CORTOS"
        ? "Los cortos son el lado expuesto: si el precio sube, sus cierres forzados son compras que empujan más arriba."
        : "Los largos son el lado expuesto: si el precio baja, sus cierres forzados son ventas que empujan más abajo.";

  return {
    symbol: inputs.symbol,
    side,
    setup,
    factors: [...factors].sort((a, b) => b.weight - a.weight),
    divergence,
    note,
  };
}
