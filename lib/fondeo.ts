/**
 * Cuentas de fondeo (prop firms) para XAUUSDT, XAGUSDT (plata) y NASDAQ, con prioridad, y el «Agente Fondeo»: un agente SIN estrategia propia
 * que se conecta a los demás (la mesa de JARVIS TRADING y los agentes del laboratorio le pasan sus propuestas) y las pasa por la
 * compuerta de las reglas de la cuenta de fondeo: pérdida diaria, pérdida total y objetivo. Si una propuesta rompería un límite
 * (o se queda sin margen), la ajusta a la baja o la frena y dice por qué. No inventa señales, no mide aciertos y no manda órdenes.
 * Los límites de cada firma cambian: los valores por defecto son un ejemplo típico y la persona pone los de su cuenta, dentro de
 * topes. El perpetuo de Binance puede diferir unos dólares del precio de tu broker. Pura. No es asesoramiento financiero.
 */

export type InstrumentoFondeo = {
  clave: "XAU" | "XAG" | "NASDAQ";
  nombre: string;
  /** Símbolo del perpetuo en Binance; null mientras no esté confirmado (no se adivina). */
  symbol: string | null;
  /** Menor = más prioridad. */
  prioridad: number;
};

/**
 * El símbolo del NASDAQ en Binance TradFi: pendiente de confirmar por la persona en Binance. Mientras sea null el NASDAQ figura
 * como «sin símbolo» y no se lee ningún dato (nunca se inventa uno). Se completa acá, en un solo lugar.
 */
export const NASDAQ_SIMBOLO: string | null = null;

/**
 * Los símbolos confirmados en Axi (MT5), leídos de la cuenta con get_mt5_available_markets el 15/10/2026. Son de OTRO
 * mercado que los de Binance: XAUUSD.c es un CFD de oro y USTECH un CFD sobre el índice, con su propio precio, su propio
 * spread y su propio horario. NUNCA se mezclan con XAUUSDT de Binance en una misma medición: serían dos series distintas
 * leídas como si fueran una. Acá solo quedan anotados; el agente de papel sigue leyendo Binance.
 */
export const SIMBOLOS_AXI = Object.freeze({
  XAU: "XAUUSD.c",
  NASDAQ: "USTECH",
}) as Readonly<Record<"XAU" | "NASDAQ", string>>;

export const INSTRUMENTOS_FONDEO: readonly InstrumentoFondeo[] = Object.freeze([
  { clave: "XAU", nombre: "Oro", symbol: "XAUUSDT", prioridad: 1 },
  { clave: "XAG", nombre: "Plata", symbol: "XAGUSDT", prioridad: 2 },
  { clave: "NASDAQ", nombre: "NASDAQ", symbol: NASDAQ_SIMBOLO, prioridad: 3 },
]);

export const simbolosFondeo = (): string[] => INSTRUMENTOS_FONDEO.flatMap((i) => (i.symbol ? [i.symbol] : []));
export const esDeFondeo = (symbol: string): boolean => simbolosFondeo().includes(symbol.toUpperCase());
/** Prioridad de un símbolo (1 = la más alta); 99 si no es de fondeo. */
export const prioridadFondeo = (symbol: string): number => INSTRUMENTOS_FONDEO.find((i) => i.symbol !== null && i.symbol === symbol.toUpperCase())?.prioridad ?? 99;

export type ReglasFondeo = {
  /** Capital con el que se abrió la cuenta, en dólares: sobre él se miden los porcentajes. */
  capitalInicial: number;
  /** Pérdida máxima del día, en % del capital inicial. */
  perdidaDiariaPct: number;
  /** Pérdida máxima total, en % del capital inicial. */
  perdidaTotalPct: number;
  /** Objetivo de ganancia, en % del capital inicial. */
  objetivoPct: number;
  /** Riesgo por operación, en % del capital inicial. */
  riesgoPorOperacionPct: number;
  /** Colchón que no se toca: el agente frena antes de llegar al límite real. */
  colchonPct: number;
};

/** Valores típicos de ejemplo (varían por firma): 5 % diario, 10 % total y 10 % de objetivo. La persona pone los de su cuenta. */
export const REGLAS_FONDEO_DEFECTO: Readonly<ReglasFondeo> = Object.freeze({
  capitalInicial: 10_000,
  perdidaDiariaPct: 5,
  perdidaTotalPct: 10,
  objetivoPct: 10,
  riesgoPorOperacionPct: 0.5,
  colchonPct: 1,
});

export const TOPES_FONDEO: Readonly<Record<keyof ReglasFondeo, { min: number; max: number }>> = Object.freeze({
  capitalInicial: { min: 100, max: 5_000_000 },
  perdidaDiariaPct: { min: 0.5, max: 10 },
  perdidaTotalPct: { min: 1, max: 20 },
  objetivoPct: { min: 1, max: 30 },
  riesgoPorOperacionPct: { min: 0.1, max: 2 },
  colchonPct: { min: 0, max: 3 },
});

/** Lo que llega (de la pantalla) llevado a los topes; lo que falta o no es número queda en el valor por defecto. */
export function normalizarReglasFondeo(raw: unknown): Readonly<ReglasFondeo> {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = { ...REGLAS_FONDEO_DEFECTO } as ReglasFondeo;
  for (const k of Object.keys(TOPES_FONDEO) as (keyof ReglasFondeo)[]) {
    const v = o[k];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    out[k] = Math.min(TOPES_FONDEO[k].max, Math.max(TOPES_FONDEO[k].min, v));
  }
  return Object.freeze(out);
}

/** Lo que la persona carga de su cuenta: el saldo de ahora, el resultado de hoy y el riesgo que ya tiene abierto. */
export type CuentaFondeo = {
  saldo: number;
  /** Ganancia (+) o pérdida (−) de hoy en dólares, incluyendo lo flotante, como la cuenta el broker. */
  resultadoHoy: number;
  /** Riesgo de las operaciones que ya están abiertas, en % del capital inicial. */
  riesgoAbiertoPct: number;
};

export type EstadoFondeo = {
  perdidaHoyPct: number;
  caidaTotalPct: number;
  gananciaPct: number;
  /** Cuánto se puede perder todavía hoy / en total antes del límite, ya sin el colchón. */
  margenDiarioPct: number;
  margenTotalPct: number;
  objetivoCumplido: boolean;
  /** Avance hacia el objetivo, 0 a 1. */
  progresoObjetivo: number;
};

const r2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2).replace(".", ",");

export function estadoFondeo(cuenta: CuentaFondeo, reglas: ReglasFondeo): EstadoFondeo {
  const cap = reglas.capitalInicial;
  const perdidaHoyPct = Math.max(0, (-cuenta.resultadoHoy / cap) * 100);
  const caidaTotalPct = Math.max(0, ((cap - cuenta.saldo) / cap) * 100);
  const gananciaPct = Math.max(0, ((cuenta.saldo - cap) / cap) * 100);
  return {
    perdidaHoyPct,
    caidaTotalPct,
    gananciaPct,
    margenDiarioPct: reglas.perdidaDiariaPct - reglas.colchonPct - perdidaHoyPct,
    margenTotalPct: reglas.perdidaTotalPct - reglas.colchonPct - caidaTotalPct,
    objetivoCumplido: gananciaPct >= reglas.objetivoPct,
    progresoObjetivo: Math.min(1, gananciaPct / reglas.objetivoPct),
  };
}

export type PropuestaFondeo = {
  symbol: string;
  lado: "LONG" | "SHORT";
  /** Quién la propone: «MESA» o el nombre de un agente. */
  origen: string;
  entrada: number;
  stop: number;
  /** R:R ponderado del plan (lo que entrega la mesa); null si no se sabe. */
  rr: number | null;
};

export type VeredictoFondeo = {
  ok: boolean;
  motivos: string[];
  /** Riesgo con el que se opera, en % del capital inicial: el pedido o uno menor si el margen no alcanza; 0 si se frena. */
  riesgoPct: number;
  riesgoUsd: number;
  /** Unidades del instrumento para ese riesgo (no son lotes: depende del contrato de tu broker). */
  unidades: number | null;
  ajustado: boolean;
};

/** R:R mínimo del plan: el mismo que pide el gestor de riesgo del laboratorio (lib/lab-riesgo.ts). */
export const RR_MINIMO_FONDEO = 1.5;
/** Por debajo de este riesgo no vale la pena abrir: se frena en vez de operar con migajas. */
export const RIESGO_MINIMO_PCT = 0.1;

/**
 * La compuerta de fondeo: una propuesta pasa si el riesgo (el pedido, o el que quepa) entra en el margen diario y en el total,
 * contando lo que ya está abierto y el colchón. Si el margen no alcanza al pedido pero sí a uno chico, ajusta a la baja y lo dice.
 */
export function evaluarFondeo(p: PropuestaFondeo, cuenta: CuentaFondeo, reglasRaw: unknown): VeredictoFondeo {
  const reglas = normalizarReglasFondeo(reglasRaw);
  const est = estadoFondeo(cuenta, reglas);
  const motivos: string[] = [];
  const frena = (m: string) => motivos.push(m);
  if (!esDeFondeo(p.symbol)) frena(`${p.symbol} no es un instrumento de fondeo (oro o NASDAQ).`);
  if (!(p.entrada > 0) || !(p.stop > 0) || (p.lado === "LONG" ? p.stop >= p.entrada : p.stop <= p.entrada)) frena("El plan no trae entrada y stop válidos, con el stop del lado correcto.");
  if (p.rr === null || !(p.rr >= RR_MINIMO_FONDEO)) frena(`El R:R del plan ${p.rr === null ? "no se sabe" : `(${r2(p.rr)})`} no llega al mínimo de ${r2(RR_MINIMO_FONDEO)}.`);
  if (est.objetivoCumplido) frena(`El objetivo de ${r2(reglas.objetivoPct)} % ya se cumplió: no se abren más operaciones.`);
  if (!Number.isFinite(cuenta.saldo) || !Number.isFinite(cuenta.resultadoHoy) || !Number.isFinite(cuenta.riesgoAbiertoPct)) frena("Faltan datos de la cuenta (saldo, resultado de hoy o riesgo abierto): sin ellos no se abre.");
  const margen = Math.min(est.margenDiarioPct, est.margenTotalPct) - (Number.isFinite(cuenta.riesgoAbiertoPct) ? cuenta.riesgoAbiertoPct : 0);
  const pedido = reglas.riesgoPorOperacionPct;
  const riesgoPct = Math.min(pedido, Math.max(0, margen));
  if (margen < RIESGO_MINIMO_PCT) {
    frena(
      est.margenDiarioPct <= est.margenTotalPct
        ? `Sin margen hoy: ya perdiste ${r2(est.perdidaHoyPct)} % del ${r2(reglas.perdidaDiariaPct)} % diario (con ${r2(reglas.colchonPct)} % de colchón y ${r2(cuenta.riesgoAbiertoPct)} % abierto).`
        : `Sin margen total: la caída es de ${r2(est.caidaTotalPct)} % sobre el límite de ${r2(reglas.perdidaTotalPct)} % (con ${r2(reglas.colchonPct)} % de colchón y ${r2(cuenta.riesgoAbiertoPct)} % abierto).`,
    );
  }
  const ok = motivos.length === 0;
  const riesgo = ok ? riesgoPct : 0;
  const riesgoUsd = (riesgo / 100) * reglas.capitalInicial;
  const dist = Math.abs(p.entrada - p.stop);
  return {
    ok,
    motivos,
    riesgoPct: riesgo,
    riesgoUsd,
    unidades: ok && dist > 0 ? riesgoUsd / dist : null,
    ajustado: ok && riesgo < pedido - 1e-9,
  };
}

export type DecisionFondeo = {
  /** La propuesta elegida (la de más prioridad que pasa la compuerta), o null si ninguna pasa. */
  elegida: { propuesta: PropuestaFondeo; veredicto: VeredictoFondeo } | null;
  /** Todas, en el orden en que se miraron, cada una con su veredicto. */
  revisadas: { propuesta: PropuestaFondeo; veredicto: VeredictoFondeo }[];
  estado: EstadoFondeo;
};

/**
 * El Agente Fondeo: recibe las propuestas de los demás agentes y de la mesa, las ordena (instrumento de más prioridad primero y,
 * dentro del mismo instrumento, mejor R:R) y elige la primera que pasa la compuerta. Solo UNA a la vez: las cuentas de fondeo
 * se cuidan con pocas posiciones. No crea propuestas ni les cambia el plan; solo ajusta el riesgo a la baja o las frena.
 */
export function agenteFondeo(propuestas: PropuestaFondeo[], cuenta: CuentaFondeo, reglasRaw: unknown): DecisionFondeo {
  const reglas = normalizarReglasFondeo(reglasRaw);
  const orden = [...propuestas].sort((a, b) => prioridadFondeo(a.symbol) - prioridadFondeo(b.symbol) || (b.rr ?? -1) - (a.rr ?? -1));
  const revisadas = orden.map((propuesta) => ({ propuesta, veredicto: evaluarFondeo(propuesta, cuenta, reglas) }));
  return { elegida: revisadas.find((x) => x.veredicto.ok) ?? null, revisadas, estado: estadoFondeo(cuenta, reglas) };
}
