/**
 * Los motivos del mapa de liquidaciones en un solo lugar: de los detectores (liquidez, imán de liquidaciones, order block,
 * breaker block, FVG/IFVG, Fibonacci, Wyckoff y niveles clave) a los «átomos» que junta lib/reversal-zones.ts. Lo usan el mapa
 * (app/liquidation-heatmap-desk.tsx) y la foto del mapa de cada entrada de los agentes (lib/mapa-contexto.ts), así que las zonas
 * de compra y de venta se arman con las mismas reglas en los dos lados. Pura.
 */
import type { LevelAtom } from "./reversal-zones.ts";

export type EntradaAtomos = {
  /** Liquidez en reposo. `frames` con más de un marco pesa más; las ya tomadas no cuentan. */
  pools?: { price: number; taken?: boolean; frames?: string[] }[];
  /** Imanes del modelo de liquidaciones (solo el mapa los tiene: el servidor no tiene ese modelo). */
  imanes?: ({ price: number } | null | undefined)[];
  orderBlocks?: { low: number; high: number }[];
  breakers?: { low: number; high: number }[];
  gaps?: { kind: string; low: number; high: number }[];
  fib?: { levels: { price: number }[] } | null;
  wyckoff?: { support: number; resistance: number; events: { type: string; price: number }[] } | null;
  /** Niveles clave del motor de niveles. Los que vienen solo de liquidez ya entran como pools o imanes. */
  niveles?: { low: number; high: number; sources: { kind: string }[] }[];
};

const alrededor = (precio: number, pct: number) => ({ low: precio * (1 - pct), high: precio * (1 + pct) });

export function atomosMapa(e: EntradaAtomos): LevelAtom[] {
  const atoms: LevelAtom[] = [];
  for (const pool of e.pools ?? []) {
    if (pool.taken) continue;
    atoms.push({ kind: "liquidez", weight: (pool.frames?.length ?? 1) > 1 ? 1.5 : 1, ...alrededor(pool.price, 0.0005) });
  }
  for (const iman of e.imanes ?? []) {
    if (iman) atoms.push({ kind: "imán de liquidaciones", weight: 1.5, ...alrededor(iman.price, 0.002) });
  }
  for (const b of e.orderBlocks ?? []) atoms.push({ kind: "order block", weight: 1, low: b.low, high: b.high });
  // Mismo peso que el IFVG: los dos son evidencia de una falla OBSERVADA (el precio cerró del otro lado y el nivel cambió de
  // rol), no solo un nivel sin tocar; por eso pesan más que su versión sin romper.
  for (const b of e.breakers ?? []) atoms.push({ kind: "breaker block", weight: 1.25, low: b.low, high: b.high });
  for (const g of e.gaps ?? []) atoms.push({ kind: g.kind, weight: g.kind === "IFVG" ? 1.25 : 1, low: g.low, high: g.high });
  if (e.fib) for (const l of e.fib.levels) atoms.push({ kind: "Fibonacci", weight: 1, ...alrededor(l.price, 0.001) });
  if (e.wyckoff) {
    atoms.push({ kind: "borde de rango Wyckoff", weight: 1.25, ...alrededor(e.wyckoff.support, 0.0015) });
    atoms.push({ kind: "borde de rango Wyckoff", weight: 1.25, ...alrededor(e.wyckoff.resistance, 0.0015) });
    for (const ev of e.wyckoff.events) {
      if (ev.type === "SPRING" || ev.type === "UPTHRUST") atoms.push({ kind: ev.type === "SPRING" ? "spring" : "upthrust", weight: 1.5, ...alrededor(ev.price, 0.0015) });
    }
  }
  // Cada nivel cuenta una vez, como un solo motivo; los de pura liquidez ya están arriba y no se cuentan dos veces.
  for (const l of e.niveles ?? []) {
    if (l.sources.some((x) => x.kind !== "IMÁN" && !x.kind.startsWith("POOL"))) atoms.push({ kind: "nivel clave", weight: 1, low: l.low, high: l.high });
  }
  return atoms;
}
