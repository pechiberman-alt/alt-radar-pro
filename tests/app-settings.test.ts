import assert from "node:assert/strict";
import test from "node:test";
import { packSecret, randomKeyBase64, resolveEncryptionKey, safeEqual, unpackSecret } from "../lib/app-settings.ts";
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

/**
 * Minimal in-memory stand-in for the one table app-settings.ts touches
 * (key/value app_settings), just enough SQL support for its own queries:
 * SELECT value WHERE key = ?1, INSERT ... ON CONFLICT DO UPDATE, and
 * INSERT OR IGNORE. Real D1 semantics elsewhere are not modeled.
 */
function fakeD1() {
  const rows = new Map<string, string>();
  return {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const api = {
        bind(...args: unknown[]) {
          bound = args;
          return api;
        },
        async run() {
          if (sql.startsWith("CREATE TABLE")) return;
          if (sql.includes("INSERT OR IGNORE")) {
            const [value] = bound as [string];
            if (!rows.has("local_key")) rows.set("local_key", value);
            return;
          }
          if (sql.includes("ON CONFLICT")) {
            const [key, value] = bound as [string, string];
            rows.set(key, value);
            return;
          }
          throw new Error(`fakeD1: unhandled run() for: ${sql}`);
        },
        async first<T>() {
          if (sql.startsWith("SELECT value FROM app_settings WHERE key")) {
            const [key] = bound as [string];
            return rows.has(key) ? ({ value: rows.get(key) } as T) : null;
          }
          throw new Error(`fakeD1: unhandled first() for: ${sql}`);
        },
      };
      return api;
    },
  } as unknown as D1Database;
}

test("with no Cloudflare secret, resolveEncryptionKey generates and reuses one local key", async () => {
  const db = fakeD1();
  const a = await resolveEncryptionKey(db, {});
  const b = await resolveEncryptionKey(db, {});
  assert.equal(a, b, "el mismo local_key se reutiliza, no se regenera en cada llamada");
  assert.equal(atob(a).length, 32);
});

test("a Cloudflare ENCRYPTION_KEY always wins over the local one", async () => {
  const db = fakeD1();
  await resolveEncryptionKey(db, {}); // seeds a local key first
  const withEnv = await resolveEncryptionKey(db, { ENCRYPTION_KEY: "env-key-value" });
  assert.equal(withEnv, "env-key-value");
});

test("two independent stores never share a local key", async () => {
  const a = await resolveEncryptionKey(fakeD1(), {});
  const b = await resolveEncryptionKey(fakeD1(), {});
  assert.notEqual(a, b);
});
