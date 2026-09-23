import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { buildDcaPositions, DCA_SCHEMA, type DcaPurchase } from "@/lib/dca-tracker";

export const dynamic = "force-dynamic";

async function requireUser(request: NextRequest) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token || !env.DB) return null;
  return getSessionUser(env.DB, token);
}

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });

  try {
    await env.DB.prepare(DCA_SCHEMA).run();
    const { results } = await env.DB.prepare(
      `SELECT id, symbol, usd_amount, units, price_at_purchase, purchased_at
         FROM dca_purchases WHERE user_id = ?1 ORDER BY purchased_at DESC LIMIT 1000`,
    )
      .bind(user.id)
      .all<{
        id: string;
        symbol: string;
        usd_amount: number;
        units: number;
        price_at_purchase: number;
        purchased_at: string;
      }>();

    const purchases: DcaPurchase[] = results.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      usdAmount: row.usd_amount,
      units: row.units,
      priceAtPurchase: row.price_at_purchase,
      purchasedAt: row.purchased_at,
    }));

    // Positions are returned WITHOUT current price applied — the browser
    // supplies live prices itself (this route has no reason to fetch
    // market data on every load) and can recompute value/P&L client-side.
    return NextResponse.json(
      { purchases, positions: buildDcaPositions(purchases, {}) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[ALT_RADAR_DCA_GET]", error);
    return NextResponse.json({ error: "NO SE PUDO LEER EL REGISTRO" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Partial<DcaPurchase> | null;
  const symbol = typeof body?.symbol === "string" ? body.symbol.toUpperCase().trim() : "";
  const usdAmount = typeof body?.usdAmount === "number" ? body.usdAmount : NaN;
  const priceAtPurchase = typeof body?.priceAtPurchase === "number" ? body.priceAtPurchase : NaN;
  const purchasedAt = typeof body?.purchasedAt === "string" ? body.purchasedAt : null;

  if (!symbol || !(usdAmount > 0) || !(priceAtPurchase > 0) || !purchasedAt) {
    return NextResponse.json({ error: "DATOS INCOMPLETOS" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const units = usdAmount / priceAtPurchase;

  try {
    await env.DB.prepare(DCA_SCHEMA).run();
    await env.DB.prepare(
      `INSERT INTO dca_purchases
         (id, user_id, symbol, usd_amount, units, price_at_purchase, purchased_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
      .bind(id, user.id, symbol, usdAmount, units, priceAtPurchase, purchasedAt, new Date().toISOString())
      .run();
    return NextResponse.json({ ok: true, id, units });
  } catch (error) {
    console.error("[ALT_RADAR_DCA_POST]", error);
    return NextResponse.json({ error: "NO SE PUDO GUARDAR" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const user = await requireUser(request);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "FALTA ID" }, { status: 400 });

  try {
    await env.DB.prepare(DCA_SCHEMA).run();
    await env.DB.prepare("DELETE FROM dca_purchases WHERE id = ?1 AND user_id = ?2")
      .bind(id, user.id)
      .run();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[ALT_RADAR_DCA_DELETE]", error);
    return NextResponse.json({ error: "NO SE PUDO BORRAR" }, { status: 500 });
  }
}
