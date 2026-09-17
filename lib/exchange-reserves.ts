/**
 * Exchange reserves, read as accumulation or distribution.
 *
 * WHY THIS IS THE EARLIEST THING HERE
 *
 * Coins leaving an exchange are coins someone moved into their own custody:
 * you cannot sell what is not on an order book. Coins arriving are coins
 * positioned to be sold. Unlike ETF flows — which are published after the
 * session that produced them — this is visible on-chain as it happens, so it
 * is the one institutional read in the terminal with any lead time at all.
 *
 * THE PRICE PROBLEM, AND HOW THIS HANDLES IT
 *
 * Reserves are reported in USD, so a reserve that "fell 5%" may just be a
 * market that fell 5% with every coin still sitting where it was. Reading that
 * as an outflow would invent a story out of a price move.
 *
 * DefiLlama sells the pre-computed flow figure on its paid tier. Rather than
 * approximate it badly, this derives it: across venues the price effect is
 * common, so the MEDIAN change over the tracked exchanges is taken as the
 * market's move, and each venue's deviation from that median is what actually
 * came in or out. A venue that fell 12% on a day the median fell 5% lost coins;
 * one that tracked the median moved nothing.
 *
 * It is a derived figure, labelled as such everywhere it surfaces — never
 * presented as an exact on-chain flow.
 */

const PROTOCOLS_URL = "https://api.llama.fi/protocols";

/** Enough venues for a stable median, few enough to stay readable. */
const TRACKED = 14;

export type Venue = {
  name: string;
  slug: string;
  reserveUsd: number;
  change1dPct: number | null;
  change7dPct: number | null;
  /** Change net of the market-wide move — the part that is real movement. */
  netFlow1dPct: number | null;
  netFlow7dPct: number | null;
  /** That deviation applied to the reserve, so it reads in dollars. */
  netFlow7dUsd: number | null;
};

export type ExchangeFlows = {
  capturedAt: string;
  /** The median move, i.e. what the market did to every reserve alike. */
  marketMove1dPct: number | null;
  marketMove7dPct: number | null;
  totalReserveUsd: number;
  state: "ACUMULACIÓN" | "DISTRIBUCIÓN" | "SIN SESGO CLARO";
  reading: string;
  venues: Venue[];
  source: string;
  method: string;
};

type RawProtocol = {
  name?: unknown;
  slug?: unknown;
  category?: unknown;
  tvl?: unknown;
  change_1d?: unknown;
  change_7d?: unknown;
};

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function parseVenues(payload: unknown): RawProtocol[] {
  if (!Array.isArray(payload)) return [];
  return payload.filter((entry): entry is RawProtocol => {
    if (typeof entry !== "object" || entry === null) return false;
    const item = entry as RawProtocol;
    return (
      item.category === "CEX" &&
      typeof item.name === "string" &&
      typeof item.slug === "string" &&
      (num(item.tvl) ?? 0) > 0
    );
  });
}

export function buildExchangeFlows(
  payload: unknown,
  now = new Date(),
): ExchangeFlows | null {
  const raw = parseVenues(payload)
    .sort((a, b) => (num(b.tvl) ?? 0) - (num(a.tvl) ?? 0))
    .slice(0, TRACKED);

  // Below this a median is not describing a market, it is describing noise.
  if (raw.length < 5) return null;

  const changes1d = raw.map((item) => num(item.change_1d)).filter((v): v is number => v !== null);
  const changes7d = raw.map((item) => num(item.change_7d)).filter((v): v is number => v !== null);
  const marketMove1dPct = median(changes1d);
  const marketMove7dPct = median(changes7d);

  const venues: Venue[] = raw.map((item) => {
    const reserveUsd = num(item.tvl) ?? 0;
    const change1dPct = num(item.change_1d);
    const change7dPct = num(item.change_7d);
    const netFlow1dPct =
      change1dPct !== null && marketMove1dPct !== null ? change1dPct - marketMove1dPct : null;
    const netFlow7dPct =
      change7dPct !== null && marketMove7dPct !== null ? change7dPct - marketMove7dPct : null;
    return {
      name: item.name as string,
      slug: item.slug as string,
      reserveUsd,
      change1dPct,
      change7dPct,
      netFlow1dPct,
      netFlow7dPct,
      netFlow7dUsd: netFlow7dPct !== null ? (reserveUsd * netFlow7dPct) / 100 : null,
    };
  });

  const totalReserveUsd = venues.reduce((total, venue) => total + venue.reserveUsd, 0);
  const weighted = venues.reduce(
    (total, venue) => total + (venue.netFlow7dUsd ?? 0),
    0,
  );

  // A tenth of a percent of tracked reserves is inside normal venue shuffling.
  const floor = totalReserveUsd * 0.001;
  const state =
    weighted < -floor ? "ACUMULACIÓN" : weighted > floor ? "DISTRIBUCIÓN" : "SIN SESGO CLARO";

  const reading =
    state === "ACUMULACIÓN"
      ? "Salen más monedas de las que entran: se están moviendo a custodia propia. Menos oferta disponible para vender en el libro."
      : state === "DISTRIBUCIÓN"
        ? "Entran más monedas de las que salen: se están posicionando para vender. Más oferta disponible en el libro."
        : "El movimiento entre exchanges no se despega de lo que hizo el precio. No hay sesgo de custodia que leer.";

  return {
    capturedAt: now.toISOString(),
    marketMove1dPct,
    marketMove7dPct,
    totalReserveUsd,
    state,
    reading,
    venues: venues.sort(
      (a, b) => Math.abs(b.netFlow7dUsd ?? 0) - Math.abs(a.netFlow7dUsd ?? 0),
    ),
    source: "DefiLlama · billeteras de exchange rastreadas (API pública)",
    method:
      "Flujo derivado: la mediana del cambio entre exchanges se toma como el movimiento del precio, y la desviación de cada uno sobre esa mediana es el movimiento real de monedas. No es un flujo on-chain medido moneda por moneda.",
  };
}

export async function loadExchangeFlows(now = new Date()): Promise<ExchangeFlows | null> {
  const response = await fetch(PROTOCOLS_URL, {
    headers: { Accept: "application/json", "User-Agent": "ALT-RADAR-PRO/2.1" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return null;
  return buildExchangeFlows(await response.json(), now);
}
