/**
 * La búsqueda de la mejor confirmación y configuración del breaker block (BREAKER_BLOCK): un order block (la última vela
 * contraria antes de un impulso que rompió estructura, ver lib/order-blocks.ts) que el precio cierra por el otro lado y
 * que cambia de papel: lo que era demanda pasa a oferta y al revés. Se opera el retesteo de esa zona ya invertida.
 * Una confirmación decide qué retesteos se operan; una configuración fija el desplazamiento mínimo del impulso, el margen
 * del stop más allá de la zona y el objetivo (en R). Pura: sin red ni base. Todo es causal: la decisión de la vela i usa
 * velas hasta la i (el order block se confirma cuando cierra su impulso, la rotura cuando una vela cierra del otro lado, y
 * el retesteo recién después). La detección de lib/order-blocks.ts sirve para dibujar y mira velas posteriores: no se usa acá.
 */
import type { Lado } from "./escalera.ts";
import type { Indicadores, Senal } from "./estrategias.ts";
import type { SwingCandle } from "./swing-entries.ts";

export const CONFIRMACIONES_BREAKER = ["TOQUE", "RECHAZO", "MECHA", "RUPTURA_FUERTE", "VOLUMEN", "EMA200", "HTF"] as const;
export type ConfirmacionBreaker = (typeof CONFIRMACIONES_BREAKER)[number];

/** Qué exige cada confirmación, para leer la tabla. */
export const DESCRIPCION_BREAKER: Record<ConfirmacionBreaker, string> = {
  TOQUE: "Opera la primera vela que vuelve a tocar la zona, sin pedir nada más (cierra donde cierre, mientras no la haya pasado por completo).",
  RECHAZO: "La vela toca la zona y cierra del lado del breaker, fuera de ella (debajo para cortos, encima para largos).",
  MECHA: "Rechazo, y además la mecha que entra a la zona es la mitad o más del rango de la vela.",
  RUPTURA_FUERTE: "Rechazo, y la vela que rompió el order block tuvo un rango de 1,5 ATR o más.",
  VOLUMEN: "Rechazo, y la vela que rompió el order block tuvo 1,5 veces o más el volumen promedio de las 20 anteriores.",
  EMA200: "Rechazo, y el cierre queda del lado del breaker respecto de la EMA 200 de su propia temporalidad.",
  HTF: "Rechazo, y el Supertrend del marco superior (4 h para 1 h y 15 min; diario para 4 h) va en el sentido del breaker.",
};

/** Umbrales fijados antes de medir: no se afinan. */
/** Velas del impulso que sigue al order block (el mismo valor que lib/order-blocks.ts). */
export const VENTANA_IMPULSO = 4;
/** Velas previas cuyo máximo o mínimo el impulso tiene que romper (estructura). */
export const VELAS_PREVIAS = 20;
/** El origen es una vela modesta: su cuerpo no pasa de 3 ATR (si no, es parte del impulso). */
export const CUERPO_MAXIMO_ATR = 3;
/** Velas, desde que se confirma el order block, en las que puede cerrar del otro lado y volverse breaker. */
export const VENTANA_ROTURA = 50;
/** Velas, desde la rotura, en las que puede llegar el retesteo. */
export const VENTANA_RETESTE = 30;
export const MECHA_FRACCION = 0.5;
export const RUPTURA_FUERTE_ATR = 1.5;
export const VOLUMEN_MINIMO_BREAKER = 1.5;
/** Una zona que obliga a un stop a más de esto (en ATR) del cierre no se opera: el riesgo es demasiado grande. */
export const RIESGO_MAXIMO_ATR = 4;

/** Desplazamiento mínimo del impulso (en ATR), margen del stop más allá de la zona (en ATR) y objetivo (en R). */
export type ConfiguracionBreaker = { desplazamiento: number; margenAtr: number; rr: number };

/** La configuración de partida: la del detector de lib/order-blocks.ts (1,8 ATR), margen de 0,5 ATR y objetivo de 2 R. */
export const CONFIGURACION_BASE_BREAKER: ConfiguracionBreaker = { desplazamiento: 1.8, margenAtr: 0.5, rr: 2 };

/** La grilla de la fase 2: 3 desplazamientos × 3 márgenes × 3 objetivos = 27 (la base está entre ellas). */
export function grillaBreaker(): ConfiguracionBreaker[] {
  const out: ConfiguracionBreaker[] = [];
  for (const desplazamiento of [1.5, 1.8, 2.5]) for (const margenAtr of [0.25, 0.5, 1]) for (const rr of [1.5, 2, 3]) out.push({ desplazamiento, margenAtr, rr });
  return out;
}

export const mismaConfiguracionBreaker = (a: ConfiguracionBreaker, b: ConfiguracionBreaker): boolean =>
  a.desplazamiento === b.desplazamiento && a.margenAtr === b.margenAtr && a.rr === b.rr;

/** Etiqueta con coma decimal, como se lee en español. */
export const etiquetaConfiguracionBreaker = (c: ConfiguracionBreaker): string =>
  `desplazamiento ${c.desplazamiento} ATR · margen ${c.margenAtr} ATR · objetivo ${c.rr} R`.replace(/\./g, ",");

/** Los indicadores que usan las confirmaciones (los calcula indicadores(v) sobre la misma serie). */
export type IndicadoresBreaker = Pick<Indicadores, "atr14" | "volRel" | "ema200" | "htfDir">;

/** Un order block roto: la zona, el lado que ahora sostiene y la vela que cerró del otro lado. */
export type Breaker = { lado: Lado; bajo: number; alto: number; origen: number; rotaEn: number };

/**
 * Los breaker blocks de la serie, cada uno conocido recién en `rotaEn` (el cierre que rompe el order block). Un order block
 * alcista (vela bajista antes de un impulso que rompe el máximo de las 20 previas) roto hacia abajo da un breaker de CORTO;
 * uno bajista roto hacia arriba, de LARGO. El order block se confirma en origen + 4 (cuando cierra su impulso); la rotura
 * se busca desde la vela siguiente y hasta VENTANA_ROTURA velas.
 */
export function breakersCausales(v: SwingCandle[], atr14: number[], desplazamiento: number): Breaker[] {
  const out: Breaker[] = [];
  for (let i = VELAS_PREVIAS; i < v.length - VENTANA_IMPULSO - 1; i += 1) {
    const c = v[i];
    const t = atr14[i];
    if (!Number.isFinite(t) || !(t > 0)) continue;
    const alcista = c.close < c.open; // el order block alcista nace de una vela bajista
    if (!alcista && !(c.close > c.open)) continue;
    if (Math.abs(c.close - c.open) > CUERPO_MAXIMO_ATR * t) continue;
    let techo = Number.NEGATIVE_INFINITY;
    let piso = Number.POSITIVE_INFINITY;
    for (let j = i + 1; j <= i + VENTANA_IMPULSO; j += 1) {
      techo = Math.max(techo, v[j].high);
      piso = Math.min(piso, v[j].low);
    }
    const mov = alcista ? techo - c.low : c.high - piso;
    if (mov / t < desplazamiento) continue;
    let altoPrevio = Number.NEGATIVE_INFINITY;
    let bajoPrevio = Number.POSITIVE_INFINITY;
    for (let j = i - VELAS_PREVIAS; j < i; j += 1) {
      altoPrevio = Math.max(altoPrevio, v[j].high);
      bajoPrevio = Math.min(bajoPrevio, v[j].low);
    }
    if (alcista ? !(techo > altoPrevio) : !(piso < bajoPrevio)) continue;
    const bajo = c.low;
    const alto = c.high;
    const ultima = Math.min(v.length - 1, i + VENTANA_IMPULSO + VENTANA_ROTURA);
    for (let j = i + VENTANA_IMPULSO + 1; j <= ultima; j += 1) {
      if (alcista ? v[j].close < bajo : v[j].close > alto) {
        out.push({ lado: alcista ? "SHORT" : "LONG", bajo, alto, origen: i, rotaEn: j });
        break;
      }
    }
  }
  return out;
}

/**
 * Retesteos: para cada breaker, la primera vela (hasta VENTANA_RETESTE después de la rotura) que vuelve a tocar la zona y
 * cumple la confirmación. Si antes una vela cierra del otro lado de la zona por completo, el breaker falló y ya no hay
 * retesteo. Devuelve, por vela, el breaker que se retesteó en ella (si se retestean dos a la vez, gana el más antiguo).
 */
export function retestesBreaker(v: SwingCandle[], ind: IndicadoresBreaker, breakers: Breaker[], confirmacion: ConfirmacionBreaker): (Breaker | null)[] {
  const out = new Array<Breaker | null>(v.length).fill(null);
  for (const b of breakers) {
    const corto = b.lado === "SHORT";
    // Lo que se mira de la vela que rompió el order block se decide con velas hasta esa (ya cerrada).
    const rotura = v[b.rotaEn];
    const tRotura = ind.atr14[b.rotaEn];
    const roturaOk =
      confirmacion === "RUPTURA_FUERTE"
        ? Number.isFinite(tRotura) && rotura.high - rotura.low >= RUPTURA_FUERTE_ATR * tRotura
        : confirmacion === "VOLUMEN"
          ? ind.volRel[b.rotaEn] >= VOLUMEN_MINIMO_BREAKER
          : true;
    const ultima = Math.min(v.length - 1, b.rotaEn + VENTANA_RETESTE);
    for (let k = b.rotaEn + 1; k <= ultima; k += 1) {
      const x = v[k];
      if (corto ? x.close > b.alto : x.close < b.bajo) break; // la zona falló: cerró del otro lado por completo
      const toca = corto ? x.high >= b.bajo : x.low <= b.alto;
      if (!toca) continue;
      const rechazo = corto ? x.close < b.bajo : x.close > b.alto;
      const rango = x.high - x.low;
      let cumple: boolean;
      switch (confirmacion) {
        case "TOQUE":
          cumple = true;
          break;
        case "RECHAZO":
        case "RUPTURA_FUERTE":
        case "VOLUMEN":
          cumple = rechazo && roturaOk;
          break;
        case "MECHA": {
          const mecha = corto ? x.high - Math.max(x.open, x.close) : Math.min(x.open, x.close) - x.low;
          cumple = rechazo && rango > 0 && mecha / rango >= MECHA_FRACCION;
          break;
        }
        case "EMA200":
          cumple = rechazo && Number.isFinite(ind.ema200[k]) && (corto ? x.close < ind.ema200[k] : x.close > ind.ema200[k]);
          break;
        case "HTF":
          cumple = rechazo && ind.htfDir[k] === (corto ? -1 : 1);
          break;
      }
      if (cumple) {
        if (!out[k]) out[k] = b;
        break;
      }
    }
  }
  return out;
}

/**
 * Las señales de una confirmación con una configuración sobre una moneda: `senal(i)` da lado, stop y objetivo si la vela i
 * es un retesteo que cumple, o null. El stop va a `margenAtr` ATR más allá del borde lejano de la zona y el objetivo a `rr`
 * veces el riesgo desde el cierre. Si ese stop queda a más de RIESGO_MAXIMO_ATR del cierre, no se opera.
 */
export function senalesBreaker(v: SwingCandle[], ind: IndicadoresBreaker, confirmacion: ConfirmacionBreaker, cfg: ConfiguracionBreaker): (i: number) => Senal | null {
  const retestes = retestesBreaker(v, ind, breakersCausales(v, ind.atr14, cfg.desplazamiento), confirmacion);
  return (i) => {
    const b = retestes[i];
    const t = ind.atr14[i];
    if (!b || !Number.isFinite(t) || !(t > 0)) return null;
    const c = v[i].close;
    const stop = b.lado === "SHORT" ? b.alto + cfg.margenAtr * t : b.bajo - cfg.margenAtr * t;
    const riesgo = Math.abs(stop - c);
    if (!(riesgo > 0) || riesgo > RIESGO_MAXIMO_ATR * t) return null;
    const objetivo = b.lado === "SHORT" ? c - cfg.rr * riesgo : c + cfg.rr * riesgo;
    return { lado: b.lado, stop, objetivo };
  };
}
