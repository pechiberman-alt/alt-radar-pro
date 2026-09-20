import assert from "node:assert/strict";
import test from "node:test";
import {
  TIMEFRAMES,
  TIMEFRAME_ORDER,
  timeframeConfig,
} from "../lib/market-fetch.ts";

/** Periods Binance's openInterestHist actually accepts. */
const BINANCE_OI_PERIODS = ["5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d"];

test("every frame in the selector has a configuration", () => {
  for (const id of TIMEFRAME_ORDER) {
    assert.ok(TIMEFRAMES[id], `${id} está en el selector pero no tiene configuración`);
  }
  assert.equal(TIMEFRAME_ORDER.length, Object.keys(TIMEFRAMES).length);
});

test("no frame declares an OI period Binance would reject", () => {
  for (const [id, config] of Object.entries(TIMEFRAMES)) {
    if (config.oiPeriod === null) continue;
    assert.ok(
      BINANCE_OI_PERIODS.includes(config.oiPeriod),
      `${id} pide período "${config.oiPeriod}", que la API no acepta`,
    );
  }
});

test("frames without an OI period are exactly the ones Binance cannot serve", () => {
  // Stated as a test so a future edit that quietly enables one is caught.
  assert.equal(TIMEFRAMES["1m"].oiPeriod, null, "no existe período de 1m");
  assert.equal(TIMEFRAMES["3d"].oiPeriod, null, "no existe período de 3d");
  assert.equal(TIMEFRAMES["1w"].oiPeriod, null, "no existe período de 1w");
});

test("the horizon grows with the frame instead of staying at wall-clock time", () => {
  // Half-life in candles times the frame's length, in hours.
  const hours: Record<string, number> = {
    "1m": 1 / 60, "5m": 5 / 60, "15m": 0.25, "30m": 0.5,
    "1h": 1, "4h": 4, "12h": 12, "1d": 24, "3d": 72, "1w": 168,
  };
  const horizons = TIMEFRAME_ORDER.map((id) => TIMEFRAMES[id].halfLife * hours[id]);
  for (let i = 1; i < horizons.length; i += 1) {
    assert.ok(
      horizons[i] > horizons[i - 1],
      `el horizonte de ${TIMEFRAME_ORDER[i]} (${horizons[i].toFixed(1)}h) no supera al de ${TIMEFRAME_ORDER[i - 1]} (${horizons[i - 1].toFixed(1)}h)`,
    );
  }
  // A weekly reader holds positions for weeks, not for two days.
  assert.ok(horizons[horizons.length - 1] > 24 * 30, "el semanal debe mirar meses");
});

test("the projected range widens with the frame", () => {
  const ranges = TIMEFRAME_ORDER.map((id) => TIMEFRAMES[id].priceRange);
  for (let i = 1; i < ranges.length; i += 1) {
    assert.ok(ranges[i] > ranges[i - 1], `${TIMEFRAME_ORDER[i]} no proyecta más lejos que el anterior`);
  }
  assert.ok(TIMEFRAMES["1m"].priceRange < 0.05, "±22% en un minuto deja el mapa vacío");
  assert.ok(TIMEFRAMES["1w"].priceRange > 0.4, "±22% en semanal deja fuera lo que importa");
});

test("lookbacks stay inside what one Binance call returns", () => {
  for (const [id, config] of Object.entries(TIMEFRAMES)) {
    assert.ok(config.lookback <= 500, `${id} pide ${config.lookback} velas y el máximo por llamada es 500`);
    assert.ok(config.lookback >= 40, `${id} pide muy pocas velas para detectar nada`);
  }
});

test("an unknown frame falls back instead of crashing", () => {
  assert.equal(timeframeConfig("no-existe").label, TIMEFRAMES["1h"].label);
});
