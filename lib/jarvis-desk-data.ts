import type { CryptoNewsItem } from "./crypto-news.ts";
import { loadCalendar, type MacroEvent } from "./econ-calendar.ts";
import type { FearGreed } from "./fear-greed.ts";
import { closedOnly } from "./jarvis-core.ts";
import { loadRows } from "./market-fetch.ts";
import { binanceDerivatives, loadBinanceDerivatives, type Attempt, type LiquidationTape, type ProviderId } from "./market-providers.ts";
import type { MarketStructure } from "./market-structure.ts";
import { parseSwingKlines, type SwingCandle } from "./swing-entries.ts";

/**
 * JARVIS TRADING · datos de mercado. Todo lo que la mesa de especialistas lee,
 * en un solo objeto (DeskSnapshot), y de dónde sale cada parte.
 *
 * Corre en el navegador: Binance responde a la conexión de la persona y no al
 * Worker (403 a los crons), y los motores son puros. Las partes del servidor
 * (noticias, Miedo y Avaricia, calendario, dominancia) llegan por las rutas
 * propias de la app, que guardan las claves del lado del Worker. Ninguna
 * clave viaja al navegador.
 *
 * Cada parte puede faltar sola: una que no responde queda en null y la mesa
 * lo dice ("Este dato no está disponible actualmente"); nunca se completa con
 * un valor inventado.
 */

const H = 3_600_000;
export const DESK_FRAMES = { h1: H, h4: 4 * H, d1: 24 * H } as const;

export type Derivatives = {
  /** Última tasa de financiamiento, en porcentaje por período de 8 horas. */
  fundingPct: number | null;
  nextFundingAt: number | null;
  markPrice: number | null;
  /** Interés abierto en contratos y en dólares. */
  openInterest: number | null;
  openInterestUsd: number | null;
  /** Cambio del interés abierto en las últimas 24 horas, en porcentaje. */
  oiChange24hPct: number | null;
  /** Cuentas en largo / cuentas en corto (Binance, todas las cuentas, 1 hora). */
  longShortRatio: number | null;
  /** Volumen comprador agresivo / vendedor agresivo (última hora). */
  takerBuySell: number | null;
  source: string;
};

export type MacroData = {
  btcDominance: number | null;
  usdtDominance: number | null;
  /** Variación de la capitalización total en 24 horas, en porcentaje. */
  marketCapChange24h: number | null;
  /** Calendario de la semana; null si no respondió (nunca una lista vacía que finja calma). */
  events: MacroEvent[] | null;
  calendarSource: string | null;
};

export type DeskSnapshot = {
  symbol: string;
  now: number;
  candles: { h1: SwingCandle[]; h4: SwingCandle[] | null; d1: SwingCandle[] | null };
  /** Velas de 1 hora de BTC y ETH, para correlación y fuerza relativa (null si no llegaron). */
  btc: SwingCandle[] | null;
  eth: SwingCandle[] | null;
  derivatives: Derivatives | null;
  /** Liquidaciones reales con historial (OKX), si respondió. Opcional: lo que no lo trae, no lo tiene. */
  liquidations?: LiquidationTape | null;
  macro: MacroData;
  news: CryptoNewsItem[] | null;
  fearGreed: FearGreed | null;
  /** De dónde salió cada parte, para mostrarlo. */
  sources: string[];
};

/**
 * Proveedores de datos: los conectados y los lugares preparados para conectar
 * después. Un proveedor nuevo implementa las mismas formas (velas, derivados…)
 * y se agrega acá; la mesa no cambia.
 */
export type DeskProvider = {
  id: string;
  label: string;
  serves: ("velas" | "derivados" | "liquidaciones" | "noticias" | "macro" | "sentimiento" | "dominancia")[];
  ready: boolean;
  /** Qué falta para conectarlo, cuando todavía no lo está. */
  needs?: string;
};

export const DESK_PROVIDERS: DeskProvider[] = [
  { id: "binance", label: "Binance Futures (API pública, desde tu navegador)", serves: ["velas", "derivados"], ready: true },
  { id: "bybit", label: "Bybit v5 (API pública, desde el servidor)", serves: ["derivados"], ready: true },
  { id: "okx", label: "OKX v5 (API pública, desde el servidor)", serves: ["derivados", "liquidaciones"], ready: true },
  { id: "hyperliquid", label: "Hyperliquid (API pública, desde el servidor)", serves: ["derivados"], ready: true },
  { id: "binance-ws", label: "Binance · liquidaciones en vivo (WebSocket)", serves: ["liquidaciones"], ready: true },
  { id: "alt-radar", label: "Servidor ALT RADAR (noticias cripto, Miedo y Avaricia)", serves: ["noticias", "sentimiento"], ready: true },
  { id: "forex-factory", label: "Calendario económico (Forex Factory)", serves: ["macro"], ready: true },
  { id: "coingecko", label: "CoinGecko (dominancia y capitalización)", serves: ["dominancia"], ready: true },
  { id: "coinmarketcap", label: "CoinMarketCap", serves: ["dominancia"], ready: false, needs: "clave gratis de CoinMarketCap cargada en CONFIGURACIÓN (queda cifrada en el servidor, nunca en el navegador)" },
  { id: "tradingview", label: "TradingView", serves: [], ready: false, needs: "no tiene API pública de datos: solo widgets y webhooks de alertas" },
];

/** Las respuestas crudas de Binance Futures, como Derivatives (aparte para probarlo sin red). */
export const derivativesFrom = binanceDerivatives;

type ServerMarket = {
  derivados: { data: Derivatives | null; provider: ProviderId | null; tried: Attempt[] } | null;
  liquidaciones: LiquidationTape | null;
};

/** Lo que el servidor consigue de Bybit, OKX y Hyperliquid (sin claves; null si no respondió). */
async function serverMarket(symbol: string, price: number | null, parts: string, signal: AbortSignal): Promise<ServerMarket | null> {
  try {
    const r = await fetch(`/api/market/derivatives?symbol=${encodeURIComponent(symbol)}&parts=${parts}${price ? `&price=${price}` : ""}`, { cache: "no-store", signal });
    return r.ok ? ((await r.json()) as ServerMarket) : null;
  } catch {
    return null;
  }
}

/**
 * Funding, interés abierto (ahora y 24 h), ratio largo/corto y flujo agresor:
 * de Binance Futures desde este navegador; si no responde, el servidor prueba
 * Bybit, OKX y Hyperliquid. Una sola fuente por lectura, y dice cuál.
 */
export async function loadDerivatives(symbol: string, price: number | null, signal: AbortSignal): Promise<{ derivatives: Derivatives | null; viaServer: boolean }> {
  const direct = await loadBinanceDerivatives(symbol, price, (u, i) => fetch(u, i), signal).catch(() => null);
  if (direct) return { derivatives: direct, viaServer: false };
  const server = await serverMarket(symbol, price, "derivados", signal);
  return { derivatives: server?.derivados?.data ?? null, viaServer: true };
}

async function candlesOf(symbol: string, tf: "1h" | "4h" | "1d", limit: number, now: number, signal: AbortSignal, venues?: Set<string>): Promise<SwingCandle[] | null> {
  try {
    const meta: { venue?: string } = {};
    const rows = await loadRows(symbol, tf, limit, signal, meta);
    if (meta.venue && venues) venues.add(meta.venue);
    const c = closedOnly(parseSwingKlines(rows), DESK_FRAMES[tf === "1h" ? "h1" : tf === "4h" ? "h4" : "d1"], now);
    return c.length ? c : null;
  } catch {
    return null;
  }
}

/**
 * Todo lo que la mesa necesita para un activo. `structure` es la lectura de
 * dominancia que la app ya tiene en pantalla (si no, se pide al servidor).
 */
export async function loadDeskSnapshot(symbol: string, opts: { now?: number; structure?: MarketStructure | null; signal?: AbortSignal } = {}): Promise<DeskSnapshot> {
  const now = opts.now ?? Date.now();
  const signal = opts.signal ?? AbortSignal.timeout(20_000);
  const isBtc = symbol === "BTCUSDT";
  const isEth = symbol === "ETHUSDT";
  const venues = new Set<string>();
  const [h1, h4, d1, btc, eth, sentiment, calendar, structure] = await Promise.all([
    candlesOf(symbol, "1h", 1000, now, signal, venues),
    candlesOf(symbol, "4h", 300, now, signal, venues),
    candlesOf(symbol, "1d", 220, now, signal, venues),
    isBtc ? Promise.resolve(null) : candlesOf("BTCUSDT", "1h", 200, now, signal),
    isEth ? Promise.resolve(null) : candlesOf("ETHUSDT", "1h", 200, now, signal),
    fetch("/api/sentiment", { cache: "no-store", signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ fearGreed?: FearGreed | null; news?: CryptoNewsItem[] }>) : null))
      .catch(() => null),
    loadCalendar().catch(() => null),
    opts.structure !== undefined && opts.structure !== null
      ? Promise.resolve(opts.structure)
      : fetch("/api/market-structure", { cache: "no-store", signal })
          .then((r) => (r.ok ? (r.json() as Promise<MarketStructure | null>) : null))
          .catch(() => null),
  ]);
  const price = h1?.at(-1)?.close ?? null;
  const [deriv, liq] = h1
    ? await Promise.all([loadDerivatives(symbol, price, signal).catch(() => null), serverMarket(symbol, price, "liquidaciones", signal)])
    : [null, null];
  const derivatives = deriv?.derivatives ?? null;
  const liquidations = liq?.liquidaciones ?? null;
  // The venue that actually answered: futures first, spot or the server's copy when futures does not.
  const sources = [`Velas: ${venues.size ? [...venues].join(" + ") : "sin respuesta"} (1h, 4h y 1d, solo cerradas)`];
  if (derivatives) {
    const fields = [derivatives.fundingPct !== null && "funding", derivatives.oiChange24hPct !== null && "interés abierto", derivatives.longShortRatio !== null && "ratio largo/corto", derivatives.takerBuySell !== null && "flujo agresor"].filter(Boolean).join(", ");
    sources.push(`Derivados: ${derivatives.source}${deriv?.viaServer ? " (desde el servidor: Binance no respondió)" : ""} · ${fields}`);
  }
  if (liquidations) sources.push(`Liquidaciones reales: ${liquidations.fuente}`);
  if (sentiment?.news) sources.push("Noticias: CoinDesk, Cointelegraph, Decrypt, The Block, Bitcoin Magazine (titulares)");
  if (sentiment?.fearGreed) sources.push("Miedo y Avaricia: alternative.me");
  if (calendar) sources.push(`Calendario: ${calendar.source}${calendar.stale ? " (copia vieja)" : ""}`);
  if (structure) sources.push(`Dominancia: ${structure.source}`);
  return {
    symbol,
    now,
    candles: { h1: h1 ?? [], h4, d1 },
    btc: isBtc ? h1 : btc,
    eth: isEth ? h1 : eth,
    derivatives,
    liquidations,
    macro: {
      btcDominance: structure?.dominance.btc ?? null,
      usdtDominance: structure?.dominance.usdt ?? null,
      marketCapChange24h: structure?.marketCapChange24h ?? null,
      events: calendar?.events ?? null,
      calendarSource: calendar?.source ?? null,
    },
    news: Array.isArray(sentiment?.news) ? sentiment.news : null,
    fearGreed: sentiment?.fearGreed ?? null,
    sources,
  };
}
