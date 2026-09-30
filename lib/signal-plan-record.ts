import { fetchKlinesServer } from "./klines-server.ts";
import { attachPlan, ensureSignalPlanColumns, evaluateSignalPlans } from "./signal-plan-db.ts";
import { buildSignalPlan, isValidPlan, type PlanSide, type SignalPlan } from "./signal-plan.ts";

/**
 * What the crons call. Everything here is best-effort and never throws: the
 * signal itself is already in the ledger, and a plan that can't be attached (no
 * market data at that moment, say) just leaves that signal without one rather
 * than costing anybody a signal.
 */

/** A confluence signal has no plan of its own: build one from the last 15-minute candles. */
export async function recordConfluencePlan(db: D1Database, id: string, symbol: string, side: PlanSide, entry: number, now: number) {
  try {
    await ensureSignalPlanColumns(db);
    const { candles } = await fetchKlinesServer(symbol, "15m", { limit: 60, minCandles: 30, allowThin: true });
    const plan = buildSignalPlan(side, entry, candles, 900_000, now);
    if (plan) await attachPlan(db, id, plan);
    return plan;
  } catch (error) {
    console.error("[ALT_RADAR_PLAN_CONFLUENCE]", error);
    return null;
  }
}

/** A scalping signal already carries its own stop and targets: store those, unchanged. */
export async function recordScalpPlan(
  db: D1Database,
  id: string,
  side: PlanSide,
  entry: number,
  levels: { stop: number; target1: number; target2: number; target3: number },
) {
  try {
    const plan: SignalPlan = { stop: levels.stop, tp1: levels.target1, tp2: levels.target2, tp3: levels.target3, atr: null, version: "scalp-v1" };
    if (!isValidPlan(side, entry, plan)) return null;
    await ensureSignalPlanColumns(db);
    await attachPlan(db, id, plan);
    return plan;
  } catch (error) {
    console.error("[ALT_RADAR_PLAN_SCALP]", error);
    return null;
  }
}

export async function evaluatePlansSafely(db: D1Database, now: number) {
  try {
    return await evaluateSignalPlans(db, now);
  } catch (error) {
    console.error("[ALT_RADAR_PLAN_EVAL]", error);
    return null;
  }
}
