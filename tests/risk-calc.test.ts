import assert from "node:assert/strict";
import test from "node:test";
import { dailyLimit, riskPlan, streakImpact, type RiskInput } from "../lib/risk-calc.ts";

const base: RiskInput = { market: "futures", equity: 1000, riskPct: 1, entry: 100, stop: 99, leverage: 10, feePct: 0.05, slipPct: 0.02, targetsR: [1, 1.5, 3] };
const plan = (o: Partial<RiskInput> = {}) => {
  const p = riskPlan({ ...base, ...o });
  assert.ok(p.ok, JSON.stringify(p));
  return p as Extract<ReturnType<typeof riskPlan>, { ok: true }>;
};
const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test("size is the risk budget over the loss per unit at the stop, fees and slippage included", () => {
  const p = plan();
  const perUnit = 1 + 0.0007 * 199;
  close(p.qty, 10 / perUnit);
  close(p.qty, 8.7773, 1e-3);
  close(p.riskUsd, 10);
  close(p.riskPct, 1);
  close(p.notional, p.qty * 100);
  close(p.margin, p.notional / 10);
  assert.equal(p.side, "LONG");
  assert.equal(p.limitedBy, "riesgo");
  close(p.stopDistancePct, 1);
});

test("liquidation is estimated per side and the stop's place on the way there is measured", () => {
  close(plan().liqPrice as number, 90.5);
  close(plan().stopToLiq as number, 1 / 9.5);
  const short = plan({ stop: 101 });
  assert.equal(short.side, "SHORT");
  close(short.liqPrice as number, 109.5);
});

test("targets pay R times the distance, less fees and slippage both ways", () => {
  const p = plan();
  const t = p.targets.find((x) => x.r === 1.5)!;
  close(t.price, 101.5);
  close(t.netUsd, p.qty * 1.5 - p.qty * 0.0007 * (100 + 101.5));
  close(t.roiPct as number, (t.netUsd / p.margin) * 100);
  const short = plan({ stop: 101 }).targets.find((x) => x.r === 3)!;
  close(short.price, 97);
});

test("break-even sits past the entry by the round-trip costs", () => {
  close(plan().breakeven, (100 * 1.0007) / (1 - 0.0007));
  assert.ok(plan({ stop: 101 }).breakeven < 100);
});

test("when margin can't hold the size the risk asks for, size is capped and the real risk is shown", () => {
  const p = plan({ leverage: 1, stop: 99.9 });
  close(p.qty, 10);
  assert.equal(p.limitedBy, "margen");
  assert.ok(p.riskPct < 1);
  assert.ok(p.warnings.some((w) => w.includes("limitado")));
  // Plenty of free margin: the risk sets the size. Little free margin: the margin does.
  close(plan({ available: 200 }).qty, 10 / (1 + 0.0007 * 199));
  const tight = plan({ available: 50 });
  close(tight.qty, 5);
  assert.equal(tight.limitedBy, "margen");
});

test("spot has no leverage, no liquidation, and is capped by the balance", () => {
  const p = plan({ market: "spot", equity: 100, riskPct: 5, stop: 90 });
  assert.equal(p.liqPrice, null);
  assert.equal(p.stopToLiq, null);
  close(p.margin, p.notional);
  assert.ok(p.notional <= 100 / 1.0005 + 1e-9);
});

test("invalid inputs are refused with a reason", () => {
  for (const [o, re] of [
    [{ stop: 100 }, /iguales/], [{ equity: 0 }, /saldo/], [{ riskPct: 0 }, /riesgo/], [{ riskPct: 150 }, /riesgo/],
    [{ entry: 0 }, /mayores a cero/], [{ leverage: 0 }, /apalancamiento/], [{ leverage: 200 }, /apalancamiento/],
    [{ equity: Number.NaN }, /números/], [{ feePct: -1 }, /negativos/], [{ market: "spot" as const, stop: 101 }, /spot/],
  ] as [Partial<RiskInput>, RegExp][]) {
    const p = riskPlan({ ...base, ...o });
    assert.equal(p.ok, false, JSON.stringify(o));
    assert.match((p as { error: string }).error, re, JSON.stringify(o));
  }
});

test("warnings: liquidation before the stop, high risk, high leverage, stop too tight, below the minimum size", () => {
  assert.ok(plan({ leverage: 50, stop: 97 }).warnings.some((w) => w.includes("ANTES")));
  assert.ok(plan({ riskPct: 5 }).warnings.some((w) => w.includes("3%")));
  assert.ok(plan({ leverage: 40 }).warnings.some((w) => w.includes("Apalancamiento")));
  assert.ok(plan({ stop: 99.99 }).warnings.some((w) => w.includes("stop es tan corto")));
  assert.ok(plan({ equity: 10, riskPct: 0.5 }).warnings.some((w) => w.includes("mínimo")));
  assert.equal(plan().warnings.length, 0);
});

test("a run of losses: what it costs and what it takes to recover", () => {
  const [one] = streakImpact([1], [10]);
  close(one.rows[0].drawdownPct, (1 - 0.99 ** 10) * 100);
  close(one.rows[0].recoveryPct, (1 / 0.99 ** 10 - 1) * 100);
  const [half, fifty] = streakImpact([0.5, 50], [1]);
  close(half.rows[0].drawdownPct, 0.5);
  close(fifty.rows[0].recoveryPct, 100);
});

test("daily limit: only losses count, and it trips at the limit", () => {
  assert.deepEqual(dailyLimit(20, 1000, 3), { limitUsd: 30, used: 0, remaining: 30, breached: false });
  const d = dailyLimit(-12, 1000, 3);
  assert.equal(d.used, 12);
  assert.equal(d.remaining, 18);
  assert.equal(dailyLimit(-30, 1000, 3).breached, true);
});
