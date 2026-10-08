import { backtestSteps, BACKTEST_STEP_H, finishBacktest, startBacktest, stepBacktest, WARMUP_H1, type BacktestInput, type BacktestResult } from "./jarvis-backtest.ts";
import { loadDeskSettings } from "./jarvis-desk-run.ts";
import { BROWSER_BASES, FUTURES_BASES } from "./market-fetch.ts";
import { parseSwingKlines, type SwingCandle } from "./swing-entries.ts";

/**
 * El backtest en el navegador: baja la historia de Binance (futuros primero,
 * la misma fuente de la mesa) y camina de a pedazos para no trabar el
 * celular. El último resultado queda a mano para el chat de JARVIS.
 */

export const BACKTEST_EVENT = "alt-radar:jarvis-backtest";
export const BACKTEST_DAYS = [30, 90, 180] as const;
const H = 3_600_000;
const FRAME: Record<"1h" | "4h" | "1d", number> = { "1h": H, "4h": 4 * H, "1d": 24 * H };

export type BacktestProgress = { fase: "datos" | "mesa"; hechos: number; total: number };
export type BacktestOutcome = { ok: true; result: BacktestResult; nota: string | null } | { ok: false; error: string };

let last: BacktestResult | null = null;

export function lastBacktest(): BacktestResult | null {
  return last;
}

function emit() {
  try {
    window.dispatchEvent(new CustomEvent(BACKTEST_EVENT));
  } catch {
    // No window: nobody to tell.
  }
}

/** Velas entre `start` y `end`, de a 1000, con la fuente que respondió. */
export async function historyOf(symbol: string, interval: "1h" | "4h" | "1d", start: number, end: number, signal: AbortSignal): Promise<{ candles: SwingCandle[]; venue: string } | null> {
  const routes: [string[], string, string][] = [
    [FUTURES_BASES, "/fapi/v1/klines", "Binance Futures"],
    [BROWSER_BASES, "/api/v3/klines", "Binance Spot"],
  ];
  for (const [bases, path, venue] of routes) {
    const out: SwingCandle[] = [];
    let from = start;
    let failed = false;
    while (from < end && !signal.aborted) {
      let page: SwingCandle[] | null = null;
      for (const b of bases) {
        try {
          const r = await fetch(`${b}${path}?symbol=${encodeURIComponent(symbol)}&interval=${interval}&startTime=${Math.floor(from)}&endTime=${Math.floor(end)}&limit=1000`, { signal });
          if (!r.ok) continue;
          page = parseSwingKlines(await r.json());
          break;
        } catch {
          // Next mirror.
        }
      }
      if (page === null) {
        failed = true;
        break;
      }
      const fresh = page.filter((c) => c.openTime >= from);
      if (!fresh.length) break;
      out.push(...fresh);
      from = fresh[fresh.length - 1].openTime + FRAME[interval];
      if (fresh.length < 1000) break;
    }
    if (!failed && out.length) return { candles: out, venue };
  }
  return null;
}

const pause = () => new Promise((r) => setTimeout(r, 0));

/**
 * Corre el backtest de la mesa sobre los últimos `days` días de un activo.
 * Si la moneda tiene menos historia, se acorta la ventana y se dice.
 */
export async function runBacktestFor(symbol: string, days: number, onProgress?: (p: BacktestProgress) => void, signal: AbortSignal = new AbortController().signal): Promise<BacktestOutcome> {
  const sym = symbol.toUpperCase().endsWith("USDT") ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
  const step = BACKTEST_STEP_H * H;
  const to = Math.floor(Date.now() / step) * step;
  const from = to - days * 24 * H;
  onProgress?.({ fase: "datos", hechos: 0, total: 1 });
  const [h1, h4, d1, btc, eth] = await Promise.all([
    historyOf(sym, "1h", from - WARMUP_H1 * H, to, signal),
    historyOf(sym, "4h", from - 300 * 4 * H, to, signal),
    historyOf(sym, "1d", from - 220 * 24 * H, to, signal),
    sym === "BTCUSDT" ? Promise.resolve(null) : historyOf("BTCUSDT", "1h", from - 200 * H, to, signal),
    sym === "ETHUSDT" ? Promise.resolve(null) : historyOf("ETHUSDT", "1h", from - 200 * H, to, signal),
  ]);
  if (signal.aborted) return { ok: false, error: "Backtest cancelado." };
  // Only candles already closed: the one still forming is not history yet.
  const real = Date.now();
  for (const [x, tf] of [[h1, "1h"], [h4, "4h"], [d1, "1d"], [btc, "1h"], [eth, "1h"]] as const) {
    if (x) x.candles = x.candles.filter((c) => c.openTime + FRAME[tf] <= real);
  }
  if (!h1 || h1.candles.length < 300) return { ok: false, error: `Binance no devolvió historia suficiente de ${sym.replace(/USDT$/, "")}. Este dato no está disponible actualmente.` };
  // A young coin: the window starts once there are enough candles for the desk.
  const firstUsable = h1.candles[Math.min(h1.candles.length - 1, 200)].openTime;
  const start = Math.max(from, Math.ceil(firstUsable / step) * step);
  const nota = start > from ? `${sym.replace(/USDT$/, "")} tiene menos historia: el backtest arranca el ${new Date(start).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}.` : null;
  const input: BacktestInput = {
    symbol: sym,
    h1: h1.candles,
    h4: h4?.candles ?? null,
    d1: d1?.candles ?? null,
    btc: btc?.candles ?? null,
    eth: eth?.candles ?? null,
    from: start,
    to,
    settings: loadDeskSettings(),
    fuente: h1.venue,
  };
  const total = backtestSteps(input);
  const first = Math.ceil(start / step) * step;
  let s = startBacktest(input);
  while (!s.done) {
    if (signal.aborted) return { ok: false, error: "Backtest cancelado." };
    s = stepBacktest(input, s, 24);
    onProgress?.({ fase: "mesa", hechos: Math.min(total, Math.round((s.next - first) / step)), total });
    await pause();
  }
  const result = finishBacktest(input, s);
  last = result;
  emit();
  return { ok: true, result, nota };
}
