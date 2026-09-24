/**
 * AES-GCM with a base64 32-byte key: iv (12 bytes) + ciphertext, base64.
 * Same format as lib/binance-account.ts, kept separate so app settings do not
 * depend on the module that handles client exchange credentials.
 */
const toB64 = (bytes: Uint8Array) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

async function importKey(keyB64: string) {
  const raw = fromB64(keyB64);
  if (raw.length !== 32) throw new Error("KEY_LENGTH");
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(plain: string, keyB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, await importKey(keyB64), new TextEncoder().encode(plain));
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), 12);
  return toB64(out);
}

export async function open(sealed: string, keyB64: string): Promise<string> {
  const all = fromB64(sealed);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) as BufferSource }, await importKey(keyB64), all.slice(12) as BufferSource);
  return new TextDecoder().decode(pt);
}
