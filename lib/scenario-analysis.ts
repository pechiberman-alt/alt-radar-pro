import type { FairValueGap } from "./fair-value-gaps.ts";
import type { LiquidationHeatmap } from "./liquidation-heatmap.ts";
import type { LiquidityPool } from "./liquidity-pools.ts";
import type { OrderBlock } from "./order-blocks.ts";

/**
 * Synthesizes the chart's separate detectors into a small set of directional
 * scenarios — what price would need to do, what it would likely be aiming
 * for if it does, and what would prove the read wrong.
 *
 * WHAT THIS IS NOT
 *
 * Not a forecast, and not one favoured outcome. Two scenarios are always
 * built — bullish and bearish — each conditional: "if price does X, the
 * structure points at Y, because Z lines up there." Which one actually
 * happens is not something any of this module's inputs can tell, and it
 * does not try to rank them against each other. A third, shorter-horizon
 * scenario appears only when the setup for it is actually present (see
 * below), not on every read.
 *
 * A DELIBERATE DEPARTURE FROM THE TEXTBOOK CLAIM ABOUT LIQUIDITY SWEEPS
 *
 * The common trading-lore claim is that a sweep of resting liquidity is
 * reliably followed by a reversal — smart money grabs the stops, then turns
 * price around. That is a popular reading, not a demonstrated law, and
 * asserting it as fact would be teaching folklore as methodology. Both
 * things really do happen: a sweep that gets firmly rejected often does
 * reverse, and a sweep that price closes through and holds above often
 * continues. So a liquidity pool here produces two READINGS depending on
 * how price behaves there, stated as a conditional, not a single claim.
 */

export type ScenarioLevel = {
  label: string;
  price: number;
};

export type Scenario = {
  id: "ALCISTA" | "BAJISTA" | "BARRIDO";
  title: string;
  trigger: ScenarioLevel;
  target: (ScenarioLevel & { confluences: string[] }) | null;
  invalidation: ScenarioLevel | null;
  reasoning: string;
};

export type ScenarioBoard = {
  currentPrice: number;
  scenarios: Scenario[];
  note: string;
};

type Confluence = { kind: string; price: number; low: number; high: number };

function fromPools(pools: LiquidityPool[]): Confluence[] {
  return pools.map((pool) => ({
    kind: pool.side === "COMPRA" ? "liquidez de compra" : "liquidez de venta",
    price: pool.price,
    low: pool.price * 0.999,
    high: pool.price * 1.001,
  }));
}
function fromBlocks(blocks: OrderBlock[]): Confluence[] {
  return blocks.map((block) => ({
    kind: `order block ${block.side === "ALCISTA" ? "alcista" : "bajista"}`,
    price: block.mid,
    low: block.low,
    high: block.high,
  }));
}
function fromGaps(gaps: FairValueGap[]): Confluence[] {
  return gaps.map((gap) => ({ kind: gap.kind, price: gap.mid, low: gap.low, high: gap.high }));
}
function fromHeatmap(heatmap: LiquidationHeatmap | null): Confluence[] {
  if (!heatmap) return [];
  const out: Confluence[] = [];
  if (heatmap.topZoneAbove) {
    out.push({
      kind: "zona imán de liquidaciones",
      price: heatmap.topZoneAbove.price,
      low: heatmap.topZoneAbove.price * 0.997,
      high: heatmap.topZoneAbove.price * 1.003,
    });
  }
  if (heatmap.topZoneBelow) {
    out.push({
      kind: "zona imán de liquidaciones",
      price: heatmap.topZoneBelow.price,
      low: heatmap.topZoneBelow.price * 0.997,
      high: heatmap.topZoneBelow.price * 1.003,
    });
  }
  return out;
}

/** Anything else whose range overlaps this level, named plainly. */
function confluencesAt(level: Confluence, all: Confluence[]): string[] {
  return all
    .filter((other) => other !== level && other.low <= level.high && other.high >= level.low)
    .map((other) => other.kind);
}

const fmt = (price: number) =>
  price >= 1000 ? price.toFixed(0) : price >= 1 ? price.toFixed(2) : price.toFixed(6);

export function buildScenarios(inputs: {
  currentPrice: number;
  pools: LiquidityPool[];
  orderBlocks: OrderBlock[];
  gaps: FairValueGap[];
  heatmap: LiquidationHeatmap | null;
}): ScenarioBoard | null {
  const { currentPrice } = inputs;
  if (!(currentPrice > 0)) return null;

  const all = [
    ...fromPools(inputs.pools),
    ...fromBlocks(inputs.orderBlocks),
    ...fromGaps(inputs.gaps),
    ...fromHeatmap(inputs.heatmap),
  ];
  if (!all.length) return null;

  const above = all.filter((level) => level.price > currentPrice).sort((a, b) => a.price - b.price);
  const below = all.filter((level) => level.price < currentPrice).sort((a, b) => b.price - a.price);

  const scenarios: Scenario[] = [];

  if (above.length) {
    const trigger = above[0];
    const beyond = above.slice(1).find((level) => Math.abs(level.price - trigger.price) / trigger.price > 0.003);
    const invalidation = below[0] ?? null;
    scenarios.push({
      id: "ALCISTA",
      title: "Ruptura y continuación al alza",
      trigger: { label: trigger.kind, price: trigger.price },
      target: beyond
        ? { label: beyond.kind, price: beyond.price, confluences: confluencesAt(beyond, all) }
        : null,
      invalidation: invalidation ? { label: invalidation.kind, price: invalidation.price } : null,
      reasoning: beyond
        ? `Si el precio cierra por encima de ${fmt(trigger.price)} (${trigger.kind}) y se mantiene ahí sin volver a entrar, el siguiente nivel con motivo real de reacción es ${fmt(beyond.price)}${confluencesAt(beyond, all).length ? `, donde también hay ${confluencesAt(beyond, all).join(" y ")}` : ""}.`
        : `Si el precio cierra por encima de ${fmt(trigger.price)} (${trigger.kind}) y se mantiene ahí, no hay otro nivel detectado más arriba dentro del rango proyectado: el movimiento quedaría sin un objetivo estructural claro.`,
    });
  }

  if (below.length) {
    const trigger = below[0];
    const beyond = below.slice(1).find((level) => Math.abs(level.price - trigger.price) / trigger.price > 0.003);
    const invalidation = above[0] ?? null;
    scenarios.push({
      id: "BAJISTA",
      title: "Ruptura y continuación a la baja",
      trigger: { label: trigger.kind, price: trigger.price },
      target: beyond
        ? { label: beyond.kind, price: beyond.price, confluences: confluencesAt(beyond, all) }
        : null,
      invalidation: invalidation ? { label: invalidation.kind, price: invalidation.price } : null,
      reasoning: beyond
        ? `Si el precio cierra por debajo de ${fmt(trigger.price)} (${trigger.kind}) y se mantiene ahí, el siguiente nivel con motivo real de reacción es ${fmt(beyond.price)}${confluencesAt(beyond, all).length ? `, donde también hay ${confluencesAt(beyond, all).join(" y ")}` : ""}.`
        : `Si el precio cierra por debajo de ${fmt(trigger.price)} (${trigger.kind}) y se mantiene ahí, no hay otro nivel detectado más abajo dentro del rango proyectado.`,
    });
  }

  // The short-horizon read: only shown when price is genuinely squeezed
  // between two close pools, which is the specific condition the
  // sweep-then-reverse pattern actually describes — not every chart has it.
  const nearestPoolAbove = inputs.pools.find((p) => p.side === "COMPRA" && p.price > currentPrice);
  const nearestPoolBelow = inputs.pools.find((p) => p.side === "VENTA" && p.price < currentPrice);
  if (nearestPoolAbove && nearestPoolBelow) {
    const spanPct =
      (nearestPoolAbove.price - nearestPoolBelow.price) / currentPrice;
    if (spanPct <= 0.02) {
      scenarios.push({
        id: "BARRIDO",
        title: "Barrido de un lado y reversión hacia el otro",
        trigger: { label: "liquidez de compra", price: nearestPoolAbove.price },
        target: {
          label: "liquidez de venta",
          price: nearestPoolBelow.price,
          confluences: [],
        },
        invalidation: null,
        reasoning: `El precio está apretado entre dos piletas de liquidez cercanas: compra en ${fmt(nearestPoolAbove.price)} y venta en ${fmt(nearestPoolBelow.price)}, a sólo ${(spanPct * 100).toFixed(1)}% de distancia. En un apriete así es común que primero se cace un lado — con mecha y rechazo, sin sostenerse — y recién después el precio vaya a buscar el otro. Esto es una lectura de corto plazo, distinta de los dos escenarios de arriba: no dice hacia dónde va el mediano plazo, dice qué suele pasar primero.`,
      });
    }
  }

  return {
    currentPrice,
    scenarios,
    note: "Ninguno de estos escenarios tiene una probabilidad asignada, y no se favorece uno sobre otro. Cada uno es una lectura condicional: si pasa esto, la estructura sugiere aquello, y esto es lo que lo contradiría. Un barrido de liquidez no revierte siempre ni continúa siempre — depende de si el precio lo rechaza o lo sostiene, y eso todavía no pasó.",
  };
}
