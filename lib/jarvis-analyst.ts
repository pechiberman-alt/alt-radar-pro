import { aggregate, compactRead, readAsset, trendOf, type AssetRead, type TfRead } from "./asset-read.ts";
import { findFlags, readWyckoff } from "./chart-patterns.ts";
import { findFairValueGaps } from "./fair-value-gaps.ts";
import { atrOf, buildLevels, sourcesAt, volumeProfile, type Level } from "./level-engine.ts";
import { buildLiquidationHeatmap } from "./liquidation-heatmap.ts";
import { strongestMagnets } from "./magnet-watch.ts";
import { timeframeConfig } from "./market-fetch.ts";
import { rsi } from "./oscillators.ts";
import { findOrderBlocks } from "./order-blocks.ts";
import { readPreBreak } from "./pre-breakout.ts";
import type { SwingCandle } from "./swing-entries.ts";
import { analyzeTrend, latestBreak } from "./trendlines.ts";

/**
 * JARVIS's own analyst: every engine of ALT RADAR PRO run on one asset, on
 * 1h, 4h and daily candles — trend and momentum by timeframe, levels with
 * their reasons (structure, volume profile, round numbers), trendline and
 * range breaks, flags and Wyckoff ranges, order blocks and fair value gaps,
 * liquidation magnets and "a punto de romper" — then a transparent technical
 * score and the two scenarios with their trigger, target and invalidation.
 *
 * It runs in the browser (all engines are pure and the phone has the CPU);
 * an AI writes it up in prose, and with no AI `analysisText` is the report.
 * Only candles closed by `now` are read, on every timeframe.
 */

const H = 3_600_000;
const FRAME = { h1: H, h4: 4 * H, d1: 24 * H } as const;

export type Frames = { h1: SwingCandle[]; h4?: SwingCandle[] | null; d1?: SwingCandle[] | null };

type Zone = { low: number; high: number; distancePct: number };
type ScoreItem = { label: string; points: number };
export type Scenario = { trigger: number; target: number | null; invalidation: number | null };

export type Analysis = {
  read: AssetRead;
  /** Trend with real 4h and daily candles when they were available (else built from 1h). */
  tfs: TfRead[];
  rsi: { "1h": number | null; "4h": number | null; "1d": number | null };
  levels: { supports: Level[]; resistances: Level[] };
  profile: { poc: number; vah: number; val: number } | null;
  lastBreak: { direction: "ALCISTA" | "BAJISTA"; kind: "LÍNEA" | "RANGO"; confirmed: boolean; candlesAgo: number; volumeMultiple: number | null } | null;
  flag: { kind: "BULL FLAG" | "BEAR FLAG"; status: string; breakout: number; target: number; invalidation: number } | null;
  wyckoff: { kind: "ACUMULACIÓN" | "DISTRIBUCIÓN"; phase: string; support: number; resistance: number } | null;
  orderBlocks: { below: Zone | null; above: Zone | null };
  gaps: { below: Zone | null; above: Zone | null };
  magnets: { above: { price: number; distancePct: number; intensity: number } | null; below: { price: number; distancePct: number; intensity: number } | null };
  preBreak4h: { state: string; side: string; score: number } | null;
  /** Technical score from −100 to +100 with what each part added. A summary of the reading, not a probability. */
  score: { value: number; label: "ALCISTA" | "BAJISTA" | "NEUTRAL"; parts: ScoreItem[] };
  bull: Scenario | null;
  bear: Scenario | null;
};

const closedBy = (c: SwingCandle[] | null | undefined, frame: number, now: number) => (c ?? []).filter((x) => x.openTime + frame <= now).sort((a, b) => a.openTime - b.openTime);
const last = <T>(a: (T | null)[]): T | null => {
  for (let i = a.length - 1; i >= 0; i -= 1) if (a[i] !== null) return a[i];
  return null;
};
const zoneOf = (low: number, high: number, price: number): Zone => ({ low, high, distancePct: (((low + high) / 2 - price) / price) * 100 });

export function analyzeAsset(symbol: string, frames: Frames, now: number): Analysis | null {
  const h1 = closedBy(frames.h1, FRAME.h1, now);
  const read = readAsset(symbol, h1, now);
  if (!read) return null;
  const price = read.price;
  const h4Real = closedBy(frames.h4, FRAME.h4, now);
  const d1Real = closedBy(frames.d1, FRAME.d1, now);
  const h4 = h4Real.length >= 60 ? h4Real : aggregate(h1, 4);
  const d1 = d1Real.length >= 30 ? d1Real : aggregate(h1, 24);

  const tfs = [trendOf(h1, "1h"), trendOf(h4, "4h"), trendOf(d1, "1d")].filter((t): t is TfRead => t !== null);
  const closes = (c: SwingCandle[]) => c.map((x) => x.close);
  const rsis = { "1h": last(rsi(closes(h1))), "4h": last(rsi(closes(h4))), "1d": last(rsi(closes(d1))) };

  // Levels: structure on 1h/4h/1d, daily references, volume profile and round numbers (level-engine.ts).
  const atr1 = atrOf(h1);
  const lv = atr1 > 0
    ? buildLevels(
        sourcesAt({ current: { frame: "1h", candles: h1.slice(-500), frameMs: FRAME.h1, weight: 1 }, higher: [{ frame: "4h", candles: h4, frameMs: FRAME.h4, weight: 2 }, { frame: "1d", candles: d1, frameMs: FRAME.d1, weight: 3 }], daily: d1, now }),
        price, atr1, { perSide: 3, range: 0.15 },
      )
    : [];
  const supports = lv.filter((l) => l.kind === "SOPORTE").sort((a, b) => b.price - a.price);
  const resistances = lv.filter((l) => l.kind === "RESISTENCIA").sort((a, b) => a.price - b.price);
  const profile = volumeProfile(h1.slice(-240));

  const t4 = analyzeTrend(h4);
  const brk = latestBreak(t4);
  const flags = findFlags(h1.slice(-200)).filter((f) => f.status !== "FALLIDA" && f.flagEnd >= Math.min(h1.length, 200) - 6);
  const flag = flags.sort((a, b) => b.flagEnd - a.flagEnd)[0] ?? null;
  const wy = readWyckoff(h4);

  const obs = findOrderBlocks(h4);
  const obBelow = obs.filter((o) => o.side === "ALCISTA" && o.high < price).sort((a, b) => b.high - a.high)[0];
  const obAbove = obs.filter((o) => o.side === "BAJISTA" && o.low > price).sort((a, b) => a.low - b.low)[0];
  const fvgs = findFairValueGaps(h1.slice(-300));
  const gapBelow = fvgs.filter((g) => g.high < price).sort((a, b) => b.high - a.high)[0];
  const gapAbove = fvgs.filter((g) => g.low > price).sort((a, b) => a.low - b.low)[0];

  const cfg = timeframeConfig("1h");
  const map = h1.length >= 120 ? buildLiquidationHeatmap(symbol, h1.slice(-500), price, { halfLifeCandles: cfg.halfLife, priceRangePct: cfg.priceRange }) : null;
  const pair = map ? strongestMagnets(map, price) : null;
  const mag = (m: { price: number; distancePct: number; intensity: number } | null | undefined) => (m ? { price: m.price, distancePct: m.distancePct, intensity: m.intensity } : null);
  const pb4 = h4.length >= 80 ? readPreBreak(h4.slice(-200), symbol) : null;

  // The score: each piece of evidence with its weight, all visible.
  const parts: ScoreItem[] = [];
  const add = (label: string, points: number) => points && parts.push({ label, points });
  const tw = { "1d": 25, "4h": 20, "1h": 10 } as const;
  for (const t of tfs) add(`tendencia ${t.tf} ${t.trend.toLowerCase()}`, t.trend === "ALCISTA" ? tw[t.tf] : t.trend === "BAJISTA" ? -tw[t.tf] : 0);
  if (brk && brk.confirmed && t4.pivots.length && h4.length - 1 - brk.i <= 12) add(`ruptura ${brk.kind === "RANGO" ? "de rango" : "de línea"} ${brk.direction.toLowerCase()} en 4h`, brk.direction === "ALCISTA" ? 15 : -15);
  const pb1 = read.preBreak;
  if (pb1?.state === "A PUNTO" && pb1.side !== "SIN DIRECCIÓN") add(`a punto de romper en 1h ${pb1.side === "ALCISTA" ? "hacia arriba" : "hacia abajo"}`, pb1.side === "ALCISTA" ? 10 : -10);
  if (pb4?.state === "A PUNTO" && pb4.side !== "SIN DIRECCIÓN") add(`a punto de romper en 4h ${pb4.side === "ALCISTA" ? "hacia arriba" : "hacia abajo"}`, pb4.side === "ALCISTA" ? 15 : -15);
  if (flag) add(`${flag.kind === "BULL FLAG" ? "bandera alcista" : "bandera bajista"} en 1h${flag.status === "CONFIRMADA" ? " confirmada" : ""}`, flag.kind === "BULL FLAG" ? 10 : -10);
  if (wy) add(`rango Wyckoff de ${wy.kind.toLowerCase()} en 4h`, wy.kind === "ACUMULACIÓN" ? 8 : -8);
  if (profile) add(price > profile.vah ? "precio arriba del área de valor" : price < profile.val ? "precio abajo del área de valor" : "", price > profile.vah ? 5 : price < profile.val ? -5 : 0);
  const r4 = rsis["4h"];
  if (r4 !== null && (r4 >= 75 || r4 <= 25)) add(r4 >= 75 ? `RSI 4h en ${Math.round(r4)}: sobrecompra` : `RSI 4h en ${Math.round(r4)}: sobreventa`, r4 >= 75 ? -5 : 5);
  const value = Math.max(-100, Math.min(100, parts.reduce((a, p) => a + p.points, 0)));

  // Scenarios: the nearest level each way is the trigger; the next one (or the magnet, or the 48h extreme) the target.
  const r1 = resistances[0];
  const s1 = supports[0];
  const bull: Scenario | null = r1 ? { trigger: r1.price, target: resistances[1]?.price ?? pair?.above?.price ?? null, invalidation: s1?.price ?? null } : null;
  const bear: Scenario | null = s1 ? { trigger: s1.price, target: supports[1]?.price ?? pair?.below?.price ?? null, invalidation: r1?.price ?? null } : null;

  return {
    read,
    tfs,
    rsi: rsis,
    levels: { supports, resistances },
    profile,
    lastBreak: brk ? { direction: brk.direction, kind: brk.kind, confirmed: brk.confirmed, candlesAgo: h4.length - 1 - brk.i, volumeMultiple: brk.volumeMultiple } : null,
    flag: flag ? { kind: flag.kind, status: flag.status, breakout: flag.breakout, target: flag.target, invalidation: flag.invalidation } : null,
    wyckoff: wy ? { kind: wy.kind, phase: wy.phase, support: wy.support, resistance: wy.resistance } : null,
    orderBlocks: { below: obBelow ? zoneOf(obBelow.low, obBelow.high, price) : null, above: obAbove ? zoneOf(obAbove.low, obAbove.high, price) : null },
    gaps: { below: gapBelow ? zoneOf(gapBelow.low, gapBelow.high, price) : null, above: gapAbove ? zoneOf(gapAbove.low, gapAbove.high, price) : null },
    magnets: { above: mag(pair?.above), below: mag(pair?.below) },
    preBreak4h: pb4 ? { state: pb4.state, side: pb4.side, score: pb4.score } : null,
    score: { value, label: value >= 25 ? "ALCISTA" : value <= -25 ? "BAJISTA" : "NEUTRAL", parts },
    bull,
    bear,
  };
}

const px = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: v >= 1000 ? 0 : v >= 1 ? 3 : 6 });
const pc = (v: number, d = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d).replace(".", ",")}%`;
const WORD: Record<string, string> = { ALCISTA: "alcista", BAJISTA: "bajista", LATERAL: "de costado" };
const stars = (n: number) => "★".repeat(n);

/** The analysis as a professional report, section by section; the same structure the AI is asked to follow. */
export function analysisText(a: Analysis): string {
  const r = a.read;
  const coin = r.symbol.replace(/USDT$/, "");
  const ch = [r.change24h !== null ? `${pc(r.change24h * 100)} 24h` : "", r.change7d !== null ? `${pc(r.change7d * 100)} 7d` : "", r.change30d !== null ? `${pc(r.change30d * 100)} 30d` : ""].filter(Boolean).join(" · ");
  const out: string[] = [];
  out.push(`${coin} · ${px(r.price)}${ch ? ` · ${ch}` : ""}.`);
  out.push(`Lectura técnica: ${a.score.label.toLowerCase()} (${a.score.value > 0 ? "+" : ""}${a.score.value} de ±100)${a.score.parts.length ? `: ${a.score.parts.slice().sort((x, y) => Math.abs(y.points) - Math.abs(x.points)).slice(0, 4).map((p) => p.label).join(", ")}` : ""}. Es un resumen de la lectura, no una probabilidad.`);
  out.push(`Tendencia: ${a.tfs.map((t) => `${t.tf} ${WORD[t.trend]}${a.rsi[t.tf] !== null ? ` (RSI ${Math.round(a.rsi[t.tf] as number)})` : ""}`).join(" · ")}.`);
  const lvl = (l: Level) => `${px(l.price)} ${stars(l.stars)} (${pc(l.distancePct)})`;
  if (a.levels.resistances.length || a.levels.supports.length) {
    out.push(`Niveles: resistencias ${a.levels.resistances.slice(0, 2).map(lvl).join(", ") || "sin nivel cercano"}; soportes ${a.levels.supports.slice(0, 2).map(lvl).join(", ") || "sin nivel cercano"}${a.profile ? `. POC ${px(a.profile.poc)}, área de valor ${px(a.profile.val)}–${px(a.profile.vah)}` : ""}.`);
  }
  const zones: string[] = [];
  if (a.orderBlocks.below) zones.push(`order block alcista ${px(a.orderBlocks.below.low)}–${px(a.orderBlocks.below.high)} (4h)`);
  if (a.orderBlocks.above) zones.push(`order block bajista ${px(a.orderBlocks.above.low)}–${px(a.orderBlocks.above.high)} (4h)`);
  if (a.gaps.above) zones.push(`FVG arriba ${px(a.gaps.above.low)}–${px(a.gaps.above.high)}`);
  if (a.gaps.below) zones.push(`FVG abajo ${px(a.gaps.below.low)}–${px(a.gaps.below.high)}`);
  if (zones.length) out.push(`Zonas: ${zones.join("; ")}.`);
  if (a.magnets.above || a.magnets.below) {
    const z = (m: NonNullable<Analysis["magnets"]["above"]>) => `${px(m.price)} (${pc(m.distancePct)}, intensidad ${Math.round(m.intensity)})`;
    out.push(`Liquidez estimada: ${[a.magnets.above ? `cortos arriba en ${z(a.magnets.above)}` : "", a.magnets.below ? `largos abajo en ${z(a.magnets.below)}` : ""].filter(Boolean).join("; ")}.`);
  }
  const signals: string[] = [];
  if (a.lastBreak && a.lastBreak.candlesAgo <= 12) signals.push(`ruptura ${a.lastBreak.kind === "RANGO" ? "de rango" : "de línea"} ${WORD[a.lastBreak.direction]} en 4h hace ${a.lastBreak.candlesAgo} velas${a.lastBreak.confirmed ? ", confirmada" : ", sin confirmar"}`);
  if (a.flag) signals.push(`${a.flag.kind === "BULL FLAG" ? "bandera alcista" : "bandera bajista"} en 1h (${a.flag.status.toLowerCase()}; confirma en ${px(a.flag.breakout)}, objetivo ${px(a.flag.target)})`);
  if (a.wyckoff) signals.push(`Wyckoff 4h: ${a.wyckoff.kind.toLowerCase()}, ${a.wyckoff.phase.toLowerCase()} (${px(a.wyckoff.support)}–${px(a.wyckoff.resistance)})`);
  const pb = r.preBreak;
  if (pb && pb.state !== "QUIETO") signals.push(`${pb.state === "A PUNTO" ? "a punto de romper" : "armándose"} en 1h ${pb.side === "ALCISTA" ? "hacia arriba" : pb.side === "BAJISTA" ? "hacia abajo" : "sin dirección"} (presión ${pb.score})`);
  if (a.preBreak4h && a.preBreak4h.state !== "QUIETO") signals.push(`${a.preBreak4h.state === "A PUNTO" ? "a punto de romper" : "armándose"} en 4h (presión ${a.preBreak4h.score})`);
  if (r.volume24 !== null && (r.volume24 >= 1.5 || r.volume24 <= 0.6)) signals.push(r.volume24 >= 1.5 ? `volumen 24h ${r.volume24.toFixed(1).replace(".", ",")}× su semana` : "volumen 24h bajo para su semana");
  if (signals.length) out.push(`Señales del software: ${signals.join("; ")}.`);
  if (a.bull) out.push(`Escenario alcista: cierre de 4h arriba de ${px(a.bull.trigger)}${a.bull.target ? ` abre ${px(a.bull.target)}` : ""}${a.bull.invalidation ? `; se invalida abajo de ${px(a.bull.invalidation)}` : ""}.`);
  if (a.bear) out.push(`Escenario bajista: cierre de 4h abajo de ${px(a.bear.trigger)}${a.bear.target ? ` abre ${px(a.bear.target)}` : ""}${a.bear.invalidation ? `; se invalida arriba de ${px(a.bear.invalidation)}` : ""}.`);
  const atr = r.tfs.find((t) => t.tf === "1h")?.atrPct;
  out.push(`Riesgo: ${atr ? `se mueve ${atr.toFixed(2).replace(".", ",")}% por hora; ` : ""}arriesgá como máximo 1% de la cuenta y poné el stop donde la idea queda invalidada. Análisis automático del software, no es asesoramiento financiero.`);
  return out.join("\n");
}

/** For the AIs: every number of the analysis, compact. */
export function analysisForAi(a: Analysis) {
  const n = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? null : Number(v.toFixed(d)));
  const p = (v: number | null | undefined) => (v === null || v === undefined ? null : Number(v.toPrecision(6)));
  const zone = (z: Zone | null) => (z ? { desde: p(z.low), hasta: p(z.high), distanciaPct: n(z.distancePct) } : null);
  const level = (l: Level) => ({ precio: p(l.price), estrellas: l.stars, distanciaPct: n(l.distancePct), razones: l.sources.slice(0, 3).map((s) => s.label) });
  return {
    ...compactRead(a.read),
    moneda: a.read.symbol,
    ultimaVelaCerrada: new Date(a.read.at).toISOString(),
    tendencias: Object.fromEntries(a.tfs.map((t) => [t.tf, t.trend])),
    rsi: { "1h": n(a.rsi["1h"], 0), "4h": n(a.rsi["4h"], 0), "1d": n(a.rsi["1d"], 0) },
    niveles: { resistencias: a.levels.resistances.slice(0, 3).map(level), soportes: a.levels.supports.slice(0, 3).map(level) },
    perfilDeVolumen: a.profile ? { poc: p(a.profile.poc), vah: p(a.profile.vah), val: p(a.profile.val) } : null,
    ultimaRuptura4h: a.lastBreak,
    bandera1h: a.flag,
    wyckoff4h: a.wyckoff,
    orderBlocks4h: { abajo: zone(a.orderBlocks.below), arriba: zone(a.orderBlocks.above) },
    fvg1h: { abajo: zone(a.gaps.below), arriba: zone(a.gaps.above) },
    imanesDeLiquidacion: {
      arriba: a.magnets.above ? { precio: p(a.magnets.above.price), distanciaPct: n(a.magnets.above.distancePct), intensidad: Math.round(a.magnets.above.intensity) } : null,
      abajo: a.magnets.below ? { precio: p(a.magnets.below.price), distanciaPct: n(a.magnets.below.distancePct), intensidad: Math.round(a.magnets.below.intensity) } : null,
    },
    aPunto4h: a.preBreak4h,
    puntajeTecnico: { valor: a.score.value, lectura: a.score.label, partes: a.score.parts },
    escenarioAlcista: a.bull ? { gatillo: p(a.bull.trigger), objetivo: p(a.bull.target), invalidacion: p(a.bull.invalidation) } : null,
    escenarioBajista: a.bear ? { gatillo: p(a.bear.trigger), objetivo: p(a.bear.target), invalidacion: p(a.bear.invalidation) } : null,
  };
}
