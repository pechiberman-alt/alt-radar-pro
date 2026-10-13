import { arNumber } from "./ai-numbers.ts";
import { gates, signed, type Compuerta } from "./jarvis-council.ts";
import { assembleSnapshot, closedCandles, type DeskSnapshot, type MarketContext } from "./jarvis-desk-data.ts";
import { runDesk, type DeskDecision, type DeskSettings, type Direction, type RiskLevel, type Side } from "./jarvis-desk.ts";
import type { SwingCandle } from "./swing-entries.ts";

/**
 * El escáner de todo el mercado de JARVIS TRADING: la misma mesa de siempre,
 * moneda por moneda, sobre todos los contratos de Binance Futures con volumen
 * suficiente. Acá está la parte pura (qué monedas, cómo se arma cada lectura,
 * cómo se ordena y se cuenta); bajar los datos y llevar el ritmo para no
 * saturar a Binance está en lib/jarvis-scan-run.ts.
 *
 * Dos lecturas, y cada fila dice cuál es:
 * - rápida: solo velas de 1 h, 4 h y 1 d, más lo que no depende de la moneda
 *   (calendario, Miedo y Avaricia, noticias, dominancia). Sin derivados ni
 *   liquidaciones: son muchas consultas por moneda. Un especialista sin datos
 *   pesa cero y la fila lo dice; nunca se completa con un valor inventado.
 * - completa: la mesa entera, con derivados y liquidaciones. Se hace solo con
 *   las que la lectura rápida aprobó, y puede cambiarles la decisión.
 *
 * El orden es por confluencia, que mide cuánto coinciden los especialistas y no
 * la probabilidad de acertar.
 */

/** Volumen mínimo en 24 h (en dólares) que se ofrece, de más a menos exigente al final. */
export const SCAN_MIN_VOLUMES = [1_000_000, 5_000_000, 20_000_000] as const;
export const DEFAULT_SCAN_VOLUME = 5_000_000;
/** Tope de monedas por escaneo: pasada esa cantidad el escaneo tarda demasiado para quedarse abierto. */
export const SCAN_MAX_COINS = 400;
/** Cuántas aprobadas se releen completas (cada una cuesta unas diez consultas). */
export const SCAN_DEEP_MAX = 10;
/** Pasado este tiempo, el resultado se muestra como viejo. */
export const SCAN_STALE_MS = 30 * 60_000;

/** Lo que no es una moneda que se opere como tal: dólares sintéticos, índices y metales. */
const NOT_COINS = new Set(["USDC", "FDUSD", "TUSD", "USDP", "DAI", "BUSD", "USDD", "USD1", "RLUSD", "USDE", "EUR", "AEUR", "BTCDOM", "DEFI", "XAU", "XAG", "XAUT", "PAXG"]);

export type Eligible = { symbol: string; moneda: string; volumenUsd: number };
export type Universe = {
  elegibles: Eligible[];
  /** Contratos USDT que devolvió Binance. */
  contratos: number;
  /** Los que no son una moneda (dólares sintéticos, índices, metales, nombres raros). */
  noMonedas: number;
  /** Los que quedan por debajo del volumen mínimo (o sin volumen informado). */
  sinVolumen: number;
  /** Los que cumplían pero quedaron fuera por el tope de monedas por escaneo. */
  recortadas: number;
};

/** De las 24 h de todos los contratos (`/fapi/v1/ticker/24hr`) a las monedas que se leen, de más a menos operada. */
export function eligibleSymbols(rows: unknown, minVolume: number, max = SCAN_MAX_COINS): Universe {
  const out: Eligible[] = [];
  let contratos = 0;
  let noMonedas = 0;
  let sinVolumen = 0;
  const seen = new Set<string>();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const r = raw as { symbol?: unknown; quoteVolume?: unknown } | null;
    const symbol = typeof r?.symbol === "string" ? r.symbol : "";
    if (!symbol.endsWith("USDT") || seen.has(symbol)) continue;
    seen.add(symbol);
    contratos += 1;
    const moneda = symbol.slice(0, -4);
    if (!/^[A-Z0-9]{2,20}$/.test(moneda) || NOT_COINS.has(moneda)) {
      noMonedas += 1;
      continue;
    }
    const volumenUsd = Number(r?.quoteVolume);
    if (!Number.isFinite(volumenUsd) || volumenUsd < minVolume) {
      sinVolumen += 1;
      continue;
    }
    out.push({ symbol, moneda, volumenUsd });
  }
  out.sort((a, b) => b.volumenUsd - a.volumenUsd || a.symbol.localeCompare(b.symbol));
  return { elegibles: out.slice(0, max), contratos, noMonedas, sinVolumen, recortadas: Math.max(0, out.length - max) };
}

// ── Una lectura rápida ──

/** Lo que se baja una sola vez por escaneo y comparten todas las monedas. */
export type ScanShared = { btc: SwingCandle[] | null; eth: SwingCandle[] | null; context: MarketContext };
export type ScanCandles = { h1: SwingCandle[] | null; h4: SwingCandle[] | null; d1: SwingCandle[] | null };

/** Las filas crudas de Binance de una moneda, como las lee la mesa (solo velas cerradas a esta hora). */
export function scanCandles(rows: { h1: unknown; h4: unknown; d1: unknown }, now: number): ScanCandles {
  return { h1: closedCandles(rows.h1, "1h", now), h4: closedCandles(rows.h4, "4h", now), d1: closedCandles(rows.d1, "1d", now) };
}

/** El snapshot de la lectura rápida: sin derivados ni liquidaciones, con el resto igual que la lectura completa. */
export function quickSnapshot(symbol: string, candles: ScanCandles, shared: ScanShared, now: number): DeskSnapshot {
  return assembleSnapshot({ symbol, now, venues: ["Binance Futures"], ...candles, btc: shared.btc, eth: shared.eth, deriv: null, liquidations: null, context: shared.context });
}

export type ScanLectura = "rápida" | "completa";
export type ScanDirection = Direction | "SIN DATOS";

export type ScanPlan = { lado: Side; entrada: number; tipoEntrada: "MERCADO" | "LÍMITE"; stop: number; tp1: number; rr: number; riesgo: RiskLevel; stopPct: number };

export type ScanRow = {
  symbol: string;
  moneda: string;
  volumenUsd: number;
  lectura: ScanLectura;
  direccion: ScanDirection;
  /** Confluencia de 0 a 100. No es una probabilidad. */
  puntaje: number | null;
  consenso: number | null;
  /** Qué parte del peso de los especialistas tuvo datos (0 a 1). */
  cobertura: number | null;
  /** Cierre de la última vela de 1 h leída. */
  precio: number | null;
  /** Solo en las aprobadas (LONG o SHORT). */
  plan: ScanPlan | null;
  /** La primera compuerta que frenó la decisión, si la frenó alguna. */
  frenoEn: Compuerta["id"] | null;
  motivo: string | null;
  /** Lo que decía la lectura rápida, en las que se releyeron completas. */
  antes: ScanDirection | null;
  /** Algo que la persona tiene que saber de esta fila (por ejemplo, que no se pudo releer completa). */
  nota: string | null;
};

export const isApproved = (r: Pick<ScanRow, "direccion">) => r.direccion === "LONG" || r.direccion === "SHORT";

/** La fila de una moneda que no se pudo leer: no hay decisión ni se inventa una. */
export function rowWithoutData(e: Eligible, motivo: string): ScanRow {
  return { symbol: e.symbol, moneda: e.moneda, volumenUsd: e.volumenUsd, lectura: "rápida", direccion: "SIN DATOS", puntaje: null, consenso: null, cobertura: null, precio: null, plan: null, frenoEn: null, motivo: `${motivo} Este dato no está disponible actualmente.`, antes: null, nota: null };
}

/** La fila de una decisión de la mesa. `antes` es la dirección de la lectura rápida cuando esta es la completa. */
export function rowFrom(e: Eligible, d: DeskDecision, lectura: ScanLectura, antes: ScanDirection | null = null): ScanRow {
  const failed = gates(d).find((g) => g.estado === "FALLA") ?? null;
  const approved = d.direccion === "LONG" || d.direccion === "SHORT";
  const plan: ScanPlan | null = approved && d.plan && d.riesgo ? { lado: d.plan.lado, entrada: d.plan.entrada, tipoEntrada: d.plan.tipoEntrada, stop: d.plan.stop, tp1: d.plan.tp[0].price, rr: d.riesgo.rrPonderado, riesgo: d.riesgo.nivel, stopPct: d.riesgo.stopPct } : null;
  return {
    symbol: e.symbol,
    moneda: e.moneda,
    volumenUsd: e.volumenUsd,
    lectura,
    direccion: d.direccion,
    puntaje: d.puntaje,
    consenso: d.consenso,
    cobertura: d.cobertura,
    precio: d.precio,
    plan,
    frenoEn: approved ? null : (failed?.id ?? null),
    motivo: approved ? null : (failed?.detalle ?? d.resolucion),
    antes,
    nota: null,
  };
}

/** La lectura rápida de una moneda: con velas de 1 h, 4 h y 1 d y lo compartido, sin derivados. */
export function quickRead(e: Eligible, candles: ScanCandles, shared: ScanShared, now: number, settings: DeskSettings): ScanRow {
  if (!candles.h1 || candles.h1.length < 200) return rowWithoutData(e, `Hay menos de 200 velas de 1 h cerradas (${candles.h1?.length ?? 0}): la mesa pide al menos 200.`);
  const d = runDesk(quickSnapshot(e.symbol, candles, shared, now), settings);
  return d ? rowFrom(e, d, "rápida") : rowWithoutData(e, "La mesa no pudo leer la estructura con esas velas.");
}

// ── Ordenar y contar ──

/** Las aprobadas, de más a menos confluencia (a igual confluencia, más consenso, más volumen y orden alfabético: el orden es siempre el mismo). */
export function rankApproved(rows: ScanRow[]): ScanRow[] {
  return rows
    .filter(isApproved)
    .sort((a, b) => (b.puntaje ?? 0) - (a.puntaje ?? 0) || Math.abs(b.consenso ?? 0) - Math.abs(a.consenso ?? 0) || b.volumenUsd - a.volumenUsd || a.symbol.localeCompare(b.symbol));
}

export type ScanSummary = {
  /** Monedas que se intentó leer. */
  total: number;
  /** Las que tuvieron una decisión (el resto no tuvo velas suficientes). */
  leidas: number;
  sinDatos: number;
  aprobadas: number;
  largos: number;
  cortos: number;
  /** Frenadas en cada compuerta: sin lado claro, sin plan válido, vetadas por el gestor de riesgo, a la espera. Con las aprobadas suman las leídas. */
  sinLado: number;
  sinPlan: number;
  vetadas: number;
  esperan: number;
  /** Cuántas se releyeron completas, y cuántas de las aprobadas en la lectura rápida dejaron de estarlo. */
  completas: number;
  cayeron: number;
};

export function summarize(rows: ScanRow[]): ScanSummary {
  const s: ScanSummary = { total: rows.length, leidas: 0, sinDatos: 0, aprobadas: 0, largos: 0, cortos: 0, sinLado: 0, sinPlan: 0, vetadas: 0, esperan: 0, completas: 0, cayeron: 0 };
  for (const r of rows) {
    if (r.direccion === "SIN DATOS") {
      s.sinDatos += 1;
      continue;
    }
    s.leidas += 1;
    if (r.lectura === "completa") s.completas += 1;
    if (r.antes === "LONG" || r.antes === "SHORT") if (!isApproved(r)) s.cayeron += 1;
    if (r.direccion === "LONG") {
      s.aprobadas += 1;
      s.largos += 1;
    } else if (r.direccion === "SHORT") {
      s.aprobadas += 1;
      s.cortos += 1;
    } else if (r.frenoEn === "consenso") s.sinLado += 1;
    else if (r.frenoEn === "plan") s.sinPlan += 1;
    else if (r.frenoEn === "riesgo") s.vetadas += 1;
    else s.esperan += 1;
  }
  return s;
}

export type ScanResult = {
  /** Cuándo terminó (o se cortó). */
  at: number;
  minVolumen: number;
  universo: Pick<Universe, "contratos" | "noMonedas" | "sinVolumen" | "recortadas"> & { elegibles: number };
  filas: ScanRow[];
  resumen: ScanSummary;
  /** Se cortó antes de leer todas (la persona canceló o Binance limitó las consultas). */
  parcial: boolean;
  motivoParcial: string | null;
  duracionMs: number;
};

export const SCAN_LIMITS: string[] = [
  "Las reglas de la mesa se midieron en 10 monedas grandes (docs/mesa-reglas-v2.md). En las demás no hay medición propia: que una moneda pase los filtros no dice que acierte.",
  "Con tantas monedas leídas, algunas pasan por casualidad. El orden por confluencia mide cuánto coinciden los especialistas, no la probabilidad de acertar.",
  "La lectura rápida no ve derivados ni liquidaciones (pesan cero y se dice). Las aprobadas se releen completas y pueden dejar de estarlo.",
  "Es análisis, no ejecuta nada. No es asesoramiento financiero.",
];

// ── Cómo se cuenta ──

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const usdShort = (v: number) => (v >= 1_000_000 ? `${arNumber(Number((v / 1_000_000).toFixed(1)))} millones` : `${Math.round(v / 1000)} mil`);

/** El resumen en palabras, con cuentas y sin porcentajes (no hay una muestra que los sostenga). */
export function scanSummaryText(r: ScanResult): string {
  const s = r.resumen;
  const partes = [`${s.sinLado} sin lado claro`, `${s.vetadas} vetadas por el gestor de riesgo`, `${s.esperan} esperando el momento`];
  if (s.sinPlan) partes.push(`${s.sinPlan} sin un plan válido`);
  const base = `Leí ${plural(s.leidas, "moneda", "monedas")} de ${s.total}${s.sinDatos ? ` (${plural(s.sinDatos, "sin velas suficientes", "sin velas suficientes")})` : ""}, con volumen de más de ${usdShort(r.minVolumen)} de dólares en 24 horas. ${s.aprobadas ? `${plural(s.aprobadas, "tiene un plan aprobado", "tienen un plan aprobado")} (${plural(s.largos, "largo", "largos")} y ${plural(s.cortos, "corto", "cortos")}).` : "Ninguna tiene un plan aprobado."} El resto: ${partes.join(", ")}.`;
  const extra = s.cayeron ? ` ${plural(s.cayeron, "de las aprobadas en la lectura rápida dejó de estarlo al leerla completa", "de las aprobadas en la lectura rápida dejaron de estarlo al leerlas completas")}.` : "";
  return `${base}${extra}${r.parcial ? ` Escaneo cortado: ${r.motivoParcial ?? "no llegó a leer todas"}.` : ""}`;
}

/** Para la voz y el chat de JARVIS: lo más importante, corto. */
export function scanSpeech(r: ScanResult, n = 4): string {
  const top = rankApproved(r.filas).slice(0, n);
  const lista = top.length ? ` Las de más confluencia: ${top.map((x) => `${x.moneda} ${x.direccion === "LONG" ? "largo" : "corto"}, confluencia ${x.puntaje}${x.lectura === "completa" ? "" : " en lectura rápida"}`).join("; ")}.` : "";
  return `${scanSummaryText(r)}${lista} La confluencia mide cuánto coinciden los especialistas, no la probabilidad de acertar. No es asesoramiento financiero.`;
}

/** Una línea por fila aprobada, para copiar. */
export function scanLine(r: ScanRow): string {
  const p = r.plan;
  if (!p) return `${r.moneda}: ${r.direccion}`;
  return `${r.moneda} ${p.lado} · confluencia ${r.puntaje} · consenso ${signed(r.consenso ?? 0)} · entrada ${arNumber(p.entrada)} · stop ${arNumber(p.stop)} · TP1 ${arNumber(p.tp1)} · R:R 1:${arNumber(Number(p.rr.toFixed(2)))} · riesgo ${p.riesgo} · lectura ${r.lectura}`;
}
