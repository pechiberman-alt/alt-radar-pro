/**
 * El mercado argentino en la terminal: acciones del panel líder de BYMA y CEDEARs, con velas DIARIAS de Yahoo Finance
 * (BYMA llega con demora; Yahoo dice cuántos minutos en `exchangeDataDelayedBy`). De cada CEDEAR se leen dos series: el
 * CEDEAR en pesos en BYMA y la acción de afuera en dólares (el subyacente), sin calcular el CCL, porque eso pide el ratio
 * de cada CEDEAR y ese ratio cambia.
 *
 * FOOTPRINT: no hay. Un footprint auténtico necesita cada operación con su lado agresor, y BYMA no lo publica gratis; con
 * velas diarias solo hay precio y volumen. Se dice, en vez de dibujar uno aproximado.
 *
 * La lectura diaria describe (tendencia por medias, RSI, ATR, distancia al máximo y mínimo de 52 semanas, volumen
 * relativo): no recomienda ni promete nada. Lo que no se puede calcular con las velas que hay queda en null, con el
 * motivo. No es asesoramiento financiero. Pura: sin red (lib/mercado-ar-fuente.ts baja los datos).
 */
import { ema, rsi } from "./oscillators.ts";
import type { SwingCandle } from "./swing-entries.ts";

export type TipoAr = "ACCION" | "CEDEAR";
export type PapelAr = {
  /** Ticker de BYMA, como lo conoce un inversor argentino. */
  ticker: string;
  nombre: string;
  tipo: TipoAr;
  /** Símbolo de Yahoo del papel en BYMA (en pesos). */
  yahoo: string;
  /** Solo CEDEARs: el símbolo de Yahoo de la acción de afuera (en dólares). */
  subyacente?: string;
};

const accion = (ticker: string, nombre: string): PapelAr => ({ ticker, nombre, tipo: "ACCION", yahoo: `${ticker}.BA` });
const cedear = (ticker: string, nombre: string, subyacente = ticker): PapelAr => ({ ticker, nombre, tipo: "CEDEAR", yahoo: `${ticker}.BA`, subyacente });

/** El panel líder de BYMA (lista fija: si un ticker deja de existir, se ve «sin datos», no un número inventado). */
export const ACCIONES_AR: PapelAr[] = [
  accion("ALUA", "Aluar"),
  accion("BBAR", "BBVA Argentina"),
  accion("BMA", "Banco Macro"),
  accion("BYMA", "Bolsas y Mercados Argentinos"),
  accion("CEPU", "Central Puerto"),
  accion("COME", "Sociedad Comercial del Plata"),
  accion("CRES", "Cresud"),
  accion("CVH", "Cablevisión Holding"),
  accion("EDN", "Edenor"),
  accion("GGAL", "Grupo Financiero Galicia"),
  accion("IRSA", "IRSA"),
  accion("LOMA", "Loma Negra"),
  accion("METR", "Metrogas"),
  accion("MIRG", "Mirgor"),
  accion("PAMP", "Pampa Energía"),
  accion("SUPV", "Grupo Supervielle"),
  accion("TECO2", "Telecom Argentina"),
  accion("TGNO4", "Transportadora de Gas del Norte"),
  accion("TGSU2", "Transportadora de Gas del Sur"),
  accion("TRAN", "Transener"),
  accion("TXAR", "Ternium Argentina"),
  accion("VALO", "Grupo Financiero Valores"),
  accion("YPFD", "YPF"),
];

/** CEDEARs muy operados en BYMA, con su acción de afuera. */
export const CEDEARS: PapelAr[] = [
  cedear("AAPL", "Apple"),
  cedear("MSFT", "Microsoft"),
  cedear("GOOGL", "Alphabet"),
  cedear("AMZN", "Amazon"),
  cedear("NVDA", "NVIDIA"),
  cedear("META", "Meta Platforms"),
  cedear("TSLA", "Tesla"),
  cedear("MELI", "MercadoLibre"),
  cedear("KO", "Coca-Cola"),
  cedear("BRKB", "Berkshire Hathaway", "BRK-B"),
  cedear("JPM", "JPMorgan Chase"),
  cedear("V", "Visa"),
  cedear("WMT", "Walmart"),
  cedear("DIS", "Disney"),
  cedear("XOM", "Exxon Mobil"),
  cedear("PFE", "Pfizer"),
  cedear("BABA", "Alibaba"),
  cedear("VIST", "Vista Energy"),
  cedear("NFLX", "Netflix"),
  cedear("AMD", "AMD"),
  cedear("MCD", "McDonald's"),
  cedear("PEP", "PepsiCo"),
  cedear("JNJ", "Johnson & Johnson"),
  cedear("SPY", "SPDR S&P 500 (ETF)"),
  cedear("QQQ", "Invesco QQQ (ETF)"),
];

export const PAPELES_AR: PapelAr[] = [...ACCIONES_AR, ...CEDEARS];

/** Índices de referencia para la mente de O'Neil («M»: el mercado a favor): el Merval para acciones, el S&P 500 para CEDEARs. */
export const INDICE_MERVAL = "^MERV";
export const INDICE_EEUU = "SPY";

/** Los únicos símbolos que la ruta del Worker acepta pedir: no es un proxy abierto. */
export const SIMBOLOS_PERMITIDOS: ReadonlySet<string> = new Set([INDICE_MERVAL, INDICE_EEUU, ...PAPELES_AR.flatMap((p) => (p.subyacente ? [p.yahoo, p.subyacente] : [p.yahoo]))]);

/** El papel de un ticker de BYMA escrito como sea («ggal», «GGAL.BA», «byma»); null si no está en la lista. */
export function papelPorTicker(texto: string): PapelAr | null {
  const t = texto.trim().toUpperCase().replace(/\.BA$/, "");
  return PAPELES_AR.find((p) => p.ticker === t) ?? null;
}

/** Los papeles cuyo ticker o nombre contiene lo buscado (para el buscador del mapa). */
export function buscarPapeles(texto: string, maximo = 12): PapelAr[] {
  const q = texto.trim().toUpperCase();
  if (q.length < 2) return [];
  const sinTildes = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  return PAPELES_AR.filter((p) => p.ticker.includes(q) || sinTildes(p.nombre).includes(sinTildes(q))).slice(0, maximo);
}

export const TEXTO_SIN_FOOTPRINT =
  "FOOTPRINT NO DISPONIBLE: BYMA no publica gratis cada operación con su lado agresor; con velas diarias solo hay precio y volumen.";

export type MetaAr = {
  simbolo: string;
  moneda: string | null;
  bolsa: string | null;
  /** Minutos de demora que declara la fuente; null si no lo dice. */
  demoraMin: number | null;
  /** Último precio publicado y su hora (ms); null si la fuente no los da. */
  precio: number | null;
  horaPrecio: number | null;
};

export type SerieAr = {
  meta: MetaAr;
  /** Ruedas ya cerradas, de la más vieja a la más nueva. */
  velas: SwingCandle[];
  /** La rueda de hoy mientras el mercado está abierto (no entra en ningún cálculo); null si no hay. */
  enCurso: SwingCandle | null;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Lee la respuesta de `query*.finance.yahoo.com/v8/finance/chart/<símbolo>?interval=1d`. Descarta las ruedas con algún
 * precio faltante o incoherente. La rueda de la sesión que todavía no cerró (según `currentTradingPeriod.regular`) queda
 * aparte en `enCurso`: nada la usa como si estuviera cerrada. Null si la respuesta no tiene esa forma.
 */
export function leerYahooChart(json: unknown, ahora: number): SerieAr | null {
  const r = (json as { chart?: { result?: unknown[] } } | null)?.chart?.result?.[0] as
    | {
        meta?: Record<string, unknown> & { currentTradingPeriod?: { regular?: { start?: unknown; end?: unknown } } };
        timestamp?: unknown[];
        indicators?: { quote?: { open?: unknown[]; high?: unknown[]; low?: unknown[]; close?: unknown[]; volume?: unknown[] }[] };
      }
    | undefined;
  const q = r?.indicators?.quote?.[0];
  if (!r?.meta || !Array.isArray(r.timestamp) || !q) return null;
  const m = r.meta;
  const inicioSesion = num(m.currentTradingPeriod?.regular?.start);
  const finSesion = num(m.currentTradingPeriod?.regular?.end);
  const sesionAbierta = inicioSesion !== null && finSesion !== null && ahora >= inicioSesion * 1000 && ahora < finSesion * 1000;
  const velas: SwingCandle[] = [];
  let enCurso: SwingCandle | null = null;
  r.timestamp.forEach((t, k) => {
    const ts = num(t);
    const [open, high, low, close] = [q.open?.[k], q.high?.[k], q.low?.[k], q.close?.[k]].map(num);
    const volume = num(q.volume?.[k]) ?? 0;
    if (ts === null || open === null || high === null || low === null || close === null) return;
    if (!(open > 0 && close > 0 && low > 0) || high < Math.max(open, close) || low > Math.min(open, close)) return;
    // quoteVolume: volumen por cierre, una aproximación del monto operado (la fuente no da el monto).
    const vela: SwingCandle = { openTime: ts * 1000, open, high, low, close, volume, quoteVolume: volume * close };
    if (sesionAbierta && inicioSesion !== null && ts >= inicioSesion) enCurso = vela;
    else if (ts * 1000 <= ahora) velas.push(vela);
  });
  velas.sort((a, b) => a.openTime - b.openTime);
  const unicas = velas.filter((v, k) => k === 0 || v.openTime !== velas[k - 1].openTime);
  return {
    meta: {
      simbolo: typeof m.symbol === "string" ? m.symbol : "",
      moneda: typeof m.currency === "string" ? m.currency : null,
      bolsa: typeof m.fullExchangeName === "string" ? m.fullExchangeName : typeof m.exchangeName === "string" ? m.exchangeName : null,
      demoraMin: num(m.exchangeDataDelayedBy),
      precio: num(m.regularMarketPrice),
      horaPrecio: num(m.regularMarketTime) === null ? null : (num(m.regularMarketTime) as number) * 1000,
    },
    velas: unicas,
    enCurso,
  };
}

/** Una bolsa abre cinco días por semana y tiene feriados: más de cinco días corridos sin rueda nueva es un dato viejo. */
export const MAX_DIAS_SIN_RUEDA = 5;

export type EstadoSerie = { estado: "OK" | "STALE_DATA" | "INSUFFICIENT_DATA" | "DATA_UNAVAILABLE"; motivo: string };

/** El estado de una serie diaria, con el vocabulario del contexto común (lib/contexto-comun.ts). */
export function estadoSerie(serie: SerieAr | null, ahora: number, minRuedas = 30): EstadoSerie {
  if (!serie || !serie.velas.length) return { estado: "DATA_UNAVAILABLE", motivo: "la fuente no devolvió ruedas" };
  const ultima = serie.velas.at(-1)!;
  const dias = (ahora - ultima.openTime) / 86_400_000;
  if (dias > MAX_DIAS_SIN_RUEDA + 1) return { estado: "STALE_DATA", motivo: `la última rueda es de hace ${Math.floor(dias)} días` };
  if (serie.velas.length < minRuedas) return { estado: "INSUFFICIENT_DATA", motivo: `${serie.velas.length} ruedas (mínimo ${minRuedas})` };
  return { estado: "OK", motivo: "" };
}

export type Tendencia = "ALCISTA" | "BAJISTA" | "MIXTA";

export type LecturaDiaria = {
  ruedas: number;
  cierre: number;
  /** Variación en % contra 1, 5 y 20 ruedas antes; null si no hay tantas. */
  var1: number | null;
  var5: number | null;
  var20: number | null;
  ema50: number | null;
  ema200: number | null;
  /** ALCISTA: cierre > media 50 > media 200; BAJISTA: al revés; MIXTA: cualquier otro orden. Null sin 200 ruedas. */
  tendencia: Tendencia | null;
  rsi14: number | null;
  /** ATR de 14 ruedas en % del cierre: cuánto se mueve por día, en promedio. */
  atrPct: number | null;
  /** Distancia del cierre al máximo y al mínimo de las últimas 252 ruedas (un año bursátil), en %. */
  desdeMaximo: number | null;
  desdeMinimo: number | null;
  /** Volumen de la última rueda sobre la mediana de las 20 anteriores. */
  volumenRelativo: number | null;
  /** Lo que no se pudo calcular y por qué. */
  faltantes: string[];
};

const pct = (a: number, b: number) => ((a - b) / b) * 100;

/** La lectura de una serie de ruedas cerradas. Usa solo esas ruedas: nunca la de hoy en curso. */
export function lecturaDiaria(velas: SwingCandle[]): LecturaDiaria | null {
  const n = velas.length;
  if (!n) return null;
  const cierres = velas.map((v) => v.close);
  const cierre = cierres[n - 1];
  const faltantes: string[] = [];
  const varN = (k: number) => (n > k ? pct(cierre, cierres[n - 1 - k]) : null);
  const e50 = n >= 50 ? ema(cierres, 50)[n - 1] : null;
  const e200 = n >= 200 ? ema(cierres, 200)[n - 1] : null;
  if (e200 === null) faltantes.push(`tendencia: hacen falta 200 ruedas (hay ${n})`);
  const tendencia: Tendencia | null =
    e50 === null || e200 === null ? null : cierre > e50 && e50 > e200 ? "ALCISTA" : cierre < e50 && e50 < e200 ? "BAJISTA" : "MIXTA";
  const r = n > 14 ? rsi(cierres, 14)[n - 1] : null;
  if (r === null) faltantes.push("RSI: hacen falta 15 ruedas");
  let atrPct: number | null = null;
  if (n > 14) {
    let suma = 0;
    for (let k = n - 14; k < n; k += 1) {
      const prev = velas[k - 1].close;
      suma += Math.max(velas[k].high - velas[k].low, Math.abs(velas[k].high - prev), Math.abs(velas[k].low - prev));
    }
    atrPct = (suma / 14 / cierre) * 100;
  } else faltantes.push("ATR: hacen falta 15 ruedas");
  const anio = velas.slice(-252);
  const maximo = Math.max(...anio.map((v) => v.high));
  const minimo = Math.min(...anio.map((v) => v.low));
  if (n < 252) faltantes.push(`máximo y mínimo de 52 semanas: con ${n} ruedas, no un año entero`);
  let volumenRelativo: number | null = null;
  if (n > 20) {
    const previos = velas.slice(-21, -1).map((v) => v.volume).sort((a, b) => a - b);
    const mediana = (previos[9] + previos[10]) / 2;
    volumenRelativo = mediana > 0 ? velas[n - 1].volume / mediana : null;
    if (volumenRelativo === null) faltantes.push("volumen relativo: sin volumen en las ruedas anteriores");
  } else faltantes.push("volumen relativo: hacen falta 21 ruedas");
  return {
    ruedas: n,
    cierre,
    var1: varN(1),
    var5: varN(5),
    var20: varN(20),
    ema50: e50,
    ema200: e200,
    tendencia,
    rsi14: r,
    atrPct,
    desdeMaximo: n >= 252 ? pct(cierre, maximo) : null,
    desdeMinimo: n >= 252 ? pct(cierre, minimo) : null,
    volumenRelativo,
    faltantes,
  };
}
