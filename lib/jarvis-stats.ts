/**
 * Estadística de la mesa, en pura matemática sobre listas de resultados en R
 * (una operación = un número). Sin red ni estado: el backtest, el papel y la
 * araña en vivo la usan para mostrar la muestra, el intervalo y la peor caída
 * con su incertidumbre, en vez de un solo número.
 * Fórmulas publicadas (Wilson; Bailey y López de Prado para PSR y DSR; Van
 * Tharp para SQN), escritas acá: no se copió código de ninguna librería. Los
 * tests las chequean contra scipy. Describe el pasado: no garantiza nada y no
 * es asesoramiento financiero.
 */

/** Φ⁻¹(0,95): el z de un intervalo de 90 % a dos colas (igual que el resto de la app). */
export const Z90 = 1.6448536269514722;
/** Igual que MIN_SAMPLE de lib/jarvis-paper.ts (un test lo chequea). */
export const MIN_MUESTRA = 15;
const EULER = 0.5772156649015329;

export type Muestra = "SIN DATOS" | "MUESTRA MÍNIMA" | "MUESTRA RAZONABLE";

/** Función complementaria del error (Numerical Recipes, error relativo < 1,2e-7). */
function erfc(y: number): number {
  const z = Math.abs(y);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return y >= 0 ? r : 2 - r;
}

/** Distribución normal estándar Φ(x). */
export function normCdf(x: number): number {
  return 0.5 * erfc(-x / Math.SQRT2);
}

/** Inversa de la normal estándar, Φ⁻¹(p) (algoritmo de Acklam, error < 1,2e-9). */
export function normInv(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError("normInv: p tiene que estar entre 0 y 1");
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.3577518672690, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pBajo = 0.02425;
  if (p < pBajo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pBajo) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Intervalo de Wilson para una proporción (k de n). Con n chico es ancho, y así tiene que ser. */
export function wilson(k: number, n: number, z = Z90): { p: number; low: number; high: number } | null {
  if (!(n > 0) || k < 0 || k > n) return null;
  const p = k / n;
  const z2 = z * z;
  const centro = (p + z2 / (2 * n)) / (1 + z2 / n);
  const medio = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { p, low: Math.max(0, centro - medio), high: Math.min(1, centro + medio) };
}

/**
 * Wilson corregido por comparaciones múltiples (Bonferroni): si probaste N
 * reglas y reportás la mejor, el intervalo honesto es más ancho.
 */
export function wilsonCorregido(k: number, n: number, comparaciones: number, confianza = 0.9) {
  const z = normInv(1 - (1 - confianza) / (2 * Math.max(1, comparaciones)));
  return wilson(k, n, z);
}

/** Media, desvío muestral, asimetría y curtosis (con momentos poblacionales, como scipy). */
export function momentos(xs: number[]): { n: number; media: number; desvio: number; asimetria: number; curtosis: number } | null {
  const n = xs.length;
  if (n < 2) return null;
  const media = xs.reduce((s, x) => s + x, 0) / n;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const x of xs) {
    const e = x - media;
    m2 += e * e;
    m3 += e * e * e;
    m4 += e * e * e * e;
  }
  m2 /= n;
  if (m2 === 0) return null;
  const desvio = Math.sqrt((m2 * n) / (n - 1));
  return { n, media, desvio, asimetria: m3 / n / m2 ** 1.5, curtosis: m4 / n / (m2 * m2) };
}

/** Sharpe por operación (media / desvío, sin anualizar: las operaciones no tienen un ritmo fijo). */
export function sharpePorOperacion(xs: number[]): number | null {
  const m = momentos(xs);
  return m ? m.media / m.desvio : null;
}

/** SQN de Van Tharp: raíz de N por media sobre desvío. Por encima de 2 se considera un sistema aceptable. */
export function sqn(xs: number[]): number | null {
  const m = momentos(xs);
  return m ? (Math.sqrt(m.n) * m.media) / m.desvio : null;
}

/** Sortino por operación: la media sobre el desvío de las pérdidas (contra cero, dividido por N). */
export function sortinoPorOperacion(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const media = xs.reduce((s, x) => s + x, 0) / xs.length;
  const dd = Math.sqrt(xs.reduce((s, x) => s + Math.min(x, 0) ** 2, 0) / xs.length);
  return dd > 0 ? media / dd : null;
}

/** Profit factor: ganancia bruta sobre pérdida bruta. Sin pérdidas no se define: devuelve null, no infinito. */
export function profitFactor(xs: number[]): number | null {
  const gan = xs.reduce((s, x) => s + Math.max(x, 0), 0);
  const per = -xs.reduce((s, x) => s + Math.min(x, 0), 0);
  return per > 0 ? gan / per : null;
}

/** Peor caída en R (desde el pico más alto de la curva), la racha bajo el agua en operaciones y la racha perdedora. */
export function caidaMaxima(xs: number[]): { maxR: number; duracion: number; rachaPerdedora: number; finalR: number } {
  let cum = 0;
  let peak = 0;
  let maxR = 0;
  let bajo = 0;
  let maxBajo = 0;
  let racha = 0;
  let maxRacha = 0;
  for (const x of xs) {
    cum += x;
    racha = x < 0 ? racha + 1 : 0;
    maxRacha = Math.max(maxRacha, racha);
    if (cum >= peak) {
      peak = cum;
      bajo = 0;
    } else {
      bajo += 1;
      maxBajo = Math.max(maxBajo, bajo);
      maxR = Math.max(maxR, peak - cum);
    }
  }
  return { maxR, duracion: maxBajo, rachaPerdedora: maxRacha, finalR: cum };
}

/** Generador pseudoaleatorio xorshift32: mismo resultado en cada corrida (los tests y la app no dependen del azar). */
export function generadorAzar(semilla: number): () => number {
  let x = semilla >>> 0 || 2463534242;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

/**
 * Intervalo de confianza por bootstrap de bloques circulares: remuestrea
 * tramos seguidos de operaciones, así que respeta que las operaciones vecinas
 * no son independientes. Devuelve null si el estadístico no se puede calcular.
 */
export function intervaloBootstrap(
  xs: number[],
  estadistico: (s: number[]) => number | null,
  opts: { iteraciones?: number; bloque?: number; semilla?: number; confianza?: number } = {},
): { low: number; high: number; iteraciones: number } | null {
  const n = xs.length;
  if (n < 2) return null;
  const iter = opts.iteraciones ?? 2000;
  const L = Math.min(n, Math.max(1, opts.bloque ?? Math.round(Math.sqrt(n))));
  const azar = generadorAzar(opts.semilla ?? 7);
  const vals: number[] = [];
  for (let k = 0; k < iter; k += 1) {
    const s: number[] = [];
    while (s.length < n) {
      const ini = Math.floor(azar() * n);
      for (let j = 0; j < L && s.length < n; j += 1) s.push(xs[(ini + j) % n]);
    }
    const v = estadistico(s);
    if (v !== null && Number.isFinite(v)) vals.push(v);
  }
  if (vals.length < iter / 2) return null;
  vals.sort((a, b) => a - b);
  const a = (1 - (opts.confianza ?? 0.9)) / 2;
  const pos = (q: number) => vals[Math.min(vals.length - 1, Math.max(0, Math.floor(q * (vals.length - 1))))];
  return { low: pos(a), high: pos(1 - a), iteraciones: vals.length };
}

/**
 * Peor caída simulada: baraja las mismas operaciones (con reposición) y mira
 * cuánto cae la curva en cada orden posible. Responde «si el orden hubiera sido
 * otro, ¿cuánto podía caer?». p95 = en 5 de cada 100 órdenes cae más que eso.
 */
export function caidaSimulada(xs: number[], opts: { simulaciones?: number; semilla?: number } = {}): { mediana: number; p95: number } | null {
  const n = xs.length;
  if (n < 2) return null;
  const sims = opts.simulaciones ?? 2000;
  const azar = generadorAzar(opts.semilla ?? 11);
  const caidas: number[] = [];
  for (let k = 0; k < sims; k += 1) {
    const s: number[] = [];
    for (let j = 0; j < n; j += 1) s.push(xs[Math.floor(azar() * n)]);
    caidas.push(caidaMaxima(s).maxR);
  }
  caidas.sort((a, b) => a - b);
  return { mediana: caidas[Math.floor(0.5 * (sims - 1))], p95: caidas[Math.floor(0.95 * (sims - 1))] };
}

/**
 * Probabilistic Sharpe Ratio (Bailey y López de Prado, 2012): la probabilidad
 * de que el Sharpe verdadero, por operación, supere `referencia`, dados el
 * tamaño de la muestra, la asimetría y la curtosis (normal = 3).
 */
export function psr(sr: number, n: number, asimetria: number, curtosis: number, referencia = 0): number | null {
  if (n < 3) return null;
  const denom = 1 - asimetria * sr + ((curtosis - 1) / 4) * sr * sr;
  if (!(denom > 0)) return null;
  return normCdf(((sr - referencia) * Math.sqrt(n - 1)) / Math.sqrt(denom));
}

/**
 * Sharpe que se esperaría solo por azar después de probar N reglas (Deflated
 * Sharpe, mismos autores). Necesita el Sharpe de cada regla que se vio: si
 * probaste 300 y elegiste la mejor, el umbral sube. Si probaste más reglas de
 * las que tenés a la vista, pasá el total en `pruebas` (la varianza sale de las
 * que se ven). Con menos de dos reglas no se puede calcular: devuelve null.
 */
export function sharpeDeAzar(srVariantes: number[], pruebas = srVariantes.length): number | null {
  const vistas = srVariantes.length;
  const N = Math.max(pruebas, vistas);
  if (vistas < 2 || N < 2) return null;
  const media = srVariantes.reduce((s, x) => s + x, 0) / vistas;
  const varianza = srVariantes.reduce((s, x) => s + (x - media) ** 2, 0) / (vistas - 1);
  return Math.sqrt(varianza) * ((1 - EULER) * normInv(1 - 1 / N) + EULER * normInv(1 - 1 / (N * Math.E)));
}

export type EvaluacionEstrategia = {
  n: number;
  ganadas: number;
  perdidas: number;
  muestra: Muestra;
  winRate: { p: number; low: number; high: number } | null;
  /** Mismo intervalo corrigido por cuántas variantes se probaron (Bonferroni). Null si no se informó el número. */
  winRateCorregido: { low: number; high: number } | null;
  expectativaR: number | null;
  expectativaIC90: { low: number; high: number } | null;
  profitFactor: number | null;
  profitFactorIC90: { low: number; high: number } | null;
  sharpe: number | null;
  sortino: number | null;
  sqn: number | null;
  caida: { maxR: number; duracion: number; rachaPerdedora: number; finalR: number } | null;
  caidaSimulada: { mediana: number; p95: number } | null;
  /** Probabilidad de que el Sharpe sea mayor que cero, dada la muestra. */
  psr0: number | null;
  /** Probabilidad de que el Sharpe supere el azar de haber probado `variantes` reglas. Null si no hay variantes. */
  dsr: number | null;
  variantes: number;
};

/**
 * Todo lo anterior junto para una lista de operaciones cerradas en R, en orden
 * de cierre. `variantesSr` es el Sharpe por operación de cada regla que se probó
 * (incluida la elegida); sin él no hay corrección por azar y lo dice.
 */
export function evaluarEstrategia(xs: number[], variantesSr: number[] = []): EvaluacionEstrategia {
  const n = xs.length;
  const ganadas = xs.filter((x) => x > 0).length;
  const perdidas = xs.filter((x) => x < 0).length;
  const m = momentos(xs);
  const sr = m ? m.media / m.desvio : null;
  const muestra: Muestra = n === 0 ? "SIN DATOS" : n < MIN_MUESTRA ? "MUESTRA MÍNIMA" : "MUESTRA RAZONABLE";
  const w = wilson(ganadas, n);
  const wc = variantesSr.length > 1 ? wilsonCorregido(ganadas, n, variantesSr.length) : null;
  const expIc = intervaloBootstrap(xs, (s) => (s.length ? s.reduce((a, x) => a + x, 0) / s.length : null));
  const pfIc = intervaloBootstrap(xs, profitFactor);
  const dAzar = variantesSr.length > 1 ? sharpeDeAzar(variantesSr) : null;
  return {
    n,
    ganadas,
    perdidas,
    muestra,
    winRate: w,
    winRateCorregido: wc ? { low: wc.low, high: wc.high } : null,
    expectativaR: n ? xs.reduce((a, x) => a + x, 0) / n : null,
    expectativaIC90: expIc ? { low: expIc.low, high: expIc.high } : null,
    profitFactor: profitFactor(xs),
    profitFactorIC90: pfIc ? { low: pfIc.low, high: pfIc.high } : null,
    sharpe: sr,
    sortino: sortinoPorOperacion(xs),
    sqn: sqn(xs),
    caida: n ? caidaMaxima(xs) : null,
    caidaSimulada: caidaSimulada(xs),
    psr0: m && sr !== null ? psr(sr, n, m.asimetria, m.curtosis, 0) : null,
    dsr: m && sr !== null && dAzar !== null ? psr(sr, n, m.asimetria, m.curtosis, dAzar) : null,
    variantes: variantesSr.length,
  };
}
