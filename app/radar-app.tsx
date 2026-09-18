"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Rolling-window enrichment cadence, decoupled from the price refresh. */
const ENRICHMENT_INTERVAL_MS = 150_000;
import type { RadarPayload, ScoredAsset } from "@/lib/radar";
import {
  altseasonScore,
  diagnoseSignals,
  globalRisk,
  rotation,
  scoreAssets,
} from "@/lib/radar";
import { useDashboardSettings } from "./dashboard-settings";
import LiveBookmap, { type BookmapBrainReadings } from "./live-bookmap";
import SignalLedger from "./signal-ledger";
import ScalpingDesk from "./scalping-desk";
import CompareChart from "./compare-chart";
import CorrelationWatch from "./correlation-watch";
import PumpRadar from "./pump-radar";
import RiskDesk from "./risk-desk";
import MarketStructurePanel from "./market-structure-panel";
import AssistantConsole from "./assistant-console";
import InstallPanel from "./install-panel";
import AccountPanel from "./account-panel";
import InstitutionalDesk from "./institutional-desk";
import ExchangeFlowDesk from "./exchange-flows";
import LiquidationHeatmapDesk from "./liquidation-heatmap-desk";
import UnlockDesk from "./unlock-desk";
import SwingDesk from "./swing-desk";
import { Collapsible, WorkspaceBar, useWorkspace } from "./workspace";
import type { AssistantContext } from "@/lib/assistant/index";
import type { PumpReading } from "@/lib/pump-radar";
import type { CorrelationInsights } from "./correlation-watch";
import { parseCoinGeckoGlobal, type MarketStructure } from "@/lib/market-structure";
import { TRADING_PROFILES, type ProfileId } from "@/lib/trading-profiles";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const STABLE_BASES = new Set([
  "USDC",
  "FDUSD",
  "TUSD",
  "USDP",
  "DAI",
  "BUSD",
  "USD1",
  "EUR",
  "AEUR",
  "EURI",
  "TRY",
  "BRL",
]);

const NAV_ITEMS = [
  { label: "RESUMEN", mobile: "INICIO", icon: "⌂", id: "resumen" },
  { label: "ESCÁNER", mobile: "SCAN", icon: "⌕", id: "scanner" },
  { label: "SCALPING", mobile: "SCALP", icon: "↯", id: "scalping" },
  { label: "PUMPEO", mobile: "PUMP", icon: "▲", id: "pumpeo" },
  { label: "LIQUIDACIONES", mobile: "MAPA", icon: "▨", id: "liquidaciones" },
  { label: "DESBLOQUEOS", mobile: "UNLOCK", icon: "◷", id: "desbloqueos" },
  { label: "INSTITUCIONAL", mobile: "FONDOS", icon: "▤", id: "institucional" },
  { label: "RESERVAS", mobile: "CUSTODIA", icon: "⇅", id: "reservas" },
  { label: "SWING", mobile: "SWING", icon: "◤", id: "swing" },
  { label: "RIESGO", mobile: "RIESGO", icon: "◎", id: "riesgo" },
  { label: "ANALISTA", mobile: "CHAT", icon: "◈", id: "asistente" },
  { label: "COMPARAR", mobile: "COMP", icon: "⇄", id: "comparador" },
  { label: "VIGILANCIA", mobile: "WATCH", icon: "◈", id: "vigilancia" },
  { label: "ORDER FLOW", mobile: "FLOW", icon: "▦", id: "order-flow" },
  { label: "HISTORIAL", mobile: "DATOS", icon: "≡", id: "historial" },
] as const;

const formatPrice = (value: number) =>
  value >= 1000
    ? `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : value >= 1
      ? `$${value.toFixed(2)}`
      : `$${value.toPrecision(3)}`;
const percentage = (value: number | null) =>
  value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const compact = (value: number) =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
const assetName = (symbol: string) => symbol.replace("USDT", "");

type RawTicker = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  volume: string;
  quoteVolume: string;
  highPrice: string;
  lowPrice: string;
  bidPrice: string;
  askPrice: string;
};

/**
 * The full universe, direct from Binance when the client is allowed, otherwise
 * through the Worker proxy. Without this fallback a throttled browser dropped
 * to the server's small fixed watch list.
 */
async function loadTickers(): Promise<RawTicker[]> {
  try {
    const response = await fetch("https://data-api.binance.vision/api/v3/ticker/24hr", {
      cache: "no-store",
    });
    if (response.ok) {
      const rows = (await response.json()) as RawTicker[];
      if (Array.isArray(rows) && rows.length) return rows;
    }
  } catch {
    // Binance refuses throttled browsers without CORS headers.
  }
  const proxied = await fetch("/api/tickers", { cache: "no-store" });
  if (!proxied.ok) throw new Error("Binance unavailable");
  const payload = (await proxied.json()) as {
    market?: {
      symbol: string;
      price: number;
      change24h: number;
      volume: number;
      quoteVolume: number;
      high: number;
      low: number;
      bidPrice: number | null;
      askPrice: number | null;
    }[];
  };
  if (!payload.market?.length) throw new Error("Binance unavailable");
  // Re-shape to the raw ticker form the caller already parses.
  return payload.market.map((row) => ({
    symbol: row.symbol,
    lastPrice: String(row.price),
    priceChangePercent: String(row.change24h),
    volume: String(row.volume),
    quoteVolume: String(row.quoteVolume),
    highPrice: String(row.high),
    lowPrice: String(row.low),
    bidPrice: String(row.bidPrice ?? 0),
    askPrice: String(row.askPrice ?? 0),
  }));
}

async function loadDirectMarket(): Promise<RadarPayload> {
  const [tickers, globalResponse] = await Promise.all([
    loadTickers(),
    fetch("https://api.coinlore.net/api/global/", { cache: "no-store" }).catch(() => null),
  ]);
  const global = globalResponse?.ok
    ? ((await globalResponse.json()) as { btc_d?: string; mcap_change?: string }[])
    : [];
  const market = tickers
    .filter((row) => row.symbol.endsWith("USDT"))
    .filter((row) => {
      const base = row.symbol.slice(0, -4);
      return (
        !STABLE_BASES.has(base) &&
        !/(UP|DOWN|BULL|BEAR)$/.test(base) &&
        Number(row.lastPrice) > 0
      );
    })
    .map((row) => {
      const bidPrice = Number(row.bidPrice);
      const askPrice = Number(row.askPrice);
      const mid = (bidPrice + askPrice) / 2;
      return {
        symbol: row.symbol,
        price: Number(row.lastPrice),
        change5m: null,
        change15m: null,
        change1h: null,
        change4h: null,
        change24h: Number(row.priceChangePercent),
        volume: Number(row.volume),
        quoteVolume: Number(row.quoteVolume),
        high: Number(row.highPrice),
        low: Number(row.lowPrice),
        bidPrice: bidPrice > 0 ? bidPrice : null,
        askPrice: askPrice > 0 ? askPrice : null,
        spreadPct: mid > 0 ? ((askPrice - bidPrice) / mid) * 100 : null,
      };
    })
    .sort((left, right) => right.quoteVolume - left.quoteVolume);

  return {
    timestamp: new Date().toISOString(),
    sources: ["Binance Spot · universo USDT completo"],
    market,
    dominance: {
      btc: global[0]?.btc_d ? Number(global[0].btc_d) : null,
      change24h: global[0]?.mcap_change ? Number(global[0].mcap_change) : null,
    },
    news: [],
    errors: ["Confirmaciones multi-timeframe cargando"],
  };
}

type RollingTicker = { symbol: string; priceChangePercent: string };

/**
 * Combine two market snapshots without losing information from either.
 *
 * The direct browser fetch returns the full USDT universe but no rolling
 * windows, while the Worker returns a smaller list that may carry 1H/4H data.
 * Picking whichever array was longer used to throw the timeframe values away,
 * which silently dropped every multi-timeframe confirmation and pushed scores
 * under the signal thresholds. The wider list wins on coverage, and any
 * timeframe value the other snapshot holds is kept.
 */
function mergeMarkets(
  primary: RadarPayload["market"],
  secondary: RadarPayload["market"],
): RadarPayload["market"] {
  const base = primary.length >= secondary.length ? primary : secondary;
  const other = base === primary ? secondary : primary;
  if (!other.length) return base;
  const bySymbol = new Map(other.map((asset) => [asset.symbol, asset]));
  return base.map((asset) => {
    const match = bySymbol.get(asset.symbol);
    if (!match) return asset;
    return {
      ...asset,
      change5m: asset.change5m ?? match.change5m ?? null,
      change15m: asset.change15m ?? match.change15m ?? null,
      change1h: asset.change1h ?? match.change1h ?? null,
      change4h: asset.change4h ?? match.change4h ?? null,
      high: asset.high ?? match.high ?? null,
      low: asset.low ?? match.low ?? null,
    };
  });
}

async function enrichTimeframes(payload: RadarPayload): Promise<RadarPayload> {
  const candidates = payload.market
    .filter((asset) => asset.quoteVolume >= 5_000_000)
    .map((asset) => asset.symbol);
  const chunks = Array.from(
    { length: Math.ceil(candidates.length / 60) },
    (_, index) => candidates.slice(index * 60, index * 60 + 60),
  );
  const loadChunk = async (
    symbols: string[],
    windowSize: "5m" | "15m" | "1h" | "4h",
  ): Promise<RollingTicker[]> => {
    try {
      const url = new URL("https://data-api.binance.vision/api/v3/ticker");
      url.searchParams.set("symbols", JSON.stringify(symbols));
      url.searchParams.set("windowSize", windowSize);
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return (await response.json()) as RollingTicker[];
    } catch {
      // Binance refuses throttled browsers without CORS headers; fall through.
    }
    // Retry through the Worker so timeframe coverage survives a rate limit.
    const proxied = await fetch(
      `/api/rolling?windowSize=${windowSize}&symbols=${symbols.join(",")}`,
      { cache: "no-store" },
    );
    if (!proxied.ok) throw new Error("Rolling window unavailable");
    return (await proxied.json()) as RollingTicker[];
  };

  const loadWindow = async (windowSize: "5m" | "15m" | "1h" | "4h") => {
    const rows = (
      await Promise.all(chunks.map((symbols) => loadChunk(symbols, windowSize)))
    ).flat();
    return new Map(rows.map((row) => [row.symbol, Number(row.priceChangePercent)]));
  };

  const [fiveMinutes, fifteenMinutes, hour, fourHours] = await Promise.all([
    loadWindow("5m"), loadWindow("15m"), loadWindow("1h"), loadWindow("4h"),
  ]);
  return {
    ...payload,
    timestamp: new Date().toISOString(),
    sources: [...new Set([...payload.sources, "Binance Rolling Window 5M/15M/1H/4H"])],
    errors: payload.errors.filter((error) => !error.includes("multi-timeframe")),
    market: payload.market.map((asset) => ({
      ...asset,
      change5m: fiveMinutes.get(asset.symbol) ?? asset.change5m ?? null,
      change15m: fifteenMinutes.get(asset.symbol) ?? asset.change15m ?? null,
      change1h: hour.get(asset.symbol) ?? asset.change1h,
      change4h: fourHours.get(asset.symbol) ?? asset.change4h,
    })),
  };
}

function ScoreRing({ score, label }: { score: number | null; label: string }) {
  const numericScore = score ?? 0;
  return (
    <div
      className="score-ring"
      style={{ "--score": `${numericScore * 3.6}deg` } as React.CSSProperties}
    >
      <div>
        <b>{score ?? "—"}</b><span>/100</span><small>{label}</small>
      </div>
    </div>
  );
}

function SparkBars({ values }: { values: number[] }) {
  const maximum = Math.max(...values.map(Math.abs), 1);
  return (
    <div className="spark">
      {values.map((value, index) => (
        <i
          key={index}
          className={value >= 0 ? "up" : "down"}
          style={{ height: `${22 + (Math.abs(value) / maximum) * 72}%` }}
        />
      ))}
    </div>
  );
}

const capLabel = (value: number | null) => {
  if (value === null) return "DATA UNAVAILABLE";
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  return `$${value.toFixed(0)}`;
};

function MarketStrip({
  data,
  structure,
}: {
  data: RadarPayload;
  structure: MarketStructure | null;
}) {
  const btc = data.market.find((asset) => asset.symbol === "BTCUSDT");
  const eth = data.market.find((asset) => asset.symbol === "ETHUSDT");
  const primary = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT"];
  return (
    <div className="market-strip">
      {primary.map((symbol) => {
        const asset = data.market.find((candidate) => candidate.symbol === symbol);
        return (
          <div className="market-tile" key={symbol}>
            <span>{assetName(symbol)} <em>SPOT</em></span>
            {asset ? (
              <>
                <strong>{formatPrice(asset.price)}</strong>
                <small className={asset.change24h >= 0 ? "positive" : "negative"}>
                  {percentage(asset.change24h)} 24H
                </small>
              </>
            ) : (
              <strong className="muted">DATA UNAVAILABLE</strong>
            )}
          </div>
        );
      })}
      <div className="market-tile">
        <span>ETH/BTC <em>DERIVADO SPOT</em></span>
        <strong>{btc && eth ? (eth.price / btc.price).toFixed(6) : "—"}</strong>
        <small className={(eth?.change24h ?? 0) - (btc?.change24h ?? 0) >= 0 ? "positive" : "negative"}>
          {btc && eth ? percentage(eth.change24h - btc.change24h) : "DATA UNAVAILABLE"}
        </small>
      </div>
      <div className="market-tile">
        <span>BTC.D <em>GLOBAL</em></span>
        <strong>
          {structure?.dominance.btc != null
            ? `${structure.dominance.btc.toFixed(2)}%`
            : data.dominance.btc === null
              ? "—"
              : `${data.dominance.btc.toFixed(2)}%`}
        </strong>
        <small className="muted">{structure?.source ?? "COINLORE GLOBAL"}</small>
      </div>
      <div className={structure?.dominance.usdt == null ? "market-tile unavailable-tile" : "market-tile"}>
        <span>USDT.D <em>CAPITAL AL MARGEN</em></span>
        <strong>
          {structure?.dominance.usdt != null
            ? `${structure.dominance.usdt.toFixed(2)}%`
            : "DATA UNAVAILABLE"}
        </strong>
        <small className="muted">
          {structure?.dominance.stablecoins != null
            ? `+USDC ${structure.dominance.stablecoins.toFixed(2)}%`
            : "SIN DESGLOSE DE STABLES"}
        </small>
      </div>
      <div className="market-tile">
        <span>TOTAL <em>CAPITALIZACIÓN</em></span>
        <strong>{capLabel(structure?.totalMarketCap ?? null)}</strong>
        <small
          className={(structure?.marketCapChange24h ?? 0) >= 0 ? "positive" : "negative"}
        >
          {structure?.marketCapChange24h == null
            ? "—"
            : `${structure.marketCapChange24h >= 0 ? "+" : ""}${structure.marketCapChange24h.toFixed(2)}% 24H`}
        </small>
      </div>
      <div className="market-tile">
        <span>TOTAL2 <em>ALT MARKET CAP</em></span>
        <strong>{capLabel(structure?.total2 ?? null)}</strong>
        <small className="muted">SIN BTC</small>
      </div>
      <div className="market-tile">
        <span>TOTAL3 <em>EX BTC + ETH</em></span>
        <strong>{capLabel(structure?.total3 ?? null)}</strong>
        <small className="muted">SIN BTC NI ETH</small>
      </div>
    </div>
  );
}

function SignalDrawer({
  asset,
  close,
  altseason,
  risk,
}: {
  asset: ScoredAsset;
  close: () => void;
  altseason: number | null;
  risk: number | null;
}) {
  const observedRange =
    asset.high !== null && asset.low !== null ? asset.high - asset.low : null;
  const volatility = observedRange
    ? Math.max(observedRange * 0.15, asset.price * 0.012)
    : asset.price * 0.012;
  const isShort = asset.side === "SHORT";
  const entryA = isShort ? asset.price : asset.price - volatility * 0.15;
  const entryB = isShort ? asset.price + volatility * 0.15 : asset.price;
  const stop = isShort ? asset.price + volatility : asset.price - volatility;
  const riskUnit = Math.abs(asset.price - stop);
  const target = (multiple: number) =>
    Math.max(0, asset.price + (isShort ? -1 : 1) * riskUnit * multiple);
  const penaltyTotal = asset.penalties.reduce((sum, penalty) => sum + penalty.points, 0);

  return (
    <div className="overlay">
      <aside className="drawer" aria-label={`Detalle de ${asset.symbol}`}>
        <button className="close" onClick={close} aria-label="Cerrar">×</button>
        <p className="eyebrow">INTELIGENCIA DE SEÑAL · {new Date().toLocaleTimeString()}</p>
        <div className="drawer-symbol">
          <h2>{assetName(asset.symbol)}<span>/USDT</span></h2>
          <span className={`side-pill ${asset.side.toLowerCase()}`}>{asset.side}</span>
        </div>
        <div className={`signal-banner ${asset.signal.toLowerCase().replace(" ", "-")}`}>
          {asset.extended
            ? "⚠ MOVIMIENTO YA EXTENDIDO · NO PERSEGUIR"
            : `${asset.signal} · ${asset.score}/100`}
        </div>
        <div className="trade-grid">
          <div><span>ZONA DE ENTRADA</span><b>{formatPrice(entryA)} – {formatPrice(entryB)}</b></div>
          <div><span>INVALIDACIÓN</span><b>{formatPrice(stop)}</b></div>
          <div><span>OBJETIVO 1</span><b>{formatPrice(target(1.4))}</b></div>
          <div><span>OBJETIVO 2</span><b>{formatPrice(target(2.1))}</b></div>
          <div><span>OBJETIVO 3</span><b>{formatPrice(target(3))}</b></div>
          <div><span>R:R ESPERADO</span><b>1 : 3.0</b></div>
        </div>
        <h3>TRAZA DE DECISIÓN</h3>
        <div className="explain-list">
          {asset.reasons.map((reason) => (
            <div key={reason.label}><span>+{reason.points}</span>{reason.label}</div>
          ))}
          {asset.penalties.map((penalty) => (
            <div className="penalty" key={penalty.label}>
              <span>{penalty.points}</span>{penalty.label}
            </div>
          ))}
        </div>
        <div className="formula">
          <span>TÉCNICO {asset.technicalScore}</span>
          <span>PENALIZACIONES {penaltyTotal}</span>
          <b>FINAL {asset.score}</b>
        </div>
        <div className="drawer-context">
          <span>ALTSEASON <b>{altseason ?? "—"}/100</b></span>
          <span>RIESGO GLOBAL <b>{risk ?? "—"}/100</b></span>
          <span>DATOS <b>{asset.dataQuality === "FULL" ? "COMPLETOS" : "PARCIALES"}</b></span>
        </div>
        <p className="disclaimer">
          Timestamp: {new Date().toISOString()} · Fuente: Binance Spot. Niveles indicativos
          derivados de la volatilidad del rango 24H observado; no son ATR de velas ni una
          orden ejecutable. Validar estructura y deslizamiento antes de cualquier decisión.
        </p>
      </aside>
    </div>
  );
}

export default function RadarApp() {
  const [data, setData] = useState<RadarPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("RESUMEN");
  const [selected, setSelected] = useState<ScoredAsset | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [assetSearch, setAssetSearch] = useState("");
  const [profile, setProfile] = useState<ProfileId>("TRADING_PRO");
  const lastEnrichment = useRef(0);
  // Readings that live inside child panels. Held in a ref so the high-frequency
  // pump and correlation cycles do not re-render the whole dashboard; the
  // assistant reads them when a question is actually asked.
  const liveReadings = useRef<{
    pumps: PumpReading[];
    correlations: CorrelationInsights | null;
    orderFlow: BookmapBrainReadings | null;
  }>({ pumps: [], correlations: null, orderFlow: null });
  // The swing desk uses the brain's levels as confluence, so those prices are
  // held in state rather than only in the ref the assistant reads.
  const [swingConfluence, setSwingConfluence] = useState<number[]>([]);
  const handleBrainReadings = useCallback((readings: BookmapBrainReadings) => {
    liveReadings.current.orderFlow = readings;
    if (readings.symbol !== "BTCUSDT") return;
    const prices = readings.levels.map((level) => level.price);
    setSwingConfluence((current) =>
      current.length === prices.length &&
      current.every((value, index) => value === prices[index])
        ? current
        : prices,
    );
  }, []);
  const handlePumpReadings = useCallback((readings: PumpReading[]) => {
    liveReadings.current.pumps = readings;
  }, []);
  const handleCorrelationInsights = useCallback((insights: CorrelationInsights) => {
    liveReadings.current.correlations = insights;
  }, []);
  const [structure, setStructure] = useState<MarketStructure | null>(null);
  const [structureError, setStructureError] = useState("");
  const [structureTrend, setStructureTrend] = useState<AssistantContext["structureTrend"]>(null);
  const { settings, update: updateSettings } = useDashboardSettings();
  const workspace = useWorkspace();
  const profileInterval = TRADING_PROFILES[profile].interval;

  const refresh = useCallback(async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    try {
      const server = fetch("/api/radar", {
        cache: "no-store",
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) throw new Error();
        const payload = (await response.json()) as RadarPayload;
        if (!payload.market.length) throw new Error();
        return payload;
      });
      const direct = loadDirectMarket();
      const first = await Promise.any([direct, server]);
      setData(first);
      setLastUpdate(new Date());
      setError("");
      // Rolling-window requests are the heaviest calls the app makes: four
      // windows across ~180 symbols in chunks, and Binance weights that
      // endpoint far above a plain ticker. Running it on the 30s price cadence
      // is what gets a client rate limited, and 1H/4H values do not meaningfully
      // move in 30 seconds, so enrichment runs on its own slower clock.
      const applyTimeframes = (payload: RadarPayload) => {
        const now = Date.now();
        if (now - lastEnrichment.current < ENRICHMENT_INTERVAL_MS) {
          return Promise.resolve();
        }
        lastEnrichment.current = now;
        return enrichTimeframes(payload)
        .then((enriched) => {
          setData((current) =>
            current
              ? {
                  ...current,
                  timestamp: enriched.timestamp,
                  market: mergeMarkets(enriched.market, current.market),
                  sources: [...new Set([...current.sources, ...enriched.sources])],
                  errors: current.errors.filter(
                    (message) => !message.toLowerCase().includes("multi-timeframe"),
                  ),
                }
              : enriched,
          );
          setLastUpdate(new Date());
        })
        .catch(() => {
          // A failed enrichment should not lock out the next attempt.
          lastEnrichment.current = 0;
        });
      };
      void applyTimeframes(first);
      server
        .then((richer) => {
          setData((current) =>
            current
              ? {
                  ...richer,
                  market: mergeMarkets(current.market, richer.market),
                  news: richer.news.length ? richer.news : current.news,
                  dominance: {
                    btc: richer.dominance.btc ?? current.dominance.btc,
                    change24h:
                      richer.dominance.change24h ?? current.dominance.change24h,
                  },
                  sources: [...new Set([...current.sources, ...richer.sources])],
                  errors: [...new Set([...current.errors, ...richer.errors])],
                }
              : richer,
          );
          setLastUpdate(new Date());
        })
        .catch(() => undefined);
      direct
        .then((complete) => {
          setData((current) =>
            current
              ? {
                  ...current,
                  market: mergeMarkets(complete.market, current.market),
                  dominance: {
                    btc: current.dominance.btc ?? complete.dominance.btc,
                    change24h: current.dominance.change24h ?? complete.dominance.change24h,
                  },
                  sources: [...new Set([...current.sources, ...complete.sources])],
                }
              : complete,
          );
          setLastUpdate(new Date());
          if (complete !== first) void applyTimeframes(complete);
        })
        .catch(() => undefined);
    } catch {
      setError("CONEXIÓN DE DATOS NO DISPONIBLE");
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const boot = window.setTimeout(refresh, 0);
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      window.clearTimeout(boot);
      window.clearInterval(interval);
    };
  }, [refresh]);

  // Global capitalisation and dominance.
  //
  // CoinGecko is the only free source that breaks out stablecoin dominance, but
  // it blocks Cloudflare's egress addresses, so the Worker falls back to
  // CoinLore and USDT.D comes back null. It does allow browsers, so the client
  // asks directly first and keeps the Worker as the fallback — which also
  // spreads the request across users instead of one shared server IP.
  useEffect(() => {
    const load = async () => {
      try {
        const direct = await fetch("https://api.coingecko.com/api/v3/global", {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (direct.ok) {
          const raw = await direct.json();
          const parsed = parseCoinGeckoGlobal(raw);
          if (parsed) {
            setStructure(parsed);
            setStructureError("");
            // The scheduled job runs on Cloudflare, which CoinGecko blocks, so
            // every archived snapshot had USDT.D null. A client that reached it
            // contributes the reading the cron cannot obtain.
            void fetch("/api/market-structure", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(raw),
              keepalive: true,
            }).catch(() => undefined);
            return;
          }
        }
      } catch {
        // Blocked or throttled for this client; use the Worker instead.
      }
      try {
        const response = await fetch("/api/market-structure", { cache: "no-store" });
        if (!response.ok) throw new Error();
        setStructure((await response.json()) as MarketStructure);
        setStructureError("");
      } catch {
        setStructureError("ESTRUCTURA GLOBAL NO DISPONIBLE");
      }
    };
    const boot = window.setTimeout(load, 200);
    const interval = window.setInterval(load, 120_000);
    return () => {
      window.clearTimeout(boot);
      window.clearInterval(interval);
    };
  }, []);

  // Dominance over time, from the snapshots the scheduled job records. It
  // moves slowly, so once an hour is plenty.
  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch("/api/structure-trend?hours=24", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          points?: unknown[];
          change?: { btc: number | null; usdt: number | null; totalPct: number | null };
          hours?: number;
        };
        setStructureTrend({
          hours: payload.hours ?? 24,
          samples: payload.points?.length ?? 0,
          btcChange: payload.change?.btc ?? null,
          usdtChange: payload.change?.usdt ?? null,
          totalChangePct: payload.change?.totalPct ?? null,
        });
      } catch {
        // The assistant reports the absence rather than guessing.
      }
    };
    const boot = window.setTimeout(load, 1_500);
    const interval = window.setInterval(load, 60 * 60_000);
    return () => {
      window.clearTimeout(boot);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const capture = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", capture);
    return () => window.removeEventListener("beforeinstallprompt", capture);
  }, []);

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const scrollTo = (label: string, id: string) => {
    setTab(label);
    // Navigating to a collapsed section opens it first, otherwise the jump
    // lands on a closed handle and looks like the link is broken.
    if (workspace.open[id] === false) workspace.toggle(id);
    window.setTimeout(() => {
      const target =
        document.getElementById(id) ??
        document.querySelector(`[data-section="${id}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  };

  useEffect(() => {
    if (loading) return;
    const sections = NAV_ITEMS.map((item) => ({
      item,
      element: document.getElementById(item.id),
    })).filter((entry) => entry.element !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        const match = sections.find((entry) => entry.element === visible?.target);
        if (match) setTab(match.item.label);
      },
      { rootMargin: "-18% 0px -18% 0px", threshold: [0, 0.12, 0.35] },
    );
    sections.forEach(({ element }) => element && observer.observe(element));
    return () => observer.disconnect();
  }, [loading]);

  const risk = useMemo(() => globalRisk(data?.news ?? []), [data]);
  const altseason = useMemo(
    () => altseasonScore(data?.market ?? [], data?.dominance.btc ?? null, risk.score),
    [data, risk.score],
  );
  const allScored = useMemo(
    () =>
      scoreAssets(data?.market ?? [], risk.score, risk.killSwitch, {
        watch: settings.watch,
        setup: settings.setup,
        trigger: settings.trigger,
        minimumQuoteVolume: settings.minimumQuoteVolume,
      }),
    [data, risk, settings],
  );
  const universeSymbols = useMemo(() => {
    if (!data || settings.universe === "ALL") return null;
    const limit = Number(settings.universe);
    return new Set(data.market.slice(0, limit).map((asset) => asset.symbol));
  }, [data, settings.universe]);
  const scored = useMemo(
    () =>
      universeSymbols
        ? allScored.filter((asset) => universeSymbols.has(asset.symbol))
        : allScored,
    [allScored, universeSymbols],
  );
  const rotationState = useMemo(() => rotation(data?.market ?? []), [data]);
  const diagnostic = useMemo(
    () =>
      diagnoseSignals(scored, {
        watch: settings.watch,
        setup: settings.setup,
        trigger: settings.trigger,
        minimumQuoteVolume: settings.minimumQuoteVolume,
      }),
    [scored, settings],
  );
  const active = scored.filter((asset) => asset.signal !== "NO SIGNAL").slice(0, 6);
  const scannerRows = (assetSearch
    ? allScored.filter((asset) => asset.symbol.includes(assetSearch))
    : scored
  ).slice(0, 80);
  // Everything the assistant needs that comes from this component's own state.
  // The child panels' readings are merged in at question time, not here, so no
  // ref is read during render.
  const assistantBase = useMemo(
    () => ({
      timestamp: data?.timestamp ?? new Date().toISOString(),
      market: data?.market ?? [],
      scored,
      altseason: {
        final: altseason.final,
        raw: altseason.raw,
        state: altseason.state,
        adjustment: altseason.adjustment,
      },
      risk: { score: risk.score, level: risk.level, killSwitch: risk.killSwitch },
      structure,
      structureTrend,
      ledger: null,
      profile: {
        name: TRADING_PROFILES[profile].name,
        horizon: TRADING_PROFILES[profile].horizon,
        market: TRADING_PROFILES[profile].market,
      },
    }),
    [data, scored, altseason, risk, structure, structureTrend, profile],
  );

  const getAssistantContext = useCallback(
    (): AssistantContext => ({
      ...assistantBase,
      pumps: liveReadings.current.pumps,
      correlations: liveReadings.current.correlations,
      orderFlow: liveReadings.current.orderFlow,
    }),
    [assistantBase],
  );

  const multiTimeframeCoverage = data
    ? data.market.filter((asset) => asset.change1h !== null && asset.change4h !== null).length
    : 0;

  if (loading) {
    return (
      <main className="loading">
        <div className="brain-loader"><i /><i /><i /></div>
        <h1>ALT RADAR <b>PRO</b></h1>
        <p>INICIANDO CEREBRO DE MERCADO</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="loading">
        <h1>ALT RADAR <b>PRO</b></h1>
        <p>{error}</p>
        <button onClick={refresh}>REINTENTAR CONEXIÓN</button>
      </main>
    );
  }

  return (
    <main>
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark"><i /><i /><i /></div>
          <div>
            <b>ALT RADAR</b><span>PRO</span>
            <small>INTELIGENCIA DE MERCADO CRIPTO</small>
          </div>
        </div>
        <nav className="desktop-nav" aria-label="Navegación principal">
          {NAV_ITEMS.map(({ label, id }) => (
            <button
              key={label}
              className={tab === label ? "active" : ""}
              onClick={() => scrollTo(label, id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="system">
          <span className={error ? "offline" : "live"}>● {error ? "DEGRADADO" : "EN VIVO"}</span>
          <AccountPanel />
          {installPrompt && <button className="install-app" onClick={installApp}>↓ INSTALAR</button>}
          <button
            aria-label="Activar o desactivar sonido"
            onClick={() => updateSettings({ sound: !settings.sound })}
          >
            {settings.sound ? "◉" : "○"}
          </button>
          <button aria-label="Actualizar" onClick={refresh}>↻</button>
        </div>
      </header>

      <MarketStrip data={data} structure={structure} />

      <div className="shell">
        <WorkspaceBar
          open={workspace.open}
          toggle={workspace.toggle}
          setAll={workspace.setAll}
          reset={workspace.reset}
        />

        <div className="command-ribbon">
          <div><span>MARKET FEED</span><b>{data.market.length} PARES USDT</b></div>
          <div><span>COBERTURA 1H + 4H</span><b>{multiTimeframeCoverage} ACTIVOS</b></div>
          <div><span>EVENTOS GLOBALES</span><b>{data.news.length} CLUSTERS CURADOS</b></div>
          <div><span>ÚLTIMO CICLO</span><b>{lastUpdate?.toLocaleTimeString() ?? "—"}</b></div>
          <div className="ownership"><span>PRODUCT SYSTEM</span><b>URL.FX / 2026</b></div>
        </div>

        {risk.killSwitch && (
          <div className="macro-advisory">
            <b>⚠ CONTEXTO MACRO EXTREMO</b>
            <span>RIESGO {risk.score}/100 · CAPA INFORMATIVA</span>
            <small>
              El flujo de noticias marca riesgo elevado y penaliza el score de cada señal, pero
              no las bloquea: el motor técnico sigue operando y las señales afectadas quedan
              marcadas. La lectura de noticias está en su propio panel.
            </small>
            <a href="#inteligencia-global">VER PANEL DE NOTICIAS →</a>
          </div>
        )}

        <Collapsible id="resumen" label="RESUMEN" open={workspace.open["resumen"]} onToggle={workspace.toggle}>
        <section className="hero-grid" id="resumen">
            <article className="panel alt-panel">
              <div className="panel-head">
                <div><p className="eyebrow">CEREBRO DE MERCADO · RÉGIMEN</p><h2>Probabilidad de altseason</h2></div>
                <span className="status-dot">● CALCULADO</span>
              </div>
              <div className="alt-main">
                <ScoreRing score={altseason.final} label="AJUSTADO" />
                <div className="alt-state">
                  <span>ESTADO ACTUAL</span>
                  <h3>{altseason.state}</h3>
                  <p>
                    {altseason.final !== null && altseason.final >= 41
                      ? "La amplitud de capital se expande más allá de BTC. La confirmación depende de liquidez, tendencia y riesgo."
                      : "El capital permanece concentrado. No hay confirmación amplia de altcoins."}
                  </p>
                  <div className="score-audit">
                    <span>TÉCNICO BRUTO <b>{altseason.raw ?? "—"}</b></span>
                    <span>NOTICIAS / MACRO <b className="negative">{altseason.adjustment}</b></span>
                    <span>FINAL <b>{altseason.final ?? "—"}</b></span>
                  </div>
                </div>
              </div>
              <div className="factor-bars">
                {altseason.factors.slice(0, 5).map((factor) => (
                  <div key={factor.label}>
                    <span>{factor.label}</span>
                    <i><b style={{ width: `${(factor.points / 22) * 100}%` }} /></i>
                    <em>+{Math.round(factor.points)}</em>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel risk-panel">
              <div className="panel-head">
                <div><p className="eyebrow">INTELIGENCIA GLOBAL</p><h2>Riesgo geopolítico</h2></div>
                <span className={risk.killSwitch ? "badge critical" : "badge"}>{risk.level}</span>
              </div>
              <div className="risk-score">
                <b>{risk.score ?? "—"}</b><span>/100</span>
                <SparkBars
                  values={data.news.length ? data.news.slice(0, 9).map((news) => news.risk - 50) : [0, 0, 0, 0, 0]}
                />
              </div>
              <div className="risk-scale"><i /><i /><i /><i /><i /></div>
              <div className="global-intel-meta">
                <span>● RSS EN VIVO</span>
                <b>{data.news.length} EVENTOS SIN DUPLICADOS</b>
              </div>
              {data.news[0] ? (
                <a className="headline" href={data.news[0].url} target="_blank" rel="noreferrer">
                  <span>{data.news[0].status}</span>
                  <b>{data.news[0].title}</b>
                  <small>
                    {data.news[0].source} · {data.news[0].sourceCount ?? 1} FUENTE(S) · RIESGO {data.news[0].risk}
                  </small>
                  <div className="headline-impact">
                    <i className={data.news[0].btcImpact >= 0 ? "positive" : "negative"}>
                      BTC {data.news[0].btcImpact > 0 ? "+" : ""}{data.news[0].btcImpact}
                    </i>
                    <i className={data.news[0].altImpact >= 0 ? "positive" : "negative"}>
                      ALTS {data.news[0].altImpact > 0 ? "+" : ""}{data.news[0].altImpact}
                    </i>
                  </div>
                </a>
              ) : (
                <div className="empty">NOTICIAS NO DISPONIBLES</div>
              )}
            </article>

            <article className="panel rotation-panel">
              <div className="panel-head">
                <div><p className="eyebrow">FLUJO DE CAPITAL</p><h2>Radar de rotación</h2></div>
                <span className="phase">FASE {rotationState.phase}</span>
              </div>
              <div className="flow">
                {rotationState.values.map((item, index) => (
                  <div key={item.label} className={item.label === rotationState.leader ? "leader" : ""}>
                    <span>{item.label}</span><b>{item.value}%</b>{index < 4 && <em>›</em>}
                  </div>
                ))}
              </div>
              <p className="flow-caption">FASE ACTUAL DE ROTACIÓN</p>
              <h3>BTC <span>→</span> ETH <span>→</span> {rotationState.leader.toUpperCase()}</h3>
              <small>
                Inferido del rendimiento transversal de 24H. No representa flujos reales de fondos.
              </small>
            </article>
          </section>
        </Collapsible>

        <Collapsible id="inteligencia" label="SEÑALES" open={workspace.open["inteligencia"]} onToggle={workspace.toggle}>
        <section className="signals-section" id="inteligencia">
            <div className="section-head">
              <div><p className="eyebrow">MOTOR DE CONFLUENCIA</p><h2>Inteligencia activa</h2></div>
              <span>
                {active.length
                  ? `${active.length} CONFIGURACIONES CALIFICADAS`
                  : "SIN SEÑALES DE ALTA CONVICCIÓN"}
              </span>
            </div>
            {active.length ? (
              <div className="signal-cards">
                {active.slice(0, 3).map((asset) => (
                  <button
                    className={asset.riskAdvisory ? "signal-card risk-flagged" : "signal-card"}
                    key={asset.symbol}
                    onClick={() => setSelected(asset)}
                  >
                    <div>
                      <span className={`signal-pill ${asset.signal.toLowerCase()}`}>{asset.signal}</span>
                      <span className={`side-pill ${asset.side.toLowerCase()}`}>{asset.side}</span>
                      <small>{assetName(asset.symbol)}/USDT · 15M/1H</small>
                    </div>
                    {asset.riskAdvisory && (
                      <span className="risk-flag">⚠ CONTEXTO MACRO EXTREMO</span>
                    )}
                    <strong>{asset.score}<em>/100</em></strong>
                    <p>
                      {asset.reasons
                        .filter((reason) => reason.points >= 10)
                        .slice(0, 4)
                        .map((reason) => <span key={reason.label}>✓ {reason.label}</span>)}
                    </p>
                    <div>
                      <b>{percentage(asset.change24h)} <small>24H</small></b>
                      <b>{asset.liquidity} <small>LIQUIDEZ</small></b>
                      <i>VER TRAZA →</i>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="no-signals">
                <div>◎</div><h3>SIN SEÑALES DE ALTA CONVICCIÓN</h3>
                <p>El cerebro está monitoreando. No fabricará operaciones sin confirmaciones independientes.</p>
                {diagnostic.topScore !== null && (
                  <div className="signal-diagnostic">
                    <p className="diagnostic-title">POR QUÉ NO HAY SEÑALES AHORA</p>
                    <div className="diagnostic-grid">
                      <div>
                        <span>MEJOR CANDIDATO</span>
                        <b>
                          {assetName(diagnostic.topSymbol ?? "")} · {diagnostic.topScore}/100
                        </b>
                      </div>
                      <div>
                        <span>LE FALTA PARA WATCH</span>
                        <b>{diagnostic.pointsToWatch} PUNTOS</b>
                      </div>
                      <div>
                        <span>COBERTURA 1H + 4H</span>
                        <b
                          className={
                            diagnostic.partialDataPct > 50 ? "negative" : undefined
                          }
                        >
                          {(100 - diagnostic.partialDataPct).toFixed(0)}% DEL UNIVERSO
                        </b>
                      </div>
                    </div>
                    {diagnostic.blockers.length > 0 && (
                      <div className="diagnostic-blockers">
                        {diagnostic.blockers.map((blocker) => (
                          <span key={blocker.label}>
                            {blocker.label} <em>{blocker.count}/20</em>
                          </span>
                        ))}
                      </div>
                    )}
                    {diagnostic.partialDataPct > 50 && (
                      <p className="diagnostic-warning">
                        Más de la mitad del universo no tiene confirmación 1H/4H. Esto es una
                        limitación de datos, no una lectura de mercado: los scores están
                        penalizados por información incompleta.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </Collapsible>

        <Collapsible id="scalping" label="SCALPING" open={workspace.open["scalping"]} onToggle={workspace.toggle}>
  <ScalpingDesk
            market={data.market}
            riskScore={risk.score}
            killSwitch={risk.killSwitch}
            altseasonScore={altseason.final}
            minimumQuoteVolume={settings.minimumQuoteVolume}
          />
        </Collapsible>

        <Collapsible id="pumpeo" label="PUMPEO" open={workspace.open["pumpeo"]} onToggle={workspace.toggle}>
  <PumpRadar
            market={data.market}
            minimumQuoteVolume={settings.minimumQuoteVolume}
            onReadings={handlePumpReadings}
          />
        </Collapsible>

        <Collapsible id="institucional" label="INSTITUCIONAL" open={workspace.open["institucional"]} onToggle={workspace.toggle}>
          <InstitutionalDesk />
        </Collapsible>

        <Collapsible id="reservas" label="RESERVAS" open={workspace.open["reservas"]} onToggle={workspace.toggle}>
          <ExchangeFlowDesk />
        </Collapsible>

        <Collapsible id="liquidaciones" label="LIQUIDACIONES" open={workspace.open["liquidaciones"]} onToggle={workspace.toggle}>
          <LiquidationHeatmapDesk />
        </Collapsible>

        <Collapsible id="desbloqueos" label="DESBLOQUEOS" open={workspace.open["desbloqueos"]} onToggle={workspace.toggle}>
          <UnlockDesk />
        </Collapsible>

        <Collapsible id="swing" label="SWING" open={workspace.open["swing"]} onToggle={workspace.toggle}>
  <SwingDesk market={data.market} confluence={swingConfluence} />
        </Collapsible>

        <Collapsible id="asistente" label="ANALISTA" open={workspace.open["asistente"]} onToggle={workspace.toggle}>
  <AssistantConsole getContext={getAssistantContext} />
        </Collapsible>

        <Collapsible id="riesgo" label="RIESGO" open={workspace.open["riesgo"]} onToggle={workspace.toggle}>
  <RiskDesk profile={profile} setProfile={setProfile} market={data.market} />
        </Collapsible>

        <Collapsible id="comparador" label="COMPARAR" open={workspace.open["comparador"]} onToggle={workspace.toggle}>
  <CompareChart
            symbols={data.market.map((asset) => asset.symbol)}
            defaultInterval={profileInterval}
          />
        </Collapsible>

        <Collapsible id="estructura" label="DOMINANCIA" open={workspace.open["estructura"]} onToggle={workspace.toggle}>
  <MarketStructurePanel data={structure} error={structureError} />
        </Collapsible>

        <Collapsible id="vigilancia" label="CORRELACIONES" open={workspace.open["vigilancia"]} onToggle={workspace.toggle}>
  <CorrelationWatch
            defaultInterval={profileInterval}
            market={data.market}
            onInsights={handleCorrelationInsights}
          />
        </Collapsible>

        <Collapsible id="order-flow" label="ORDER FLOW" open={workspace.open["order-flow"]} onToggle={workspace.toggle}>
  <div id="order-flow"><LiveBookmap
            symbols={data.market.map((asset) => asset.symbol)}
            altseason={{
              score: altseason.final,
              raw: altseason.raw,
              adjustment: altseason.adjustment,
              state: altseason.state,
            }}
            news={data.news}
            onBrainReadings={handleBrainReadings}
          /></div>
        </Collapsible>

        <Collapsible id="scanner" label="ESCÁNER" open={workspace.open["scanner"]} onToggle={workspace.toggle}>
        <section className="lower-grid" id="scanner">
            <article className="panel scanner">
              <div className="panel-head">
                <div><p className="eyebrow">UNIVERSO BINANCE USDT COMPLETO</p><h2>Escáner probabilístico</h2></div>
                <div className="scanner-tools">
                  <input
                    aria-label="Buscar criptomoneda"
                    placeholder="Buscar BABY, SUI, BTC…"
                    value={assetSearch}
                    onChange={(event) => setAssetSearch(event.target.value.toUpperCase())}
                  />
                  <span className="muted">{scored.length} ACTIVOS · EN VIVO</span>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ACTIVO</th><th>PRECIO</th><th>1H</th><th>4H</th><th>24H</th>
                      <th>VOL 24H</th><th>MOMENTUM</th><th>OI</th><th>FUNDING</th>
                      <th>SCORE</th><th>DIRECCIÓN</th><th>SEÑAL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scannerRows.map((asset) => (
                      <tr key={asset.symbol} onClick={() => setSelected(asset)}>
                        <td><b>{assetName(asset.symbol)}</b><small>/USDT</small></td>
                        <td>{formatPrice(asset.price)}</td>
                        <td className={(asset.change1h ?? 0) >= 0 ? "positive" : "negative"}>{percentage(asset.change1h)}</td>
                        <td className={(asset.change4h ?? 0) >= 0 ? "positive" : "negative"}>{percentage(asset.change4h)}</td>
                        <td className={asset.change24h >= 0 ? "positive" : "negative"}>{percentage(asset.change24h)}</td>
                        <td>${compact(asset.quoteVolume)}</td>
                        <td><SparkBars values={[asset.change24h * 0.3, asset.change4h ?? 0, asset.change1h ?? 0, asset.momentum]} /></td>
                        <td className="data-na">—</td><td className="data-na">—</td>
                        <td><div className="mini-score"><i style={{ width: `${asset.score}%` }} /><b>{asset.score}</b></div></td>
                        <td><span className={`side-pill ${asset.side.toLowerCase()}`}>{asset.side}</span></td>
                        <td>
                          <span className={`signal-pill ${asset.signal.toLowerCase().replace(" ", "-")}`}>
                            {asset.extended ? "EXTENDIDO" : asset.signal}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="data-footnote">
                OI y funding se muestran como “—” cuando el proveedor Spot no los entrega. El sistema
                no reemplaza datos ausentes con estimaciones.
              </div>
            </article>

            <article className="panel intelligence" id="inteligencia-global">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">FLUJO DE EVENTOS CURADO · CAPA SEPARADA</p>
                  <h2>Inteligencia global</h2>
                </div>
                <span className={risk.killSwitch ? "badge critical" : "badge"}>
                  {risk.killSwitch ? "RIESGO EXTREMO" : "ALTO + CRÍTICO"}
                </span>
              </div>
              <p className="intelligence-note">
                Contexto para interpretar los movimientos que ves en el radar. No bloquea señales
                ni decide por vos.
              </p>
              <div className="news-list">
                {data.news.slice(0, 7).map((news) => (
                  <a href={news.url} target="_blank" rel="noreferrer" key={news.id}>
                    <time>{new Date(news.publishedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                    <div>
                      <b>{news.title}</b>
                      <small>{news.region} · {news.status} · {news.sourceCount ?? 1} FUENTE(S)</small>
                    </div>
                    <span className={news.risk > 70 ? "hot" : ""}>{news.risk}</span>
                  </a>
                ))}
                {!data.news.length && <div className="empty">NOTICIAS GLOBALES NO DISPONIBLES</div>}
              </div>
            </article>
          </section>
        </Collapsible>

        <Collapsible id="historial" label="HISTORIAL" open={workspace.open["historial"]} onToggle={workspace.toggle}>
  <SignalLedger
            settings={settings}
            updateSettings={updateSettings}
            altseason={altseason.final}
            risk={risk.score}
            active={active}
            sources={data.sources}
          />
        </Collapsible>

        <Collapsible id="instalar" label="INSTALAR" open={workspace.open["instalar"]} onToggle={workspace.toggle}>
  <InstallPanel />
        </Collapsible>

        <footer>
          <div className="footer-brand">
            <b>ALT RADAR PRO</b>
            <span>INTELIGENCIA DE DECISIÓN · NO EJECUCIÓN</span>
          </div>
          <div className="footer-legal">
            <p>Las señales son escenarios probabilísticos, no garantías ni asesoramiento financiero.</p>
            <b>© 2026 URL.FX · TODOS LOS DERECHOS RESERVADOS.</b>
          </div>
          <small>
            Actualizado {lastUpdate?.toLocaleTimeString() ?? "—"} · Fuentes: {data.sources.join(" · ") || "no disponibles"}
          </small>
        </footer>
      </div>

      {selected && (
        <SignalDrawer
          asset={selected}
          close={() => setSelected(null)}
          altseason={altseason.final}
          risk={risk.score}
        />
      )}

      <nav className="mobile-nav" aria-label="Navegación móvil">
        {NAV_ITEMS.map(({ label, mobile, icon, id }) => (
          <button
            key={label}
            className={tab === label ? "active" : ""}
            aria-current={tab === label ? "page" : undefined}
            aria-label={label}
            onClick={() => scrollTo(label, id)}
          >
            <span aria-hidden="true">{icon}</span>
            <small>{mobile}</small>
          </button>
        ))}
      </nav>
    </main>
  );
}
