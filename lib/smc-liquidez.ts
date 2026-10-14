/**
 * El agente «Liquidez + IFVG + Breaker en zona de alta temporalidad» (SMC_LIQUIDEZ) y su búsqueda de disparo y configuración.
 * Marco: zonas de la temporalidad alta, FVG (hueco de valor justo de tres velas) y OB (order block), sacadas de las velas
 * altas ya cerradas (4 h para velas de 15 min y 1 h; diario para 4 h). Gatillo en la temporalidad de la serie: dentro de una
 * zona, una toma de liquidez (la mecha rompe un máximo o mínimo de pivote y la vela cierra de vuelta) y después un IFVG (un hueco
 * de valor justo cerrado por el otro lado, que cambia de papel) y un breaker (un order block roto por un cierre, ver
 * lib/breaker-busqueda.ts), los dos a favor de la zona. Pura: sin red ni base. Todo es causal: la zona se conoce recién al
 * cierre de su vela alta, y cada evento usa solo velas hasta la suya. Los detectores de lib/fair-value-gaps.ts y
 * lib/order-blocks.ts sirven para dibujar y miran velas posteriores: no se usan acá.
 */
import type { Lado } from "./escalera.ts";
import type { Senal } from "./estrategias.ts";
import { breakersCausales, RIESGO_MAXIMO_ATR } from "./breaker-busqueda.ts";
import { findPivots } from "./trendlines.ts";
import type { SwingCandle } from "./swing-entries.ts";

export const DISPAROS_SMC = ["ZONA", "BARRIDA", "BARRIDA_IFVG", "BARRIDA_BREAKER", "BARRIDA_IFVG_BREAKER", "IFVG_BREAKER"] as const;
export type DisparoSmc = (typeof DISPAROS_SMC)[number];

/** Qué exige cada disparo, para leer la tabla. */
export const DESCRIPCION_DISPARO: Record<DisparoSmc, string> = {
  ZONA: "Sin gatillo: la primera vela que toca la zona alta y cierra del lado favorable (la vara con la que se comparan los demás).",
  BARRIDA: "Dentro de la zona, una vela rompe con la mecha un máximo o mínimo de pivote y cierra de vuelta (toma de liquidez). Entra en esa vela.",
  BARRIDA_IFVG: "La toma de liquidez y, hasta 12 velas después, un IFVG a favor (un hueco de valor justo cerrado por el otro lado). Entra en el cierre del IFVG.",
  BARRIDA_BREAKER: "La toma de liquidez y, hasta 12 velas después, un breaker a favor (un order block roto por un cierre). Entra en el cierre de la rotura.",
  BARRIDA_IFVG_BREAKER: "La toma de liquidez y, hasta 12 velas después, las dos cosas: un IFVG y un breaker a favor. Entra en el cierre de la última. Es el gatillo del agente.",
  IFVG_BREAKER: "Sin toma de liquidez: un IFVG y un breaker a favor a menos de 12 velas uno del otro, con la zona alta tocada en ese tramo.",
};

export type ZonasSmc = "FVG" | "OB" | "AMBAS";
/** Qué zonas altas se usan, margen del stop más allá del extremo de la toma de liquidez (en ATR) y objetivo (en R). */
/**
 * Filtros de contexto sobre la señal (todos con velas hasta la vela del gatillo): PERFIL = cierre del lado favorable del POC del
 * perfil de volumen de 200 velas; SUPERTREND = dirección (10, 3) a favor; EMAS = las medias de 9, 21, 30, 50 y 100 apiladas a favor
 * (largo: 9 > 21 > 30 > 50 > 100; corto: al revés); TODO = los tres a la vez.
 */
export const FILTROS_SMC = ["NINGUNO", "PERFIL", "SUPERTREND", "EMAS", "TODO"] as const;
export type FiltroSmc = (typeof FILTROS_SMC)[number];
export const PERIODOS_EMAS = [9, 21, 30, 50, 100] as const;
export type ContextoSmc = { filtro: FiltroSmc; stDir: number[]; poc: number[] };

/** EMA clásica (semilla: el primer cierre); NaN hasta tener `n` velas. */
export function emaSmc(valores: number[], n: number): number[] {
  const k = 2 / (n + 1);
  const out = new Array<number>(valores.length).fill(Number.NaN);
  let prev = Number.NaN;
  for (let i = 0; i < valores.length; i += 1) {
    prev = i === 0 ? valores[0] : valores[i] * k + prev * (1 - k);
    if (i >= n - 1) out[i] = prev;
  }
  return out;
}

export type ConfiguracionSmc = { zonas: ZonasSmc; margenAtr: number; rr: number };

/** La configuración fija del agente en el estudio, decidida antes de medir: ambas zonas, margen de 0,5 ATR y objetivo de 2 R. */
export const CONFIGURACION_BASE_SMC: ConfiguracionSmc = { zonas: "AMBAS", margenAtr: 0.5, rr: 2 };
export const DISPARO_DEL_AGENTE: DisparoSmc = "BARRIDA_IFVG_BREAKER";

/** La grilla de la fase 2: 3 zonas × 3 márgenes × 3 objetivos = 27 (la base está entre ellas). */
export function grillaSmc(): ConfiguracionSmc[] {
  const out: ConfiguracionSmc[] = [];
  for (const zonas of ["FVG", "OB", "AMBAS"] as const) for (const margenAtr of [0.25, 0.5, 1]) for (const rr of [1.5, 2, 3]) out.push({ zonas, margenAtr, rr });
  return out;
}
export const mismaConfiguracionSmc = (a: ConfiguracionSmc, b: ConfiguracionSmc): boolean => a.zonas === b.zonas && a.margenAtr === b.margenAtr && a.rr === b.rr;
export const etiquetaConfiguracionSmc = (c: ConfiguracionSmc): string => `zonas ${c.zonas === "AMBAS" ? "FVG y OB" : c.zonas} · margen ${c.margenAtr} ATR · objetivo ${c.rr} R`.replace(/\./g, ",");

/** Umbrales fijados antes de medir: no se afinan. */
/** Velas altas que vive una zona desde que se conoce (si antes no cierra por el otro lado). */
export const VIDA_ZONA = 40;
/** Alto mínimo de un FVG alto, en ATR de la vela alta. */
export const FVG_MINIMO_ATR = 0.5;
/** Un OB alto: su impulso dura 3 velas altas, mide 1,5 ATR o más y rompe el máximo o mínimo de las 20 velas altas previas. */
export const OB_IMPULSO = 3;
export const OB_DESPLAZAMIENTO_ATR = 1.5;
export const OB_PREVIAS = 20;
/** Pivotes de la toma de liquidez: 3 velas a cada lado; un pivote vale 60 velas. */
export const PIVOTE_N = 3;
export const PIVOTE_VIDA = 60;
/** Velas después de la toma de liquidez en las que pueden llegar el IFVG y el breaker. */
export const VENTANA_CONFIRMACION = 12;
/** Un IFVG: hueco de al menos 0,3 ATR, que se invierte (cierre por el otro lado) hasta 30 velas después de formarse. */
export const IFVG_MINIMO_ATR = 0.3;
export const IFVG_VIDA = 30;
export const DESPLAZAMIENTO_BREAKER = 1.8;

export type ZonaAlta = { lado: Lado; bajo: number; alto: number; tipo: "FVG" | "OB"; conocida: number; vence: number };

/** Velas altas armadas con las de la serie: 4 h para series menores a 4 h, diario para 4 h o más. Cada vela dice cuál cubo ya cerró. */
export function cubosAltos(v: SwingCandle[]): { sup: SwingCandle[]; cerrado: number[] } {
  const marco = v.length > 1 ? v[1].openTime - v[0].openTime : 0;
  const cubo = marco >= 4 * 3_600_000 ? 86_400_000 : 4 * 3_600_000;
  const sup: SwingCandle[] = [];
  const claveDe = (i: number) => Math.floor(v[i].openTime / cubo);
  const idx = new Array<number>(v.length);
  let ultima = Number.NaN;
  for (let i = 0; i < v.length; i += 1) {
    const k = claveDe(i);
    if (k !== ultima) {
      ultima = k;
      sup.push({ openTime: k * cubo, open: v[i].open, high: v[i].high, low: v[i].low, close: v[i].close, volume: v[i].volume } as SwingCandle);
    } else {
      const b = sup[sup.length - 1];
      b.high = Math.max(b.high, v[i].high);
      b.low = Math.min(b.low, v[i].low);
      b.close = v[i].close;
      b.volume += v[i].volume;
    }
    idx[i] = sup.length - 1;
  }
  const cerrado = v.map((_, i) => (v[i].openTime + marco >= (claveDe(i) + 1) * cubo ? idx[i] : idx[i] - 1));
  return { sup, cerrado };
}

/** ATR de Wilder de 14 velas (NaN hasta tener historia): el de lib/estrategias.ts, repetido acá para no depender de ese archivo. */
export function atrSmc(v: SwingCandle[], n = 14): number[] {
  const out = new Array<number>(v.length).fill(Number.NaN);
  let prev = Number.NaN;
  let suma = 0;
  for (let i = 1; i < v.length; i += 1) {
    const tr = Math.max(v[i].high - v[i].low, Math.abs(v[i].high - v[i - 1].close), Math.abs(v[i].low - v[i - 1].close));
    if (i < n) {
      suma += tr;
      continue;
    }
    prev = i === n ? (suma + tr) / n : (prev * (n - 1) + tr) / n;
    out[i] = prev;
  }
  return out;
}

/**
 * Las zonas de la temporalidad alta, cada una conocida recién al cierre de la vela alta que la completa. FVG: la primera y la
 * tercera vela no se tocan (alcista si el mínimo de la tercera pasa el máximo de la primera), de 0,5 ATR o más. OB: la última
 * vela contraria antes de un impulso de 3 velas de 1,5 ATR o más que rompe estructura. Una zona vence cuando una vela alta cierra
 * del otro lado de su borde lejano, o a las 40 velas altas.
 */
export function zonasAltas(sup: SwingCandle[], atrAlto: number[]): ZonaAlta[] {
  const out: ZonaAlta[] = [];
  const vencimiento = (z: Omit<ZonaAlta, "vence">): number => {
    for (let m = z.conocida + 1; m < sup.length && m <= z.conocida + VIDA_ZONA; m += 1) {
      if (z.lado === "LONG" ? sup[m].close < z.bajo : sup[m].close > z.alto) return m;
    }
    return z.conocida + VIDA_ZONA + 1;
  };
  for (let k = 2; k < sup.length; k += 1) {
    const t = atrAlto[k];
    if (!Number.isFinite(t) || !(t > 0)) continue;
    const a = sup[k - 2];
    const c = sup[k];
    if (c.low > a.high && c.low - a.high >= FVG_MINIMO_ATR * t) {
      const z = { lado: "LONG" as Lado, bajo: a.high, alto: c.low, tipo: "FVG" as const, conocida: k };
      out.push({ ...z, vence: vencimiento(z) });
    } else if (c.high < a.low && a.low - c.high >= FVG_MINIMO_ATR * t) {
      const z = { lado: "SHORT" as Lado, bajo: c.high, alto: a.low, tipo: "FVG" as const, conocida: k };
      out.push({ ...z, vence: vencimiento(z) });
    }
  }
  for (let j = OB_PREVIAS; j < sup.length - OB_IMPULSO; j += 1) {
    const t = atrAlto[j];
    const o = sup[j];
    if (!Number.isFinite(t) || !(t > 0) || o.close === o.open) continue;
    const alcista = o.close < o.open; // el OB alcista nace de una vela bajista
    let techo = Number.NEGATIVE_INFINITY;
    let piso = Number.POSITIVE_INFINITY;
    for (let m = j + 1; m <= j + OB_IMPULSO; m += 1) {
      techo = Math.max(techo, sup[m].high);
      piso = Math.min(piso, sup[m].low);
    }
    if ((alcista ? techo - o.low : o.high - piso) < OB_DESPLAZAMIENTO_ATR * t) continue;
    let altoPrevio = Number.NEGATIVE_INFINITY;
    let bajoPrevio = Number.POSITIVE_INFINITY;
    for (let m = j - OB_PREVIAS; m < j; m += 1) {
      altoPrevio = Math.max(altoPrevio, sup[m].high);
      bajoPrevio = Math.min(bajoPrevio, sup[m].low);
    }
    if (alcista ? !(techo > altoPrevio) : !(piso < bajoPrevio)) continue;
    const z = { lado: (alcista ? "LONG" : "SHORT") as Lado, bajo: o.low, alto: o.high, tipo: "OB" as const, conocida: j + OB_IMPULSO };
    out.push({ ...z, vence: vencimiento(z) });
  }
  return out;
}

/** La zona está viva en la vela i si ya se conocía en su cierre y no venció (se mira con la última vela alta cerrada). */
const viva = (z: ZonaAlta, cerrado: number[], i: number): boolean => cerrado[i] >= z.conocida && cerrado[i] < z.vence;

export type Barrida = { s: number; lado: Lado; nivel: number; extremo: number };

/**
 * Tomas de liquidez: una vela cuya mecha pasa el mínimo de un pivote (LARGO) o el máximo (CORTO) ya confirmado y que cierra de
 * vuelta del lado de adentro. Un pivote vale hasta PIVOTE_VIDA velas y se consume la primera vez que una mecha lo pasa. Con varios
 * pivotes pasados por la misma vela, cuenta el más cercano al cierre. `extremo` es el mínimo (o máximo) de la vela.
 */
export function barridas(v: SwingCandle[]): Barrida[] {
  const pivotes = findPivots(v, PIVOTE_N);
  const out: Barrida[] = [];
  const vivos: { precio: number; i: number; kind: "high" | "low" }[] = [];
  let p = 0;
  const porConfirmar = [...pivotes].sort((a, b) => a.confirmedAt - b.confirmedAt);
  for (let s = 0; s < v.length; s += 1) {
    while (p < porConfirmar.length && porConfirmar[p].confirmedAt <= s - 1) {
      vivos.push({ precio: porConfirmar[p].price, i: porConfirmar[p].i, kind: porConfirmar[p].kind });
      p += 1;
    }
    const x = v[s];
    let mejorLargo: number | null = null;
    let mejorCorto: number | null = null;
    for (let k = vivos.length - 1; k >= 0; k -= 1) {
      const q = vivos[k];
      if (s - q.i > PIVOTE_VIDA) {
        vivos.splice(k, 1);
        continue;
      }
      if (q.kind === "low" && x.low < q.precio) {
        if (x.close > q.precio && (mejorLargo === null || q.precio > mejorLargo)) mejorLargo = q.precio;
        vivos.splice(k, 1);
      } else if (q.kind === "high" && x.high > q.precio) {
        if (x.close < q.precio && (mejorCorto === null || q.precio < mejorCorto)) mejorCorto = q.precio;
        vivos.splice(k, 1);
      }
    }
    if (mejorLargo !== null) out.push({ s, lado: "LONG", nivel: mejorLargo, extremo: x.low });
    if (mejorCorto !== null) out.push({ s, lado: "SHORT", nivel: mejorCorto, extremo: x.high });
  }
  return out;
}

export type InversionFvg = { c: number; lado: Lado; bajo: number; alto: number };

/**
 * IFVG: un hueco de valor justo de la serie (de 0,3 ATR o más) cerrado por el otro lado, conocido en la vela del cierre. Un hueco
 * bajista cerrado hacia arriba da un IFVG de LARGO; uno alcista cerrado hacia abajo, de CORTO. Vale hasta IFVG_VIDA velas desde
 * que se forma; la primera vela que cierra del otro lado lo invierte.
 */
export function inversionesFvg(v: SwingCandle[], atr14: number[]): InversionFvg[] {
  const out: InversionFvg[] = [];
  for (let a = 2; a < v.length; a += 1) {
    const t = atr14[a];
    if (!Number.isFinite(t) || !(t > 0)) continue;
    const p = v[a - 2];
    const c = v[a];
    const bajista = c.high < p.low && p.low - c.high >= IFVG_MINIMO_ATR * t;
    const alcista = c.low > p.high && c.low - p.high >= IFVG_MINIMO_ATR * t;
    if (!bajista && !alcista) continue;
    const bajo = bajista ? c.high : p.high;
    const alto = bajista ? p.low : c.low;
    for (let m = a + 1; m < v.length && m <= a + IFVG_VIDA; m += 1) {
      if (bajista ? v[m].close > alto : v[m].close < bajo) {
        out.push({ c: m, lado: bajista ? "LONG" : "SHORT", bajo, alto });
        break;
      }
    }
  }
  return out.sort((x, y) => x.c - y.c);
}

/**
 * Las señales de un disparo con una configuración sobre una moneda: `senal(i)` da lado, stop y objetivo si la vela i completa el
 * gatillo dentro de una zona alta viva, o null. El stop va a `margenAtr` ATR más allá del extremo de la toma de liquidez (o, sin
 * ella, del tramo del gatillo) y el objetivo a `rr` veces el riesgo desde el cierre; si el stop queda a más de 4 ATR, no se opera.
 * Una señal por toma de liquidez (o por zona, en ZONA).
 */
export function senalesSmc(v: SwingCandle[], atr14: number[], disparo: DisparoSmc, cfg: ConfiguracionSmc, ctx?: ContextoSmc): (i: number) => Senal | null {
  const señales = new Array<Senal | null>(v.length).fill(null);
  if (v.length < 60) return (i) => señales[i] ?? null;
  const { sup, cerrado } = cubosAltos(v);
  const zonas = zonasAltas(sup, atrSmc(sup)).filter((z) => cfg.zonas === "AMBAS" || z.tipo === cfg.zonas);
  const inv = inversionesFvg(v, atr14);
  const bks = breakersCausales(v, atr14, DESPLAZAMIENTO_BREAKER);

  /** La zona más reciente del lado, viva en la vela i, a la que la vela i está tocando sin cerrar del otro lado. */
  const zonaTocada = (lado: Lado, i: number, adentro: boolean): ZonaAlta | null => {
    let mejor: ZonaAlta | null = null;
    const x = v[i];
    for (const z of zonas) {
      if (z.lado !== lado || !viva(z, cerrado, i)) continue;
      const toca = lado === "LONG" ? x.low <= z.alto : x.high >= z.bajo;
      const dentro = lado === "LONG" ? x.close >= z.bajo : x.close <= z.alto;
      if (!toca || (adentro && !dentro)) continue;
      if (!mejor || z.conocida > mejor.conocida) mejor = z;
    }
    return mejor;
  };
  const filtro = ctx?.filtro ?? "NINGUNO";
  const emas = filtro === "EMAS" || filtro === "TODO" ? PERIODOS_EMAS.map((n) => emaSmc(v.map((x) => x.close), n)) : [];
  const pasaFiltro = (e: number, lado: Lado): boolean => {
    if (filtro === "NINGUNO" || !ctx) return true;
    const c = v[e].close;
    const dir = lado === "LONG" ? 1 : -1;
    if (filtro === "PERFIL" || filtro === "TODO") if (!Number.isFinite(ctx.poc[e]) || (c - ctx.poc[e]) * dir <= 0) return false;
    if (filtro === "SUPERTREND" || filtro === "TODO") if (ctx.stDir[e] !== dir) return false;
    if (filtro === "EMAS" || filtro === "TODO") {
      for (let k = 0; k < emas.length; k += 1) if (!Number.isFinite(emas[k][e])) return false;
      for (let k = 0; k + 1 < emas.length; k += 1) if ((emas[k][e] - emas[k + 1][e]) * dir <= 0) return false;
    }
    return true;
  };
  const poner = (e: number, lado: Lado, extremo: number): void => {
    const t = atr14[e];
    if (señales[e] || !pasaFiltro(e, lado) || !Number.isFinite(t) || !(t > 0)) return;
    const c = v[e].close;
    const stop = lado === "LONG" ? extremo - cfg.margenAtr * t : extremo + cfg.margenAtr * t;
    const riesgo = Math.abs(c - stop);
    if (!(riesgo > 0) || (lado === "LONG" ? stop >= c : stop <= c) || riesgo > RIESGO_MAXIMO_ATR * t) return;
    señales[e] = { lado, stop, objetivo: lado === "LONG" ? c + cfg.rr * riesgo : c - cfg.rr * riesgo };
  };
  /** Ninguna vela entre desde y hasta (incluidas) cerró del otro lado de la zona. */
  const sinRoturaDeZona = (z: ZonaAlta, desde: number, hasta: number): boolean => {
    for (let m = desde; m <= hasta; m += 1) if (z.lado === "LONG" ? v[m].close < z.bajo : v[m].close > z.alto) return false;
    return true;
  };
  const extremoEntre = (lado: Lado, desde: number, hasta: number): number => {
    let e = lado === "LONG" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    for (let m = desde; m <= hasta; m += 1) e = lado === "LONG" ? Math.min(e, v[m].low) : Math.max(e, v[m].high);
    return e;
  };

  if (disparo === "ZONA") {
    const gastadas = new Set<ZonaAlta>();
    for (let i = 0; i < v.length; i += 1) {
      for (const lado of ["LONG", "SHORT"] as const) {
        const z = zonaTocada(lado, i, true);
        if (!z || gastadas.has(z)) continue;
        const favorable = lado === "LONG" ? v[i].close > z.alto : v[i].close < z.bajo;
        if (!favorable) continue;
        gastadas.add(z);
        poner(i, lado, lado === "LONG" ? v[i].low : v[i].high);
      }
    }
  } else if (disparo === "IFVG_BREAKER") {
    const gastados = new Set<number>();
    for (const f of inv) {
      for (const b of bks) {
        if (b.lado !== f.lado || Math.abs(b.rotaEn - f.c) > VENTANA_CONFIRMACION) continue;
        const e = Math.max(f.c, b.rotaEn);
        if (gastados.has(e) || e >= v.length) continue;
        const desde = Math.max(0, e - VENTANA_CONFIRMACION);
        const z = zonaTocada(f.lado, e, false);
        if (!z) continue;
        // La zona tocada en el tramo: algún mínimo (o máximo) del tramo llega a ella, y ningún cierre la pasa por completo.
        const llega = f.lado === "LONG" ? extremoEntre("LONG", desde, e) <= z.alto : extremoEntre("SHORT", desde, e) >= z.bajo;
        if (!llega || !sinRoturaDeZona(z, desde, e)) continue;
        gastados.add(e);
        poner(e, f.lado, extremoEntre(f.lado, desde, e));
      }
    }
  } else {
    for (const s of barridas(v)) {
      const z = zonaTocada(s.lado, s.s, true);
      if (!z) continue;
      const hasta = Math.min(v.length - 1, s.s + VENTANA_CONFIRMACION);
      let e: number | null = null;
      if (disparo === "BARRIDA") e = s.s;
      else {
        const iv = inv.find((f) => f.lado === s.lado && f.c >= s.s && f.c <= hasta);
        const bk = bks.find((b) => b.lado === s.lado && b.rotaEn >= s.s && b.rotaEn <= hasta);
        if (disparo === "BARRIDA_IFVG" && iv) e = iv.c;
        else if (disparo === "BARRIDA_BREAKER" && bk) e = bk.rotaEn;
        else if (disparo === "BARRIDA_IFVG_BREAKER" && iv && bk) e = Math.max(iv.c, bk.rotaEn);
      }
      // La zona tiene que seguir viva y sin cerrar por el otro lado hasta el gatillo.
      if (e === null || !viva(z, cerrado, e) || !sinRoturaDeZona(z, s.s, e)) continue;
      poner(e, s.lado, extremoEntre(s.lado, s.s, e));
    }
  }
  return (i) => señales[i] ?? null;
}
