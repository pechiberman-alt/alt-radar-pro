import { env } from "cloudflare:workers";
import { diariosServidor } from "@/lib/aprendizaje-diario-db";
import { ensureAuthSchema, getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { PARES_AGENTES, parValido } from "@/lib/mapa-agentes";
import { posicionesCuenta, posicionesServidor } from "@/lib/mapa-agentes-db";

export const dynamic = "force-dynamic";

/**
 * Los agentes en el par que muestra el mapa de liquidaciones: las posiciones de papel del servidor 24/7 (las mismas para
 * todos, guardadas 5 minutos) y las de tus agentes del navegador (solo con sesión), más el último diario de aprendizaje.
 * Solo lectura y solo papel. Un par en el que no corre ningún agente responde vacío sin tocar la base.
 */
export async function GET(request: Request) {
  const symbol = (new URL(request.url).searchParams.get("symbol") ?? "").toUpperCase();
  if (!parValido(symbol)) return Response.json({ error: "PAR INVÁLIDO" }, { status: 400 });
  const vacio = { symbol, servidor: [], cuenta: null, sesion: false, diario: null };
  if (!PARES_AGENTES.has(symbol) || !env.DB) return Response.json(vacio, { headers: { "Cache-Control": "private, no-store" } });
  const ahora = Date.now();
  await ensureAuthSchema(env.DB);
  const token = getCookie(request, SESSION_COOKIE);
  const user = token ? await getSessionUser(env.DB, token) : null;
  const [servidor, cuenta, diarios] = await Promise.all([
    posicionesServidor(env.DB, symbol, ahora).catch(() => null),
    user ? posicionesCuenta(env.DB, user.id, symbol, ahora).catch(() => null) : Promise.resolve(null),
    diariosServidor(env.DB).catch(() => []),
  ]);
  return Response.json({ symbol, servidor, cuenta, sesion: Boolean(user), diario: diarios[0] ?? null }, { headers: { "Cache-Control": "private, no-store" } });
}
