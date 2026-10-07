import assert from "node:assert/strict";
import test from "node:test";
import {
  askOpenAICompatible,
  askWorkersAI,
  extractChatText,
  firstAnswer,
  FREE_DAILY_NEURONS,
  FREE_USER_DAILY,
  freeAllowance,
  isGroqKey,
  neuronsFor,
  stripThinking,
  usageOf,
  WORKERS_MODEL,
  type AiLike,
} from "../lib/ai-brains.ts";
import { askClaude } from "../lib/ai-analyst-server.ts";
import { answerWithBrains } from "../lib/ai-cascade.ts";
import { probeFreeBrain, readProbe, resetProbe } from "../lib/ai-probe.ts";
import { makeDb, sqlite } from "./helpers/fake-d1.ts";

const Q = [{ role: "user" as const, content: "¿Cómo está BTC?" }];

test("answers are read in every shape these APIs use, without the model's thinking", () => {
  assert.equal(extractChatText({ choices: [{ message: { content: "Hola" } }] }), "Hola");
  assert.equal(extractChatText({ response: "<think>\nveamos\n</think>\n\nBTC está lateral." }), "BTC está lateral.");
  assert.equal(
    extractChatText({ output: [{ type: "reasoning", content: [{ type: "reasoning_text", text: "pienso" }] }, { type: "message", content: [{ type: "output_text", text: "Respuesta" }] }] }),
    "Respuesta",
    "Responses API: only the message, never the reasoning",
  );
  assert.equal(extractChatText({ output_text: "Listo" }), "Listo");
  assert.equal(extractChatText({ result: { response: "Envuelto" } }), "Envuelto");
  assert.equal(extractChatText({ nada: 1 }), "");
  assert.equal(stripThinking("pensando…</think>Al grano"), "Al grano", "a reasoning whose opening tag was cut off");
  assert.deepEqual(usageOf({ usage: { prompt_tokens: 100, completion_tokens: 20 } }), { input: 100, output: 20 });
  assert.deepEqual(usageOf({ usage: { input_tokens: 7, output_tokens: 3 } }), { input: 7, output: 3 });
  assert.equal(usageOf({}), null);
});

test("Cloudflare's price: a usual question costs tens of neurons, so the free share gives dozens a day", () => {
  const one = neuronsFor({ input: 5000, output: 600 });
  assert.ok(one > 20 && one < 60, `${one}`);
  assert.ok(FREE_DAILY_NEURONS / one >= 50, "at least 50 answers a day on the free share");
});

test("the free brain on Workers AI: Qwen3 without thinking out loud; spent allowance and odd answers are told apart", async () => {
  let seen: Record<string, unknown> = {};
  const ok: AiLike = {
    run: async (model, input) => {
      assert.equal(model, WORKERS_MODEL);
      seen = input;
      return { response: "<think>\n\n</think>\n\nBTC lateral.", usage: { prompt_tokens: 900, completion_tokens: 40 } };
    },
  };
  const r = await askWorkersAI(ok, "Reglas", Q);
  assert.deepEqual(r, { ok: true, text: "BTC lateral.", usage: { input: 900, output: 40 } });
  const msgs = seen.messages as { role: string; content: string }[];
  assert.equal(msgs[0].role, "system");
  assert.match(msgs[0].content, /\/no_think$/);
  assert.equal(msgs[1].content, "¿Cómo está BTC?");
  const spent = await askWorkersAI({ run: async () => { throw new Error("AiError: 3036: You have used up your daily free allocation of 10,000 neurons"); } }, "R", Q);
  assert.equal(spent.ok ? null : spent.error, "CUPO GRATIS AGOTADO");
  const odd = await askWorkersAI({ run: async () => ({ algo: 1 }) }, "R", Q);
  assert.deepEqual(odd, { ok: false, error: "RESPUESTA VACÍA", detail: "forma: algo" });
});

test("Groq (OpenAI-compatible): its key, its answer, a spent quota and a rejected key", async () => {
  assert.ok(isGroqKey("gsk_" + "a1B2".repeat(12)));
  assert.ok(!isGroqKey("sk-ant-123"));
  const real = globalThis.fetch;
  let status = 200;
  let auth = "";
  globalThis.fetch = (async (_u: string, init: RequestInit) => {
    auth = String((init.headers as Record<string, string>).Authorization);
    return new Response(JSON.stringify(status === 200 ? { choices: [{ message: { content: "Groq dice" } }], usage: { prompt_tokens: 10, completion_tokens: 2 } } : { error: {} }), { status });
  }) as typeof fetch;
  try {
    assert.deepEqual(await askOpenAICompatible("https://x/v1", "gsk_k", "m", "S", Q), { ok: true, text: "Groq dice", usage: { input: 10, output: 2 } });
    assert.equal(auth, "Bearer gsk_k");
    status = 429;
    assert.deepEqual(await askOpenAICompatible("https://x/v1", "gsk_k", "m", "S", Q), { ok: false, error: "CUPO GRATIS AGOTADO" });
    status = 401;
    assert.deepEqual(await askOpenAICompatible("https://x/v1", "gsk_k", "m", "S", Q), { ok: false, error: "CLAVE GRATIS INVÁLIDA" });
  } finally {
    globalThis.fetch = real;
  }
});

test("the first brain that answers wins; the ones that failed are reported", async () => {
  const r = await firstAnswer([
    { brain: "claude", run: async () => ({ ok: false, error: "ERROR DE LA IA" }) },
    { brain: "groq", run: async () => ({ ok: true, text: "sí", usage: null }) },
    { brain: "cloudflare", run: async () => assert.fail("not reached") },
  ]);
  assert.equal(r.brain, "groq");
  assert.deepEqual(r.tried, [{ brain: "claude", error: "ERROR DE LA IA" }]);
  assert.deepEqual(freeAllowance({ answers: FREE_USER_DAILY, neuronsAll: 0 }), { groq: false, cloudflare: false });
  assert.deepEqual(freeAllowance({ answers: 3, neuronsAll: FREE_DAILY_NEURONS }), { groq: true, cloudflare: false });
});

const claudeOk = (async () => ({ ok: true as const, text: "Claude responde", usage: null })) as unknown as typeof askClaude;
const claudeDown = (async () => ({ ok: false as const, error: "ERROR DE LA IA", status: 502 })) as unknown as typeof askClaude;
const freeAi = (text = "Cloudflare responde"): AiLike => ({ run: async () => ({ response: text, usage: { prompt_tokens: 4000, completion_tokens: 500 } }) });

test("cascade: Claude within the daily quota, then the free brains, counting only the one that answered", { skip: !sqlite }, async () => {
  const db = makeDb();
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const a = await answerWithBrains(db, 7, { claude: "sk-ant", groq: null }, freeAi(), "S", Q, now, claudeOk);
  assert.deepEqual(a.ok && [a.brain, a.text, a.claudeLeft], ["claude", "Claude responde", 24]);
  // Claude's quota used up today: the free brain answers, and its neurons are counted.
  await db.prepare("UPDATE ai_usage SET count = 25 WHERE user_id = 7").run();
  const b = await answerWithBrains(db, 7, { claude: "sk-ant", groq: null }, freeAi(), "S", Q, now, claudeOk);
  assert.deepEqual(b.ok && [b.brain, b.text, b.claudeLeft, b.freeLeft], ["cloudflare", "Cloudflare responde", 0, FREE_USER_DAILY - 1]);
  const row = await db.prepare("SELECT answers, neurons FROM ai_free_usage WHERE day = ?1 AND user_id = 0").bind(day).first<{ answers: number; neurons: number }>();
  assert.equal(row?.answers, 1);
  assert.ok(Math.abs((row?.neurons ?? 0) - neuronsFor({ input: 4000, output: 500 })) < 1e-9);
  // Claude failing (no credit, outage) is no dead end either.
  const c = await answerWithBrains(makeDb(), 8, { claude: "sk-ant", groq: null }, freeAi("libre"), "S", Q, now, claudeDown);
  assert.deepEqual(c.ok && [c.brain, c.text], ["cloudflare", "libre"]);
});

test("cascade: Groq's free key goes before Cloudflare; with every allowance spent, nothing is called", { skip: !sqlite }, async () => {
  const db = makeDb();
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "Groq responde" } }] }))) as typeof fetch;
  try {
    const g = await answerWithBrains(db, 9, { claude: null, groq: "gsk_x" }, freeAi(), "S", Q, now, claudeOk);
    assert.deepEqual(g.ok && g.brain, "groq");
    const row = await db.prepare("SELECT neurons FROM ai_free_usage WHERE day = ?1 AND user_id = 0").bind(day).first<{ neurons: number }>();
    assert.equal(row?.neurons, 0, "Groq's tokens are not Cloudflare's neurons");
  } finally {
    globalThis.fetch = real;
  }
  await db.prepare("UPDATE ai_free_usage SET answers = ?1 WHERE user_id = 9").bind(FREE_USER_DAILY).run();
  const none = await answerWithBrains(db, 9, { claude: null, groq: "gsk_x" }, { run: async () => assert.fail("no call when nothing is left") }, "S", Q, now, claudeOk);
  assert.deepEqual(none, { ok: false, error: "SIN IA POR HOY", tried: [] });
  const spent = await answerWithBrains(makeDb(), 10, { claude: null, groq: null }, { run: async () => { throw new Error("3036"); } }, "S", Q, now, claudeOk);
  assert.deepEqual(spent.ok ? null : spent.error, "SIN IA POR HOY", "the free brain said its allowance was used");
  const down = await answerWithBrains(makeDb(), 11, { claude: null, groq: null }, { run: async () => { throw new Error("boom"); } }, "S", Q, now, claudeOk);
  assert.deepEqual(down.ok ? null : down.error, "LA IA NO RESPONDIÓ");
});

test("deploy check: the free brain is asked once per build, a failure is retried after 30 minutes", { skip: !sqlite }, async () => {
  resetProbe();
  const db = makeDb();
  let calls = 0;
  const failing: AiLike = { run: async () => { calls += 1; throw new Error("AiError: 5007: model busy"); } };
  const p1 = await probeFreeBrain(db, failing, 1_000, "b1");
  assert.equal(p1?.ok, false);
  assert.match(p1?.detail ?? "", /5007/);
  assert.equal(await probeFreeBrain(db, failing, 1_000 + 60_000, "b1"), null, "not every minute");
  const working: AiLike = { run: async () => { calls += 1; return { response: "Listo", usage: { prompt_tokens: 30, completion_tokens: 2 } }; } };
  const p2 = await probeFreeBrain(db, working, 1_000 + 31 * 60_000, "b1");
  assert.equal(p2?.ok, true);
  assert.equal(p2?.text, "Listo");
  assert.equal(await probeFreeBrain(db, working, 1_000 + 40 * 60_000, "b1"), null, "passed: done for this build");
  assert.equal((await readProbe(db))?.ok, true);
  resetProbe();
  assert.equal((await probeFreeBrain(db, working, 2_000_000_000, "b2"))?.build, "b2", "a new deploy is checked again");
  assert.equal(calls, 3);
  resetProbe();
});
