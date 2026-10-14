/**
 * Auditoría de sobreajuste: cuánto de un buen resultado puede ser suerte por haber probado muchas variantes.
 * PSR y DSR (Bailey y López de Prado): probabilidad de que el Sharpe real supere una referencia, descontando la
 * asimetría, la curtosis y, en el DSR, el máximo esperado por azar entre N ensayos. Reality Check de White y SPA de
 * Hansen con bootstrap estacionario: ¿alguna de las K variantes le gana a cero después de buscar entre todas? Pura.
 */

/** Función de distribución normal estándar (Abramowitz-Stegun 7.1.26 sobre erf, error < 1,5e-7). */
export function normCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Inversa de la normal estándar (Acklam, error relativo < 1,2e-9). */
export function normInv(p: number): number {
  if (!(p > 0 && p < 1)) return p <= 0 ? -Infinity : Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -normInv(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export type Momentos = { n: number; media: number; desvio: number; sharpe: number; asimetria: number; curtosis: number };

/** Media, desvío (muestral), Sharpe por observación, asimetría y curtosis (no en exceso: la normal da 3). */
export function momentos(x: number[]): Momentos | null {
  const n = x.length;
  if (n < 3) return null;
  const media = x.reduce((s, v) => s + v, 0) / n;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const v of x) {
    const d = v - media;
    m2 += d * d;
    m3 += d * d * d;
    m4 += d * d * d * d;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;
  if (!(m2 > 0)) return null;
  const desvio = Math.sqrt((m2 * n) / (n - 1));
  return { n, media, desvio, sharpe: media / desvio, asimetria: m3 / m2 ** 1.5, curtosis: m4 / (m2 * m2) };
}

/**
 * Probabilistic Sharpe Ratio: probabilidad de que el Sharpe verdadero supere `referencia`, dada la muestra
 * (Sharpe por observación, sin anualizar). Descuenta colas gordas y asimetría.
 */
export function psr(m: Momentos, referencia = 0): number {
  const sr = m.sharpe;
  const den = 1 - m.asimetria * sr + ((m.curtosis - 1) / 4) * sr * sr;
  if (!(den > 0)) return Number.NaN;
  return normCdf(((sr - referencia) * Math.sqrt(m.n - 1)) / Math.sqrt(den));
}

const EULER = 0.5772156649015329;

/** El Sharpe máximo que se espera solo por azar al elegir el mejor de N ensayos sin ventaja, con varianza V entre ellos. */
export function sharpeMaximoEsperado(ensayos: number, varianza: number): number {
  if (!(ensayos > 1) || !(varianza > 0)) return 0;
  return Math.sqrt(varianza) * ((1 - EULER) * normInv(1 - 1 / ensayos) + EULER * normInv(1 - 1 / (ensayos * Math.E)));
}

/** Deflated Sharpe Ratio: el PSR contra el máximo esperado por azar entre `ensayos` variantes. */
export function dsr(m: Momentos, ensayos: number, varianzaSharpes: number): number {
  return psr(m, sharpeMaximoEsperado(ensayos, varianzaSharpes));
}

/** Generador determinista (mulberry32): el mismo resultado en cada corrida. */
export function azarFijo(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Índices de un remuestreo estacionario (Politis y Romano): bloques de largo geométrico con media `bloque`. */
export function indicesEstacionarios(T: number, bloque: number, rnd: () => number): number[] {
  const p = 1 / Math.max(1, bloque);
  const out = new Array<number>(T);
  let i = Math.floor(rnd() * T);
  for (let t = 0; t < T; t += 1) {
    if (t > 0) i = rnd() < p ? Math.floor(rnd() * T) : (i + 1) % T;
    out[t] = i;
  }
  return out;
}

export type PruebaMultiple = {
  variantes: number;
  periodos: number;
  /** p-valor del Reality Check de White: ¿la mejor variante le gana a cero, contando que se eligió entre todas? */
  pRealityCheck: number;
  /** p-valor del SPA de Hansen (consistente, estudentizado): menos sensible a variantes malas que suman ruido. */
  pSpa: number;
};

/**
 * Reality Check y SPA sobre una matriz de resultados por período: `columnas[k][t]` es el resultado de la variante k
 * en el período t, en exceso sobre la referencia (aquí, no operar = 0). Todas las columnas del mismo largo.
 */
export function pruebaMultiple(columnas: number[][], opts: { remuestreos?: number; bloque?: number; semilla?: number } = {}): PruebaMultiple | null {
  const K = columnas.length;
  const T = K ? columnas[0].length : 0;
  if (K === 0 || T < 10 || columnas.some((c) => c.length !== T)) return null;
  const B = opts.remuestreos ?? 2000;
  const bloque = opts.bloque ?? 10;
  const rnd = azarFijo(opts.semilla ?? 7);
  const medias = columnas.map((c) => c.reduce((s, v) => s + v, 0) / T);
  const raiz = Math.sqrt(T);
  // Medias remuestreadas: el desvío de cada variante sale del bootstrap (Hansen), que respeta la autocorrelación.
  const mb: Float64Array[] = columnas.map(() => new Float64Array(B));
  for (let b = 0; b < B; b += 1) {
    const idx = indicesEstacionarios(T, bloque, rnd);
    for (let k = 0; k < K; k += 1) {
      const c = columnas[k];
      let s = 0;
      for (let t = 0; t < T; t += 1) s += c[idx[t]];
      mb[k][b] = s / T;
    }
  }
  const desvios = mb.map((serie, k) => Math.sqrt(serie.reduce((s, v) => s + T * (v - medias[k]) ** 2, 0) / B) || 1e-12);
  const vRc = Math.max(...medias.map((m) => raiz * m));
  const vSpa = Math.max(0, ...medias.map((m, k) => (raiz * m) / desvios[k]));
  // SPA consistente: las variantes claramente por debajo de cero quedan centradas en su media y no suman ruido.
  const umbral = Math.sqrt(2 * Math.log(Math.log(T)));
  const centro = medias.map((m, k) => ((raiz * m) / desvios[k] >= -umbral ? m : 0));
  let rc = 0;
  let spa = 0;
  for (let b = 0; b < B; b += 1) {
    let maxRc = -Infinity;
    let maxSpa = 0;
    for (let k = 0; k < K; k += 1) {
      maxRc = Math.max(maxRc, raiz * (mb[k][b] - medias[k]));
      maxSpa = Math.max(maxSpa, (raiz * (mb[k][b] - centro[k])) / desvios[k]);
    }
    if (maxRc >= vRc) rc += 1;
    if (maxSpa >= vSpa) spa += 1;
  }
  return { variantes: K, periodos: T, pRealityCheck: rc / B, pSpa: spa / B };
}
