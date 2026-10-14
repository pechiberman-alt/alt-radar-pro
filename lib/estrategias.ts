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
import { BREAK_ATR, findPivots, FLAT_ATR, MIN_SPAN, type Pivot, WICK_ATR } from "./trendlines.ts";
import type { SwingCandle } from "./swing-entries.ts";

export type EstrategiaId = "RUPTURA" | "CRUCE_EMA" | "RSI" | "BOLLINGER" | "RETROCESO" | "MACD" | "MACD_MTF_SNR" | "SUPERTREND" | "ST_VWAP" | "ST_PERFIL" | "ST_VWAP_PERFIL" | "ST_MTF" | "ST_MTF_VOL" | "SNR" | "SNR_HTF" | "TENDENCIA_LINEA" | "AZAR";

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
  /** VWAP anclado al lunes 00:00 UTC de cada semana (precio típico por volumen, hasta la vela i inclusive). */
  vwap: number[];
  /** Punto de control (POC) del perfil de volumen de las últimas 200 velas: el precio donde más volumen se operó. */
  poc: number[];
  /** Dirección del Supertrend (10, 3) del marco superior (HTF) ya cerrado: diario si las velas son de 4 h o más, de 4 h si son menores. */
  htfDir: number[];
  /** MACD y RSI de los marcos superiores ya cerrados, en el mismo sentido: +1 si todos alcistas, -1 si todos bajistas, 0 si no coinciden (NaN sin datos). */
  alineacionHtf: number[];
  /** Volumen de la vela dividido por el promedio de las 20 velas anteriores (NaN sin historia o sin volumen). */
  volRel: number[];
  /** SNR: precio del nivel de resistencia fresco que esta vela tocó por primera vez con la mecha y rechazó (NaN si no). */
  snrRes: number[];
  /** SNR: precio del nivel de soporte fresco que esta vela tocó por primera vez con la mecha y rechazó (NaN si no). */
  snrSop: number[];
  /** Ruptura de una línea de tendencia de dos pivotes en esta vela (ver rupturasLinea): +1 alcista, -1 bajista, 0 sin ruptura. */
  lineaRuptura: number[];
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

/** Semana de la vela (lunes a domingo, UTC): el VWAP se reinicia cada lunes. */
const semanaDe = (t: number) => Math.floor((t - 4 * 86_400_000) / (7 * 86_400_000));

/** VWAP anclado a la semana. En i usa solo velas de la misma semana hasta i; sin volumen, NaN. */
export function vwapSemanal(v: SwingCandle[]): number[] {
  const out = new Array<number>(v.length).fill(Number.NaN);
  let semana = Number.NaN;
  let pv = 0;
  let vol = 0;
  for (let i = 0; i < v.length; i += 1) {
    const s = semanaDe(v[i].openTime);
    if (s !== semana) {
      semana = s;
      pv = 0;
      vol = 0;
    }
    pv += ((v[i].high + v[i].low + v[i].close) / 3) * v[i].volume;
    vol += v[i].volume;
    if (vol > 0) out[i] = pv / vol;
  }
  return out;
}

const PERFIL_VELAS = 200;
const PERFIL_NIVELES = 24;

/** POC del perfil de volumen de las últimas 200 velas (24 niveles; el volumen de cada vela va al nivel de su precio típico). */
export function pocPerfil(v: SwingCandle[]): number[] {
  const out = new Array<number>(v.length).fill(Number.NaN);
  for (let i = PERFIL_VELAS - 1; i < v.length; i += 1) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = i - PERFIL_VELAS + 1; j <= i; j += 1) {
      lo = Math.min(lo, v[j].low);
      hi = Math.max(hi, v[j].high);
    }
    if (!(hi > lo)) continue;
    const ancho = (hi - lo) / PERFIL_NIVELES;
    const nivel = new Array<number>(PERFIL_NIVELES).fill(0);
    for (let j = i - PERFIL_VELAS + 1; j <= i; j += 1) {
      const tipico = (v[j].high + v[j].low + v[j].close) / 3;
      nivel[Math.min(PERFIL_NIVELES - 1, Math.floor((tipico - lo) / ancho))] += v[j].volume;
    }
    let mejor = 0;
    for (let k = 1; k < PERFIL_NIVELES; k += 1) if (nivel[k] > nivel[mejor]) mejor = k;
    if (nivel[mejor] > 0) out[i] = lo + (mejor + 0.5) * ancho;
  }
  return out;
}

/**
 * Agrupa `v` en cubos de `cubo` ms (4 h o un día). Para cada vela dice qué cubo ya cerró en su cierre (-1 si ninguno):
 * un cubo a medio formar nunca cuenta, así que nada mira adelante.
 */
function cubosCerrados(v: SwingCandle[], cubo: number): { sup: SwingCandle[]; cerrado: number[] } {
  const marco = v[1].openTime - v[0].openTime;
  const sup: SwingCandle[] = [];
  const claveDe = (i: number) => Math.floor(v[i].openTime / cubo);
  const idx = new Array<number>(v.length);
  let ultima = Number.NaN;
  for (let i = 0; i < v.length; i += 1) {
    const k = claveDe(i);
    if (k !== ultima) {
      ultima = k;
      sup.push({ openTime: k * cubo, open: v[i].open, high: v[i].high, low: v[i].low, close: v[i].close, volume: v[i].volume } as SwingCandle);
    } else {
      const b = sup[sup.length - 1];
      b.high = Math.max(b.high, v[i].high);
      b.low = Math.min(b.low, v[i].low);
      b.close = v[i].close;
      b.volume += v[i].volume;
    }
    idx[i] = sup.length - 1;
  }
  const cerrado = v.map((_, i) => {
    const cierraAqui = v[i].openTime + marco >= (claveDe(i) + 1) * cubo;
    return cierraAqui ? idx[i] : idx[i] - 1;
  });
  return { sup, cerrado };
}

/**
 * Dirección del Supertrend del marco superior en cada vela. Solo cuenta la vela superior ya cerrada: dentro del día
 * (o de las 4 h) en curso se usa la anterior, así que nada mira adelante.
 */
export function direccionHtf(v: SwingCandle[]): number[] {
  const out = new Array<number>(v.length).fill(Number.NaN);
  if (v.length < 2) return out;
  const marco = v[1].openTime - v[0].openTime;
  const cubo = marco >= 4 * 3_600_000 ? 86_400_000 : 4 * 3_600_000;
  const { sup, cerrado } = cubosCerrados(v, cubo);
  const dir = supertrend(sup, 10, 3).dir;
  for (let i = 0; i < v.length; i += 1) if (cerrado[i] >= 0) out[i] = dir[cerrado[i]];
  return out;
}

/** MACD (12, 26) y su señal (EMA 9 de la línea), con NaN hasta tener historia. */
function macdDe(c: number[]): { macd: number[]; senal: number[] } {
  const e12 = ema(c, 12);
  const e26 = ema(c, 26);
  const macd = c.map((_, i) => e12[i] - e26[i]);
  const primero = macd.findIndex((x) => Number.isFinite(x));
  const senalParcial = primero < 0 ? [] : ema(macd.slice(primero), 9);
  const senal = c.map((_, i) => (primero >= 0 && i >= primero ? senalParcial[i - primero] : Number.NaN));
  return { macd, senal };
}

/** Estado del MACD y del RSI (14) de cada cubo ya cerrado: +1 alcistas, -1 bajistas, 0 mezclados, NaN sin datos. */
function estadoMacdRsi(v: SwingCandle[], cubo: number): number[] {
  const { sup, cerrado } = cubosCerrados(v, cubo);
  const c = sup.map((x) => x.close);
  const { macd: m, senal: s } = macdDe(c);
  const r = rsi(c, 14);
  const estado = c.map((_, j) => {
    if (!ok(m[j], s[j], r[j])) return Number.NaN;
    if (m[j] > s[j] && r[j] > 50) return 1;
    if (m[j] < s[j] && r[j] < 50) return -1;
    return 0;
  });
  return cerrado.map((d) => (d >= 0 ? estado[d] : Number.NaN));
}

/** Temporalidades que pueden servir de marco superior, en ms y de menor a mayor. */
const MARCOS_SUPERIORES_MS = [15 * 60_000, 3_600_000, 4 * 3_600_000, 86_400_000];

/**
 * MACD y RSI de los marcos superiores ya cerrados, en el mismo sentido: +1 si todos están alcistas, -1 si todos bajistas,
 * 0 si no coinciden, NaN sin datos. Mira todas las temporalidades por encima de la de la vela: desde 3 min, las de
 * 15 min, 1 h, 4 h y diarias; desde 15 min, 1 h, 4 h y diarias; desde 1 h, 4 h y diarias; desde 4 h, las diarias.
 */
export function alineacionHtf(v: SwingCandle[]): number[] {
  const out = new Array<number>(v.length).fill(Number.NaN);
  if (v.length < 2) return out;
  const marco = v[1].openTime - v[0].openTime;
  const cubos = MARCOS_SUPERIORES_MS.filter((ms) => ms > marco);
  if (cubos.length === 0) return out;
  const estados = cubos.map((cubo) => estadoMacdRsi(v, cubo));
  for (let i = 0; i < v.length; i += 1) {
    const vals = estados.map((e) => e[i]);
    if (!vals.every((x) => Number.isFinite(x))) continue;
    if (vals.every((x) => x === 1)) out[i] = 1;
    else if (vals.every((x) => x === -1)) out[i] = -1;
    else out[i] = 0;
  }
  return out;
}

/** Volumen relativo: el de la vela contra el promedio de las 20 anteriores (sin incluirla), así que no mira adelante. */
export function volumenRelativo(v: SwingCandle[], n = 20): number[] {
  const out = new Array<number>(v.length).fill(Number.NaN);
  let suma = 0;
  for (let i = 0; i < v.length; i += 1) {
    if (i >= n) {
      const media = suma / n;
      if (media > 0) out[i] = v[i].volume / media;
      suma -= v[i - n].volume;
    }
    suma += v[i].volume;
  }
  return out;
}

/** Cuántas velas vive un nivel de SNR sin tocarse antes de descartarlo. */
const SNR_VIDA = 200;

/**
 * SNR (soportes y resistencias del estilo «malayo»), con las reglas fijadas antes de medir. Niveles de UN precio: el pico de la
 * línea de cierres (nivel A, resistencia), el valle (nivel V, soporte) y el hueco entre dos velas del mismo color (el hueco
 * al alza es soporte; a la baja, resistencia, al precio de apertura de la segunda). Un nivel es fresco hasta que una mecha lo
 * toca: esa primera visita se vuelve señal solo si la vela cierra del lado del rechazo (debajo de una resistencia, encima
 * de un soporte); después el nivel se gasta. Cada nivel se conoce una vela después de formarse y se puede tocar desde la
 * siguiente, así que nada mira adelante.
 */
export function nivelesSnr(v: SwingCandle[]): { res: number[]; sop: number[] } {
  const res = new Array<number>(v.length).fill(Number.NaN);
  const sop = new Array<number>(v.length).fill(Number.NaN);
  type Nivel = { precio: number; tipo: "R" | "S"; desde: number; nacio: number };
  let activos: Nivel[] = [];
  for (let i = 0; i < v.length; i += 1) {
    const x = v[i];
    let tocoRes = Infinity;
    let tocoSop = -Infinity;
    activos = activos.filter((n) => {
      if (i - n.nacio > SNR_VIDA) return false;
      if (i < n.desde) return true;
      if (n.tipo === "R" && x.high >= n.precio) {
        if (x.close < n.precio) tocoRes = Math.min(tocoRes, n.precio);
        return false;
      }
      if (n.tipo === "S" && x.low <= n.precio) {
        if (x.close > n.precio) tocoSop = Math.max(tocoSop, n.precio);
        return false;
      }
      return true;
    });
    if (tocoRes < Infinity) res[i] = tocoRes;
    if (tocoSop > -Infinity) sop[i] = tocoSop;
    if (i >= 2) {
      const c1 = v[i - 1].close;
      if (c1 > v[i - 2].close && c1 > x.close) activos.push({ precio: c1, tipo: "R", desde: i + 1, nacio: i });
      else if (c1 < v[i - 2].close && c1 < x.close) activos.push({ precio: c1, tipo: "S", desde: i + 1, nacio: i });
    }
    if (i >= 1) {
      const a = v[i - 1];
      if (a.close > a.open && x.close > x.open && x.open > a.close) activos.push({ precio: x.open, tipo: "S", desde: i + 1, nacio: i });
      if (a.close < a.open && x.close < x.open && x.open < a.close) activos.push({ precio: x.open, tipo: "R", desde: i + 1, nacio: i });
    }
  }
  return { res, sop };
}

// ── Rupturas de línea de tendencia (dos pivotes) ──

/** Pivotes de 5 velas a cada lado: el mismo criterio que dibuja la app (lib/trendlines.ts). */
const LINEA_PIVOTES = 5;
/** Una línea deja de contar cuando su segundo pivote tiene 200 velas o más. */
const LINEA_VIDA = 200;

type ParLinea = { a: Pivot; b: Pivot; pendiente: number; atrB: number };

/** Una ruptura de línea de tendencia: la línea que la causó (anclada en su primer pivote) y el sentido (+1 alcista, -1 bajista). */
export type EventoLinea = { signo: 1 | -1; a: Pivot; pendiente: number; atrB: number };

/** Precio de la línea de un evento en la vela k. */
export const precioLinea = (e: Pick<EventoLinea, "a" | "pendiente">, k: number): number => e.a.price + e.pendiente * (k - e.a.i);

/**
 * La línea que une dos pivotes del mismo tipo (picos: resistencia que baja; valles: soporte que sube), si cumple las
 * reglas de la app: al menos 5 velas de separación, no plana (0,5 ATR entre sus puntos), y el precio la respeta entre
 * los dos (ningún cierre la pasa por 0,1 ATR; ninguna mecha por más de 0,5 ATR). Y no se rompió antes de conocerse el
 * segundo pivote: en ese caso nadie la podía haber dibujado a tiempo.
 */
function formarPar(v: SwingCandle[], atr14: number[], a: Pivot, b: Pivot): ParLinea | null {
  const atrB = atr14[b.i];
  if (b.i - a.i < MIN_SPAN || !(atrB > 0)) return null;
  const pendiente = (b.price - a.price) / (b.i - a.i);
  if (a.kind === "high" ? pendiente >= 0 : pendiente <= 0) return null;
  if (Math.abs(b.price - a.price) < FLAT_ATR * atrB) return null;
  const signo = a.kind === "high" ? 1 : -1;
  const linea = (k: number) => a.price + pendiente * (k - a.i);
  for (let k = a.i + 1; k < b.i; k += 1) {
    const mecha = a.kind === "high" ? v[k].high : v[k].low;
    if (signo * (v[k].close - linea(k)) > BREAK_ATR * atrB || signo * (mecha - linea(k)) > WICK_ATR * atrB) return null;
  }
  for (let k = b.i + 1; k <= b.confirmedAt; k += 1) {
    if (signo * (v[k].close - linea(k)) > BREAK_ATR * atrB) return null;
  }
  return { a, b, pendiente, atrB };
}

/**
 * Rupturas de línea de tendencia, causales, con pivotes de `n` velas a cada lado (5, como la app, por defecto). En cada vela,
 * la línea es la que une los dos últimos pivotes ya conocidos del mismo tipo; un pivote se conoce `n` velas después de
 * formarse, así que la vela i usa pivotes confirmados hasta la i-1. El primer cierre que pasa la línea por 0,1 ATR da un
 * evento (+1 si rompe una resistencia hacia arriba, -1 si rompe un soporte hacia abajo), una sola vez por línea. Si en una
 * misma vela pasa las dos líneas, no hay evento. Cada valor usa solo velas hasta el suyo.
 */
export function eventosLinea(v: SwingCandle[], n = LINEA_PIVOTES, vida = LINEA_VIDA): (EventoLinea | null)[] {
  const out = new Array<EventoLinea | null>(v.length).fill(null);
  const atr14 = atr(v, 14);
  const confirmados = findPivots(v, n);
  const ultimos: Record<"high" | "low", Pivot[]> = { high: [], low: [] };
  const par: Record<"high" | "low", ParLinea | null> = { high: null, low: null };
  let p = 0;
  for (let i = 0; i < v.length; i += 1) {
    while (p < confirmados.length && confirmados[p].confirmedAt <= i - 1) {
      const nuevo = confirmados[p];
      p += 1;
      const lista = ultimos[nuevo.kind];
      lista.push(nuevo);
      if (lista.length > 2) lista.shift();
      par[nuevo.kind] = lista.length === 2 ? formarPar(v, atr14, lista[0], lista[1]) : null;
    }
    const cruces: EventoLinea[] = [];
    for (const lado of ["high", "low"] as const) {
      const q = par[lado];
      if (!q) continue;
      if (i - q.b.i > vida) {
        par[lado] = null;
        continue;
      }
      const signo = lado === "high" ? 1 : -1;
      if (signo * (v[i].close - precioLinea(q, i)) > BREAK_ATR * q.atrB) {
        cruces.push({ signo, a: q.a, pendiente: q.pendiente, atrB: q.atrB });
        par[lado] = null;
      }
    }
    if (cruces.length === 1) out[i] = cruces[0];
  }
  return out;
}

/** Rupturas de línea de tendencia como números: +1 alcista, -1 bajista, 0 sin ruptura (ver eventosLinea). */
export function rupturasLinea(v: SwingCandle[]): number[] {
  return eventosLinea(v).map((e) => (e ? e.signo : 0));
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
  const { macd, senal: macdSenal } = macdDe(c);
  const st = supertrend(v, 10, 3);
  const snr = nivelesSnr(v);
  return { ema20: ema(c, 20), ema50: ema(c, 50), ema200: ema(c, 200), rsi14: rsi(c, 14), atr14: atr(v, 14), bbMedia, bbAlta, bbBaja, macd, macdSenal, stLinea: st.linea, stDir: st.dir, vwap: vwapSemanal(v), poc: pocPerfil(v), htfDir: direccionHtf(v), alineacionHtf: alineacionHtf(v), volRel: volumenRelativo(v), snrRes: snr.res, snrSop: snr.sop, lineaRuptura: rupturasLinea(v) };
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
    id: "MACD_MTF_SNR",
    agente: "Agente Momento MTF + SNR",
    nombre: "Cruce de MACD a favor de la EMA 200, con marcos superiores alineados y rechazo de un nivel SNR",
    regla: "Igual que el Agente Momento, y además el RSI (14) de la vela de señal está del lado del cruce (sobre 50 para largos, bajo 50 para cortos); el MACD y el RSI de todas las temporalidades superiores ya cerradas van en el mismo sentido (en velas de 3 min: 15 min, 1 h, 4 h y diaria; de 15 min: 1 h, 4 h y diaria; de 1 h: 4 h y diaria; de 4 h: diaria); y la vela toca con la mecha y rechaza un nivel SNR fresco del lado de la operación. Stop a 1,5 ATR. Objetivo 2 R.",
    senal: (v, ind, i) => {
      const { macd: m, macdSenal: s, ema200: d, atr14: t, rsi14: r, alineacionHtf: a, snrSop: sp, snrRes: rs } = ind;
      if (i < 1 || !ok(m[i], s[i], m[i - 1], s[i - 1], d[i], t[i], r[i], a[i])) return null;
      const c = v[i].close;
      if (c > d[i] && m[i - 1] <= s[i - 1] && m[i] > s[i] && r[i] > 50 && a[i] === 1 && Number.isFinite(sp[i])) return conRR("LONG", c, c - 1.5 * t[i], 2);
      if (c < d[i] && m[i - 1] >= s[i - 1] && m[i] < s[i] && r[i] < 50 && a[i] === -1 && Number.isFinite(rs[i])) return conRR("SHORT", c, c + 1.5 * t[i], 2);
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
  ...[
    { id: "ST_VWAP", agente: "Agente Supertrend + VWAP", nombre: "Supertrend + EMA 200 con VWAP semanal", usaVwap: true, usaPerfil: false, extra: "el cierre del lado favorable del VWAP anclado al lunes (arriba para largos, abajo para cortos)" },
    { id: "ST_PERFIL", agente: "Agente Supertrend + Perfil", nombre: "Supertrend + EMA 200 con perfil de volumen", usaVwap: false, usaPerfil: true, extra: "el cierre del lado favorable del POC del perfil de volumen de 200 velas (arriba para largos, abajo para cortos)" },
    { id: "ST_VWAP_PERFIL", agente: "Agente Supertrend + VWAP + Perfil", nombre: "Supertrend + EMA 200 con VWAP y perfil", usaVwap: true, usaPerfil: true, extra: "el cierre del lado favorable del VWAP semanal y del POC de 200 velas a la vez" },
  ].map(
    (f): Estrategia => ({
      id: f.id as EstrategiaId,
      agente: f.agente,
      nombre: f.nombre,
      regla: `Igual que el Agente Supertrend, y además exige ${f.extra}. Stop en la línea del Supertrend. Objetivo 2 R.`,
      senal: (v, ind, i) => {
        const { stLinea: l, stDir: d, ema200: e, vwap: w, poc: p } = ind;
        if (i < 1 || !ok(l[i], d[i], d[i - 1], e[i]) || (f.usaVwap && !ok(w[i])) || (f.usaPerfil && !ok(p[i]))) return null;
        const c = v[i].close;
        if (d[i - 1] === -1 && d[i] === 1 && c > e[i] && l[i] < c && (!f.usaVwap || c > w[i]) && (!f.usaPerfil || c > p[i])) return conRR("LONG", c, l[i], 2);
        if (d[i - 1] === 1 && d[i] === -1 && c < e[i] && l[i] > c && (!f.usaVwap || c < w[i]) && (!f.usaPerfil || c < p[i])) return conRR("SHORT", c, l[i], 2);
        return null;
      },
    }),
  ),
  {
    id: "ST_MTF",
    agente: "Agente Supertrend MTF",
    nombre: "Supertrend + EMA 200 con confirmación del marco superior (HTF)",
    regla: "Igual que el Agente Supertrend, y además el Supertrend del marco superior ya cerrado (diario en velas de 4 h; 4 h en velas de 1 h) tiene que ir en el mismo sentido. Stop en la línea del Supertrend. Objetivo 2 R.",
    senal: (v, ind, i) => {
      const { stLinea: l, stDir: d, ema200: e, htfDir: h } = ind;
      if (i < 1 || !ok(l[i], d[i], d[i - 1], e[i], h[i])) return null;
      const c = v[i].close;
      if (d[i - 1] === -1 && d[i] === 1 && c > e[i] && l[i] < c && h[i] === 1) return conRR("LONG", c, l[i], 2);
      if (d[i - 1] === 1 && d[i] === -1 && c < e[i] && l[i] > c && h[i] === -1) return conRR("SHORT", c, l[i], 2);
      return null;
    },
  },
  {
    id: "ST_MTF_VOL",
    agente: "Agente Supertrend MTF + Volumen",
    nombre: "Supertrend MTF con volumen de ruptura",
    regla: "Igual que el Agente Supertrend MTF, y además el volumen de la vela de señal es al menos 1,5 veces el promedio de las 20 anteriores. Stop en la línea del Supertrend. Objetivo 2 R.",
    senal: (v, ind, i) => {
      const { stLinea: l, stDir: d, ema200: e, htfDir: h, volRel: x } = ind;
      if (i < 1 || !ok(l[i], d[i], d[i - 1], e[i], h[i], x[i]) || x[i] < 1.5) return null;
      const c = v[i].close;
      if (d[i - 1] === -1 && d[i] === 1 && c > e[i] && l[i] < c && h[i] === 1) return conRR("LONG", c, l[i], 2);
      if (d[i - 1] === 1 && d[i] === -1 && c < e[i] && l[i] > c && h[i] === -1) return conRR("SHORT", c, l[i], 2);
      return null;
    },
  },
  ...[
    { id: "SNR", agente: "Agente SNR", nombre: "SNR: primera visita a un nivel fresco", conHtf: false, extra: "" },
    { id: "SNR_HTF", agente: "Agente SNR + Storyline", nombre: "SNR con la tendencia del marco superior a favor", conHtf: true, extra: " y la tendencia del marco superior (Supertrend diario) va en el mismo sentido (la «storyline»)" },
  ].map(
    (f): Estrategia => ({
      id: f.id as EstrategiaId,
      agente: f.agente,
      nombre: f.nombre,
      regla: `Soportes y resistencias de un solo precio (pico y valle de la línea de cierres, y huecos entre velas del mismo color). La primera mecha que toca un nivel fresco y cierra del lado del rechazo da la entrada${f.extra}. Stop en el extremo de esa vela. Objetivo 2 R.`,
      senal: (v, ind, i) => {
        const { snrRes: r, snrSop: sp, htfDir: h } = ind;
        const c = v[i].close;
        if (i < 3 || (f.conHtf && !ok(h[i]))) return null;
        const corto = Number.isFinite(r[i]) && !Number.isFinite(sp[i]) && v[i].high > c && (!f.conHtf || h[i] === -1);
        const largo = Number.isFinite(sp[i]) && !Number.isFinite(r[i]) && v[i].low < c && (!f.conHtf || h[i] === 1);
        if (corto) return conRR("SHORT", c, v[i].high, 2);
        if (largo) return conRR("LONG", c, v[i].low, 2);
        return null;
      },
    }),
  ),
  {
    id: "TENDENCIA_LINEA",
    agente: "Agente Línea de tendencia",
    nombre: "Ruptura de una línea de tendencia (dos pivotes de 5 velas)",
    regla: "Une los dos últimos pivotes (picos, para una resistencia que baja; valles, para un soporte que sube) con una línea que el precio respeta entre ambos. Entra en el primer cierre que la pasa por 0,1 ATR: largo si rompe hacia arriba, corto si rompe hacia abajo. Stop a 1,5 ATR. Objetivo 2 R.",
    senal: (v, ind, i) => {
      const { lineaRuptura: r, atr14: t } = ind;
      if (!ok(t[i]) || r[i] === 0) return null;
      const c = v[i].close;
      if (r[i] === 1) return conRR("LONG", c, c - 1.5 * t[i], 2);
      if (r[i] === -1) return conRR("SHORT", c, c + 1.5 * t[i], 2);
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
      // Azar reproducible: depende solo del momento de la vela (su hora, o la vela misma si es más corta que una hora),
      // no de su precio ni de lo que viene. Así en 1 h y 4 h no cambia, y en 15 min o 3 min no entra por racimos de una hora.
      const paso = v.length > 1 ? Math.min(v[1].openTime - v[0].openTime, 3_600_000) : 3_600_000;
      const h = Math.sin(v[i].openTime / paso) * 10_000;
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

/**
 * Todas las operaciones de una señal por vez por moneda, con la escalera de la app: `senal(i)` decide con velas hasta la i,
 * y la entrada es la apertura de la vela siguiente. Es el recorrido común de cualquier estrategia o variante (ver operar y
 * lib/linea-busqueda.ts).
 */
export function operarSenales(id: EstrategiaId, symbol: string, v: SwingCandle[], senal: (i: number) => Senal | null, o: OpcionesEstudio): Operacion[] {
  const out: Operacion[] = [];
  let libreDesde = 0;
  for (let i = 0; i < v.length - 1; i += 1) {
    if (v[i].openTime < libreDesde) continue;
    const s = senal(i);
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
      estrategia: id,
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

/** Todas las operaciones de una estrategia en una moneda, una por vez, con la escalera de la app. */
export function operar(e: Estrategia, symbol: string, v: SwingCandle[], o: OpcionesEstudio): Operacion[] {
  const ind = indicadores(v);
  return operarSenales(e.id, symbol, v, (i) => e.senal(v, ind, i), o);
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
export type Veredicto = "VENTAJA" | "CANDIDATA" | "SIN VENTAJA" | "SIN CONCLUSIÓN";
/**
 * Una VENTAJA que no sobrevive a la auditoría de sobreajuste (lib/sobreajuste.ts) baja a CANDIDATA: pasa la regla simple,
 * pero su DSR contando todas las variantes miradas queda por debajo del 95 %. Solo la medición hacia adelante la confirma.
 */
export const DSR_MINIMO = 0.95;
export const conAuditoria = (v: Veredicto, dsrDeclarado: number | null): Veredicto =>
  v === "VENTAJA" && !(dsrDeclarado !== null && dsrDeclarado >= DSR_MINIMO) ? "CANDIDATA" : v;
export const MUESTRA_ESTUDIO = 100;

export function veredicto(m: Medicion, control: Medicion | null): Veredicto {
  if (m.operaciones < MUESTRA_ESTUDIO || !m.expectanciaIc || m.expectancia === null) return "SIN CONCLUSIÓN";
  if (m.expectanciaIc.high < 0) return "SIN VENTAJA";
  if (m.expectanciaIc.low > 0 && (!control || control.expectancia === null || m.expectancia > control.expectancia)) return "VENTAJA";
  return "SIN CONCLUSIÓN";
}
