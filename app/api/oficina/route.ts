import { env } from "cloudflare:workers";
import { filasOficina } from "@/lib/agente-st-db";
import { ensureAuthSchema, getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { LIMITE_OFICINA } from "@/lib/oficina";
import { lecturaServidor } from "@/lib/oficina-db";
import { diariosServidor } from "@/lib/aprendizaje-diario-db";

export const dynamic = "force-dynamic";

/**
 * La oficina del fondo. `servidor`: los agentes 24/7 (globales, los ve cualquiera; la misma lectura cada 5 minutos para todos).
 * `cuenta`: las últimas entradas de tus agentes del navegador (con sesión; null sin ella). Se lee al abrir, no en intervalos.
 * `diarios`: el aprendizaje diario guardado del servidor (lib/aprendizaje-diario-db.ts), los últimos 7 días.
 * Solo lectura y solo papel.
 */
export async function GET(request: Request) {
  await ensureAuthSchema(env.DB);
  const token = getCookie(request, SESSION_COOKIE);
  const user = token ? await getSessionUser(env.DB, token) : null;
  const [servidor, cuenta, diarios] = await Promise.all([
    lecturaServidor(env.DB).catch(() => null),
    user ? filasOficina(env.DB, user.id, LIMITE_OFICINA).catch(() => null) : Promise.resolve(null),
    diariosServidor(env.DB).catch(() => []),
  ]);
  return Response.json({ servidor, cuenta, sesion: Boolean(user), diarios }, { headers: { "Cache-Control": "private, no-store" } });
}
