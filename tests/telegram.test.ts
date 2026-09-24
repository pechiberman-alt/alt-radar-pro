import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TELEGRAM_PREFS, dcaEvent, fearGreedEvent, linkCode, newsEvent, parseCommand,
  parsePrefs, selectForUser, signalEvent, webhookSecret,
} from "../lib/telegram.ts";

const sig = (id: string, score: number) =>
  signalEvent({ id, symbol: "SOLUSDT", side: "LONG", signal: "TRIGGER", score, entryPrice: 142.5, timeframe: "15m / 1H" });

test("signals below the user's threshold are not sent", () => {
  const { send } = selectForUser([sig("a", 90), sig("b", 60)], DEFAULT_TELEGRAM_PREFS, new Set());
  assert.deepEqual(send.map((e) => e.key), ["signal:a"]);
});

test("disabled categories are never sent", () => {
  const prefs = parsePrefs({ categories: { DCA: false } });
  const { send } = selectForUser([dcaEvent("BTCUSDT", 50, "2026-09-24")], prefs, new Set());
  assert.deepEqual(send, []);
});

test("an event already sent is never sent twice", () => {
  const e = dcaEvent("BTCUSDT", 50, "2026-09-24");
  assert.equal(selectForUser([e], DEFAULT_TELEGRAM_PREFS, new Set([e.key])).send.length, 0);
});

test("a burst is capped, highest priority first, the rest counted not dropped silently", () => {
  const events = [sig("a", 80), sig("b", 95), sig("c", 85), sig("d", 90), sig("e", 88), sig("f", 99)];
  const { send, suppressed } = selectForUser(events, DEFAULT_TELEGRAM_PREFS, new Set(), 4);
  assert.deepEqual(send.map((e) => e.score), [99, 95, 90, 88]);
  assert.equal(suppressed, 2);
});

test("only extreme fear or greed produces a message", () => {
  assert.equal(fearGreedEvent(50, "NEUTRAL", "d"), null);
  assert.equal(fearGreedEvent(65, "AVARICIA", "d"), null);
  assert.ok(fearGreedEvent(12, "MIEDO EXTREMO", "d"));
  assert.match(fearGreedEvent(90, "AVARICIA EXTREMA", "d")!.text, /puede extenderse/);
});

test("messages escape HTML so a headline cannot break the markup", () => {
  const e = newsEvent({ url: "https://x/a?b=1&c=2", title: "SEC <rejects> & more", source: "X", category: "REGULACIÓN", tone: "NEGATIVO" });
  assert.match(e.text, /&lt;rejects&gt; &amp; more/);
  assert.match(e.text, /b=1&amp;c=2/);
});

test("signal messages say they are not an order", () => {
  assert.match(sig("a", 90).text, /No es una orden/);
  assert.match(dcaEvent("ETHUSDT", 20, "d").text, /la compra la hacés vos/);
});

test("prefs parsing clamps and falls back to defaults", () => {
  assert.equal(parsePrefs({ signalMinScore: 400 }).signalMinScore, 100);
  assert.equal(parsePrefs(null).signalMinScore, DEFAULT_TELEGRAM_PREFS.signalMinScore);
  assert.equal(parsePrefs({ categories: { NOTICIAS: "yes" } }).categories.NOTICIAS, true, "sólo booleanos cambian una categoría");
});

test("bot commands parse with and without the bot's @name", () => {
  assert.deepEqual(parseCommand("/start abc123"), { cmd: "start", arg: "abc123" });
  assert.deepEqual(parseCommand("/stop@AltRadarBot"), { cmd: "stop", arg: "" });
  assert.equal(parseCommand("/ESTADO").cmd, "estado");
  assert.equal(parseCommand("hola").cmd, "ayuda");
  assert.equal(parseCommand(undefined).cmd, "ayuda");
});

test("the webhook secret is stable per token and differs between tokens", async () => {
  const a = await webhookSecret("123:abc");
  assert.equal(a, await webhookSecret("123:abc"));
  assert.notEqual(a, await webhookSecret("123:abd"));
  assert.match(a, /^[0-9a-f]{48}$/, "caracteres que Telegram acepta en secret_token");
});

test("link codes are unguessable-length and URL-safe for /start", () => {
  const c = linkCode();
  assert.match(c, /^[0-9a-z]{16,20}$/);
  assert.notEqual(c, linkCode());
});
