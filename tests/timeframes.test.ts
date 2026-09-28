import assert from "node:assert/strict";
import test from "node:test";
import { higherTimeframes, TIMEFRAME_ORDER, TIMEFRAMES, timeframeConfig } from "../lib/market-fetch.ts";

const UNIT_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
const idToMs = (id: string) => Number(id.slice(0, -1)) * UNIT_MS[id.slice(-1)];
// The periods Binance's openInterestHist actually accepts.
const OI_PERIODS = new Set(["5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d"]);

test("the selector order and the config table describe exactly the same timeframes", () => {
  assert.deepEqual([...TIMEFRAME_ORDER].sort(), Object.keys(TIMEFRAMES).sort());
});

test("3m, 2h and 8h are present", () => {
  for (const id of ["3m", "2h", "8h"]) assert.ok(TIMEFRAME_ORDER.includes(id), `${id} falta`);
});

test("every frameMs matches what its id says, so a typo can't skew a countdown or a footprint bucket", () => {
  for (const id of TIMEFRAME_ORDER) {
    assert.equal(timeframeConfig(id).frameMs, idToMs(id), `frameMs de ${id}`);
  }
});

test("the selector runs strictly from finest to coarsest", () => {
  const ms = TIMEFRAME_ORDER.map((id) => timeframeConfig(id).frameMs);
  for (let i = 1; i < ms.length; i += 1) assert.ok(ms[i] > ms[i - 1], `${TIMEFRAME_ORDER[i]} no es mayor que ${TIMEFRAME_ORDER[i - 1]}`);
});

test("higher frames exist and are strictly coarser than the frame they belong to", () => {
  for (const id of TIMEFRAME_ORDER) {
    for (const higher of higherTimeframes(id)) {
      assert.ok(TIMEFRAMES[higher], `${id} apunta a ${higher}, que no existe`);
      assert.ok(timeframeConfig(higher).frameMs > timeframeConfig(id).frameMs, `${higher} no es mayor que ${id}`);
    }
  }
});

test("an open-interest period is only ever one Binance really offers, otherwise null", () => {
  for (const id of TIMEFRAME_ORDER) {
    const period = timeframeConfig(id).oiPeriod;
    assert.ok(period === null || OI_PERIODS.has(period), `${id}: ${period} no existe en Binance`);
  }
  assert.equal(timeframeConfig("3m").oiPeriod, null);
  assert.equal(timeframeConfig("8h").oiPeriod, null);
  assert.equal(timeframeConfig("2h").oiPeriod, "2h");
});

test("half-life in wall-clock time stays sensible as frames grow (no frame is wildly out of line with its neighbours)", () => {
  const hours = (id: string) => (timeframeConfig(id).halfLife * timeframeConfig(id).frameMs) / 3_600_000;
  // 2h sits between 1h and 4h, 8h between 4h and 12h.
  assert.ok(hours("2h") > Math.min(hours("1h"), hours("4h")) * 0.8 && hours("2h") < Math.max(hours("1h"), hours("4h")) * 1.25);
  assert.ok(hours("8h") > Math.min(hours("4h"), hours("12h")) * 0.8 && hours("8h") < Math.max(hours("4h"), hours("12h")) * 1.25);
});
