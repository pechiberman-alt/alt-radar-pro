export type ProfileId = "TRADING_PRO" | "HEDGE_VALUE_PRO" | "SPOT_TRADER";

export type Horizon = "CORTO" | "MEDIANO" | "LARGO";

export type TradingProfile = {
  id: ProfileId;
  name: string;
  tagline: string;
  focus: string;
  horizon: Horizon;
  market: "FUTUROS + SPOT" | "SPOT" | "SPOT + COBERTURA";
  /** Correlation / comparison window this profile reads the market on. */
  interval: "1h" | "4h" | "1d";
  /** Sensible default risk per trade, as a percentage of account equity. */
  defaultRiskPct: number;
  /** Highest leverage this profile should be sizing with. 1 means spot only. */
  maxLeverage: number;
  /** Reward-to-risk this profile plans trades around. */
  targetR: number;
  /** What the profile should be reading first on the dashboard. */
  priorities: string[];
  /** Execution and psychology rules, shown as a working checklist. */
  discipline: string[];
};

export const TRADING_PROFILES: Record<ProfileId, TradingProfile> = {
  TRADING_PRO: {
    id: "TRADING_PRO",
    name: "Trading Pro",
    tagline: "Ejecución, gestión de riesgo y psicología",
    focus:
      "Operativa activa sobre microestructura: order flow, footprint y CVD mandan sobre la narrativa.",
    horizon: "CORTO",
    market: "FUTUROS + SPOT",
    interval: "1h",
    defaultRiskPct: 1,
    maxLeverage: 20,
    targetR: 2,
    priorities: [
      "Order flow y footprint antes que el precio",
      "Radar de pumpeo en fase IGNICIÓN, nunca en CLÍMAX",
      "Invalidación definida antes de entrar",
    ],
    discipline: [
      "Una sola idea por vez: sin promediar contra la invalidación",
      "Riesgo fijo por operación, no ajustado por convicción",
      "Tras dos pérdidas seguidas, se cierra la sesión",
      "Si la tesis se rompe, se sale al precio de mercado sin negociar",
    ],
  },
  HEDGE_VALUE_PRO: {
    id: "HEDGE_VALUE_PRO",
    name: "Hedge Value Pro",
    tagline: "Value investing, rotación de capital y cobertura de portfolio",
    focus:
      "Asignación por régimen: rotación entre BTC, ETH y alts, con cobertura cuando la correlación se concentra.",
    horizon: "LARGO",
    market: "SPOT + COBERTURA",
    interval: "1d",
    defaultRiskPct: 3,
    maxLeverage: 2,
    targetR: 4,
    priorities: [
      "Matriz de correlación y acople medio del bloque",
      "Fase de rotación de capital y dominancia de BTC",
      "Oro como refugio cuando el bloque se concentra",
    ],
    discipline: [
      "Construir por tramos, nunca de una sola vez",
      "Si el acople medio supera 0.7, el portfolio es una sola apuesta: cubrir",
      "La tesis se revisa por fundamento, no por precio semanal",
      "Rebalanceo por calendario, no por impulso",
    ],
  },
  SPOT_TRADER: {
    id: "SPOT_TRADER",
    name: "Spot Trader",
    tagline: "Timing de entradas y gestión patrimonial",
    focus:
      "Acumulación en spot con timing: entrar en zonas de valor y evitar perseguir extensiones.",
    horizon: "MEDIANO",
    market: "SPOT",
    interval: "4h",
    defaultRiskPct: 2,
    maxLeverage: 1,
    targetR: 3,
    priorities: [
      "Comparador de rendimiento relativo entre candidatos",
      "Evitar activos marcados como EXTENDIDO o en CLÍMAX",
      "Liquidez real antes que score alto",
    ],
    discipline: [
      "Sin apalancamiento: el riesgo es el tamaño de la posición",
      "No perseguir una vela: esperar retroceso a la zona",
      "Definir de antemano en qué precio se reduce",
      "Patrimonio primero: ninguna posición decide el resultado del año",
    ],
  },
};

export const PROFILE_ORDER: ProfileId[] = [
  "TRADING_PRO",
  "HEDGE_VALUE_PRO",
  "SPOT_TRADER",
];

export type RiskInput = {
  equity: number;
  riskPct: number;
  entry: number;
  stop: number;
  leverage: number;
  targetR: number;
};

export type RiskResult = {
  riskAmount: number;
  stopDistance: number;
  stopDistancePct: number;
  units: number;
  notional: number;
  marginRequired: number;
  leverageUsed: number;
  /** Notional beyond what the equity covers; zero for unlevered sizing. */
  exposureOverEquity: number;
  target: number;
  rewardAmount: number;
  liquidationEstimate: number | null;
  direction: "LONG" | "SHORT";
  warnings: string[];
  valid: boolean;
};

/**
 * Position sizing from the stop, not from the leverage. Size is whatever makes
 * the distance to invalidation cost exactly the risk budget; leverage only
 * caps how much notional the account can actually carry.
 */
export function calculateRisk(input: RiskInput): RiskResult {
  const { equity, riskPct, entry, stop, leverage, targetR } = input;
  const warnings: string[] = [];
  const direction: "LONG" | "SHORT" = stop < entry ? "LONG" : "SHORT";
  const stopDistance = Math.abs(entry - stop);
  const riskAmount = equity * (riskPct / 100);

  const valid =
    Number.isFinite(equity) &&
    equity > 0 &&
    Number.isFinite(entry) &&
    entry > 0 &&
    Number.isFinite(stop) &&
    stop > 0 &&
    stopDistance > 0 &&
    riskPct > 0;

  if (!valid) {
    return {
      riskAmount: 0,
      stopDistance: 0,
      stopDistancePct: 0,
      units: 0,
      notional: 0,
      marginRequired: 0,
      leverageUsed: 0,
      exposureOverEquity: 0,
      target: 0,
      rewardAmount: 0,
      liquidationEstimate: null,
      direction,
      warnings: ["Completá capital, entrada y stop para calcular el tamaño."],
      valid: false,
    };
  }

  const stopDistancePct = (stopDistance / entry) * 100;
  const units = riskAmount / stopDistance;
  const rawNotional = units * entry;
  const maxNotional = equity * Math.max(1, leverage);
  const notional = Math.min(rawNotional, maxNotional);
  const cappedUnits = notional / entry;
  const leverageUsed = notional / equity;
  const marginRequired = leverage > 1 ? notional / leverage : notional;

  // Tolerance keeps floating-point residue from reporting a cap that did not
  // meaningfully happen (a sub-cent overshoot is not a capped position).
  if (rawNotional > maxNotional * 1.000001) {
    warnings.push(
      `El stop es tan ajustado que el tamaño teórico supera el apalancamiento ${leverage}×. La posición quedó limitada y arriesga menos del ${riskPct}% objetivo.`,
    );
  }
  if (stopDistancePct < 0.3) {
    warnings.push(
      "Invalidación a menos de 0.3%: el ruido de mercado y el deslizamiento pueden cerrarla sin que la tesis falle.",
    );
  }
  if (stopDistancePct > 25) {
    warnings.push(
      "Invalidación a más de 25%: revisá si el stop está en una estructura real o solo lejos.",
    );
  }
  if (riskPct > 5) {
    warnings.push(
      "Arriesgar más del 5% por operación: una racha normal de pérdidas compromete la cuenta.",
    );
  }
  if (leverageUsed > 10) {
    warnings.push(
      `Exposición ${leverageUsed.toFixed(1)}× sobre el capital: un movimiento adverso del ${(100 / leverageUsed).toFixed(1)}% liquida la posición.`,
    );
  }

  const target =
    direction === "LONG"
      ? entry + stopDistance * targetR
      : Math.max(0, entry - stopDistance * targetR);
  const rewardAmount = cappedUnits * stopDistance * targetR;

  // Approximate isolated-margin liquidation, ignoring maintenance margin and
  // fees, which is why it is labelled an estimate in the interface.
  const liquidationEstimate =
    leverage > 1
      ? direction === "LONG"
        ? entry * (1 - 1 / leverage)
        : entry * (1 + 1 / leverage)
      : null;

  // The single most dangerous configuration: leverage so high that the position
  // is liquidated before price ever reaches the invalidation. The stop then
  // protects nothing and the real loss is the whole margin, not the risk budget.
  if (liquidationEstimate !== null) {
    const liquidatesFirst =
      direction === "LONG"
        ? liquidationEstimate >= stop
        : liquidationEstimate <= stop;
    if (liquidatesFirst) {
      warnings.push(
        `LIQUIDACIÓN ANTES DEL STOP: con ${leverage}× la posición se liquida en ${liquidationEstimate.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")} y tu invalidación está en ${stop}. El stop no te protege y perderías el margen completo. Bajá el apalancamiento o alejá la entrada del stop.`,
      );
    }
  }

  return {
    riskAmount,
    stopDistance,
    stopDistancePct,
    units: cappedUnits,
    notional,
    marginRequired,
    leverageUsed,
    exposureOverEquity: Math.max(0, notional - equity),
    target,
    rewardAmount,
    liquidationEstimate,
    direction,
    warnings,
    valid: true,
  };
}
