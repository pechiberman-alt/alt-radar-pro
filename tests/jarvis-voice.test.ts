import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_NEURAL, NEURAL_VOICES, neuralVoice, PREMIUM_DAILY_CHARS, USER_DAILY_CHARS } from "../lib/jarvis-voice.ts";
import { addUsage, allowance, audioBytes, AURA, cacheKey, MELO, synthesize, usageToday, type AiLike } from "../lib/jarvis-voice-server.ts";

const sqlite = await import("node:sqlite").catch(() => null);
function makeDb() {
  const sql = new sqlite!.DatabaseSync(":memory:");
  const stmt = (q: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(q, a),
    run: async () => ({ meta: { changes: Number(sql.prepare(q).run(...(args as never[])).changes) } }),
    first: async () => sql.prepare(q).get(...(args as never[])) ?? null,
    all: async () => ({ results: sql.prepare(q).all(...(args as never[])) }),
  });
  return { prepare: (q: string) => stmt(q) } as never as D1Database;
}
const mp3 = new Uint8Array(200).fill(7);

test("voices: Cloudflare's Aura-2 Spanish catalog, Latin American defaults, unknown ids fall back", () => {
  assert.equal(NEURAL_VOICES.length, 10);
  assert.equal(neuralVoice(DEFAULT_NEURAL.male).accent, "México");
  assert.equal(neuralVoice(DEFAULT_NEURAL.female).accent, "Latinoamérica");
  assert.equal(neuralVoice("no-existe").id, "sirio");
  assert.ok(PREMIUM_DAILY_CHARS * 2.727 < 10_000, "premium stays inside the 10.000 free neurons a day");
});

test("synthesis: premium voice first; the simpler one if premium fails or is not allowed; null if neither", async () => {
  const calls: string[] = [];
  const ok: AiLike = {
    run: async (model, input) => {
      calls.push(`${model}:${JSON.stringify(input)}`);
      return model === AURA ? new Response(mp3) : { audio: btoa(String.fromCharCode(...mp3)) };
    },
  };
  const a = await synthesize(ok, "hola", "sirio", true);
  assert.equal(a?.model, "aura");
  assert.match(calls[0], /"speaker":"sirio","encoding":"mp3"/);
  const m = await synthesize(ok, "hola", "sirio", false);
  assert.equal(m?.model, "melo", "premium not allowed: the simpler voice");
  assert.deepEqual([...(m?.audio ?? [])].slice(0, 3), [7, 7, 7], "base64 audio decoded");
  const premiumDown: AiLike = { run: async (model) => (model === AURA ? Promise.reject(new Error("3036: daily limit")) : new Uint8Array(mp3)) };
  assert.equal((await synthesize(premiumDown, "hola", "sirio", true))?.model, "melo");
  const allDown: AiLike = { run: async () => Promise.reject(new Error("down")) };
  assert.equal(await synthesize(allDown, "hola", "sirio", true), null);
  assert.equal(await audioBytes(new Response("x", { status: 500 })), null, "an error response is not audio");
  assert.equal(MELO, "@cf/myshell-ai/melotts");
});

test("allowance: per person and premium for everyone, per UTC day", { skip: !sqlite }, async () => {
  const db = makeDb();
  const day = "2026-10-07";
  assert.deepEqual(await usageToday(db, day, 1), { user: 0, premiumAll: 0 });
  await addUsage(db, day, 1, 1000, true);
  await addUsage(db, day, 2, 2000, true);
  await addUsage(db, day, 1, 500, false);
  const u1 = await usageToday(db, day, 1);
  assert.deepEqual(u1, { user: 1500, premiumAll: 3000 });
  assert.deepEqual(allowance(u1, 200), { allowed: true, premium: true, reason: "OK" });
  assert.deepEqual(allowance(u1, 400), { allowed: true, premium: false, reason: "OK" }, "premium budget for the day would be passed: simpler voice");
  assert.deepEqual(allowance({ user: USER_DAILY_CHARS - 10, premiumAll: 0 }, 50), { allowed: false, premium: false, reason: "CUPO PERSONAL" });
  assert.deepEqual(await usageToday(db, "2026-10-08", 1), { user: 0, premiumAll: 0 }, "a new day starts clean");
  await addUsage(db, "2026-10-12", 1, 1, false);
  assert.deepEqual(await usageToday(db, day, 1), { user: 0, premiumAll: 0 }, "days older than 3 are deleted");
});

test("cache keys: same text and voice share audio; voices and models do not", async () => {
  assert.equal(await cacheKey("aura", "sirio", "hola"), await cacheKey("aura", "sirio", "hola"));
  assert.notEqual(await cacheKey("aura", "sirio", "hola"), await cacheKey("aura", "selena", "hola"));
  assert.notEqual(await cacheKey("aura", "sirio", "hola"), await cacheKey("melo", "sirio", "hola"));
  assert.equal(await cacheKey("melo", "sirio", "hola"), await cacheKey("melo", "selena", "hola"), "the simpler voice has one speaker");
});
