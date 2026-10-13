/**
 * El escaneo automático de la araña en vivo: como mucho cada 15 minutos, solo
 * mientras la araña está a la vista, nunca en paralelo con otro escaneo y con un
 * botón para pausarlo. La decisión es pura: el reloj, la visibilidad, la pausa y
 * el último intento llegan como datos. Un intento fallido también espera el
 * intervalo entero: no reintenta en bucle contra Binance.
 */

export const AUTO_CADA_MIN = 15;
/** Cada cuánto se revisa la decisión (no cada cuánto se escanea). */
export const AUTO_REVISA_MS = 30_000;

const MINUTO = 60_000;

export type EstadoAuto = "activo" | "pausado" | "fuera de vista" | "en curso";

export type EntradaAuto = {
  /** La araña está a la vista y la pestaña también. */
  visible: boolean;
  pausado: boolean;
  enCurso: boolean;
  /** Cuándo empezó el último intento (automático o a mano), o null si no hubo ninguno. */
  ultimoIntento: number | null;
  ahora: number;
};

export type DecisionAuto = {
  escanear: boolean;
  estado: EstadoAuto;
  /** Minutos hasta el próximo escaneo automático; 0 si es ya, null si no corresponde (pausado, en curso, fuera de vista). */
  proximoEnMin: number | null;
  motivo: string;
};

export function decidirAuto(e: EntradaAuto): DecisionAuto {
  if (e.enCurso) return { escanear: false, estado: "en curso", proximoEnMin: null, motivo: "Ya hay un escaneo en curso." };
  if (e.pausado) return { escanear: false, estado: "pausado", proximoEnMin: null, motivo: "Pausado: escaneás a mano." };
  if (!e.visible) return { escanear: false, estado: "fuera de vista", proximoEnMin: null, motivo: "La araña no está a la vista: no escanea en segundo plano." };
  if (e.ultimoIntento === null) return { escanear: true, estado: "activo", proximoEnMin: 0, motivo: "Primer escaneo al abrir la araña." };
  const faltaMs = e.ultimoIntento + AUTO_CADA_MIN * MINUTO - e.ahora;
  if (faltaMs <= 0) return { escanear: true, estado: "activo", proximoEnMin: 0, motivo: `Pasaron ${AUTO_CADA_MIN} minutos desde el último escaneo.` };
  const falta = Math.ceil(faltaMs / MINUTO);
  return { escanear: false, estado: "activo", proximoEnMin: falta, motivo: `Próximo escaneo en ${falta} ${falta === 1 ? "minuto" : "minutos"}.` };
}
