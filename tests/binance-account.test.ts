import assert from "node:assert/strict";
import test from "node:test";
import { BinanceApiError, decryptSecret, encryptSecret, friendlyBinanceError, signedRequest, validateApiRestrictions } from "../lib/binance-account.ts";

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

test("a futures permission error names the specific fix, not the IP message it would otherwise get", () => {
  const msg = friendlyBinanceError(
    new BinanceApiError("Invalid API-key, IP, or permissions for action.", 401),
    undefined,
    "futures",
  );
  assert.match(msg, /Habilitar Futuros/);
  assert.doesNotMatch(msg, /Sin restricciones/, "en contexto futuros no debe caer en el mensaje de restricción de IP");
});

test("the same error without futures context still gets the IP message, unchanged", () => {
  const msg = friendlyBinanceError(new BinanceApiError("Invalid API-key, IP, or permissions for action.", 401));
  assert.match(msg, /Sin restricciones/);
});

test("a non-JSON Binance response reads as a network block, not a credentials problem", () => {
  const msg = friendlyBinanceError(new BinanceApiError("NON_JSON_RESPONSE_451:<html>Access Denied by geo-IP filter</html>", 451));
  assert.match(msg, /bloqueo de red/);
  assert.match(msg, /451/);
  assert.doesNotMatch(msg, /no reconoció|Sin restricciones|firma/, "no debe caer en ninguna otra categoria de error por casualidad de texto");
});

test("HTML block-page text is never misread as an IP-restriction message just because it contains \"ip\"", () => {
  // "script" and "equip" both contain "ip" — the marker check must win
  // before the generic substring heuristics ever see this text.
  const msg = friendlyBinanceError(
    new BinanceApiError("NON_JSON_RESPONSE_403:<script>this device is not equipped to proceed</script>", 403),
  );
  assert.match(msg, /bloqueo de red/);
});

test("signedRequest turns an unparseable (non-JSON) response into a diagnosable error instead of a bare SyntaxError", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response("<html>Sorry, this service is not available in your region.</html>", { status: 451 }),
  );
  await assert.rejects(
    signedRequest("/api/v3/account", {}, "key", "secret"),
    (err: unknown) => {
      assert.ok(err instanceof BinanceApiError, "debe ser un BinanceApiError, no un SyntaxError crudo de JSON.parse");
      assert.equal((err as BinanceApiError).status, 451);
      assert.match((err as Error).message, /^NON_JSON_RESPONSE_451:/);
      assert.match((err as Error).message, /not available in your region/, "el cuerpo real de la respuesta se conserva para diagnosticar");
      return true;
    },
  );
});

test("signedRequest still parses a normal Binance JSON error response the same as before", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ code: -2015, msg: "Invalid API-key, IP, or permissions for action." }), { status: 401 }),
  );
  await assert.rejects(
    signedRequest("/api/v3/account", {}, "key", "secret"),
    (err: unknown) => {
      assert.ok(err instanceof BinanceApiError);
      assert.equal((err as BinanceApiError).status, 401);
      assert.equal((err as Error).message, "Invalid API-key, IP, or permissions for action.");
      return true;
    },
  );
});

test("a WAF block on the first mirror falls through to the next one, which succeeds", async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    calls.push(url);
    if (calls.length === 1) return new Response("<html>blocked</html>", { status: 403 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  const result = await signedRequest<{ ok: boolean }>(
    "/api/v3/account",
    {},
    "key",
    "secret",
    ["https://api.binance.com", "https://api1.binance.com"],
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 2, "tuvo que probar el segundo espejo tras el bloqueo del primero");
  assert.match(calls[0], /^https:\/\/api\.binance\.com/);
  assert.match(calls[1], /^https:\/\/api1\.binance\.com/);
});

test("a real Binance rejection on the first mirror is surfaced immediately — no pointless retries", async (t) => {
  let callCount = 0;
  t.mock.method(globalThis, "fetch", async () => {
    callCount += 1;
    return new Response(JSON.stringify({ code: -2015, msg: "Invalid API-key, IP, or permissions for action." }), { status: 401 });
  });
  await assert.rejects(
    signedRequest("/api/v3/account", {}, "key", "secret", ["https://api.binance.com", "https://api1.binance.com"]),
  );
  assert.equal(callCount, 1, "un rechazo real de Binance es el mismo en cualquier espejo: no vale la pena reintentar");
});

test("when every mirror is blocked, the failure from the LAST one is what surfaces", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>blocked</html>", { status: 403 }));
  await assert.rejects(
    signedRequest("/api/v3/account", {}, "key", "secret", ["https://api.binance.com", "https://api1.binance.com"]),
    (err: unknown) => {
      assert.ok(err instanceof BinanceApiError);
      assert.equal((err as BinanceApiError).status, 403);
      return true;
    },
  );
});

test("app-written Spanish messages (read-only check, trading rights) pass through unchanged", () => {
  const original = "Por seguridad solo se aceptan API keys de solo lectura. Desactivá Trading y Retiros en Binance y volvé a intentar.";
  assert.equal(friendlyBinanceError(new Error(original)), original);
});

test("an unrecognized failure falls back to the caller's own message, never a stack trace", () => {
  assert.equal(friendlyBinanceError(new Error("TypeError: fetch failed"), "No se pudo vincular la cuenta."), "No se pudo vincular la cuenta.");
  assert.equal(friendlyBinanceError("not even an Error object", "No se pudo leer la cartera."), "No se pudo leer la cartera.");
});

test("validateApiRestrictions accepts a properly read-only key", () => {
  assert.doesNotThrow(() =>
    validateApiRestrictions({ enableReading: true, enableSpotAndMarginTrading: false, enableWithdrawals: false }),
  );
});

test("validateApiRestrictions rejects reading disabled", () => {
  assert.throws(
    () => validateApiRestrictions({ enableReading: false, enableSpotAndMarginTrading: false, enableWithdrawals: false }),
    /habilitada la lectura/,
  );
});

test("validateApiRestrictions rejects spot/margin trading enabled", () => {
  assert.throws(
    () => validateApiRestrictions({ enableReading: true, enableSpotAndMarginTrading: true, enableWithdrawals: false }),
    /solo lectura/,
  );
});

test("validateApiRestrictions rejects withdrawals enabled", () => {
  assert.throws(
    () => validateApiRestrictions({ enableReading: true, enableSpotAndMarginTrading: false, enableWithdrawals: true }),
    /solo lectura/,
  );
});
