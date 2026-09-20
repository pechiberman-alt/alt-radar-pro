import assert from "node:assert/strict";
import test from "node:test";
import { sendPush, vapidHeader, PUSH_SCHEMA } from "../lib/web-push.ts";

// A throwaway pair, generated for the assertions below only.
const PUBLIC =
  "BAogyihF-Aut41_tnAEe1oxqAwTPYZQl_eWAgBvruFeZb1riABC3Nes1bu2NIkNg3bodTcUye_CgVhCmIAGOclY";
const PRIVATE =
  "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgDsyyWvrIP6fse2uYT5RCEe_mwVhK9lalLBE5cznA71ChRANCAAQKIMooRfgLreNf7ZwBHtaMagMEz2GUJf3lgIAb67hXmW9a4gAQtzXrNW7tjSJDYN26HU3FMnvwoFYQpiABjnJW";

const decodeSegment = (segment: string) =>
  JSON.parse(
    Buffer.from(
      segment.replace(/-/g, "+").replace(/_/g, "/") +
        "=".repeat((4 - (segment.length % 4)) % 4),
      "base64",
    ).toString(),
  );

test("the VAPID token is addressed to the push service, not to us", async () => {
  const header = await vapidHeader(
    "https://fcm.googleapis.com/fcm/send/abc123",
    PUBLIC,
    PRIVATE,
    "mailto:radar@url.fx",
  );
  const token = header.match(/t=([^,]+)/)?.[1] ?? "";
  const [, payload] = token.split(".");
  const claims = decodeSegment(payload);
  assert.equal(
    claims.aud,
    "https://fcm.googleapis.com",
    "el token prueba ante ESE servicio quién pide la entrega",
  );
  assert.equal(claims.sub, "mailto:radar@url.fx");
});

test("a different endpoint host produces a different audience", async () => {
  const a = await vapidHeader("https://fcm.googleapis.com/x", PUBLIC, PRIVATE, "mailto:a@b.c");
  const b = await vapidHeader(
    "https://updates.push.services.mozilla.com/x",
    PUBLIC,
    PRIVATE,
    "mailto:a@b.c",
  );
  assert.notEqual(a, b, "reusar un token entre servicios lo haría rechazar");
});

test("the token expires within the window push services accept", async () => {
  const header = await vapidHeader("https://fcm.googleapis.com/x", PUBLIC, PRIVATE, "mailto:a@b.c");
  const claims = decodeSegment((header.match(/t=([^,]+)/)?.[1] ?? "").split(".")[1]);
  const hoursAhead = (claims.exp - Math.floor(Date.now() / 1000)) / 3600;
  assert.ok(hoursAhead > 0 && hoursAhead <= 24, `expira en ${hoursAhead}h`);
});

test("the header carries the public key the subscription was made with", async () => {
  const header = await vapidHeader("https://fcm.googleapis.com/x", PUBLIC, PRIVATE, "mailto:a@b.c");
  assert.match(header, new RegExp(`k=${PUBLIC.replace(/[-]/g, "\\$&")}`));
});

test("an unreachable endpoint fails without throwing", async () => {
  const result = await sendPush(
    { endpoint: "https://127.0.0.1:1/nope", p256dh: "x", auth: "y" },
    PUBLIC,
    PRIVATE,
    "mailto:a@b.c",
  );
  assert.equal(result.ok, false);
  assert.equal(result.gone, false, "un fallo de red no es una suscripción muerta");
  assert.equal(result.status, 0);
});

test("the schema is idempotent so a cron can run it every time", () => {
  assert.match(PUSH_SCHEMA, /CREATE TABLE IF NOT EXISTS push_subscriptions/);
  assert.match(PUSH_SCHEMA, /endpoint TEXT PRIMARY KEY/, "una suscripción no se duplica");
});
