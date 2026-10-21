import { env } from "cloudflare:workers";
import { createSession, ensureAuthSchema, fakeVerify, sessionCookieHeader, verifyPassword } from "@/lib/auth";
import { borrarIntentos, claveIntento, esperaSeg, ipDe, leerIntentos, MAX_FALLAS_EMAIL, MAX_FALLAS_IP, MAX_LARGO_CLAVE, sumarIntento, superado, VENTANA_LOGIN_MS } from "@/lib/auth-limites";

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
    if (!email || !password || typeof password !== "string") {
      return Response.json({ error: "Falta email o contraseña." }, { status: 400 });
    }
    if (password.length > MAX_LARGO_CLAVE || email.length > 254) {
      return Response.json({ error: "Email o contraseña incorrectos." }, { status: 401 });
    }

    // Demasiadas fallas para ese email o desde esa IP: esperar (lib/auth-limites.ts).
    const ahora = Date.now();
    const [kEmail, kIp] = await Promise.all([claveIntento("email", email), claveIntento("ip", ipDe(request))]);
    const intentos = await leerIntentos(env.DB, [kEmail, kIp]);
    const tapado = superado(intentos.get(kEmail), MAX_FALLAS_EMAIL, VENTANA_LOGIN_MS, ahora)
      ? intentos.get(kEmail)
      : superado(intentos.get(kIp), MAX_FALLAS_IP, VENTANA_LOGIN_MS, ahora)
        ? intentos.get(kIp)
        : null;
    if (tapado) {
      const espera = esperaSeg(tapado, VENTANA_LOGIN_MS, ahora);
      return Response.json(
        { error: `Demasiados intentos. Probá de nuevo en ${Math.ceil(espera / 60)} minutos.` },
        { status: 429, headers: { "Retry-After": String(espera) } },
      );
    }

    const user = await env.DB.prepare(
      "SELECT id, password_hash, password_salt FROM users WHERE email = ?1",
    )
      .bind(email)
      .first<{ id: number; password_hash: string; password_salt: string }>();

    // Same error for "no existe" and "contraseña incorrecta": don't leak
    // which emails are registered.
    const invalid = async () => {
      await sumarIntento(env.DB!, [kEmail, kIp], VENTANA_LOGIN_MS, ahora);
      return Response.json({ error: "Email o contraseña incorrectos." }, { status: 401 });
    };
    // Sin cuenta, el mismo trabajo que con cuenta: el tiempo de respuesta no dice qué emails existen.
    if (!user) {
      await fakeVerify(password);
      return invalid();
    }

    const valid = await verifyPassword(password, user.password_hash, user.password_salt);
    if (!valid) return invalid();

    await borrarIntentos(env.DB, kEmail);
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
