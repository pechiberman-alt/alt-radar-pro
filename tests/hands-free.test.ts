import assert from "node:assert/strict";
import test from "node:test";
import { afterWake, ECHO_MS, HandsFree, WAKE_WINDOW_MS, words } from "../lib/hands-free.ts";

const T0 = Date.UTC(2026, 9, 7, 18, 52, 0);

/** A machine switched on, with the page visible. */
function on(): HandsFree {
  const m = new HandsFree();
  m.enable();
  return m;
}

test("the wake word is found in any spelling the engine tends to produce, and the rest is the command", () => {
  assert.deepEqual(afterWake("Jarvis"), { woke: true, rest: "" });
  assert.deepEqual(afterWake("hola Jarvis, analizá BTC"), { woke: true, rest: "analizá BTC" });
  assert.deepEqual(afterWake("¡Yarvis! precio ETH"), { woke: true, rest: "precio ETH" });
  assert.deepEqual(afterWake("jarbis qué opinás de SOL"), { woke: true, rest: "qué opinás de SOL" });
  assert.equal(afterWake("analizá BTC").woke, false, "no wake word, no command");
  assert.equal(afterWake("jarvisito").woke, false, "a word that only starts like it is not the wake word");
  assert.deepEqual(words("Analizá, BTC!"), ["analiza", "btc"]);
});

test("a result the engine delivers again is heard once, however often it comes back", () => {
  const m = on();
  assert.deepEqual(m.final(0, "Jarvis analizá BTC", T0), { type: "command", text: "analizá BTC" });
  // Chrome on Android re-sends the same results after it restarts: same indexes, nothing new.
  assert.deepEqual(m.final(0, "Jarvis analizá BTC", T0 + 500), { type: "none" });
  assert.deepEqual(m.final(0, "Jarvis analizá BTC", T0 + 900), { type: "none" });
  m.started();
  // A new engine session starts its results from 0 again: a genuinely new phrase counts.
  assert.deepEqual(m.final(0, "Jarvis precio de ETH", T0 + 60_000), { type: "command", text: "precio de ETH" });
});

test("the same words coming back under a new index within a few seconds are not said twice", () => {
  const m = on();
  assert.equal(m.final(0, "Jarvis analizá BTC", T0).type, "command");
  assert.equal(m.final(1, "Jarvis analizá BTC", T0 + 1_000).type, "none");
  assert.equal(m.final(2, "Jarvis analizá BTC", T0 + 4_000).type, "command", "after the repeat gap it is a new request");
});

test("'Jarvis' alone is acknowledged, then the next phrase is the command; the greeting is not repeated", () => {
  const m = on();
  assert.deepEqual(m.final(0, "Jarvis", T0), { type: "awake" });
  assert.deepEqual(m.final(1, "Jarvis", T0 + 1_000), { type: "none" }, "a second 'Jarvis' within the gap does not greet again");
  assert.deepEqual(m.final(2, "analizá ETH", T0 + 2_000), { type: "command", text: "analizá ETH" }, "the window stays open for the request");
  assert.deepEqual(m.final(3, "Jarvis", T0 + 20_000), { type: "awake" }, "after the gap it greets again");
});

test("without the wake word, a phrase counts only inside the window that a wake or a command opens", () => {
  const m = on();
  assert.deepEqual(m.final(0, "precio de SOL", T0), { type: "none" }, "nothing opened the window");
  m.final(1, "Jarvis", T0 + 1_000);
  assert.deepEqual(m.final(2, "precio de SOL", T0 + 1_000 + WAKE_WINDOW_MS - 1), { type: "command", text: "precio de SOL" });
  assert.deepEqual(m.final(3, "precio de ETH", T0 + 1_000 + 3 * WAKE_WINDOW_MS), { type: "none" }, "the window is over");
});

test("JARVIS's own voice does not come back as a question", () => {
  const m = on();
  assert.deepEqual(m.final(0, "Jarvis", T0), { type: "awake" });
  m.busy(true, T0 + 1_000, "Analizando Bitcoin con todos los motores");
  assert.deepEqual(m.final(1, "Jarvis precio de BTC", T0 + 1_100), { type: "none" }, "while it speaks the microphone is not listened to");
  m.busy(false, T0 + 4_000);
  assert.deepEqual(m.final(2, "Jarvis precio de BTC", T0 + 4_000 + ECHO_MS - 100), { type: "none" }, "the tail of the voice is still echo");
  assert.deepEqual(m.final(3, "Jarvis precio de BTC", T0 + 4_000 + ECHO_MS + 500), { type: "command", text: "precio de BTC" });
});

test("the echo of what JARVIS said is recognised even after the speech ended", () => {
  const m = on();
  m.busy(true, T0, "Soy JARVIS, tu asistente de ALT RADAR PRO");
  m.busy(false, T0 + 2_000);
  assert.deepEqual(m.final(0, "soy jarvis tu asistente", T0 + 5_000), { type: "none" });
  assert.deepEqual(m.final(1, "analizá el soporte de SOL", T0 + 5_500), { type: "none" }, "no window opened by a voice that was not asked");
});

test("a question that reuses words of JARVIS's last answer is a question, not its echo", () => {
  const m = on();
  assert.equal(m.final(0, "Jarvis analizá BTC", T0).type, "command");
  m.busy(true, T0 + 1_000, "Bitcoin sostiene 82.920, con soporte en 80.100 y resistencia en 85.000");
  m.busy(false, T0 + 5_000);
  assert.deepEqual(m.final(1, "dame el soporte de bitcoin", T0 + 5_000 + ECHO_MS + 1_000), { type: "command", text: "dame el soporte de bitcoin" });
});

test("the follow-up window opens after the answer to a command, not after unprompted speech", () => {
  const m = on();
  assert.equal(m.final(0, "Jarvis analizá BTC", T0).type, "command");
  m.busy(true, T0 + 1_000, "Bitcoin sostiene 82.920");
  m.busy(false, T0 + 5_000);
  assert.deepEqual(m.final(1, "y el soporte", T0 + 5_000 + ECHO_MS + 1_000), { type: "command", text: "y el soporte" });

  const quiet = on();
  quiet.busy(true, T0, "Alerta de señal");
  quiet.busy(false, T0 + 2_000);
  assert.deepEqual(quiet.final(0, "precio de SOL", T0 + 4_000), { type: "none" }, "nothing asked, nothing open");
});

test("a speech that never reports its end does not keep the engine deaf", () => {
  const m = on();
  m.busy(true, T0, "algo");
  assert.equal(m.final(0, "Jarvis", T0 + 60_000).type, "none", "within the limit of a speech it does not listen");
  assert.equal(m.final(1, "Jarvis", T0 + 130_000).type, "awake", "past the safety limit it listens again");
});

test("the engine restarts after it ends on its own, and backs off after failures", () => {
  const m = on();
  assert.deepEqual(m.ended(), { type: "restart", inMs: 250 });
  assert.deepEqual(m.error("no-speech"), { type: "none" }, "silence is not a failure");
  assert.deepEqual(m.ended(), { type: "restart", inMs: 250 });

  assert.deepEqual(m.error("network"), { type: "none" });
  assert.deepEqual(m.ended(), { type: "restart", inMs: 500 });
  assert.deepEqual(m.error("network"), { type: "none" });
  assert.deepEqual(m.ended(), { type: "restart", inMs: 1_000 });
  assert.deepEqual(m.error("network"), { type: "none" });
  assert.deepEqual(m.error("network"), { type: "none" });
  assert.deepEqual(m.error("network"), { type: "none" });
  assert.deepEqual(m.ended(), { type: "restart", inMs: 8_000 });
  assert.deepEqual(m.error("network"), { type: "stop", reason: "red" }, "six failures in a row stop it, with a reason");
  assert.equal(m.active, false);
  assert.equal(m.ended().type, "none");
});

test("a heard phrase resets the failures, so a flaky connection does not stop it for good", () => {
  const m = on();
  m.error("network");
  m.error("network");
  m.error("network");
  assert.equal(m.final(0, "Jarvis", T0).type, "awake");
  assert.deepEqual(m.ended(), { type: "restart", inMs: 250 });
});

test("a missing permission stops it at once, and a missing microphone after the second try", () => {
  const denied = on();
  assert.deepEqual(denied.error("not-allowed"), { type: "stop", reason: "permiso" });
  assert.match(denied.status(T0), /SIN PERMISO DEL MICRÓFONO/);

  const mic = on();
  assert.deepEqual(mic.error("audio-capture"), { type: "none" }, "one try is not a verdict");
  assert.deepEqual(mic.error("audio-capture"), { type: "stop", reason: "micrófono" });
});

test("when the page is hidden it stops, and it goes on when it is visible again", () => {
  const m = on();
  assert.equal(m.setVisible(false), "abort");
  assert.equal(m.active, false);
  assert.equal(m.ended().type, "none", "no restart in the background");
  assert.equal(m.final(0, "Jarvis", T0).type, "none");
  assert.match(m.status(T0), /EN PAUSA · la app quedó en segundo plano/);
  assert.equal(m.setVisible(false), "none", "hiding twice changes nothing");
  assert.equal(m.setVisible(true), "start");
  assert.equal(m.active, true);
  assert.equal(m.setVisible(true), "none");
});

test("with hands-free off, the page's visibility changes nothing", () => {
  const m = new HandsFree();
  assert.equal(m.setVisible(false), "none");
  assert.equal(m.setVisible(true), "none");
  assert.equal(m.active, false);
});

test("a phrase before the engine is on is not kept for later", () => {
  const m = new HandsFree();
  assert.equal(m.final(0, "Jarvis analizá BTC", T0).type, "none");
  m.enable();
  assert.deepEqual(m.final(0, "Jarvis analizá BTC", T0 + 1_000), { type: "command", text: "analizá BTC" });
});

test("what the panel says follows the state", () => {
  const m = new HandsFree();
  assert.equal(m.status(T0), "", "off says nothing");
  m.enable();
  assert.equal(m.status(T0), "ESCUCHANDO · decí «Jarvis» y tu pedido");
  m.final(0, "Jarvis", T0);
  assert.equal(m.status(T0 + 1_000), "TE ESCUCHO · decí tu pedido");
  assert.equal(m.status(T0 + WAKE_WINDOW_MS + 1), "ESCUCHANDO · decí «Jarvis» y tu pedido", "the window closes by itself");
  m.busy(true, T0 + 2_000, "hola");
  assert.equal(m.status(T0 + 2_500), "HABLANDO · no te escucho mientras hablo");
  assert.equal(m.windowEndsAt(), T0 + WAKE_WINDOW_MS);
});

test("switching it off keeps the reason it stopped, until it is switched on again", () => {
  const m = on();
  m.error("not-allowed");
  m.disable();
  assert.match(m.status(T0), /SIN PERMISO/, "the panel still says why");
  m.enable();
  assert.equal(m.status(T0), "ESCUCHANDO · decí «Jarvis» y tu pedido");
  assert.equal(m.active, true);
});

test("switching it off stops everything, and nothing is heard", () => {
  const m = on();
  m.final(0, "Jarvis", T0);
  m.disable();
  assert.equal(m.active, false);
  assert.equal(m.final(1, "analizá BTC", T0 + 1_000).type, "none");
  assert.equal(m.ended().type, "none");
  assert.equal(m.status(T0 + 1_000), "", "off, with nothing wrong, says nothing");
});
