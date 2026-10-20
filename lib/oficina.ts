/**
 * La oficina del fondo: cada agente de papel en su escritorio, agrupados en mesas como un fondo de comercio. Cada escritorio
 * muestra lo que el registro unificado dice de ese agente (el acierto, el profit factor y la expectancia salen de
 * lib/registro.ts, con su muestra), qué tiene abierto y en qué activo (cripto, oro, plata), y la reunión de la semana: lo que
 * cerró cada uno en los últimos 7 días. La reunión no cambia ninguna regla: los cambios se proponen y los aprueba la persona,
 * a mano, en el laboratorio en sombra. Pura: sin red ni base. Solo papel: ningún escritorio manda órdenes.
 */
import { explicadoDe } from "./agentes-explicado.ts";
import { leerClavePapel } from "./agentes-papel.ts";
import { ESTRATEGIAS } from "./estrategias.ts";
import { contar, estadistica, type Estadistica, type OperacionLeida } from "./registro.ts";

/** Entradas que se leen por visita: por índice y con tope (plan gratuito de D1). Si se llega al tope, se dice. */
export const LIMITE_OFICINA = 1000;
export const SEMANA_MS = 7 * 86_400_000;
/** El agente Supertrend MTF + Volumen con su filtro de régimen de BTC (PLAN_ST_1): corre aparte, con claves «st:». */
export const ID_ST = "ST_REGIMEN";

export type FilaOficina = { clave: string; symbol: string; lado: string; r: number | null; desenlace: string; cerrada: number | null; detectada: number };

export type MesaId = "TENDENCIA" | "REVERSION" | "ESTRUCTURA";
export const MESAS: { id: MesaId; nombre: string; detalle: string }[] = [
  { id: "TENDENCIA", nombre: "Mesa de tendencia", detalle: "Siguen la dirección: medias, MACD, Supertrend y líneas." },
  { id: "REVERSION", nombre: "Mesa de reversión", detalle: "Esperan la vuelta: RSI, bandas, soportes y Fibonacci." },
  { id: "ESTRUCTURA", nombre: "Mesa de estructura", detalle: "Leen rangos, barridas y huecos: rupturas, SMC y AMD." },
];

const MESA_DE: Record<string, MesaId> = {
  CRUCE_EMA: "TENDENCIA", MACD: "TENDENCIA", SUPERTREND: "TENDENCIA", ST_VWAP: "TENDENCIA", ST_PERFIL: "TENDENCIA",
  ST_VWAP_PERFIL: "TENDENCIA", ST_MTF: "TENDENCIA", ST_MTF_VOL: "TENDENCIA", RETROCESO: "TENDENCIA", TENDENCIA_LINEA: "TENDENCIA",
  [ID_ST]: "TENDENCIA",
  RSI: "REVERSION", BOLLINGER: "REVERSION", SNR: "REVERSION", SNR_HTF: "REVERSION", FIB_NIVELES: "REVERSION",
  RUPTURA: "ESTRUCTURA", MACD_MTF_SNR: "ESTRUCTURA", SMC_LIQUIDEZ: "ESTRUCTURA", SMC_TODO: "ESTRUCTURA", AMD_IFVG: "ESTRUCTURA",
};
/** La mesa de un agente; uno nuevo sin mesa asignada va a estructura hasta que se le asigne (no se pierde). */
export const mesaDe = (id: string): MesaId => MESA_DE[id] ?? "ESTRUCTURA";

export type Abierta = { symbol: string; lado: string; detectada: number };

export type Escritorio = {
  id: string;
  agente: string;
  mesa: MesaId;
  mira: string;
  /** Todo lo leído: acierto, PF y expectancia del registro, con su muestra. */
  total: Estadistica;
  /** Lo cerrado en los últimos 7 días. */
  semana: Estadistica;
  abiertas: Abierta[];
};

export type Oficina = {
  escritorios: Escritorio[];
  /** La reunión de la semana: los que cerraron algo, del mejor neto al peor. Sin propuestas automáticas. */
  reunion: Escritorio[];
  sinMovimiento: number;
  /** Se leyó el tope de entradas: lo más viejo puede faltar. */
  incompleta: boolean;
  /** Sin sesión o sin poder leer: los escritorios están, sin números (desconocido no es cero). */
  sinDatos: boolean;
};

/** De qué agente es una entrada; null si la clave no tiene una forma conocida. */
export function agenteDeClave(clave: string): string | null {
  if (clave.startsWith("st:")) return ID_ST;
  return leerClavePapel(clave)?.estrategia ?? null;
}

const leida = (f: FilaOficina): OperacionLeida => (f.desenlace === "ABIERTA" ? { r: null, abierta: true } : { r: f.r, abierta: false });

/** Los agentes que tienen escritorio: todos los del estudio salvo el control al azar, más el agente ST con filtro de régimen. */
export function plantel(): { id: string; agente: string; mira: string }[] {
  const delEstudio = ESTRATEGIAS.filter((e) => e.id !== "AZAR").map((e) => ({ id: e.id as string, agente: e.agente, mira: explicadoDe(e.id)?.mira ?? e.nombre }));
  return [...delEstudio, { id: ID_ST, agente: "Agente Supertrend + régimen de BTC", mira: "La tendencia del Supertrend en varias temporalidades, con volumen, y solo si BTC acompaña." }];
}

export function armarOficina(filas: FilaOficina[] | null, ahora: number): Oficina {
  const por = new Map<string, FilaOficina[]>();
  for (const f of filas ?? []) {
    const id = agenteDeClave(f.clave);
    if (id) por.set(id, [...(por.get(id) ?? []), f]);
  }
  const desde = ahora - SEMANA_MS;
  const escritorios: Escritorio[] = plantel().map((p) => {
    const suyas = por.get(p.id) ?? [];
    const semana = suyas.filter((f) => f.desenlace !== "ABIERTA" && typeof f.cerrada === "number" && f.cerrada >= desde && f.cerrada <= ahora);
    return {
      ...p,
      mesa: mesaDe(p.id),
      total: estadistica(contar(suyas.map(leida))),
      semana: estadistica(contar(semana.map(leida))),
      abiertas: suyas.filter((f) => f.desenlace === "ABIERTA").map((f) => ({ symbol: f.symbol, lado: f.lado, detectada: f.detectada })),
    };
  });
  const reunion = escritorios.filter((e) => e.semana.cerradas > 0).sort((a, b) => b.semana.neto - a.semana.neto || a.agente.localeCompare(b.agente));
  return {
    escritorios,
    reunion,
    sinMovimiento: escritorios.length - reunion.length,
    incompleta: (filas?.length ?? 0) >= LIMITE_OFICINA,
    sinDatos: filas === null,
  };
}

/** Cómo se nombra un activo en la oficina: los metales por su nombre, la cripto por su ticker. */
export const nombreActivo = (symbol: string): string => (symbol === "XAUUSDT" ? "Oro" : symbol === "XAGUSDT" ? "Plata" : symbol.replace(/USDT$/, ""));
