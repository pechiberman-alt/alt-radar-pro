/**
 * Modelos chicos y sin dependencias para la investigación del aprendizaje: regresión ridge, regresión logística con L2,
 * árboles potenciados poco profundos y AUC. Nada de esto corre en la app.
 */

/** Resuelve A x = b para A simétrica definida positiva (Cholesky). */
export function resolverSPD(A: number[][], b: number[]): number[] {
  const n = b.length;
  const L = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) L[i][i] = Math.sqrt(Math.max(s, 1e-12));
      else L[i][j] = s / L[j][j];
    }
  }
  const z = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * z[k];
    z[i] = s / L[i][i];
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = z[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

export type Escala = { media: number[]; desvio: number[] };
export function ajustarEscala(X: number[][]): Escala {
  const d = X[0].length;
  const media = new Array<number>(d).fill(0);
  const desvio = new Array<number>(d).fill(0);
  for (const r of X) for (let j = 0; j < d; j++) media[j] += r[j];
  for (let j = 0; j < d; j++) media[j] /= X.length;
  for (const r of X) for (let j = 0; j < d; j++) desvio[j] += (r[j] - media[j]) ** 2;
  for (let j = 0; j < d; j++) desvio[j] = Math.sqrt(desvio[j] / X.length) || 1;
  return { media, desvio };
}
export const escalar = (r: number[], e: Escala) => r.map((v, j) => (v - e.media[j]) / e.desvio[j]);

export type Lineal = { escala: Escala; w: number[]; b: number };

/** Ridge sobre datos estandarizados (la constante no se penaliza). */
export function ajustarRidge(X: number[][], y: number[], lambda: number): Lineal {
  const escala = ajustarEscala(X);
  const d = X[0].length;
  const A = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  const rhs = new Array<number>(d).fill(0);
  const my = y.reduce((a, v) => a + v, 0) / y.length;
  for (let i = 0; i < X.length; i++) {
    const z = escalar(X[i], escala);
    for (let a = 0; a < d; a++) {
      rhs[a] += z[a] * (y[i] - my);
      for (let c = 0; c <= a; c++) A[a][c] += z[a] * z[c];
    }
  }
  for (let a = 0; a < d; a++) {
    for (let c = a + 1; c < d; c++) A[a][c] = A[c][a];
    A[a][a] += lambda;
  }
  return { escala, w: resolverSPD(A, rhs), b: my };
}
export const predecirLineal = (m: Lineal, x: number[]) => escalar(x, m.escala).reduce((s, v, j) => s + v * m.w[j], m.b);

const sigmoide = (z: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

/** Logística con L2 (Newton) sobre datos estandarizados (la constante no se penaliza). */
export function ajustarLogistica(X: number[][], y: number[], lambda: number, iteraciones = 25): Lineal {
  const escala = ajustarEscala(X);
  const d = X[0].length;
  const Z = X.map((r) => escalar(r, escala));
  const w = new Array<number>(d).fill(0);
  const p0 = y.reduce((a, v) => a + v, 0) / y.length;
  let b = Math.log(p0 / (1 - p0));
  for (let it = 0; it < iteraciones; it++) {
    const g = new Array<number>(d + 1).fill(0);
    const Hs = Array.from({ length: d + 1 }, () => new Array<number>(d + 1).fill(0));
    for (let i = 0; i < Z.length; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * Z[i][j];
      const p = sigmoide(z);
      const e = p - y[i];
      const s = p * (1 - p);
      g[0] += e;
      for (let a = 0; a < d; a++) {
        g[a + 1] += e * Z[i][a];
        Hs[0][a + 1] += s * Z[i][a];
        for (let c = 0; c <= a; c++) Hs[a + 1][c + 1] += s * Z[i][a] * Z[i][c];
      }
      Hs[0][0] += s;
    }
    for (let a = 0; a < d; a++) {
      g[a + 1] += lambda * w[a];
      Hs[a + 1][a + 1] += lambda;
    }
    for (let a = 0; a <= d; a++) for (let c = a + 1; c <= d; c++) Hs[a][c] = Hs[c][a];
    Hs[0][0] += 1e-6;
    const paso = resolverSPD(Hs, g);
    let mx = 0;
    b -= paso[0];
    for (let j = 0; j < d; j++) {
      w[j] -= paso[j + 1];
      mx = Math.max(mx, Math.abs(paso[j + 1]));
    }
    if (mx < 1e-6) break;
  }
  return { escala, w, b };
}
export const predecirLogistica = (m: Lineal, x: number[]) => sigmoide(predecirLineal(m, x));

/** Área bajo la curva ROC: probabilidad de que un positivo al azar puntúe más que un negativo al azar (0,5 = azar). */
export function auc(puntaje: number[], y: number[]): number {
  const idx = puntaje.map((_, i) => i).sort((a, b) => puntaje[a] - puntaje[b]);
  let rango = 1;
  let sumaPos = 0;
  let nPos = 0;
  for (let k = 0; k < idx.length; ) {
    let j = k;
    while (j + 1 < idx.length && puntaje[idx[j + 1]] === puntaje[idx[k]]) j++;
    const medio = (rango + (rango + (j - k))) / 2;
    for (let q = k; q <= j; q++) {
      if (y[idx[q]] === 1) {
        sumaPos += medio;
        nPos++;
      }
    }
    rango += j - k + 1;
    k = j + 1;
  }
  const nNeg = y.length - nPos;
  return nPos && nNeg ? (sumaPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg) : 0.5;
}

export const cuantil = (a: number[], q: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))];
};

// ── Árboles potenciados (pérdida cuadrática, árboles poco profundos, cortes por histograma) ──

type Nodo = { f: number; b: number; l: Nodo; r: Nodo } | { v: number };
export type Arboles = { base: number; lr: number; arboles: Nodo[]; bordes: number[][] };

function bordesDe(X: number[][], cajas: number): number[][] {
  const d = X[0].length;
  const out: number[][] = [];
  for (let j = 0; j < d; j++) {
    const col = X.map((r) => r[j]).sort((a, b) => a - b);
    const e: number[] = [];
    for (let k = 1; k < cajas; k++) {
      const v = col[Math.floor((k * col.length) / cajas)];
      if (!e.length || v > e[e.length - 1]) e.push(v);
    }
    out.push(e);
  }
  return out;
}
const cajaDe = (v: number, e: number[]) => {
  let lo = 0;
  let hi = e.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (v < e[m]) hi = m;
    else lo = m + 1;
  }
  return lo;
};

export type OpcionesArboles = { rondas: number; profundidad: number; lr: number; minHoja: number; submuestra: number; cajas?: number; semilla?: number };

export function ajustarArboles(X: number[][], y: number[], o: OpcionesArboles): Arboles {
  const n = X.length;
  const d = X[0].length;
  const bordes = bordesDe(X, o.cajas ?? 32);
  const B = X.map((r) => r.map((v, j) => cajaDe(v, bordes[j])));
  const base = y.reduce((a, v) => a + v, 0) / n;
  const pred = new Array<number>(n).fill(base);
  let semilla = o.semilla ?? 12345;
  const azar = () => (semilla = (semilla * 1664525 + 1013904223) >>> 0) / 4294967296;
  const arboles: Nodo[] = [];
  for (let t = 0; t < o.rondas; t++) {
    const res = y.map((v, i) => v - pred[i]);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) if (azar() < o.submuestra) idx.push(i);
    const crecer = (ids: number[], prof: number): Nodo => {
      const suma = ids.reduce((a, i) => a + res[i], 0);
      const hoja = ids.length ? suma / (ids.length + 20) : 0; // valor de hoja achicado
      if (prof === 0 || ids.length < 2 * o.minHoja) return { v: hoja };
      let mejor = { ganancia: 1e-12, f: -1, b: -1 };
      for (let j = 0; j < d; j++) {
        const nb = bordes[j].length + 1;
        const cuenta = new Array<number>(nb).fill(0);
        const sumas = new Array<number>(nb).fill(0);
        for (const i of ids) {
          cuenta[B[i][j]]++;
          sumas[B[i][j]] += res[i];
        }
        let cl = 0;
        let sl = 0;
        for (let b = 0; b < nb - 1; b++) {
          cl += cuenta[b];
          sl += sumas[b];
          const cr = ids.length - cl;
          const sr = suma - sl;
          if (cl < o.minHoja || cr < o.minHoja) continue;
          const ganancia = (sl * sl) / cl + (sr * sr) / cr - (suma * suma) / ids.length;
          if (ganancia > mejor.ganancia) mejor = { ganancia, f: j, b };
        }
      }
      if (mejor.f < 0) return { v: hoja };
      const L: number[] = [];
      const R: number[] = [];
      for (const i of ids) (B[i][mejor.f] <= mejor.b ? L : R).push(i);
      return { f: mejor.f, b: mejor.b, l: crecer(L, prof - 1), r: crecer(R, prof - 1) };
    };
    const arbol = crecer(idx, o.profundidad);
    arboles.push(arbol);
    const caminar = (nd: Nodo, fila: number[]): number => ("v" in nd ? nd.v : caminar(fila[nd.f] <= nd.b ? nd.l : nd.r, fila));
    for (let i = 0; i < n; i++) pred[i] += o.lr * caminar(arbol, B[i]);
  }
  return { base, lr: o.lr, arboles, bordes };
}

export function predecirArboles(m: Arboles, x: number[]): number {
  const fila = x.map((v, j) => cajaDe(v, m.bordes[j]));
  const caminar = (nd: Nodo): number => ("v" in nd ? nd.v : caminar(fila[nd.f] <= nd.b ? nd.l : nd.r));
  let s = m.base;
  for (const t of m.arboles) s += m.lr * caminar(t);
  return s;
}
