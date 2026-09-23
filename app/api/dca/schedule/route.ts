import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { DCA_SCHEDULE_FREQUENCIES, DCA_SCHEMA, type DcaSchedule } from "@/lib/dca-tracker";

export const dynamic = "force-dynamic";

/**
 * A schedule is a reminder configuration, nothing more. Saving one here
 * only decides when a DCA alert fires (see lib/alerts.ts dcaReminderAlert)
 * — it does not place any order, on this route or anywhere else in the app.
 */

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
      `SELECT symbol, usd_amount, frequency, weekday, enabled
         FROM dca_schedules WHERE user_id = ?1`,
    )
      .bind(user.id)
      .all<{ symbol: string; usd_amount: number; frequency: string; weekday: number; enabled: number }>();

    const schedules: DcaSchedule[] = results.map((row) => ({
      symbol: row.symbol,
      usdAmount: row.usd_amount,
      frequency: row.frequency as DcaSchedule["frequency"],
      weekday: row.weekday,
      enabled: row.enabled === 1,
    }));
    return NextResponse.json({ schedules }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[ALT_RADAR_DCA_SCHEDULE_GET]", error);
    return NextResponse.json({ error: "NO SE PUDO LEER EL CALENDARIO" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Partial<DcaSchedule> | null;
  const symbol = typeof body?.symbol === "string" ? body.symbol.toUpperCase().trim() : "";
  const usdAmount = typeof body?.usdAmount === "number" ? body.usdAmount : NaN;
  const frequency = DCA_SCHEDULE_FREQUENCIES.includes(body?.frequency as DcaSchedule["frequency"])
    ? (body!.frequency as DcaSchedule["frequency"])
    : null;
  const weekday = typeof body?.weekday === "number" && body.weekday >= 0 && body.weekday <= 6 ? body.weekday : 0;
  const enabled = body?.enabled !== false;

  if (!symbol || !(usdAmount > 0) || !frequency) {
    return NextResponse.json({ error: "DATOS INCOMPLETOS" }, { status: 400 });
  }

  try {
    await env.DB.prepare(DCA_SCHEMA).run();
    await env.DB.prepare(
      `INSERT INTO dca_schedules (user_id, symbol, usd_amount, frequency, weekday, enabled, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(user_id, symbol) DO UPDATE SET
         usd_amount = ?3, frequency = ?4, weekday = ?5, enabled = ?6, updated_at = ?7`,
    )
      .bind(user.id, symbol, usdAmount, frequency, weekday, enabled ? 1 : 0, new Date().toISOString())
      .run();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[ALT_RADAR_DCA_SCHEDULE_POST]", error);
    return NextResponse.json({ error: "NO SE PUDO GUARDAR" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const user = await requireUser(request);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });

  const symbol = request.nextUrl.searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "FALTA SYMBOL" }, { status: 400 });

  try {
    await env.DB.prepare(DCA_SCHEMA).run();
    await env.DB.prepare("DELETE FROM dca_schedules WHERE user_id = ?1 AND symbol = ?2")
      .bind(user.id, symbol.toUpperCase())
      .run();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[ALT_RADAR_DCA_SCHEDULE_DELETE]", error);
    return NextResponse.json({ error: "NO SE PUDO BORRAR" }, { status: 500 });
  }
}
