import assert from "node:assert/strict";
import test from "node:test";
import {
  createDeliveryState,
  DEFAULT_ALERT_PREFERENCES,
  flowAlert,
  riskAlert,
  selectDeliverable,
  signalAlert,
  targetAlert,
  zoneAlert,
  type AlertPreferences,
} from "../lib/alerts.ts";

const NOW = Date.UTC(2026, 8, 19, 12, 0, 0);
const prefs = (patch: Partial<AlertPreferences> = {}): AlertPreferences => ({
  ...DEFAULT_ALERT_PREFERENCES,
  enabled: true,
  ...patch,
});

test("nothing is delivered while alerts are off", () => {
  const state = createDeliveryState();
  const out = selectDeliverable(
    [riskAlert("BTCUSDT", 98_000, 0.4, "s1", NOW)],
    { ...prefs(), enabled: false },
    state,
    NOW,
  );
  assert.deepEqual(out, []);
});

test("the same condition does not re-fire on every refresh", () => {
  const state = createDeliveryState();
  const alert = riskAlert("BTCUSDT", 98_000, 0.4, "s1", NOW);
  assert.equal(selectDeliverable([alert], prefs(), state, NOW).length, 1);
  // Same level, a minute later: still the same news.
  assert.equal(
    selectDeliverable([riskAlert("BTCUSDT", 98_000, 0.3, "s1", NOW + 60_000)], prefs(), state, NOW + 60_000).length,
    0,
  );
});

test("priority floor keeps the quiet tier out of notifications", () => {
  const state = createDeliveryState();
  const informative = zoneAlert("BTCUSDT", "DEMANDA", 98_000, 98_500, 1, 0, NOW);
  assert.equal(informative.priority, "INFORMATIVA");
  assert.deepEqual(
    selectDeliverable([informative], prefs({ minimumPriority: "IMPORTANTE" }), state, NOW),
    [],
  );
  // Lowering the floor lets it through.
  assert.equal(
    selectDeliverable([informative], prefs({ minimumPriority: "INFORMATIVA" }), createDeliveryState(), NOW).length,
    1,
  );
});

test("a muted category is never delivered regardless of priority", () => {
  const state = createDeliveryState();
  const out = selectDeliverable(
    [riskAlert("BTCUSDT", 98_000, 0.4, "s1", NOW)],
    prefs({ categories: { ...DEFAULT_ALERT_PREFERENCES.categories, RIESGO: false } }),
    state,
    NOW,
  );
  assert.deepEqual(out, []);
});

test("category cooldown suppresses a second alert of the same kind", () => {
  const state = createDeliveryState();
  // Two different zones, so ids differ — only the cooldown can stop the second.
  const first = zoneAlert("BTCUSDT", "DEMANDA", 98_000, 98_500, 2, 1, NOW);
  const second = zoneAlert("ETHUSDT", "DEMANDA", 2_400, 2_420, 2, 1, NOW + 60_000);
  assert.equal(selectDeliverable([first], prefs(), state, NOW).length, 1);
  assert.equal(selectDeliverable([second], prefs(), state, NOW + 60_000).length, 0);
});

test("a critical alert overrides its category cooldown", () => {
  const state = createDeliveryState();
  const routine = signalAlert("BTCUSDT", "LONG", 70, "s1", NOW);
  assert.equal(routine.priority, "IMPORTANTE");
  assert.equal(selectDeliverable([routine], prefs(), state, NOW).length, 1);

  // Same category a minute later, but this one is critical.
  const urgent = signalAlert("ETHUSDT", "SHORT", 88, "s2", NOW + 60_000);
  assert.equal(urgent.priority, "CRITICA");
  assert.equal(selectDeliverable([urgent], prefs(), state, NOW + 60_000).length, 1);
});

test("when a cooldown lets one through, it is the most important one", () => {
  const state = createDeliveryState();
  const batch = [
    targetAlert("BTCUSDT", 104_000, 0.4, "s1", NOW),
    signalAlert("ETHUSDT", "LONG", 90, "s2", NOW),
  ];
  const out = selectDeliverable(batch, prefs(), state, NOW);
  assert.equal(out[0].priority, "CRITICA", "la crítica va primero, no la que se evaluó antes");
});

test("conviction decides whether a signal is worth interrupting for", () => {
  assert.equal(signalAlert("BTCUSDT", "LONG", 85, "a").priority, "CRITICA");
  assert.equal(signalAlert("BTCUSDT", "LONG", 65, "b").priority, "IMPORTANTE");
});

test("a zone with confluence or a passed test outranks a fresh single-frame one", () => {
  assert.equal(zoneAlert("BTCUSDT", "DEMANDA", 1, 2, 2, 0).priority, "IMPORTANTE");
  assert.equal(zoneAlert("BTCUSDT", "DEMANDA", 1, 2, 1, 1).priority, "IMPORTANTE");
  assert.equal(zoneAlert("BTCUSDT", "DEMANDA", 1, 2, 1, 0).priority, "INFORMATIVA");
});

test("a flow alert is keyed per day, so a regime does not alert hourly", () => {
  const a = flowAlert("BTC", "ETH", NOW);
  const b = flowAlert("BTC", "ETH", NOW + 3 * 3_600_000);
  assert.equal(a.id, b.id, "mismo día y mismo par: es la misma noticia");
  const nextDay = flowAlert("BTC", "ETH", NOW + 26 * 3_600_000);
  assert.notEqual(a.id, nextDay.id);
});

test("risk alerts are keyed by level, not by time", () => {
  const a = riskAlert("BTCUSDT", 98_000, 0.5, "s1", NOW);
  const b = riskAlert("BTCUSDT", 98_000, 0.2, "s1", NOW + 600_000);
  assert.equal(a.id, b.id);
  const otherLevel = riskAlert("BTCUSDT", 97_000, 0.5, "s1", NOW);
  assert.notEqual(a.id, otherLevel.id);
});
