/**
 * ¿Puede la mesa aprender? Arma un punto por cada decisión de la mesa (reglas v2) con lo que veía y lo que pasó después,
 * entrena modelos «hacia adelante» (cada trimestre solo con operaciones ya resueltas antes de esa fecha) y mide si
 * ordenan mejor las operaciones que la mesa sola. Resultado y lectura: docs/mesa-aprendizaje.md.
 *
 *   node --experimental-strip-types scripts/investigacion/aprendizaje.ts            # modelos hacia adelante
 *   node --experimental-strip-types scripts/investigacion/aprendizaje.ts --cortes   # cortes por consenso, stop, TP1, régimen, lado, tendencia
 *
 * Nada de esto cambia las reglas de la mesa: es una medición. Antes: datos.py y precalcular.ts 1h.
 */
import { etiquetarTodas, lecturas, V2, type Lectura, type Params, type Plan } from "./simulador.ts";
import {
  ajustarArboles, ajustarLogistica, ajustarRidge, auc, cuantil, predecirArboles, predecirLineal, predecirLogistica,
} from "./modelos.ts";
import { MONEDAS, perfilDe } from "./util.ts";

export const DATOS_DEL_MODELO = [
  "cons", "agree", "disagree", "tec", "est", "vol",
  "regC", "regE", "align", "t1", "t4", "td",
  "rsi1", "rsi4", "rsiD", "e20", "e50", "e200", "sma200",
  "vr1", "vr4", "ch24", "lbDir", "lbRecent",
  "limit", "stopAtr", "rr", "tp1R", "btcCons", "btcT4", "btcExp",
  "runLog", "fresh", "mom6", "mom18",
] as const;
type Dato = (typeof DATOS_DEL_MODELO)[number];

const acotar = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Cuántas lecturas seguidas (esta incluida, hasta 24) el consenso ya apuntaba a este lado con el mínimo de la mesa. */
export function antiguedadDeSenal(sg: number, previas: Lectura[]): number {
  let n = 1;
  for (let k = previas.length - 1; k >= 0 && n < 24; k--) {
    if (sg * previas[k].c[0] >= 0.3) n++;
    else break;
  }
  return n;
}

/** Los 35 datos de una decisión, todos «a favor del lado del plan» (+) o «en contra» (−). Solo lo que se veía al decidir. */
export function datosDe(s: Lectura, pl: Plan, btc: Lectura | undefined, previas: Lectura[]): number[] {
  const sg = pl.side === "LONG" ? 1 : -1;
  const tr = (x: string | undefined) => (x === "ALCISTA" ? sg : x === "BAJISTA" ? -sg : 0);
  const atr = s.atr;
  const ema = (v: number | null | undefined) => (v === null || v === undefined ? 0 : sg * acotar((s.p - v) / atr, -6, 6));
  const rsi = (v: number | null | undefined) => (v === null || v === undefined ? 0 : (sg * (v - 50)) / 25);
  const dist1 = Math.abs(pl.tp[0] - pl.entry) / Math.abs(pl.entry - pl.stop);
  const sma = s.ema[3] ?? s.ema[2];
  const lb = s.lb;
  const edad = antiguedadDeSenal(sg, previas);
  const d: Record<Dato, number> = {
    cons: sg * s.c[0],
    agree: pl.side === "LONG" ? s.c[2] : s.c[3],
    disagree: pl.side === "LONG" ? s.c[3] : s.c[2],
    tec: sg * (s.ses.tecnico ?? 0),
    est: sg * (s.ses.estructura ?? 0),
    vol: sg * (s.ses.volumen ?? 0),
    regC: s.reg === "COMPRIMIDA" ? 1 : 0,
    regE: s.reg === "EXPANDIDA" ? 1 : 0,
    align: tr(s.al),
    t1: tr(s.tf["1h"]),
    t4: tr(s.tf["4h"]),
    td: tr(s.tf["1d"]),
    rsi1: rsi(s.rsi[0]),
    rsi4: rsi(s.rsi[1]),
    rsiD: rsi(s.rsi[2]),
    e20: ema(s.ema[0]),
    e50: ema(s.ema[1]),
    e200: ema(s.ema[2]),
    sma200: sma === null || sma === undefined ? 0 : sg * acotar(((s.p - sma) / sma) * 5, -3, 3),
    vr1: s.vr[0] === null ? 0 : acotar(Math.log(Math.max(0.05, s.vr[0]!)), -2.5, 2.5),
    vr4: s.vr[1] === null ? 0 : acotar(Math.log(Math.max(0.05, s.vr[1]!)), -2.5, 2.5),
    ch24: s.ch24 === null ? 0 : sg * acotar(s.ch24 * 15, -3, 3),
    lbDir: lb ? (lb[0] === "ALCISTA" ? sg : -sg) : 0,
    lbRecent: lb ? Math.exp(-lb[1] / 12) : 0,
    limit: pl.limit ? 1 : 0,
    stopAtr: acotar(pl.stopAtr, 0, 4),
    rr: acotar(pl.rr, 1, 6),
    tp1R: acotar(dist1, 0.5, 4),
    btcCons: btc ? sg * btc.c[0] : sg * s.c[0],
    btcT4: tr(btc ? btc.tf["4h"] : s.tf["4h"]),
    btcExp: (btc ?? s).reg === "EXPANDIDA" ? 1 : 0,
    runLog: Math.log(1 + edad) / Math.log(25),
    fresh: edad === 1 ? 1 : 0,
    mom6: previas.length >= 6 ? sg * acotar((s.p - previas[previas.length - 6].p) / atr, -8, 8) : 0,
    mom18: previas.length >= 18 ? sg * acotar((s.p - previas[previas.length - 18].p) / atr, -15, 15) : 0,
  };
  return DATOS_DEL_MODELO.map((k) => d[k]);
}

export type Punto = { sym: string; t: number; side: "LONG" | "SHORT"; /** llegó al TP1 */ y: number; /** resultado neto en R */ r: number; /** cuándo se resolvió */ fin: number; x: number[]; limit: number };

/** Un punto por cada decisión con plan (se solapan en el tiempo: no son independientes). Las órdenes límite que no se llenan no cuentan. */
export function armarPuntos(P: Params = V2): Punto[] {
  const p = perfilDe("1h");
  const btc = new Map<number, Lectura>(lecturas("BTCUSDT", p).map((s) => [s.t, s]));
  const out: Punto[] = [];
  for (const sym of MONEDAS) {
    const ls = lecturas(sym, p);
    for (const e of etiquetarTodas(sym, ls, P, -Infinity, Infinity, p)) {
      if (e.res.cancelled) continue;
      const s = ls[e.i];
      out.push({ sym, t: e.t, side: e.side, y: e.res.exits.includes("TP1") ? 1 : 0, r: e.res.r, fin: e.res.end, x: datosDe(s, e.pl, btc.get(s.t), ls.slice(Math.max(0, e.i - 24), e.i)), limit: e.pl.limit ? 1 : 0 });
    }
  }
  return out.sort((a, b) => a.t - b.t || a.sym.localeCompare(b.sym));
}

const T = (y: number, m: number) => Date.UTC(y, m - 1, 1);
/** DESARROLLO: 2022-07 → 2025-06 (se elige el modelo). FINAL: 2025-07 → 2026-09 (se mira una sola vez). */
export const DESARROLLO: [number, number] = [T(2022, 7), T(2025, 7)];
export const FINAL: [number, number] = [T(2025, 7), T(2026, 10)];

export type ModeloId = { tipo: "logistica" | "ridge" | "arboles"; objetivo: "tp1" | "r"; lambda?: number; arboles?: { rondas: number; profundidad: number; lr: number; minHoja: number; submuestra: number } };

/**
 * Predicción fuera de muestra de cada punto entre `desde` y `hasta`: cada trimestre se entrena solo con puntos ya
 * resueltos antes de que empiece (`fin < inicio del trimestre`), así que ningún dato del futuro entra al modelo.
 */
export function haciaAdelante(puntos: Punto[], m: ModeloId, desde: number, hasta: number): number[] {
  const pred = new Array<number>(puntos.length).fill(NaN);
  for (let a = desde; a < hasta; ) {
    const d = new Date(a);
    const b = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1);
    const train = puntos.filter((p) => p.fin < a);
    if (train.length >= 1500) {
      const X = train.map((p) => p.x);
      const Y = train.map((p) => (m.objetivo === "tp1" ? p.y : p.r));
      const f =
        m.tipo === "arboles"
          ? ((mod) => (x: number[]) => predecirArboles(mod, x))(ajustarArboles(X, Y, m.arboles!))
          : m.tipo === "ridge"
            ? ((mod) => (x: number[]) => predecirLineal(mod, x))(ajustarRidge(X, Y, m.lambda!))
            : ((mod) => (x: number[]) => predecirLogistica(mod, x))(ajustarLogistica(X, Y, m.lambda!));
      puntos.forEach((p, i) => {
        if (p.t >= a && p.t < Math.min(b, hasta)) pred[i] = f(p.x);
      });
    }
    a = b;
  }
  return pred;
}

export function evaluar(puntos: Punto[], pred: number[], rango: [number, number]) {
  const idx = puntos.map((_, i) => i).filter((i) => !Number.isNaN(pred[i]) && puntos[i].t >= rango[0] && puntos[i].t < rango[1]);
  const sc = idx.map((i) => pred[i]);
  const med = cuantil(sc, 0.5);
  const media = (ix: number[]) => ix.reduce((s, i) => s + puntos[i].r, 0) / Math.max(1, ix.length);
  return {
    n: idx.length,
    auc: auc(sc, idx.map((i) => puntos[i].y)),
    mitadAlta: media(idx.filter((i) => pred[i] >= med)),
    mitadBaja: media(idx.filter((i) => pred[i] < med)),
  };
}

const SEMANA = 7 * 86_400_000;

/**
 * «Mitad alta menos mitad baja» (resultado medio en R) con un intervalo del 90%. Se remuestrean semanas enteras, no
 * operaciones sueltas: las de una misma semana se parecen entre sí y las monedas se mueven juntas, así que contarlas como
 * independientes daría un intervalo demasiado angosto.
 */
export function diferenciaConIntervalo(puntos: Punto[], pred: number[], rango: [number, number], repeticiones = 500, semilla = 7) {
  const idx = puntos.map((_, i) => i).filter((i) => !Number.isNaN(pred[i]) && puntos[i].t >= rango[0] && puntos[i].t < rango[1]);
  const med = cuantil(idx.map((i) => pred[i]), 0.5);
  const porSemana = new Map<number, { sa: number; na: number; sb: number; nb: number }>();
  for (const i of idx) {
    const k = Math.floor(puntos[i].t / SEMANA);
    const g = porSemana.get(k) ?? { sa: 0, na: 0, sb: 0, nb: 0 };
    if (pred[i] >= med) {
      g.sa += puntos[i].r;
      g.na += 1;
    } else {
      g.sb += puntos[i].r;
      g.nb += 1;
    }
    porSemana.set(k, g);
  }
  const semanas = [...porSemana.values()];
  const dif = (gs: typeof semanas) => {
    const t = gs.reduce((a, g) => ({ sa: a.sa + g.sa, na: a.na + g.na, sb: a.sb + g.sb, nb: a.nb + g.nb }), { sa: 0, na: 0, sb: 0, nb: 0 });
    return t.sa / Math.max(1, t.na) - t.sb / Math.max(1, t.nb);
  };
  let estado = semilla >>> 0;
  const azar = () => (estado = (estado * 1664525 + 1013904223) >>> 0) / 4294967296;
  const muestras = Array.from({ length: repeticiones }, () => dif(Array.from(semanas, () => semanas[Math.floor(azar() * semanas.length)]))).sort((a, b) => a - b);
  return { dif: dif(semanas), bajo: muestras[Math.floor(0.05 * repeticiones)], alto: muestras[Math.floor(0.95 * repeticiones)], semanas: semanas.length };
}

export const MODELOS: ModeloId[] = [
  { tipo: "logistica", objetivo: "tp1", lambda: 100 },
  { tipo: "logistica", objetivo: "tp1", lambda: 10000 },
  { tipo: "ridge", objetivo: "r", lambda: 300 },
  { tipo: "ridge", objetivo: "r", lambda: 3000 },
  { tipo: "arboles", objetivo: "tp1", arboles: { rondas: 80, profundidad: 2, lr: 0.05, minHoja: 300, submuestra: 0.5 } },
  { tipo: "arboles", objetivo: "r", arboles: { rondas: 80, profundidad: 2, lr: 0.05, minHoja: 300, submuestra: 0.5 } },
  { tipo: "arboles", objetivo: "r", arboles: { rondas: 200, profundidad: 3, lr: 0.03, minHoja: 300, submuestra: 0.5 } },
];

function cortes(puntos: Punto[]) {
  const ix = (n: Dato) => DATOS_DEL_MODELO.indexOf(n);
  const win = (p: Punto) => (p.t >= Date.UTC(2025, 6, 1) ? "2025-07 → 2026-09" : p.t >= Date.UTC(2024, 1, 15) ? "2024-02 → 2025-06" : "2021-01 → 2024-02");
  const pf = (v: number[]) => {
    const g = v.filter((x) => x > 0).reduce((x, y) => x + y, 0);
    const l = -v.filter((x) => x < 0).reduce((x, y) => x + y, 0);
    return l ? g / l : Infinity;
  };
  const tabla = (titulo: string, clave: (p: Punto) => string, orden: string[]) => {
    console.log(`\n${titulo}`);
    for (const w of ["2021-01 → 2024-02", "2024-02 → 2025-06", "2025-07 → 2026-09", "todo"]) {
      const cols = orden.map((b) => {
        const rs = puntos.filter((p) => (w === "todo" || win(p) === w) && clave(p) === b).map((p) => p.r);
        const m = rs.reduce((a, v) => a + v, 0) / Math.max(1, rs.length);
        return `${b}: n=${rs.length} E=${m >= 0 ? "+" : ""}${m.toFixed(3)} PF=${pf(rs).toFixed(2)}`;
      });
      console.log(`${w.padEnd(18)} ${cols.join(" | ")}`);
    }
  };
  tabla("por consenso a favor", (p) => { const c = p.x[ix("cons")]; return c < 0.4 ? "0,30-0,40" : c < 0.5 ? "0,40-0,50" : c < 0.6 ? "0,50-0,60" : "0,60+"; }, ["0,30-0,40", "0,40-0,50", "0,50-0,60", "0,60+"]);
  tabla("por distancia del stop (ATR)", (p) => { const c = p.x[ix("stopAtr")]; return c < 1.5 ? "<1,5" : c < 2 ? "1,5-2" : c < 2.5 ? "2-2,5" : "2,5+"; }, ["<1,5", "1,5-2", "2-2,5", "2,5+"]);
  tabla("por distancia al TP1 (R)", (p) => { const c = p.x[ix("tp1R")]; return c < 1.1 ? "<1,1" : c < 1.5 ? "1,1-1,5" : c < 2 ? "1,5-2" : "2+"; }, ["<1,1", "1,1-1,5", "1,5-2", "2+"]);
  tabla("por régimen de volatilidad", (p) => (p.x[ix("regE")] ? "EXPANDIDA" : p.x[ix("regC")] ? "COMPRIMIDA" : "NORMAL"), ["COMPRIMIDA", "NORMAL", "EXPANDIDA"]);
  tabla("por lado", (p) => p.side, ["LONG", "SHORT"]);
  tabla("por tendencia diaria contra el lado", (p) => String(p.x[ix("td")]), ["-1", "0", "1"]);
  tabla("por tendencia de BTC (4 h) contra el lado", (p) => String(p.x[ix("btcT4")]), ["-1", "0", "1"]);
  tabla("por antigüedad de la señal (lecturas seguidas)", (p) => { const n = Math.round(Math.exp(p.x[ix("runLog")] * Math.log(25)) - 1); return n === 1 ? "1" : n === 2 ? "2" : n <= 4 ? "3-4" : n <= 8 ? "5-8" : "9+"; }, ["1", "2", "3-4", "5-8", "9+"]);
}

if (process.argv[1]?.endsWith("aprendizaje.ts")) {
  const puntos = armarPuntos();
  const y = puntos.reduce((a, p) => a + p.y, 0);
  console.log(`${puntos.length} decisiones · ${((y / puntos.length) * 100).toFixed(1)}% llegó al TP1 · resultado medio ${(puntos.reduce((a, p) => a + p.r, 0) / puntos.length).toFixed(3)} R`);
  if (process.argv.includes("--cortes")) cortes(puntos);
  else {
    console.log("DESARROLLO = 2022-07 → 2025-06 · FINAL = 2025-07 → 2026-09 (AUC 0,5 = azar; «alta/baja» = resultado medio de la mitad con mejor/peor puntaje; dif = alta − baja, entre corchetes el intervalo del 90% remuestreando semanas)");
    for (const m of MODELOS) {
      const pred = haciaAdelante(puntos, m, DESARROLLO[0], FINAL[1]);
      const d = evaluar(puntos, pred, DESARROLLO);
      const f = evaluar(puntos, pred, FINAL);
      const nombre = `${m.tipo} ${m.objetivo}${m.lambda ? ` λ=${m.lambda}` : ` ${m.arboles!.rondas}×p${m.arboles!.profundidad}`}`;
      const signo = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(3)}`;
      const fila = (e: ReturnType<typeof evaluar>, rango: [number, number]) => {
        const c = diferenciaConIntervalo(puntos, pred, rango);
        return `n=${e.n} AUC(TP1)=${e.auc.toFixed(3)} alta=${e.mitadAlta.toFixed(3)} baja=${e.mitadBaja.toFixed(3)} dif=${signo(c.dif)} [${signo(c.bajo)}, ${signo(c.alto)}]`;
      };
      console.log(`${nombre.padEnd(26)} DESARROLLO ${fila(d, DESARROLLO)} | FINAL ${fila(f, FINAL)}`);
    }
  }
}
