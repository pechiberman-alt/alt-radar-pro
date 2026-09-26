import assert from "node:assert/strict";
import test from "node:test";
import { BinanceApiError, decryptSecret, encryptSecret, friendlyBinanceError } from "../lib/binance-account.ts";

/** Same minimal fake used in app-settings.test.ts: one key/value table. */
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

test("a Binance credential round-trips through encrypt/decrypt with no Cloudflare secret", async () => {
  const db = fakeD1();
  const sealed = await encryptSecret("api-key-abc123", db, {});
  assert.notEqual(sealed, "api-key-abc123");
  assert.equal(await decryptSecret(sealed, db, {}), "api-key-abc123");
});

test("linking never throws ENCRYPTION_KEY_MISSING: it always resolves a key, Cloudflare or local", async () => {
  // This is the exact bug this fix closes: encryptSecret used to require
  // env.ENCRYPTION_KEY and throw when absent, so the very first person to
  // link an account with no Cloudflare secret configured saw that raw error
  // string. It must now succeed silently with the local fallback.
  const db = fakeD1();
  await assert.doesNotReject(encryptSecret("secret-value", db, {}));
});

test("a stored credential still decrypts after a Cloudflare secret is later added", async () => {
  const db = fakeD1();
  const sealed = await encryptSecret("api-key-xyz", db, {});
  // Adding ENCRYPTION_KEY later must not orphan values encrypted under the
  // local key — decryptSecret has to keep resolving the same local key for
  // values it, not the new Cloudflare secret, actually encrypted.
  await assert.doesNotReject(decryptSecret(sealed, db, {}));
});

test("an IP restriction error explains Unrestricted access is required, not a fixed IP", () => {
  const msg = friendlyBinanceError(new BinanceApiError("Invalid API-key, IP, or permissions for action.", 401));
  assert.match(msg, /Sin restricciones/);
  assert.doesNotMatch(msg, /IP, or permissions/, "el mensaje crudo de Binance no se filtra al usuario");
});

test("an invalid key/secret gets a plain explanation, not Binance's raw text", () => {
  const msg = friendlyBinanceError(new BinanceApiError("API-key format invalid.", 401));
  assert.match(msg, /no reconoció/);
});

test("app-written Spanish messages (read-only check, trading rights) pass through unchanged", () => {
  const original = "Por seguridad solo se aceptan API keys de solo lectura. Desactivá Trading y Retiros en Binance y volvé a intentar.";
  assert.equal(friendlyBinanceError(new Error(original)), original);
});

test("an unrecognized failure falls back to the caller's own message, never a stack trace", () => {
  assert.equal(friendlyBinanceError(new Error("TypeError: fetch failed"), "No se pudo vincular la cuenta."), "No se pudo vincular la cuenta.");
  assert.equal(friendlyBinanceError("not even an Error object", "No se pudo leer la cartera."), "No se pudo leer la cartera.");
});
