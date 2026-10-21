import { env, waitUntil } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { adminUserId, getSecret } from "@/lib/app-settings";
import { getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { TEXTO_RECHAZADO, textoAprobado, validarConfigCobro } from "@/lib/suscripcion";
import {
  aprobarPago,
  avisarPorTelegram,
  configCobro,
  cuentasConEstado,
  extenderPro,
  guardarConfigCobro,
  pagosPendientes,
  pagosRevisados,
  rechazarPago,
  usuarioPorEmail,
} from "@/lib/suscripcion-db";

export const dynamic = "force-dynamic";

/**
 * Los cobros, solo para el administrador: la configuración (alias, precio, días), los avisos de pago pendientes para
 * aprobar o rechazar a mano, las cuentas con su estado y la activación manual por email. Nada se aprueba solo.
 */
async function soloAdmin(request: NextRequest) {
  const session = getCookie(request, SESSION_COOKIE);
  if (!session || !env.DB) return null;
  const user = await getSessionUser(env.DB, session);
  if (!user || (await adminUserId(env.DB)) !== user.id) return null;
  return user;
}

const NO_GUARDAR = { "Cache-Control": "no-store" };
const NO_ADMIN = () => NextResponse.json({ error: "SÓLO ADMINISTRADOR" }, { status: 403, headers: NO_GUARDAR });

export async function GET(request: NextRequest) {
  if (!(await soloAdmin(request))) return NO_ADMIN();
  const [config, pendientes, revisados, cuentas] = await Promise.all([configCobro(env.DB, Date.now(), true), pagosPendientes(env.DB), pagosRevisados(env.DB), cuentasConEstado(env.DB)]);
  return NextResponse.json({ config, pendientes, revisados, cuentas }, { headers: NO_GUARDAR });
}

type Pedido =
  | { accion: "aprobar"; id: number; dias?: number }
  | { accion: "rechazar"; id: number }
  | { accion: "config"; config: unknown }
  | { accion: "activar"; email: string; dias: number };

export async function POST(request: NextRequest) {
  if (!(await soloAdmin(request))) return NO_ADMIN();
  const body = (await request.json().catch(() => null)) as Pedido | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "PEDIDO INVÁLIDO" }, { status: 400 });
  const db = env.DB;
  const token = async () => (await getSecret(db, env, "telegram_bot_token")).value;
  const diasValidos = (d: unknown, porDefecto: number) => {
    const n = d === undefined ? porDefecto : Number(d);
    return Number.isInteger(n) && n >= 1 && n <= 366 ? n : null;
  };

  if (body.accion === "config") {
    const c = validarConfigCobro(body.config);
    if (typeof c === "string") return NextResponse.json({ error: c }, { status: 400 });
    await guardarConfigCobro(db, c);
    return NextResponse.json({ ok: true, config: c });
  }
  if (body.accion === "aprobar") {
    const dias = diasValidos(body.dias, (await configCobro(db, Date.now(), true)).dias);
    if (!Number.isInteger(body.id) || dias === null) return NextResponse.json({ error: "PEDIDO INVÁLIDO" }, { status: 400 });
    const r = await aprobarPago(db, body.id, dias);
    if (!r) return NextResponse.json({ error: "ESE AVISO YA NO ESTÁ PENDIENTE" }, { status: 409 });
    waitUntil(token().then((t) => avisarPorTelegram(db, t, r.userId, textoAprobado(r.hasta))).catch(() => undefined));
    return NextResponse.json({ ok: true, hasta: r.hasta });
  }
  if (body.accion === "rechazar") {
    if (!Number.isInteger(body.id)) return NextResponse.json({ error: "PEDIDO INVÁLIDO" }, { status: 400 });
    const r = await rechazarPago(db, body.id);
    if (!r) return NextResponse.json({ error: "ESE AVISO YA NO ESTÁ PENDIENTE" }, { status: 409 });
    waitUntil(token().then((t) => avisarPorTelegram(db, t, r.userId, TEXTO_RECHAZADO)).catch(() => undefined));
    return NextResponse.json({ ok: true });
  }
  if (body.accion === "activar") {
    const dias = diasValidos(body.dias, 30);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || email.length > 200 || dias === null) return NextResponse.json({ error: "PEDIDO INVÁLIDO" }, { status: 400 });
    const id = await usuarioPorEmail(db, email);
    if (!id) return NextResponse.json({ error: "NO HAY UNA CUENTA CON ESE EMAIL" }, { status: 404 });
    const hasta = await extenderPro(db, id, dias);
    waitUntil(token().then((t) => avisarPorTelegram(db, t, id, textoAprobado(hasta))).catch(() => undefined));
    return NextResponse.json({ ok: true, hasta });
  }
  return NextResponse.json({ error: "ACCIÓN DESCONOCIDA" }, { status: 400 });
}
