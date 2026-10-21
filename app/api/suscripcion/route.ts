import { env, waitUntil } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { getSecret } from "@/lib/app-settings";
import { getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { textoAcceso, textoAvisoAdmin, textoPrecio, validarReporte } from "@/lib/suscripcion";
import { accesoDe, administrador, avisarPorTelegram, configCobro, pagosDe, reportarPago } from "@/lib/suscripcion-db";

export const dynamic = "force-dynamic";

/**
 * El acceso PRO de quien pregunta: visitante (sin sesión), prueba, activo, vencido o administrador, con cómo pagar y sus
 * últimos avisos de pago. POST: avisar que pagó (número de operación); lo aprueba el administrador a mano. Esta ruta no
 * pasa por la puerta PRO: es la que se usa para pagar.
 */
async function who(request: NextRequest) {
  const session = getCookie(request, SESSION_COOKIE);
  return session && env.DB ? getSessionUser(env.DB, session) : null;
}

const NO_GUARDAR = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  if (!env.DB) return NextResponse.json({ error: "SIN BASE" }, { status: 503, headers: NO_GUARDAR });
  const ahora = Date.now();
  const cobro = await configCobro(env.DB, ahora);
  const publico = { alias: cobro.alias, precio: cobro.precio, moneda: cobro.moneda, dias: cobro.dias, diasPrueba: cobro.diasPrueba, precioTexto: textoPrecio(cobro) };
  const user = await who(request);
  if (!user) return NextResponse.json({ sesion: false, estado: "VISITANTE", acceso: false, cobro: publico }, { headers: NO_GUARDAR });
  const [a, pagos] = await Promise.all([accesoDe(env.DB, user.id, ahora), pagosDe(env.DB, user.id)]);
  return NextResponse.json(
    {
      sesion: true,
      email: user.email,
      ...a,
      texto: textoAcceso(a),
      cobro: publico,
      pagos: pagos.map((p) => ({ id: p.id, monto: p.monto, referencia: p.referencia, estado: p.estado, creado: p.creado, revisado: p.revisado })),
    },
    { headers: NO_GUARDAR },
  );
}

export async function POST(request: NextRequest) {
  if (!env.DB) return NextResponse.json({ error: "SIN BASE" }, { status: 503 });
  const user = await who(request);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });
  const r = validarReporte(await request.json().catch(() => null));
  if (typeof r === "string") return NextResponse.json({ error: r }, { status: 400 });
  const guardado = await reportarPago(env.DB, user.id, r);
  if (typeof guardado === "string") return NextResponse.json({ error: guardado }, { status: 409 });
  const cobro = await configCobro(env.DB);
  const db = env.DB;
  waitUntil(
    (async () => {
      const token = (await getSecret(db, env, "telegram_bot_token")).value;
      await avisarPorTelegram(db, token, await administrador(db), textoAvisoAdmin({ email: user.email, monto: r.monto, referencia: r.referencia, nota: r.nota, moneda: cobro.moneda }));
    })().catch(() => undefined),
  );
  return NextResponse.json({ ok: true, id: guardado.id });
}
