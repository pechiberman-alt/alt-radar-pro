import { env } from "cloudflare:workers";
import { ensureAuthSchema, getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { leerRegistroUnificado } from "@/lib/registro-db";

export const dynamic = "force-dynamic";

/**
 * El registro unificado de operaciones: el acierto, el profit factor y la expectancia de cada fuente, con su
 * muestra y su intervalo. JARVIS (global) lo ve cualquiera; tu cuenta solo con sesión. Solo lectura, acotada por
 * usuario y con tope por fuente; se guarda un minuto en el navegador.
 */
export async function GET(request: Request) {
  await ensureAuthSchema(env.DB);
  const token = getCookie(request, SESSION_COOKIE);
  const user = token ? await getSessionUser(env.DB, token) : null;
  const registro = await leerRegistroUnificado(env.DB, user?.id ?? null, Date.now());
  return Response.json(registro, { headers: { "Cache-Control": "private, max-age=60" } });
}
