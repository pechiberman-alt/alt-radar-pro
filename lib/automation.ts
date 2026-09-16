import {
  altseasonScore,
  globalRisk,
  scoreAssets,
  type MarketAsset,
} from "./radar";
import { loadGlobalNews } from "./news-intelligence";

const BINANCE_ENDPOINTS = [
  "https://data-api.binance.vision",
  "https://api-gcp.binance.com",
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api3.binance.com",
  "https://api4.binance.com",
  "https://api.binance.com",
];
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
type BinanceTicker = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  volume: string;
  quoteVolume: string;
  highPrice: string;
  lowPrice: string;
};

type RollingTicker = { symbol: string; priceChangePercent: string };

type StoredSignal = {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  signal: "SETUP" | "TRIGGER";
  timeframe: string;
  entry_price: number;
  detected_at: string;
  price_5m: number | null;
  price_15m: number | null;
  price_1h: number | null;
  price_4h: number | null;
  price_24h: number | null;
  max_move: number;
  min_move: number;
};

export type AutomationResult = {
  status: "COMPLETED" | "SKIPPED";
  inserted: number;
  evaluated: number;
  universe: number;
  altseason: number | null;
  risk: number | null;
  timestamp: string;
};

async function fetchJson<T>(url: string, timeout = 7_000): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "ALT-RADAR-PRO/2.0" },
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} · ${new URL(url).host}`);
  return response.json() as Promise<T>;
}

export async function ensureSignalSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS signal_records (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('LONG','SHORT')),
      signal TEXT NOT NULL CHECK(signal IN ('SETUP','TRIGGER')),
      score INTEGER NOT NULL,
      technical_score INTEGER NOT NULL,
      altseason_score INTEGER,
      geopolitical_risk INTEGER,
      entry_price REAL NOT NULL,
      source TEXT NOT NULL,
      timeframe TEXT NOT NULL DEFAULT '15m / 1H',
      detected_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'MONITORING' CHECK(status IN ('MONITORING','RESOLVED')),
      reasons TEXT NOT NULL DEFAULT '[]',
      penalties TEXT NOT NULL DEFAULT '[]',
      price_5m REAL,
      return_5m REAL,
      captured_5m TEXT,
      price_15m REAL,
      return_15m REAL,
      captured_15m TEXT,
      price_1h REAL,
      return_1h REAL,
      captured_1h TEXT,
      price_4h REAL,
      return_4h REAL,
      captured_4h TEXT,
      price_24h REAL,
      return_24h REAL,
      captured_24h TEXT,
      max_move REAL NOT NULL DEFAULT 0,
      min_move REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS signal_records_detected_idx ON signal_records(detected_at)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS signal_records_symbol_side_idx ON signal_records(symbol, side)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS signal_records_status_idx ON signal_records(status)",
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS automation_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
  ]);
  const columns = await db
    .prepare("PRAGMA table_info(signal_records)")
    .all<{ name: string }>();
  const names = new Set(columns.results.map((column) => column.name));
  const additions = [
    ["price_5m", "ALTER TABLE signal_records ADD COLUMN price_5m REAL"],
    ["return_5m", "ALTER TABLE signal_records ADD COLUMN return_5m REAL"],
    ["captured_5m", "ALTER TABLE signal_records ADD COLUMN captured_5m TEXT"],
  ] as const;
  const missing = additions
    .filter(([name]) => !names.has(name))
    .map(([, statement]) => db.prepare(statement));
  if (missing.length) await db.batch(missing);
}

async function loadBinanceMarket(): Promise<{ market: MarketAsset[]; source: string }> {
  let base = "";
  let tickers: BinanceTicker[] = [];
  let lastError: unknown;
  for (const endpoint of BINANCE_ENDPOINTS) {
    try {
      tickers = await fetchJson<BinanceTicker[]>(`${endpoint}/api/v3/ticker/24hr`);
      base = endpoint;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!base || !tickers.length) throw lastError ?? new Error("Binance unavailable");
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
    .map((row) => ({
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
    }))
    .sort((left, right) => right.quoteVolume - left.quoteVolume);

  const liquid = market.filter((asset) => asset.quoteVolume >= 5_000_000).slice(0, 180);
  const chunks = Array.from(
    { length: Math.ceil(liquid.length / 60) },
    (_, index) => liquid.slice(index * 60, index * 60 + 60).map((asset) => asset.symbol),
  );
  const loadWindow = async (windowSize: "5m" | "15m" | "1h" | "4h") => {
    const rows = (
      await Promise.all(
        chunks.map((symbols) => {
          const url = new URL(`${base}/api/v3/ticker`);
          url.searchParams.set("symbols", JSON.stringify(symbols));
          url.searchParams.set("windowSize", windowSize);
          return fetchJson<RollingTicker[]>(url.toString());
        }),
      )
    ).flat();
    return new Map(rows.map((row) => [row.symbol, Number(row.priceChangePercent)]));
  };

  try {
    const [fiveMinutes, fifteenMinutes, hour, fourHours] = await Promise.all([
      loadWindow("5m"), loadWindow("15m"), loadWindow("1h"), loadWindow("4h"),
    ]);
    return {
      source: `Binance Spot · ${new URL(base).host}`,
      market: market.map((asset) => ({
        ...asset,
        change5m: fiveMinutes.get(asset.symbol) ?? null,
        change15m: fifteenMinutes.get(asset.symbol) ?? null,
        change1h: hour.get(asset.symbol) ?? null,
        change4h: fourHours.get(asset.symbol) ?? null,
      })),
    };
  } catch {
    return { market, source: `Binance Spot · ${new URL(base).host} · TF parcial` };
  }
}

async function loadCoinLoreMarket(): Promise<{ market: MarketAsset[]; source: string }> {
  const payload = await fetchJson<{
    data?: {
      symbol: string;
      price_usd: string;
      percent_change_1h: string;
      percent_change_24h: string;
      volume24: number;
      volume24_native?: number;
    }[];
  }>("https://api.coinlore.net/api/tickers/?start=0&limit=100", 7_000);
  const market = (payload.data ?? [])
    .filter((row) => row.symbol && Number(row.price_usd) > 0)
    .map((row) => ({
      symbol: `${row.symbol.toUpperCase()}USDT`,
      price: Number(row.price_usd),
      change1h: Number.isFinite(Number(row.percent_change_1h))
        ? Number(row.percent_change_1h)
        : null,
      change4h: null,
      change24h: Number(row.percent_change_24h),
      volume: Number(row.volume24_native ?? 0),
      quoteVolume: Number(row.volume24),
      high: null,
      low: null,
    }))
    .sort((left, right) => right.quoteVolume - left.quoteVolume);
  if (!market.length) throw new Error("CoinLore unavailable");
  return { market, source: "CoinLore Market · respaldo cloud" };
}

export async function loadMarket() {
  try {
    return await loadBinanceMarket();
  } catch {
    return loadCoinLoreMarket();
  }
}

export async function loadRiskScore() {
  try {
    const intelligence = await loadGlobalNews();
    return globalRisk(intelligence.events);
  } catch {
    return globalRisk([]);
  }
}

export async function loadBtcDominance() {
  try {
    const [global] = await fetchJson<{ btc_d?: string }[]>(
      "https://api.coinlore.net/api/global/",
      5_000,
    );
    const value = Number(global?.btc_d);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function directionalReturn(side: "LONG" | "SHORT", entry: number, price: number) {
  const raw = ((price / entry) - 1) * 100;
  return side === "LONG" ? raw : -raw;
}

export async function evaluateOpenSignals(
  db: D1Database,
  prices: Map<string, number>,
  now: Date,
) {
  const result = await db
    .prepare(
      `SELECT id, symbol, side, signal, timeframe, entry_price, detected_at,
        price_5m, price_15m, price_1h, price_4h, price_24h, max_move, min_move
      FROM signal_records
      WHERE status = 'MONITORING'
      ORDER BY detected_at ASC
      LIMIT 200`,
    )
    .all<StoredSignal>();
  let evaluated = 0;

  for (const record of result.results) {
    const currentPrice = prices.get(record.symbol);
    if (!currentPrice) continue;
    const detected = new Date(record.detected_at).getTime();
    const elapsed = now.getTime() - detected;
    const movement = directionalReturn(record.side, record.entry_price, currentPrice);
    const capture5m =
      record.price_5m === null && elapsed >= 5 * 60_000 && elapsed <= 20 * 60_000;
    const capture15m = record.price_15m === null && elapsed >= 15 * 60_000;
    const capture1h = record.price_1h === null && elapsed >= 60 * 60_000;
    const capture4h = record.price_4h === null && elapsed >= 4 * 60 * 60_000;
    const capture24h = record.price_24h === null && elapsed >= 24 * 60 * 60_000;
    const timestamp = now.toISOString();

    await db
      .prepare(
        `UPDATE signal_records SET
          price_5m = COALESCE(price_5m, ?1),
          return_5m = COALESCE(return_5m, ?2),
          captured_5m = COALESCE(captured_5m, ?3),
          price_15m = COALESCE(price_15m, ?4),
          return_15m = COALESCE(return_15m, ?5),
          captured_15m = COALESCE(captured_15m, ?6),
          price_1h = COALESCE(price_1h, ?7),
          return_1h = COALESCE(return_1h, ?8),
          captured_1h = COALESCE(captured_1h, ?9),
          price_4h = COALESCE(price_4h, ?10),
          return_4h = COALESCE(return_4h, ?11),
          captured_4h = COALESCE(captured_4h, ?12),
          price_24h = COALESCE(price_24h, ?13),
          return_24h = COALESCE(return_24h, ?14),
          captured_24h = COALESCE(captured_24h, ?15),
          max_move = ?16,
          min_move = ?17,
          status = ?18,
          updated_at = ?19
        WHERE id = ?20`,
      )
      .bind(
        capture5m ? currentPrice : null,
        capture5m ? movement : null,
        capture5m ? timestamp : null,
        capture15m ? currentPrice : null,
        capture15m ? movement : null,
        capture15m ? timestamp : null,
        capture1h ? currentPrice : null,
        capture1h ? movement : null,
        capture1h ? timestamp : null,
        capture4h ? currentPrice : null,
        capture4h ? movement : null,
        capture4h ? timestamp : null,
        capture24h ? currentPrice : null,
        capture24h ? movement : null,
        capture24h ? timestamp : null,
        Math.max(record.max_move, movement),
        Math.min(record.min_move, movement),
        record.timeframe.startsWith("SCALP") && capture15m
          ? "RESOLVED"
          : capture24h ? "RESOLVED" : "MONITORING",
        timestamp,
        record.id,
      )
      .run();
    evaluated += 1;
  }

  return evaluated;
}

export async function runSignalAutomation(
  db: D1Database,
  options: { force?: boolean } = {},
): Promise<AutomationResult> {
  await ensureSignalSchema(db);
  const now = new Date();
  const timestamp = now.toISOString();
  const lock = await db
    .prepare("SELECT value FROM automation_state WHERE key = ?1")
    .bind("last_run")
    .first<{ value: string }>();
  const elapsed = lock?.value ? now.getTime() - new Date(lock.value).getTime() : Infinity;

  if (!options.force && elapsed < 4 * 60_000) {
    return {
      status: "SKIPPED",
      inserted: 0,
      evaluated: 0,
      universe: 0,
      altseason: null,
      risk: null,
      timestamp,
    };
  }

  await db
    .prepare(
      `INSERT INTO automation_state(key, value, updated_at)
       VALUES (?1, ?2, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind("last_run", timestamp)
    .run();

  const [marketLoad, risk, btcDominance] = await Promise.all([
    loadMarket(),
    loadRiskScore(),
    loadBtcDominance(),
  ]);
  const market = marketLoad.market;
  const prices = new Map(market.map((asset) => [asset.symbol, asset.price]));
  const evaluated = await evaluateOpenSignals(db, prices, now);
  const altseason = altseasonScore(market, btcDominance, risk.score);
  const candidates = scoreAssets(market, risk.score, risk.killSwitch)
    .filter(
      (asset) =>
        (asset.signal === "SETUP" || asset.signal === "TRIGGER") &&
        (asset.side === "LONG" || asset.side === "SHORT"),
    )
    .slice(0, 6);
  let inserted = 0;

  for (const asset of candidates) {
    const previous = await db
      .prepare(
        `SELECT signal, detected_at FROM signal_records
         WHERE symbol = ?1 AND side = ?2
         ORDER BY detected_at DESC LIMIT 1`,
      )
      .bind(asset.symbol, asset.side)
      .first<{ signal: "SETUP" | "TRIGGER"; detected_at: string }>();
    const previousAge = previous
      ? now.getTime() - new Date(previous.detected_at).getTime()
      : Infinity;
    const isUpgrade = previous?.signal === "SETUP" && asset.signal === "TRIGGER";
    if (previousAge < 60 * 60_000 && !(isUpgrade && previousAge >= 10 * 60_000)) {
      continue;
    }

    await db
      .prepare(
        `INSERT INTO signal_records (
          id, symbol, side, signal, score, technical_score, altseason_score,
          geopolitical_risk, entry_price, source, timeframe, detected_at,
          status, reasons, penalties, updated_at
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
          'MONITORING', ?13, ?14, ?12
        )`,
      )
      .bind(
        crypto.randomUUID(),
        asset.symbol,
        asset.side,
        asset.signal,
        asset.score,
        asset.technicalScore,
        altseason.final,
        risk.score,
        asset.price,
        `${marketLoad.source} · RSS global verificado · CoinLore Global`,
        "15m / 1H / 4H",
        timestamp,
        JSON.stringify(asset.reasons),
        JSON.stringify(asset.penalties),
      )
      .run();
    inserted += 1;
  }

  await db
    .prepare(
      `INSERT INTO automation_state(key, value, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(
      "last_summary",
      JSON.stringify({ inserted, evaluated, universe: market.length }),
      timestamp,
    )
    .run();

  return {
    status: "COMPLETED",
    inserted,
    evaluated,
    universe: market.length,
    altseason: altseason.final,
    risk: risk.score,
    timestamp,
  };
}


/**
 * A browser request can no longer write to the track record.
 *
 * It used to submit both the candidate signals AND the prices they were graded
 * against, and the server only checked those two against each other. That meant
 * anyone could POST a hand-made snapshot — no account, no session — and write
 * winning signals into the public Win Rate and Profit Factor. Insertions now
 * come only from the server-side crons (runSignalAutomation every 15 min,
 * runScalpingAutomation every 5), which fetch their own market data. All a
 * browser can ask for is this: re-check the open signals against prices the
 * server fetches itself.
 */
export async function syncOpenSignals(db: D1Database): Promise<AutomationResult> {
  await ensureSignalSchema(db);
  const now = new Date();
  const timestamp = now.toISOString();
  const marketLoad = await loadMarket();
  const prices = new Map(
    marketLoad.market.map((asset) => [asset.symbol, asset.price] as const),
  );
  const evaluated = await evaluateOpenSignals(db, prices, now);

  return {
    status: "COMPLETED",
    inserted: 0,
    evaluated,
    universe: prices.size,
    altseason: null,
    risk: null,
    timestamp,
  };
}
