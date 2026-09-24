import assert from "node:assert/strict";
import test from "node:test";
import { buildServerSnapshot, markdownToTelegramHtml, splitForTelegram } from "../lib/telegram-ai.ts";

test("markdown becomes Telegram HTML, and raw HTML from the model is escaped", () => {
  const out = markdownToTelegramHtml("## Lectura\n**BTC** en *rango*, nivel `84.000`\n- uno\n<script>x</script> & más");
  assert.match(out, /<b>Lectura<\/b>/);
  assert.match(out, /<b>BTC<\/b>/);
  assert.match(out, /<i>rango<\/i>/);
  assert.match(out, /<code>84\.000<\/code>/);
  assert.match(out, /• uno/);
  assert.match(out, /&lt;script&gt;x&lt;\/script&gt; &amp; más/);
  assert.doesNotMatch(out, /<script>/);
});

test("long answers are split under Telegram's limit, on paragraph breaks", () => {
  const long = Array.from({ length: 10 }, (_, i) => `Párrafo ${i} ` + "x".repeat(900)).join("\n\n");
  const parts = splitForTelegram(long, 3900);
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(p.length <= 3900);
  assert.equal(parts.join("\n\n").replace(/\s/g, "").length, long.replace(/\s/g, "").length);
  assert.deepEqual(splitForTelegram("corto"), ["corto"]);
});

test("the server snapshot is bounded and says what it does not contain", () => {
  const snap = buildServerSnapshot({
    majors: Array.from({ length: 20 }, (_, i) => ({ s: `A${i}`, price: 1, ch24h: 0 })),
    openSignals: [
      { s: "X", side: "LONG", score: 60, entry: 1, tf: "1h", since: "" },
      { s: "Y", side: "LONG", score: 90, entry: 1, tf: "1h", since: "" },
    ],
    fearGreed: { value: 71, zone: "AVARICIA" },
    structure: null,
    news: [],
  });
  assert.equal(snap.majors.length, 8);
  assert.equal(snap.openSignals[0].s, "Y", "las señales más fuertes primero");
  assert.match(snap.note, /no incluye el mapa de liquidaciones/);
});
