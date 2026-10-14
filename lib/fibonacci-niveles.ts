/**
 * Agente Fibonacci + extensión + niveles clave: opera el retroceso de una pierna de impulso hacia la zona de Fibonacci, con la
 * extensión de esa pierna como objetivo y, si se pide, solo cuando un nivel clave cae dentro de la zona. Todo con velas ya
 * cerradas: una pierna se conoce cuando se confirma su pivote (5 velas después), y los niveles clave son el máximo y el mínimo del
 * día y de la semana ANTERIORES (UTC, semana desde el lunes). No usa los detectores del gráfico, que miran velas posteriores.
 * Pura: sin red ni base. Medición del pasado; no es asesoramiento financiero.
 */
import type { Lado } from "./escalera.ts";
import type { Senal } from "./estrategias.ts";
import { RIESGO_MAXIMO_ATR } from "./breaker-busqueda.ts";
import type { SwingCandle } from "./swing-entries.ts";
import { findPivots, type Pivot } from "./trendlines.ts";

export type ZonaFib = "0.5-0.618" | "0.618-0.786" | "0.5-0.786";
export const ZONAS_FIB: Record<ZonaFib, [number, number]> = { "0.5-0.618": [0.5, 0.618], "0.618-0.786": [0.618, 0.786], "0.5-0.786": [0.5, 0.786] };
/** Extensión de la pierna que se toma como objetivo: 1 = volver al extremo del impulso; 1,272 y 1,618 = más allá. */
export type ExtensionFib = 1 | 1.272 | 1.618;
/**
 * `escalonada`: la escalera propia de Fibonacci, con TP1 en la extensión 1 (volver al extremo del impulso), TP2 en 1,272 y TP3 en 1,618
 * (la `extension` es entonces 1,618). Sin ella, un solo objetivo en `extension` y TP1/TP2 a un tercio y dos tercios del camino.
 */
export type ConfiguracionFib = { zona: ZonaFib; extension: ExtensionFib; nivel: boolean; escalonada?: boolean };

/** La del agente, fijada de antemano con la convención clásica: bolsillo dorado, un nivel clave en la zona y objetivos en las extensiones 1, 1,272 y 1,618. */
export const CONFIGURACION_AGENTE_FIB: ConfiguracionFib = { zona: "0.618-0.786", extension: 1.618, nivel: true, escalonada: true };

export function grillaFib(): ConfiguracionFib[] {
  const out: ConfiguracionFib[] = [];
  for (const nivel of [false, true]) for (const zona of Object.keys(ZONAS_FIB) as ZonaFib[]) for (const extension of [1, 1.272, 1.618] as const) out.push({ zona, extension, nivel });
  return out;
}
export const mismaConfiguracionFib = (a: ConfiguracionFib, b: ConfiguracionFib): boolean => a.zona === b.zona && a.extension === b.extension && a.nivel === b.nivel && !!a.escalonada === !!b.escalonada;
export const etiquetaConfiguracionFib = (c: ConfiguracionFib): string => `zona ${c.zona} · extensión ${c.extension} · ${c.nivel ? "con nivel clave" : "sin nivel clave"}${c.escalonada ? " · objetivos 1, 1,272 y 1,618" : ""}`.replace(/\./g, ",");

/** Pivotes de 5 velas; una pierna mide al menos 2 ATR; vive 80 velas desde su pivote final; el stop va a 0,25 ATR del origen. */
export const PIVOTE_FIB = 5;
export const PIERNA_MINIMA_ATR = 2;
export const VIDA_PIERNA = 80;
export const MARGEN_STOP_ATR = 0.25;
/** Un nivel clave cuenta si cae a 0,25 ATR o menos de la zona. */
export const TOLERANCIA_NIVEL_ATR = 0.25;

export type Pierna = { lado: Lado; origen: number; extremo: number; i: number; conocida: number };

/**
 * Las piernas de impulso en el orden en que se conocen. Alcista: de un mínimo a un máximo que lo sigue. Un pivote nuevo la
 * reemplaza solo si la extiende (un máximo más alto, o un mínimo más bajo en la bajista) o si rompe su origen; un pivote contrario
 * dentro de la pierna es el retroceso y no la cambia.
 */
export function piernas(v: SwingCandle[], atr14: number[]): Pierna[] {
  const pivotes = findPivots(v, PIVOTE_FIB).sort((a, b) => a.confirmedAt - b.confirmedAt || a.i - b.i);
  const out: Pierna[] = [];
  let actual: Pierna | null = null;
  let ultimoAlto: Pivot | null = null;
  let ultimoBajo: Pivot | null = null;
  const nueva = (lado: Lado, origen: Pivot, fin: Pivot): Pierna | null => {
    const t = atr14[fin.i];
    if (!Number.isFinite(t) || !(t > 0) || Math.abs(fin.price - origen.price) < PIERNA_MINIMA_ATR * t) return null;
    return { lado, origen: origen.price, extremo: fin.price, i: fin.i, conocida: fin.confirmedAt };
  };
  for (const p of pivotes) {
    if (p.kind === "high") {
      if (actual?.lado === "LONG" && p.price > actual.extremo && ultimoBajo) actual = nueva("LONG", ultimoBajo, p) ?? actual;
      else if (actual?.lado === "SHORT" && p.price > actual.origen) actual = ultimoBajo ? nueva("LONG", ultimoBajo, p) : null;
      else if (!actual) actual = ultimoBajo ? nueva("LONG", ultimoBajo, p) : null;
      ultimoAlto = p;
    } else {
      if (actual?.lado === "SHORT" && p.price < actual.extremo && ultimoAlto) actual = nueva("SHORT", ultimoAlto, p) ?? actual;
      else if (actual?.lado === "LONG" && p.price < actual.origen) actual = ultimoAlto ? nueva("SHORT", ultimoAlto, p) : null;
      else if (!actual) actual = ultimoAlto ? nueva("SHORT", ultimoAlto, p) : null;
      ultimoBajo = p;
    }
    if (actual && (out.length === 0 || out[out.length - 1].i !== actual.i || out[out.length - 1].lado !== actual.lado)) {
      if (actual.i === p.i) out.push(actual);
    }
  }
  return out;
}

/** Máximo y mínimo del día y de la semana anteriores (UTC) para cada vela; NaN sin historia. Orden: [PDH, PDL, PWH, PWL]. */
export function nivelesClave(v: SwingCandle[]): number[][] {
  const DIA = 86_400_000;
  const SEMANA = 7 * DIA;
  const LUNES = 4 * DIA; // el 1/1/1970 fue jueves: el lunes más cercano hacia atrás es 4 días después de la época
  const claveDia = (t: number) => Math.floor(t / DIA);
  const claveSemana = (t: number) => Math.floor((t - LUNES) / SEMANA);
  const out: number[][] = new Array(v.length);
  const sigue = (clave: (t: number) => number) => {
    let actual = Number.NaN;
    let hi = Number.NEGATIVE_INFINITY;
    let lo = Number.POSITIVE_INFINITY;
    let prevHi = Number.NaN;
    let prevLo = Number.NaN;
    return (i: number): [number, number] => {
      const k = clave(v[i].openTime);
      if (k !== actual) {
        if (Number.isFinite(actual)) {
          prevHi = hi;
          prevLo = lo;
        }
        // Un hueco de más de un período deja sin nivel (no se inventa uno).
        if (Number.isFinite(actual) && k - actual > 1) {
          prevHi = Number.NaN;
          prevLo = Number.NaN;
        }
        actual = k;
        hi = Number.NEGATIVE_INFINITY;
        lo = Number.POSITIVE_INFINITY;
      }
      hi = Math.max(hi, v[i].high);
      lo = Math.min(lo, v[i].low);
      return [prevHi, prevLo];
    };
  };
  const dia = sigue(claveDia);
  const semana = sigue(claveSemana);
  for (let i = 0; i < v.length; i += 1) {
    const [dh, dl] = dia(i);
    const [wh, wl] = semana(i);
    out[i] = [dh, dl, wh, wl];
  }
  return out;
}

/**
 * Las señales con una configuración: `senal(i)` da lado, stop y objetivo si la vela i toca la zona de Fibonacci de una pierna viva
 * y cierra a favor (vela alcista para el largo, bajista para el corto) sin cerrar más allá de la zona. Una señal por pierna. Stop
 * a 0,25 ATR del origen de la pierna; objetivo en la extensión pedida. Con `nivel`, un nivel clave tiene que caer en la zona.
 */
export function senalesFib(v: SwingCandle[], atr14: number[], cfg: ConfiguracionFib): (i: number) => Senal | null {
  const señales = new Array<Senal | null>(v.length).fill(null);
  if (v.length < 60) return (i) => señales[i] ?? null;
  const [f1, f2] = ZONAS_FIB[cfg.zona];
  const niveles = cfg.nivel ? nivelesClave(v) : [];
  const ps = piernas(v, atr14);
  for (let k = 0; k < ps.length; k += 1) {
    const p = ps[k];
    const largo = p.lado === "LONG";
    const tamaño = Math.abs(p.extremo - p.origen);
    const borde1 = largo ? p.extremo - f1 * tamaño : p.extremo + f1 * tamaño; // el más cercano al extremo
    const borde2 = largo ? p.extremo - f2 * tamaño : p.extremo + f2 * tamaño; // el más lejano
    const hasta = Math.min(v.length - 1, p.i + VIDA_PIERNA, k + 1 < ps.length ? ps[k + 1].conocida : v.length - 1);
    for (let i = p.conocida; i <= hasta; i += 1) {
      const x = v[i];
      const t = atr14[i];
      if (!Number.isFinite(t) || !(t > 0)) continue;
      // La pierna muere si el precio cierra más allá de su origen o supera su extremo.
      if (largo ? x.close < p.origen || x.high > p.extremo : x.close > p.origen || x.low < p.extremo) break;
      const toca = largo ? x.low <= borde1 : x.high >= borde1;
      const dentro = largo ? x.close >= borde2 : x.close <= borde2;
      const aFavor = largo ? x.close > x.open : x.close < x.open;
      if (!toca || !dentro || !aFavor) continue;
      if (cfg.nivel) {
        const bajo = Math.min(borde1, borde2) - TOLERANCIA_NIVEL_ATR * t;
        const alto = Math.max(borde1, borde2) + TOLERANCIA_NIVEL_ATR * t;
        if (!niveles[i].some((n) => Number.isFinite(n) && n >= bajo && n <= alto)) continue;
      }
      const stop = largo ? p.origen - MARGEN_STOP_ATR * t : p.origen + MARGEN_STOP_ATR * t;
      const objetivo = largo ? p.extremo + (cfg.extension - 1) * tamaño : p.extremo - (cfg.extension - 1) * tamaño;
      const riesgo = Math.abs(x.close - stop);
      const valido = largo ? stop < x.close && objetivo > x.close : stop > x.close && objetivo < x.close;
      if (valido && riesgo > 0 && riesgo <= RIESGO_MAXIMO_ATR * t) {
        const tp1 = p.extremo;
        const tp2 = largo ? p.extremo + 0.272 * tamaño : p.extremo - 0.272 * tamaño;
        const ordenados = largo ? tp1 > x.close && tp2 > tp1 && objetivo > tp2 : tp1 < x.close && tp2 < tp1 && objetivo < tp2;
        señales[i] = cfg.escalonada ? (ordenados ? { lado: p.lado, stop, objetivo, tp1, tp2 } : null) : { lado: p.lado, stop, objetivo };
      }
      break; // una señal por pierna: la primera vela que la cumple cierra el intento, opere o no
    }
  }
  return (i) => señales[i] ?? null;
}
