import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const signalRecords = sqliteTable(
  "signal_records",
  {
    id: text("id").primaryKey(),
    symbol: text("symbol").notNull(),
    side: text("side", { enum: ["LONG", "SHORT"] }).notNull(),
    signal: text("signal", { enum: ["SETUP", "TRIGGER"] }).notNull(),
    score: integer("score").notNull(),
    technicalScore: integer("technical_score").notNull(),
    altseasonScore: integer("altseason_score"),
    geopoliticalRisk: integer("geopolitical_risk"),
    entryPrice: real("entry_price").notNull(),
    source: text("source").notNull(),
    timeframe: text("timeframe").notNull().default("15m / 1H"),
    detectedAt: text("detected_at").notNull(),
    status: text("status", { enum: ["MONITORING", "RESOLVED"] })
      .notNull()
      .default("MONITORING"),
    reasons: text("reasons").notNull().default("[]"),
    penalties: text("penalties").notNull().default("[]"),
    price5m: real("price_5m"),
    return5m: real("return_5m"),
    captured5m: text("captured_5m"),
    price15m: real("price_15m"),
    return15m: real("return_15m"),
    captured15m: text("captured_15m"),
    price1h: real("price_1h"),
    return1h: real("return_1h"),
    captured1h: text("captured_1h"),
    price4h: real("price_4h"),
    return4h: real("return_4h"),
    captured4h: text("captured_4h"),
    price24h: real("price_24h"),
    return24h: real("return_24h"),
    captured24h: text("captured_24h"),
    maxMove: real("max_move").notNull().default(0),
    minMove: real("min_move").notNull().default(0),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("signal_records_detected_idx").on(table.detectedAt),
    index("signal_records_symbol_side_idx").on(table.symbol, table.side),
    index("signal_records_status_idx").on(table.status),
  ],
);

export const automationState = sqliteTable("automation_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const brainObservations = sqliteTable(
  "brain_observations",
  {
    id: text("id").primaryKey(),
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull(),
    horizonMinutes: integer("horizon_minutes").notNull(),
    direction: text("direction", { enum: ["BULLISH", "BEARISH"] }).notNull(),
    rawConfidence: integer("raw_confidence").notNull(),
    calibratedConfidence: integer("calibrated_confidence").notNull(),
    entryPrice: real("entry_price").notNull(),
    features: text("features").notNull().default("{}"),
    detectedAt: text("detected_at").notNull(),
    targetAt: text("target_at").notNull(),
    outcomePrice: real("outcome_price"),
    directionalReturn: real("directional_return"),
    success: integer("success"),
    evaluatedAt: text("evaluated_at"),
  },
  (table) => [
    index("brain_observations_symbol_timeframe_idx").on(
      table.symbol,
      table.timeframe,
      table.detectedAt,
    ),
    index("brain_observations_evaluation_idx").on(
      table.timeframe,
      table.evaluatedAt,
    ),
  ],
);
