/**
 * La oficina del fondo: cada agente de papel en su escritorio, agrupados en mesas como un fondo de comercio. Cada escritorio
 * muestra lo que el registro unificado dice de ese agente (el acierto, el profit factor y la expectancia salen de
 * lib/registro.ts, con su muestra), qué tiene abierto y en qué activo (cripto, oro, plata), y la reunión de la semana: lo que
 * cerró cada uno en los últimos 7 días. La reunión no cambia ninguna regla: los cambios se proponen y los aprueba la persona,
 * a mano, en el laboratorio en sombra. Pura: sin red ni base. Solo papel: ningún escritorio manda órdenes.
 *
 * La charla: cada frase sale de un dato (lo que tiene abierto, con quién coincide o discrepa, cuánto cerró y con qué muestra).
 * Nadie inventa un número ni una opinión. Aprenden entre ellos por el consenso (lib/consenso.ts): se compara cómo terminan
 * las entradas donde coincidieron varios contra las solitarias, con muestra mínima. Eso informa; no filtra ni cambia reglas.
 * Las propuestas son para la persona: ninguna se aplica sola.
 */
import { explicadoDe } from "./agentes-explicado.ts";
import { leerClavePapel } from "./agentes-papel.ts";
import { compararConsenso, type Comparacion, type ResultadoConsenso } from "./consenso.ts";
import { ESTRATEGIAS } from "./estrategias.ts";
import { contar, estadistica, MUESTRA_MINIMA, type Estadistica, type OperacionLeida } from "./registro.ts";

/** Entradas que se leen por visita: por índice y con tope (plan gratuito de D1). Si se llega al tope, se dice. */
export const LIMITE_OFICINA = 1000;
export const SEMANA_MS = 7 * 86_400_000;
/** El agente Supertrend MTF + Volumen con su filtro de régimen de BTC (PLAN_ST_1): corre aparte, con claves «st:». */
export const ID_ST = "ST_REGIMEN";

export type FilaOficina = { clave: string; symbol: string; lado: string; r: number | null; desenlace: string; cerrada: number | null; detectada: number; foto?: string | null };

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
  /** Lo que aprenden entre ellos: entradas acompañadas contra solitarias, con muestra mínima. */
  aprendizaje: Comparacion;
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
  const conConsenso: ResultadoConsenso[] = [];
  for (const f of filas ?? []) {
    if (f.desenlace === "ABIERTA" || typeof f.r !== "number" || !Number.isFinite(f.r) || f.clave.startsWith("st:")) continue;
    const acuerdo = acuerdoDe(f.foto);
    if (acuerdo !== null) conConsenso.push({ acuerdo, r: f.r });
  }
  return {
    aprendizaje: compararConsenso(conConsenso),
    escritorios,
    reunion,
    sinMovimiento: escritorios.length - reunion.length,
    incompleta: (filas?.length ?? 0) >= LIMITE_OFICINA,
    sinDatos: filas === null,
  };
}

/** Cómo se nombra un activo en la oficina: los metales por su nombre, la cripto por su ticker. */
export const nombreActivo = (symbol: string): string => (symbol === "XAUUSDT" ? "Oro" : symbol === "XAGUSDT" ? "Plata" : symbol.replace(/USDT$/, ""));

/** Con cuántos coincidió una entrada, leído de su foto de consenso; null si la foto no lo trae (no se supone cero). */
export function acuerdoDe(foto: string | null | undefined): number | null {
  if (!foto) return null;
  try {
    const o = JSON.parse(foto) as { acuerdo?: unknown };
    return typeof o.acuerdo === "number" && Number.isInteger(o.acuerdo) && o.acuerdo >= 0 ? o.acuerdo : null;
  } catch {
    return null;
  }
}

const lado = (l: string) => (l === "LONG" ? "largo" : "corto");
const r2 = (v: number) => `${v > 0 ? "+" : ""}${(Math.round(v * 100) / 100 || 0).toFixed(2).replace(".", ",")} R`;
const corto = (agente: string) => agente.replace(/^Agente\s+/, "");

export type Frase = { quien: string; nombre: string; texto: string; tipo: "posicion" | "acuerdo" | "debate" | "resultado" | "aprendizaje" };

/** Lo que dicen en la oficina. Cada frase sale de un dato; ninguna inventa números ni opiniones. */
export function charla(o: Oficina): Frase[] {
  const out: Frase[] = [];
  const porActivo = new Map<string, { e: Escritorio; lado: string }[]>();
  for (const e of o.escritorios)
    for (const a of e.abiertas) porActivo.set(a.symbol, [...(porActivo.get(a.symbol) ?? []), { e, lado: a.lado }]);
  for (const [symbol, quienes] of porActivo) {
    const activo = nombreActivo(symbol);
    for (const l of ["LONG", "SHORT"]) {
      const mismos = [...new Map(quienes.filter((q) => q.lado === l).map((q) => [q.e.id, q.e])).values()];
      if (mismos.length >= 2)
        out.push({ quien: mismos[0].id, nombre: corto(mismos[0].agente), tipo: "acuerdo", texto: `Coincido con ${mismos.slice(1, 3).map((x) => corto(x.agente)).join(" y ")}${mismos.length > 3 ? ` y ${mismos.length - 3} más` : ""}: ${activo} ${lado(l)}.` });
      else if (mismos.length === 1) out.push({ quien: mismos[0].id, nombre: corto(mismos[0].agente), tipo: "posicion", texto: `Tengo ${activo} ${lado(l)} abierto.` });
    }
    const largos = quienes.filter((q) => q.lado === "LONG");
    const cortos = quienes.filter((q) => q.lado === "SHORT");
    if (largos.length && cortos.length)
      out.push({ quien: largos[0].e.id, nombre: corto(largos[0].e.agente), tipo: "debate", texto: `En ${activo} voy largo y ${corto(cortos[0].e.agente)} va corto: uno de los dos se equivoca, lo dirá el cierre.` });
  }
  for (const e of o.escritorios) {
    const t = e.total;
    if (t.cerradas === 0) continue;
    const texto =
      t.cerradas < MUESTRA_MINIMA
        ? `Llevo ${t.cerradas} ${t.cerradas === 1 ? "cierre" : "cierres"} (${r2(t.neto)}): con menos de ${MUESTRA_MINIMA} todavía no sé nada.`
        : t.expectancia !== null && t.expectancia < 0
          ? `Con ${t.cerradas} cierres pierdo ${r2(t.expectancia)} por operación. Que me revisen: mi regla no la cambio yo.`
          : `Con ${t.cerradas} cierres voy ${r2(t.expectancia ?? 0)} por operación. Sigo con mi regla, sin tocarla.`;
    out.push({ quien: e.id, nombre: corto(e.agente), tipo: "resultado", texto });
  }
  out.push({ quien: "JARVIS", nombre: "JARVIS", tipo: "aprendizaje", texto: `Lo que aprendemos juntos: ${o.aprendizaje.texto}` });
  return out;
}

export type Propuesta = { quien: string; agente: string; texto: string };

/**
 * Las propuestas de la reunión, para que las decida la persona. Solo con muestra suficiente; con menos, seguir midiendo.
 * Ninguna se aplica sola: pausar, revisar o cambiar una regla es una decisión humana (y un cambio de regla, un PR revisado).
 */
export function propuestas(o: Oficina): Propuesta[] {
  const out: Propuesta[] = [];
  for (const e of o.escritorios) {
    const t = e.total;
    if (t.cerradas < MUESTRA_MINIMA || t.expectancia === null) continue;
    if (t.expectancia < 0) out.push({ quien: e.id, agente: e.agente, texto: `Pierde ${r2(t.expectancia)} por operación con ${t.cerradas} cierres: revisar o pausar en papel.` });
    else out.push({ quien: e.id, agente: e.agente, texto: `Gana ${r2(t.expectancia)} por operación con ${t.cerradas} cierres: seguir midiendo hacia adelante antes de confiar.` });
  }
  if (!o.aprendizaje.muestraMinima && o.aprendizaje.diferencia !== null)
    out.push({ quien: "JARVIS", agente: "JARVIS", texto: `Coincidir ${o.aprendizaje.diferencia > 0 ? "mejoró" : "empeoró"} el resultado en ${r2(Math.abs(o.aprendizaje.diferencia))} por operación. Si querés probarlo como filtro, va por el laboratorio en sombra.` });
  return out;
}

/** Cómo se nombra el mejor de la semana sin mentir: si todos perdieron, es el que menos perdió. */
export function tituloSemana(e: Escritorio): string {
  return e.semana.neto > 0 ? "Mejor neto" : e.semana.neto === 0 ? "Nadie ganó; empató" : "Nadie ganó esta semana; el que menos perdió";
}
