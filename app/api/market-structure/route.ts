import { NextRequest, NextResponse } from "next/server";
import { env } from "cloudflare:workers";
import { cached, offerCached } from "@/lib/upstream-cache";
import { recordStructureSnapshot } from "@/lib/structure-archive";
import {
  parseCoinGeckoGlobal,
  parseCoinLoreGlobal,
  type MarketStructure,
} from "@/lib/market-structure";

export const dynamic = "force-dynamic";

/**
 * Served from the Worker rather than the browser: CoinGecko's free tier is
 * rate limited per IP, and global capitalisation moves slowly enough that one
 * shared reading per minute is more current than the data itself.
 */
const CACHE_TTL_MS = 60_000;
/** Global capitalisation stays informative for a while; 15 minutes stale beats blank. */
const STALE_WINDOW_MS = 15 * 60_000;

async function loadCoinGecko(): Promise<MarketStructure | null> {
  try {
    const response = await fetch("https://api.coingecko.com/api/v3/global", {
      headers: { Accept: "application/json", "User-Agent": "ALT-RADAR-PRO/2.1" },
      signal: AbortSignal.timeout(7_000),
    });
    if (!response.ok) return null;
    return parseCoinGeckoGlobal(await response.json());
  } catch {
    return null;
  }
}

async function loadCoinLore(): Promise<MarketStructure | null> {
  try {
    const response = await fetch("https://api.coinlore.net/api/global/", {
      headers: { Accept: "application/json", "User-Agent": "ALT-RADAR-PRO/2.1" },
      signal: AbortSignal.timeout(7_000),
    });
    if (!response.ok) return null;
    return parseCoinLoreGlobal(await response.json());
  } catch {
    return null;
  }
}

/**
 * Records a structure reading a browser fetched successfully.
 *
 * The scheduled job runs on Cloudflare, and CoinGecko — the only free source
 * that breaks out stablecoin dominance — blocks those addresses. So the cron
 * always fell through to CoinLore and every archived snapshot had USDT.D null:
 * the series could never answer the question it was built for. Visitors are not
 * blocked, so one of them can supply it.
 *
 * This writes to persistent storage, and the archive it feeds is the one thing
 * here a competitor cannot simply fetch, so a caller must not be able to decide
 * what it says. Range checks alone would let anyone POST plausible-but-invented
 * dominance. Every reading is therefore corroborated against CoinLore, which
 * the Worker CAN reach: if the caller's total capitalisation and BTC dominance
 * match it, the reading is genuine and its stablecoin split — the part no free
 * server-reachable source publishes — is archived with it.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "CUERPO NO VÁLIDO" }, { status: 400 });
  }

  const structure = parseCoinGeckoGlobal(body);
  if (!structure || !isPlausible(structure)) {
    return NextResponse.json({ error: "LECTURA NO VÁLIDA" }, { status: 400 });
  }

  if (!(await corroborated(structure))) {
    return NextResponse.json({ error: "LECTURA NO CORROBORADA" }, { status: 409 });
  }

  // Serve it to other clients straight away, archive it if D1 is available.
  offerCached("market-structure", structure, CACHE_TTL_MS);

  let archived: "WRITTEN" | "SKIPPED" | "SIN BASE" = "SIN BASE";
  if (env.DB) {
    try {
      archived = await recordStructureSnapshot(env.DB, structure);
    } catch {
      archived = "SKIPPED";
    }
  }

  return NextResponse.json(
    { archived, usdt: structure.dominance.usdt },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Total capitalisation may differ this much between the two sources. */
const TOTAL_TOLERANCE = 0.05;
/** BTC dominance may differ this many percentage points between them. */
const DOMINANCE_TOLERANCE_PP = 2;

/**
 * Checks a caller's reading against CoinLore, the free source the Worker can
 * reach. An invented payload has to match a live independent source on two
 * fast-moving numbers to get in, which a caller cannot arrange.
 *
 * If CoinLore itself is unreachable there is nothing to check against, so the
 * reading is refused rather than trusted: a gap in the series is recoverable,
 * a poisoned one is not.
 */
async function corroborated(structure: MarketStructure): Promise<boolean> {
  const { value: reference } = await cached<MarketStructure>(
    "market-structure:corroboration",
    CACHE_TTL_MS,
    loadCoinLore,
    STALE_WINDOW_MS,
  );
  if (!reference?.totalMarketCap || !structure.totalMarketCap) return false;

  const totalDrift =
    Math.abs(structure.totalMarketCap / reference.totalMarketCap - 1);
  if (totalDrift > TOTAL_TOLERANCE) return false;

  if (reference.dominance.btc !== null && structure.dominance.btc !== null) {
    const btcDrift = Math.abs(structure.dominance.btc - reference.dominance.btc);
    if (btcDrift > DOMINANCE_TOLERANCE_PP) return false;
  }

  return true;
}

/**
 * Rejects readings that are internally inconsistent or outside any plausible
 * range, so a malformed or invented payload cannot enter the archive.
 */
function isPlausible(structure: MarketStructure): boolean {
  const { totalMarketCap, dominance } = structure;
  if (totalMarketCap === null || totalMarketCap < 1e10 || totalMarketCap > 1e14) return false;

  const shares = [dominance.btc, dominance.eth, dominance.usdt, dominance.usdc];
  for (const share of shares) {
    if (share !== null && (share < 0 || share > 100)) return false;
  }
  // BTC and ETH cannot together exceed the whole market.
  if (dominance.btc !== null && dominance.eth !== null && dominance.btc + dominance.eth > 100) {
    return false;
  }
  // A reading with no stablecoin split adds nothing the cron cannot already get.
  return dominance.usdt !== null;
}

export async function GET() {
  const { value, state, ageMs } = await cached<MarketStructure>(
    "market-structure",
    CACHE_TTL_MS,
    // CoinGecko first: it is the only free source that breaks out stablecoin
    // dominance. CoinLore covers total and BTC/ETH dominance if that fails.
    async () => (await loadCoinGecko()) ?? (await loadCoinLore()),
    STALE_WINDOW_MS,
  );

  if (!value) {
    return NextResponse.json(
      { error: "SIN DATOS" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(value, {
    headers: {
      "Cache-Control": "no-store",
      "X-Cache": state,
      "X-Cache-Age": String(Math.round(ageMs / 1000)),
    },
  });
}
