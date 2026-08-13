export type LiquidityLevel = [number, number];

export type LiquiditySnapshot = {
  id: string;
  symbol: string;
  venue: "spot" | "futures";
  capturedAt: string;
  mid: number;
  bids: LiquidityLevel[];
  asks: LiquidityLevel[];
  source: string;
};

type SnapshotRow = {
  id: string;
  symbol: string;
  venue: "spot" | "futures";
  captured_at: string;
  mid: number;
  bids: string;
  asks: string;
  source: string;
};

const MAX_LEVELS = 20;
const MAX_BODY_BYTES = 48_000;

export async function ensureLiquiditySchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS liquidity_snapshots (
      id TEXT PRIMARY KEY NOT NULL,
      symbol TEXT NOT NULL,
      venue TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      mid REAL NOT NULL,
      bids TEXT NOT NULL,
      asks TEXT NOT NULL,
      source TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS liquidity_snapshots_market_time_idx
      ON liquidity_snapshots (symbol, venue, captured_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS liquidity_snapshots_captured_idx
      ON liquidity_snapshots (captured_at)`),
  ]);
}

function parseLevels(value: string): LiquidityLevel[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return validateLevels(parsed);
  } catch {
    return [];
  }
}

export function validateLevels(value: unknown): LiquidityLevel[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_LEVELS)
    .filter((level): level is unknown[] => Array.isArray(level) && level.length >= 2)
    .map((level) => [Number(level[0]), Number(level[1])] as LiquidityLevel)
    .filter(([price, quantity]) =>
      Number.isFinite(price) &&
      Number.isFinite(quantity) &&
      price > 0 &&
      quantity > 0,
    );
}

function mapRow(row: SnapshotRow): LiquiditySnapshot {
  return {
    id: row.id,
    symbol: row.symbol,
    venue: row.venue,
    capturedAt: row.captured_at,
    mid: Number(row.mid),
    bids: parseLevels(row.bids),
    asks: parseLevels(row.asks),
    source: row.source,
  };
}

export async function readLiquidityHistory(
  db: D1Database,
  symbol: string,
  venue: "spot" | "futures",
  hours = 24,
) {
  await ensureLiquiditySchema(db);
  const safeHours = Math.max(1 / 12, Math.min(24, hours));
  const since = new Date(Date.now() - safeHours * 3_600_000).toISOString();
  const result = await db.prepare(
    `SELECT id, symbol, venue, captured_at, mid, bids, asks, source
     FROM liquidity_snapshots
     WHERE symbol = ?1 AND venue = ?2 AND captured_at >= ?3
     ORDER BY captured_at ASC
     LIMIT 1600`,
  ).bind(symbol, venue, since).all<SnapshotRow>();
  const snapshots = result.results
    .map(mapRow)
    .filter((snapshot) => snapshot.bids.length && snapshot.asks.length);
  const targetSamples = 520;
  if (snapshots.length <= targetSamples) return snapshots;
  const step = Math.ceil(snapshots.length / targetSamples);
  const sampled = snapshots.filter((_, index) => index % step === 0);
  const latest = snapshots.at(-1)!;
  if (sampled.at(-1)?.id !== latest.id) sampled.push(latest);
  return sampled;
}

export async function storeLiquiditySnapshot(
  db: D1Database,
  input: {
    symbol: string;
    venue: "spot" | "futures";
    capturedAt: string;
    mid: number;
    bids: unknown;
    asks: unknown;
  },
) {
  await ensureLiquiditySchema(db);
  const bids = validateLevels(input.bids);
  const asks = validateLevels(input.asks);
  const capturedMs = Date.parse(input.capturedAt);
  const now = Date.now();
  if (
    !/^[A-Z0-9]{2,24}USDT$/.test(input.symbol) ||
    !Number.isFinite(capturedMs) ||
    Math.abs(now - capturedMs) > 5 * 60_000 ||
    !Number.isFinite(input.mid) ||
    input.mid <= 0 ||
    bids.length < 5 ||
    asks.length < 5 ||
    bids[0][0] >= asks[0][0]
  ) {
    throw new Error("INVALID_LIQUIDITY_SNAPSHOT");
  }
  const calculatedMid = (bids[0][0] + asks[0][0]) / 2;
  if (Math.abs(input.mid / calculatedMid - 1) > 0.002) {
    throw new Error("MID_MISMATCH");
  }
  const normalizedAt = new Date(capturedMs).toISOString();
  const bodySize = JSON.stringify({ bids, asks }).length;
  if (bodySize > MAX_BODY_BYTES) throw new Error("SNAPSHOT_TOO_LARGE");

  const latest = await db.prepare(
    `SELECT captured_at FROM liquidity_snapshots
     WHERE symbol = ?1 AND venue = ?2
     ORDER BY captured_at DESC LIMIT 1`,
  ).bind(input.symbol, input.venue).first<{ captured_at: string }>();
  if (latest && capturedMs - Date.parse(latest.captured_at) < 55_000) {
    return { stored: false, reason: "COOLDOWN" as const };
  }
  const minuteBucket = Math.floor(capturedMs / 60_000);
  const id = `${input.symbol}:${input.venue}:${minuteBucket}`;
  await db.batch([
    db.prepare(
      `INSERT INTO liquidity_snapshots (
        id, symbol, venue, captured_at, mid, bids, asks, source
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      ON CONFLICT(id) DO NOTHING`,
    ).bind(
      id,
      input.symbol,
      input.venue,
      normalizedAt,
      calculatedMid,
      JSON.stringify(bids),
      JSON.stringify(asks),
      `Binance ${input.venue === "futures" ? "Futures" : "Spot"} WebSocket · navegador validado`,
    ),
    db.prepare(
      `DELETE FROM liquidity_snapshots
       WHERE captured_at < ?1`,
    ).bind(new Date(now - 25 * 3_600_000).toISOString()),
  ]);
  return { stored: true, id };
}
