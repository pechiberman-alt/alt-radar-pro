import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInstitutionalFlows,
  parseFlowDays,
  type FlowDay,
} from "../lib/institutional-flows.ts";

const day = (
  date: string,
  netFlowUsd: number,
  patch: Partial<FlowDay> = {},
): FlowDay => ({
  date,
  netFlowUsd,
  btcCloseUsd: 100_000,
  perEtfUsd: { IBIT: netFlowUsd },
  ...patch,
});

/** A month of sessions, newest last, at a fixed daily flow. */
function series(count: number, flow: number, startDay = 1): FlowDay[] {
  return Array.from({ length: count }, (_, index) =>
    day(`2026-03-${String(startDay + index).padStart(2, "0")}`, flow),
  );
}

test("parseFlowDays drops rows that are not reported sessions", () => {
  const parsed = parseFlowDays({
    days: [
      { date: "2026-03-02", netFlowUsd: 100, btcCloseUsd: 90_000, perEtfUsd: { IBIT: 100 } },
      { date: "2026-03-01", netFlowUsd: "not a number" },
      { netFlowUsd: 50 },
      null,
    ],
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].date, "2026-03-02");
});

test("parseFlowDays returns days oldest first regardless of source order", () => {
  const parsed = parseFlowDays({
    days: [
      { date: "2026-03-05", netFlowUsd: 2 },
      { date: "2026-03-01", netFlowUsd: 1 },
    ],
  });
  assert.deepEqual(
    parsed.map((entry) => entry.date),
    ["2026-03-01", "2026-03-05"],
  );
});

test("a holiday does not extend a streak across it", () => {
  // Zero flow with no per-fund breakdown is a closed market, not a flat day.
  const days = [
    ...series(3, 200_000_000),
    day("2026-03-04", 0, { perEtfUsd: null }),
    ...series(2, 200_000_000, 5),
  ];
  const flows = buildInstitutionalFlows(days, new Date("2026-03-07T00:00:00Z"));
  assert.ok(flows);
  assert.equal(flows.streakDirection, "ENTRADA");
  assert.equal(flows.streakDays, 5, "las 5 sesiones reportadas cuentan; el feriado no interrumpe ni suma");
});

test("sustained inflows read as accumulation, sustained outflows as distribution", () => {
  const inflow = buildInstitutionalFlows(series(20, 300_000_000), new Date("2026-03-21T00:00:00Z"));
  assert.equal(inflow?.regime, "ACUMULACIÓN SOSTENIDA");

  const outflow = buildInstitutionalFlows(series(20, -300_000_000), new Date("2026-03-21T00:00:00Z"));
  assert.equal(outflow?.regime, "DISTRIBUCIÓN");
});

test("a fresh outflow week against a positive month reads as a turn, not as distribution", () => {
  const days = [...series(15, 400_000_000), ...series(5, -300_000_000, 16)];
  const flows = buildInstitutionalFlows(days, new Date("2026-03-21T00:00:00Z"));
  assert.equal(flows?.regime, "GIRO A LA SALIDA");
});

test("flows arriving while price falls is reported as a divergence, not as demand", () => {
  const days = [
    ...series(15, 100_000_000),
    day("2026-03-16", 400_000_000, { btcCloseUsd: 100_000 }),
    day("2026-03-17", 400_000_000, { btcCloseUsd: 98_000 }),
    day("2026-03-18", 400_000_000, { btcCloseUsd: 96_000 }),
    day("2026-03-19", 400_000_000, { btcCloseUsd: 94_000 }),
    day("2026-03-20", 400_000_000, { btcCloseUsd: 92_000 }),
  ];
  const flows = buildInstitutionalFlows(days, new Date("2026-03-21T00:00:00Z"));
  assert.equal(flows?.divergence?.kind, "DINERO SIN PRECIO");
  assert.ok((flows?.divergence?.pricePct5d ?? 0) < 0);
});

test("issuers are named and ranked by how much of the month they moved", () => {
  const days = series(20, 0).map((entry, index) => ({
    ...entry,
    netFlowUsd: 150_000_000,
    perEtfUsd: { IBIT: 100_000_000, FBTC: 50_000_000, GBTC: index === 19 ? -10_000_000 : 0 },
  }));
  const flows = buildInstitutionalFlows(days, new Date("2026-03-21T00:00:00Z"));
  assert.ok(flows);
  assert.equal(flows.issuers[0].ticker, "IBIT");
  assert.equal(flows.issuers[0].issuer, "BlackRock", "el ticker se traduce al emisor real");
  assert.ok(flows.issuers[0].sum20dUsd > flows.issuers[1].sum20dUsd);
  assert.ok((flows.issuers[0].shareOfGross20d ?? 0) > 50);
});

test("the reporting delay is carried, never presented as live", () => {
  const flows = buildInstitutionalFlows(
    series(20, 200_000_000),
    new Date("2026-03-23T12:00:00Z"),
  );
  assert.equal(flows?.asOf, "2026-03-20");
  assert.ok(
    (flows?.publishedLagDays ?? 0) >= 2,
    "el desfase real debe viajar hasta la UI en vez de mostrarse como dato de hoy",
  );
});

test("too short a history yields nothing rather than a confident reading", () => {
  assert.equal(buildInstitutionalFlows(series(3, 100_000_000)), null);
});
