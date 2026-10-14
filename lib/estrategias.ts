/**
 * El estudio de estrategias del AI TRADING LAB: cada agente tiene UNA estrategia clásica con parámetros fijos
 * (no se buscan los que mejor dan: eso infla los resultados) y todas se miden con la misma escalera de la app
 * (lib/escalera.ts: SL, TP1, TP2 y TP3; si una vela toca stop y objetivo, cuenta el stop). Incluye un agente de
 * control que entra al azar: una estrategia que no le gana al azar no tiene ventaja. Pura: sin red ni base.
 *
 * Cada señal se calcula con velas cerradas hasta la vela `i` inclusive; la entrada es la apertura de la vela
 * siguiente y el recorrido usa solo velas posteriores. Una operación por vez por moneda y estrategia.
 */
import { escaleraHacia, recorrer, type Lado } from "./escalera.ts";
import type { SwingCandle } from "./swing-entries.ts";

export type EstrategiaId = "RUPTURA" | "CRUCE_EMA" | "RSI" | "BOLLINGER" | "RETROCESO" | "MACD" | "SUPERTREND" | "AZAR";

/** Lo que una estrategia propone en la vela i: lado, stop y objetivo final (TP3). Sin señal, null. */
export type Senal = { lado: Lado; stop: number; objetivo: number };

export type Indicadores = {
  ema20: number[];
  ema50: number[];
  ema200: number[];
  rsi14: number[];
  atr14: number[];
  bbMedia: number[];
  bbAlta: number[];
  bbBaja: number[];
  macd: number[];
  macdSenal: number[];
  /** Supertrend (ATR 10, multiplicador 3): la línea y la dirección (1 alcista, -1 bajista; NaN sin datos). */
  stLinea: number[];
  stDir: number[];
};

export type Estrategia = {
  id: EstrategiaId;
  agente: string;
  nombre: string;
  regla: string;
  senal: (v: SwingCandle[], ind: Indicadores, i: number) => Senal | null;
};

// ── Indicadores (cada valor en i usa solo velas hasta i) ──

export function ema(xs: number[], n: number): number[] {
  const k = 2 / (n + 1);
  const out = new Array<number>(xs.length).fill(Number.NaN);
  let prev = Number.NaN;
  let suma = 0;
  for (let i = 0; i < xs.length; i += 1) {
    if (i < n - 1) {
      suma += xs[i];
      continue;
    }
    if (i === n - 1) {
      suma += xs[i];
      prev = suma / n;
    } else prev = xs[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(cierres: number[], n = 14): number[] {
  const out = new Array<number>(cierres.length).fill(Number.NaN);
  let sube = 0;
  let baja = 0;
  for (let i = 1; i < cierres.length; i += 1) {
    const d = cierres[i] - cierres[i - 1];
    const s = Math.max(d, 0);
    const b = Math.max(-d, 0);
    if (i <= n) {
      sube += s;
      baja += b;
      if (i === n) {
        sube /= n;
        baja /= n;
        out[i] = baja === 0 ? 100 : 100 - 100 / (1 + sube / baja);
      }
      continue;
    }
    sube = (sube * (n - 1) + s) / n;
    baja = (baja * (n - 1) + b) / n;
    out[i] = baja === 0 ? 100 : 100 - 100 / (1 + sube / baja);
  }
  return out;
}

export function atr(v: SwingCandle[], n = 14): number[] {
  const out = new Array<number>(v.length).fill(Number.NaN);
  let prev = Number.NaN;
  let suma = 0;
  for (let i = 1; i < v.length; i += 1) {
    const tr = Math.max(v[i].high - v[i].low, Math.abs(v[i].high - v[i - 1].close), Math.abs(v[i].low - v[i - 1].close));
    if (i < n) {
      suma += tr;
      continue;
    }
    if (i === n) prev = (suma + tr) / n;
    else prev = (prev * (n - 1) + tr) / n;
    out[i] = prev;
  }
  return out;
}

/** Supertrend clásico: bandas a ±m·ATR del punto medio, que solo se mueven a favor; la dirección cambia al cruzarlas. */
export function supertrend(v: SwingCandle[], n = 10, m = 3): { linea: number[]; dir: number[] } {
  const a = atr(v, n);
  const linea = new Array<number>(v.length).fill(Number.NaN);
  const dir = new Array<number>(v.length).fill(Number.NaN);
  let arriba = Number.NaN;
  let abajo = Number.NaN;
  let d = 1;
  for (let i = 0; i < v.length; i += 1) {
    if (!Number.isFinite(a[i])) continue;
    const medio = (v[i].high + v[i].low) / 2;
    const up = medio + m * a[i];
    const lo = medio - m * a[i];
    const previo = i > 0 ? v[i - 1].close : v[i].close;
    const nuevoArriba = !Number.isFinite(arriba) || up < arriba || previo > arriba ? up : arriba;
    const nuevoAbajo = !Number.isFinite(abajo) || lo > abajo || previo < abajo ? lo : abajo;
    if (Number.isFinite(arriba) && Number.isFinite(abajo)) {
      if (d === 1 && v[i].close < nuevoAbajo) d = -1;
      else if (d === -1 && v[i].close > nuevoArriba) d = 1;
    }
    arriba = nuevoArriba;
    abajo = nuevoAbajo;
    dir[i] = d;
    linea[i] = d === 1 ? abajo : arriba;
  }
  return { linea, dir };
}

export function indicadores(v: SwingCandle[]): Indicadores {
  const c = v.map((x) => x.close);
  const bbMedia = new Array<number>(v.length).fill(Number.NaN);
  const bbAlta = new Array<number>(v.length).fill(Number.NaN);
  const bbBaja = new Array<number>(v.length).fill(Number.NaN);
  for (let i = 19; i < v.length; i += 1) {
    let s = 0;
    for (let j = i - 19; j <= i; j += 1) s += c[j];
    const m = s / 20;
    let q = 0;
    for (let j = i - 19; j <= i; j += 1) q += (c[j] - m) ** 2;
    const d = Math.sqrt(q / 20);
    bbMedia[i] = m;
    bbAlta[i] = m + 2 * d;
    bbBaja[i] = m - 2 * d;
  }
  const e12 = ema(c, 12);
  const e26 = ema(c, 26);
  const macd = c.map((_, i) => e12[i] - e26[i]);
  const primero = macd.findIndex((x) => Number.isFinite(x));
  const senalParcial = primero < 0 ? [] : ema(macd.slice(primero), 9);
  const macdSenal = c.map((_, i) => (primero >= 0 && i >= primero ? senalParcial[i - primero] : Number.NaN));
  const st = supertrend(v, 10, 3);
  return { ema20: ema(c, 20), ema50: ema(c, 50), ema200: ema(c, 200), rsi14: rsi(c, 14), atr14: atr(v, 14), bbMedia, bbAlta, bbBaja, macd, macdSenal, stLinea: st.linea, stDir: st.dir };
}

const ok = (...xs: number[]) => xs.every((x) => Number.isFinite(x));
/** Objetivo a `rr` veces el riesgo desde el cierre (la entrada real se corrige después con la apertura siguiente). */
const conRR = (lado: Lado, entrada: number, stop: number, rr: number): Senal => ({
  lado,
  stop,
  objetivo: lado === "LONG" ? entrada + rr * (entrada - stop) : entrada - rr * (stop - entrada),
});

// ── Las estrategias, una por agente. Parámetros clásicos, fijos. ──

export const ESTRATEGIAS: Estrategia[] = [
  {
    id: "RUPTURA",
    agente: "Agente Ruptura",
    nombre: "Ruptura de rango (Donchian 20)",
    regla: "Cierre por encima del máximo de las 20 velas anteriores (o por debajo del mínimo). Stop en el extremo opuesto de 10 velas. Objetivo 2 R.",
    senal: (v, _ind, i) => {
      if (i < 21) return null;
      let alto = -Infinity;
      let bajo = Infinity;
      for (let j = i - 20; j < i; j += 1) {
        alto = Math.max(alto, v[j].high);
        bajo = Math.min(bajo, v[j].low);
      }
      let min10 = Infinity;
      let max10 = -Infinity;
      for (let j = i - 9; j <= i; j += 1) {
        min10 = Math.min(min10, v[j].low);
        max10 = Math.max(max10, v[j].high);
      }
      const c = v[i].close;
      if (c > alto && min10 < c) return conRR("LONG", c, min10, 2);
      if (c < bajo && max10 > c) return conRR("SHORT", c, max10, 2);
      return null;
    },
  },
  {
    id: "CRUCE_EMA",
    agente: "Agente Tendencia",
    nombre: "Cruce de medias (EMA 20 / EMA 50)",
    regla: "La EMA 20 cruza la EMA 50. Stop a 1,5 ATR. Objetivo 2 R.",
    senal: (v, ind, i) => {
      const { ema20: a, ema50: b, atr14: t } = ind;
      if (i < 1 || !ok(a[i], b[i], a[i - 1], b[i - 1], t[i])) return null;
      const c = v[i].close;
      if (a[i - 1] <= b[i - 1] && a[i] > b[i]) return conRR("LONG", c, c - 1.5 * t[i], 2);
      if (a[i - 1] >= b[i - 1] && a[i] < b[i]) return conRR("SHORT", c, c + 1.5 * t[i], 2);
      return null;
    },
  },
  {
    id: "RSI",
    agente: "Agente Reversión",
    nombre: "Reversión por RSI 14 (30 / 70)",
    regla: "El RSI sale de sobreventa (cruza 30 hacia arriba) o de sobrecompra (cruza 70 hacia abajo). Stop a 1,5 ATR. Objetivo 1,5 R.",
    senal: (v, ind, i) => {
      const { rsi14: r, atr14: t } = ind;
      if (i < 1 || !ok(r[i], r[i - 1], t[i])) return null;
      const c = v[i].close;
      if (r[i - 1] < 30 && r[i] >= 30) return conRR("LONG", c, c - 1.5 * t[i], 1.5);
      if (r[i - 1] > 70 && r[i] <= 70) return conRR("SHORT", c, c + 1.5 * t[i], 1.5);
      return null;
    },
  },
  {
    id: "BOLLINGER",
    agente: "Agente Bandas",
    nombre: "Vuelta a las bandas de Bollinger (20, 2)",
    regla: "Cierra fuera de la banda y la vela siguiente vuelve adentro. Stop a 1,5 ATR. Objetivo 1,5 R.",
    senal: (v, ind, i) => {
      const { bbAlta: hi, bbBaja: lo, atr14: t } = ind;
      if (i < 1 || !ok(hi[i], lo[i], hi[i - 1], lo[i - 1], t[i])) return null;
      const c = v[i].close;
      if (v[i - 1].close < lo[i - 1] && c > lo[i]) return conRR("LONG", c, c - 1.5 * t[i], 1.5);
      if (v[i - 1].close > hi[i - 1] && c < hi[i]) return conRR("SHORT", c, c + 1.5 * t[i], 1.5);
      return null;
    },
  },
  {
    id: "RETROCESO",
    agente: "Agente Retroceso",
    nombre: "Retroceso a la EMA 20 en tendencia (EMA 50 / 200)",
    regla: "Con la EMA 50 por encima de la 200, el precio toca la EMA 20 y cierra arriba (al revés en baja). Stop a 1,5 ATR. Objetivo 2 R.",
    senal: (v, ind, i) => {
      const { ema20: a, ema50: b, ema200: d, atr14: t } = ind;
      if (!ok(a[i], b[i], d[i], t[i])) return null;
      const x = v[i];
      if (b[i] > d[i] && x.low <= a[i] && x.close > a[i] && x.close > x.open) return conRR("LONG", x.close, x.close - 1.5 * t[i], 2);
      if (b[i] < d[i] && x.high >= a[i] && x.close < a[i] && x.close < x.open) return conRR("SHORT", x.close, x.close + 1.5 * t[i], 2);
      return null;
    },
  },
  {
    id: "MACD",
    agente: "Agente Momento",
    nombre: "Cruce de MACD (12, 26, 9) a favor de la EMA 200",
    regla: "El MACD cruza su señal a favor de la tendencia de la EMA 200. Stop a 1,5 ATR. Objetivo 2 R.",
    senal: (v, ind, i) => {
      const { macd: m, macdSenal: s, ema200: d, atr14: t } = ind;
      if (i < 1 || !ok(m[i], s[i], m[i - 1], s[i - 1], d[i], t[i])) return null;
      const c = v[i].close;
      if (c > d[i] && m[i - 1] <= s[i - 1] && m[i] > s[i]) return conRR("LONG", c, c - 1.5 * t[i], 2);
      if (c < d[i] && m[i - 1] >= s[i - 1] && m[i] < s[i]) return conRR("SHORT", c, c + 1.5 * t[i], 2);
      return null;
    },
  },
  {
    id: "SUPERTREND",
    agente: "Agente Supertrend",
    nombre: "Supertrend (10, 3) con filtro de EMA 200",
    regla: "El Supertrend da vuelta a alcista con el cierre sobre la EMA 200 (o a bajista bajo la EMA 200). Stop en la línea del Supertrend. Objetivo 2 R.",
    senal: (v, ind, i) => {
      const { stLinea: l, stDir: d, ema200: e } = ind;
      if (i < 1 || !ok(l[i], d[i], d[i - 1], e[i])) return null;
      const c = v[i].close;
      if (d[i - 1] === -1 && d[i] === 1 && c > e[i] && l[i] < c) return conRR("LONG", c, l[i], 2);
      if (d[i - 1] === 1 && d[i] === -1 && c < e[i] && l[i] > c) return conRR("SHORT", c, l[i], 2);
      return null;
    },
  },
  {
    id: "AZAR",
    agente: "Agente Control (azar)",
    nombre: "Entrada al azar (control)",
    regla: "Entra en un 2 % de las velas, con lado al azar y semilla fija. Stop a 1,5 ATR. Objetivo 2 R. Sirve de vara: lo que no le gana a esto no tiene ventaja.",
    senal: (v, ind, i) => {
      const t = ind.atr14[i];
      if (!ok(t)) return null;
      // Azar reproducible: depende solo de la hora de la vela, no de su precio ni de lo que viene.
      const h = Math.sin(v[i].openTime / 3_600_000) * 10_000;
      const u = h - Math.floor(h);
      if (u >= 0.02) return null;
      const c = v[i].close;
      return u < 0.01 ? conRR("LONG", c, c - 1.5 * t, 2) : conRR("SHORT", c, c + 1.5 * t, 2);
    },
  },
];

// ── La medición ──

export type Operacion = {
  estrategia: EstrategiaId;
  symbol: string;
  lado: Lado;
  abiertaA: number;
  cerradaA: number;
  r: number;
  tp1: boolean;
  tp2: boolean;
  tp3: boolean;
  sl: boolean;
};

export type OpcionesEstudio = { marcoMs: number; horizonte: number; feePct: number };

/** Todas las operaciones de una estrategia en una moneda, una por vez, con la escalera de la app. */
export function operar(e: Estrategia, symbol: string, v: SwingCandle[], o: OpcionesEstudio): Operacion[] {
  const ind = indicadores(v);
  const out: Operacion[] = [];
  let libreDesde = 0;
  for (let i = 0; i < v.length - 1; i += 1) {
    if (v[i].openTime < libreDesde) continue;
    const s = e.senal(v, ind, i);
    if (!s) continue;
    // Entrada a la apertura de la vela siguiente; el stop y el objetivo mantienen su distancia en R.
    const entrada = v[i + 1].open;
    const riesgo = Math.abs(v[i].close - s.stop);
    const rr = Math.abs(s.objetivo - v[i].close) / riesgo;
    if (!(riesgo > 0) || !Number.isFinite(rr)) continue;
    const stop = s.lado === "LONG" ? entrada - riesgo : entrada + riesgo;
    const objetivo = s.lado === "LONG" ? entrada + rr * riesgo : entrada - rr * riesgo;
    const esc = escaleraHacia(s.lado, entrada, stop, objetivo);
    if (!esc) continue;
    // La vela de entrada cuenta: la operación vive desde su apertura (se pasa con hora anterior para que entre).
    const tramo = v.slice(i + 1, i + 1 + o.horizonte);
    const rec = recorrer(s.lado, entrada, esc, v[i].openTime, tramo, o.marcoMs, Number.POSITIVE_INFINITY, { horizonte: o.horizonte, feePct: o.feePct });
    if (rec.r === null || rec.cerradaA === null) break; // se quedó sin velas: abierta al final, no cuenta
    out.push({
      estrategia: e.id,
      symbol,
      lado: s.lado,
      abiertaA: v[i + 1].openTime,
      cerradaA: rec.cerradaA,
      r: rec.r,
      tp1: rec.tp1At !== null || rec.desenlace === "TP3",
      tp2: rec.tp2At !== null || rec.desenlace === "TP3",
      tp3: rec.desenlace === "TP3",
      sl: rec.desenlace === "SL",
    });
    libreDesde = rec.cerradaA;
  }
  return out;
}

export type Medicion = {
  operaciones: number;
  ganadas: number;
  winRate: number | null;
  /** Qué parte de las operaciones llegó a cada objetivo (TP3 es el objetivo final). */
  tasaTp1: number | null;
  tasaTp2: number | null;
  tasaTp3: number | null;
  tasaSl: number | null;
  profitFactor: number | null;
  expectancia: number | null;
  /** Intervalo del 90 % de la expectancia (media ± 1,645 errores estándar). */
  expectanciaIc: { low: number; high: number } | null;
  netoR: number;
  maxCaidaR: number;
};

export function medir(ops: Operacion[]): Medicion {
  const n = ops.length;
  const rs = [...ops].sort((a, b) => a.cerradaA - b.cerradaA).map((x) => x.r);
  const gan = rs.filter((r) => r > 0);
  const per = rs.filter((r) => r < 0);
  const g = gan.reduce((s, r) => s + r, 0);
  const p = -per.reduce((s, r) => s + r, 0);
  const neto = rs.reduce((s, r) => s + r, 0);
  let acum = 0;
  let pico = 0;
  let dd = 0;
  for (const r of rs) {
    acum += r;
    pico = Math.max(pico, acum);
    dd = Math.max(dd, pico - acum);
  }
  const media = n ? neto / n : null;
  const de = n > 1 && media !== null ? Math.sqrt(rs.reduce((s, r) => s + (r - media) ** 2, 0) / (n - 1)) : null;
  const tasa = (k: number) => (n ? k / n : null);
  return {
    operaciones: n,
    ganadas: gan.length,
    winRate: tasa(gan.length),
    tasaTp1: tasa(ops.filter((x) => x.tp1).length),
    tasaTp2: tasa(ops.filter((x) => x.tp2).length),
    tasaTp3: tasa(ops.filter((x) => x.tp3).length),
    tasaSl: tasa(ops.filter((x) => x.sl).length),
    profitFactor: p > 0 ? g / p : null,
    expectancia: media,
    expectanciaIc: media !== null && de !== null ? { low: media - (1.645 * de) / Math.sqrt(n), high: media + (1.645 * de) / Math.sqrt(n) } : null,
    netoR: neto,
    maxCaidaR: dd,
  };
}

/**
 * El veredicto de un agente, decidido solo con la EVALUACIÓN (el tramo final, que no se miró al elegir reglas):
 * ventaja si el intervalo de su expectancia queda entero por encima de cero y le gana al control; sin ventaja si
 * queda por debajo; sin conclusión si cruza el cero o la muestra es chica.
 */
export type Veredicto = "VENTAJA" | "SIN VENTAJA" | "SIN CONCLUSIÓN";
export const MUESTRA_ESTUDIO = 100;

export function veredicto(m: Medicion, control: Medicion | null): Veredicto {
  if (m.operaciones < MUESTRA_ESTUDIO || !m.expectanciaIc || m.expectancia === null) return "SIN CONCLUSIÓN";
  if (m.expectanciaIc.high < 0) return "SIN VENTAJA";
  if (m.expectanciaIc.low > 0 && (!control || control.expectancia === null || m.expectancia > control.expectancia)) return "VENTAJA";
  return "SIN CONCLUSIÓN";
}
