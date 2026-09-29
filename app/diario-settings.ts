import type { Market } from "@/lib/account-journal";

export type DiarioSettings = {
  market: Market;
  equity: number;
  riskPct: number;
  leverage: number;
  feePct: number;
  slipPct: number;
  targets: string;
  dailyLossPct: number;
  extraSymbols: string;
};

export const DEFAULT_SETTINGS: DiarioSettings = {
  market: "futures", equity: 1000, riskPct: 1, leverage: 10, feePct: 0.05, slipPct: 0.02, targets: "1, 2, 3", dailyLossPct: 3, extraSymbols: "",
};

export const SETTINGS_KEY = "alt-radar-diario-v1";

export function readSettings(): DiarioSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<DiarioSettings> | null;
    return { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export type Creds = { apiKey: string; apiSecret: string };
