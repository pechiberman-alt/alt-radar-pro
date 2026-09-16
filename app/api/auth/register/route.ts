import { env } from "cloudflare:workers";
import {
  createSession,
  ensureAuthSchema,
  hashPassword,
  isValidEmail,
  sessionCookieHeader,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!env.DB) throw new Error("D1_UNAVAILABLE");
    await ensureAuthSchema(env.DB);

    const body = (await request.json().catch(() => null)) as
      | { email?: string; password?: string }
      | null;
    const email = body?.email?.trim().toLowerCase();
    const password = body?.password;

    if (!email || !isValidEmail(email)) {
      return Response.json({ error: "EMAIL_INVALIDO" }, { status: 400 });
    }
    if (!password || password.length < 8) {
      return Response.json(
        { error: "La contraseña debe tener al menos 8 caracteres." },
        { status: 400 },
      );
    }

    // Preflight check: a fast, friendly path for the common case. Not
    // authoritative on its own — two concurrent registrations for the same
    // email could both pass this and race to the insert below, so the
    // UNIQUE constraint on `email` is the real guard (caught below).
    const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?1")
      .bind(email)
      .first();
    if (existing) {
      return Response.json({ error: "Ya existe una cuenta con ese email." }, { status: 409 });
    }

    const { hash, salt } = await hashPassword(password);
    let inserted: { id: number } | null;
    try {
      inserted = await env.DB.prepare(
        "INSERT INTO users (email, password_hash, password_salt) VALUES (?1, ?2, ?3) RETURNING id",
      )
        .bind(email, hash, salt)
        .first<{ id: number }>();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("UNIQUE constraint failed")) {
        return Response.json({ error: "Ya existe una cuenta con ese email." }, { status: 409 });
      }
      throw error;
    }
    if (!inserted) throw new Error("INSERT_FAILED");

    const session = await createSession(env.DB, inserted.id);

    return Response.json(
      { ok: true, email },
      { headers: { "Set-Cookie": sessionCookieHeader(session.token, session.expiresAt) } },
    );
  } catch (error) {
    console.error("[ALT_RADAR_REGISTER]", error);
    return Response.json({ error: "NO SE PUDO CREAR LA CUENTA" }, { status: 500 });
  }
}
