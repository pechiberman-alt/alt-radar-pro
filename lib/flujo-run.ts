/**
 * El flujo de órdenes para tu cuenta, desde el navegador. Registra cada lectura con plan (PLAN_FLUJO_1) y mide las
 * abiertas con las velas de 5 minutos de futuros de Binance, leídas desde tu navegador como hace el robot MM. Solo
 * corre con la pestaña visible y con sesión: sin sesión no insiste durante 10 minutos, y un intento fallido espera
 * el intervalo entero. Describe y mide; no manda órdenes.
 */
import { escaleraValida, recorrer, type Escalera } from "./escalera.ts";
import { claveFlujo, COMISION_FLUJO_PCT, HORIZONTE_FLUJO, MARCO_FLUJO, MARCO_FLUJO_MS, type PlanFlujo } from "./flujo.ts";
import { FUTURES_BASES } from "./market-fetch.ts";
import { parseSwingKlines, type SwingCandle } from "./swing-entries.ts";

export const EVALUACION_FLUJO_MS = 5 * 60_000;
const SIN_SESION_MS = 10 * 60_000;
const MAX_CLAVES_VISTAS = 500;

/** Lo que el navegador le pide a la API para medir (las mismas columnas que la tabla). */
export type FilaAbierta = { clave: string; symbol: string; lado: "LONG" | "SHORT"; vela: number; entrada: number; sl: number; tp1: number; tp2: number; tp3: number; detectada: number };

let sinSesionHasta = 0;
const vistas = new Set<string>();

const visible = () => typeof document !== "undefined" && document.visibilityState === "visible";

/** Registra una lectura con plan, una sola vez por símbolo, lado y media hora. */
export async function registrarLecturaFlujo(symbol: string, plan: PlanFlujo, ahora = Date.now()): Promise<void> {
  if (!visible() || ahora < sinSesionHasta) return;
  const clave = claveFlujo(symbol, plan.lado, ahora);
  if (vistas.has(clave)) return;
  if (vistas.size >= MAX_CLAVES_VISTAS) vistas.clear();
  vistas.add(clave);
  try {
    const res = await fetch("/api/registro/flujo", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accion: "lectura",
        lectura: { symbol, lado: plan.lado, entrada: plan.entrada, stop: plan.stop, objetivo: plan.objetivo, detectada: ahora, lectura: plan.lectura, puntaje: plan.puntaje },
      }),
    });
    if (res.status === 401) {
      sinSesionHasta = Date.now() + SIN_SESION_MS;
      vistas.delete(clave);
    } else if (!res.ok) {
      vistas.delete(clave);
    }
  } catch {
    vistas.delete(clave);
  }
}

async function velasDesde(symbol: string, desde: number): Promise<SwingCandle[]> {
  for (const base of FUTURES_BASES) {
    try {
      const r = await fetch(`${base}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${MARCO_FLUJO}&startTime=${desde}&limit=500`);
      if (!r.ok) continue;
      const rows: unknown = await r.json();
      if (Array.isArray(rows)) return parseSwingKlines(rows);
    } catch {
      // Siguiente espejo.
    }
  }
  return [];
}

/** Mide las abiertas con las velas que ya cerraron y las manda a la cuenta. */
export async function evaluarFlujo(): Promise<number> {
  if (!visible() || Date.now() < sinSesionHasta) return 0;
  const res = await fetch("/api/registro/flujo", { credentials: "same-origin", cache: "no-store" });
  if (res.status === 401) {
    sinSesionHasta = Date.now() + SIN_SESION_MS;
    return 0;
  }
  if (!res.ok) return 0;
  const { abiertas } = (await res.json()) as { abiertas: FilaAbierta[] };
  if (!abiertas.length) return 0;
  const recorridos: { clave: string; recorrido: unknown }[] = [];
  const porSimbolo = new Map<string, FilaAbierta[]>();
  for (const f of abiertas) porSimbolo.set(f.symbol, [...(porSimbolo.get(f.symbol) ?? []), f]);
  for (const [symbol, filas] of porSimbolo) {
    const velas = await velasDesde(symbol, Math.min(...filas.map((f) => f.vela)));
    if (!velas.length) continue;
    for (const f of filas) {
      const e: Escalera = { stop: f.sl, tp1: f.tp1, tp2: f.tp2, tp3: f.tp3 };
      if (!escaleraValida(f.lado, f.entrada, e)) continue;
      const recorrido = recorrer(f.lado, f.entrada, e, f.vela, velas, MARCO_FLUJO_MS, Date.now(), { horizonte: HORIZONTE_FLUJO, feePct: COMISION_FLUJO_PCT });
      recorridos.push({ clave: f.clave, recorrido });
    }
  }
  if (!recorridos.length) return 0;
  const post = await fetch("/api/registro/flujo", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accion: "evaluar", recorridos }),
  });
  if (!post.ok) return 0;
  const { resultados } = (await post.json()) as { resultados: { ok: boolean }[] };
  return resultados.filter((r) => r.ok).length;
}

/** Arranca la medición periódica con la pestaña visible; devuelve cómo pararla al desmontar. */
export function iniciarEvaluacionFlujo(): () => void {
  const correr = () => {
    void evaluarFlujo().catch(() => null);
  };
  const cada = setInterval(correr, EVALUACION_FLUJO_MS);
  document.addEventListener("visibilitychange", correr);
  return () => {
    clearInterval(cada);
    document.removeEventListener("visibilitychange", correr);
  };
}
