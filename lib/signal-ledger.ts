import type { ScoreReason } from "./radar";

import type { KindStats } from "./signal-plan.ts";

export type SignalOutcome = {
  price: number | null;
  returnPct: number | null;
  capturedAt: string | null;
};

/** Stop, targets and how the signal turned out; absent on signals recorded before plans existed. */
export type SignalPlanView = {
  stop: number;
  tp1: number;
  tp2: number;
  tp3: number;
  outcome: "SL" | "TP1" | "TP2" | "TP3" | "EXPIRED" | null;
  slAt: string | null;
  tp1At: string | null;
  tp2At: string | null;
  tp3At: string | null;
};

export type SignalRecord = {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  signal: "SETUP" | "TRIGGER";
  score: number;
  technicalScore: number;
  altseasonScore: number | null;
  geopoliticalRisk: number | null;
  entryPrice: number;
  source: string;
  timeframe: string;
  detectedAt: string;
  status: "MONITORING" | "RESOLVED";
  reasons: ScoreReason[];
  penalties: ScoreReason[];
  outcomes: {
    m15: SignalOutcome;
    h1: SignalOutcome;
    h4: SignalOutcome;
    h24: SignalOutcome;
  };
  maxMove: number;
  minMove: number;
  plan: SignalPlanView | null;
  updatedAt: string;
};

export type LedgerStats = {
  total: number;
  evaluated4h: number;
  wins4h: number;
  winRate4h: number | null;
  grossProfit4h: number;
  grossLoss4h: number;
  profitFactor4h: number | null;
  falseSignalRate4h: number | null;
  averageReturn4h: number | null;
  bestReturn4h: number | null;
  worstReturn4h: number | null;
};

export type LedgerPayload = {
  records: SignalRecord[];
  stats: LedgerStats;
  /** How each kind of signal has turned out against its plan (last 90 days). */
  planStats?: KindStats[];
  automation: {
    lastRun: string | null;
    lastSummary: { inserted?: number; evaluated?: number; universe?: number } | null;
    schedule: string;
  };
};
