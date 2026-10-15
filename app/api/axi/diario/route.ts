import { env } from "cloudflare:workers";
import { MAX_DEALS_AXI, MAX_POR_PEDIDO_AXI, MONEDA_AXI, normalizarDeals, resumirDeals } from "@/lib/axi-diario";
import { ensureAuthSchema, getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { borrarDeals, ensureAxiDiario, guardarDeals, listarDeals } from "@/lib/axi-db";

export const dynamic = "force-dynamic";

/**
 * El diario de tu cuenta de Axi (solo lectura, en USC). La app no se conecta a Axi: las ejecuciones llegan desde el conector
 * que usa tu chat con Claude, pegadas o subidas como JSON.
 * GET: tus ejecuciones (hasta 500, las más recientes) con su resumen.
 * POST { deals }: las ejecuciones; se validan una a una, se guardan las nuevas y las que ya estaban no se duplican. Las
 *   inválidas vuelven con su motivo.
 * DELETE: borra tu diario de Axi.
 */
async function usuario(request: Request) {
  await ensureAuthSchema(env.DB);
  const token = getCookie(request, SESSION_COOKIE);
  return token ? getSessionUser(env.DB, token) : null;
}

export async function GET(request: Request) {
  if (!env.DB) return Response.json({ error: "Base no disponible." }, { status: 503 });
  try {
    const user = await usuario(request);
    if (!user) return Response.json({ error: "Iniciá sesión." }, { status: 401 });
    await ensureAxiDiario(env.DB);
    const filas = await listarDeals(env.DB, user.id);
    const deals = filas.slice(0, MAX_DEALS_AXI);
    return Response.json(
      { moneda: MONEDA_AXI, deals, resumen: resumirDeals(deals), truncado: filas.length > MAX_DEALS_AXI },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[ALT_RADAR_AXI_DIARIO]", error);
    return Response.json({ error: "No se pudo leer el diario de Axi." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!env.DB) return Response.json({ error: "Base no disponible." }, { status: 503 });
  try {
    const user = await usuario(request);
    if (!user) return Response.json({ error: "Iniciá sesión." }, { status: 401 });
    const body = (await request.json().catch(() => null)) as { deals?: unknown } | null;
    if (!body || !Array.isArray(body.deals) || !body.deals.length || body.deals.length > MAX_POR_PEDIDO_AXI) {
      return Response.json({ error: `Enviá entre 1 y ${MAX_POR_PEDIDO_AXI} ejecuciones por pedido.` }, { status: 400 });
    }
    const { deals, rechazados } = normalizarDeals(body.deals);
    await ensureAxiDiario(env.DB);
    const r = deals.length ? await guardarDeals(env.DB, user.id, deals, Date.now()) : { ok: true as const, nuevas: 0, ya: 0 };
    if (!r.ok) return Response.json({ error: r.error }, { status: 409 });
    return Response.json({ moneda: MONEDA_AXI, nuevas: r.nuevas, ya: r.ya, rechazados });
  } catch (error) {
    console.error("[ALT_RADAR_AXI_DIARIO]", error);
    return Response.json({ error: "No se pudo guardar el diario de Axi." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!env.DB) return Response.json({ error: "Base no disponible." }, { status: 503 });
  try {
    const user = await usuario(request);
    if (!user) return Response.json({ error: "Iniciá sesión." }, { status: 401 });
    await ensureAxiDiario(env.DB);
    await borrarDeals(env.DB, user.id);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[ALT_RADAR_AXI_DIARIO]", error);
    return Response.json({ error: "No se pudo borrar el diario de Axi." }, { status: 500 });
  }
}
