import { env } from "cloudflare:workers";
import { ensureAuthSchema, getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { abiertasSt, evaluarSt, recientesSt, registrarSenalSt } from "@/lib/agente-st-db";
import { validarSenalSt } from "@/lib/agente-st";

export const dynamic = "force-dynamic";

/**
 * Las entradas del agente de papel Supertrend MTF + Volumen de tu cuenta (PLAN_ST_1, lib/agente-st.ts).
 * GET: las que siguen abiertas (para que el navegador las mida con las velas) y las últimas 20 con sus niveles y su foto.
 * POST {accion: "senal", senal}: una entrada nueva con su plan y su foto; una misma moneda y vela no se repite.
 * POST {accion: "evaluar", recorridos}: los recorridos que midió el navegador, revisados; el R lo calcula el servidor.
 * Hace falta sesión: sin ella no hay cuenta donde guardar. Solo papel: no manda órdenes.
 */
async function usuario(request: Request) {
  await ensureAuthSchema(env.DB);
  const token = getCookie(request, SESSION_COOKIE);
  return token ? getSessionUser(env.DB, token) : null;
}

export async function GET(request: Request) {
  const user = await usuario(request);
  if (!user) return Response.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
  return Response.json({ abiertas: await abiertasSt(env.DB, user.id), recientes: await recientesSt(env.DB, user.id) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const user = await usuario(request);
  if (!user) return Response.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
  let body: { accion?: unknown; senal?: unknown; recorridos?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "El pedido no es JSON." }, { status: 400 });
  }
  if (body.accion === "senal") {
    const l = validarSenalSt(body.senal, Date.now());
    if (!l) return Response.json({ error: "La entrada no es válida o está fuera de hora." }, { status: 400 });
    const nueva = await registrarSenalSt(env.DB, user.id, l);
    return Response.json({ registrada: nueva, clave: l.clave });
  }
  if (body.accion === "evaluar") {
    return Response.json({ resultados: await evaluarSt(env.DB, user.id, body.recorridos) });
  }
  return Response.json({ error: "Acción desconocida." }, { status: 400 });
}
