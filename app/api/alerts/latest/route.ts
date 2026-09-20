import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * What the service worker shows when a push wakes it.
 *
 * Push payloads are sent empty (see lib/web-push.ts), so the content is
 * fetched at display time. That has a side benefit worth keeping: the
 * notification reflects the state when it is shown rather than when it was
 * queued, so a delayed delivery cannot announce something already stale.
 */
export async function GET() {
  const fallback = {
    title: "ALT RADAR PRO",
    body: "Hay movimiento en el radar. Abrí para ver el detalle.",
    url: "/",
  };

  if (!env.DB) return NextResponse.json(fallback, { headers: { "Cache-Control": "no-store" } });

  try {
    // Read the row directly rather than exporting the signals route's own
    // helper: two routes sharing a private function would couple them for no
    // gain, and this needs one row, not the whole ledger payload.
    const latest = await env.DB.prepare(
      `SELECT symbol, side, score, entry_price
         FROM signal_records
        ORDER BY detected_at DESC
        LIMIT 1`,
    ).first<{ symbol: string; side: string; score: number; entry_price: number }>();

    if (!latest) {
      return NextResponse.json(fallback, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(
      {
        title: `${latest.symbol.replace("USDT", "")} · señal ${latest.side}`,
        body: `Convicción ${latest.score}%. Entrada ${latest.entry_price}.`,
        url: "/#historial",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(fallback, { headers: { "Cache-Control": "no-store" } });
  }
}
