import assert from "node:assert/strict";
import test from "node:test";
import { publishAlert, resetAlertBus, subscribeToAlerts } from "../lib/alert-bus.ts";
import { signalAlert } from "../lib/alerts.ts";

test("a published alert reaches every subscriber", () => {
  resetAlertBus();
  const a: string[] = [];
  const b: string[] = [];
  subscribeToAlerts((alert) => a.push(alert.id));
  subscribeToAlerts((alert) => b.push(alert.id));

  publishAlert(signalAlert("BTCUSDT", "LONG", 80, "s1"));
  assert.deepEqual(a, ["signal-s1"]);
  assert.deepEqual(b, ["signal-s1"]);
});

test("the same condition is not raised twice", () => {
  resetAlertBus();
  const received: string[] = [];
  subscribeToAlerts((alert) => received.push(alert.id));

  assert.equal(publishAlert(signalAlert("BTCUSDT", "LONG", 80, "s1")), true);
  // A detector re-running finds the same condition; the reader already saw it.
  assert.equal(publishAlert(signalAlert("BTCUSDT", "LONG", 80, "s1")), false);
  assert.equal(received.length, 1);
});

test("unsubscribing actually stops delivery", () => {
  resetAlertBus();
  const received: string[] = [];
  const stop = subscribeToAlerts((alert) => received.push(alert.id));
  stop();
  publishAlert(signalAlert("BTCUSDT", "LONG", 80, "s1"));
  assert.deepEqual(received, []);
});

test("the seen set stays bounded over a long session", () => {
  resetAlertBus();
  let count = 0;
  subscribeToAlerts(() => (count += 1));
  for (let i = 0; i < 400; i += 1) {
    publishAlert(signalAlert("BTCUSDT", "LONG", 70, `s${i}`));
  }
  assert.equal(count, 400, "cada condición distinta se entrega");
  // The oldest ids are evicted, so a tab open for hours does not grow forever.
  assert.equal(
    publishAlert(signalAlert("BTCUSDT", "LONG", 70, "s0")),
    true,
    "el id más viejo salió del set acotado",
  );
});
