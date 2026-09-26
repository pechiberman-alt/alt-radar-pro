import { open, seal } from "./secret-box.ts";

/**
 * App-level secrets stored in D1, encrypted, so the owner can configure the
 * Telegram bot and the AI key from the app instead of the Cloudflare dashboard.
 *
 * Precedence: a Cloudflare secret, when present, always wins — it is the
 * stronger store (write-only). Values saved from the app are AES-GCM encrypted
 * with ENCRYPTION_KEY when that secret exists ("fuerte"); otherwise with a key
 * the server generates and keeps in D1 ("local"), which protects against a
 * casual look at the table but not against someone with full database access.
 * The settings screen states which one is in use.
 *
 * Each stored value records which key encrypted it, so adding ENCRYPTION_KEY
 * later does not make earlier values unreadable.
 */

export const SETTINGS_SCHEMA =
  "CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)";

export type SecretName = "telegram_bot_token" | "anthropic_api_key";
export type SettingsEnv = { ENCRYPTION_KEY?: string; TELEGRAM_BOT_TOKEN?: string; ANTHROPIC_API_KEY?: string };
export type SecretSource = "cloudflare" | "app" | null;

const ENV_NAME: Record<SecretName, "TELEGRAM_BOT_TOKEN" | "ANTHROPIC_API_KEY"> = {
  telegram_bot_token: "TELEGRAM_BOT_TOKEN",
  anthropic_api_key: "ANTHROPIC_API_KEY",
};

export type Packed = { k: "env" | "local"; c: string };
export const packSecret = (p: Packed) => JSON.stringify(p);
export function unpackSecret(raw: string): Packed | null {
  try {
    const p = JSON.parse(raw) as Partial<Packed>;
    return (p.k === "env" || p.k === "local") && typeof p.c === "string" && p.c ? { k: p.k, c: p.c } : null;
  } catch {
    return null;
  }
}

export function randomKeyBase64(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Compares without stopping at the first differing character. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function ensure(db: D1Database) {
  await db.prepare(SETTINGS_SCHEMA).run();
}
async function read(db: D1Database, key: string) {
  return (await db.prepare("SELECT value FROM app_settings WHERE key = ?1").bind(key).first<{ value: string }>())?.value ?? null;
}
async function write(db: D1Database, key: string, value: string) {
  await db
    .prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3")
    .bind(key, value, new Date().toISOString())
    .run();
}

async function localKey(db: D1Database): Promise<string> {
  const existing = await read(db, "local_key");
  if (existing) return existing;
  await db
    .prepare("INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES ('local_key', ?1, ?2)")
    .bind(randomKeyBase64(), new Date().toISOString())
    .run();
  return (await read(db, "local_key"))!;
}

/**
 * The key any AES-GCM secret in this app is encrypted with: the Cloudflare
 * secret when set, otherwise the same auto-generated local key `localKey`
 * already uses for Telegram and the AI key — one key, one fallback path,
 * shared by every feature that stores a secret this way (Binance included).
 */
export async function resolveEncryptionKey(db: D1Database, env: SettingsEnv): Promise<string> {
  return env.ENCRYPTION_KEY ?? (await localKey(db));
}

export function encryptionStrength(env: SettingsEnv): "fuerte" | "local" {
  return env.ENCRYPTION_KEY ? "fuerte" : "local";
}

const cache = new Map<SecretName, { value: string | null; at: number }>();

export async function getSecret(db: D1Database, env: SettingsEnv, name: SecretName): Promise<{ value: string | null; source: SecretSource }> {
  const fromEnv = env[ENV_NAME[name]];
  if (fromEnv) return { value: fromEnv, source: "cloudflare" };
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < 60_000) return { value: hit.value, source: hit.value ? "app" : null };
  await ensure(db);
  const raw = await read(db, `secret:${name}`);
  const packed = raw ? unpackSecret(raw) : null;
  let value: string | null = null;
  if (packed) {
    try {
      const key = packed.k === "env" ? env.ENCRYPTION_KEY : await localKey(db);
      if (key) value = await open(packed.c, key);
    } catch {
      value = null;
    }
  }
  cache.set(name, { value, at: Date.now() });
  return { value, source: value ? "app" : null };
}

export async function setSecret(db: D1Database, env: SettingsEnv, name: SecretName, plain: string) {
  await ensure(db);
  const k: Packed["k"] = env.ENCRYPTION_KEY ? "env" : "local";
  const key = k === "env" ? env.ENCRYPTION_KEY! : await localKey(db);
  const c = await seal(plain, key);
  await write(db, `secret:${name}`, packSecret({ k, c }));
  cache.delete(name);
}

export async function deleteSecret(db: D1Database, name: SecretName) {
  await ensure(db);
  await db.prepare("DELETE FROM app_settings WHERE key = ?1").bind(`secret:${name}`).run();
  cache.delete(name);
}

export async function adminUserId(db: D1Database): Promise<number | null> {
  await ensure(db);
  const v = await read(db, "admin_user_id");
  return v ? Number(v) : null;
}

/** One-time admin claim with a code placed in the database by the owner. */
export async function claimAdmin(db: D1Database, userId: number, code: string): Promise<"ok" | "taken" | "bad-code"> {
  await ensure(db);
  if (await read(db, "admin_user_id")) return "taken";
  const expected = await read(db, "admin_claim_code");
  if (!expected || !safeEqual(expected, code.trim())) return "bad-code";
  await write(db, "admin_user_id", String(userId));
  await db.prepare("DELETE FROM app_settings WHERE key = 'admin_claim_code'").run();
  return "ok";
}

export async function hasClaimCode(db: D1Database) {
  await ensure(db);
  return Boolean(await read(db, "admin_claim_code"));
}
