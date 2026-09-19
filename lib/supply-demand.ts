import type { SwingCandle } from "./swing-entries";

/**
 * Supply and demand zones, tracked across timeframes.
 *
 * WHAT A ZONE IS
 *
 * A base — a few candles of little progress, where orders accumulated —
 * followed by an impulsive departure. The base is where the imbalance was
 * built; the departure is the evidence that it was one-sided. A return to the
 * base is read as a chance for what was left unfilled to be filled.
 *
 * A ZONE IS SPENT WHEN IT BREAKS, NOT WHEN IT IS TOUCHED
 *
 * This is the rule that separates a useful zone map from a decorative one,
 * and it is the opposite of how a fair-value gap is treated. Price returning
 * to a demand zone and bouncing does not consume it — it CONFIRMS it, and the
 * zone should carry more weight afterwards, not less. Only a close beyond the
 * far side invalidates it. So a tested zone gets stronger and a broken one
 * disappears, which is the behaviour the levels are supposed to model.
 *
 * ON "PROBABILITY"
 *
 * No probability is asserted here. What is reported is a COUNT from the data
 * in front of it: how many times each zone was tested, and how many of those
 * tests it held. Alongside it sits the same count aggregated over every zone
 * the series produced, which is the only base rate available without a paid
 * historical dataset.
 *
 * A rate over two tests is not a probability and calling it one would be
 * dishonest, so the sample size travels with the number everywhere and the
 * UI is expected to show it. Small samples are labelled as such rather than
 * rounded into false confidence.
 */

export type ZoneKind = "DEMANDA" | "OFERTA";
export type ZoneState = "FRESCA" | "VALIDADA" | "ROTA";

export type SupplyDemandZone = {
  kind: ZoneKind;
  timeframe: string;
  low: number;
  high: number;
  mid: number;
  index: number;
  time: number;
  /** Strength of the departure, in average ranges. */
  departure: number;
  /** Times price entered the zone and left without closing beyond it. */
  tests: number;
  /** Times price closed beyond the far side. Above zero means broken. */
  breaks: number;
  state: ZoneState;
  ageCandles: number;
};

export type ZoneStats = {
  /** Zones that were tested at least once. */
  tested: number;
  /** Of those, how many were still holding at the end of the series. */
  held: number;
  /** held / tested, or null when nothing was tested. */
  holdRate: number | null;
  /** Plain-language reliability of the number itself. */
  confidence: "SIN MUESTRA" | "MUESTRA MÍNIMA" | "MUESTRA RAZONABLE";
};

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function averageRange(candles: SwingCandle[], end: number, period = 14): number {
  const from = Math.max(1, end - period);
  const ranges: number[] = [];
  for (let i = from; i < end; i += 1) {
    const previousClose = candles[i - 1].close;
    ranges.push(
      Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - previousClose),
        Math.abs(candles[i].low - previousClose),
      ),
    );
  }
  return average(ranges);
}

export type ZoneOptions = {
  /** Candles forming the base. */
  baseLength?: number;
  /** Minimum departure from the base, in average ranges. */
  minDeparture?: number;
  limit?: number;
};

/**
 * Detects every zone the series produced, broken ones included.
 *
 * One detection path, not two. The base rate needs the zones that failed and
 * the map needs the ones that survived; computing them separately guaranteed
 * the two copies would drift apart the first time a criterion changed.
 */
export function detectZones(
  candles: SwingCandle[],
  timeframe: string,
  options: ZoneOptions = {},
): SupplyDemandZone[] {
  const baseLength = options.baseLength ?? 3;
  const minDeparture = options.minDeparture ?? 2;

  if (candles.length < 40) return [];

  const zones: SupplyDemandZone[] = [];
  const last = candles.length - 1;

  for (let i = 20; i < candles.length - baseLength - 3; i += 1) {
    const range = averageRange(candles, i);
    if (!(range > 0)) continue;

    const base = candles.slice(i, i + baseLength);
    const baseHigh = Math.max(...base.map((candle) => candle.high));
    const baseLow = Math.min(...base.map((candle) => candle.low));
    // A base is quiet. A wide one is just a move, and its bounds would not
    // describe a level anyone is defending.
    if (baseHigh - baseLow > range * 2) continue;

    const after = candles.slice(i + baseLength, i + baseLength + 3);
    if (after.length < 3) continue;

    const up = Math.max(...after.map((candle) => candle.high)) - baseHigh;
    const down = baseLow - Math.min(...after.map((candle) => candle.low));
    const demand = up > down;
    const departure = (demand ? up : down) / range;
    if (departure < minDeparture) continue;

    // What happened afterwards, candle by candle. A test is an entry that
    // leaves without closing through; a break is a close beyond the far side.
    let tests = 0;
    let breaks = 0;
    let inside = false;
    for (let j = i + baseLength + 3; j <= last; j += 1) {
      const candle = candles[j];
      const touching = candle.low <= baseHigh && candle.high >= baseLow;
      if (demand ? candle.close < baseLow : candle.close > baseHigh) {
        breaks += 1;
        break;
      }
      if (touching && !inside) inside = true;
      else if (!touching && inside) {
        tests += 1;
        inside = false;
      }
    }
    // Still inside at the end of the series is an open outcome, counted as
    // neither a test nor a break — deciding it either way would be a guess.

    zones.push({
      kind: demand ? "DEMANDA" : "OFERTA",
      timeframe,
      low: baseLow,
      high: baseHigh,
      mid: (baseLow + baseHigh) / 2,
      index: i,
      time: candles[i].openTime,
      departure,
      tests,
      breaks,
      state: breaks > 0 ? "ROTA" : tests > 0 ? "VALIDADA" : "FRESCA",
      ageCandles: last - i,
    });
  }

  return zones;
}

/** The live map: broken zones are gone, survivors deduplicated and ranked. */
export function findSupplyDemandZones(
  candles: SwingCandle[],
  timeframe: string,
  options: ZoneOptions = {},
): SupplyDemandZone[] {
  const limit = options.limit ?? 6;
  const alive = detectZones(candles, timeframe, options).filter(
    (zone) => zone.state !== "ROTA",
  );

  // Overlapping zones of the same kind describe one level; keep the one with
  // the most confirmation, then the stronger departure.
  const distinct: SupplyDemandZone[] = [];
  for (const zone of [...alive].sort((a, b) => b.tests - a.tests || b.departure - a.departure)) {
    const overlaps = distinct.some(
      (kept) => kept.kind === zone.kind && zone.low <= kept.high && zone.high >= kept.low,
    );
    if (!overlaps) distinct.push(zone);
  }

  return distinct.slice(0, limit).sort((a, b) => b.mid - a.mid);
}

/**
 * Hold rate across every zone the series produced, broken ones included —
 * otherwise the rate would only count survivors and report near 100% no
 * matter what the market did.
 */
export function zoneStats(candles: SwingCandle[], timeframe: string): ZoneStats {
  const all = detectZones(candles, timeframe);
  const resolved = all.filter((zone) => zone.tests > 0 || zone.breaks > 0);
  const held = resolved.filter((zone) => zone.breaks === 0).length;

  const confidence: ZoneStats["confidence"] =
    resolved.length === 0
      ? "SIN MUESTRA"
      : resolved.length < 8
        ? "MUESTRA MÍNIMA"
        : "MUESTRA RAZONABLE";

  return {
    tested: resolved.length,
    held,
    holdRate: resolved.length > 0 ? held / resolved.length : null,
    confidence,
  };
}
