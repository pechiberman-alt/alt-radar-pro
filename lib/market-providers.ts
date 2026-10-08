import type { Derivatives } from "./jarvis-desk-data.ts";

/**
 * Proveedores de datos de derivados y liquidaciones, con respaldo.
 *
 * Corre igual en el navegador y en el Worker (no usa window ni la base). Son
 * APIs públicas, sin clave: ninguna clave pasa por acá. Las de pago
 * (CoinMarketCap) viven solo en el servidor.
 *
 * Por qué varios: Binance responde 403 a los crons del Worker y puede no
 * responderle a alguien según su red. Si Binance Futures no da los derivados,
 * se prueban Bybit, OKX y Hyperliquid, en ese orden; el primero que responde
 * da TODO el bloque (no se mezclan campos de exchanges distintos) y la mesa
 * dice de dónde salió. Lo que ese exchange no publica queda en null y se dice.
 *
 * Unidades: el funding se lleva siempre a "por 8 horas" (Binance cobra cada 8
 * h; Bybit y OKX según el contrato; Hyperliquid cada hora), para que los
 * umbrales de la mesa signifiquen lo mismo con cualquier fuente.
 *
 * Liquidaciones reales: OKX publica las órdenes de liquidación de sus
 * perpetuos con historial reciente (Binance solo en vivo). Es una parte del
 * mercado, no el total, y así se dice.
 */

export type ProviderId = "binance" | "bybit" | "okx" | "hyperliquid";
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export type Attempt = { provider: ProviderId; ok: boolean; why?: string };

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  binance: "Binance Futures",
  bybit: "Bybit (perpetuo USDT)",
  okx: "OKX (perpetuo USDT)",
  hyperliquid: "Hyperliquid (perpetuo)",
};

const H = 3_600_000;

export const BINANCE_FUTURES = ["https://fapi.binance.com", "https://fapi1.binance.com", "https://fapi2.binance.com"];
export const BYBIT = "https://api.bybit.com";
export const OKX = "https://www.okx.com";
export const HYPERLIQUID = "https://api.hyperliquid.xyz/info";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** El nombre de la moneda en cada exchange. Los contratos "1000PEPE" de Binance son "PEPE" en OKX y "kPEPE" en Hyperliquid. */
export function venueSymbol(symbol: string, venue: ProviderId): string | null {
  if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol)) return null;
  const base = symbol.replace(/USDT$/, "");
  const thousand = /^1000(?=[A-Z])/.test(base) ? base.slice(4) : null;
  if (venue === "binance" || venue === "bybit") return symbol;
  if (venue === "okx") return `${thousand ?? base}-USDT-SWAP`;
  return thousand ? `k${thousand}` : base;
}

const any = (d: Derivatives) => [d.fundingPct, d.openInterest, d.openInterestUsd, d.oiChange24hPct, d.longShortRatio, d.takerBuySell].some((v) => v !== null);

/** Cambio porcentual entre la primera y la última de una serie ordenada que cubra ~24 h (al menos 20 h). */
function change24(series: { t: number; v: number }[]): number | null {
  const s = series.filter((x) => x.v > 0).sort((a, b) => a.t - b.t);
  if (s.length < 2) return null;
  const first = s[0];
  const last = s[s.length - 1];
  if (last.t - first.t < 20 * H) return null;
  return ((last.v - first.v) / first.v) * 100;
}

// ── Binance Futures ──

export function binanceDerivatives(raw: { premium: unknown; oi: unknown; oiHist: unknown; ls: unknown; taker: unknown }, price: number | null): Derivatives | null {
  const p = raw.premium as { lastFundingRate?: unknown; nextFundingTime?: unknown; markPrice?: unknown } | null;
  const fundingRate = num(p?.lastFundingRate);
  const markPrice = num(p?.markPrice);
  const openInterest = num((raw.oi as { openInterest?: unknown } | null)?.openInterest);
  const hist = Array.isArray(raw.oiHist) ? (raw.oiHist as { sumOpenInterest?: unknown; timestamp?: unknown }[]) : [];
  const series = hist.map((r) => ({ t: num(r.timestamp) ?? 0, v: num(r.sumOpenInterest) ?? 0 }));
  const lsRow = Array.isArray(raw.ls) ? (raw.ls as { longShortRatio?: unknown }[]).at(-1) : null;
  const takerRow = Array.isArray(raw.taker) ? (raw.taker as { buySellRatio?: unknown }[]).at(-1) : null;
  const ref = markPrice ?? price;
  const out: Derivatives = {
    fundingPct: fundingRate === null ? null : fundingRate * 100,
    nextFundingAt: num(p?.nextFundingTime),
    markPrice,
    openInterest,
    openInterestUsd: openInterest !== null && ref ? openInterest * ref : null,
    oiChange24hPct: change24(series),
    longShortRatio: num(lsRow?.longShortRatio),
    takerBuySell: num(takerRow?.buySellRatio),
    source: PROVIDER_LABEL.binance,
  };
  return any(out) ? out : null;
}

// ── Bybit v5 ──

type BybitList<T> = { retCode?: unknown; result?: { list?: T[] } } | null;

export function bybitDerivatives(raw: { tickers: unknown; oiHist: unknown; ratio: unknown }, price: number | null): Derivatives | null {
  const tk = raw.tickers as BybitList<{ fundingRate?: unknown; nextFundingTime?: unknown; markPrice?: unknown; openInterest?: unknown; openInterestValue?: unknown; fundingIntervalHour?: unknown }>;
  if (!tk || num(tk.retCode) !== 0) return null;
  const row = tk.result?.list?.[0];
  if (!row) return null;
  const interval = num(row.fundingIntervalHour) ?? 8;
  const rate = num(row.fundingRate);
  const markPrice = num(row.markPrice);
  const openInterest = num(row.openInterest);
  const hist = raw.oiHist as BybitList<{ openInterest?: unknown; timestamp?: unknown }>;
  const series = (hist && num(hist.retCode) === 0 ? (hist.result?.list ?? []) : []).map((r) => ({ t: num(r.timestamp) ?? 0, v: num(r.openInterest) ?? 0 }));
  const ratio = raw.ratio as BybitList<{ buyRatio?: unknown; sellRatio?: unknown; timestamp?: unknown }>;
  const rows = ratio && num(ratio.retCode) === 0 ? [...(ratio.result?.list ?? [])].sort((a, b) => (num(a.timestamp) ?? 0) - (num(b.timestamp) ?? 0)) : [];
  const last = rows.at(-1);
  const buy = num(last?.buyRatio);
  const sell = num(last?.sellRatio);
  const ref = markPrice ?? price;
  const out: Derivatives = {
    fundingPct: rate === null || !(interval > 0) ? null : rate * 100 * (8 / interval),
    nextFundingAt: num(row.nextFundingTime),
    markPrice,
    openInterest,
    openInterestUsd: num(row.openInterestValue) ?? (openInterest !== null && ref ? openInterest * ref : null),
    oiChange24hPct: change24(series),
    longShortRatio: buy !== null && sell !== null && sell > 0 ? buy / sell : null,
    takerBuySell: null,
    source: PROVIDER_LABEL.bybit,
  };
  return any(out) ? out : null;
}

// ── OKX v5 ──

type OkxData<T> = { code?: unknown; data?: T[] } | null;
const okxRows = <T>(raw: unknown): T[] => {
  const r = raw as OkxData<T>;
  return r && String(r.code) === "0" && Array.isArray(r.data) ? r.data : [];
};

export function okxDerivatives(raw: { funding: unknown; oi: unknown; oiHist: unknown; ratio: unknown; taker: unknown }, price: number | null): Derivatives | null {
  const f = okxRows<{ fundingRate?: unknown; fundingTime?: unknown; nextFundingTime?: unknown }>(raw.funding)[0];
  const rate = num(f?.fundingRate);
  const ft = num(f?.fundingTime);
  const nft = num(f?.nextFundingTime);
  const interval = ft !== null && nft !== null && nft > ft ? (nft - ft) / H : 8;
  const oi = okxRows<{ oiCcy?: unknown; oiUsd?: unknown }>(raw.oi)[0];
  const openInterest = num(oi?.oiCcy);
  // [ts, oi (contracts), oiCcy, oiUsd] per instrument; the oldest kind of row has fewer fields.
  const hist = okxRows<unknown[]>(raw.oiHist).map((r) => ({ t: num(r?.[0]) ?? 0, v: num(r?.[3]) ?? num(r?.[2]) ?? 0 }));
  const ratioRows = okxRows<unknown[]>(raw.ratio).map((r) => ({ t: num(r?.[0]) ?? 0, v: num(r?.[1]) })).sort((a, b) => a.t - b.t);
  const takerRows = okxRows<unknown[]>(raw.taker)
    .map((r) => ({ t: num(r?.[0]) ?? 0, sell: num(r?.[1]), buy: num(r?.[2]) }))
    .sort((a, b) => a.t - b.t);
  const lastTaker = takerRows.at(-1);
  const ref = price;
  const out: Derivatives = {
    fundingPct: rate === null || !(interval > 0) ? null : rate * 100 * (8 / interval),
    nextFundingAt: nft,
    markPrice: null,
    openInterest,
    openInterestUsd: num(oi?.oiUsd) ?? (openInterest !== null && ref ? openInterest * ref : null),
    oiChange24hPct: change24(hist),
    longShortRatio: ratioRows.at(-1)?.v ?? null,
    takerBuySell: lastTaker && lastTaker.buy !== null && lastTaker.sell !== null && lastTaker.sell > 0 ? lastTaker.buy / lastTaker.sell : null,
    source: PROVIDER_LABEL.okx,
  };
  return any(out) ? out : null;
}

// ── Hyperliquid ──

export function hyperliquidDerivatives(raw: unknown, coin: string, price: number | null): Derivatives | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const meta = raw[0] as { universe?: { name?: unknown }[] } | null;
  const ctxs = raw[1] as { funding?: unknown; openInterest?: unknown; markPx?: unknown }[] | null;
  const i = meta?.universe?.findIndex((u) => u?.name === coin) ?? -1;
  const ctx = i >= 0 && Array.isArray(ctxs) ? ctxs[i] : null;
  if (!ctx) return null;
  const hourly = num(ctx.funding);
  const markPrice = num(ctx.markPx);
  const openInterest = num(ctx.openInterest);
  const ref = markPrice ?? price;
  const out: Derivatives = {
    // Hyperliquid charges every hour: eight of them make the 8-hour figure the desk reads.
    fundingPct: hourly === null ? null : hourly * 100 * 8,
    nextFundingAt: null,
    markPrice,
    openInterest,
    openInterestUsd: openInterest !== null && ref ? openInterest * ref : null,
    oiChange24hPct: null,
    longShortRatio: null,
    takerBuySell: null,
    source: PROVIDER_LABEL.hyperliquid,
  };
  return any(out) ? out : null;
}

// ── Fetching ──

const defaultFetcher: Fetcher = (url, init) => fetch(url, init);

async function getJson(f: Fetcher, url: string, signal?: AbortSignal, init: RequestInit = {}): Promise<unknown> {
  try {
    const r = await f(url, { ...init, signal: signal ?? AbortSignal.timeout(6000), headers: { Accept: "application/json", ...(init.headers ?? {}) } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function firstOf(f: Fetcher, urls: string[], signal?: AbortSignal): Promise<unknown> {
  for (const u of urls) {
    const v = await getJson(f, u, signal);
    if (v !== null) return v;
  }
  return null;
}

export async function loadBinanceDerivatives(symbol: string, price: number | null, f: Fetcher = defaultFetcher, signal?: AbortSignal): Promise<Derivatives | null> {
  const q = encodeURIComponent(symbol);
  const at = (path: string) => BINANCE_FUTURES.map((b) => `${b}${path}`);
  const [premium, oi, oiHist, ls, taker] = await Promise.all([
    firstOf(f, at(`/fapi/v1/premiumIndex?symbol=${q}`), signal),
    firstOf(f, at(`/fapi/v1/openInterest?symbol=${q}`), signal),
    firstOf(f, at(`/futures/data/openInterestHist?symbol=${q}&period=1h&limit=25`), signal),
    firstOf(f, at(`/futures/data/globalLongShortAccountRatio?symbol=${q}&period=1h&limit=1`), signal),
    firstOf(f, at(`/futures/data/takerlongshortRatio?symbol=${q}&period=1h&limit=1`), signal),
  ]);
  return binanceDerivatives({ premium, oi, oiHist, ls, taker }, price);
}

export async function loadBybitDerivatives(symbol: string, price: number | null, f: Fetcher = defaultFetcher, signal?: AbortSignal): Promise<Derivatives | null> {
  const s = venueSymbol(symbol, "bybit");
  if (!s) return null;
  const q = encodeURIComponent(s);
  const tickers = await getJson(f, `${BYBIT}/v5/market/tickers?category=linear&symbol=${q}`, signal);
  if (!tickers) return null;
  const [oiHist, ratio] = await Promise.all([
    getJson(f, `${BYBIT}/v5/market/open-interest?category=linear&symbol=${q}&intervalTime=1h&limit=25`, signal),
    getJson(f, `${BYBIT}/v5/market/account-ratio?category=linear&symbol=${q}&period=1h&limit=1`, signal),
  ]);
  return bybitDerivatives({ tickers, oiHist, ratio }, price);
}

export async function loadOkxDerivatives(symbol: string, price: number | null, f: Fetcher = defaultFetcher, signal?: AbortSignal): Promise<Derivatives | null> {
  const inst = venueSymbol(symbol, "okx");
  if (!inst) return null;
  const ccy = inst.split("-")[0];
  const funding = await getJson(f, `${OKX}/api/v5/public/funding-rate?instId=${inst}`, signal);
  if (!okxRows(funding).length) return null;
  const [oi, oiHist, ratio, taker] = await Promise.all([
    getJson(f, `${OKX}/api/v5/public/open-interest?instType=SWAP&instId=${inst}`, signal),
    getJson(f, `${OKX}/api/v5/rubik/stat/contracts/open-interest-history?instId=${inst}&period=1H&limit=25`, signal),
    getJson(f, `${OKX}/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=${ccy}&period=1H`, signal),
    getJson(f, `${OKX}/api/v5/rubik/stat/taker-volume?ccy=${ccy}&instType=CONTRACTS&period=1H`, signal),
  ]);
  return okxDerivatives({ funding, oi, oiHist, ratio, taker }, price);
}

export async function loadHyperliquidDerivatives(symbol: string, price: number | null, f: Fetcher = defaultFetcher, signal?: AbortSignal): Promise<Derivatives | null> {
  const coin = venueSymbol(symbol, "hyperliquid");
  if (!coin) return null;
  const raw = await getJson(f, HYPERLIQUID, signal, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "metaAndAssetCtxs" }) });
  return hyperliquidDerivatives(raw, coin, price);
}

const LOADERS: Record<ProviderId, typeof loadBinanceDerivatives> = {
  binance: loadBinanceDerivatives,
  bybit: loadBybitDerivatives,
  okx: loadOkxDerivatives,
  hyperliquid: loadHyperliquidDerivatives,
};

/** El primer proveedor que da derivados, en el orden pedido, y qué pasó con cada uno. */
export async function derivativesWithFallback(
  symbol: string,
  price: number | null,
  order: ProviderId[],
  f: Fetcher = defaultFetcher,
  signal?: AbortSignal,
): Promise<{ derivatives: Derivatives | null; provider: ProviderId | null; tried: Attempt[] }> {
  const tried: Attempt[] = [];
  for (const provider of order) {
    const d = await LOADERS[provider](symbol, price, f, signal).catch(() => null);
    if (d) {
      tried.push({ provider, ok: true });
      return { derivatives: d, provider, tried };
    }
    tried.push({ provider, ok: false, why: "sin respuesta o sin datos para esta moneda" });
  }
  return { derivatives: null, provider: null, tried };
}

// ── Liquidaciones reales (OKX) ──

export type LiquidationWindow = { horas: number; largosUsd: number; cortosUsd: number; ordenes: number; completa: boolean };
export type LiquidationTape = {
  fuente: string;
  /** La liquidación más vieja que se pudo leer: antes de eso no hay datos. */
  desde: number;
  hasta: number;
  ventanas: LiquidationWindow[];
  mayor: { usd: number; lado: "LARGO" | "CORTO"; precio: number; at: number } | null;
};

export const LIQ_WINDOWS_H = [1, 4, 24];
const OKX_LIQ_PAGE = 100;
const OKX_LIQ_PAGES = 3;

type OkxLiqDetail = { bkPx?: unknown; sz?: unknown; posSide?: unknown; side?: unknown; ts?: unknown };

/**
 * Las liquidaciones de OKX en ventanas de 1, 4 y 24 h. `ctVal` es cuánto vale
 * un contrato en monedas. Una ventana es completa si lo leído llega hasta su
 * comienzo (o si OKX devolvió menos de lo pedido: no había más).
 */
export function okxLiquidationTape(pages: unknown[], ctVal: number, now: number, exhausted: boolean): LiquidationTape | null {
  if (!(ctVal > 0)) return null;
  const rows: { at: number; usd: number; lado: "LARGO" | "CORTO"; precio: number }[] = [];
  for (const page of pages) {
    for (const block of okxRows<{ details?: OkxLiqDetail[] }>(page)) {
      for (const d of block?.details ?? []) {
        const px = num(d.bkPx);
        const sz = num(d.sz);
        const at = num(d.ts);
        if (px === null || sz === null || at === null || px <= 0 || sz <= 0 || at > now) continue;
        const pos = String(d.posSide ?? "");
        const side = String(d.side ?? "");
        const lado = pos === "long" || (pos === "net" && side === "sell") ? "LARGO" : pos === "short" || (pos === "net" && side === "buy") ? "CORTO" : null;
        if (!lado) continue;
        rows.push({ at, usd: sz * ctVal * px, lado, precio: px });
      }
    }
  }
  const unique = [...new Map(rows.map((r) => [`${r.at}:${r.lado}:${r.precio}:${r.usd}`, r])).values()];
  if (!unique.length && !exhausted) return null;
  const desde = unique.length ? Math.min(...unique.map((r) => r.at)) : now - 24 * H;
  const ventanas = LIQ_WINDOWS_H.map((horas) => {
    const from = now - horas * H;
    const inside = unique.filter((r) => r.at >= from);
    return {
      horas,
      largosUsd: inside.filter((r) => r.lado === "LARGO").reduce((a, r) => a + r.usd, 0),
      cortosUsd: inside.filter((r) => r.lado === "CORTO").reduce((a, r) => a + r.usd, 0),
      ordenes: inside.length,
      completa: exhausted || desde <= from,
    };
  });
  const last24 = unique.filter((r) => r.at >= now - 24 * H);
  const big = last24.sort((a, b) => b.usd - a.usd)[0] ?? null;
  return { fuente: "OKX, perpetuos USDT (una parte del mercado, no el total)", desde, hasta: now, ventanas, mayor: big ? { usd: big.usd, lado: big.lado, precio: big.precio, at: big.at } : null };
}

/** Cuánto vale un contrato perpetuo de OKX, en monedas. */
export function okxContractValue(raw: unknown): number | null {
  const row = okxRows<{ ctVal?: unknown }>(raw)[0];
  const v = num(row?.ctVal);
  return v !== null && v > 0 ? v : null;
}

export async function loadOkxLiquidations(symbol: string, now: number, f: Fetcher = defaultFetcher, signal?: AbortSignal): Promise<LiquidationTape | null> {
  const inst = venueSymbol(symbol, "okx");
  if (!inst) return null;
  const family = inst.replace(/-SWAP$/, "");
  const ctVal = okxContractValue(await getJson(f, `${OKX}/api/v5/public/instruments?instType=SWAP&instId=${inst}`, signal));
  if (ctVal === null) return null;
  const pages: unknown[] = [];
  let after: number | null = null;
  let exhausted = false;
  for (let k = 0; k < OKX_LIQ_PAGES; k += 1) {
    const page = await getJson(f, `${OKX}/api/v5/public/liquidation-orders?instType=SWAP&instFamily=${family}&state=filled&limit=${OKX_LIQ_PAGE}${after ? `&after=${after}` : ""}`, signal);
    if (page === null) break;
    pages.push(page);
    const details = okxRows<{ details?: OkxLiqDetail[] }>(page).flatMap((b) => b?.details ?? []);
    if (details.length < OKX_LIQ_PAGE) {
      exhausted = true;
      break;
    }
    const oldest = Math.min(...details.map((d) => num(d.ts) ?? Infinity));
    if (!Number.isFinite(oldest) || oldest <= now - 24 * H) break;
    after = oldest;
  }
  if (!pages.length) return null;
  return okxLiquidationTape(pages, ctVal, now, exhausted);
}
