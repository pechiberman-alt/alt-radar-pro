/**
 * La compuerta de la variante aprobada en el papel: si la persona aprobó una
 * variante del laboratorio en sombra, las operaciones de papel nuevas que esa
 * variante no tomaría no se abren, y se dice por qué. Nunca toca la ejecución real.
 * Solo existe con sesión (la aprobación vive en la cuenta). Se vuelve a leer cada
 * 5 minutos, por si cambió en otra pestaña o en otro equipo. Si no se puede leer,
 * sigue la última que se leyó; si nunca se leyó, no frena nada: es papel, y se
 * vuelve a intentar en la próxima apertura.
 */
import type { PaperTrade } from "./jarvis-paper.ts";
import { codigo, indiceValido, motivoRechazo, rasgosDe } from "./mesa-sombra.ts";

/** Cada cuánto se vuelve a leer la aprobación de la cuenta. */
export const FILTRO_VIGENCIA_MS = 5 * 60_000;

let aprobada: number | null = null;
/** Cuándo se leyó por última vez (0: nunca). */
let leidaA = 0;

/** Lo fija el laboratorio cada vez que carga o cambia (lib/mesa-sombra-run.ts). */
export function fijarFiltro(indice: number | null, ahora = Date.now()) {
  aprobada = indiceValido(indice) ? indice : null;
  leidaA = ahora;
}

export function filtroActual(): number | null {
  return aprobada;
}

async function asegurar(ahora: number): Promise<void> {
  if (leidaA && ahora - leidaA < FILTRO_VIGENCIA_MS) return;
  try {
    const r = await fetch("/api/jarvis/sombra?solo=estado", { cache: "no-store" });
    if (r.status === 401) return fijarFiltro(null, ahora);
    if (!r.ok) return;
    const d = (await r.json()) as { estado?: { aprobada?: { indice?: number } | null } | null };
    fijarFiltro(d.estado?.aprobada?.indice ?? null, ahora);
  } catch {
    /* sin respuesta: queda la última que se leyó (o ninguna) */
  }
}

/** El motivo por el que la variante aprobada no la toma, o null si pasa (o no hay aprobada). */
export async function rechazoDeVariante(t: PaperTrade, ahora = Date.now()): Promise<string | null> {
  await asegurar(ahora);
  if (aprobada === null) return null;
  const r = rasgosDe(t);
  if (!r) return null;
  const motivo = motivoRechazo(aprobada, r);
  return motivo ? `La variante aprobada ${codigo(aprobada)} no toma esta operación: ${motivo}. Si querés tomarla igual, revocala en la araña.` : null;
}
