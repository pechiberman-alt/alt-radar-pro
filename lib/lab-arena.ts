import type { FilaEstudio } from "./estudio-estrategias-datos.ts";
import { AGENTES_PAPEL } from "./agentes-papel.ts";

/**
 * La arena del piso de estrategias del AI TRADING LAB: pone a todos los agentes en una misma tabla para que se vea quién
 * gana y quién pierde, y cómo está cada uno conectado al cerebro (JARVIS). Pura: solo ordena y rotula lo que midió el
 * estudio en la EVALUACIÓN (lib/estudio-estrategias-datos.ts); no calcula ni estima nada nuevo. Cada número lleva su
 * muestra, y con menos de 15 operaciones se dice «muestra mínima».
 */

/** Menos operaciones que esto: «muestra mínima» (la regla de honestidad de la marca). */
export const MUESTRA_MINIMA = 15;

/**
 * Cómo llega un agente al cerebro. PAPEL: corre hacia adelante y registra sus entradas (hoy solo Supertrend MTF + Volumen,
 * lib/agente-st.ts). ESTUDIO: solo está medido en el pasado, y el cerebro lee su resultado (lib/estudio-resumen.ts).
 * CONTROL: el azar, que no es un agente sino la vara con la que se comparan.
 */
export type Conexion = "PAPEL" | "ESTUDIO" | "CONTROL";

/**
 * Los que corren hacia adelante en papel: todos los agentes del estudio (lib/agentes-papel.ts). Leen las mismas velas de 4 h,
 * así que sumarlos no cuesta ninguna descarga más. El control al azar no corre: su resultado futuro no diría nada de ninguna regla.
 */
export const AGENTES_EN_PAPEL: readonly string[] = AGENTES_PAPEL;

export const conexionCerebro = (estrategia: string): Conexion => (estrategia === "AZAR" ? "CONTROL" : AGENTES_EN_PAPEL.includes(estrategia) ? "PAPEL" : "ESTUDIO");

export const CONEXION_TEXTO: Record<Conexion, string> = {
  PAPEL: "En papel: corre hacia adelante y registra sus entradas",
  ESTUDIO: "Solo estudio: el cerebro lee su resultado medido",
  CONTROL: "Control al azar: la vara de comparación, no un agente",
};

export type Combatiente = {
  clave: string;
  estrategia: string;
  /** Nombre corto, sin «Agente » ni «(azar)». */
  nombre: string;
  marco: string;
  operaciones: number;
  expectancia: number | null;
  ic: { low: number; high: number } | null;
  winRate: number | null;
  profitFactor: number | null;
  /** R acumulado en la evaluación (suma de todas las operaciones). */
  netoR: number;
  maxCaidaR: number;
  veredicto: string;
  conexion: Conexion;
  muestraMinima: boolean;
  /** El intervalo del 90 % deja el cero adentro: no se puede decir si gana o pierde. */
  cruzaCero: boolean;
};

export const nombreCorto = (agente: string): string => agente.replace("Agente ", "").replace(" (azar)", "");

/** Todas las filas (o las de una temporalidad) como combatientes, de mayor a menor R por operación; sin dato al final. */
export function combatientes(filas: readonly FilaEstudio[], marco: string = "todos"): Combatiente[] {
  return filas
    .filter((f) => marco === "todos" || f.marco === marco)
    .map((f): Combatiente => {
      const ev = f.evaluacion;
      return {
        clave: `${f.estrategia}-${f.marco}`,
        estrategia: f.estrategia,
        nombre: nombreCorto(f.agente),
        marco: f.marco,
        operaciones: ev.operaciones,
        expectancia: ev.expectancia,
        ic: ev.expectanciaIc,
        winRate: ev.winRate,
        profitFactor: ev.profitFactor,
        netoR: ev.netoR,
        maxCaidaR: ev.maxCaidaR,
        veredicto: f.veredicto,
        conexion: conexionCerebro(f.estrategia),
        muestraMinima: ev.operaciones < MUESTRA_MINIMA,
        cruzaCero: ev.expectanciaIc ? ev.expectanciaIc.low <= 0 && ev.expectanciaIc.high >= 0 : true,
      };
    })
    .sort((a, b) => (b.expectancia ?? Number.NEGATIVE_INFINITY) - (a.expectancia ?? Number.NEGATIVE_INFINITY) || b.operaciones - a.operaciones);
}

/** Las temporalidades que hay en las filas, de la más gruesa a la más fina, precedidas de «todos». */
export function marcosDisponibles(filas: readonly FilaEstudio[]): string[] {
  const minutos = (m: string) => (m.endsWith("m") ? Number(m.slice(0, -1)) : m.endsWith("h") ? Number(m.slice(0, -1)) * 60 : m.endsWith("d") ? Number(m.slice(0, -1)) * 1440 : 0);
  const ids = [...new Set(filas.map((f) => f.marco))].sort((a, b) => minutos(b) - minutos(a));
  return ["todos", ...ids];
}

/** El R por operación del control al azar en una temporalidad (la raya de comparación); null si no hay control ahí. */
export function controlDelMarco(filas: readonly FilaEstudio[], marco: string): number | null {
  const c = filas.find((f) => f.estrategia === "AZAR" && f.marco === marco);
  return c ? c.evaluacion.expectancia : null;
}

/**
 * El tope de la escala de las barras (en R, simétrico alrededor de cero): el mayor valor absoluto entre las expectancias, redondeado
 * para arriba a 0,05. Los extremos de los intervalos no entran: una muestra chica tiene un intervalo enorme y aplastaría al resto,
 * así que el intervalo se recorta a la escala y se marca como recortado.
 */
export function topeEscala(cs: readonly Combatiente[]): number {
  const m = Math.max(0.05, ...cs.map((c) => Math.abs(c.expectancia ?? 0)));
  return Math.ceil(m * 20) / 20;
}

/** Un valor en R pasado a la posición de la barra, de -1 (extremo izquierdo) a 1 (extremo derecho), recortado a la escala. */
export const posicion = (r: number, tope: number): number => Math.max(-1, Math.min(1, r / tope));

/**
 * Cómo se pinta una medición, siempre según el VEREDICTO del estudio y no según el signo del número: VENTAJA (verde) es la
 * única que pasó también la auditoría de sobreajuste; CANDIDATA (verde rayado) tiene el intervalo sobre el cero pero no pasa
 * esa auditoría; SIN VENTAJA (rojo) tiene el intervalo bajo el cero; lo demás es sin conclusión (ámbar rayado); el control, gris.
 */
export type TonoBarra = "gana" | "candidata" | "pierde" | "duda" | "control";
export function tonoBarra(veredicto: string): TonoBarra {
  return veredicto === "VENTAJA" ? "gana" : veredicto === "CANDIDATA" ? "candidata" : veredicto === "SIN VENTAJA" ? "pierde" : veredicto === "CONTROL" ? "control" : "duda";
}

/** El color de un número de R: verde o rojo solo si el veredicto es decisivo (VENTAJA o SIN VENTAJA); si no, neutro. */
export const tonoNumero = (veredicto: string): "gana" | "pierde" | "neutro" => (veredicto === "VENTAJA" ? "gana" : veredicto === "SIN VENTAJA" ? "pierde" : "neutro");

/** Texto de una barra para quien no la ve (lector de pantalla), con coma decimal y la muestra. */
export function textoCombatiente(c: Combatiente): string {
  const r = c.expectancia === null ? "sin dato" : `${c.expectancia > 0 ? "+" : ""}${(Math.round(c.expectancia * 100) / 100 || 0).toFixed(2).replace(".", ",")} R por operación`;
  return `${c.nombre} en ${c.marco}: ${r}, ${c.operaciones} operaciones${c.muestraMinima ? " (muestra mínima)" : ""}, ${c.veredicto}`;
}

/** Un lugar del piso: centro del nodo y en qué anillo está (0 = el de adentro). */
export type Lugar = { x: number; y: number; anillo: 0 | 1 };

/**
 * Reparte `total` agentes en dos anillos alrededor del cerebro: adentro los que caben (hasta 6) y el resto afuera, parejos y
 * empezando arriba. Con 16 agentes: 6 adentro y 10 afuera. El anillo de afuera va girado medio paso para que ningún nodo
 * quede en línea con uno de adentro y tape su conexión.
 */
export function repartirAnillos(total: number, centro: { x: number; y: number }, radioInterno: number, radioExterno: number): Lugar[] {
  const adentro = Math.min(6, total);
  const afuera = total - adentro;
  const punto = (k: number, de: number, radio: number, giro: number, anillo: 0 | 1): Lugar => {
    const ang = -Math.PI / 2 + giro + (2 * Math.PI * k) / de;
    return { x: Math.round((centro.x + radio * Math.cos(ang)) * 10) / 10, y: Math.round((centro.y + radio * Math.sin(ang)) * 10) / 10, anillo };
  };
  return [
    ...Array.from({ length: adentro }, (_, k) => punto(k, adentro, radioInterno, 0, 0)),
    ...Array.from({ length: afuera }, (_, k) => punto(k, afuera, radioExterno, Math.PI / Math.max(afuera, 1), 1)),
  ];
}

/** Parte un nombre en hasta dos renglones de a lo sumo `max` letras, cortando en un espacio cerca de la mitad. */
export function partirNombre(nombre: string, max = 14): string[] {
  if (nombre.length <= max) return [nombre];
  const medio = nombre.length / 2;
  let corte = -1;
  for (let i = 0; i < nombre.length; i += 1) if (nombre[i] === " " && (corte < 0 || Math.abs(i - medio) < Math.abs(corte - medio))) corte = i;
  if (corte < 0) return [nombre.slice(0, max - 1) + "…"];
  return [nombre.slice(0, corte), nombre.slice(corte + 1)];
}
