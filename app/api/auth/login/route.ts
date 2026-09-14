import { env } from "cloudflare:workers";
import { createSession, ensureAuthSchema, sessionCookieHeader, verifyPassword } from "@/lib/auth";

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
    if (!email || !password) {
      return Response.json({ error: "Falta email o contraseña." }, { status: 400 });
    }

    const user = await env.DB.prepare(
      "SELECT id, password_hash, password_salt FROM users WHERE email = ?1",
    )
      .bind(email)
      .first<{ id: number; password_hash: string; password_salt: string }>();

    // Same error for "no existe" and "contraseña incorrecta": don't leak
    // which emails are registered.
    const invalid = () => Response.json({ error: "Email o contraseña incorrectos." }, { status: 401 });
    if (!user) return invalid();

    const valid = await verifyPassword(password, user.password_hash, user.password_salt);
    if (!valid) return invalid();

    const session = await createSession(env.DB, user.id);
    return Response.json(
      { ok: true, email },
      { headers: { "Set-Cookie": sessionCookieHeader(session.token, session.expiresAt) } },
    );
  } catch (error) {
    console.error("[ALT_RADAR_LOGIN]", error);
    return Response.json({ error: "NO SE PUDO INICIAR SESIÓN" }, { status: 500 });
  }
}
