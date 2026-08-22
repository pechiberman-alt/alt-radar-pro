import type { MarketStructure } from "./market-structure";

/**
 * Persists a periodic snapshot of global capitalisation and dominance.
 *
 * Every free source publishes only the current value, so USDT.D, BTC.D and
 * TOTAL are readable but not trendable — and the direction of dominance is
 * where the information is. Recording the reading builds a series the app
 * owns, which after a few days answers questions no free feed will.
 */

export type StructurePoint = {
  capturedAt: string;
  totalMarketCap: number | null;
  total2: number | null;
  total3: number | null;
  btcDominance: number | null;
  ethDominance: number | null;
  usdtDominance: number | null;
  stablecoinDominance: number | null;
};

export type StructureTrend = {
  points: StructurePoint[];
  /** Change over the window, in percentage points, for each dominance series. */
  change: {
    btc: number | null;
    usdt: number | null;
    totalPct: number | null;
  };
};

export async function ensureStructureSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS structure_snapshots (
      captured_at TEXT PRIMARY KEY,
      total_market_cap REAL,
      total2 REAL,
      total3 REAL,
      btc_dominance REAL,
      eth_dominance REAL,
      usdt_dominance REAL,
      stablecoin_dominance REAL,
      source TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS structure_snapshots_time_idx ON structure_snapshots(captured_at)",
    ),
  ]);
}

/** Snapshots are taken at most this often, so a busy cron cannot flood D1. */
const MIN_INTERVAL_MS = 10 * 60_000;

export async function recordStructureSnapshot(
  db: D1Database,
  structure: MarketStructure,
  now = new Date(),
): Promise<"WRITTEN" | "SKIPPED"> {
  await ensureStructureSchema(db);

  const last = await db
    .prepare("SELECT captured_at FROM structure_snapshots ORDER BY captured_at DESC LIMIT 1")
    .first<{ captured_at: string }>();
  if (last?.captured_at) {
    const elapsed = now.getTime() - Date.parse(last.captured_at);
    if (Number.isFinite(elapsed) && elapsed < MIN_INTERVAL_MS) return "SKIPPED";
  }

  // Nothing is stored when the upstream reading itself was unusable.
  if (structure.totalMarketCap === null) return "SKIPPED";

  await db
    .prepare(
      `INSERT INTO structure_snapshots (
        captured_at, total_market_cap, total2, total3,
        btc_dominance, eth_dominance, usdt_dominance, stablecoin_dominance, source
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      ON CONFLICT(captured_at) DO NOTHING`,
    )
    .bind(
      now.toISOString(),
      structure.totalMarketCap,
      structure.total2,
      structure.total3,
      structure.dominance.btc,
      structure.dominance.eth,
      structure.dominance.usdt,
      structure.dominance.stablecoins,
      structure.source,
    )
    .run();

  // Roughly 60 days at one snapshot per 10 minutes.
  await db
    .prepare(
      `DELETE FROM structure_snapshots
       WHERE captured_at < (
         SELECT captured_at FROM structure_snapshots
         ORDER BY captured_at DESC LIMIT 1 OFFSET 8640
       )`,
    )
    .run();

  return "WRITTEN";
}

type SnapshotRow = {
  captured_at: string;
  total_market_cap: number | null;
  total2: number | null;
  total3: number | null;
  btc_dominance: number | null;
  eth_dominance: number | null;
  usdt_dominance: number | null;
  stablecoin_dominance: number | null;
};

const mapRow = (row: SnapshotRow): StructurePoint => ({
  capturedAt: row.captured_at,
  totalMarketCap: row.total_market_cap,
  total2: row.total2,
  total3: row.total3,
  btcDominance: row.btc_dominance,
  ethDominance: row.eth_dominance,
  usdtDominance: row.usdt_dominance,
  stablecoinDominance: row.stablecoin_dominance,
});

/**
 * Difference between the oldest and newest reading of a series, skipping gaps
 * where the value was unavailable.
 */
export function seriesChange(
  points: StructurePoint[],
  pick: (point: StructurePoint) => number | null,
): number | null {
  const values = points.map(pick).filter((value): value is number => value !== null);
  if (values.length < 2) return null;
  return values[values.length - 1] - values[0];
}

export async function loadStructureTrend(
  db: D1Database,
  hours = 24,
): Promise<StructureTrend> {
  await ensureStructureSchema(db);
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const result = await db
    .prepare(
      `SELECT * FROM structure_snapshots
       WHERE captured_at >= ?1
       ORDER BY captured_at ASC
       LIMIT 500`,
    )
    .bind(since)
    .all<SnapshotRow>();

  const points = result.results.map(mapRow);
  const first = points.find((point) => point.totalMarketCap !== null);
  const last = [...points].reverse().find((point) => point.totalMarketCap !== null);

  return {
    points,
    change: {
      btc: seriesChange(points, (point) => point.btcDominance),
      usdt: seriesChange(points, (point) => point.usdtDominance),
      totalPct:
        first?.totalMarketCap && last?.totalMarketCap
          ? ((last.totalMarketCap - first.totalMarketCap) / first.totalMarketCap) * 100
          : null,
    },
  };
}
