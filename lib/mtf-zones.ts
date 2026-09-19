import {
  findSupplyDemandZones,
  zoneStats,
  type SupplyDemandZone,
  type ZoneStats,
} from "./supply-demand.ts";
import type { SwingCandle } from "./swing-entries.ts";

/**
 * Supply and demand across timeframes, and what price is standing in.
 *
 * WHY MULTI-TIMEFRAME CHANGES THE READING
 *
 * The same price can be a demand zone on the 15m and sit in the middle of
 * nothing on the 4h — that zone is a scalp level. When a 4h zone and a 1h
 * zone cover the same prices, two independent timeframes agree that
 * something was defended there, and that is a materially different level
 * from either one alone. Confluence is the whole reason to look at more than
 * one chart, so it is computed rather than left to the eye.
 *
 * WHAT THE NUMBER ATTACHED TO A ZONE MEANS
 *
 * Not a forecast. Two counts: how many times THIS zone was tested and held,
 * and how often zones on THIS timeframe held historically. Both come from the
 * candles in front of it. A rate over three zones is not a probability, so
 * the sample size travels with it and the UI shows it.
 */

export type MtfZone = SupplyDemandZone & {
  /** Timeframes whose zones overlap these prices, this one included. */
  confluence: string[];
  /** True when price is inside this zone right now. */
  active: boolean;
};

export type MtfZoneBoard = {
  currentPrice: number;
  zones: MtfZone[];
  /** Zone price is standing in, if any. */
  standingIn: MtfZone | null;
  /** Per-timeframe hold rates, each with its own sample size. */
  stats: { timeframe: string; stats: ZoneStats }[];
  reading: string;
};

export function buildMtfZones(
  series: { timeframe: string; candles: SwingCandle[] }[],
  currentPrice: number,
): MtfZoneBoard | null {
  const usable = series.filter((entry) => entry.candles.length >= 40);
  if (!usable.length || !(currentPrice > 0)) return null;

  const perTimeframe = usable.map((entry) => ({
    timeframe: entry.timeframe,
    zones: findSupplyDemandZones(entry.candles, entry.timeframe),
    stats: zoneStats(entry.candles, entry.timeframe),
  }));

  const all = perTimeframe.flatMap((entry) => entry.zones);
  if (!all.length) return null;

  const zones: MtfZone[] = all.map((zone) => {
    const confluence = perTimeframe
      .filter((entry) =>
        entry.zones.some(
          (other) =>
            other.kind === zone.kind && zone.low <= other.high && zone.high >= other.low,
        ),
      )
      .map((entry) => entry.timeframe);
    return {
      ...zone,
      confluence,
      active: currentPrice >= zone.low && currentPrice <= zone.high,
    };
  });

  // Collapse zones that describe the same level across timeframes, keeping
  // the one with the widest agreement — listing each timeframe's copy
  // separately would turn one level into three rows saying the same thing.
  const distinct: MtfZone[] = [];
  for (const zone of [...zones].sort(
    (a, b) => b.confluence.length - a.confluence.length || b.tests - a.tests,
  )) {
    const overlaps = distinct.some(
      (kept) => kept.kind === zone.kind && zone.low <= kept.high && zone.high >= kept.low,
    );
    if (!overlaps) distinct.push(zone);
  }

  const ordered = distinct.sort((a, b) => b.mid - a.mid);
  const standingIn = ordered.find((zone) => zone.active) ?? null;

  let reading: string;
  if (standingIn) {
    const agree = standingIn.confluence.length;
    reading =
      standingIn.kind === "DEMANDA"
        ? `El precio está dentro de una zona de demanda${agree > 1 ? ` confirmada en ${agree} marcos` : ""}. ${standingIn.tests > 0 ? `Ya fue testeada ${standingIn.tests} ${standingIn.tests === 1 ? "vez y aguantó" : "veces y aguantó"}.` : "Todavía no fue testeada desde que se formó."}`
        : `El precio está dentro de una zona de oferta${agree > 1 ? ` confirmada en ${agree} marcos` : ""}. ${standingIn.tests > 0 ? `Ya fue testeada ${standingIn.tests} ${standingIn.tests === 1 ? "vez y aguantó" : "veces y aguantó"}.` : "Todavía no fue testeada desde que se formó."}`;
  } else {
    const above = ordered.find((zone) => zone.low > currentPrice && zone.kind === "OFERTA");
    const below = [...ordered].reverse().find((zone) => zone.high < currentPrice && zone.kind === "DEMANDA");
    reading = `El precio está entre zonas${below ? `, con demanda abajo en ${below.low.toFixed(2)}–${below.high.toFixed(2)}` : ""}${above ? ` y oferta arriba en ${above.low.toFixed(2)}–${above.high.toFixed(2)}` : ""}. Fuera de una zona, estos niveles son referencia, no señal.`;
  }

  return {
    currentPrice,
    zones: ordered,
    standingIn,
    stats: perTimeframe.map((entry) => ({ timeframe: entry.timeframe, stats: entry.stats })),
    reading,
  };
}
