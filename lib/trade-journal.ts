/**
 * A manual trade journal, and the win-rate math it feeds.
 *
 * WHY THIS IS SEPARATE FROM THE EXISTING SIGNAL LEDGER
 *
 * signal-ledger.ts already tracks win rate — but only for signals THIS
 * SYSTEM detected and graded automatically. This is different: entries here
 * are typed in by a person about trades they actually took, on their own
 * judgment, whether or not the radar ever flagged them. The two ledgers
 * measure different things and neither should be quietly merged into the
 * other's numbers — a system's own hit rate and a person's own trading
 * record answer different questions.
 *
 * NO MONEY MOVES HERE
 *
 * Every field is something the person typed after the fact. Nothing in this
 * file calls an exchange, places an order, or touches an API key. It is
 * bookkeeping on what already happened, which is the whole point: this is
 * the informational tier, not execution.
 *
 * THE STATS FOLLOW THE SAME HONESTY RULES AS EVERYTHING ELSE IN THIS APP
 *
 * A win rate over three trades is arithmetic, not a track record — the
 * sample size travels with every rate this module computes, the same
 * convention used for zones, order blocks, and alerts elsewhere in the
 * codebase.
 */

export type TradeSide = "LONG" | "SHORT";

export type TradeEntry = {
  id: string;
  symbol: string;
  side: TradeSide;
  entryPrice: number;
  /** Null while the trade is still open. */
  exitPrice: number | null;
  /** Position size in quote currency (USD), for weighting P&L by size. */
  sizeUsd: number;
  openedAt: string;
  closedAt: string | null;
  note: string;
};

export type TradeStats = {
  closedTrades: number;
  openTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number | null;
  /** Gross profit ÷ gross loss. Null when there is no loss to divide by. */
  profitFactor: number | null;
  totalPnlUsd: number;
  averageWinUsd: number | null;
  averageLossUsd: number | null;
  /** Consecutive wins or losses ending at the most recent closed trade. */
  currentStreak: { count: number; direction: "GANADORA" | "PERDEDORA" | "NINGUNA" };
  confidence: "SIN MUESTRA" | "MUESTRA MÍNIMA" | "MUESTRA RAZONABLE";
};

/** P&L in USD for one closed trade, given its recorded size. A short profits
 *  when price falls, so the sign of the price move is flipped for it. */
export function tradePnlUsd(entry: TradeEntry): number | null {
  if (entry.exitPrice === null || !(entry.entryPrice > 0)) return null;
  const movePct = (entry.exitPrice - entry.entryPrice) / entry.entryPrice;
  const signedPct = entry.side === "LONG" ? movePct : -movePct;
  return signedPct * entry.sizeUsd;
}

export function computeTradeStats(entries: TradeEntry[]): TradeStats {
  const closed = entries.filter((entry) => entry.exitPrice !== null);
  const open = entries.length - closed.length;

  const withPnl = closed
    .map((entry) => ({ entry, pnl: tradePnlUsd(entry) }))
    .filter((row): row is { entry: TradeEntry; pnl: number } => row.pnl !== null);

  const wins = withPnl.filter((row) => row.pnl > 0);
  const losses = withPnl.filter((row) => row.pnl < 0);
  const breakeven = withPnl.length - wins.length - losses.length;

  const grossProfit = wins.reduce((sum, row) => sum + row.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, row) => sum + row.pnl, 0));
  const totalPnlUsd = withPnl.reduce((sum, row) => sum + row.pnl, 0);

  // Chronological order decides the streak — entries may arrive in any order.
  const chronological = [...withPnl].sort(
    (a, b) => new Date(a.entry.closedAt ?? 0).getTime() - new Date(b.entry.closedAt ?? 0).getTime(),
  );
  let currentStreak: TradeStats["currentStreak"] = { count: 0, direction: "NINGUNA" };
  if (chronological.length) {
    const lastPnl = chronological[chronological.length - 1].pnl;
    if (lastPnl !== 0) {
      const winning = lastPnl > 0;
      let count = 0;
      for (let i = chronological.length - 1; i >= 0; i -= 1) {
        const pnl = chronological[i].pnl;
        if (winning ? pnl > 0 : pnl < 0) count += 1;
        else break;
      }
      currentStreak = { count, direction: winning ? "GANADORA" : "PERDEDORA" };
    }
  }

  const resolved = wins.length + losses.length; // breakeven trades don't resolve a win/loss rate
  const confidence: TradeStats["confidence"] =
    resolved === 0 ? "SIN MUESTRA" : resolved < 8 ? "MUESTRA MÍNIMA" : "MUESTRA RAZONABLE";

  return {
    closedTrades: closed.length,
    openTrades: open,
    wins: wins.length,
    losses: losses.length,
    breakeven,
    winRate: resolved > 0 ? wins.length / resolved : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    totalPnlUsd,
    averageWinUsd: wins.length > 0 ? grossProfit / wins.length : null,
    averageLossUsd: losses.length > 0 ? grossLoss / losses.length : null,
    currentStreak,
    confidence,
  };
}

export const TRADE_JOURNAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS trade_journal (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  entry_price REAL NOT NULL,
  exit_price REAL,
  size_usd REAL NOT NULL,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS trade_journal_user_idx ON trade_journal(user_id);
`;
