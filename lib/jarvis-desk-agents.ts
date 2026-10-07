import { arNumber } from "./ai-numbers.ts";
import { aggregate } from "./asset-read.ts";
import type { MacroEvent } from "./econ-calendar.ts";
import type { Analysis } from "./jarvis-analyst.ts";
import type { DeskSnapshot } from "./jarvis-desk-data.ts";
import { atrOf } from "./level-engine.ts";
import { ema, findDivergences, macd, rsi } from "./oscillators.ts";
import { findPivots, type SwingCandle } from "./swing-entries.ts";

/**
 * JARVIS TRADING · los especialistas. Cada uno lee su parte del mercado con
 * datos medidos y devuelve lo mismo: si tuvo datos, hacia dónde empuja (de −1
 * bajista a +1 alcista), cuánto pesa en el consenso, qué encontró con sus
 * números y qué le faltó. No hay IA acá: reglas fijas, visibles y probadas.
 * Lo que falta se dice ("faltantes") y el especialista queda fuera del
 * consenso; nunca se completa con un valor supuesto.
 */

export type AgentId = "tecnico" | "estructura" | "volumen" | "derivados" | "liquidaciones" | "macro" | "noticias" | "sentimiento" | "correlacion" | "volatilidad";

export type AgentReport = {
  id: AgentId;
  nombre: string;
  disponible: boolean;
  /** Hacia dónde empuja: −1 bajista … +1 alcista. 0 es neutral o sin opinión de dirección. */
  sesgo: number;
  /** Peso en el consenso (0 si no tuvo datos o no opina de dirección). */
  peso: number;
  hallazgos: string[];
  faltantes: string[];
  datos: Record<string, number | string | boolean | null>;
};

export const NOT_AVAILABLE = "Este dato no está disponible actualmente.";

/** Pesos base del consenso: la estructura y la técnica mandan; el titular y el sentimiento suman poco. */
export const AGENT_WEIGHTS: Record<AgentId, number> = {
  estructura: 0.25,
  tecnico: 0.2,
  derivados: 0.15,
  volumen: 0.1,
  macro: 0.1,
  liquidaciones: 0.05,
  correlacion: 0.05,
  noticias: 0.05,
  sentimiento: 0.05,
  volatilidad: 0,
};

const H = 3_600_000;
const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const lastOf = <T>(a: (T | null)[]): T | null => {
  for (let i = a.length - 1; i >= 0; i -= 1) if (a[i] !== null) return a[i];
  return null;
};
/** "2,4%" con signo cuando importa. */
export const pct = (v: number, d = 1, sign = true) => `${sign && v > 0 ? "+" : ""}${v.toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d })}%`;
export const px = (v: number) => arNumber(v);
/** Ratios y porcentajes con dos decimales como mucho: "1,02", "0,74". */
export const n2 = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: 2 });

function sma(values: number[], n: number): number | null {
  if (values.length < n) return null;
  let s = 0;
  for (let i = values.length - n; i < values.length; i += 1) s += values[i];
  return s / n;
}

/** Velas de 4 h y diarias reales si alcanzan; si no, armadas con las de 1 h. */
export function framesOf(s: DeskSnapshot): { h1: SwingCandle[]; h4: SwingCandle[]; d1: SwingCandle[] } {
  const h1 = s.candles.h1;
  const h4 = s.candles.h4 && s.candles.h4.length >= 60 ? s.candles.h4 : aggregate(h1, 4);
  const d1 = s.candles.d1 && s.candles.d1.length >= 30 ? s.candles.d1 : aggregate(h1, 24);
  return { h1, h4, d1 };
}

function report(id: AgentId, nombre: string, parts: Omit<AgentReport, "id" | "nombre" | "peso"> & { peso?: number }): AgentReport {
  const peso = parts.disponible ? (parts.peso ?? AGENT_WEIGHTS[id]) : 0;
  return { id, nombre, ...parts, sesgo: clamp(Number(parts.sesgo.toFixed(3))), peso };
}

const missing = (id: AgentId, nombre: string, what: string): AgentReport =>
  report(id, nombre, { disponible: false, sesgo: 0, hallazgos: [], faltantes: [what], datos: {} });

// ── Analista técnico ──

export function technicalAgent(s: DeskSnapshot, a: Analysis): AgentReport {
  const { h4, d1 } = framesOf(s);
  const price = a.read.price;
  if (h4.length < 60) return missing("tecnico", "Analista técnico", "velas de 4 horas suficientes (60 o más)");
  const c4 = h4.map((c) => c.close);
  const cd = d1.map((c) => c.close);
  const e20 = lastOf(ema(c4, 20));
  const e50 = lastOf(ema(c4, 50));
  const e200 = lastOf(ema(c4, 200));
  const s50 = sma(cd, 50);
  const s200 = sma(cd, 200);
  const m = macd(c4);
  const hist = m.hist.filter((v): v is number => v !== null);
  const h0 = hist.at(-1) ?? null;
  const hPrev = hist.at(-2) ?? null;
  const r4 = a.rsi["4h"];
  const rd = a.rsi["1d"];
  const atr4 = atrOf(h4);
  const divs = findDivergences(h4, rsi(c4), "RSI").filter((d) => d.age <= 12);
  const lastDiv = divs.at(-1) ?? null;

  let b = 0;
  const f: string[] = [];
  if (e50 !== null) {
    b += price > e50 ? 0.2 : -0.2;
    f.push(`Precio ${price > e50 ? "sobre" : "bajo"} la EMA 50 de 4 h (${px(e50)}).`);
  }
  if (e20 !== null && e50 !== null) {
    b += e20 > e50 ? 0.15 : -0.15;
    f.push(`EMA 20 ${e20 > e50 ? "por encima" : "por debajo"} de la EMA 50 en 4 h: ${e20 > e50 ? "impulso alcista" : "impulso bajista"}.`);
  }
  if (e200 !== null) f.push(`EMA 200 de 4 h en ${px(e200)} (precio ${price > e200 ? "arriba" : "abajo"}).`);
  if (s200 !== null) {
    b += price > s200 ? 0.15 : -0.15;
    f.push(`SMA 200 diaria en ${px(s200)}: el precio está ${price > s200 ? "arriba (tendencia de fondo alcista)" : "abajo (tendencia de fondo bajista)"}.`);
  } else if (s50 !== null) {
    b += price > s50 ? 0.1 : -0.1;
    f.push(`SMA 50 diaria en ${px(s50)} (precio ${price > s50 ? "arriba" : "abajo"}); no hay 200 velas diarias para la SMA 200.`);
  }
  if (h0 !== null && hPrev !== null) {
    const rising = h0 > hPrev;
    b += h0 > 0 ? (rising ? 0.15 : 0.05) : rising ? -0.05 : -0.15;
    f.push(`MACD de 4 h ${h0 > 0 ? "positivo" : "negativo"} y ${rising ? "creciendo" : "cayendo"}.`);
  }
  if (r4 !== null) {
    if (r4 >= 75) {
      b -= 0.1;
      f.push(`RSI de 4 h en ${Math.round(r4)}: sobrecompra, riesgo de agotamiento.`);
    } else if (r4 <= 25) {
      b += 0.1;
      f.push(`RSI de 4 h en ${Math.round(r4)}: sobreventa, riesgo de rebote.`);
    } else {
      b += r4 > 55 ? 0.1 : r4 < 45 ? -0.1 : 0;
      f.push(`RSI de 4 h en ${Math.round(r4)}${rd !== null ? `, diario en ${Math.round(rd)}` : ""}.`);
    }
  }
  if (lastDiv) {
    b += lastDiv.side === "ALCISTA" ? 0.15 : -0.15;
    f.push(`Divergencia ${lastDiv.kind.toLowerCase()} ${lastDiv.side.toLowerCase()} de RSI en 4 h (hace ${lastDiv.age} velas).`);
  }
  return report("tecnico", "Analista técnico", {
    disponible: true,
    sesgo: b,
    hallazgos: f,
    faltantes: s200 === null ? ["SMA 200 diaria (faltan velas diarias)"] : [],
    datos: { ema20_4h: e20, ema50_4h: e50, ema200_4h: e200, sma50_1d: s50, sma200_1d: s200, rsi_1h: a.rsi["1h"], rsi_4h: r4, rsi_1d: rd, macdHist_4h: h0, atr_4h: atr4, atrPct_4h: price > 0 ? (atr4 / price) * 100 : null },
  });
}

// ── Analista de estructura de mercado ──

export function structureAgent(s: DeskSnapshot, a: Analysis): AgentReport {
  const { h4 } = framesOf(s);
  const price = a.read.price;
  let b = 0;
  const f: string[] = [];
  const trends = a.tfs.map((t) => `${t.tf} ${t.trend.toLowerCase()}`).join(", ");
  if (a.read.alignment === "ALCISTA") b += 0.4;
  else if (a.read.alignment === "BAJISTA") b -= 0.4;
  else {
    const d = a.tfs.find((t) => t.tf === "1d")?.trend;
    const h = a.tfs.find((t) => t.tf === "4h")?.trend;
    b += (d === "ALCISTA" ? 0.15 : d === "BAJISTA" ? -0.15 : 0) + (h === "ALCISTA" ? 0.1 : h === "BAJISTA" ? -0.1 : 0);
  }
  f.push(`Tendencias: ${trends} (${a.read.alignment === "MIXTA" ? "mixtas" : `alineadas ${a.read.alignment.toLowerCase()}`}).`);

  // Máximos y mínimos de 4 h: crecientes (HH-HL), decrecientes (LH-LL) o mezclados.
  const piv = findPivots(h4.slice(-160), 3);
  const hs = piv.highs.slice(-2);
  const ls = piv.lows.slice(-2);
  let swing: string | null = null;
  if (hs.length === 2 && ls.length === 2) {
    const hh = hs[1].price > hs[0].price;
    const hl = ls[1].price > ls[0].price;
    if (hh && hl) {
      swing = "máximos y mínimos crecientes";
      b += 0.2;
    } else if (!hh && !hl) {
      swing = "máximos y mínimos decrecientes";
      b -= 0.2;
    } else swing = hh ? "máximos crecientes con mínimos decrecientes (expansión)" : "máximos decrecientes con mínimos crecientes (compresión)";
    f.push(`Estructura de 4 h: ${swing}.`);
  }
  if (a.lastBreak && a.lastBreak.candlesAgo <= 12) {
    b += (a.lastBreak.direction === "ALCISTA" ? 1 : -1) * (a.lastBreak.confirmed ? 0.25 : 0.1);
    f.push(`Ruptura ${a.lastBreak.direction.toLowerCase()} de ${a.lastBreak.kind === "LÍNEA" ? "línea de tendencia" : "rango"} en 4 h hace ${a.lastBreak.candlesAgo} velas${a.lastBreak.confirmed ? ", confirmada" : ", sin confirmar"}${a.lastBreak.volumeMultiple ? ` (volumen ${n2(a.lastBreak.volumeMultiple)}×)` : ""}.`);
  }
  if (a.wyckoff) {
    b += a.wyckoff.kind === "ACUMULACIÓN" ? 0.1 : -0.1;
    f.push(`Wyckoff en 4 h: ${a.wyckoff.kind.toLowerCase()}, ${a.wyckoff.phase}, rango ${px(a.wyckoff.support)}–${px(a.wyckoff.resistance)}.`);
  }
  if (a.flag) f.push(`${a.flag.kind === "BULL FLAG" ? "Bandera alcista" : "Bandera bajista"} en 1 h (${a.flag.status}); ruptura en ${px(a.flag.breakout)}.`);
  if (a.preBreak4h && a.preBreak4h.state === "A PUNTO") f.push(`A punto de romper en 4 h hacia ${a.preBreak4h.side.toLowerCase()} (presión ${a.preBreak4h.score}/100).`);
  const sup = a.levels.supports[0];
  const res = a.levels.resistances[0];
  if (sup) f.push(`Soporte más cercano: ${px(sup.price)} (${"★".repeat(sup.stars)}, ${pct(sup.distancePct)}).`);
  if (res) f.push(`Resistencia más cercana: ${px(res.price)} (${"★".repeat(res.stars)}, ${pct(res.distancePct)}).`);
  return report("estructura", "Analista de estructura", {
    disponible: true,
    sesgo: b,
    hallazgos: f,
    faltantes: [],
    datos: { precio: price, alineacion: a.read.alignment, estructura4h: swing, soporte: sup?.price ?? null, resistencia: res?.price ?? null, rango48hMin: a.read.low48, rango48hMax: a.read.high48 },
  });
}

// ── Analista de volumen ──

function relVol(c: SwingCandle[], n = 20): number | null {
  if (c.length < n + 1) return null;
  const lastC = c[c.length - 1];
  let s = 0;
  for (let i = c.length - 1 - n; i < c.length - 1; i += 1) s += c[i].quoteVolume || c[i].volume * c[i].close;
  const avg = s / n;
  const v = lastC.quoteVolume || lastC.volume * lastC.close;
  return avg > 0 ? v / avg : null;
}

export function volumeAgent(s: DeskSnapshot, a: Analysis): AgentReport {
  const { h1, h4 } = framesOf(s);
  const rv1 = relVol(h1);
  const rv4 = relVol(h4);
  const v24 = a.read.volume24;
  if (rv1 === null && rv4 === null && v24 === null) return missing("volumen", "Analista de volumen", "historial de volumen");
  const ch = a.read.change24h;
  let b = 0;
  const f: string[] = [];
  if (v24 !== null) f.push(`Volumen de 24 h: ${n2(v24)} veces el promedio diario de la semana.`);
  if (rv4 !== null) f.push(`Última vela de 4 h: ${n2(rv4)} veces su volumen promedio (20 velas).`);
  if (rv1 !== null) f.push(`Última vela de 1 h: ${n2(rv1)} veces su volumen promedio.`);
  const strong = (v24 ?? 0) >= 1.3 || (rv4 ?? 0) >= 1.5;
  const weak = v24 !== null && v24 < 0.8;
  if (ch !== null) {
    if (strong) {
      b += ch > 0 ? 0.3 : -0.3;
      f.push(`El volumen acompaña el movimiento de 24 h (${pct(ch * 100)}): ${ch > 0 ? "compras con convicción" : "ventas con convicción"}.`);
    } else if (weak) {
      b += ch > 0 ? -0.1 : 0.1;
      f.push(`Movimiento de 24 h (${pct(ch * 100)}) con volumen flojo: poca convicción.`);
    }
  }
  return report("volumen", "Analista de volumen", { disponible: true, sesgo: b, hallazgos: f, faltantes: [], datos: { volumenRelativo1h: rv1, volumenRelativo4h: rv4, volumen24VsSemana: v24 } });
}

// ── Analista de derivados (funding, interés abierto, ratio largo/corto) ──

export function derivativesAgent(s: DeskSnapshot, a: Analysis): AgentReport {
  const d = s.derivatives;
  if (!d) return missing("derivados", "Analista de derivados", "funding, interés abierto y ratio largo/corto de Binance Futures");
  const ch = a.read.change24h;
  let b = 0;
  const f: string[] = [];
  const falt: string[] = [];
  if (d.fundingPct !== null) {
    const fp = d.fundingPct;
    if (fp >= 0.05) {
      b -= 0.2;
      f.push(`Funding de ${pct(fp, 3)} cada 8 h: los largos pagan caro, posicionamiento cargado de compras (riesgo de barrida hacia abajo).`);
    } else if (fp <= -0.03) {
      b += 0.2;
      f.push(`Funding de ${pct(fp, 3)}: los cortos pagan, posicionamiento cargado de ventas (combustible para un apretón alcista).`);
    } else f.push(`Funding de ${pct(fp, 3)} cada 8 h: neutral.`);
  } else falt.push("funding");
  if (d.oiChange24hPct !== null && ch !== null) {
    const oi = d.oiChange24hPct;
    const up = ch > 0;
    if (oi > 3) {
      b += up ? 0.25 : -0.25;
      f.push(`Interés abierto ${pct(oi)} en 24 h con el precio ${up ? "subiendo: entran largos nuevos" : "bajando: entran cortos nuevos"}.`);
    } else if (oi < -3) {
      b += up ? 0.05 : -0.05;
      f.push(`Interés abierto ${pct(oi)} en 24 h: se cierran posiciones (${up ? "cierre de cortos, subida menos sólida" : "liquidación de largos"}).`);
    } else f.push(`Interés abierto estable en 24 h (${pct(oi)}).`);
  } else falt.push("cambio del interés abierto");
  if (d.openInterestUsd !== null) f.push(`Interés abierto total: ${n2(d.openInterestUsd / 1e6)} millones de dólares.`);
  if (d.longShortRatio !== null) {
    const r = d.longShortRatio;
    if (r >= 2.5) {
      b -= 0.15;
      f.push(`Ratio largo/corto de cuentas ${n2(r)}: demasiados en largo.`);
    } else if (r <= 0.7) {
      b += 0.15;
      f.push(`Ratio largo/corto de cuentas ${n2(r)}: demasiados en corto.`);
    } else f.push(`Ratio largo/corto de cuentas ${n2(r)}.`);
  } else falt.push("ratio largo/corto");
  if (d.takerBuySell !== null) {
    const t = d.takerBuySell;
    b += t > 1.1 ? 0.1 : t < 0.9 ? -0.1 : 0;
    f.push(`Flujo agresor de la última hora: ${n2(t)} (compras agresivas / ventas agresivas).`);
  } else falt.push("flujo agresor");
  return report("derivados", "Analista de derivados", {
    disponible: true,
    sesgo: b,
    hallazgos: f,
    faltantes: falt,
    datos: { fundingPct: d.fundingPct, interesAbiertoUsd: d.openInterestUsd, cambioInteresAbierto24hPct: d.oiChange24hPct, ratioLargoCorto: d.longShortRatio, flujoAgresor: d.takerBuySell },
  });
}

// ── Liquidaciones (mapa estimado) ──

export function liquidationsAgent(s: DeskSnapshot, a: Analysis): AgentReport {
  const up = a.magnets.above;
  const dn = a.magnets.below;
  if (!up && !dn) return missing("liquidaciones", "Analista de liquidaciones", "mapa de liquidaciones estimado (faltan velas)");
  let b = 0;
  const f: string[] = [];
  if (up && dn) {
    const pullUp = up.intensity / Math.max(0.5, Math.abs(up.distancePct));
    const pullDn = dn.intensity / Math.max(0.5, Math.abs(dn.distancePct));
    if (pullUp > pullDn * 1.4) {
      b += 0.15;
      f.push(`El imán de arriba (${px(up.price)}) tira más que el de abajo: más fuerte o más cerca.`);
    } else if (pullDn > pullUp * 1.4) {
      b -= 0.15;
      f.push(`El imán de abajo (${px(dn.price)}) tira más que el de arriba: más fuerte o más cerca.`);
    }
  }
  if (up) f.push(`Imán arriba en ${px(up.price)} (${pct(up.distancePct)}, intensidad ${Math.round(up.intensity)}/100): cortos que se liquidarían.`);
  if (dn) f.push(`Imán abajo en ${px(dn.price)} (${pct(dn.distancePct)}, intensidad ${Math.round(dn.intensity)}/100): largos que se liquidarían.`);
  const crowdedLong = (s.derivatives?.fundingPct ?? 0) >= 0.05 || (s.derivatives?.longShortRatio ?? 0) >= 2.5;
  const crowdedShort = (s.derivatives?.fundingPct ?? 0) <= -0.03 || (s.derivatives?.longShortRatio ?? 9) <= 0.7;
  const riesgo = crowdedLong && dn && Math.abs(dn.distancePct) < 3 ? "ALTO para largos" : crowdedShort && up && Math.abs(up.distancePct) < 3 ? "ALTO para cortos" : "MODERADO";
  f.push(`Riesgo de barrida: ${riesgo}.`);
  f.push("Son liquidaciones ESTIMADAS con un modelo de apalancamiento, no liquidaciones reales informadas por el exchange.");
  return report("liquidaciones", "Analista de liquidaciones", {
    disponible: true,
    sesgo: b,
    hallazgos: f,
    faltantes: ["liquidaciones reales con historial (Binance solo las da en vivo)"],
    datos: { imanArriba: up?.price ?? null, imanArribaIntensidad: up?.intensity ?? null, imanAbajo: dn?.price ?? null, imanAbajoIntensidad: dn?.intensity ?? null, riesgoBarrida: riesgo },
  });
}

// ── Macro (dominancia, régimen de BTC, calendario) ──

// 24 h clock, as said in Argentina ("vie 09, 09:30"); some browsers default es-AR to "a. m.".
const AR_TIME = (t: number) => new Date(t).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export const arTime = AR_TIME;

/** Eventos de alto impacto de EE.UU. en las próximas `hours` horas, por orden. */
export function upcomingHighImpact(events: MacroEvent[] | null, now: number, hours = 48): MacroEvent[] {
  return (events ?? []).filter((e) => e.impact === "high" && e.currency === "USD" && e.time >= now - 30 * 60_000 && e.time <= now + hours * H).sort((x, y) => x.time - y.time);
}

export function macroAgent(s: DeskSnapshot, a: Analysis): AgentReport {
  const m = s.macro;
  const isBtc = s.symbol === "BTCUSDT";
  const btcCh = s.btc && s.btc.length > 25 ? (s.btc[s.btc.length - 1].close / s.btc[s.btc.length - 25].close - 1) * 100 : isBtc && a.read.change24h !== null ? a.read.change24h * 100 : null;
  let b = 0;
  const f: string[] = [];
  const falt: string[] = [];
  if (m.btcDominance !== null) f.push(`Dominancia de BTC: ${n2(m.btcDominance)}%.`);
  else falt.push("dominancia de BTC");
  if (m.usdtDominance !== null) f.push(`Dominancia de USDT: ${n2(m.usdtDominance)}% (si sube, el dinero se refugia en estables).`);
  else falt.push("dominancia de USDT");
  if (m.marketCapChange24h !== null) {
    b += m.marketCapChange24h > 2 ? 0.15 : m.marketCapChange24h < -2 ? -0.15 : 0;
    f.push(`Capitalización total del mercado ${pct(m.marketCapChange24h)} en 24 h.`);
  }
  if (!isBtc && btcCh !== null) {
    b += btcCh > 2 ? 0.15 : btcCh < -2 ? -0.2 : 0;
    f.push(`BTC ${pct(btcCh)} en 24 h: ${btcCh < -2 ? "arrastra al resto" : btcCh > 2 ? "acompaña" : "sin presión fuerte"}.`);
  }
  const ev = upcomingHighImpact(m.events, s.now);
  if (m.events === null) falt.push("calendario económico");
  else if (ev.length) f.push(`Eventos de alto impacto (EE.UU.) en 48 h: ${ev.slice(0, 3).map((e) => `${e.title} ${AR_TIME(e.time)} (hora argentina)`).join("; ")}.`);
  else f.push("Sin eventos de alto impacto de EE.UU. en las próximas 48 h.");
  return report("macro", "Analista macro", {
    disponible: m.btcDominance !== null || m.events !== null || btcCh !== null || m.marketCapChange24h !== null,
    sesgo: b,
    hallazgos: f,
    faltantes: falt,
    datos: { dominanciaBtc: m.btcDominance, dominanciaUsdt: m.usdtDominance, capTotal24hPct: m.marketCapChange24h, btc24hPct: btcCh, proximoEvento: ev[0] ? `${ev[0].title} · ${AR_TIME(ev[0].time)}` : null },
  });
}

// ── Noticias ──

export function newsAgent(s: DeskSnapshot, coin: string): AgentReport {
  if (!s.news) return missing("noticias", "Analista de noticias", "titulares de noticias cripto");
  const recent = s.news.filter((n) => s.now - n.publishedAt < 24 * H);
  const mine = recent.filter((n) => n.assets.includes(coin) || new RegExp(`\\b${coin}\\b`, "i").test(n.title));
  const general = recent.filter((n) => n.impact === "ALTO" && !mine.includes(n));
  const pool = [...mine, ...general.slice(0, 3)];
  const tone = pool.reduce((acc, n) => acc + (n.tone === "POSITIVO" ? 1 : n.tone === "NEGATIVO" ? -1 : 0) * (n.impact === "ALTO" ? 2 : n.impact === "MEDIO" ? 1 : 0.5), 0);
  const f: string[] = [];
  if (!pool.length) f.push("Sin titulares relevantes en las últimas 24 h.");
  for (const n of pool.slice(0, 4)) f.push(`[${n.impact}] ${n.title} (${n.source}, tono ${n.tone.toLowerCase()}).`);
  f.push("El tono es el del titular, no una predicción del precio.");
  return report("noticias", "Analista de noticias", { disponible: true, sesgo: clamp(tone * 0.05, -0.3, 0.3), hallazgos: f, faltantes: [], datos: { titularesDelActivo: mine.length, titularesAltoImpacto: general.length } });
}

// ── Sentimiento ──

export function sentimentAgent(s: DeskSnapshot): AgentReport {
  const fg = s.fearGreed;
  if (!fg) return missing("sentimiento", "Analista de sentimiento", "índice de Miedo y Avaricia");
  let b = 0;
  const f = [`Miedo y Avaricia: ${fg.value}/100 (${fg.zone.toLowerCase()})${fg.weekAgo !== null ? `, hace una semana ${fg.weekAgo}` : ""}.`];
  if (fg.value >= 75) {
    b -= 0.15;
    f.push("Avaricia extrema: el mercado suele estar sobrecargado de compras (señal contraria).");
  } else if (fg.value <= 25) {
    b += 0.15;
    f.push("Miedo extremo: históricamente zona de oportunidades contrarias, con riesgo de más caída.");
  }
  return report("sentimiento", "Analista de sentimiento", { disponible: true, sesgo: b, hallazgos: f, faltantes: [], datos: { miedoYAvaricia: fg.value, zona: fg.zone } });
}

// ── Correlación y fuerza relativa ──

function logReturns(c: SwingCandle[]): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 1; i < c.length; i += 1) if (c[i - 1].close > 0 && c[i].close > 0) m.set(c[i].openTime, Math.log(c[i].close / c[i - 1].close));
  return m;
}

/** Correlación de Pearson de los retornos de 1 h, alineados por hora (no por posición). */
export function correlation(a: SwingCandle[], b: SwingCandle[], hours = 168): { corr: number; n: number } | null {
  const ra = logReturns(a.slice(-(hours + 1)));
  const rb = logReturns(b.slice(-(hours + 1)));
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [t, x] of ra) {
    const y = rb.get(t);
    if (y !== undefined) {
      xs.push(x);
      ys.push(y);
    }
  }
  const n = xs.length;
  if (n < 48) return null;
  const mx = xs.reduce((p, v) => p + v, 0) / n;
  const my = ys.reduce((p, v) => p + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? { corr: sxy / Math.sqrt(sxx * syy), n } : null;
}

const changeOver = (c: SwingCandle[] | null, hours: number) => (c && c.length > hours ? (c[c.length - 1].close / c[c.length - 1 - hours].close - 1) * 100 : null);

export function correlationAgent(s: DeskSnapshot): AgentReport {
  const own = s.candles.h1;
  const isBtc = s.symbol === "BTCUSDT";
  const ref = isBtc ? s.eth : s.btc;
  const refName = isBtc ? "ETH" : "BTC";
  if (!ref || own.length < 60) return missing("correlacion", "Analista de correlación", `velas de 1 h de ${refName}`);
  const cBtc = isBtc ? null : correlation(own, ref);
  const cEth = s.eth && s.symbol !== "ETHUSDT" ? correlation(own, s.eth) : null;
  const cRef = isBtc ? correlation(own, ref) : cBtc;
  const myCh = changeOver(own, 168);
  const refCh = changeOver(ref, 168);
  let b = 0;
  const f: string[] = [];
  if (cRef) f.push(`Correlación con ${refName} (retornos de 1 h, 7 días): ${n2(cRef.corr)}.`);
  if (cEth && !isBtc) f.push(`Correlación con ETH: ${n2(cEth.corr)}.`);
  let rs: number | null = null;
  if (myCh !== null && refCh !== null) {
    rs = myCh - refCh;
    b += rs > 3 ? 0.15 : rs < -3 ? -0.15 : 0;
    f.push(`Fuerza relativa a 7 días: ${pct(myCh)} contra ${pct(refCh)} de ${refName} (${rs > 0 ? "más fuerte" : "más débil"}, ${pct(rs)}).`);
  }
  return report("correlacion", "Analista de correlación", { disponible: true, sesgo: b, hallazgos: f, faltantes: [], datos: { correlacionBtc: cBtc?.corr ?? null, correlacionEth: cEth?.corr ?? (isBtc ? (cRef?.corr ?? null) : null), fuerzaRelativa7dPct: rs, cambio7dPct: myCh } });
}

// ── Volatilidad ──

function realizedVol(c: SwingCandle[], n: number): number | null {
  const r = [...logReturns(c.slice(-(n + 1))).values()];
  if (r.length < n * 0.8) return null;
  const m = r.reduce((p, v) => p + v, 0) / r.length;
  return Math.sqrt(r.reduce((p, v) => p + (v - m) ** 2, 0) / r.length) * 100;
}

export type VolRegime = "COMPRIMIDA" | "NORMAL" | "EXPANDIDA";

export function volatilityAgent(s: DeskSnapshot, a: Analysis): AgentReport {
  const { h1 } = framesOf(s);
  const v24 = realizedVol(h1, 24);
  const v30 = realizedVol(h1, 720) ?? realizedVol(h1, 300);
  if (v24 === null) return missing("volatilidad", "Analista de volatilidad", "velas de 1 h suficientes");
  const ratio = v30 ? v24 / v30 : null;
  const regime: VolRegime = ratio === null ? "NORMAL" : ratio < 0.7 ? "COMPRIMIDA" : ratio > 1.6 ? "EXPANDIDA" : "NORMAL";
  const atrs = a.tfs.map((t) => `${t.tf} ${n2(t.atrPct)}%`).join(", ");
  const f = [`ATR: ${atrs}.`, `Volatilidad de 1 h en 24 h: ${n2(v24)}%${v30 ? ` (promedio del mes ${n2(v30)}%)` : ""}.`];
  if (regime === "COMPRIMIDA") f.push("Volatilidad comprimida: suele anticipar un movimiento fuerte, sin decir hacia dónde.");
  if (regime === "EXPANDIDA") f.push("Volatilidad expandida: stops más fáciles de tocar; conviene menos tamaño.");
  return report("volatilidad", "Analista de volatilidad", { disponible: true, sesgo: 0, peso: 0, hallazgos: f, faltantes: [], datos: { volatilidad24hPct: v24, volatilidadMesPct: v30, ratio, regimen: regime } });
}

/** Todos los especialistas sobre un activo. */
export function runAgents(s: DeskSnapshot, a: Analysis): AgentReport[] {
  const coin = s.symbol.replace(/USDT$/, "");
  return [
    technicalAgent(s, a),
    structureAgent(s, a),
    volumeAgent(s, a),
    derivativesAgent(s, a),
    liquidationsAgent(s, a),
    macroAgent(s, a),
    newsAgent(s, coin),
    sentimentAgent(s),
    correlationAgent(s),
    volatilityAgent(s, a),
  ];
}

/** Consenso ponderado de los que tuvieron datos: −1 … +1, y qué parte del peso total tuvo datos. */
export function consensus(agents: AgentReport[]): { value: number; coverage: number; agreeLong: number; agreeShort: number } {
  const total = agents.reduce((p, x) => p + AGENT_WEIGHTS[x.id], 0);
  const avail = agents.filter((x) => x.peso > 0);
  const w = avail.reduce((p, x) => p + x.peso, 0);
  if (!w) return { value: 0, coverage: 0, agreeLong: 0, agreeShort: 0 };
  const value = avail.reduce((p, x) => p + x.sesgo * x.peso, 0) / w;
  const agree = (sign: number) => avail.filter((x) => Math.sign(x.sesgo) === sign && Math.abs(x.sesgo) >= 0.05).reduce((p, x) => p + x.peso, 0) / w;
  return { value: Number(value.toFixed(3)), coverage: total ? w / total : 0, agreeLong: agree(1), agreeShort: agree(-1) };
}
