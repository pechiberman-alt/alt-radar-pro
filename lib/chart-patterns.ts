import type { SwingCandle } from "./swing-entries.ts";

/**
 * Flags and Wyckoff events, detected mechanically.
 *
 * Both are pattern vocabularies traders apply by eye. What is implemented here
 * is the part that can be defined without judgment — a pole and a tight
 * counter-move for flags; a range, a false break of its edge, and a close
 * beyond it for Wyckoff. The intent behind them (a "composite operator"
 * absorbing supply) is interpretation, and the panel does not claim it.
 */

function atr(c: SwingCandle[], end: number, period = 14) {
  const from = Math.max(1, end - period);
  let sum = 0;
  let n = 0;
  for (let i = from; i <= end && i < c.length; i += 1) {
    const pc = c[i - 1].close;
    sum += Math.max(c[i].high - c[i].low, Math.abs(c[i].high - pc), Math.abs(c[i].low - pc));
    n += 1;
  }
  return n ? sum / n : 0;
}

function fit(points: { x: number; y: number }[]) {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  const slope = den ? num / den : 0;
  return { slope, at: (x: number) => my + slope * (x - mx) };
}

/** Net move over total path, 0–1. Near 1 is a trend; near 0 is back and forth. */
function efficiency(xs: number[]) {
  let path = 0;
  for (let i = 1; i < xs.length; i += 1) path += Math.abs(xs[i] - xs[i - 1]);
  return path > 0 ? Math.abs(xs[xs.length - 1] - xs[0]) / path : 0;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/* ───────────────────────── FLAGS ───────────────────────── */

export type FlagPattern = {
  kind: "BULL FLAG" | "BEAR FLAG";
  poleStart: number;
  poleEnd: number;
  flagStart: number;
  flagEnd: number;
  poleHeight: number;
  /** Channel lines across the flag, as [price at flagStart, price at flagEnd]. */
  upper: [number, number];
  lower: [number, number];
  /** Price that confirms the flag; target = breakout ± pole height. */
  breakout: number;
  target: number;
  invalidation: number;
  retracePct: number;
  volumeFades: boolean;
  status: "FORMANDO" | "CONFIRMADA" | "FALLIDA";
};

/**
 * The most recent bull and bear flag, if any.
 *
 * Pole: a fast move of at least 3 ATR in 2–12 candles. Flag: at least four
 * candles that neither retrace more than half the pole nor span more than 60%
 * of it. Confirmed when a close leaves the flag in the pole's direction,
 * failed when a close leaves it the other way. Target is the classic measured
 * move — pole height from the breakout — which is a convention, not a law.
 */
export function findFlags(c: SwingCandle[], lookback = 120, maxPerKind = 2): FlagPattern[] {
  if (c.length < 40) return [];
  const last = c.length - 1;
  const out: FlagPattern[] = [];

  // Several per kind across the window, newest first and never overlapping:
  // a flag that already confirmed or failed is still worth seeing on the chart.
  for (const bull of [true, false]) {
    let found = 0;
    for (let e = last - 4; e >= Math.max(20, last - lookback) && found < maxPerKind; e -= 1) {
      // Pole: extreme at e, origin the opposite extreme within 12 candles.
      let s = e;
      for (let k = e - 1; k >= e - 12 && k > 0; k -= 1) {
        if (bull ? c[k].low < c[s].low : c[k].high > c[s].high) s = k;
      }
      if (e - s < 2) continue;
      const window = c.slice(s, e + 1);
      const top = bull ? Math.max(...window.map((x) => x.high)) : Math.min(...window.map((x) => x.low));
      if (bull ? c[e].high !== top : c[e].low !== top) continue;
      const pole = bull ? c[e].high - c[s].low : c[s].high - c[e].low;
      const a = atr(c, s);
      if (!(a > 0) || pole < 3 * a || pole / (e - s + 1) < 0.7 * a) continue;

      const limit = bull ? c[e].high - 0.5 * pole : c[e].low + 0.5 * pole;
      let hi = -Infinity;
      let lo = Infinity;
      let status: FlagPattern["status"] = "FORMANDO";
      let flagEnd = e;
      let valid = true;
      for (let j = e + 1; j <= Math.min(last, e + 25); j += 1) {
        const flagLen = j - (e + 1);
        if (flagLen >= 4) {
          if (bull ? c[j].close > hi : c[j].close < lo) {
            status = "CONFIRMADA";
            break;
          }
          if (bull ? c[j].close < lo : c[j].close > hi) {
            status = "FALLIDA";
            break;
          }
        }
        if (bull ? c[j].low < limit : c[j].high > limit) {
          valid = false;
          break;
        }
        hi = Math.max(hi, c[j].high);
        lo = Math.min(lo, c[j].low);
        flagEnd = j;
      }
      const flagLen = flagEnd - e;
      if (!valid || flagLen < 4 || hi - lo > 0.6 * pole) continue;

      const flag = c.slice(e + 1, flagEnd + 1);
      const up = fit(flag.map((x, i) => ({ x: i, y: x.high })));
      const dn = fit(flag.map((x, i) => ({ x: i, y: x.low })));
      // A flag leans against the pole or goes sideways; one drifting with it
      // is continuation already under way, not a pause.
      const drift = (bull ? up.slope : -dn.slope) * flagLen;
      if (drift > 0.15 * pole) continue;

      const n = flag.length - 1;
      // The channel edge at the last flag candle, on the pole's side.
      const breakout = bull ? up.at(n) : dn.at(n);
      out.push({
        kind: bull ? "BULL FLAG" : "BEAR FLAG",
        poleStart: s,
        poleEnd: e,
        flagStart: e + 1,
        flagEnd,
        poleHeight: pole,
        upper: [up.at(0), up.at(n)],
        lower: [dn.at(0), dn.at(n)],
        breakout,
        target: bull ? breakout + pole : breakout - pole,
        invalidation: bull ? lo : hi,
        retracePct: ((bull ? c[e].high - lo : hi - c[e].low) / pole) * 100,
        volumeFades: avg(flag.map((x) => x.volume)) < avg(window.map((x) => x.volume)),
        status,
      });
      found += 1;
      e = s - 1; // continue before this pole, so patterns never overlap
    }
  }
  return out;
}

/* ───────────────────────── WYCKOFF ───────────────────────── */

export type WyckoffEvent = {
  type: "SC" | "BC" | "AR" | "SPRING" | "UPTHRUST" | "SOS" | "SOW";
  index: number;
  price: number;
  highVolume: boolean;
};

export type WyckoffReading = {
  kind: "ACUMULACIÓN" | "DISTRIBUCIÓN";
  start: number;
  end: number;
  support: number;
  resistance: number;
  events: WyckoffEvent[];
  phase: string;
  note: string;
};

/**
 * The trading range the market is in (or just left), read in Wyckoff terms.
 *
 * Context decides the name: a range after a decline is read as possible
 * accumulation, after an advance as possible distribution. Inside it, only
 * mechanical events are marked — the climax that started it, the reaction
 * that set the other edge, a false break of an edge that closes back inside
 * (spring / upthrust), and a volume-backed close beyond the edge (SOS / SOW).
 * Whether it really was accumulation is only known after the fact.
 */
export function readWyckoff(c: SwingCandle[]): WyckoffReading | null {
  if (c.length < 80) return null;
  const last = c.length - 1;

  for (let tail = 0; tail <= 10; tail += 1) {
    for (let w = 70; w >= 24; w -= 2) {
      const end = last - tail;
      const start = end - w + 1;
      if (start < 30) continue;
      const r = c.slice(start, end + 1);
      const bodyLo = Math.min(...r.map((x) => Math.min(x.open, x.close)));
      const bodyHi = Math.max(...r.map((x) => Math.max(x.open, x.close)));
      const height = bodyHi - bodyLo;
      const a = atr(c, end);
      if (!(a > 0) || height < 2 * a || height > 9 * a) continue;

      const closes = fit(r.map((x, i) => ({ x: i, y: x.close })));
      // A range goes sideways: net drift across it stays under half its height.
      if (Math.abs(closes.slope * w) > 0.5 * height) continue;
      const nearLo = r.filter((x) => x.close <= bodyLo + 0.25 * height).length;
      const nearHi = r.filter((x) => x.close >= bodyHi - 0.25 * height).length;
      if (nearLo < 3 || nearHi < 3) continue;
      // Flat for real: closes wander, they do not travel.
      if (efficiency(r.map((x) => x.close)) > 0.25) continue;

      // The prior move must be a trend, not drift: it has to be large against
      // volatility AND efficient (most of its path in one direction). Without
      // this, any pause in a random walk read as accumulation or distribution.
      const prior = c.slice(start - 30, start + 1).map((x) => x.close);
      const move = prior[prior.length - 1] - prior[0];
      if (Math.abs(move) < 6 * a || efficiency(prior) < 0.4) continue;
      const accumulation = move < 0;

      const vAvg = avg(c.slice(start - 20, end + 1).map((x) => x.volume));
      const hv = (i: number) => c[i].volume > 1.5 * vAvg;
      const events: WyckoffEvent[] = [];

      const third = start + Math.floor(w / 3);
      let climax = start;
      for (let i = start; i <= third; i += 1) {
        if (accumulation ? c[i].low < c[climax].low : c[i].high > c[climax].high) climax = i;
      }
      // A climax is visible: unusual volume or an unusually wide candle.
      const climaxRange = c[climax].high - c[climax].low;
      if (!hv(climax) && climaxRange < 1.8 * a) continue;
      events.push({
        type: accumulation ? "SC" : "BC",
        index: climax,
        price: accumulation ? c[climax].low : c[climax].high,
        highVolume: hv(climax),
      });
      let reaction = climax;
      for (let i = climax + 1; i <= start + Math.floor(w / 2); i += 1) {
        if (accumulation ? c[i].high > c[reaction].high : c[i].low < c[reaction].low) reaction = i;
      }
      if (reaction !== climax) {
        events.push({
          type: "AR",
          index: reaction,
          price: accumulation ? c[reaction].high : c[reaction].low,
          highVolume: hv(reaction),
        });
      }

      // A spring must take out every low the range has made so far and still
      // close back inside. Only piercing the body-based edge is not enough:
      // inside any range most candles wick below their neighbours' bodies,
      // and calling each of those a spring would mark one on every chart.
      let falseBreak = -1;
      let extreme = accumulation
        ? Math.min(...c.slice(start, third).map((x) => x.low))
        : Math.max(...c.slice(start, third).map((x) => x.high));
      for (let i = third; i <= end; i += 1) {
        const x = c[i];
        const isFb = accumulation
          ? x.low < extreme && x.close > bodyLo
          : x.high > extreme && x.close < bodyHi;
        if (isFb) falseBreak = i;
        extreme = accumulation ? Math.min(extreme, x.low) : Math.max(extreme, x.high);
      }
      if (falseBreak >= 0) {
        events.push({
          type: accumulation ? "SPRING" : "UPTHRUST",
          index: falseBreak,
          price: accumulation ? c[falseBreak].low : c[falseBreak].high,
          highVolume: hv(falseBreak),
        });
      }

      let breakIdx = -1;
      for (let i = end + 1; i <= last; i += 1) {
        const x = c[i];
        if ((accumulation ? x.close > bodyHi : x.close < bodyLo) && hv(i)) {
          breakIdx = i;
          break;
        }
      }
      if (breakIdx >= 0) {
        events.push({
          type: accumulation ? "SOS" : "SOW",
          index: breakIdx,
          price: c[breakIdx].close,
          highVolume: true,
        });
      }

      const lastClose = c[last].close;
      const beyond = accumulation ? lastClose > bodyHi + height : lastClose < bodyLo - height;
      const phase = beyond
        ? `Fase E · ${accumulation ? "tendencia alcista fuera del rango" : "tendencia bajista fuera del rango"}`
        : breakIdx >= 0
          ? `Fase D · ${accumulation ? "señal de fuerza (SOS)" : "señal de debilidad (SOW)"}`
          : falseBreak >= 0
            ? `Fase C · ${accumulation ? "spring" : "upthrust"} marcado`
            : "Fase B · construcción del rango";

      const note = accumulation
        ? "Rango después de una caída: lectura de posible acumulación. El spring —perforar el soporte y cerrar adentro— es la prueba que el esquema busca; el SOS con volumen, la confirmación. Se sabe que fue acumulación recién cuando rompe."
        : "Rango después de una suba: lectura de posible distribución. El upthrust —perforar la resistencia y cerrar adentro— es la trampa que el esquema describe; el SOW con volumen, la confirmación.";

      return {
        kind: accumulation ? "ACUMULACIÓN" : "DISTRIBUCIÓN",
        start,
        end,
        support: bodyLo,
        resistance: bodyHi,
        events: events.sort((x, y) => x.index - y.index),
        phase,
        note,
      };
    }
  }
  return null;
}
