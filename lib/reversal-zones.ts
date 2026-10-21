/**
 * Best reversal zones: where several independent detectors agree.
 *
 * Each detector on the map has its own reason to expect a reaction at a price
 * — resting orders, a liquidation cluster, an order block, a gap, a Fibonacci
 * band, a Wyckoff edge. One reason is a level; several unrelated reasons at the
 * same price is a zone worth watching. The score counts DISTINCT kinds, so
 * three order blocks stacked together do not outrank one order block that
 * coincides with a liquidity pool and a Fibonacci band.
 *
 * Confluence raises the odds of a reaction; it does not guarantee a reversal,
 * and the panel says so.
 *
 * With `fillSides`, a side with no confluence still gets its best single-reason
 * level (one star, `kinds.length === 1`), so the map always marks a buy zone
 * below and a sell zone above; the panel names it as one reason, not confluence.
 */

export type LevelAtom = {
  kind: string;
  low: number;
  high: number;
  /** Relative importance of this kind. */
  weight: number;
};

export type ReversalZone = {
  low: number;
  high: number;
  mid: number;
  side: "SOPORTE" | "RESISTENCIA";
  score: number;
  stars: number;
  kinds: string[];
  distancePct: number;
};

export type MotivoAgrupado = {
  low: number;
  high: number;
  mid: number;
  score: number;
  stars: number;
  kinds: string[];
};

/**
 * Every group of reasons that touch each other (tolerances relative to `price`), with its score and stars, whatever side of
 * the price it is on and including the single-reason ones. findReversalZones picks from these; the map photo of each agent
 * entry (lib/mapa-contexto.ts) reads them against its own stop and target.
 */
export function agruparMotivos(price: number, atoms: LevelAtom[], options: { tolerancePct?: number; maxWidthPct?: number } = {}): MotivoAgrupado[] {
  if (!(price > 0) || !atoms.length) return [];
  const tol = price * (options.tolerancePct ?? 0.003);
  const maxWidth = price * (options.maxWidthPct ?? 0.012);

  const sorted = [...atoms].sort((a, b) => (a.low + a.high) / 2 - (b.low + b.high) / 2);
  const clusters: LevelAtom[][] = [];
  for (const atom of sorted) {
    const last = clusters[clusters.length - 1];
    if (last) {
      const lo = Math.min(...last.map((x) => x.low), atom.low);
      const hi = Math.max(...last.map((x) => x.high), atom.high);
      const touches = atom.low <= Math.max(...last.map((x) => x.high)) + tol;
      if (touches && hi - lo <= maxWidth) {
        last.push(atom);
        continue;
      }
    }
    clusters.push([atom]);
  }

  return clusters.map((cluster) => {
    const byKind = new Map<string, number>();
    for (const a of cluster) byKind.set(a.kind, Math.max(byKind.get(a.kind) ?? 0, a.weight));
    const low = Math.min(...cluster.map((a) => a.low));
    const high = Math.max(...cluster.map((a) => a.high));
    const score = [...byKind.values()].reduce((s, w) => s + w, 0);
    return {
      low,
      high,
      mid: (low + high) / 2,
      score,
      stars: byKind.size < 2 ? 1 : Math.max(1, Math.min(5, Math.round(score))),
      kinds: [...byKind.keys()],
    };
  });
}

export function findReversalZones(
  price: number,
  atoms: LevelAtom[],
  options: { tolerancePct?: number; maxWidthPct?: number; perSide?: number; fillSides?: boolean } = {},
): ReversalZone[] {
  if (!(price > 0) || !atoms.length) return [];
  const perSide = options.perSide ?? 2;

  const zones: ReversalZone[] = [];
  for (const g of agruparMotivos(price, atoms, options)) {
    // A zone price is sitting inside is neither support nor resistance yet.
    if (g.low <= price && g.high >= price) continue;
    zones.push({ ...g, side: g.mid < price ? "SOPORTE" : "RESISTENCIA", distancePct: (Math.abs(g.mid - price) / price) * 100 });
  }

  const best = (a: ReversalZone, b: ReversalZone) => b.score - a.score || a.distancePct - b.distancePct;
  const pick = (side: ReversalZone["side"]) => {
    const own = zones.filter((z) => z.side === side);
    const confluent = own.filter((z) => z.kinds.length >= 2).sort(best).slice(0, perSide);
    if (confluent.length || !options.fillSides) return confluent;
    return own.sort(best).slice(0, 1);
  };
  return [...pick("RESISTENCIA"), ...pick("SOPORTE")].sort((a, b) => b.mid - a.mid);
}
