import assert from "node:assert/strict";
import test from "node:test";
import { buildSystemPrompt, buildUserMessage, compactSnapshot, extractText, quotaState, trimHistory } from "../lib/ai-analyst.ts";
import { KNOWLEDGE } from "../lib/assistant/knowledge.ts";

const asset = (symbol: string, score: number, signal = "SETUP") => ({
  symbol, price: 100.123456789, change1h: 1, change4h: 2.3456, change24h: 5.6789, volume: 1, quoteVolume: 1,
  high: 1, low: 1, score, technicalScore: score, signal, side: "LONG", relVolume: 1.5, momentum: 1,
  liquidity: "HIGH", extended: false, confirmationCount: 1, dataQuality: "FULL", reasons: [], penalties: [],
});

const ctx = (n: number) => ({
  timestamp: "2026-09-24T12:00:00Z",
  market: [asset("BTCUSDT", 50), asset("DOGEUSDT", 40)],
  scored: Array.from({ length: n }, (_, i) => asset(`A${i}USDT`, i, i % 5 === 0 ? "NO SIGNAL" : "SETUP")),
  altseason: { final: 55, raw: 60, state: "NEUTRAL", adjustment: -5 },
  risk: { score: 40, level: "MEDIO", killSwitch: false },
  structure: null,
  pumps: [],
}) as never;

test("the snapshot keeps only the strongest signals and the majors, bounded", () => {
  const snap = compactSnapshot(ctx(200));
  assert.equal(snap.topSignals.length, 12);
  assert.ok(snap.topSignals.every((s) => s.signal !== "NO SIGNAL"));
  assert.ok(snap.topSignals[0].score >= snap.topSignals[11].score);
  assert.deepEqual(snap.majors.map((m) => m.s), ["BTCUSDT"]);
  assert.ok(JSON.stringify(snap).length < 6000, "cada pregunta debe seguir costando centavos");
});

test("numbers are rounded, not dropped", () => {
  const snap = compactSnapshot(ctx(3));
  assert.equal(snap.topSignals[0].ch24h, 5.68);
});

test("the instructions forbid invented numbers and orders, and carry the app's glossary", () => {
  const p = buildSystemPrompt(KNOWLEDGE);
  assert.match(p, /Nunca inventes/);
  assert.match(p, /No es asesoramiento financiero/);
  assert.match(p, /estimado de lo medido/);
  for (const k of KNOWLEDGE.slice(0, 5)) assert.ok(p.includes(k.title), k.title);
});

test("the question is bounded and travels with the snapshot", () => {
  const m = buildUserMessage("x".repeat(2000), { a: 1 });
  assert.match(m, /^SNAPSHOT DEL RADAR/);
  assert.ok(m.length < 800);
});

test("history is trimmed, alternating and starts with the user", () => {
  const h = trimHistory([
    { role: "assistant", content: "hola" },
    { role: "user", content: "q1" },
    { role: "user", content: "q1 bis" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "" },
  ]);
  assert.equal(h[0].role, "user");
  for (let i = 1; i < h.length; i += 1) assert.notEqual(h[i].role, h[i - 1].role);
});

test("only text blocks are read from the API response", () => {
  assert.equal(extractText({ content: [{ type: "text", text: "A" }, { type: "tool_use" }, { type: "text", text: "B" }] }), "A\nB");
  assert.equal(extractText({}), "");
});

test("the daily quota stops at the limit", () => {
  assert.deepEqual(quotaState(24, 25), { allowed: true, remaining: 1 });
  assert.deepEqual(quotaState(25, 25), { allowed: false, remaining: 0 });
});
