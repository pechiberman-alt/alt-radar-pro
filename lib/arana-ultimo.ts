/**
 * El último escaneo completo de la araña, guardado por cuenta para que al entrar a la app no empiece de cero. Lo que
 * llega del navegador se acepta solo si tiene la forma de un escaneo y entra en el tope de tamaño; un escaneo parcial
 * nunca reemplaza a uno completo (eso lo decide el navegador antes de enviarlo). Pura: sin base ni red.
 */
import type { ScanResult } from "./jarvis-scan.ts";

/** Tope del texto guardado: un escaneo de cientos de monedas cabe de sobra; más que esto es basura o abuso. */
export const ULTIMO_MAX_BYTES = 400_000;
/** Tope de filas: el escáner lee hasta 400 monedas; con margen. */
const MAX_FILAS = 1000;

const finito = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** El escaneo si tiene la forma de uno; null si no. No reconstruye ni completa campos: solo rechaza lo que no es. */
export function aceptarUltimo(raw: unknown): ScanResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<ScanResult>;
  if (!finito(r.at) || !finito(r.duracionMs) || r.duracionMs < 0 || !finito(r.minVolumen)) return null;
  if (typeof r.parcial !== "boolean") return null;
  if (!Array.isArray(r.filas) || r.filas.length > MAX_FILAS) return null;
  if (!r.resumen || typeof r.resumen !== "object") return null;
  if (!r.universo || typeof r.universo !== "object") return null;
  return r as ScanResult;
}

/** El texto que se guarda, o null si pasa el tope. */
export function serializarUltimo(r: ScanResult): string | null {
  const json = JSON.stringify(r);
  return json.length <= ULTIMO_MAX_BYTES ? json : null;
}

/** Cuándo empezó el escaneo guardado: el que cuenta para la cadencia de 15 minutos del escaneo automático. */
export const inicioDeUltimo = (r: ScanResult): number => r.at - r.duracionMs;
