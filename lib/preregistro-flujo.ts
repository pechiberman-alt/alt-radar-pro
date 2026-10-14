/**
 * Preregistro del flujo real: cuatro filtros sobre el Agente Supertrend MTF + Volumen, fijados el 14/10/2026 ANTES de
 * mirar datos de volumen taker, funding u open interest. No se agregan ni se ajustan después de ver resultados: se
 * miden tal cual (scripts/investigacion/preregistro-flujo.ts) y se suman al contador de ensayos de la auditoría.
 * Cada filtro usa solo lo conocido al cierre de la vela de la señal. Puro.
 */
import { ESTRATEGIAS, type Estrategia } from "./estrategias.ts";

export const PREREGISTRO_FECHA = "2026-10-14";

/** Lo que trae cada vela de 4 h de futuros, más funding y open interest alineados por hora. */
export type Flujo = {
  /** Hora de apertura de la vela → [volumen, volumen taker comprador]. */
  taker: Map<number, [number, number]>;
  /** Fundings [hora, tasa] ordenados por hora. */
  funding: [number, number][];
  /** Open interest [hora, valor] ordenado por hora; vacío si no se bajaron las métricas. */
  oi: [number, number][];
};

/** El último valor con hora ≤ t (búsqueda binaria), o null si no hay. */
export function ultimoHasta(serie: [number, number][], t: number): number | null {
  let lo = 0;
  let hi = serie.length - 1;
  let res: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (serie[mid][0] <= t) {
      res = serie[mid][1];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return res;
}

export type FiltroId = "F1_TAKER_VELA" | "F2_DELTA_24H" | "F3_FUNDING" | "F4_OI_24H";

/**
 * Los filtros, para largos (el agente solo compra). Devuelven null si falta el dato: desconocido no aprueba ni
 * rechaza, la operación se descarta y se cuenta aparte.
 */
export const FILTROS: Record<FiltroId, { regla: string; pasa: (f: Flujo, abre: number, marcoMs: number) => boolean | null }> = {
  F1_TAKER_VELA: {
    regla: "En la vela de la señal, el volumen taker comprador es al menos la mitad del volumen.",
    pasa: (f, abre) => {
      const x = f.taker.get(abre);
      return x && x[0] > 0 ? x[1] / x[0] >= 0.5 : null;
    },
  },
  F2_DELTA_24H: {
    regla: "La suma del delta taker (compra menos venta) de las últimas 6 velas de 4 h, incluida la de la señal, es positiva.",
    pasa: (f, abre, marcoMs) => {
      let delta = 0;
      for (let k = 0; k < 6; k += 1) {
        const x = f.taker.get(abre - k * marcoMs);
        if (!x) return null;
        delta += 2 * x[1] - x[0];
      }
      return delta > 0;
    },
  },
  F3_FUNDING: {
    regla: "El último funding cobrado al cierre de la vela es como máximo 0,01 %: los largos no están pagando de más.",
    pasa: (f, abre, marcoMs) => {
      const r = ultimoHasta(f.funding, abre + marcoMs - 1);
      return r === null ? null : r <= 0.0001;
    },
  },
  F4_OI_24H: {
    regla: "El open interest al cierre de la vela es mayor que 24 h antes: entra dinero nuevo.",
    pasa: (f, abre, marcoMs) => {
      const cierre = abre + marcoMs - 1;
      const ahora = ultimoHasta(f.oi, cierre);
      const antes = ultimoHasta(f.oi, cierre - 24 * 3_600_000);
      return ahora === null || antes === null ? null : ahora > antes;
    },
  },
};

/** El Agente Supertrend MTF + Volumen con un filtro del preregistro; `faltantes` cuenta las señales sin dato. */
export function conFiltro(id: FiltroId, f: Flujo, marcoMs: number, faltantes: { n: number }): Estrategia {
  const base = ESTRATEGIAS.find((e) => e.id === "ST_MTF_VOL");
  if (!base) throw new Error("falta ST_MTF_VOL");
  return {
    ...base,
    regla: `${base.regla} Filtro ${id}: ${FILTROS[id].regla}`,
    senal: (v, ind, i) => {
      const s = base.senal(v, ind, i);
      if (!s) return null;
      const ok = FILTROS[id].pasa(f, v[i].openTime, marcoMs);
      if (ok === null) faltantes.n += 1;
      return ok ? s : null;
    },
  };
}
