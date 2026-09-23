/**
 * Spot buying strategy: a fixed plan plus a live checklist and ladders.
 *
 * Spot has no liquidation, so the risks are different from futures: buying
 * too early, buying all at once, holding a token whose supply keeps
 * unlocking, and never taking profit. The plan targets exactly those four.
 *
 * The evaluator never says "buy". It reports which conditions of the plan
 * are present, computes where the tranches would sit using levels the other
 * engines already detect, and states the invalidation before entry. The
 * decision stays with the person.
 */

export type SpotZone = { low: number; high: number; tests: number; confluence: string[] };

export type SpotInputs = {
  symbol: string;
  price: number;
  /** Demand zones at or below price (MTF engine). */
  demandZones: SpotZone[];
  /** Supply zones above price (MTF engine). */
  supplyZones: SpotZone[];
  fib: {
    inZone: boolean;
    side: "LONG" | "SHORT";
    levels: { ratio: number; price: number }[];
    legLow: number;
  } | null;
  /** Price above the daily 200 EMA. Null when history is too short. */
  aboveTrend: boolean | null;
  /** Locked supply value ÷ market cap. Null when unknown. */
  overhangRatio: number | null;
};

export type CheckState = "SÍ" | "NO" | "SIN DATO";
export type SpotCheck = { id: string; label: string; state: CheckState; detail: string };

export type Tranche = { price: number; usd: number; weight: number; source: string };

export type SpotPlan = {
  symbol: string;
  status: "CONDICIONES PRESENTES" | "PARCIAL" | "ESPERAR";
  checks: SpotCheck[];
  passed: number;
  known: number;
  entries: Tranche[];
  averageEntry: number | null;
  invalidation: { price: number; source: string } | null;
  riskPct: number | null;
  exits: Tranche[];
  note: string;
};

const LOCATION_IDS = new Set(["zona", "fib"]);

export function evaluateSpot(inputs: SpotInputs, budgetUsd: number): SpotPlan {
  const { price } = inputs;
  const checks: SpotCheck[] = [];

  // 1. Location: inside a demand zone, or within 1.5% above one.
  const nearDemand = inputs.demandZones
    .filter((z) => z.low <= price)
    .sort((a, b) => b.high - a.high)[0];
  const inDemand = nearDemand && price <= nearDemand.high * 1.015;
  checks.push({
    id: "zona",
    label: "Precio en zona de demanda",
    state: inputs.demandZones.length ? (inDemand ? "SÍ" : "NO") : "SIN DATO",
    detail: nearDemand
      ? `${nearDemand.low.toFixed(4)}–${nearDemand.high.toFixed(4)}${nearDemand.confluence.length > 1 ? ` · ${nearDemand.confluence.join("/")}` : ""}${nearDemand.tests ? ` · aguantó ${nearDemand.tests}` : ""}`
      : "sin zona de demanda debajo del precio",
  });

  // 2. Location: daily Fibonacci retracement band of an up leg.
  const fibOk = inputs.fib ? inputs.fib.side === "LONG" && inputs.fib.inZone : null;
  checks.push({
    id: "fib",
    label: "Retroceso Fibonacci 0.618–0.786",
    state: fibOk === null ? "SIN DATO" : fibOk ? "SÍ" : "NO",
    detail: !inputs.fib
      ? "sin tramo confirmado"
      : inputs.fib.side !== "LONG"
        ? "el último tramo es bajista"
        : inputs.fib.inZone
          ? "dentro de la banda del tramo alcista"
          : "fuera de la banda",
  });

  // 3. Higher-timeframe trend.
  checks.push({
    id: "tendencia",
    label: "Sobre la EMA 200 diaria",
    state: inputs.aboveTrend === null ? "SIN DATO" : inputs.aboveTrend ? "SÍ" : "NO",
    detail:
      inputs.aboveTrend === null
        ? "historia insuficiente"
        : inputs.aboveTrend
          ? "tendencia mayor a favor"
          : "contra la tendencia mayor: tramos más chicos o esperar",
  });

  // 4. Dilution ahead.
  const o = inputs.overhangRatio;
  checks.push({
    id: "dilucion",
    label: "Poca oferta pendiente (<0,35× cap)",
    state: o === null ? "SIN DATO" : o < 0.35 ? "SÍ" : "NO",
    detail: o === null ? "sin dato de supply" : `${o.toFixed(2)}× el cap actual por desbloquear`,
  });

  const known = checks.filter((c) => c.state !== "SIN DATO").length;
  const passed = checks.filter((c) => c.state === "SÍ").length;
  const hasLocation = checks.some((c) => LOCATION_IDS.has(c.id) && c.state === "SÍ");

  const status: SpotPlan["status"] =
    hasLocation && passed >= 3 ? "CONDICIONES PRESENTES" : passed >= 2 ? "PARCIAL" : "ESPERAR";

  // Entry ladder: distinct levels at or below price, largest tranche lowest.
  const candidates: { price: number; source: string }[] = [];
  if (nearDemand) candidates.push({ price: Math.min(price, nearDemand.high), source: "tope de demanda" });
  if (inputs.fib?.side === "LONG") {
    for (const l of inputs.fib.levels) {
      if (l.price <= price) candidates.push({ price: l.price, source: `Fib ${l.ratio}` });
    }
  }
  if (nearDemand) candidates.push({ price: nearDemand.low, source: "piso de demanda" });

  const levels: { price: number; source: string }[] = [];
  for (const c of candidates.sort((a, b) => b.price - a.price)) {
    if (!levels.some((l) => Math.abs(l.price - c.price) / c.price < 0.005)) levels.push(c);
    if (levels.length === 3) break;
  }
  const weights = levels.length === 1 ? [1] : levels.length === 2 ? [0.4, 0.6] : [0.3, 0.3, 0.4];
  const entries: Tranche[] =
    budgetUsd > 0
      ? levels.map((l, i) => ({ ...l, weight: weights[i], usd: budgetUsd * weights[i] }))
      : [];

  const units = entries.reduce((sum, t) => sum + t.usd / t.price, 0);
  const averageEntry = units > 0 ? entries.reduce((s, t) => s + t.usd, 0) / units : null;

  // Invalidation below the lowest structure used, decided before entry.
  const floors: { price: number; source: string }[] = [];
  if (nearDemand) floors.push({ price: nearDemand.low * 0.99, source: "cierre diario bajo la zona de demanda" });
  if (inputs.fib?.side === "LONG") floors.push({ price: inputs.fib.legLow * 0.995, source: "cierre diario bajo el origen del tramo" });
  const lowestEntry = entries.length ? Math.min(...entries.map((e) => e.price)) : null;
  const invalidation =
    floors.filter((f) => lowestEntry === null || f.price < lowestEntry).sort((a, b) => b.price - a.price)[0] ?? null;
  const riskPct =
    averageEntry && invalidation ? ((averageEntry - invalidation.price) / averageEntry) * 100 : null;

  // Exit ladder: partial sells into supply above.
  const supply = inputs.supplyZones.filter((z) => z.low > price).sort((a, b) => a.low - b.low).slice(0, 3);
  const exitWeights = supply.length === 1 ? [1] : supply.length === 2 ? [0.4, 0.6] : [0.25, 0.25, 0.5];
  const exits: Tranche[] = supply.map((z, i) => ({
    price: z.low,
    usd: 0,
    weight: exitWeights[i],
    source: `oferta ${z.low.toFixed(4)}–${z.high.toFixed(4)}`,
  }));

  const note =
    status === "CONDICIONES PRESENTES"
      ? "Las condiciones del plan están presentes. Eso no garantiza nada: define dónde comprar y dónde admitir el error, no qué va a pasar."
      : status === "PARCIAL"
        ? "Algunas condiciones están y otras no. El plan sugiere tramos más chicos o esperar a que se complete la ubicación."
        : "La mayoría de las condiciones no está. Según el plan, esto es para esperar, no para forzar una entrada.";

  return { symbol: inputs.symbol, status, checks, passed, known, entries, averageEntry, invalidation, riskPct, exits, note };
}

/** The written plan shown to clients, in order of how often each rule is broken. */
export const SPOT_RULES = [
  "Sin apalancamiento. En spot no te liquidan: el riesgo es comprar mal y esperar mucho, no perderlo todo en una mecha.",
  "Base DCA fija, pase lo que pase, y compras tácticas extra sólo en zonas.",
  "Nunca todo de una: tres tramos, el más grande en el nivel más bajo.",
  "La invalidación se decide antes de comprar. Si cierra el día debajo, se sale o se deja de sumar — no se promedia a ciegas.",
  "Evitar tokens con mucha oferta por desbloquear: aunque el proyecto sea bueno, esa oferta presiona el precio.",
  "Tomar ganancias en tramos en zonas de oferta. Nunca vender todo en un solo precio, ni no vender nunca.",
  "Cada alt es una fracción que tolerás perder. BTC y ETH son el núcleo; las alts, el satélite.",
] as const;
