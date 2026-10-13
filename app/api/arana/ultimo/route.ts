import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { aceptarUltimo, serializarUltimo, ULTIMO_MAX_BYTES } from "@/lib/arana-ultimo";
import { ensureUltimoSchema, guardarUltimo, leerUltimo } from "@/lib/arana-ultimo-db";
import { getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * El último escaneo completo de la araña, por cuenta: GET lo devuelve al entrar (una sola fila) y PUT lo reemplaza
 * cuando termina un escaneo completo. Solo con sesión: un escaneo guardado no se comparte entre cuentas.
 */
const NO_STORE = { "Cache-Control": "no-store" };

async function who(request: NextRequest) {
  const session = getCookie(request, SESSION_COOKIE);
  return session && env.DB ? getSessionUser(env.DB, session) : null;
}

export async function GET(request: NextRequest) {
  const user = await who(request);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });
  try {
    await ensureUltimoSchema(env.DB);
    return NextResponse.json({ scan: await leerUltimo(env.DB, user.id) }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "No se pudo leer el último escaneo." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const user = await who(request);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });
  try {
    const texto = await request.text();
    // Antes de parsear: el envoltorio {"scan":…} agrega apenas unos bytes al tope del escaneo.
    if (!texto || texto.length > ULTIMO_MAX_BYTES + 100) return NextResponse.json({ error: "El escaneo es demasiado grande o está vacío." }, { status: 413 });
    let cuerpo: unknown = null;
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      cuerpo = null;
    }
    const scan = aceptarUltimo((cuerpo as { scan?: unknown } | null)?.scan);
    if (!scan) return NextResponse.json({ error: "Eso no tiene la forma de un escaneo." }, { status: 400 });
    const json = serializarUltimo(scan);
    if (json === null) return NextResponse.json({ error: "El escaneo es demasiado grande." }, { status: 413 });
    await ensureUltimoSchema(env.DB);
    await guardarUltimo(env.DB, user.id, scan, json);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "No se pudo guardar el último escaneo." }, { status: 500 });
  }
}
