/**
 * "Suben solas": coins rising on their own while BTC and ETH don't.
 *
 * A coin up 3% on a day BTC is up 3% is the market, not the coin. What is
 * wanted is the part of the move BTC does not explain. Each coin's usual
 * sensitivity to BTC (beta) is estimated from its hourly returns over the
 * 72 hours BEFORE the window being read — never including the move itself —
 * and the move is split into what that beta predicts from BTC and the rest:
 *
 *     alpha = coin return − beta × BTC return
 *
 * A coin qualifies when it is up at least `minRet`, BTC and ETH are each up
 * no more than `maxMarket` over the same hours, and alpha is at least
 * `minAlpha`. Flags say how much to trust it: traded volume against its own
 * average, how loosely it follows BTC lately, whether the gain was sustained
 * or came mostly in one candle.
 *
 * MEASURED, NOT PROMISED
 * The same rule is replayed hour by hour over the loaded history, using only
 * data up to each hour, and the next `forward` hours are checked: did the coin
 * keep beating BTC (forward alpha > 0)? Instances of one coin never overlap
 * their forward windows: a 10-hour run counts as its 4-hour pieces, not once
 * for every hour it kept qualifying.
 */

export type HourCandle = { time: number; close: number; high: number; low: number; quoteVolume: number };
export type Series = { symbol: string; candles: HourCandle[] };

export type DecouplingOptions = { window?: number; minRet?: number; maxMarket?: number; minAlpha?: number; lookback?: number };
export type CoinRead = {
  symbol: string;
  time: number;
  window: number;
  /** Percent. */
  ret: number;
  btcRet: number;
  ethRet: number;
  beta: number | null;
  corr: number | null;
  alpha: number;
  /** Traded value over the window against its average for a window of that length; null without history. */
  rvol: number | null;
  /** Share of the window's gain made by its single best hour (0–1). */
  oneCandle: number;
  /** Share of the window's hours in which the coin rose and beat BTC. */
  sustained: number;
  qualifies: boolean;
};

const DEFAULTS = { window: 4, minRet: 1.5, maxMarket: 0.3, minAlpha: 1.5, lookback: 72 };

const STABLES = new Set(["USDC", "FDUSD", "TUSD", "USDP", "DAI", "BUSD", "USD1", "EUR", "AEUR", "EURI", "TRY", "USDE", "PYUSD", "RLUSD"]);
/** Coins the scan reads: not BTC/ETH themselves, not stablecoins, not leveraged tokens, not gold/silver. */
export function eligible(symbol: string): boolean {
  if (!symbol.endsWith("USDT") || ["BTCUSDT", "ETHUSDT", "XAUUSDT", "XAGUSDT"].includes(symbol)) return false;
  const base = symbol.slice(0, -4);
  return !STABLES.has(base) && !/(UP|DOWN|BULL|BEAR)$/.test(base) && base.length > 0;
}

function betaCorr(x: number[], y: number[]): { beta: number | null; corr: number | null } {
  const n = x.length;
  if (n < 24) return { beta: null, corr: null };
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i += 1) {
    cov += (x[i] - mx) * (y[i] - my);
    vx += (x[i] - mx) ** 2;
    vy += (y[i] - my) ** 2;
  }
  return { beta: vx > 0 ? cov / vx : null, corr: vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : null };
}

/** Index by open time, so coins with a missing hour are compared hour to hour, not position to position. */
function byTime(s: Series) {
  return new Map(s.candles.map((c) => [c.time, c] as const));
}

/** Reads one coin at hour `t` (an open time of BTC's series), using only candles up to t. */
export function readCoin(coin: Series, btc: Series, eth: Series, t: number, options: DecouplingOptions = {}, cache?: { coin: Map<number, HourCandle>; btc: Map<number, HourCandle>; eth: Map<number, HourCandle> }): CoinRead | null {
  const o = { ...DEFAULTS, ...options };
  const C = cache?.coin ?? byTime(coin);
  const B = cache?.btc ?? byTime(btc);
  const E = cache?.eth ?? byTime(eth);
  const H = 3_600_000;
  const at = (m: Map<number, HourCandle>, k: number) => m.get(t - k * H);
  const now = [at(C, 0), at(B, 0), at(E, 0)];
  const start = [at(C, o.window), at(B, o.window), at(E, o.window)];
  if (now.some((x) => !x) || start.some((x) => !x)) return null;
  // Every hour of the window must exist for the coin and BTC: a gap in the
  // middle would otherwise be read as a missing candle, or crash the reading.
  for (let k = 1; k < o.window; k += 1) if (!at(C, k) || !at(B, k)) return null;
  const pct = (a: HourCandle, b: HourCandle) => (b.close / a.close - 1) * 100;
  const ret = pct(start[0]!, now[0]!);
  const btcRet = pct(start[1]!, now[1]!);
  const ethRet = pct(start[2]!, now[2]!);

  // Beta from the hours before the window: the move itself must not shape it.
  const xs: number[] = [];
  const ys: number[] = [];
  for (let k = o.window + o.lookback; k > o.window; k -= 1) {
    const b0 = at(B, k);
    const b1 = at(B, k - 1);
    const c0 = at(C, k);
    const c1 = at(C, k - 1);
    if (b0 && b1 && c0 && c1) {
      xs.push(Math.log(b1.close / b0.close));
      ys.push(Math.log(c1.close / c0.close));
    }
  }
  const { beta, corr } = betaCorr(xs, ys);
  const alpha = ret - (beta ?? 1) * btcRet;

  let windowVol = 0;
  let bestHour = 0;
  let positive = 0;
  let beat = 0;
  for (let k = o.window - 1; k >= 0; k -= 1) {
    const c0 = at(C, k + 1)!;
    const c1 = at(C, k)!;
    const b0 = at(B, k + 1)!;
    const b1 = at(B, k)!;
    windowVol += c1.quoteVolume;
    const h = (c1.close / c0.close - 1) * 100;
    if (h > 0) {
      positive += h;
      bestHour = Math.max(bestHour, h);
    }
    // An hour counts only if the coin rose AND beat BTC: a flat hour while BTC
    // dipped is not strength.
    if (h > 0 && h > (b1.close / b0.close - 1) * 100) beat += 1;
  }
  let pastVol = 0;
  let pastHours = 0;
  for (let k = o.window + o.lookback; k >= o.window + 1; k -= 1) {
    const c = at(C, k);
    if (c) {
      pastVol += c.quoteVolume;
      pastHours += 1;
    }
  }
  const rvol = pastHours >= 24 && pastVol > 0 ? windowVol / ((pastVol / pastHours) * o.window) : null;

  return {
    symbol: coin.symbol, time: t, window: o.window, ret, btcRet, ethRet, beta, corr, alpha, rvol,
    oneCandle: positive > 0 ? bestHour / positive : 0,
    sustained: beat / o.window,
    qualifies: ret >= o.minRet && btcRet <= o.maxMarket && ethRet <= o.maxMarket && alpha >= o.minAlpha,
  };
}

/** Thin volume or a gain made almost entirely in one candle: the kind of move that tends to give back. */
export function hasWarning(r: CoinRead): boolean {
  return (r.rvol !== null && r.rvol < 1) || r.oneCandle >= 0.7;
}

export type Scan = { time: number; btcRet: number; ethRet: number; marketUp: boolean; rising: CoinRead[]; leaders: CoinRead[] };

/** The latest closed hour: who rises on its own, and (for context) who leads BTC regardless. */
export function scanDecoupled(universe: Series[], btc: Series, eth: Series, options: DecouplingOptions = {}): Scan | null {
  const o = { ...DEFAULTS, ...options };
  const t = btc.candles[btc.candles.length - 1]?.time;
  if (t === undefined) return null;
  const reads = universe.filter((s) => eligible(s.symbol)).map((s) => readCoin(s, btc, eth, t, o)).filter((r): r is CoinRead => r !== null);
  const ref = readCoin(btc, btc, eth, t, o);
  if (!ref) return null;
  return {
    time: t, btcRet: ref.btcRet, ethRet: ref.ethRet,
    marketUp: ref.btcRet > o.maxMarket || ref.ethRet > o.maxMarket,
    // Warnings sink: someone starting out reads the first row first, and a
    // one-candle pump on no volume should not be it.
    rising: reads.filter((r) => r.qualifies).sort((a, b) => Number(hasWarning(a)) - Number(hasWarning(b)) || b.alpha - a.alpha),
    leaders: [...reads].sort((a, b) => b.alpha - a.alpha).slice(0, 8),
  };
}

export type ReplayStats = { instances: number; followed: number; rate: number | null; meanForwardAlpha: number | null; confidence: "SIN MUESTRA" | "MUESTRA MÍNIMA" | "MUESTRA RAZONABLE" };

/** Replays the rule hour by hour on the loaded history and checks the next `forward` hours. */
export function replayDecoupling(universe: Series[], btc: Series, eth: Series, options: DecouplingOptions & { forward?: number } = {}): ReplayStats {
  const o = { ...DEFAULTS, ...options };
  const forward = options.forward ?? 4;
  const H = 3_600_000;
  const B = byTime(btc);
  const E = byTime(eth);
  const times = btc.candles.map((c) => c.time);
  let instances = 0;
  let followed = 0;
  let sumAlpha = 0;
  for (const coin of universe.filter((s) => eligible(s.symbol))) {
    const C = byTime(coin);
    let blockedUntil = -Infinity;
    for (let i = o.window + o.lookback; i < times.length - forward; i += 1) {
      const t = times[i];
      if (t < blockedUntil) continue;
      const r = readCoin(coin, btc, eth, t, o, { coin: C, btc: B, eth: E });
      if (!r || !r.qualifies) continue;
      const c0 = C.get(t);
      const c1 = C.get(t + forward * H);
      const b0 = B.get(t);
      const b1 = B.get(t + forward * H);
      if (!c0 || !c1 || !b0 || !b1) continue;
      const fwd = (c1.close / c0.close - 1) * 100 - (r.beta ?? 1) * ((b1.close / b0.close - 1) * 100);
      instances += 1;
      sumAlpha += fwd;
      if (fwd > 0) followed += 1;
      blockedUntil = t + forward * H;
    }
  }
  return {
    instances, followed,
    rate: instances ? followed / instances : null,
    meanForwardAlpha: instances ? sumAlpha / instances : null,
    confidence: instances === 0 ? "SIN MUESTRA" : instances < 15 ? "MUESTRA MÍNIMA" : "MUESTRA RAZONABLE",
  };
}
