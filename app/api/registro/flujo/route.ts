import { env } from "cloudflare:workers";
import { ensureAuthSchema, getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { abiertasFlujo, evaluarFlujo, registrarLecturaFlujo } from "@/lib/flujo-db";
import { validarLectura } from "@/lib/flujo";

export const dynamic = "force-dynamic";

/**
 * Las operaciones del flujo de órdenes de tu cuenta (PLAN_FLUJO_1, lib/flujo.ts).
 * GET: las que siguen abiertas, para que el navegador las mida con las velas.
 * POST {accion: "lectura", lectura}: una lectura nueva con su plan; una misma media hora no se repite.
 * POST {accion: "evaluar", recorridos}: los recorridos que midió el navegador, revisados; el R lo calcula el servidor.
 * Hace falta sesión: sin ella no hay cuenta donde guardar.
 */
async function usuario(request: Request) {
  await ensureAuthSchema(env.DB);
  const token = getCookie(request, SESSION_COOKIE);
  return token ? getSessionUser(env.DB, token) : null;
}

export async function GET(request: Request) {
  const user = await usuario(request);
  if (!user) return Response.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
  return Response.json({ abiertas: await abiertasFlujo(env.DB, user.id) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const user = await usuario(request);
  if (!user) return Response.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
  let body: { accion?: unknown; lectura?: unknown; recorridos?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "El pedido no es JSON." }, { status: 400 });
  }
  if (body.accion === "lectura") {
    const l = validarLectura(body.lectura, Date.now());
    if (!l) return Response.json({ error: "La lectura no es válida o está fuera de hora." }, { status: 400 });
    const nueva = await registrarLecturaFlujo(env.DB, user.id, l);
    return Response.json({ registrada: nueva, clave: l.clave });
  }
  if (body.accion === "evaluar") {
    return Response.json({ resultados: await evaluarFlujo(env.DB, user.id, body.recorridos) });
  }
  return Response.json({ error: "Acción desconocida." }, { status: 400 });
}
