/**
 * Institutional ETF flows across assets: which coin the funds are actually
 * putting money into, side by side.
 *
 * WHY THIS ANSWERS THE QUESTION PROPERLY
 *
 * "What are the big funds buying" used to have no honest answer beyond
 * bitcoin, because spot ETFs only existed for BTC and ETH. That changed:
 * there are now US spot ETFs for SOL and XRP as well, so the comparison
 * between assets is a real measurement rather than a guess — and the
 * comparison is the interesting part. A day where BTC takes in money while
 * ETH, SOL and XRP all bleed says something that any single number does not.
 *
 * WHAT IT STILL IS NOT
 *
 * Fund flows are published after the session that produced them. They tell
 * you what allocators did, never what they are about to do, and every desk
 * sees them at the same moment. This is regime, not timing — the panel keeps
 * saying so.
 *
 * SOURCE AND ITS FRAGILITY
 *
 * Farside publishes a page per asset. It has no documented API, so this reads
 * the table it renders. That is inherently more brittle than a JSON contract:
 * a markup change upstream breaks it. Everything below is therefore written
 * to fail closed — a table it cannot understand yields null, never a guess.
 */

export type AssetFlow = {
  asset: "BTC" | "ETH" | "SOL" | "XRP";
  /** Most recent reported session, ISO date as published. */
  asOf: string;
  lastDayUsd: number;
  sum7dUsd: number;
  sum30dUsd: number;
  /** Consecutive sessions in the same direction, ending at the last one. */
  streakDays: number;
  streakDirection: "ENTRADA" | "SALIDA" | "PLANO";
  /** Daily nets, oldest first, for the sparkline. */
  recent: { date: string; netUsd: number }[];
};

export type FlowComparison = {
  assets: AssetFlow[];
  /** Asset taking the most money over the last week, when one is positive. */
  leader: AssetFlow | null;
  /** Asset bleeding the most over the last week, when one is negative. */
  laggard: AssetFlow | null;
  reading: string;
  source: string;
  caveat: string;
};

/** Farside prints millions, with parentheses for negatives and a dash for
 *  no data. "1,234.5" is 1234.5 million; "(56.7)" is −56.7 million. */
export function parseFlowCell(raw: string): number | null {
  const text = raw.replace(/<[^>]*>/g, "").trim();
  if (!text || text === "-" || text === "–" || text === "—") return null;
  const negative = /^\(.*\)$/.test(text);
  const digits = text.replace(/[(),$\s]/g, "");
  if (!digits || !/^-?\d*\.?\d+$/.test(digits)) return null;
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  return (negative ? -value : value) * 1_000_000;
}

/** Rows look like `<tr><td>05 Sep 2026</td><td>…</td>…<td>Total</td></tr>`.
 *  Only the date and the trailing total are needed here; per-issuer columns
 *  vary by asset and change when funds launch or close. */
export function parseFarsideTable(html: string): { date: string; netUsd: number }[] {
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi);
  if (!rows) return [];

  const out: { date: string; netUsd: number }[] = [];
  for (const row of rows) {
    const cells = row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi);
    if (!cells || cells.length < 3) continue;

    const first = cells[0].replace(/<[^>]*>/g, "").trim();
    // A data row starts with a date like "05 Sep 2026"; headers and the
    // summary rows at the bottom ("Total", "Average") do not.
    const parsed = Date.parse(first);
    if (!/^\d{1,2}\s+\w{3}\s+\d{4}$/.test(first) || Number.isNaN(parsed)) continue;

    const total = parseFlowCell(cells[cells.length - 1]);
    if (total === null) continue;
    out.push({ date: new Date(parsed).toISOString().slice(0, 10), netUsd: total });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const sum = (rows: { netUsd: number }[]) => rows.reduce((total, row) => total + row.netUsd, 0);

function streakOf(rows: { netUsd: number }[]) {
  const last = rows.at(-1);
  if (!last || last.netUsd === 0) {
    return { streakDays: 0, streakDirection: "PLANO" as const };
  }
  const positive = last.netUsd > 0;
  let streakDays = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (positive ? rows[i].netUsd > 0 : rows[i].netUsd < 0) streakDays += 1;
    else break;
  }
  return {
    streakDays,
    streakDirection: positive ? ("ENTRADA" as const) : ("SALIDA" as const),
  };
}

export function buildAssetFlow(
  asset: AssetFlow["asset"],
  rows: { date: string; netUsd: number }[],
): AssetFlow | null {
  if (rows.length < 2) return null;
  const last = rows.at(-1)!;
  const { streakDays, streakDirection } = streakOf(rows);
  return {
    asset,
    asOf: last.date,
    lastDayUsd: last.netUsd,
    sum7dUsd: sum(rows.slice(-7)),
    sum30dUsd: sum(rows.slice(-30)),
    streakDays,
    streakDirection,
    recent: rows.slice(-30),
  };
}

export function buildComparison(flows: (AssetFlow | null)[]): FlowComparison | null {
  const assets = flows.filter((flow): flow is AssetFlow => flow !== null);
  if (!assets.length) return null;

  const ranked = [...assets].sort((a, b) => b.sum7dUsd - a.sum7dUsd);
  const leader = ranked[0].sum7dUsd > 0 ? ranked[0] : null;
  const last = ranked[ranked.length - 1];
  const laggard = last.sum7dUsd < 0 ? last : null;

  let reading: string;
  if (leader && laggard) {
    reading = `En la última semana el dinero institucional entró a ${leader.asset} y salió de ${laggard.asset}. Cuando los flujos se separan así, el capital está eligiendo, no moviéndose en bloque.`;
  } else if (leader) {
    reading = `${leader.asset} lidera las entradas de la semana. No hay salidas netas relevantes en los demás: la demanda es amplia, no una rotación.`;
  } else if (laggard) {
    reading = `Ningún activo tuvo entradas netas esta semana y ${laggard.asset} fue el que más perdió. Es retirada general, no rotación entre activos.`;
  } else {
    reading = "Los flujos están cerca de cero en todos los activos. Esta semana el dato no aporta dirección.";
  }

  return {
    assets: ranked,
    leader,
    laggard,
    reading,
    source: "Farside Investors · flujos diarios de ETF al contado en EE.UU.",
    caveat:
      "Los emisores reportan después del cierre, así que esto describe lo que los fondos ya hicieron. Es régimen de demanda, no una señal de entrada.",
  };
}
