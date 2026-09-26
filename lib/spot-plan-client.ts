/**
 * Client-side data assembly for a spot plan: candles from Binance mirrors,
 * MTF zones, the Fibonacci band, trend, and locked-supply overhang — the
 * same inputs app/spot-desk.tsx has always used to drive evaluateSpot, now
 * shared so a second surface (the portfolio risk panel) reads a position
 * with the exact same engines instead of a re-implementation that could
 * quietly drift from it.
 *
 * Runs in the browser, not the Worker: it hits Binance's public mirrors
 * directly, same as every other market-data fetch in this app, and needs no
 * signed credentials — only the balance and cost-basis numbers come from the
 * user's own account.
 */

import { readFibZone } from "./fib-zone.ts";
import { loadRows } from "./market-fetch.ts";
import { buildMtfZones } from "./mtf-zones.ts";
import { evaluateSpot, type SpotPlan } from "./spot-strategy.ts";
import { parseSwingKlines } from "./swing-entries.ts";
import { parseOverhang } from "./token-unlocks.ts";

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i += 1) e = values[i] * k + e * (1 - k);
  return e;
}

export async function loadOverhang(symbol: string): Promise<number | null> {
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1",
    );
    if (!r.ok) return null;
    const rows = (await r.json()) as unknown[];
    const base = symbol.replace(/USDT$/, "").toLowerCase();
    const row = rows.find((x) => (x as { symbol?: string }).symbol === base);
    return row ? (parseOverhang(row, new Set())?.overhangRatio ?? null) : null;
  } catch {
    return null;
  }
}

export async function loadSpotPlan(
  symbol: string,
  budgetUsd: number,
  signal: AbortSignal,
): Promise<{ plan: SpotPlan; price: number } | null> {
  const [d, h4, overhang] = await Promise.all([
    loadRows(symbol, "1d", 365, signal).then(parseSwingKlines),
    loadRows(symbol, "4h", 400, signal).then(parseSwingKlines),
    loadOverhang(symbol),
  ]);
  if (d.length < 60) return null;
  const current = h4.at(-1)?.close ?? d.at(-1)!.close;
  const board = buildMtfZones(
    [{ timeframe: "1d", candles: d }, { timeframe: "4h", candles: h4 }].filter((s) => s.candles.length >= 40),
    current,
  );
  const fib = readFibZone(d);
  const trend = ema(d.map((c) => c.close), 200);
  const zones = board?.zones ?? [];
  const plan = evaluateSpot(
    {
      symbol,
      price: current,
      demandZones: zones.filter((z) => z.kind === "DEMANDA" && z.low <= current),
      supplyZones: zones.filter((z) => z.kind === "OFERTA" && z.low > current),
      fib: fib ? { inZone: fib.inZone, side: fib.side, levels: fib.levels, legLow: fib.legLow } : null,
      aboveTrend: trend === null ? null : current > trend,
      overhangRatio: overhang,
    },
    budgetUsd,
  );
  return { plan, price: current };
}
