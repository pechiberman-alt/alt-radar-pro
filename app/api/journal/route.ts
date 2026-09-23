import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { getCookie, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { computeTradeStats, TRADE_JOURNAL_SCHEMA, type TradeEntry } from "@/lib/trade-journal";

export const dynamic = "force-dynamic";

/**
 * A manual trade record, scoped per account.
 *
 * Every entry here is typed in by a person about a trade they already took —
 * nothing in this route calls an exchange or moves money. It is scoped to
 * the logged-in user (the same session system app/api/auth already runs)
 * because a trade history is personal: unlike the market-wide panels
 * elsewhere in this app, this is one person's own record, and once this
 * product has more than one user, it must not leak between them.
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
    await env.DB.prepare(TRADE_JOURNAL_SCHEMA).run();
    const { results } = await env.DB.prepare(
      `SELECT id, symbol, side, entry_price, exit_price, size_usd, opened_at, closed_at, note
         FROM trade_journal WHERE user_id = ?1 ORDER BY opened_at DESC LIMIT 500`,
    )
      .bind(user.id)
      .all<{
        id: string;
        symbol: string;
        side: string;
        entry_price: number;
        exit_price: number | null;
        size_usd: number;
        opened_at: string;
        closed_at: string | null;
        note: string;
      }>();

    const entries: TradeEntry[] = results.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      side: row.side as TradeEntry["side"],
      entryPrice: row.entry_price,
      exitPrice: row.exit_price,
      sizeUsd: row.size_usd,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      note: row.note,
    }));

    return NextResponse.json(
      { entries, stats: computeTradeStats(entries) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[ALT_RADAR_JOURNAL_GET]", error);
    return NextResponse.json({ error: "NO SE PUDO LEER EL REGISTRO" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Partial<TradeEntry> | null;
  const symbol = typeof body?.symbol === "string" ? body.symbol.toUpperCase().trim() : "";
  const side = body?.side === "LONG" || body?.side === "SHORT" ? body.side : null;
  const entryPrice = typeof body?.entryPrice === "number" ? body.entryPrice : NaN;
  const sizeUsd = typeof body?.sizeUsd === "number" ? body.sizeUsd : NaN;
  const exitPrice = typeof body?.exitPrice === "number" ? body.exitPrice : null;
  const openedAt = typeof body?.openedAt === "string" ? body.openedAt : null;
  const closedAt = typeof body?.closedAt === "string" ? body.closedAt : null;
  const note = typeof body?.note === "string" ? body.note.slice(0, 500) : "";

  // A trade without a real symbol, side, entry, size, or open date cannot be
  // graded or shown — reject rather than store a half-formed row.
  if (!symbol || !side || !(entryPrice > 0) || !(sizeUsd > 0) || !openedAt) {
    return NextResponse.json({ error: "DATOS INCOMPLETOS" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(TRADE_JOURNAL_SCHEMA).run();
    await env.DB.prepare(
      `INSERT INTO trade_journal
         (id, user_id, symbol, side, entry_price, exit_price, size_usd, opened_at, closed_at, note, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
      .bind(
        id,
        user.id,
        symbol,
        side,
        entryPrice,
        exitPrice,
        sizeUsd,
        openedAt,
        closedAt,
        note,
        new Date().toISOString(),
      )
      .run();
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    console.error("[ALT_RADAR_JOURNAL_POST]", error);
    return NextResponse.json({ error: "NO SE PUDO GUARDAR" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const user = await requireUser(request);
  if (!user) return NextResponse.json({ error: "SESIÓN REQUERIDA" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "FALTA ID" }, { status: 400 });

  try {
    await env.DB.prepare(TRADE_JOURNAL_SCHEMA).run();
    // Scoped by user_id too, not just id: without this, any logged-in user
    // could delete another user's row by guessing its id.
    await env.DB.prepare("DELETE FROM trade_journal WHERE id = ?1 AND user_id = ?2")
      .bind(id, user.id)
      .run();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[ALT_RADAR_JOURNAL_DELETE]", error);
    return NextResponse.json({ error: "NO SE PUDO BORRAR" }, { status: 500 });
  }
}
