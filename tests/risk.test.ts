import assert from "node:assert/strict";
import test from "node:test";
import {
  PROFILE_ORDER,
  TRADING_PROFILES,
  calculateRisk,
  type RiskInput,
} from "../lib/trading-profiles.ts";

const base: RiskInput = {
  equity: 10_000,
  riskPct: 1,
  entry: 100,
  stop: 95,
  leverage: 1,
  targetR: 2,
};

test("sizes the position from the stop distance", () => {
  const result = calculateRisk(base);
  assert.equal(result.valid, true);
  assert.equal(result.direction, "LONG");
  assert.equal(result.riskAmount, 100);
  // $100 of risk over a $5 stop distance is 20 units.
  assert.equal(result.units, 20);
  assert.equal(result.notional, 2_000);
  assert.equal(result.stopDistancePct, 5);
});

/**
 * Hitting the stop must cost the risk budget and nothing more — unless the
 * account cannot carry the notional that budget implies, in which case the
 * position is capped and the shortfall has to be stated rather than hidden.
 * With spot sizing, risking 2% behind a 1% stop needs twice the account.
 */
test("losing the stop distance costs exactly the risk budget, or says why not", () => {
  for (const riskPct of [0.5, 1, 2, 3]) {
    for (const stop of [90, 95, 99]) {
      for (const leverage of [1, 5, 20]) {
        const result = calculateRisk({ ...base, riskPct, stop, leverage });
        const realisedLoss = result.units * result.stopDistance;
        const capped = result.warnings.some((warning) =>
          warning.includes("supera el apalancamiento"),
        );
        const label = `riesgo ${riskPct}% stop ${stop} lev ${leverage}x`;

        if (capped) {
          assert.ok(
            realisedLoss < result.riskAmount,
            `${label}: avisó tope pero el riesgo no bajó`,
          );
          assert.ok(
            result.notional <= base.equity * leverage + 1e-6,
            `${label}: el nocional excede el apalancamiento`,
          );
        } else {
          assert.ok(
            Math.abs(realisedLoss - result.riskAmount) < 1e-6,
            `${label}: perdería ${realisedLoss} en vez de ${result.riskAmount}`,
          );
        }
      }
    }
  }
});

test("a capped position is always reported, never silent", () => {
  // 2% risk behind a 1% stop needs 2x the account; spot cannot do it.
  const result = calculateRisk({ ...base, riskPct: 2, stop: 99, leverage: 1 });
  assert.ok(
    result.warnings.some((warning) => warning.includes("supera el apalancamiento")),
    "un tope silencioso haría creer que se arriesga más de lo real",
  );
  assert.equal(result.notional, base.equity);
});

test("detects a short from the stop sitting above entry", () => {
  const result = calculateRisk({ ...base, stop: 105 });
  assert.equal(result.direction, "SHORT");
  assert.equal(result.units, 20);
  assert.equal(result.target, 90);
});

test("target and reward follow the R multiple", () => {
  const long = calculateRisk({ ...base, targetR: 3 });
  assert.equal(long.target, 115);
  assert.ok(Math.abs(long.rewardAmount - 300) < 1e-9);

  const short = calculateRisk({ ...base, stop: 105, targetR: 3 });
  assert.equal(short.target, 85);
});

test("a short target never goes negative", () => {
  const result = calculateRisk({
    equity: 10_000,
    riskPct: 1,
    entry: 10,
    stop: 15,
    leverage: 1,
    targetR: 5,
  });
  assert.ok(result.target >= 0, "un precio objetivo no puede ser negativo");
});

test("rejects incomplete or contradictory input", () => {
  const cases: Partial<RiskInput>[] = [
    { equity: 0 },
    { entry: 0 },
    { stop: 0 },
    { stop: 100 }, // identical to entry: no invalidation distance
    { riskPct: 0 },
    { equity: Number.NaN },
  ];
  for (const patch of cases) {
    const result = calculateRisk({ ...base, ...patch });
    assert.equal(result.valid, false, `debería rechazar ${JSON.stringify(patch)}`);
    assert.equal(result.units, 0);
    assert.ok(result.warnings.length > 0);
  }
});

test("caps the position at what the leverage allows", () => {
  // A 0.05% stop would otherwise demand 20x the account in notional.
  const result = calculateRisk({ ...base, stop: 99.95, leverage: 5 });
  assert.ok(result.notional <= base.equity * 5 + 1e-6);
  assert.equal(result.leverageUsed, 5);
  assert.ok(
    result.warnings.some((warning) => warning.includes("supera el apalancamiento")),
    "debe avisar que el tamaño quedó limitado",
  );
  // And the realised risk is then below target, which the warning states.
  assert.ok(result.units * result.stopDistance < result.riskAmount);
});

test("does not report a cap from floating point residue", () => {
  const result = calculateRisk({ ...base, stop: 99.9, leverage: 10 });
  assert.ok(
    !result.warnings.some((warning) => warning.includes("supera el apalancamiento")),
    "un excedente de milésimas no es una posición limitada",
  );
});

/**
 * The setup that quietly destroys accounts: leverage high enough that the
 * position is liquidated before price ever reaches the invalidation.
 */
test("warns when liquidation lands at or before the stop", () => {
  const long = calculateRisk({ ...base, stop: 95, leverage: 20 });
  assert.ok(long.liquidationEstimate !== null);
  assert.ok(
    long.warnings.some((warning) => warning.startsWith("LIQUIDACIÓN ANTES")),
    "20x con stop a 5% debe avisar que liquida antes del stop",
  );

  const short = calculateRisk({ ...base, stop: 105, leverage: 20 });
  assert.ok(
    short.warnings.some((warning) => warning.startsWith("LIQUIDACIÓN ANTES")),
    "el mismo control debe aplicar en short",
  );
});

test("stays quiet when the stop sits well inside the liquidation", () => {
  const result = calculateRisk({ ...base, stop: 99, leverage: 3 });
  assert.ok(
    !result.warnings.some((warning) => warning.startsWith("LIQUIDACIÓN ANTES")),
    "3x con stop a 1% no liquida antes del stop",
  );
});

test("spot sizing reports no liquidation", () => {
  const result = calculateRisk({ ...base, leverage: 1 });
  assert.equal(result.liquidationEstimate, null);
  assert.equal(result.exposureOverEquity, 0);
});

test("flags an invalidation too tight to survive noise", () => {
  const result = calculateRisk({ ...base, stop: 99.9, leverage: 1 });
  assert.ok(result.warnings.some((warning) => warning.includes("0.3%")));
});

test("flags oversized risk per trade", () => {
  const result = calculateRisk({ ...base, riskPct: 8 });
  assert.ok(result.warnings.some((warning) => warning.includes("5%")));
});

test("every profile is internally consistent", () => {
  for (const id of PROFILE_ORDER) {
    const profile = TRADING_PROFILES[id];
    assert.equal(profile.id, id, "la clave y el id deben coincidir");
    assert.ok(profile.maxLeverage >= 1, `${id}: apalancamiento mínimo 1x`);
    assert.ok(profile.defaultRiskPct > 0 && profile.defaultRiskPct <= 5, `${id}: riesgo fuera de rango`);
    assert.ok(profile.targetR >= 1, `${id}: objetivo R inválido`);
    assert.ok(profile.discipline.length >= 3, `${id}: checklist demasiado corta`);
    assert.ok(profile.priorities.length >= 2, `${id}: faltan prioridades`);
  }
});

test("the spot profile cannot size with leverage", () => {
  assert.equal(TRADING_PROFILES.SPOT_TRADER.maxLeverage, 1);
  const result = calculateRisk({
    ...base,
    leverage: TRADING_PROFILES.SPOT_TRADER.maxLeverage,
  });
  assert.equal(result.liquidationEstimate, null);
});

test("profile horizons are distinct", () => {
  const intervals = PROFILE_ORDER.map((id) => TRADING_PROFILES[id].interval);
  assert.equal(new Set(intervals).size, intervals.length, "los perfiles deben leer horizontes distintos");
});
