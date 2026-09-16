/**
 * US spot Bitcoin ETF flows, read as a demand regime.
 *
 * WHAT THIS IS AND IS NOT
 *
 * Every creation is bitcoin taken off the market and locked in custody; every
 * redemption hands supply back. That makes these the cleanest daily census of
 * what allocators actually did — per issuer, so "what BlackRock did" is a real
 * number rather than a guess.
 *
 * It is NOT an early signal, and nothing here should be presented as one.
 * Issuers disclose creations and redemptions AFTER the US close, so the figure
 * lands a day or more after the trades it describes, and every desk sees it at
 * the same moment. Its value is regime: whether sustained institutional demand
 * is behind the tape or against it. `publishedLagDays` is carried through to
 * the UI so the delay is stated rather than implied.
 */

const SOURCE_URL = "https://www.tftc.io/bitcoin-etf-flows/data.json";

/** Ticker → who is actually behind it. */
export const ISSUERS: Record<string, string> = {
  IBIT: "BlackRock",
  FBTC: "Fidelity",
  BITB: "Bitwise",
  ARKB: "ARK / 21Shares",
  BTCO: "Invesco / Galaxy",
  EZBC: "Franklin Templeton",
  BRRR: "CoinShares Valkyrie",
  HODL: "VanEck",
  BTCW: "WisdomTree",
  MSBT: "Morgan Stanley",
  GBTC: "Grayscale",
  BTC: "Grayscale Mini",
};

export type FlowDay = {
  date: string;
  netFlowUsd: number;
  btcCloseUsd: number | null;
  perEtfUsd: Record<string, number> | null;
};

export type IssuerFlow = {
  ticker: string;
  issuer: string;
  lastDayUsd: number | null;
  sum5dUsd: number;
  sum20dUsd: number;
  /** Share of the 20-day gross (absolute) flow this issuer accounts for. */
  shareOfGross20d: number | null;
};

export type FlowRegime =
  | "ACUMULACIÓN SOSTENIDA"
  | "DEMANDA FIRME"
  | "GIRO A LA ENTRADA"
  | "GIRO A LA SALIDA"
  | "DISTRIBUCIÓN"
  | "NEUTRAL";

export type FlowDivergence = {
  kind: "DINERO SIN PRECIO" | "PRECIO SIN DINERO" | "ALINEADO";
  flow5dUsd: number;
  pricePct5d: number;
  reading: string;
};

export type InstitutionalFlows = {
  /** Date of the most recent reported session, not today. */
  asOf: string;
  /** Sessions between asOf and now — the delay, stated. */
  publishedLagDays: number;
  lastDayUsd: number;
  streakDays: number;
  streakDirection: "ENTRADA" | "SALIDA" | "PLANO";
  sum5dUsd: number;
  sum20dUsd: number;
  /** 5-day average over 20-day average: >1 means demand is accelerating. */
  acceleration: number | null;
  regime: FlowRegime;
  issuers: IssuerFlow[];
  divergence: FlowDivergence | null;
  /** Recent daily nets, oldest first, for the sparkline. */
  recent: { date: string; netFlowUsd: number }[];
  source: string;
  attribution: string;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Keeps only rows shaped like a reported session, so a malformed feed cannot
 *  silently become a zero-flow day that would read as "no demand". */
export function parseFlowDays(payload: unknown): FlowDay[] {
  const days = (payload as { days?: unknown })?.days;
  if (!Array.isArray(days)) return [];

  return days
    .filter(
      (day): day is Record<string, unknown> =>
        typeof day === "object" &&
        day !== null &&
        typeof (day as { date?: unknown }).date === "string" &&
        isFiniteNumber((day as { netFlowUsd?: unknown }).netFlowUsd),
    )
    .map((day) => {
      const perEtf = day.perEtfUsd;
      let breakdown: Record<string, number> | null = null;
      if (perEtf && typeof perEtf === "object") {
        breakdown = {};
        for (const [ticker, value] of Object.entries(perEtf)) {
          if (isFiniteNumber(value)) breakdown[ticker] = value;
        }
        if (Object.keys(breakdown).length === 0) breakdown = null;
      }
      return {
        date: day.date as string,
        netFlowUsd: day.netFlowUsd as number,
        btcCloseUsd: isFiniteNumber(day.btcCloseUsd) ? day.btcCloseUsd : null,
        perEtfUsd: breakdown,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Market holidays report as a flat 0 with no breakdown; counting those as
 *  "a day the streak held" would inflate every streak across a long weekend. */
const isReportedSession = (day: FlowDay) =>
  day.perEtfUsd !== null || day.netFlowUsd !== 0;

function streakFrom(days: FlowDay[]) {
  const sessions = days.filter(isReportedSession);
  const last = sessions.at(-1);
  if (!last || last.netFlowUsd === 0) {
    return { streakDays: 0, streakDirection: "PLANO" as const };
  }
  const positive = last.netFlowUsd > 0;
  let streakDays = 0;
  for (let index = sessions.length - 1; index >= 0; index -= 1) {
    const flow = sessions[index].netFlowUsd;
    if (positive ? flow > 0 : flow < 0) streakDays += 1;
    else break;
  }
  return {
    streakDays,
    streakDirection: positive ? ("ENTRADA" as const) : ("SALIDA" as const),
  };
}

const sum = (days: FlowDay[]) => days.reduce((total, day) => total + day.netFlowUsd, 0);

/**
 * Regime from the 20-day trend and the 5-day turn, in that order: the month
 * sets the backdrop, the week says whether it is still holding.
 */
function regimeFrom(sum5d: number, sum20d: number, streakDays: number, inflow: boolean): FlowRegime {
  // A fifth of a billion over a month is inside the noise of normal creations.
  const FLAT_20D = 200_000_000;
  const FLAT_5D = 100_000_000;

  const monthUp = sum20d > FLAT_20D;
  const monthDown = sum20d < -FLAT_20D;
  const weekUp = sum5d > FLAT_5D;
  const weekDown = sum5d < -FLAT_5D;

  if (monthUp && weekUp) {
    return streakDays >= 3 && inflow ? "ACUMULACIÓN SOSTENIDA" : "DEMANDA FIRME";
  }
  if (monthDown && weekDown) return "DISTRIBUCIÓN";
  if (monthDown && weekUp) return "GIRO A LA ENTRADA";
  if (monthUp && weekDown) return "GIRO A LA SALIDA";
  return "NEUTRAL";
}

/**
 * Where flows and price disagree.
 *
 * Money arriving while price falls means supply is being absorbed by someone
 * other than the funds; price rising with no money arriving means the move is
 * not being paid for through this pipe. Both are worth knowing; neither is a
 * trade on its own.
 */
function divergenceFrom(window: FlowDay[]): FlowDivergence | null {
  const priced = window.filter((day) => day.btcCloseUsd !== null);
  if (priced.length < 3) return null;

  const first = priced[0].btcCloseUsd!;
  const last = priced.at(-1)!.btcCloseUsd!;
  if (!(first > 0)) return null;

  const pricePct5d = (last / first - 1) * 100;
  const flow5dUsd = sum(window);

  // Below these the two are not really pointing anywhere.
  const FLOW_FLOOR = 150_000_000;
  const PRICE_FLOOR = 1.5;

  if (Math.abs(flow5dUsd) < FLOW_FLOOR || Math.abs(pricePct5d) < PRICE_FLOOR) {
    return {
      kind: "ALINEADO",
      flow5dUsd,
      pricePct5d,
      reading: "Ni el flujo ni el precio se movieron lo suficiente como para hablar de divergencia.",
    };
  }

  if (flow5dUsd > 0 && pricePct5d < 0) {
    return {
      kind: "DINERO SIN PRECIO",
      flow5dUsd,
      pricePct5d,
      reading:
        "Los fondos compraron y el precio igual cayó: alguien está vendiendo por encima de lo que absorbieron. La demanda institucional está, pero no alcanza para sostener el precio.",
    };
  }

  if (flow5dUsd < 0 && pricePct5d > 0) {
    return {
      kind: "PRECIO SIN DINERO",
      flow5dUsd,
      pricePct5d,
      reading:
        "El precio subió mientras salía dinero de los fondos: la suba no se está pagando por esta vía, así que depende de otro comprador que estos datos no muestran.",
    };
  }

  return {
    kind: "ALINEADO",
    flow5dUsd,
    pricePct5d,
    reading:
      flow5dUsd > 0
        ? "Flujo y precio apuntan en la misma dirección: la suba viene acompañada de compra institucional real."
        : "Flujo y precio apuntan en la misma dirección: la baja viene acompañada de salida institucional real.",
  };
}

function issuersFrom(last5: FlowDay[], last20: FlowDay[]): IssuerFlow[] {
  const lastDay = last20.at(-1) ?? null;
  const tickers = new Set<string>();
  for (const day of last20) {
    for (const ticker of Object.keys(day.perEtfUsd ?? {})) tickers.add(ticker);
  }

  const perTicker = (days: FlowDay[], ticker: string) =>
    days.reduce((total, day) => total + (day.perEtfUsd?.[ticker] ?? 0), 0);

  const gross20d = [...tickers].reduce(
    (total, ticker) => total + Math.abs(perTicker(last20, ticker)),
    0,
  );

  return [...tickers]
    .map((ticker) => {
      const sum20dUsd = perTicker(last20, ticker);
      return {
        ticker,
        issuer: ISSUERS[ticker] ?? ticker,
        lastDayUsd: lastDay?.perEtfUsd?.[ticker] ?? null,
        sum5dUsd: perTicker(last5, ticker),
        sum20dUsd,
        shareOfGross20d: gross20d > 0 ? (Math.abs(sum20dUsd) / gross20d) * 100 : null,
      };
    })
    .sort((a, b) => Math.abs(b.sum20dUsd) - Math.abs(a.sum20dUsd));
}

export function buildInstitutionalFlows(
  days: FlowDay[],
  now = new Date(),
): InstitutionalFlows | null {
  const sessions = days.filter(isReportedSession);
  if (sessions.length < 5) return null;

  const last = sessions.at(-1)!;
  const last5 = sessions.slice(-5);
  const last20 = sessions.slice(-20);
  const sum5dUsd = sum(last5);
  const sum20dUsd = sum(last20);
  const { streakDays, streakDirection } = streakFrom(sessions);

  const average5d = sum5dUsd / last5.length;
  const average20d = sum20dUsd / last20.length;
  const acceleration =
    Math.abs(average20d) > 0 ? average5d / Math.abs(average20d) : null;

  const lagMs = now.getTime() - Date.parse(`${last.date}T21:00:00Z`);
  const publishedLagDays = Math.max(0, Math.floor(lagMs / 86_400_000));

  return {
    asOf: last.date,
    publishedLagDays,
    lastDayUsd: last.netFlowUsd,
    streakDays,
    streakDirection,
    sum5dUsd,
    sum20dUsd,
    acceleration,
    regime: regimeFrom(sum5dUsd, sum20dUsd, streakDays, streakDirection === "ENTRADA"),
    issuers: issuersFrom(last5, last20),
    divergence: divergenceFrom(last5),
    recent: sessions.slice(-30).map((day) => ({
      date: day.date,
      netFlowUsd: day.netFlowUsd,
    })),
    source: "SoSoValue · Farside Investors, vía TFTC",
    attribution: "TFTC — tftc.io/bitcoin-etf-flows (CC BY 4.0)",
  };
}

export async function loadInstitutionalFlows(
  now = new Date(),
): Promise<InstitutionalFlows | null> {
  const response = await fetch(SOURCE_URL, {
    headers: { Accept: "application/json", "User-Agent": "ALT-RADAR-PRO/2.1" },
    signal: AbortSignal.timeout(9_000),
  });
  if (!response.ok) return null;
  return buildInstitutionalFlows(parseFlowDays(await response.json()), now);
}
