/**
 * Lo último que leyó el mapa de liquidaciones en este navegador, por par: precio, zonas de compra y de venta, imanes y sesgo.
 * Lo guarda el mapa cada vez que lo calcula y lo leen la oficina (los agentes y JARVIS hablan de sus posiciones con el mapa a la
 * vista, y la pizarra del mapa lo muestra). Vive en este navegador: en memoria y en sessionStorage (que puede fallar o venir
 * vacío sin romper nada). Una lectura vale 30 minutos; después se dice que no hay lectura reciente, no se inventa.
 */
import { forAi } from "./ai-numbers.ts";

export type ZonaLeida = { low: number; high: number; stars: number; kinds: string[] };
/** Un disparo de la mesa de flujo en el gráfico (lib/flujo-lectura.ts): lectura, no operación. */
export type FlujoLeido = { codigo: string; regla: string; lado: "LONG" | "SHORT"; hace: string; cierre: number };
export type LecturaMapa = {
  symbol: string;
  timeframe: string;
  at: number;
  precio: number;
  compra: ZonaLeida[];
  venta: ZonaLeida[];
  imanArriba: number | null;
  imanAbajo: number | null;
  sesgo: string | null;
  /** Lo que vio la mesa de flujo en las velas cerradas del gráfico (los más nuevos primero); sin el dato, no está. */
  flujo?: FlujoLeido[];
  /** Si las velas no traían el volumen agresor: las reglas de delta no pudieron leer (no es cero). */
  flujoSinDelta?: boolean;
};

export const VIDA_LECTURA_MS = 30 * 60_000;
const CLAVE = "alt-radar-pro:mapa-lecturas:v1";
const EVENTO = "alt-radar:mapa-lectura";
const memoria = new Map<string, LecturaMapa>();
let cargada = false;

function cargar() {
  if (cargada || typeof window === "undefined") return;
  cargada = true;
  try {
    const raw = JSON.parse(window.sessionStorage.getItem(CLAVE) ?? "[]") as unknown;
    if (Array.isArray(raw)) for (const l of raw) if (esLectura(l)) memoria.set(l.symbol, l);
  } catch {
    // Sin almacenamiento: queda solo en memoria.
  }
}

function esLectura(x: unknown): x is LecturaMapa {
  if (!x || typeof x !== "object") return false;
  const l = x as Partial<LecturaMapa>;
  return typeof l.symbol === "string" && typeof l.at === "number" && typeof l.precio === "number" && Array.isArray(l.compra) && Array.isArray(l.venta);
}

export function guardarLecturaMapa(l: LecturaMapa) {
  cargar();
  memoria.set(l.symbol, l);
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CLAVE, JSON.stringify([...memoria.values()].slice(-12)));
  } catch {
    // Lleno o bloqueado: no pasa nada.
  }
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: { symbol: l.symbol } }));
}

/** La lectura reciente de un par, o null si no hay (o tiene más de 30 minutos). */
export function lecturaMapa(symbol: string, ahora = Date.now()): LecturaMapa | null {
  cargar();
  const l = memoria.get(symbol);
  return l && ahora - l.at <= VIDA_LECTURA_MS ? l : null;
}

/** Todas las lecturas recientes, de la más nueva a la más vieja. */
export function lecturasMapa(ahora = Date.now()): LecturaMapa[] {
  cargar();
  return [...memoria.values()].filter((l) => ahora - l.at <= VIDA_LECTURA_MS).sort((a, b) => b.at - a.at);
}

export function onLecturaMapa(cb: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVENTO, cb);
  return () => window.removeEventListener(EVENTO, cb);
}

/** La lectura para la IA, con los números en formato argentino. */
export function lecturaParaIa(l: LecturaMapa): unknown {
  return forAi({
    par: l.symbol,
    temporalidad: l.timeframe,
    leidoHaceMin: Math.max(0, Math.round((Date.now() - l.at) / 60_000)),
    precio: l.precio,
    zonasDeCompra: l.compra.map((z) => ({ desde: z.low, hasta: z.high, estrellas: z.stars, motivos: z.kinds.join(" + ") })),
    zonasDeVenta: l.venta.map((z) => ({ desde: z.low, hasta: z.high, estrellas: z.stars, motivos: z.kinds.join(" + ") })),
    imanArriba: l.imanArriba,
    imanAbajo: l.imanAbajo,
    sesgo: l.sesgo,
    ...(l.flujo
      ? {
          mesaDeFlujo: {
            nota: "Lectura de las reglas de los agentes de flujo sobre las velas cerradas del gráfico, no una operación.",
            disparos: l.flujo.map((f) => ({ regla: f.regla, lado: f.lado === "LONG" ? "compra" : "venta", cuando: f.hace, cierre: f.cierre })),
            ...(l.flujoSinDelta ? { delta: "las velas no traen el volumen agresor: las reglas de delta no pudieron leer" } : {}),
          },
        }
      : {}),
  });
}
