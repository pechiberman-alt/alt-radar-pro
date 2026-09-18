import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAssetFlow,
  buildComparison,
  parseFarsideTable,
  parseFlowCell,
} from "../lib/etf-flows-multi.ts";

test("cells parse millions, parentheses as negatives, and dashes as no data", () => {
  assert.equal(parseFlowCell("123.4"), 123_400_000);
  assert.equal(parseFlowCell("1,234.5"), 1_234_500_000);
  assert.equal(parseFlowCell("(56.7)"), -56_700_000);
  assert.equal(parseFlowCell("-"), null);
  assert.equal(parseFlowCell("–"), null);
  assert.equal(parseFlowCell(""), null);
  assert.equal(parseFlowCell("n/a"), null, "texto no numérico no se fuerza a cero");
});

const table = `
<table>
  <tr><th>Date</th><th>IBIT</th><th>FBTC</th><th>Total</th></tr>
  <tr><td>01 Sep 2026</td><td>10.0</td><td>5.0</td><td>15.0</td></tr>
  <tr><td>02 Sep 2026</td><td>(3.0)</td><td>1.0</td><td>(2.0)</td></tr>
  <tr><td>03 Sep 2026</td><td>20.0</td><td>-</td><td>20.0</td></tr>
  <tr><td>Total</td><td>27.0</td><td>6.0</td><td>33.0</td></tr>
  <tr><td>Average</td><td>9.0</td><td>3.0</td><td>11.0</td></tr>
</table>`;

test("only dated rows are read; header and summary rows are skipped", () => {
  const rows = parseFarsideTable(table);
  assert.equal(rows.length, 3, "Total y Average no son sesiones");
  assert.deepEqual(
    rows.map((r) => r.date),
    ["2026-09-01", "2026-09-02", "2026-09-03"],
  );
  assert.equal(rows[1].netUsd, -2_000_000, "los paréntesis son salida");
});

test("rows come back oldest first regardless of page order", () => {
  const reversed = `
    <tr><td>03 Sep 2026</td><td>1</td><td>3.0</td></tr>
    <tr><td>01 Sep 2026</td><td>1</td><td>1.0</td></tr>`;
  assert.deepEqual(
    parseFarsideTable(reversed).map((r) => r.date),
    ["2026-09-01", "2026-09-03"],
  );
});

test("markup it cannot understand yields nothing rather than a guess", () => {
  assert.deepEqual(parseFarsideTable("<p>sin tabla</p>"), []);
  assert.deepEqual(parseFarsideTable(""), []);
  // A shape change upstream must not produce invented rows.
  assert.deepEqual(parseFarsideTable("<tr><td>algo</td><td>otra</td></tr>"), []);
});

const rows = (values: number[]) =>
  values.map((netUsd, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, "0")}`,
    netUsd: netUsd * 1_000_000,
  }));

test("an asset summary carries its streak and its weekly total", () => {
  const flow = buildAssetFlow("ETH", rows([5, 10, 20, 30, 40]));
  assert.ok(flow);
  assert.equal(flow.asOf, "2026-09-05");
  assert.equal(flow.streakDirection, "ENTRADA");
  assert.equal(flow.streakDays, 5);
  assert.equal(flow.sum7dUsd, 105_000_000);
});

test("a streak counts only the run that reaches the last session", () => {
  const flow = buildAssetFlow("SOL", rows([50, 50, -10, 20, 30]));
  assert.equal(flow?.streakDays, 2, "la racha vieja quedó cortada por el día negativo");
  assert.equal(flow?.streakDirection, "ENTRADA");
});

test("too little history yields nothing rather than a one-day conclusion", () => {
  assert.equal(buildAssetFlow("XRP", rows([10])), null);
  assert.equal(buildAssetFlow("XRP", []), null);
});

test("the comparison names where money went in and where it came out", () => {
  const comparison = buildComparison([
    buildAssetFlow("BTC", rows([10, 10, 10])),
    buildAssetFlow("ETH", rows([-20, -20, -20])),
    buildAssetFlow("SOL", rows([1, 1, 1])),
  ]);
  assert.ok(comparison);
  assert.equal(comparison.leader?.asset, "BTC");
  assert.equal(comparison.laggard?.asset, "ETH");
  assert.match(comparison.reading, /entró a BTC y salió de ETH/);
  assert.deepEqual(comparison.assets.map((a) => a.asset), ["BTC", "SOL", "ETH"]);
});

test("broad inflows are not described as a rotation", () => {
  const comparison = buildComparison([
    buildAssetFlow("BTC", rows([10, 10, 10])),
    buildAssetFlow("ETH", rows([5, 5, 5])),
  ]);
  assert.equal(comparison?.laggard, null);
  assert.match(comparison?.reading ?? "", /demanda es amplia, no una rotación/);
});

test("a general retreat is not described as rotation either", () => {
  const comparison = buildComparison([
    buildAssetFlow("BTC", rows([-10, -10, -10])),
    buildAssetFlow("ETH", rows([-30, -30, -30])),
  ]);
  assert.equal(comparison?.leader, null);
  assert.match(comparison?.reading ?? "", /retirada general/);
});

test("assets whose source failed are dropped, not shown as zero", () => {
  const comparison = buildComparison([buildAssetFlow("BTC", rows([10, 10])), null, null]);
  assert.equal(comparison?.assets.length, 1);
  assert.equal(buildComparison([null, null]), null);
});
