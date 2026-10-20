import { env } from "cloudflare:workers";
import { filasOficina } from "@/lib/agente-st-db";
import { ensureAuthSchema, getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { LIMITE_OFICINA } from "@/lib/oficina";

export const dynamic = "force-dynamic";

/**
 * La oficina del fondo: las últimas entradas de los agentes de papel de tu cuenta (tope LIMITE_OFICINA, por índice), para que la
 * pantalla arme los escritorios con lib/oficina.ts. Se lee al abrir la oficina, no en intervalos. Solo lectura y solo papel.
 */
export async function GET(request: Request) {
  await ensureAuthSchema(env.DB);
  const token = getCookie(request, SESSION_COOKIE);
  const user = token ? await getSessionUser(env.DB, token) : null;
  if (!user) return Response.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
  const filas = await filasOficina(env.DB, user.id, LIMITE_OFICINA);
  return Response.json({ filas }, { headers: { "Cache-Control": "private, no-store" } });
}
