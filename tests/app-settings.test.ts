import assert from "node:assert/strict";
import test from "node:test";
import { packSecret, randomKeyBase64, safeEqual, unpackSecret } from "../lib/app-settings.ts";
import { open, seal } from "../lib/secret-box.ts";

test("a generated key is 32 bytes of base64 and usable for AES-GCM", async () => {
  const key = randomKeyBase64();
  assert.equal(atob(key).length, 32);
  const c = await seal("123456:AAH-token", key);
  assert.notEqual(c, "123456:AAH-token");
  assert.equal(await open(c, key), "123456:AAH-token");
});

test("a value encrypted with one key does not open with another", async () => {
  const c = await seal("secreto", randomKeyBase64());
  await assert.rejects(open(c, randomKeyBase64()));
});

test("stored values remember which key encrypted them", () => {
  const raw = packSecret({ k: "local", c: "abc" });
  assert.deepEqual(unpackSecret(raw), { k: "local", c: "abc" });
  assert.equal(unpackSecret("not json"), null);
  assert.equal(unpackSecret(JSON.stringify({ k: "other", c: "x" })), null);
  assert.equal(unpackSecret(JSON.stringify({ k: "env", c: "" })), null);
});

test("claim codes compare exactly", () => {
  assert.equal(safeEqual("abc123", "abc123"), true);
  assert.equal(safeEqual("abc123", "abc124"), false);
  assert.equal(safeEqual("abc", "abc123"), false);
});
