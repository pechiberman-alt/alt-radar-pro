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

export function findReversalZones(
  price: number,
  atoms: LevelAtom[],
  options: { tolerancePct?: number; maxWidthPct?: number; perSide?: number } = {},
): ReversalZone[] {
  if (!(price > 0) || !atoms.length) return [];
  const tol = price * (options.tolerancePct ?? 0.003);
  const maxWidth = price * (options.maxWidthPct ?? 0.012);
  const perSide = options.perSide ?? 2;

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

  const zones: ReversalZone[] = [];
  for (const cluster of clusters) {
    const byKind = new Map<string, number>();
    for (const a of cluster) byKind.set(a.kind, Math.max(byKind.get(a.kind) ?? 0, a.weight));
    if (byKind.size < 2) continue;
    const low = Math.min(...cluster.map((a) => a.low));
    const high = Math.max(...cluster.map((a) => a.high));
    const mid = (low + high) / 2;
    // A zone price is sitting inside is neither support nor resistance yet.
    if (low <= price && high >= price) continue;
    const score = [...byKind.values()].reduce((s, w) => s + w, 0);
    zones.push({
      low,
      high,
      mid,
      side: mid < price ? "SOPORTE" : "RESISTENCIA",
      score,
      stars: Math.max(1, Math.min(5, Math.round(score))),
      kinds: [...byKind.keys()],
      distancePct: (Math.abs(mid - price) / price) * 100,
    });
  }

  const pick = (side: ReversalZone["side"]) =>
    zones
      .filter((z) => z.side === side)
      .sort((a, b) => b.score - a.score || a.distancePct - b.distancePct)
      .slice(0, perSide);
  return [...pick("RESISTENCIA"), ...pick("SOPORTE")].sort((a, b) => b.mid - a.mid);
}
