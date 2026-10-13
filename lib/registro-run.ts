/**
 * El registro para la app y la araña: lo lee el navegador de GET /api/registro como mucho cada 5 minutos, y solo
 * con la pestaña visible. Un intento fallido también espera el intervalo entero (no reintenta en bucle).
 * Avisa con REGISTRO_EVENT cuando cambia, para que la araña se rearme.
 */
import type { Registro } from "./registro.ts";

export const REGISTRO_EVENT = "alt-radar-pro:registro";
export const REGISTRO_ESPERA_MS = 5 * 60_000;

export type EstadoRegistro = { registro: Registro | null; cargando: boolean; error: string | null; leidoEn: number | null };

let estado: EstadoRegistro = { registro: null, cargando: false, error: null, leidoEn: null };
let vuelo: Promise<void> | null = null;

export const registroActual = (): EstadoRegistro => estado;

function avisar() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(REGISTRO_EVENT));
}

/** Una sola lectura a la vez. Sin `forzar`, se respeta el intervalo. */
export function cargarRegistro(forzar = false): Promise<void> {
  if (vuelo) return vuelo;
  if (!forzar && estado.leidoEn !== null && Date.now() - estado.leidoEn < REGISTRO_ESPERA_MS) return Promise.resolve();
  estado = { ...estado, cargando: true };
  avisar();
  vuelo = (async () => {
    try {
      const res = await fetch("/api/registro", { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const registro = (await res.json()) as Registro;
      estado = { registro, cargando: false, error: null, leidoEn: Date.now() };
    } catch {
      estado = { ...estado, cargando: false, error: "No se pudo leer el registro.", leidoEn: Date.now() };
    } finally {
      vuelo = null;
      avisar();
    }
  })();
  return vuelo;
}
