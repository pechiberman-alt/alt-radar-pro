import assert from "node:assert/strict";
import test from "node:test";
import { dropShared, sharedJson } from "../lib/shared-cache.ts";

test("one database read per TTL however many requests; a drop forces the next read", async () => {
  let reads = 0;
  const load = async () => ({ n: ++reads });
  const t0 = 1_000_000;
  assert.deepEqual(await sharedJson("k", 300, load, t0), { n: 1 });
  for (let i = 0; i < 50; i += 1) assert.deepEqual(await sharedJson("k", 300, load, t0 + i * 1000), { n: 1 });
  assert.equal(reads, 1);
  assert.deepEqual(await sharedJson("k", 300, load, t0 + 301_000), { n: 2 }, "expired");
  await dropShared("k");
  assert.deepEqual(await sharedJson("k", 300, load, t0 + 302_000), { n: 3 }, "dropped after a write");
  assert.deepEqual(await sharedJson("other", 300, load, t0), { n: 4 }, "keys are separate");
});
