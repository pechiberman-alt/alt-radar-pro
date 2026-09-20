/**
 * Web Push: notifications that arrive with the app closed.
 *
 * WHAT CHANGES VERSUS WHAT WAS THERE
 *
 * The existing alerts call the Notification constructor, which only works
 * while a tab is open. That makes them useless for the case that matters —
 * being away from the screen when a level is reached. Web Push is the
 * standard that fixes it: the browser keeps a subscription with its own push
 * service, the service wakes the service worker, and the notification appears
 * whether or not the site is open. It is the same mechanism a chat app uses.
 *
 * WHY THE SIGNING IS DONE BY HAND HERE
 *
 * Push services require a VAPID JWT signed with ES256, and the usual library
 * for this assumes Node's crypto. Workers expose WebCrypto instead, so the
 * token is built directly — it is a small, well-specified piece of work, and
 * pulling in a shim for it would add a dependency to avoid thirty lines.
 *
 * WHAT IS NOT IMPLEMENTED, AND WHY IT IS HONEST TO SAY SO
 *
 * The push PAYLOAD is not encrypted here, so notifications are sent without a
 * body and the service worker fetches the content itself when it wakes. That
 * avoids implementing AES128GCM key agreement, which is where a hand-rolled
 * version would most likely be subtly wrong — and a subtly wrong crypto
 * implementation is worse than none. The trade-off is one extra fetch when a
 * notification arrives.
 */

const B64 = (buffer: ArrayBuffer | Uint8Array): string => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromB64 = (value: string): Uint8Array => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

export type PushSubscriptionRecord = {
  endpoint: string;
  /** Kept for future payload encryption; unused while payloads are empty. */
  p256dh: string;
  auth: string;
};

/**
 * Builds the VAPID Authorization header for one push endpoint.
 *
 * The audience is the origin of the push service, not our own — the token
 * proves to THAT service who is asking it to deliver.
 */
export async function vapidHeader(
  endpoint: string,
  publicKey: string,
  privateKeyPkcs8: string,
  subject: string,
): Promise<string> {
  const audience = new URL(endpoint).origin;
  const header = B64(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = B64(
    new TextEncoder().encode(
      JSON.stringify({
        aud: audience,
        // Twelve hours: push services reject tokens valid for much longer.
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: subject,
      }),
    ),
  );

  const pkcs8 = fromB64(privateKeyPkcs8);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8.buffer.slice(pkcs8.byteOffset, pkcs8.byteOffset + pkcs8.byteLength) as ArrayBuffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );

  return `vapid t=${header}.${payload}.${B64(signature)}, k=${publicKey}`;
}

export type PushResult = {
  endpoint: string;
  ok: boolean;
  /** 404 and 410 mean the subscription is dead and should be deleted. */
  gone: boolean;
  status: number;
};

export async function sendPush(
  subscription: PushSubscriptionRecord,
  publicKey: string,
  privateKeyPkcs8: string,
  subject: string,
  ttlSeconds = 900,
): Promise<PushResult> {
  try {
    const authorization = await vapidHeader(
      subscription.endpoint,
      publicKey,
      privateKeyPkcs8,
      subject,
    );
    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: authorization,
        // An empty payload still needs the length declared.
        "Content-Length": "0",
        // Past this the alert describes a moment that has passed; letting it
        // arrive late would be worse than not arriving.
        TTL: String(ttlSeconds),
        Urgency: "high",
      },
      signal: AbortSignal.timeout(8_000),
    });
    return {
      endpoint: subscription.endpoint,
      ok: response.ok,
      gone: response.status === 404 || response.status === 410,
      status: response.status,
    };
  } catch {
    return { endpoint: subscription.endpoint, ok: false, gone: false, status: 0 };
  }
}

export const PUSH_SCHEMA = `
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;
