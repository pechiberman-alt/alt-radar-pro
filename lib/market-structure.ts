/**
 * Global market structure: total capitalisation and dominance.
 *
 * TOTAL2 and TOTAL3 are not separate feeds anyone publishes — they are
 * definitions. TOTAL2 is the market excluding BTC, TOTAL3 excludes BTC and ETH.
 * Given a total capitalisation and the dominance percentages, both follow
 * exactly, so they are derived here rather than reported as unavailable.
 *
 * USDT dominance is tracked because it reads the opposite way to the rest:
 * capital sitting in stablecoins is buying power on the sidelines, so a rising
 * USDT.D usually accompanies weakness in alts, and a falling one accompanies
 * rotation back into risk.
 */

export type MarketStructure = {
  totalMarketCap: number | null;
  total2: number | null;
  total3: number | null;
  totalVolume24h: number | null;
  marketCapChange24h: number | null;
  dominance: {
    btc: number | null;
    eth: number | null;
    usdt: number | null;
    usdc: number | null;
    stablecoins: number | null;
    altcoins: number | null;
  };
  source: string;
  timestamp: string;
};

export type StablecoinRegime = {
  label: string;
  reading: string;
  tone: "risk-on" | "risk-off" | "neutral" | "unknown";
};

type CoinGeckoGlobal = {
  data?: {
    total_market_cap?: Record<string, number>;
    total_volume?: Record<string, number>;
    market_cap_percentage?: Record<string, number>;
    market_cap_change_percentage_24h_usd?: number;
  };
};

type CoinLoreGlobal = {
  total_mcap?: number;
  total_volume?: number;
  btc_d?: string;
  eth_d?: string;
  mcap_change?: string;
};

const finite = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * TOTAL2 / TOTAL3 from the total and the dominance shares. Returns null rather
 * than a guess when either input is missing.
 */
export function deriveTotals(
  totalMarketCap: number | null,
  btcDominance: number | null,
  ethDominance: number | null,
) {
  const total2 =
    totalMarketCap !== null && btcDominance !== null
      ? totalMarketCap * (1 - btcDominance / 100)
      : null;
  const total3 =
    totalMarketCap !== null && btcDominance !== null && ethDominance !== null
      ? totalMarketCap * (1 - (btcDominance + ethDominance) / 100)
      : null;
  return { total2, total3 };
}

/** Accepts unknown because it parses a third-party response. */
export function parseCoinGeckoGlobal(payload: unknown): MarketStructure | null {
  const data = (payload as CoinGeckoGlobal | null)?.data;
  if (!data || typeof data !== "object") return null;
  const totalMarketCap = finite(data.total_market_cap?.usd);
  if (totalMarketCap === null || totalMarketCap <= 0) return null;
  const shares = data.market_cap_percentage ?? {};
  const btc = finite(shares.btc);
  const eth = finite(shares.eth);
  const usdt = finite(shares.usdt);
  const usdc = finite(shares.usdc);
  const stablecoins =
    usdt !== null || usdc !== null ? (usdt ?? 0) + (usdc ?? 0) : null;
  const { total2, total3 } = deriveTotals(totalMarketCap, btc, eth);

  return {
    totalMarketCap,
    total2,
    total3,
    totalVolume24h: finite(data.total_volume?.usd),
    marketCapChange24h: finite(data.market_cap_change_percentage_24h_usd),
    dominance: {
      btc,
      eth,
      usdt,
      usdc,
      stablecoins,
      altcoins: btc !== null && eth !== null ? Math.max(0, 100 - btc - eth) : null,
    },
    source: "CoinGecko Global",
    timestamp: new Date().toISOString(),
  };
}

/** Accepts unknown because it parses a third-party response. */
export function parseCoinLoreGlobal(rows: unknown): MarketStructure | null {
  const row = Array.isArray(rows) ? (rows[0] as CoinLoreGlobal | undefined) : null;
  if (!row || typeof row !== "object") return null;
  const totalMarketCap = finite(row.total_mcap);
  if (totalMarketCap === null || totalMarketCap <= 0) return null;
  const btc = finite(row.btc_d);
  const eth = finite(row.eth_d);
  const { total2, total3 } = deriveTotals(totalMarketCap, btc, eth);

  return {
    totalMarketCap,
    total2,
    total3,
    totalVolume24h: finite(row.total_volume),
    marketCapChange24h: finite(row.mcap_change),
    dominance: {
      btc,
      eth,
      // CoinLore's global endpoint does not break out stablecoins; the app
      // shows these as unavailable rather than filling them in.
      usdt: null,
      usdc: null,
      stablecoins: null,
      altcoins: btc !== null && eth !== null ? Math.max(0, 100 - btc - eth) : null,
    },
    source: "CoinLore Global · respaldo",
    timestamp: new Date().toISOString(),
  };
}

/**
 * Reads stablecoin dominance as sidelined capital. Thresholds come from where
 * USDT.D has historically sat: roughly 4% in risk-on phases and above 8% when
 * capital has retreated from crypto.
 */
export function stablecoinRegime(
  usdtDominance: number | null,
  changePct: number | null = null,
): StablecoinRegime {
  if (usdtDominance === null) {
    return {
      label: "SIN DATOS",
      reading: "Sin dominancia de stablecoins en el ciclo actual.",
      tone: "unknown",
    };
  }

  const direction =
    changePct === null || Math.abs(changePct) < 0.05
      ? "estable"
      : changePct > 0
        ? "subiendo"
        : "bajando";

  if (usdtDominance >= 8) {
    return {
      label: "CAPITAL REFUGIADO",
      reading: `USDT.D ${direction} en zona alta: hay mucho capital fuera de riesgo. Suele acompañar debilidad en alts, y es munición para un rebote cuando vuelve.`,
      tone: "risk-off",
    };
  }
  if (usdtDominance >= 6) {
    return {
      label: "DEFENSIVO",
      reading: `USDT.D ${direction} en zona media-alta: parte del capital está esperando afuera. Sin rotación clara hacia riesgo todavía.`,
      tone: direction === "subiendo" ? "risk-off" : "neutral",
    };
  }
  if (usdtDominance >= 4.5) {
    return {
      label: "NEUTRAL",
      reading: `USDT.D ${direction} en rango habitual: no marca ni refugio ni euforia.`,
      tone: "neutral",
    };
  }
  return {
    label: "CAPITAL DESPLEGADO",
    reading: `USDT.D ${direction} en zona baja: el capital está dentro del mercado. Queda poca munición al margen, lo que suele coincidir con fases avanzadas.`,
    tone: "risk-on",
  };
}
