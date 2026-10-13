/**
 * El AI TRADING LAB en el navegador: guarda los límites de riesgo que eligió la persona (dentro de los topes de
 * lib/lab-riesgo.ts) y anota la actividad del laboratorio con su hora (rechazos del gestor de riesgo, backtests,
 * errores). Solo simulación: nada de esto habla con un exchange ni usa claves.
 */
import type { VivoSnapshot } from "./arana-vivo.ts";
import type { FotoLab } from "./lab.ts";
import type { Evaluacion } from "./lab-evaluacion.ts";
import { estadoCartera, LIMITES_DEFECTO, normalizarLimites, type LimitesRiesgo, type OperacionCartera } from "./lab-riesgo.ts";

export const LAB_RIESGO_KEY = "alt-radar-pro:lab-riesgo:v1";
export const LAB_EVENT = "alt-radar:lab";
export const ACTIVIDAD_MAX = 60;

export type Tono = "ok" | "aviso" | "error" | "info";
export type Actividad = { cuando: number; texto: string; tono: Tono };

let actividad: Actividad[] = [];

function avisar() {
  try {
    window.dispatchEvent(new CustomEvent(LAB_EVENT));
  } catch {
    // Sin ventana (tests, el Worker): no hay a quién avisar.
  }
}

/** Los límites guardados en este equipo, llevados a los topes; sin nada guardado, los de defecto. */
export function limitesGuardados(): Readonly<LimitesRiesgo> {
  try {
    const raw = window.localStorage.getItem(LAB_RIESGO_KEY);
    return normalizarLimites(raw ? JSON.parse(raw) : LIMITES_DEFECTO);
  } catch {
    return normalizarLimites(LIMITES_DEFECTO);
  }
}

/** Guarda los límites que elige la persona. Lo que pase los topes se recorta: no hay forma de saltearlos. */
export function guardarLimites(raw: unknown): Readonly<LimitesRiesgo> {
  const lim = normalizarLimites(raw);
  try {
    window.localStorage.setItem(LAB_RIESGO_KEY, JSON.stringify(lim));
  } catch {
    // Almacenamiento bloqueado: quedan los de defecto en la próxima lectura.
  }
  registrarActividad("Límites de riesgo actualizados por la persona.", "info");
  return lim;
}

export function registrarActividad(texto: string, tono: Tono = "info", cuando = Date.now()) {
  actividad = [{ cuando, texto, tono }, ...actividad].slice(0, ACTIVIDAD_MAX);
  avisar();
}

export function actividadLab(): Actividad[] {
  return actividad;
}

type EstadoLab = { evaluacion: Evaluacion | null; backtestEnCurso: { hechos: number; total: number } | null; ultimoError: string | null };
let estado: EstadoLab = { evaluacion: null, backtestEnCurso: null, ultimoError: null };

export function estadoLab(): EstadoLab {
  return estado;
}

/** Un backtest del laboratorio empieza, avanza (con su avance real) o termina. */
export function fijarBacktest(enCurso: { hechos: number; total: number } | null) {
  estado = { ...estado, backtestEnCurso: enCurso };
  avisar();
}

export function fijarEvaluacion(ev: Evaluacion) {
  estado = { ...estado, evaluacion: ev, ultimoError: null };
  registrarActividad(`Backtest evaluado: ${ev.symbol.replace(/USDT$/, "")}, ${ev.desarrollo.operaciones} operaciones en DESARROLLO y ${ev.evaluacion.operaciones} en EVALUACIÓN.`, "ok");
}

export function fijarError(error: string | null) {
  estado = { ...estado, ultimoError: error };
  if (error) registrarActividad(error, "error");
  else avisar();
}

/** La foto del laboratorio con lo que hay en el navegador. */
export function fotoLab(i: { vivo: VivoSnapshot | null; operaciones: OperacionCartera[]; ahora: number; enLinea: boolean; autoPausado: boolean }): FotoLab {
  const limites = limitesGuardados();
  return {
    ahora: i.ahora,
    enLinea: i.enLinea,
    vivo: i.vivo,
    backtestEnCurso: estado.backtestEnCurso,
    autoPausado: i.autoPausado,
    ultimoError: estado.ultimoError,
    evaluacion: estado.evaluacion,
    limites,
    cartera: estadoCartera(i.operaciones, limites, i.ahora),
    actividad: actividad,
  };
}
