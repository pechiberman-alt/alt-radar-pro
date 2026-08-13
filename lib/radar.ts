export type MarketAsset = {
  symbol: string;
  price: number;
  change1h: number | null;
  change4h: number | null;
  change24h: number;
  volume: number;
  quoteVolume: number;
  high: number | null;
  low: number | null;
  change5m?: number | null;
  change15m?: number | null;
  bidPrice?: number | null;
  askPrice?: number | null;
  spreadPct?: number | null;
};

export type NewsEvent = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  region: string;
  category: string;
  tier: 1 | 2 | 3;
  risk: number;
  btcImpact: number;
  altImpact: number;
  goldImpact: number;
  oilImpact: number;
  status: "BREAKING" | "CONFIRMED" | "MONITORING" | "UNCONFIRMED";
  sourceCount?: number;
  sources?: string[];
};

export type RadarPayload = {
  timestamp: string;
  sources: string[];
  market: MarketAsset[];
  dominance: { btc: number | null; change24h: number | null };
  news: NewsEvent[];
  errors: string[];
};

export type ScoreConfig = {
  watch: number;
  setup: number;
  trigger: number;
  minimumQuoteVolume: number;
};

export type ScoreReason = { label: string; points: number };

export type ScoredAsset = MarketAsset & {
  score: number;
  technicalScore: number;
  signal: "WATCH" | "SETUP" | "TRIGGER" | "NO SIGNAL";
  side: "LONG" | "SHORT" | "NEUTRAL";
  relVolume: number;
  momentum: number;
  liquidity: "HIGH" | "MEDIUM" | "LOW";
  extended: boolean;
  confirmationCount: number;
  dataQuality: "FULL" | "PARTIAL";
  reasons: ScoreReason[];
  penalties: ScoreReason[];
};

export const DEFAULT_SCORE_CONFIG: ScoreConfig = {
  watch: 60,
  setup: 70,
  trigger: 80,
  minimumQuoteVolume: 10_000_000,
};

const clamp = (n: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, n));

export function globalRisk(events: NewsEvent[]) {
  if (!events.length) {
    return {
      score: null,
      level: "DATOS NO DISPONIBLES",
      killSwitch: false,
    } as const;
  }

  const sorted = [...events].sort((a, b) => b.risk - a.risk);
  const score = Math.round(
    clamp(
      sorted[0].risk * 0.72 +
        (sorted[1]?.risk ?? 0) * 0.18 +
        Math.min(events.length, 10),
    ),
  );

  return {
    score,
    level:
      score > 80
        ? "EXTREMO"
        : score > 60
          ? "ALTO"
          : score > 40
            ? "ELEVADO"
            : score > 20
              ? "NORMAL"
              : "BAJO",
    killSwitch: score > 80,
  };
}

export function altseasonScore(
  market: MarketAsset[],
  btcDominance: number | null,
  riskScore: number | null,
) {
  const btc = market.find((asset) => asset.symbol === "BTCUSDT");
  const eth = market.find((asset) => asset.symbol === "ETHUSDT");
  const alts = market.filter(
    (asset) =>
      !["BTCUSDT", "ETHUSDT"].includes(asset.symbol) &&
      asset.quoteVolume >= 5_000_000,
  );

  if (!btc || !eth || !alts.length) {
    return {
      raw: null,
      adjustment: 0,
      final: null,
      state: "DATOS NO DISPONIBLES",
      factors: [] as ScoreReason[],
    };
  }

  const breadth =
    alts.filter((asset) => asset.change24h > btc.change24h).length / alts.length;
  const positive = alts.filter((asset) => asset.change24h > 0).length / alts.length;
  const ethOutperformance = eth.change24h - btc.change24h;
  const multiTimeframeCoverage = alts.filter(
    (asset) => asset.change1h !== null && asset.change4h !== null,
  );
  const multiTimeframeBreadth = multiTimeframeCoverage.length
    ? multiTimeframeCoverage.filter(
        (asset) => (asset.change1h ?? 0) > 0 && (asset.change4h ?? 0) > 0,
      ).length / multiTimeframeCoverage.length
    : 0;

  const factors: ScoreReason[] = [
    {
      label: "Contexto BTC.D",
      points: btcDominance !== null && btcDominance < 55 ? 13 : 5,
    },
    {
      label: "ETH supera a BTC",
      points: ethOutperformance > 0 ? Math.min(15, 8 + ethOutperformance) : 2,
    },
    { label: "Amplitud altcoins", points: Math.round(breadth * 22) },
    { label: "Amplitud positiva", points: Math.round(positive * 15) },
    {
      label: "Participación de volumen",
      points: alts.filter((asset) => asset.quoteVolume > 50_000_000).length >= 8 ? 15 : 7,
    },
    {
      label: "Estabilidad de BTC",
      points: Math.abs(btc.change24h) < 4 ? 10 : 3,
    },
    {
      label: "Momentum multi-timeframe",
      points: multiTimeframeCoverage.length && multiTimeframeBreadth > 0.55 ? 10 : 4,
    },
  ];

  const raw = Math.round(clamp(factors.reduce((sum, factor) => sum + factor.points, 0)));
  const adjustment =
    riskScore === null
      ? 0
      : riskScore > 80
        ? -22
        : riskScore > 60
          ? -12
          : riskScore > 40
            ? -5
            : 0;
  const final = clamp(raw + adjustment);
  const state =
    final >= 76
      ? "ALTSEASON CONFIRMADA"
      : final >= 61
        ? "ROTACIÓN FUERTE"
        : final >= 41
          ? "PRE-ALTSEASON"
          : final >= 21
            ? "NEUTRAL"
            : "TEMPORADA BITCOIN";

  return { raw, adjustment, final, state, factors };
}

type DirectionScore = {
  side: "LONG" | "SHORT";
  reasons: ScoreReason[];
  technicalScore: number;
  confirmationCount: number;
  extended: boolean;
  structureConfirmed: boolean;
};

function directionalScore(
  asset: MarketAsset,
  btc: MarketAsset | undefined,
  eth: MarketAsset | undefined,
  side: "LONG" | "SHORT",
): DirectionScore {
  const multiplier = side === "LONG" ? 1 : -1;
  const hasRange =
    asset.high !== null &&
    asset.low !== null &&
    asset.high > asset.low;
  const range = hasRange
    ? Math.max(asset.high! - asset.low!, asset.price * 0.001)
    : null;
  const position = hasRange && range ? (asset.price - asset.low!) / range : 0.5;
  const tfAligned =
    asset.change1h !== null &&
    asset.change4h !== null &&
    asset.change1h * multiplier > 0 &&
    asset.change4h * multiplier > 0;
  const fullyAligned = tfAligned && asset.change24h * multiplier > 0;
  const beatsBtc = btc
    ? (asset.change24h - btc.change24h) * multiplier > 0
    : false;
  const beatsEth = eth
    ? (asset.change24h - eth.change24h) * multiplier > 0
    : false;
  const structureConfirmed = hasRange
    ? side === "LONG"
      ? position > 0.78 && position < 0.97
      : position < 0.22 && position > 0.03
    : false;
  const extended =
    side === "LONG"
      ? asset.change24h > 14 || (asset.change1h ?? 0) > 6 || position >= 0.97
      : asset.change24h < -14 || (asset.change1h ?? 0) < -6 || position <= 0.03;

  const liquidityPoints =
    asset.quoteVolume > 500_000_000
      ? 15
      : asset.quoteVolume > 100_000_000
        ? 10
        : 4;
  const participationPoints =
    asset.quoteVolume > 250_000_000
      ? 14
      : asset.quoteVolume > 100_000_000
        ? 9
        : 3;

  const reasons: ScoreReason[] = [
    { label: "Liquidez", points: liquidityPoints },
    { label: "Momentum alineado", points: tfAligned ? 16 : 5 },
    {
      label: side === "LONG" ? "Fortaleza relativa vs BTC" : "Debilidad relativa vs BTC",
      points: beatsBtc ? 14 : 2,
    },
    {
      label: side === "LONG" ? "Fortaleza relativa vs ETH" : "Debilidad relativa vs ETH",
      points: beatsEth ? 10 : 2,
    },
    {
      label: side === "LONG" ? "Proximidad a ruptura" : "Proximidad a breakdown",
      points: hasRange ? (structureConfirmed ? 15 : 6) : 0,
    },
    { label: "Participación de volumen", points: participationPoints },
    { label: "Tendencia multi-timeframe", points: fullyAligned ? 12 : 4 },
  ];

  return {
    side,
    reasons,
    technicalScore: reasons.reduce((sum, reason) => sum + reason.points, 0),
    confirmationCount: reasons.filter((reason) => reason.points >= 10).length,
    extended,
    structureConfirmed,
  };
}

export function scoreAssets(
  market: MarketAsset[],
  riskScore: number | null,
  killSwitch: boolean,
  config: ScoreConfig = DEFAULT_SCORE_CONFIG,
): ScoredAsset[] {
  const btc = market.find((asset) => asset.symbol === "BTCUSDT");
  const eth = market.find((asset) => asset.symbol === "ETHUSDT");

  return market
    .filter((asset) => !["BTCUSDT", "ETHUSDT"].includes(asset.symbol))
    .map((asset) => {
      const long = directionalScore(asset, btc, eth, "LONG");
      const short = directionalScore(asset, btc, eth, "SHORT");
      const direction = short.technicalScore > long.technicalScore ? short : long;
      const dataQuality =
        asset.change1h !== null && asset.change4h !== null && riskScore !== null
          ? "FULL"
          : "PARTIAL";
      const penalties: ScoreReason[] = [
        ...(direction.extended
          ? [{ label: "Movimiento ya extendido", points: -18 }]
          : []),
        ...(riskScore !== null && riskScore > 60
          ? [
              {
                label: "Riesgo geopolítico",
                points: riskScore > 80 ? -22 : -10,
              },
            ]
          : []),
        ...(riskScore === null
          ? [{ label: "Contexto macro no disponible", points: -8 }]
          : []),
        ...(asset.quoteVolume < config.minimumQuoteVolume
          ? [{ label: "Liquidez insuficiente", points: -14 }]
          : []),
        ...(asset.change1h === null || asset.change4h === null
          ? [{ label: "Confirmación multi-timeframe incompleta", points: -10 }]
          : []),
      ];
      const score = Math.round(
        clamp(
          direction.technicalScore +
            penalties.reduce((sum, penalty) => sum + penalty.points, 0),
        ),
      );
      const hasTriggerData =
        dataQuality === "FULL" &&
        asset.quoteVolume >= Math.max(config.minimumQuoteVolume, 100_000_000) &&
        direction.structureConfirmed &&
        direction.confirmationCount >= 5;
      const signal =
        killSwitch || direction.extended
          ? "NO SIGNAL"
          : score >= config.trigger && hasTriggerData
            ? "TRIGGER"
            : score >= config.setup
              ? "SETUP"
              : score >= config.watch
                ? "WATCH"
                : "NO SIGNAL";

      return {
        ...asset,
        score,
        technicalScore: direction.technicalScore,
        signal,
        side: signal === "NO SIGNAL" ? "NEUTRAL" : direction.side,
        relVolume: Math.min(5, asset.quoteVolume / 250_000_000),
        momentum:
          ((asset.change1h ?? 0) * 0.35 +
            (asset.change4h ?? 0) * 0.35 +
            asset.change24h * 0.3) *
          (direction.side === "LONG" ? 1 : -1),
        liquidity:
          asset.quoteVolume > 500_000_000
            ? "HIGH"
            : asset.quoteVolume > 100_000_000
              ? "MEDIUM"
              : "LOW",
        extended: direction.extended,
        confirmationCount: direction.confirmationCount,
        dataQuality,
        reasons: direction.reasons,
        penalties,
      } satisfies ScoredAsset;
    })
    .sort((a, b) => b.score - a.score);
}

export function rotation(market: MarketAsset[]) {
  const buckets = [
    { label: "BTC", symbols: ["BTCUSDT"] },
    { label: "ETH", symbols: ["ETHUSDT"] },
    {
      label: "Large",
      symbols: ["BNBUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT"],
    },
    {
      label: "Mid",
      symbols: ["AVAXUSDT", "LINKUSDT", "SUIUSDT", "DOTUSDT", "NEARUSDT"],
    },
    {
      label: "Small",
      symbols: ["ARBUSDT", "OPUSDT", "APTUSDT", "INJUSDT", "SEIUSDT"],
    },
  ];
  const raw = buckets.map((bucket) => ({
    ...bucket,
    value: Math.max(
      0.1,
      bucket.symbols
        .map(
          (symbol) =>
            market.find((asset) => asset.symbol === symbol)?.change24h ?? 0,
        )
        .reduce((left, right) => left + right, 0) /
        bucket.symbols.length +
        5,
    ),
  }));
  const total = raw.reduce((sum, bucket) => sum + bucket.value, 0);
  const values = raw.map((bucket) => ({
    label: bucket.label,
    value: Math.round((bucket.value / total) * 100),
  }));
  const leader = values.reduce((left, right) =>
    right.value > left.value ? right : left,
  );
  const phase =
    leader.label === "BTC"
      ? 1
      : leader.label === "ETH"
        ? 2
        : leader.label === "Large"
          ? 3
          : leader.label === "Mid"
            ? 4
            : 5;

  return { values, phase, leader: leader.label };
}
