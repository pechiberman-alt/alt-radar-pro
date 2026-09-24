import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, PBKDF2_ITERATIONS, verifyPassword, WORKERS_PBKDF2_MAX_ITERATIONS } from "../lib/auth.ts";

// Node does not enforce the Workers cap, so a runtime test cannot catch an
// over-cap count; this pins the constant instead. It is the only guard.
test("PBKDF2 stays within the Cloudflare Workers ceiling", () => {
  assert.ok(PBKDF2_ITERATIONS <= WORKERS_PBKDF2_MAX_ITERATIONS, `${PBKDF2_ITERATIONS} > ${WORKERS_PBKDF2_MAX_ITERATIONS}`);
  assert.equal(WORKERS_PBKDF2_MAX_ITERATIONS, 100_000);
});

test("a hashed password verifies, and a wrong one does not", async () => {
  const { hash, salt } = await hashPassword("correcta-123");
  assert.equal(await verifyPassword("correcta-123", hash, salt), true);
  assert.equal(await verifyPassword("otra-cosa-1", hash, salt), false);
});
