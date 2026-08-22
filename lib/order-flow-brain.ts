// Explicit extension so Node can run this directly in the unit tests; the
// bundler resolves it the same way.
import { footprintRows, percentile, type OrderFlowTrade } from "./order-flow.ts";

/**
 * Order-flow brain: institutional footprint, squeeze conditions and structural
 * levels, derived only from executions, book depth and public derivatives data.
 *
 * Everything here is a probabilistic reading of microstructure, never a claim
 * about who is behind an order. "Institutional" describes a size and behaviour
 * pattern — refilling hidden size, absorbing aggression without giving ground —
 * not a verified identity, because no public feed reveals that.
 */

export type BookLevel = { price: number; qty: number; notional: number };

export type WallInput = {
  side: "BID" | "ASK";
  price: number;
  notional: number;
  /** Share of recent frames where this level was present, 0..100. */
  persistence: number;
};

export type LiquidationInput = {
  time: number;
  /** Side of the position that was closed out. */
  side: "LONG" | "SHORT";
  price: number;
  notional: number;
};

export type DerivativesInput = {
  fundingRatePct: number | null;
  openInterestUsd: number | null;
  openInterestChangePct: number | null;
  takerBuySellRatio: number | null;
  longShortAccountRatio: number | null;
};

export type InstitutionalEvent = {
  kind: "ICEBERG" | "ABSORCIÓN" | "BARRIDO" | "BLOQUE";
  side: "COMPRA" | "VENTA";
  price: number;
  notional: number;
  /** 0..100 confidence that this is deliberate size rather than noise. */
  confidence: number;
  detail: string;
};

export type SqueezeReading = {
  type: "SHORT SQUEEZE" | "LONG SQUEEZE" | "SIN PRESIÓN";
  score: number;
  /** Direction price would travel if the squeeze resolves. */
  bias: "ALCISTA" | "BAJISTA" | "NEUTRAL";
  factors: { label: string; points: number }[];
  missing: string[];
  detail: string;
};

export type StructureLevel = {
  price: number;
  kind: "PISO" | "TECHO";
  /** 0..100 — how much evidence supports this level holding. */
  strength: number;
  distancePct: number;
  sources: string[];
};

const clamp = (value: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, value));

/** Scores are shown to the user, so they are whole numbers, not raw floats. */
const score100 = (value: number) => Math.round(clamp(value));

const finite = (value: number | null | undefined): value is number =>
  value !== null && value !== undefined && Number.isFinite(value);

/**
 * Groups executions into price buckets and measures, per bucket, how much was
 * executed against how much was ever displayed. A level that keeps absorbing
 * far more than it ever showed is refilling hidden size.
 */
export function detectInstitutional(
  trades: OrderFlowTrade[],
  book: { bids: BookLevel[]; asks: BookLevel[] },
  mid: number,
  spread: number,
): InstitutionalEvent[] {
  if (trades.length < 20 || !mid) return [];

  const rows = footprintRows(trades, mid, spread);
  if (!rows.length) return [];

  const notionals = trades.map((trade) => trade.notional);
  const blockThreshold = percentile(notionals, 0.97);
  const events: InstitutionalEvent[] = [];

  // Displayed depth near each traded level, to compare against what executed.
  const displayedAt = (price: number) => {
    const all = [...book.bids, ...book.asks];
    const tolerance = Math.max(spread, mid * 0.0002);
    return all
      .filter((level) => Math.abs(level.price - price) <= tolerance)
      .reduce((sum, level) => sum + level.notional, 0);
  };

  const rowVolumes = rows.map((row) => row.buy + row.sell);
  const heavyLevel = percentile(rowVolumes, 0.8);

  for (const row of rows) {
    const volume = row.buy + row.sell;
    if (volume < heavyLevel || volume <= 0) continue;

    const displayed = displayedAt(row.price);
    const dominantSide = row.buy >= row.sell ? "COMPRA" : "VENTA";

    // Iceberg: repeatedly executed far beyond anything the book ever showed.
    if (displayed > 0 && volume > displayed * 4) {
      events.push({
        kind: "ICEBERG",
        side: dominantSide,
        price: row.price,
        notional: volume,
        confidence: score100(45 + Math.min(40, (volume / displayed) * 4)),
        detail: `Se ejecutaron ${(volume / displayed).toFixed(1)}× más de lo que el libro mostraba en ese nivel: hay tamaño oculto reponiéndose.`,
      });
    }

    // Absorption: one side hitting hard while the other holds the level.
    if (row.imbalance >= 3 && row.imbalance !== Infinity && volume >= heavyLevel) {
      const aggressor = row.dominant === "buy" ? "COMPRA" : "VENTA";
      events.push({
        kind: "ABSORCIÓN",
        side: aggressor === "COMPRA" ? "VENTA" : "COMPRA",
        price: row.price,
        notional: volume,
        confidence: score100(40 + Math.min(35, row.imbalance * 5)),
        detail: `Agresión ${aggressor.toLowerCase()} de ${row.imbalance.toFixed(1)}× absorbida sin que el precio atraviese el nivel: alguien está sosteniendo el otro lado.`,
      });
    }
  }

  // Block trades: single executions in the top percentile of the window.
  const blocks = trades.filter((trade) => trade.notional >= blockThreshold && blockThreshold > 0);
  for (const trade of blocks.slice(-3)) {
    events.push({
      kind: "BLOQUE",
      side: trade.buyerMaker ? "VENTA" : "COMPRA",
      price: trade.price,
      notional: trade.notional,
      confidence: 55,
      detail: `Ejecución individual en el percentil 97 de la ventana: tamaño muy por encima del flujo habitual.`,
    });
  }

  // Sweep: several adjacent levels taken in the same direction in one burst.
  const sweep = detectSweep(trades, mid);
  if (sweep) events.push(sweep);

  return events
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 8);
}

/**
 * A sweep is aggression that walks through several price levels in one short
 * burst — someone taking liquidity rather than working an order patiently.
 */
const SWEEP_WINDOW_MS = 3_000;

function detectSweep(trades: OrderFlowTrade[], mid: number): InstitutionalEvent | null {
  if (trades.length < 10) return null;

  // A sweep is a burst, so the window is measured in time from the most recent
  // execution. Taking a fixed number of trades instead would drag in older,
  // unrelated flow and stretch the span past any burst threshold.
  const latest = trades[trades.length - 1].time;
  const window = trades.filter((item) => latest - item.time <= SWEEP_WINDOW_MS);
  if (window.length < 10) return null;

  const span = latest - window[0].time;
  if (span <= 0) return null;

  const buys = window.filter((trade) => !trade.buyerMaker);
  const sells = window.filter((trade) => trade.buyerMaker);
  const dominant = buys.length >= sells.length ? buys : sells;
  if (dominant.length < window.length * 0.75) return null;

  const prices = dominant.map((trade) => trade.price);
  const travelled = Math.max(...prices) - Math.min(...prices);
  if (travelled <= 0 || travelled < mid * 0.0004) return null;

  const notional = dominant.reduce((sum, trade) => sum + trade.notional, 0);
  return {
    kind: "BARRIDO",
    side: dominant === buys ? "COMPRA" : "VENTA",
    price: prices[prices.length - 1],
    notional,
    confidence: score100(50 + Math.min(35, (travelled / (mid * 0.001)) * 10)),
    detail: `${dominant.length} ejecuciones en ${(span / 1000).toFixed(1)}s recorriendo ${((travelled / mid) * 100).toFixed(3)}%: liquidez tomada de golpe, no trabajada.`,
  };
}

/**
 * Squeeze conditions.
 *
 * A squeeze needs crowded positioning on one side plus a trigger that forces
 * it to unwind. Funding shows who is paying to hold, open interest whether
 * that crowd is still building, liquidations whether it has begun to break,
 * and aggressive flow which side is currently pressing.
 */
export function detectSqueeze(
  derivatives: DerivativesInput,
  liquidations: LiquidationInput[],
  deltaPct: number | null,
  now = Date.now(),
): SqueezeReading {
  const factors: { label: string; points: number }[] = [];
  const missing: string[] = [];

  const funding = derivatives.fundingRatePct;
  const oiChange = derivatives.openInterestChangePct;
  const taker = derivatives.takerBuySellRatio;
  const accounts = derivatives.longShortAccountRatio;

  // Positive score leans short squeeze, negative leans long squeeze.
  let lean = 0;

  if (finite(funding)) {
    if (funding <= -0.01) {
      const points = Math.min(28, Math.abs(funding) * 900);
      lean += points;
      factors.push({ label: `Funding negativo ${funding.toFixed(4)}%: los shorts pagan`, points });
    } else if (funding >= 0.02) {
      const points = Math.min(28, funding * 700);
      lean -= points;
      factors.push({ label: `Funding elevado ${funding.toFixed(4)}%: los longs pagan`, points });
    }
  } else {
    missing.push("funding");
  }

  if (finite(accounts)) {
    if (accounts <= 0.85) {
      const points = Math.min(20, (1 - accounts) * 60);
      lean += points;
      factors.push({ label: `Cuentas cargadas en short (${accounts.toFixed(2)}×)`, points });
    } else if (accounts >= 1.6) {
      const points = Math.min(20, (accounts - 1) * 22);
      lean -= points;
      factors.push({ label: `Cuentas cargadas en long (${accounts.toFixed(2)}×)`, points });
    }
  } else {
    missing.push("ratio long/short");
  }

  if (finite(oiChange) && Math.abs(oiChange) >= 0.15) {
    // Rising open interest means the crowd is still building, which is fuel.
    const points = Math.min(16, Math.abs(oiChange) * 8);
    if (oiChange > 0) {
      factors.push({ label: `Open interest subiendo ${oiChange.toFixed(2)}%: posición acumulándose`, points });
      lean += lean >= 0 ? points * 0.5 : -points * 0.5;
    } else {
      factors.push({ label: `Open interest cayendo ${oiChange.toFixed(2)}%: posición cerrándose`, points });
    }
  } else if (!finite(oiChange)) {
    missing.push("open interest");
  }

  // Recent liquidations show which side is already breaking.
  const recent = liquidations.filter((item) => now - item.time <= 10 * 60_000);
  const shortsLiquidated = recent
    .filter((item) => item.side === "SHORT")
    .reduce((sum, item) => sum + item.notional, 0);
  const longsLiquidated = recent
    .filter((item) => item.side === "LONG")
    .reduce((sum, item) => sum + item.notional, 0);
  const totalLiquidated = shortsLiquidated + longsLiquidated;

  if (totalLiquidated > 0) {
    const shortShare = shortsLiquidated / totalLiquidated;
    if (shortShare >= 0.7) {
      const points = Math.min(24, shortShare * 26);
      lean += points;
      factors.push({ label: `Liquidaciones dominadas por shorts (${(shortShare * 100).toFixed(0)}%)`, points });
    } else if (shortShare <= 0.3) {
      const points = Math.min(24, (1 - shortShare) * 26);
      lean -= points;
      factors.push({ label: `Liquidaciones dominadas por longs (${((1 - shortShare) * 100).toFixed(0)}%)`, points });
    }
  } else {
    missing.push("liquidaciones en la ventana");
  }

  if (finite(deltaPct) && Math.abs(deltaPct) >= 5) {
    const points = Math.min(12, Math.abs(deltaPct) * 0.4);
    if (deltaPct > 0) {
      lean += points;
      factors.push({ label: `Delta agresivo comprador ${deltaPct.toFixed(1)}%`, points });
    } else {
      lean -= points;
      factors.push({ label: `Delta agresivo vendedor ${deltaPct.toFixed(1)}%`, points });
    }
  }

  if (finite(taker) && taker >= 1.4) {
    factors.push({ label: `Taker buy/sell ${taker.toFixed(2)}×`, points: 8 });
    lean += 8;
  } else if (finite(taker) && taker <= 0.7) {
    factors.push({ label: `Taker buy/sell ${taker.toFixed(2)}×`, points: 8 });
    lean -= 8;
  }

  const score = Math.round(clamp(Math.abs(lean)));
  // A single factor is a coincidence; a squeeze needs several lining up.
  const qualified = score >= 45 && factors.length >= 3;

  if (!qualified) {
    return {
      type: "SIN PRESIÓN",
      score,
      bias: "NEUTRAL",
      factors,
      missing,
      detail:
        factors.length < 3
          ? "No hay suficientes factores alineados para hablar de un squeeze."
          : "El posicionamiento no está lo bastante cargado de un lado.",
    };
  }

  const isShortSqueeze = lean > 0;
  return {
    type: isShortSqueeze ? "SHORT SQUEEZE" : "LONG SQUEEZE",
    score,
    bias: isShortSqueeze ? "ALCISTA" : "BAJISTA",
    factors,
    missing,
    detail: isShortSqueeze
      ? "Posicionamiento corto cargado con presión compradora: si el precio sube, los cierres forzados de shorts empujan más arriba."
      : "Posicionamiento largo cargado con presión vendedora: si el precio cae, los cierres forzados de longs empujan más abajo.",
  };
}

/**
 * Floor and ceiling levels, the way a volume-profile desk reads them: where
 * trade concentrated, where resting size persists, and where forced closures
 * clustered. A level backed by more than one of those is worth more than one
 * backed by a single reading.
 */
export function findStructureLevels(
  trades: OrderFlowTrade[],
  walls: WallInput[],
  liquidations: LiquidationInput[],
  mid: number,
  spread: number,
): StructureLevel[] {
  if (!mid) return [];

  const candidates = new Map<
    number,
    { strength: number; sources: string[]; price: number }
  >();
  const tolerance = Math.max(spread * 2, mid * 0.0005);

  const add = (price: number, strength: number, source: string) => {
    if (!Number.isFinite(price) || price <= 0) return;
    // Merge levels that sit within tolerance of an existing candidate.
    for (const [key, entry] of candidates) {
      if (Math.abs(entry.price - price) <= tolerance) {
        entry.strength += strength;
        if (!entry.sources.includes(source)) entry.sources.push(source);
        candidates.set(key, entry);
        return;
      }
    }
    candidates.set(price, { price, strength, sources: [source] });
  };

  // Volume profile: the point of control and the edges of the value area.
  const rows = footprintRows(trades, mid, spread);
  if (rows.length) {
    const byVolume = [...rows].sort(
      (left, right) => right.buy + right.sell - (left.buy + left.sell),
    );
    const poc = byVolume[0];
    if (poc) add(poc.price, 34, "Punto de control (mayor volumen)");

    const valueArea = rows.filter((row) => row.inValueArea);
    if (valueArea.length > 1) {
      add(Math.max(...valueArea.map((row) => row.price)), 20, "Techo del área de valor");
      add(Math.min(...valueArea.map((row) => row.price)), 20, "Piso del área de valor");
    }

    // Levels where aggression was absorbed tend to hold on a retest.
    for (const row of rows) {
      if (row.imbalance >= 4) {
        add(row.price, 14, "Nivel con absorción registrada");
      }
    }
  }

  // Resting size that keeps reappearing is stronger than a one-off wall.
  for (const wall of walls) {
    if (wall.persistence < 25) continue;
    const strength = 12 + Math.min(26, (wall.persistence / 100) * 26);
    add(wall.price, strength, `Pared ${wall.side} persistente (${wall.persistence.toFixed(0)}%)`);
  }

  // Liquidation clusters mark prices the market already proved it defends.
  const grouped = new Map<number, number>();
  for (const event of liquidations) {
    const bucket = Math.round(event.price / tolerance) * tolerance;
    grouped.set(bucket, (grouped.get(bucket) ?? 0) + event.notional);
  }
  const clusterValues = [...grouped.values()];
  const clusterFloor = percentile(clusterValues, 0.7);
  for (const [price, notional] of grouped) {
    if (clusterValues.length >= 3 && notional >= clusterFloor && clusterFloor > 0) {
      add(price, 16, "Cúmulo de liquidaciones");
    }
  }

  return [...candidates.values()]
    .map((entry) => ({
      price: entry.price,
      kind: entry.price >= mid ? ("TECHO" as const) : ("PISO" as const),
      strength: Math.round(clamp(entry.strength)),
      distancePct: ((entry.price - mid) / mid) * 100,
      sources: entry.sources,
    }))
    // A level only backed by one weak reading is noise, not structure.
    .filter((level) => level.strength >= 20)
    .sort((left, right) => right.strength - left.strength)
    .slice(0, 8);
}
