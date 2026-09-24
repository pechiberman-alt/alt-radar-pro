/**
 * Per-client authentication: email + password, isolated by user_id.
 * Passwords are never stored in plain text — only a PBKDF2 hash + salt.
 * Sessions are opaque random tokens kept in D1, not JWTs, so a session
 * can be revoked instantly by deleting its row.
 */

/**
 * Cloudflare Workers (workerd) refuses PBKDF2 above 100,000 iterations with
 * "NotSupportedError: iteration counts above 100000 are not supported". Node,
 * wrangler dev and Miniflare do not enforce it, so 120,000 passed every local
 * test while registration and login returned 500 for every real user — the
 * database had zero accounts because none could ever be created.
 *
 * Never raise PBKDF2_ITERATIONS above the ceiling; a test pins it. The margin
 * that matters against guessing is rate limiting and keeping D1 private.
 */
export const WORKERS_PBKDF2_MAX_ITERATIONS = 100_000;
export const PBKDF2_ITERATIONS = 100_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_COOKIE = "ar_session";

export async function ensureAuthSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS binance_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      api_key_encrypted TEXT NOT NULL,
      api_secret_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
  ]);
}

function toBase64(bytes: ArrayBuffer | Uint8Array) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of arr) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return toBase64(bits);
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  return { hash, salt: toBase64(salt) };
}

export async function verifyPassword(password: string, hash: string, salt: string) {
  const computed = await pbkdf2(password, fromBase64(salt));
  return timingSafeEqual(computed, hash);
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSession(db: D1Database, userId: number) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db
    .prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?1, ?2, ?3)")
    .bind(token, userId, expiresAt)
    .run();
  return { token, expiresAt };
}

export async function destroySession(db: D1Database, token: string) {
  await db.prepare("DELETE FROM sessions WHERE token = ?1").bind(token).run();
}

export async function getSessionUser(db: D1Database, token: string) {
  const row = await db
    .prepare(
      `SELECT users.id AS id, users.email AS email, sessions.expires_at AS expiresAt
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token = ?1`,
    )
    .bind(token)
    .first<{ id: number; email: string; expiresAt: string }>();
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    await destroySession(db, token);
    return null;
  }
  return { id: row.id, email: row.email };
}

export function getCookie(request: Request, name: string) {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function sessionCookieHeader(token: string, expiresAt: string) {
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearedSessionCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
