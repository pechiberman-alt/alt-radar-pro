/**
 * Las lecturas del flujo de órdenes como operaciones medidas. Una lectura de presión (squeeze) con dirección y puntaje
 * de al menos 60 se vuelve operación solo si tiene plan completo con los niveles de estructura que el propio libro ya
 * calcula: entrada al precio medio, stop en el piso o techo más cercano del lado contrario y objetivo en el más cercano
 * del lado de la dirección. TP1 y TP2 quedan a un tercio y dos tercios (lib/escalera.ts). La regla es PLAN_FLUJO_1: se
 * fijó antes de medirla y solo cambia por un PR revisado, igual que la mesa. Pura: no lee la base ni la red.
 */
import { escaleraHacia, resultadoR, type Escalera, type Lado } from "./escalera.ts";
import type { SqueezeReading, StructureLevel } from "./order-flow-brain.ts";

export const PLAN_FLUJO = "PLAN_FLUJO_1";
/** Puntaje mínimo de la lectura de presión para convertirla en operación. */
export const PUNTAJE_MINIMO_FLUJO = 60;
export const MARCO_FLUJO = "5m";
export const MARCO_FLUJO_MS = 300_000;
/** Velas que se miran hacia adelante: 48 de 5 minutos, cuatro horas, igual que el robot MM. */
export const HORIZONTE_FLUJO = 48;
export const COMISION_FLUJO_PCT = 0.05;
/** Una lectura por símbolo, lado y media hora: el libro cambia cada segundo y no se cuenta cada cambio. */
export const VENTANA_FLUJO_MS = 30 * 60_000;

export type PlanFlujo = {
  lado: Lado;
  entrada: number;
  stop: number;
  objetivo: number;
  escalera: Escalera;
  puntaje: number;
  lectura: string;
};

/** La operación que sale de una lectura, o null si no tiene dirección, puntaje o niveles suficientes. */
export function planDeFlujo(squeeze: SqueezeReading, mid: number, niveles: StructureLevel[]): PlanFlujo | null {
  if (!(mid > 0) || squeeze.type === "SIN PRESIÓN" || squeeze.score < PUNTAJE_MINIMO_FLUJO) return null;
  const lado: Lado | null = squeeze.bias === "ALCISTA" ? "LONG" : squeeze.bias === "BAJISTA" ? "SHORT" : null;
  if (!lado) return null;
  // Más cercanos primero: los pisos por debajo del precio medio y los techos por encima.
  const pisos = niveles.filter((n) => n.kind === "PISO" && n.price < mid).sort((a, b) => b.price - a.price);
  const techos = niveles.filter((n) => n.kind === "TECHO" && n.price > mid).sort((a, b) => a.price - b.price);
  const stop = lado === "LONG" ? pisos[0] : techos[0];
  const objetivo = lado === "LONG" ? techos[0] : pisos[0];
  if (!stop || !objetivo) return null;
  const escalera = escaleraHacia(lado, mid, stop.price, objetivo.price);
  if (!escalera) return null;
  return { lado, entrada: mid, stop: stop.price, objetivo: objetivo.price, escalera, puntaje: squeeze.score, lectura: squeeze.type };
}

/** La clave de una lectura: la misma para el mismo símbolo, lado y media hora. Evita contar el mismo impulso mil veces. */
export const claveFlujo = (symbol: string, lado: Lado, ahora: number) =>
  `flujo:${symbol}:${MARCO_FLUJO}:${lado}:${Math.floor(ahora / VENTANA_FLUJO_MS)}`;

/** La vela de 5 minutos en la que cae `ahora`: desde su apertura se miden las siguientes. */
export const velaDe = (ahora: number) => Math.floor(ahora / MARCO_FLUJO_MS) * MARCO_FLUJO_MS;

export type LecturaFlujo = {
  clave: string;
  symbol: string;
  lado: Lado;
  vela: number;
  detectada: number;
  entrada: number;
  stop: number;
  tp1: number;
  tp2: number;
  tp3: number;
  lectura: string;
  puntaje: number;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Lo que manda el navegador, revisado: símbolo de futuros, lado, puntaje y precios coherentes. La escalera se vuelve a
 * calcular aquí desde entrada, stop y objetivo, así que el navegador no puede inventar TP1 ni TP2.
 */
export function validarLectura(raw: unknown, ahora: number): LecturaFlujo | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const symbol = typeof o.symbol === "string" ? o.symbol : "";
  const lado = o.lado === "LONG" || o.lado === "SHORT" ? o.lado : null;
  const entrada = num(o.entrada);
  const stop = num(o.stop);
  const objetivo = num(o.objetivo);
  const puntaje = num(o.puntaje);
  const detectada = num(o.detectada);
  const lectura = typeof o.lectura === "string" ? o.lectura.slice(0, 40) : "";
  if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol) || !lado || entrada === null || stop === null || objetivo === null) return null;
  if (puntaje === null || puntaje < PUNTAJE_MINIMO_FLUJO || puntaje > 100) return null;
  if (detectada === null || Math.abs(detectada - ahora) > 2 * 60_000) return null;
  if (!(entrada > 0) || !(stop > 0) || !(objetivo > 0)) return null;
  const e = escaleraHacia(lado, entrada, stop, objetivo);
  if (!e) return null;
  return {
    clave: claveFlujo(symbol, lado, detectada),
    symbol,
    lado,
    vela: velaDe(detectada),
    detectada,
    entrada,
    stop,
    tp1: e.tp1,
    tp2: e.tp2,
    tp3: e.tp3,
    lectura,
    puntaje,
  };
}

export type RecorridoFlujo = {
  slAt: number | null;
  tp1At: number | null;
  tp2At: number | null;
  tp3At: number | null;
  desenlace: "ABIERTA" | "SL" | "TP3" | "TIEMPO";
  cerradaA: number | null;
  salida: number | null;
  r: number | null;
};

/**
 * El recorrido que resolvió el navegador con las velas: revisado contra la operación guardada. Las horas caen después
 * de la vela de la lectura y no en el futuro; un cierre por stop o por objetivo tiene que salir al precio de ese nivel;
 * el R lo calcula el servidor con la comisión de la regla.
 */
export function validarRecorridoFlujo(
  op: { lado: Lado; vela: number; entrada: number; stop: number; tp3: number },
  raw: unknown,
  ahora: number,
  feePct: number = COMISION_FLUJO_PCT,
): { ok: true; recorrido: RecorridoFlujo } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  if (!raw || typeof raw !== "object") return bad("El recorrido no tiene forma.");
  const o = raw as Record<string, unknown>;
  const horas = [o.slAt, o.tp1At, o.tp2At, o.tp3At, o.cerradaA];
  for (const h of horas) {
    if (h === null || h === undefined) continue;
    if (typeof h !== "number" || !Number.isInteger(h) || h <= op.vela || h > ahora) return bad("Una hora cae fuera de la ventana de la lectura.");
  }
  const get = (k: unknown) => (typeof k === "number" ? k : null);
  const rec = { slAt: get(o.slAt), tp1At: get(o.tp1At), tp2At: get(o.tp2At), tp3At: get(o.tp3At), cerradaA: get(o.cerradaA) };
  if (rec.tp1At !== null && rec.tp2At !== null && rec.tp1At > rec.tp2At) return bad("TP1 no puede ser posterior a TP2.");
  if (rec.tp2At !== null && rec.tp3At !== null && rec.tp2At > rec.tp3At) return bad("TP2 no puede ser posterior a TP3.");
  const desenlace = o.desenlace;
  if (desenlace !== "ABIERTA" && desenlace !== "SL" && desenlace !== "TP3" && desenlace !== "TIEMPO") return bad("Desenlace desconocido.");
  if (desenlace === "ABIERTA") {
    if (rec.cerradaA !== null) return bad("Una abierta no tiene hora de cierre.");
    return { ok: true, recorrido: { ...rec, desenlace, salida: null, r: null } };
  }
  const salida = num(o.salida);
  if (salida === null || !(salida > 0) || rec.cerradaA === null) return bad("Una cerrada necesita salida y hora de cierre.");
  if (desenlace === "SL") {
    if (rec.slAt === null || salida !== op.stop) return bad("Un stop cierra al precio del stop.");
  } else if (desenlace === "TP3") {
    if (rec.tp3At === null || salida !== op.tp3) return bad("Un objetivo cierra al precio del TP3.");
  } else {
    // Por tiempo: el cierre quedó entre el stop y el TP3; si los hubiera cruzado, la operación habría terminado ahí.
    const dentro = op.lado === "LONG" ? salida > op.stop && salida < op.tp3 : salida < op.stop && salida > op.tp3;
    if (!dentro) return bad("Una salida por tiempo cierra entre el stop y el TP3.");
  }
  const r = resultadoR(op.lado, op.entrada, op.stop, salida, feePct);
  return { ok: true, recorrido: { ...rec, desenlace, salida, r } };
}
