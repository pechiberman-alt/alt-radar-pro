import assert from "node:assert/strict";
import test from "node:test";
import { cached, clearUpstreamCache } from "../lib/upstream-cache.ts";

test("first read loads, second is served from cache", async () => {
  clearUpstreamCache();
  let calls = 0;
  const load = async () => {
    calls += 1;
    return { value: calls };
  };

  const first = await cached("k", 60_000, load);
  const second = await cached("k", 60_000, load);

  assert.equal(first.state, "MISS");
  assert.equal(second.state, "HIT");
  assert.equal(calls, 1, "la segunda lectura no debe llamar al origen");
  assert.deepEqual(second.value, first.value);
});

test("concurrent readers coalesce into one upstream call", async () => {
  clearUpstreamCache();
  let calls = 0;
  const load = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { ok: true };
  };

  const results = await Promise.all([
    cached("k", 60_000, load),
    cached("k", 60_000, load),
    cached("k", 60_000, load),
    cached("k", 60_000, load),
  ]);

  assert.equal(calls, 1, "cuatro lectores simultáneos deben producir una sola llamada");
  assert.ok(results.every((result) => result.value !== null));
  assert.equal(results.filter((r) => r.state === "COALESCED").length, 3);
});

test("an expired entry is refreshed", async () => {
  clearUpstreamCache();
  let calls = 0;
  const load = async () => {
    calls += 1;
    return { call: calls };
  };

  await cached("k", 1, load);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = await cached("k", 1, load);

  assert.equal(calls, 2);
  assert.equal(second.state, "MISS");
  assert.deepEqual(second.value, { call: 2 });
});

/** The behaviour that keeps panels alive through a rate limit. */
test("a failing loader falls back to the stale value", async () => {
  clearUpstreamCache();
  let shouldFail = false;
  const load = async () => {
    if (shouldFail) throw new Error("418");
    return { good: true };
  };

  await cached("k", 1, load);
  await new Promise((resolve) => setTimeout(resolve, 10));
  shouldFail = true;
  const result = await cached("k", 1, load, 60_000);

  assert.equal(result.state, "STALE");
  assert.deepEqual(result.value, { good: true });
  assert.ok(result.ageMs > 0, "debe informar la antigüedad del dato");
});

test("a loader returning null falls back to stale too", async () => {
  clearUpstreamCache();
  let returnNull = false;
  const load = async () => (returnNull ? null : { good: true });

  await cached("k", 1, load);
  await new Promise((resolve) => setTimeout(resolve, 10));
  returnNull = true;
  const result = await cached("k", 1, load, 60_000);

  assert.equal(result.state, "STALE");
  assert.deepEqual(result.value, { good: true });
});

test("nothing is served once the stale window closes", async () => {
  clearUpstreamCache();
  let shouldFail = false;
  const load = async () => {
    if (shouldFail) throw new Error("down");
    return { good: true };
  };

  await cached("k", 1, load);
  await new Promise((resolve) => setTimeout(resolve, 15));
  shouldFail = true;
  const result = await cached("k", 1, load, 5);

  assert.equal(result.value, null, "un dato demasiado viejo no debe presentarse como válido");
});

test("keys are isolated from each other", async () => {
  clearUpstreamCache();
  const a = await cached("a", 60_000, async () => "valor-a");
  const b = await cached("b", 60_000, async () => "valor-b");
  assert.equal(a.value, "valor-a");
  assert.equal(b.value, "valor-b");
  assert.equal((await cached("a", 60_000, async () => "otro")).value, "valor-a");
});

test("a first-time failure reports nothing rather than inventing", async () => {
  clearUpstreamCache();
  const result = await cached("nuevo", 60_000, async () => {
    throw new Error("sin datos");
  });
  assert.equal(result.value, null);
});
