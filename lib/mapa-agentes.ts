/**
 * Los agentes en el mapa de liquidaciones: las posiciones de papel de los agentes (servidor 24/7 y tu cuenta) en el par que
 * muestra el mapa, cada una con la foto del mapa al entrar y con lo que el mapa dice AHORA de su stop, su camino y su objetivo.
 * Lee lo que ya registraron; no abre, no cierra y no cambia nada. Los números de R salen de los precios de la posición (el R
 * de cada cierre es el del registro); el R «ahora» es una lectura en vivo, sin comisiones, para mirar. Pura.
 */
import { MONEDAS_SERVIDOR } from "./agentes-servidor.ts";
import { SIMBOLOS_PAPEL } from "./agentes-papel.ts";
import { acuerdoDe } from "./agentes-mente.ts";
import { fotoDeJson, fotoMapa, textosFoto, type ContextoVelas, type FotoMapa } from "./mapa-contexto.ts";
import { agenteDeClave, ID_ST, plantel } from "./oficina.ts";

export type PlanPosicion = "SERVIDOR" | "CUENTA";

/** Una fila de la base, tal como la leen las dos tablas (la de tu cuenta no tiene `venue`). */
export type FilaPosicion = {
  clave: string;
  symbol: string;
  lado: string;
  entrada: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp1_at: number | null;
  tp2_at: number | null;
  detectada: number;
  venue: string | null;
  foto: string | null;
  desenlace: string;
  r: number | null;
  cerrada: number | null;
};

export type PosicionAgente = {
  clave: string;
  plan: PlanPosicion;
  agente: string;
  nombre: string;
  codigo: string;
  symbol: string;
  lado: "LONG" | "SHORT";
  entrada: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp1At: number | null;
  tp2At: number | null;
  detectada: number;
  venue: string | null;
  foto: FotoMapa | null;
  acuerdo: number | null;
  desenlace: string;
  r: number | null;
  cerrada: number | null;
};

/** Los pares en los que corre algún agente: el mapa pregunta solo por estos (los demás no tienen posiciones). */
export const PARES_AGENTES: ReadonlySet<string> = new Set([...SIMBOLOS_PAPEL, ...MONEDAS_SERVIDOR]);
export const parValido = (s: string) => /^[A-Z0-9]{2,24}$/.test(s);
/** Cuántos días hacia atrás se leen: ninguna posición vive más de 8 días (48 velas de 4 h). */
export const DIAS_POSICIONES = 21;

const NOMBRES = new Map(plantel(true).map((p) => [p.id, p.agente.replace(/^Agente\s+/, "")] as const));
/** Un código corto para el marcador del gráfico: la primera parte del id del agente. */
export const codigoAgente = (id: string) => (id === ID_ST ? "ST+" : id.split("_")[0].slice(0, 4));
const finito = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Una fila de la base como posición; null si la clave no es de un agente conocido o los precios no tienen forma de plan. */
export function aPosicion(f: FilaPosicion, plan: PlanPosicion): PosicionAgente | null {
  const agente = agenteDeClave(f.clave);
  if (!agente || !NOMBRES.has(agente)) return null;
  if (f.lado !== "LONG" && f.lado !== "SHORT") return null;
  if (![f.entrada, f.sl, f.tp1, f.tp2, f.tp3, f.detectada].every(finito) || !(f.entrada > 0) || f.entrada === f.sl) return null;
  return {
    clave: f.clave,
    plan,
    agente,
    nombre: NOMBRES.get(agente) as string,
    codigo: codigoAgente(agente),
    symbol: f.symbol,
    lado: f.lado,
    entrada: f.entrada,
    sl: f.sl,
    tp1: f.tp1,
    tp2: f.tp2,
    tp3: f.tp3,
    tp1At: finito(f.tp1_at) ? f.tp1_at : null,
    tp2At: finito(f.tp2_at) ? f.tp2_at : null,
    detectada: f.detectada,
    venue: f.venue ?? null,
    foto: fotoDeJson(f.foto),
    acuerdo: acuerdoDe(f.foto),
    desenlace: f.desenlace,
    r: finito(f.r) ? f.r : null,
    cerrada: finito(f.cerrada) ? f.cerrada : null,
  };
}

/** Las posiciones de una respuesta, separadas en abiertas y cerradas (las cerradas, de la más nueva a la más vieja). */
export function separar(filas: FilaPosicion[] | null | undefined, plan: PlanPosicion): { abiertas: PosicionAgente[]; cerradas: PosicionAgente[] } {
  const ps = (filas ?? []).map((f) => aPosicion(f, plan)).filter((p): p is PosicionAgente => p !== null);
  return {
    abiertas: ps.filter((p) => p.desenlace === "ABIERTA").sort((a, b) => b.detectada - a.detectada),
    cerradas: ps.filter((p) => p.desenlace !== "ABIERTA" && p.r !== null).sort((a, b) => (b.cerrada ?? 0) - (a.cerrada ?? 0)),
  };
}

/** R de la posición al precio de ahora, sin comisiones: solo para mirar (el R que cuenta es el del cierre, en el registro). */
export function rAhora(p: PosicionAgente, precio: number | null): number | null {
  if (precio === null || !(precio > 0)) return null;
  const riesgo = Math.abs(p.entrada - p.sl);
  if (!(riesgo > 0)) return null;
  return ((p.lado === "LONG" ? precio - p.entrada : p.entrada - precio) / riesgo);
}

/** Cuántos van largos y cuántos cortos en el par. Es una cuenta, no una predicción. */
export function consensoPar(abiertas: PosicionAgente[]): { largos: number; cortos: number } {
  return { largos: abiertas.filter((p) => p.lado === "LONG").length, cortos: abiertas.filter((p) => p.lado === "SHORT").length };
}

export type MapaVivo = ContextoVelas & { imanArriba: number | null; imanAbajo: number | null };

/** Lo que el mapa de ahora dice de la posición: las mismas tres lecturas de la foto, más el imán de liquidaciones. */
export function lecturaViva(p: PosicionAgente, mapa: MapaVivo | null): { tono: "bien" | "mal" | "neutro"; texto: string }[] {
  if (!mapa) return [];
  const f = fotoMapa(mapa, p.lado, p.entrada, p.sl, p.tp3);
  const out = f ? textosFoto(f) : [];
  const iman = p.lado === "LONG" ? mapa.imanArriba : mapa.imanAbajo;
  if (iman !== null) {
    const pasa = p.lado === "LONG" ? iman >= p.tp3 : iman <= p.tp3;
    const enContra = p.lado === "LONG" ? iman <= p.entrada : iman >= p.entrada;
    if (!enContra) out.push(pasa ? { tono: "bien", texto: "el imán de liquidaciones está más allá del TP3" } : { tono: "neutro", texto: "el imán de liquidaciones está antes del TP3" });
  }
  return out;
}
