/**
 * El contexto común de la terminal (docs/terminal-unificada.md, fase B): la forma en que un dato llega a cualquier agente,
 * con su fuente, su mercado (Spot o Futures), la hora del dato y la de recepción, la temporalidad, la unidad, cómo se
 * calculó y su estado de calidad. Un dato que falta no es cero: queda DATA UNAVAILABLE con el motivo; uno viejo, STALE
 * DATA; uno sin muestra suficiente o incoherente, INSUFFICIENT DATA. Spot y Futures no se mezclan: si las fuentes no
 * declaran el mismo mercado, el contexto queda sin mercado y lo avisa, en vez de elegir uno.
 *
 * No crea otra foto del mercado: envuelve la que ya arma la mesa de JARVIS (lib/jarvis-desk-data.ts, DeskSnapshot). El
 * flujo de órdenes por operación (footprint, cinta, libro) todavía no entra en esa foto: queda declarado como no
 * disponible, con el motivo, hasta la fase C. Pura: sin red, sin base y sin reloj propio (la hora llega como dato).
 */
import type { DeskSnapshot } from "./jarvis-desk-data.ts";
import type { SwingCandle } from "./swing-entries.ts";

/** Versión de esta metodología: va con cada contexto para saber con qué reglas se armó. */
export const VERSION_CONTEXTO = "CONTEXTO_1";

export type Mercado = "SPOT" | "FUTURES";
export type Calidad = "OK" | "STALE_DATA" | "DATA_UNAVAILABLE" | "INSUFFICIENT_DATA";

/** Lo que se muestra al lado del dato, con el vocabulario del documento de la plataforma. */
export const TEXTO_CALIDAD: Record<Calidad, string> = {
  OK: "OK",
  STALE_DATA: "STALE DATA",
  DATA_UNAVAILABLE: "DATA UNAVAILABLE",
  INSUFFICIENT_DATA: "INSUFFICIENT DATA",
};

export type Dato<T> = {
  /** null solo cuando el dato no está (DATA UNAVAILABLE). Viejo o con muestra corta, el valor sigue, marcado. */
  valor: T | null;
  calidad: Calidad;
  /** Por qué no está OK, en palabras; vacío si está OK. */
  motivo: string;
  fuente: string;
  /** null cuando la fuente no lo declara: no se supone. */
  mercado: Mercado | null;
  /** Hora del dato según la fuente (ms); null si la fuente no la da. */
  ts: number | null;
  /** Hora en que la app lo recibió (ms), cuando corresponde. */
  recibido: number | null;
  temporalidad: string | null;
  /** Unidad y significado del valor. */
  unidad: string;
  /** Cómo se calculó, si es derivado; null si es el dato tal como lo da la fuente. */
  metodo: string | null;
};

/** Lo que se sabe de dónde viene un dato, antes de mirar el dato. */
export type Origen = {
  fuente: string;
  unidad: string;
  mercado?: Mercado | null;
  temporalidad?: string | null;
  metodo?: string | null;
  recibido?: number | null;
};

/** Diferencia de reloj tolerada entre la fuente y el navegador antes de llamar «del futuro» a un dato. */
export const TOLERANCIA_RELOJ_MS = 60_000;

const GRAVEDAD: Calidad[] = ["DATA_UNAVAILABLE", "STALE_DATA", "INSUFFICIENT_DATA"];
type Problema = [Calidad, string];

function armar<T>(valor: T | null, ts: number | null, origen: Origen, problemas: Problema[]): Dato<T> {
  const calidad = GRAVEDAD.find((g) => problemas.some(([c]) => c === g)) ?? "OK";
  return {
    valor: calidad === "DATA_UNAVAILABLE" ? null : valor,
    calidad,
    motivo: problemas.map(([, m]) => m).join("; "),
    fuente: origen.fuente,
    mercado: origen.mercado ?? null,
    ts,
    recibido: origen.recibido ?? null,
    temporalidad: origen.temporalidad ?? null,
    unidad: origen.unidad,
    metodo: origen.metodo ?? null,
  };
}

/** Una duración en palabras, con coma decimal: «12 min», «3,5 h». */
export function hace(ms: number): string {
  const min = Math.max(0, ms) / 60_000;
  return min < 120 ? `${Math.round(min)} min` : `${(min / 60).toFixed(1).replace(".", ",")} h`;
}

/** Un dato que no está, con el motivo. */
export function sinDato<T>(origen: Origen, motivo: string): Dato<T> {
  return armar<T>(null, null, origen, [["DATA_UNAVAILABLE", motivo]]);
}

export type Control = { ahora: number; maxEdadMs: number; muestra?: number; minMuestra?: number };

/**
 * El estado de un dato cualquiera: no está → DATA UNAVAILABLE; sin hora (ni de la fuente ni de recepción) o con hora en
 * el futuro → INSUFFICIENT DATA; más viejo que `maxEdadMs` → STALE DATA; con menos muestra que `minMuestra` → INSUFFICIENT
 * DATA. Si la fuente no da su hora, la frescura se mide con la de recepción, y `ts` queda null para que se vea.
 */
export function evaluarDato<T>(valor: T | null | undefined, ts: number | null | undefined, origen: Origen, control: Control): Dato<T> {
  if (valor === null || valor === undefined) return sinDato<T>(origen, "la fuente no devolvió el dato");
  const problemas: Problema[] = [];
  const hora = ts ?? origen.recibido ?? null;
  if (hora === null || !Number.isFinite(hora)) problemas.push(["INSUFFICIENT_DATA", "sin hora: no se puede saber de cuándo es"]);
  else if (hora > control.ahora + TOLERANCIA_RELOJ_MS) problemas.push(["INSUFFICIENT_DATA", "la hora del dato está en el futuro"]);
  else if (control.ahora - hora > control.maxEdadMs) problemas.push(["STALE_DATA", `de hace ${hace(control.ahora - hora)}`]);
  if (control.minMuestra !== undefined && (control.muestra ?? 0) < control.minMuestra) {
    problemas.push(["INSUFFICIENT_DATA", `muestra de ${control.muestra ?? 0} (mínimo ${control.minMuestra})`]);
  }
  return armar(valor, ts ?? null, origen, problemas);
}

const coherente = (v: SwingCandle) =>
  [v.open, v.high, v.low, v.close].every((p) => Number.isFinite(p) && p > 0) &&
  Number.isFinite(v.volume) &&
  v.volume >= 0 &&
  v.high >= Math.max(v.open, v.close) &&
  v.low <= Math.min(v.open, v.close);

const igual = (a: SwingCandle, b: SwingCandle) => a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close && a.volume === b.volume;

/**
 * Velas cerradas de una temporalidad como dato. Normaliza: ordena por hora, une repetidas idénticas y deja afuera las que
 * todavía no cerraron (así nada mira una vela a medio hacer). Marca INSUFFICIENT DATA si hay velas incoherentes (máximo por
 * debajo del cuerpo, precios no positivos) o repetidas con valores distintos (se descartan y se dice cuántas), o si quedan
 * menos que `minVelas`; STALE DATA si la última cerró hace más de dos velas. La hora del dato es el cierre de la última.
 */
export function velasComoDato(velas: SwingCandle[] | null | undefined, frameMs: number, origen: Origen, ahora: number, minVelas: number): Dato<SwingCandle[]> {
  if (!velas) return sinDato(origen, "la fuente no respondió");
  const porHora = new Map<number, SwingCandle>();
  const enConflicto = new Set<number>();
  for (const v of velas) {
    if (v.openTime + frameMs > ahora) continue;
    const antes = porHora.get(v.openTime);
    if (antes && !igual(antes, v)) enConflicto.add(v.openTime);
    porHora.set(v.openTime, v);
  }
  for (const t of enConflicto) porHora.delete(t);
  const ordenadas = [...porHora.values()].sort((a, b) => a.openTime - b.openTime);
  const sanas = ordenadas.filter(coherente);
  const problemas: Problema[] = [];
  const incoherentes = ordenadas.length - sanas.length;
  if (incoherentes) problemas.push(["INSUFFICIENT_DATA", `${incoherentes} ${incoherentes === 1 ? "vela incoherente descartada" : "velas incoherentes descartadas"}`]);
  if (enConflicto.size) problemas.push(["INSUFFICIENT_DATA", `${enConflicto.size} ${enConflicto.size === 1 ? "vela repetida" : "velas repetidas"} con valores distintos, descartadas`]);
  const ultima = sanas.at(-1);
  if (!ultima) return sinDato(origen, velas.length ? "ninguna vela cerrada y coherente" : "sin velas: la fuente no respondió o no devolvió ninguna");
  const cierre = ultima.openTime + frameMs;
  if (ahora - cierre > 2 * frameMs) problemas.push(["STALE_DATA", `la última vela cerró hace ${hace(ahora - cierre)}`]);
  if (sanas.length < minVelas) problemas.push(["INSUFFICIENT_DATA", `${sanas.length} velas (mínimo ${minVelas})`]);
  return armar(sanas, cierre, origen, problemas);
}

/**
 * El mercado de una fuente de velas tal como la nombra lib/market-fetch.ts (loadRows) o lib/jarvis-desk-data.ts. Lo que no
 * dice su mercado (la copia del servidor, por ejemplo) devuelve null: no se supone.
 */
export function mercadoDeFuente(fuente: string | null | undefined): Mercado | null {
  const f = (fuente ?? "").toLowerCase();
  if (/\bfutur/.test(f)) return "FUTURES";
  if (/\bspot\b/.test(f)) return "SPOT";
  return null;
}

/** Si una fuente de velas es, con seguridad, del mercado pedido. Sin mercado declarado, no. */
export const mismoMercado = (fuente: string | null | undefined, mercado: Mercado) => mercadoDeFuente(fuente) === mercado;

/** El mercado común de varias fuentes, solo si todas lo declaran y es el mismo; si no, null y el aviso. */
export function mercadoComun(fuentes: string[]): { mercado: Mercado | null; aviso: string | null } {
  if (!fuentes.length) return { mercado: null, aviso: "las velas no dicen de qué mercado son" };
  const mercados = fuentes.map(mercadoDeFuente);
  const sinDeclarar = fuentes.filter((_, k) => mercados[k] === null);
  if (sinDeclarar.length) return { mercado: null, aviso: `sin mercado declarado: ${sinDeclarar.join(", ")}` };
  const distintos = new Set(mercados);
  if (distintos.size > 1) return { mercado: null, aviso: `velas de Spot y de Futures (${fuentes.join(" + ")}): no se mezclan, el contexto queda sin mercado` };
  return { mercado: mercados[0], aviso: null };
}

// ── El contexto de la mesa ──

export const MARCO_MS = { "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 } as const;
export type Marco = keyof typeof MARCO_MS;

/**
 * Mínimo de velas cerradas por temporalidad para llamar suficiente a una serie: lo que piden los motores de la mesa para
 * sus medias de 50 y su ATR de 14 con margen. Es una regla fija, no una medición.
 */
export const MIN_VELAS: Record<Marco, number> = { "1h": 50, "4h": 50, "1d": 30 };

/** Antigüedad máxima de lo que no son velas, medida desde que llegó (las fuentes no dan su propia hora en la foto). */
export const MAX_EDAD_MS = {
  derivados: 15 * 60_000,
  liquidaciones: 15 * 60_000,
  noticias: 6 * 3_600_000,
  miedoAvaricia: 26 * 3_600_000,
  calendario: 7 * 86_400_000,
} as const;

type Derivados = NonNullable<DeskSnapshot["derivatives"]>;
type Liquidaciones = NonNullable<DeskSnapshot["liquidations"]>;
type Noticias = NonNullable<DeskSnapshot["news"]>;
type MiedoAvaricia = NonNullable<DeskSnapshot["fearGreed"]>;
type Calendario = NonNullable<DeskSnapshot["macro"]["events"]>;

export type ContextoComun = {
  version: string;
  /** Una por símbolo y momento: dos contextos con el mismo id son la misma foto. */
  id: string;
  simbolo: string;
  creado: number;
  /** El mercado de las velas, solo si todas las fuentes que respondieron declaran el mismo. */
  mercado: Mercado | null;
  velas: Record<Marco, Dato<SwingCandle[]>>;
  btc: Dato<SwingCandle[]>;
  eth: Dato<SwingCandle[]>;
  derivados: Dato<Derivados>;
  liquidaciones: Dato<Liquidaciones>;
  noticias: Dato<Noticias>;
  miedoAvaricia: Dato<MiedoAvaricia>;
  calendario: Dato<Calendario>;
  /** El footprint por operación todavía no llega a la mesa: vive en el mapa de liquidaciones y en el bookmap. */
  footprint: Dato<never>;
  libro: Dato<never>;
  avisos: string[];
};

const PENDIENTE_FLUJO = "la mesa todavía no recibe operaciones una por una ni el libro (fase C de docs/terminal-unificada.md)";

/** El contexto común a partir de la foto que arma la mesa de JARVIS, sin pedir nada nuevo a la red. */
export function contextoDesdeMesa(s: DeskSnapshot): ContextoComun {
  const fuentes = s.venues ?? [];
  const { mercado, aviso } = mercadoComun(fuentes);
  const fuenteVelas = fuentes.length ? fuentes.join(" + ") : "fuente sin registrar";
  const unidadVelas = "OHLC en la moneda de cotización (USDT o USD); volumen en la moneda base";
  const velas = (marco: Marco, serie: SwingCandle[] | null | undefined, fuente = fuenteVelas) =>
    velasComoDato(serie, MARCO_MS[marco], { fuente, unidad: unidadVelas, mercado, temporalidad: marco, recibido: s.now }, s.now, MIN_VELAS[marco]);
  const recibido = (fuente: string, unidad: string) => ({ fuente, unidad, recibido: s.now });
  const derivados = s.derivatives;
  const avisos = aviso ? [aviso] : [];
  if (!fuentes.length) avisos.push("la foto no registra de qué fuente salieron las velas");
  return {
    version: VERSION_CONTEXTO,
    id: `${VERSION_CONTEXTO}:${s.symbol}:${s.now}`,
    simbolo: s.symbol,
    creado: s.now,
    mercado,
    velas: { "1h": velas("1h", s.candles.h1), "4h": velas("4h", s.candles.h4), "1d": velas("1d", s.candles.d1) },
    btc: velas("1h", s.btc),
    eth: velas("1h", s.eth),
    derivados: evaluarDato(derivados, null, { ...recibido(derivados?.source ?? "derivados", "funding en % cada 8 h, interés abierto en contratos y USD"), mercado: "FUTURES" }, { ahora: s.now, maxEdadMs: MAX_EDAD_MS.derivados }),
    liquidaciones: evaluarDato(s.liquidations, null, { ...recibido(s.liquidations?.fuente ?? "liquidaciones", "liquidaciones forzadas reales, en USD"), mercado: "FUTURES" }, { ahora: s.now, maxEdadMs: MAX_EDAD_MS.liquidaciones }),
    noticias: evaluarDato(s.news, null, recibido("titulares de CoinDesk, Cointelegraph, Decrypt, The Block y Bitcoin Magazine", "titulares"), { ahora: s.now, maxEdadMs: MAX_EDAD_MS.noticias }),
    miedoAvaricia: evaluarDato(s.fearGreed, null, recibido("alternative.me", "índice de 0 a 100"), { ahora: s.now, maxEdadMs: MAX_EDAD_MS.miedoAvaricia }),
    calendario: evaluarDato(s.macro.events, null, recibido(s.macro.calendarSource ?? "calendario económico", "eventos de la semana"), { ahora: s.now, maxEdadMs: MAX_EDAD_MS.calendario }),
    footprint: sinDato({ fuente: "operaciones agregadas de Binance Futures (aggTrades)", unidad: "volumen por nivel y lado agresor", mercado: "FUTURES" }, PENDIENTE_FLUJO),
    libro: sinDato({ fuente: "libro de órdenes de Binance", unidad: "profundidad por nivel" }, PENDIENTE_FLUJO),
    avisos,
  };
}

/** Cada parte del contexto que no está OK, con su estado y su motivo, para mostrarlo o para que un agente se abstenga. */
export function problemasDe(c: ContextoComun): { parte: string; calidad: Calidad; motivo: string }[] {
  const partes: [string, Dato<unknown>][] = [
    ["velas 1h", c.velas["1h"]],
    ["velas 4h", c.velas["4h"]],
    ["velas 1d", c.velas["1d"]],
    ["BTC 1h", c.btc],
    ["ETH 1h", c.eth],
    ["derivados", c.derivados],
    ["liquidaciones", c.liquidaciones],
    ["noticias", c.noticias],
    ["miedo y avaricia", c.miedoAvaricia],
    ["calendario", c.calendario],
    ["footprint", c.footprint],
    ["libro", c.libro],
  ];
  return partes.filter(([, d]) => d.calidad !== "OK").map(([parte, d]) => ({ parte, calidad: d.calidad, motivo: d.motivo }));
}

/**
 * Si dos agentes están mirando la misma foto: mismo símbolo, mismo mercado declarado, armadas con menos de `toleranciaMs`
 * de diferencia y con la misma última vela cerrada en cada temporalidad que ambas tienen. Si no, dice por qué.
 */
export function compatibles(a: ContextoComun, b: ContextoComun, toleranciaMs: number): { compatibles: boolean; motivos: string[] } {
  const motivos: string[] = [];
  if (a.simbolo !== b.simbolo) motivos.push(`símbolos distintos (${a.simbolo} y ${b.simbolo})`);
  if (a.mercado === null || b.mercado === null) motivos.push("alguna foto no tiene mercado declarado");
  else if (a.mercado !== b.mercado) motivos.push(`mercados distintos (${a.mercado} y ${b.mercado})`);
  if (Math.abs(a.creado - b.creado) > toleranciaMs) motivos.push(`armadas con ${hace(Math.abs(a.creado - b.creado))} de diferencia`);
  for (const marco of Object.keys(MARCO_MS) as Marco[]) {
    const ta = a.velas[marco].ts;
    const tb = b.velas[marco].ts;
    if (ta !== null && tb !== null && ta !== tb) motivos.push(`${marco}: distinta última vela cerrada`);
  }
  return { compatibles: motivos.length === 0, motivos };
}
