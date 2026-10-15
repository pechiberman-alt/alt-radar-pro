/**
 * La práctica del gatillo: la persona ve las velas hasta una vela `i` y decide si la estrategia elegida dispara al cierre
 * de esa vela y hacia dónde (LONG, SHORT o no hay gatillo). La verdad sale de la misma regla del estudio
 * (lib/estrategias.ts) y el resultado de la misma escalera (operarSenales), pero solo se muestra después de contestar.
 * La tanda está equilibrada: la mitad de las preguntas tiene gatillo y la mitad no; eso no es la frecuencia real.
 * Practicar no es operar: esto mide reconocer el gatillo, no ganancias. Pura: no lee la red ni la base.
 */
import type { Lado } from "./escalera.ts";
import { indicadores, operarSenales, type Estrategia, type Indicadores, type Operacion, type OpcionesEstudio, type Senal } from "./estrategias.ts";
import type { SwingCandle } from "./swing-entries.ts";

/** Velas hacia adelante para medir el resultado: igual que el estudio. */
export const HORIZONTE_PRACTICA = 48;
/** Comisión más deslizamiento por lado, igual que el estudio. */
export const COSTO_PRACTICA_PCT = 0.07;
/** Velas de calentamiento antes de la primera pregunta (medias largas y zonas necesitan historia). */
export const CALENTAMIENTO_PRACTICA = 250;
/** Debajo de este número de casos un porcentaje no dice nada: se muestra como muestra mínima. */
export const MUESTRA_MINIMA_PRACTICA = 15;

/** Las monedas del estudio: las mismas 10 de lib/estrategias y datos-investigacion. */
export const MONEDAS_PRACTICA = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "TRXUSDT", "BCHUSDT", "ZECUSDT"];
/** Marcos que se pueden practicar, con su duración en milisegundos (el proxy de velas da hasta 500). */
export const MARCOS_PRACTICA: { id: string; nombre: string; ms: number }[] = [
  { id: "15m", nombre: "15 minutos", ms: 900_000 },
  { id: "1h", nombre: "1 hora", ms: 3_600_000 },
  { id: "4h", nombre: "4 horas", ms: 14_400_000 },
  { id: "1d", nombre: "1 día", ms: 86_400_000 },
];

export type Respuesta = "LONG" | "SHORT" | "NADA";

/**
 * GATILLO: la estrategia dispara y la escalera tiene una operación válida. NADA: no dispara. SIN_OPERACION: dispara pero
 * la escalera no queda ordenada o no hay velas para medirla; se excluye de la práctica porque no es un gatillo operable.
 */
export type Verdad = { i: number; tipo: "GATILLO" | "NADA" | "SIN_OPERACION"; lado: Lado | null; senal: Senal | null; operacion: Operacion | null };

export type Tanda = {
  /** Índices de vela de las preguntas, en orden aleatorio. */
  preguntas: number[];
  /** La verdad de cada pregunta: solo se lee al contestar. */
  verdades: Map<number, Verdad>;
  gatillosDisponibles: number;
  sinGatilloDisponibles: number;
};

export type Resultado = { gatillo: boolean; respuesta: Respuesta; acierto: boolean };

/** Generador pseudoaleatorio con semilla (mulberry32): la misma semilla da la misma tanda. */
export function generadorSemilla(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function barajar<T>(xs: T[], azar: () => number): T[] {
  const out = [...xs];
  for (let k = out.length - 1; k > 0; k -= 1) {
    const j = Math.floor(azar() * (k + 1));
    [out[k], out[j]] = [out[j], out[k]];
  }
  return out;
}

/**
 * La verdad de la vela `i`. `ind` se calcula una vez sobre la serie completa: cada estrategia usa solo velas hasta `i`
 * (lo prueba tests/practica-gatillo.test.ts para todas las estrategias). El resultado sí mira velas posteriores.
 */
export function verdadEn(e: Estrategia, v: SwingCandle[], ind: Indicadores, i: number, symbol: string, o: OpcionesEstudio): Verdad {
  const s = e.senal(v, ind, i);
  if (!s) return { i, tipo: "NADA", lado: null, senal: null, operacion: null };
  const ops = operarSenales(e.id, symbol, v, (k) => (k === i ? s : null), o);
  const operacion = ops[0] ?? null;
  if (!operacion) return { i, tipo: "SIN_OPERACION", lado: null, senal: s, operacion: null };
  return { i, tipo: "GATILLO", lado: s.lado, senal: s, operacion };
}

/**
 * Arma una tanda de `n` preguntas con mitad de gatillos y mitad de no-gatillos, al azar pero reproducible con la semilla.
 * Solo entran velas con calentamiento y con velas suficientes para medir el resultado.
 */
export function prepararTanda(v: SwingCandle[], e: Estrategia, symbol: string, o: OpcionesEstudio, n: number, semilla: number): Tanda {
  const ind = indicadores(v);
  const gatillos: number[] = [];
  const nada: number[] = [];
  const verdades = new Map<number, Verdad>();
  const hasta = v.length - HORIZONTE_PRACTICA - 2;
  for (let i = CALENTAMIENTO_PRACTICA; i <= hasta; i += 1) {
    const vd = verdadEn(e, v, ind, i, symbol, o);
    if (vd.tipo === "SIN_OPERACION") continue;
    verdades.set(i, vd);
    (vd.tipo === "GATILLO" ? gatillos : nada).push(i);
  }
  const azar = generadorSemilla(semilla);
  const g = barajar(gatillos, azar).slice(0, Math.floor(n / 2));
  const q = barajar(nada, azar).slice(0, n - g.length);
  const preguntas = barajar([...g, ...q], azar);
  return { preguntas, verdades, gatillosDisponibles: gatillos.length, sinGatilloDisponibles: nada.length };
}

/** La respuesta correcta: LONG o SHORT si hay gatillo, NADA si no. Acierta solo si coincide exacto. */
export function corregir(vd: Verdad, respuesta: Respuesta): { acierto: boolean; esperada: Respuesta } {
  const esperada: Respuesta = vd.tipo === "GATILLO" && vd.lado ? vd.lado : "NADA";
  return { acierto: respuesta === esperada, esperada };
}

export type TasaPractica = { n: number; aciertos: number; tasa: number | null; muestraMinima: boolean };

function tasaDe(xs: Resultado[]): TasaPractica {
  const aciertos = xs.filter((x) => x.acierto).length;
  const muestraMinima = xs.length < MUESTRA_MINIMA_PRACTICA;
  return { n: xs.length, aciertos, tasa: muestraMinima ? null : aciertos / xs.length, muestraMinima };
}

/**
 * El resumen de la sesión. Separa las preguntas con gatillo de las sin gatillo: sin el separado, un "no hay gatillo"
 * parejo oculta que el ojo no detecta nada. Cada porcentaje va con su muestra; debajo de 15 queda como muestra mínima.
 */
export function resumenPractica(resultados: Resultado[]): {
  total: TasaPractica;
  conGatillo: TasaPractica;
  sinGatillo: TasaPractica;
  /** Gatillos que se contestaron LONG o SHORT (con la dirección que sea). */
  deteccion: TasaPractica;
  /** Sin gatillo y se contestó LONG o SHORT: el ojo vio gatillo donde no había. */
  falsosGatillos: { n: number; sobre: number };
} {
  const con = resultados.filter((x) => x.gatillo);
  const sin = resultados.filter((x) => !x.gatillo);
  return {
    total: tasaDe(resultados),
    conGatillo: tasaDe(con),
    sinGatillo: tasaDe(sin),
    deteccion: tasaDe(con.map((x) => ({ ...x, acierto: x.respuesta !== "NADA" }))),
    falsosGatillos: { n: sin.filter((x) => x.respuesta !== "NADA").length, sobre: sin.length },
  };
}

/**
 * Los niveles reales de la operación que sale de la señal `s` en la vela `i`: entrada a la apertura de la vela siguiente,
 * y stop y objetivo con la misma distancia en R que usa operarSenales. Null si no hay vela siguiente.
 */
export function nivelesDeLaOperacion(v: SwingCandle[], i: number, s: Senal): { entrada: number; stop: number; objetivo: number } | null {
  if (i + 1 >= v.length) return null;
  const riesgo = Math.abs(v[i].close - s.stop);
  const rr = Math.abs(s.objetivo - v[i].close) / riesgo;
  if (!(riesgo > 0) || !Number.isFinite(rr)) return null;
  const entrada = v[i + 1].open;
  const signo = s.lado === "LONG" ? 1 : -1;
  return { entrada, stop: entrada - signo * riesgo, objetivo: entrada + signo * rr * riesgo };
}
