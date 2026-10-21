/**
 * La «foto del mapa» de cada entrada de los agentes (PLAN_FOTO_MAPA_1): cómo estaba el mapa de liquidaciones en el momento de
 * entrar, con las mismas reglas que las zonas de compra y de venta del mapa (lib/mapa-atomos.ts). Se toma con las velas de 4 h
 * cerradas hasta la de la señal, así que no mira el futuro, y viaja con la entrada (en su foto, junto al consenso) para que el
 * aprendizaje diario (lib/aprendizaje-diario.ts) compare resultados según el mapa. No filtra ni cambia ninguna regla.
 *
 * Tres datos, fijados antes de medir:
 * - detras: estrellas de la mejor zona de confluencia (dos motivos o más) entre el stop y la entrada; 0 si no hay.
 * - delante: R desde la entrada hasta la primera zona de confluencia en el camino al objetivo; null si no hay ninguna antes.
 * - liquidezStop: si hay liquidez sin barrer (mínimos iguales para un largo, máximos para un corto) entre el stop y 0,3 ATR
 *   hacia la entrada: donde el precio suele ir a buscarla, el stop queda al alcance de una barrida.
 * Solo motivos de velas: el imán del modelo de liquidaciones y los niveles de otras temporalidades no entran, porque el
 * servidor no los tiene y las dos fotos (servidor y navegador) tienen que medirse igual. Pura.
 */
import { readWyckoff } from "./chart-patterns.ts";
import { findFairValueGaps } from "./fair-value-gaps.ts";
import { readFibZone } from "./fib-zone.ts";
import { atrOf } from "./level-engine.ts";
import { findLiquidityPools } from "./liquidity-pools.ts";
import { atomosMapa } from "./mapa-atomos.ts";
import { findBreakerBlocks, findOrderBlocks } from "./order-blocks.ts";
import { agruparMotivos, type MotivoAgrupado } from "./reversal-zones.ts";
import type { SwingCandle } from "./swing-entries.ts";

type Lado = "LONG" | "SHORT";

export const PLAN_FOTO_MAPA = "PLAN_FOTO_MAPA_1";
/** Las velas que mira la foto: más o menos las que muestra el mapa. */
export const VENTANA_FOTO = 150;
/** Hasta dónde, desde el stop hacia la entrada, la liquidez deja al stop al alcance de una barrida. */
export const LIQUIDEZ_STOP_ATR = 0.3;

export type FotoMapa = {
  v: 1;
  /** Estrellas de la mejor zona de confluencia entre el stop y la entrada (0: ninguna). */
  detras: number;
  /** R hasta la primera zona de confluencia antes del objetivo; null si el camino está libre. */
  delante: number | null;
  /** Liquidez sin barrer junto al stop. */
  liquidezStop: boolean;
  /** Los motivos de la zona de atrás, para mostrarlos. */
  motivos: string[];
};

export type ContextoVelas = { atr: number; zonas: MotivoAgrupado[]; liquidez: { precio: number; lado: "ALTOS" | "BAJOS" }[] };

/** Los motivos del mapa en las últimas VENTANA_FOTO velas cerradas. Null con pocas velas o sin ATR. */
export function contextoDeVelas(cerradas: SwingCandle[]): ContextoVelas | null {
  const v = cerradas.slice(-VENTANA_FOTO);
  if (v.length < 40) return null;
  const atr = atrOf(v);
  const precio = v[v.length - 1].close;
  if (!(atr > 0) || !(precio > 0)) return null;
  const pools = findLiquidityPools(v);
  const atomos = atomosMapa({
    pools: pools.map((p) => ({ price: p.price, taken: p.swept })),
    orderBlocks: findOrderBlocks(v),
    breakers: findBreakerBlocks(v),
    gaps: findFairValueGaps(v),
    fib: readFibZone(v),
    wyckoff: readWyckoff(v),
  });
  return {
    atr,
    zonas: agruparMotivos(precio, atomos).filter((z) => z.kinds.length >= 2),
    liquidez: pools.filter((p) => !p.swept).map((p) => ({ precio: p.price, lado: p.side === "COMPRA" ? "ALTOS" : "BAJOS" })),
  };
}

/** La foto de una entrada: lo que el mapa tenía detrás del stop, en el camino al objetivo y junto al stop. */
export function fotoMapa(ctx: ContextoVelas, lado: Lado, entrada: number, stop: number, objetivo: number): FotoMapa | null {
  const riesgo = Math.abs(entrada - stop);
  if (!(riesgo > 0) || !(entrada > 0)) return null;
  const largo = lado === "LONG";
  const [abajo, arriba] = largo ? [stop, entrada] : [entrada, stop];
  // Detrás: una zona que toca el tramo entre el stop y la entrada (o que contiene la entrada).
  const detras = ctx.zonas.filter((z) => z.high >= abajo && z.low <= arriba).sort((a, b) => b.score - a.score)[0] ?? null;
  // Delante: la primera zona que empieza después de la entrada y antes del objetivo.
  const enCamino = ctx.zonas.filter((z) => (largo ? z.low > entrada && z.low < objetivo : z.high < entrada && z.high > objetivo));
  const primera = enCamino.sort((a, b) => (largo ? a.low - b.low : b.high - a.high))[0] ?? null;
  const delante = primera ? Math.round((Math.abs((largo ? primera.low : primera.high) - entrada) / riesgo) * 100) / 100 : null;
  const margen = LIQUIDEZ_STOP_ATR * ctx.atr;
  const liquidezStop = ctx.liquidez.some((p) =>
    largo ? p.lado === "BAJOS" && p.precio >= stop && p.precio <= stop + margen : p.lado === "ALTOS" && p.precio <= stop && p.precio >= stop - margen,
  );
  return { v: 1, detras: detras?.stars ?? 0, delante, liquidezStop, motivos: detras ? detras.kinds.slice(0, 4) : [] };
}

/** Lo que manda el navegador, revisado: solo esta forma exacta y números razonables. Si no, se guarda sin foto. */
export function validarFotoMapa(raw: unknown): FotoMapa | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const detras = typeof o.detras === "number" && Number.isInteger(o.detras) && o.detras >= 0 && o.detras <= 5 ? o.detras : null;
  const delante = o.delante === null ? null : typeof o.delante === "number" && Number.isFinite(o.delante) && o.delante >= 0 && o.delante <= 50 ? o.delante : undefined;
  if (o.v !== 1 || detras === null || delante === undefined || typeof o.liquidezStop !== "boolean") return null;
  const motivos = (Array.isArray(o.motivos) ? o.motivos : []).filter((m): m is string => typeof m === "string" && /^[\p{L} /+-]{2,40}$/u.test(m)).slice(0, 4);
  return { v: 1, detras, delante, liquidezStop: o.liquidezStop, motivos };
}

/** La foto guardada en el JSON de la entrada (junto al consenso); null si no tiene o está mal. */
export function fotoDeJson(foto: string | null | undefined): FotoMapa | null {
  if (!foto) return null;
  try {
    return validarFotoMapa((JSON.parse(foto) as { mapa?: unknown }).mapa);
  } catch {
    return null;
  }
}

const r2 = (v: number) => v.toFixed(2).replace(".", ",");

/** La foto en palabras, para mostrarla: cada dato con lo que significa. */
export function textosFoto(f: FotoMapa): { tono: "bien" | "mal" | "neutro"; texto: string }[] {
  return [
    f.detras > 0
      ? { tono: "bien", texto: `${"★".repeat(f.detras)} zona detrás del stop${f.motivos.length ? ` (${f.motivos.join(" + ")})` : ""}` }
      : { tono: "neutro", texto: "sin zona detrás del stop" },
    f.delante === null ? { tono: "bien", texto: "camino libre hasta el objetivo" } : { tono: "mal", texto: `zona en el camino a ${r2(f.delante)} R` },
    f.liquidezStop ? { tono: "mal", texto: "stop junto a liquidez sin barrer" } : { tono: "neutro", texto: "stop lejos de la liquidez" },
  ];
}
