import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { aprobarGuardada, ensureSombraSchema, guardarCorrida, leerSombra, listarEventos, revocarGuardada } from "@/lib/mesa-sombra-db";

export const dynamic = "force-dynamic";

/**
 * Laboratorio en sombra de la mesa, por cuenta. Simulado: no toca ningún
 * exchange ni clave. GET trae el estado y los últimos eventos de la auditoría.
 * POST guarda una corrida (accion "guardar"), o aprueba / revoca una variante
 * a pedido explícito de la persona (accion "aprobar" | "revocar", confirmo: true).
 */
async function who(request: NextRequest) {
  const session = getCookie(request, SESSION_COOKIE);
  return session && env.DB ? getSessionUser(env.DB, session) : null;
}

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const user = await who(request);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });
  try {
    await ensureSombraSchema(env.DB);
    // La compuerta del papel solo necesita la variante aprobada: una fila, sin la auditoría.
    if (request.nextUrl.searchParams.get("solo") === "estado") {
      const g = await leerSombra(env.DB, user.id);
      return NextResponse.json({ estado: g.estado }, { headers: NO_STORE });
    }
    const [g, eventos] = await Promise.all([leerSombra(env.DB, user.id), listarEventos(env.DB, user.id)]);
    return NextResponse.json({ estado: g.estado, seq: g.seq, eventos }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "No se pudo leer el laboratorio." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await who(request);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });
  try {
    const body = (await request.json().catch(() => null)) as { accion?: string; estado?: unknown; eventos?: unknown; indice?: unknown; motivo?: unknown; confirmo?: unknown } | null;
    if (!body) return NextResponse.json({ error: "Pedido vacío." }, { status: 400 });
    await ensureSombraSchema(env.DB);
    const ahora = Date.now();
    let r;
    if (body.accion === "guardar") r = await guardarCorrida(env.DB, user.id, body.estado, body.eventos, ahora);
    else if (body.accion === "aprobar" || body.accion === "revocar") {
      if (body.confirmo !== true) return NextResponse.json({ error: "Aprobar o revocar pide tu confirmación explícita." }, { status: 400 });
      r = body.accion === "aprobar" ? await aprobarGuardada(env.DB, user.id, body.indice, ahora) : await revocarGuardada(env.DB, user.id, body.motivo, ahora);
    } else return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
    return r.ok ? NextResponse.json({ estado: r.estado, seq: r.seq, eventos: r.eventos }, { headers: NO_STORE }) : NextResponse.json({ error: r.error }, { status: r.status });
  } catch {
    return NextResponse.json({ error: "No se pudo guardar el laboratorio." }, { status: 500 });
  }
}
